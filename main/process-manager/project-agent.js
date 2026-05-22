const fs = require('fs');
const path = require('path');
const treeKill = require('tree-kill');

const STOP_TIMEOUT_MS = 5000;

let child = null;
let logFd = null;
let cleaningUp = false;
let exiting = false;

async function getExeca() {
  const mod = await import('execa');
  return mod.execa;
}

function decodeOptions() {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error('缺少代理进程启动参数');
  }
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  const options = JSON.parse(json);
  if (!options.spawnCmd) {
    throw new Error('缺少真实启动命令');
  }
  if (!options.workDir) {
    throw new Error('缺少工作目录');
  }
  if (!options.logPath) {
    throw new Error('缺少日志路径');
  }
  return {
    projectId: Number(options.projectId),
    spawnCmd: options.spawnCmd,
    spawnArgs: Array.isArray(options.spawnArgs) ? options.spawnArgs : [],
    workDir: options.workDir,
    needsShell: Boolean(options.needsShell),
    logPath: options.logPath
  };
}

function appendAgentLog(message) {
  if (!logFd) {
    return;
  }
  fs.writeSync(logFd, `[${new Date().toISOString()}] [agent] ${message}\n`);
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_err) {
    return false;
  }
}

function killProcessTree(pid, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    if (!pid) {
      resolve(true);
      return;
    }
    treeKill(Number(pid), signal, (error) => {
      resolve(!error || !isProcessAlive(pid));
    });
  });
}

async function cleanupChild(signal = 'SIGTERM') {
  if (cleaningUp) {
    return;
  }
  cleaningUp = true;
  const pid = child?.pid;
  if (!pid) {
    return;
  }
  appendAgentLog(`清理真实进程树 pid=${pid} signal=${signal}`);
  const stopped = await killProcessTree(pid, signal);
  if (!stopped) {
    appendAgentLog(`真实进程树未在预期内停止，执行强制清理 pid=${pid}`);
    await killProcessTree(pid, 'SIGKILL');
  }
}

function closeLogFd() {
  if (logFd) {
    fs.closeSync(logFd);
    logFd = null;
  }
}

async function exitAgent(code = 0, signal = 'SIGTERM') {
  if (exiting) {
    return;
  }
  exiting = true;
  const timer = setTimeout(() => {
    closeLogFd();
    process.exit(1);
  }, STOP_TIMEOUT_MS);
  try {
    await cleanupChild(signal);
    clearTimeout(timer);
    closeLogFd();
    process.exit(code);
  } catch (error) {
    clearTimeout(timer);
    appendAgentLog(`代理进程退出清理失败：${error.message}`);
    closeLogFd();
    process.exit(1);
  }
}

async function start() {
  const options = decodeOptions();
  fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
  logFd = fs.openSync(options.logPath, 'a');
  appendAgentLog(`代理进程启动 projectId=${options.projectId} command=${options.spawnCmd} args=${JSON.stringify(options.spawnArgs)}`);

  const execa = await getExeca();
  child = execa(options.spawnCmd, options.spawnArgs, {
    cwd: options.workDir,
    shell: options.needsShell,
    windowsHide: true,
    reject: false,
    all: false,
    stdio: ['ignore', logFd, logFd]
  });

  if (!child.pid) {
    throw new Error('真实项目进程启动失败：未获取到 PID');
  }

  appendAgentLog(`真实项目进程已启动 pid=${child.pid}`);

  child.on('exit', (code, signal) => {
    appendAgentLog(`真实项目进程退出 code=${code ?? ''} signal=${signal ?? ''}`);
    closeLogFd();
    process.exit(code ?? (signal ? 1 : 0));
  });

  child.on('error', (error) => {
    appendAgentLog(`真实项目进程错误：${error.message}`);
    closeLogFd();
    process.exit(1);
  });
}

process.on('SIGTERM', () => exitAgent(0, 'SIGTERM'));
process.on('SIGINT', () => exitAgent(0, 'SIGINT'));
process.on('SIGHUP', () => exitAgent(0, 'SIGHUP'));
process.on('uncaughtException', (error) => {
  appendAgentLog(`代理进程未捕获异常：${error.message}`);
  exitAgent(1, 'SIGTERM');
});
process.on('unhandledRejection', (error) => {
  appendAgentLog(`代理进程未处理 Promise 拒绝：${error?.message || error}`);
  exitAgent(1, 'SIGTERM');
});

start().catch((error) => {
  appendAgentLog(`代理进程启动失败：${error.message}`);
  closeLogFd();
  process.exit(1);
});

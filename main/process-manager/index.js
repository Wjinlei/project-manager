const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getRepositories } = require('../database');

const runningProcesses = new Map();
const outputBuffers = new Map();
const logWatchers = new Map();
const MAX_OUTPUT_LINES = 1000;
const MAX_LOG_BYTES = 1024 * 1024;
const STOP_TIMEOUT_MS = 5000;
let mainWindow;
let appQuitting = false;

function getMainWindow() {
  return typeof mainWindow === 'function' ? mainWindow() : mainWindow;
}

function markAppQuitting() {
  appQuitting = true;
}

function appendOutput(projectId, type, data) {
  const id = Number(projectId);
  const item = { projectId: id, type, data, time: new Date().toISOString() };
  const buffer = outputBuffers.get(id) || [];
  buffer.push(item);
  if (buffer.length > MAX_OUTPUT_LINES) {
    buffer.splice(0, buffer.length - MAX_OUTPUT_LINES);
  }
  outputBuffers.set(id, buffer);
  return item;
}

function getLogDirectory() {
  return path.join(os.homedir(), '.project-manager', 'project-log');
}

function getRuntimeStatusPath() {
  return path.join(os.homedir(), '.project-manager', 'runtime-status.json');
}

function readRuntimeStatusFile() {
  const statusPath = getRuntimeStatusPath();
  if (!fs.existsSync(statusPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8')) || {};
  } catch (_err) {
    return {};
  }
}

function writeRuntimeStatusFile(statuses) {
  fs.mkdirSync(path.dirname(getRuntimeStatusPath()), { recursive: true });
  fs.writeFileSync(getRuntimeStatusPath(), JSON.stringify(statuses, null, 2));
}

function saveRuntimeStatus(projectId, status) {
  const statuses = readRuntimeStatusFile();
  statuses[Number(projectId)] = status;
  writeRuntimeStatusFile(statuses);
}

function removeRuntimeStatus(projectId) {
  const statuses = readRuntimeStatusFile();
  delete statuses[Number(projectId)];
  writeRuntimeStatusFile(statuses);
}

function getSavedRuntimeStatus(projectId) {
  return readRuntimeStatusFile()[Number(projectId)] || null;
}

function sanitizeLogName(name, projectId) {
  const safeName = String(name || `项目${projectId}`)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return safeName || `项目${projectId}`;
}

function getLogPath(project) {
  return path.join(getLogDirectory(), `${sanitizeLogName(project?.name, project?.id)}.txt`);
}

function ensureLogDirectory() {
  fs.mkdirSync(getLogDirectory(), { recursive: true });
}

function appendProjectLog(projectId, type, data) {
  const project = getRepositories().projects.findById(Number(projectId));
  if (!project) {
    return;
  }
  ensureLogDirectory();
  fs.appendFileSync(getLogPath(project), `[${new Date().toISOString()}] [${type}] ${data}`);
}

function readProjectLog(projectId) {
  const project = getRepositories().projects.findById(Number(projectId));
  if (!project) {
    throw new Error('项目不存在');
  }
  const logPath = getLogPath(project);
  if (!fs.existsSync(logPath)) {
    return { projectId: Number(projectId), logPath, content: '', exists: false };
  }
  const stat = fs.statSync(logPath);
  const start = Math.max(0, stat.size - MAX_LOG_BYTES);
  const buffer = Buffer.alloc(stat.size - start);
  const fd = fs.openSync(logPath, 'r');
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);
  return { projectId: Number(projectId), logPath, content: buffer.toString('utf8'), exists: true };
}

function clearProjectLog(projectId) {
  const project = getRepositories().projects.findById(Number(projectId));
  if (!project) {
    throw new Error('项目不存在');
  }
  ensureLogDirectory();
  fs.writeFileSync(getLogPath(project), '');
  outputBuffers.set(Number(projectId), []);
  return true;
}

function stopLogWatch(projectId) {
  const id = Number(projectId);
  const watcher = logWatchers.get(id);
  if (watcher) {
    watcher.close();
    logWatchers.delete(id);
  }
}

function watchProjectLog(projectId) {
  const id = Number(projectId);
  stopLogWatch(id);
  const project = getRepositories().projects.findById(id);
  if (!project) {
    throw new Error('项目不存在');
  }
  ensureLogDirectory();
  const logPath = getLogPath(project);
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '');
  }
  let position = fs.statSync(logPath).size;
  const watcher = fs.watch(logPath, () => {
    try {
      const stat = fs.statSync(logPath);
      if (stat.size < position) {
        position = 0;
      }
      if (stat.size === position) {
        return;
      }
      const buffer = Buffer.alloc(stat.size - position);
      const fd = fs.openSync(logPath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, position);
      fs.closeSync(fd);
      position = stat.size;
      getMainWindow()?.webContents.send('terminal:log-output', {
        projectId: id,
        data: buffer.toString('utf8'),
        time: new Date().toISOString()
      });
    } catch (_err) {
      stopLogWatch(id);
    }
  });
  logWatchers.set(id, watcher);
  return { projectId: id, logPath };
}

function parseArgs(args) {
  if (!args || !args.trim()) {
    return [];
  }
  return args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((arg) => arg.replace(/^"|"$/g, '')) || [];
}

function getExecutable(projectId) {
  return getRepositories()
    .projectExecutables
    .findAll()
    .find((item) => item.project_id === Number(projectId));
}

function saveExecutable(projectId, payload) {
  const repositories = getRepositories();
  const current = getExecutable(projectId);
  const data = {
    project_id: Number(projectId),
    exec_path: payload.exec_path,
    args: payload.args || '',
    work_dir: payload.work_dir || ''
  };

  if (current) {
    return repositories.projectExecutables.update(current.id, data);
  }
  return repositories.projectExecutables.create(data);
}

function getSpawnOptions(project, executable) {
  const useCommand = !executable.exec_path && executable.args;
  const workDir = executable.work_dir || project.path || (executable.exec_path ? path.dirname(executable.exec_path) : process.cwd());
  const projectType = (project.type || '').toLowerCase();
  const ext = path.extname(executable.exec_path || '').toLowerCase();
  const args = parseArgs(executable.args);

  let spawnCmd, spawnArgs, needsShell = false;

  if (useCommand) {
    spawnCmd = args[0];
    spawnArgs = args.slice(1);
    needsShell = process.platform === 'win32';
    return { workDir, spawnCmd, spawnArgs, needsShell };
  }

  switch (projectType) {
    case 'go':
      spawnCmd = 'go';
      spawnArgs = ['run', executable.exec_path, ...args];
      break;
    case 'node':
      spawnCmd = 'node';
      spawnArgs = [executable.exec_path, ...args];
      break;
    case 'python':
      spawnCmd = 'python';
      spawnArgs = [executable.exec_path, ...args];
      break;
    case 'java':
      spawnCmd = 'java';
      spawnArgs = ['-jar', executable.exec_path, ...args];
      break;
    case '.net':
      spawnCmd = 'dotnet';
      spawnArgs = ['run', '--project', executable.exec_path, ...args];
      break;
    case 'php':
      spawnCmd = 'php';
      spawnArgs = [executable.exec_path, ...args];
      break;
    case 'html':
      spawnCmd = 'npx';
      spawnArgs = ['http-server', workDir, '-p', args[0] || '8080'];
      break;
    default:
      switch (ext) {
        case '.js':
          spawnCmd = 'node';
          spawnArgs = [executable.exec_path, ...args];
          break;
        case '.go':
          spawnCmd = 'go';
          spawnArgs = ['run', executable.exec_path, ...args];
          break;
        case '.py':
          spawnCmd = 'python';
          spawnArgs = [executable.exec_path, ...args];
          break;
        case '.sh':
          spawnCmd = 'bash';
          spawnArgs = [executable.exec_path, ...args];
          needsShell = true;
          break;
        case '.bat':
        case '.cmd':
          spawnCmd = executable.exec_path;
          spawnArgs = args;
          needsShell = true;
          break;
        case '.ps1':
          spawnCmd = 'powershell';
          spawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', executable.exec_path, ...args];
          break;
        default:
          spawnCmd = executable.exec_path;
          spawnArgs = args;
      }
  }

  return { workDir, spawnCmd, spawnArgs, needsShell };
}

async function getWindowsProcesses() {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
    ], { windowsHide: true, maxBuffer: 1024 * 1024 * 20 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (_err) {
        resolve([]);
      }
    });
  });
}

function normalizeText(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
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

function processMatchesProject(proc, project, executable, spawnInfo) {
  const commandLine = normalizeText(proc.CommandLine);
  const executablePath = normalizeText(proc.ExecutablePath);
  const execPath = normalizeText(executable.exec_path);
  const projectPath = normalizeText(project.path);
  const workDir = normalizeText(spawnInfo.workDir);
  const spawnCmd = normalizeText(spawnInfo.spawnCmd);
  const args = parseArgs(executable.args).map(normalizeText).filter(Boolean);

  if (!commandLine && !executablePath) {
    return false;
  }

  const hasExecPath = execPath && (commandLine.includes(execPath) || executablePath === execPath);
  const hasProjectPath = projectPath && commandLine.includes(projectPath);
  const hasWorkDir = workDir && commandLine.includes(workDir);
  const hasSpawnCommand = spawnCmd && (commandLine.includes(spawnCmd) || executablePath.endsWith(`/${spawnCmd}.exe`) || executablePath.endsWith(`/${spawnCmd}`));
  const argsMatched = args.length === 0 || args.every((arg) => commandLine.includes(arg));

  if (hasExecPath && argsMatched) {
    return true;
  }
  if ((hasProjectPath || hasWorkDir) && hasSpawnCommand && argsMatched) {
    return true;
  }
  return false;
}

async function detectExternalRuntime(project, executable) {
  if (!project || !executable || (!executable.exec_path && !executable.args)) {
    return null;
  }
  const spawnInfo = getSpawnOptions(project, executable);
  const processes = await getWindowsProcesses();
  const currentPid = process.pid;
  const match = processes.find((proc) => Number(proc.ProcessId) !== currentPid && processMatchesProject(proc, project, executable, spawnInfo));
  if (!match) {
    return null;
  }
  return {
    projectId: project.id,
    running: true,
    pid: Number(match.ProcessId),
    startedAt: null,
    managed: false,
    source: 'external'
  };
}

async function getRuntimeStatus(projectId) {
  const id = Number(projectId);
  const runtime = runningProcesses.get(id);
  if (runtime) {
    return { projectId: id, running: true, pid: runtime.process.pid, startedAt: runtime.startedAt, managed: true, source: 'managed' };
  }
  const savedRuntime = getSavedRuntimeStatus(id);
  if (savedRuntime?.pid && isProcessAlive(savedRuntime.pid)) {
    updateProjectStatus(id, 'running');
    return {
      projectId: id,
      running: true,
      pid: Number(savedRuntime.pid),
      startedAt: savedRuntime.startedAt || null,
      managed: true,
      source: 'saved'
    };
  }
  const repositories = getRepositories();
  const project = repositories.projects.findById(id);
  const executable = getExecutable(id);
  const external = await detectExternalRuntime(project, executable);
  if (external) {
    updateProjectStatus(id, 'running');
    return external;
  }
  updateProjectStatus(id, 'stopped');
  return { projectId: id, running: false, pid: null, managed: false, source: 'none' };
}

function updateProjectStatus(projectId, status) {
  const repositories = getRepositories();
  const project = repositories.projects.findById(Number(projectId));
  if (project) {
    repositories.projects.update(project.id, {
      status,
      updated_at: new Date().toISOString()
    });
  }
}

function waitForProcessExit(child, timeoutMs = STOP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve(result);
    };
    const onExit = (code, signal) => finish({ exited: true, code, signal });
    const onClose = (code, signal) => finish({ exited: true, code, signal });
    const onError = (error) => finish({ exited: true, error });
    const timer = setTimeout(() => finish({ exited: false }), timeoutMs);
    child.once('exit', onExit);
    child.once('close', onClose);
    child.once('error', onError);
  });
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStoppedStatus(projectId, timeoutMs = 3000) {
  const startedAt = Date.now();
  let status = await getRuntimeStatus(projectId);
  while (status.running && Date.now() - startedAt < timeoutMs) {
    await delay(300);
    status = await getRuntimeStatus(projectId);
  }
  return status;
}

async function startProject(projectId) {
  const id = Number(projectId);
  if (runningProcesses.has(id)) {
    return await getRuntimeStatus(id);
  }

  const repositories = getRepositories();
  const project = repositories.projects.findById(id);
  if (!project) {
    throw new Error('项目不存在');
  }

  const executable = getExecutable(id);
  if (!executable || (!executable.exec_path && !executable.args?.trim())) {
    throw new Error('请先配置执行文件或执行命令');
  }

  const external = await detectExternalRuntime(project, executable);
  if (external) {
    return external;
  }

  const { workDir, spawnCmd, spawnArgs, needsShell } = getSpawnOptions(project, executable);
  ensureLogDirectory();

  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workDir,
    shell: needsShell,
    windowsHide: false
  });

  const startedAt = new Date().toISOString();
  runningProcesses.set(id, {
    process: child,
    startedAt,
    output: []
  });
  saveRuntimeStatus(id, { pid: child.pid, startedAt, source: 'managed' });
  updateProjectStatus(id, 'running');

  child.stdout?.on('data', (chunk) => {
    const data = chunk.toString();
    appendProjectLog(id, 'stdout', data);
    const output = appendOutput(id, 'stdout', data);
    getMainWindow()?.webContents.send('terminal:output', output);
  });

  child.stderr?.on('data', (chunk) => {
    const data = chunk.toString();
    appendProjectLog(id, 'stderr', data);
    const output = appendOutput(id, 'stderr', data);
    getMainWindow()?.webContents.send('terminal:output', output);
  });

  child.on('error', (err) => {
    runningProcesses.delete(id);
    if (!appQuitting) {
      updateProjectStatus(id, 'error');
    }
    appendProjectLog(id, 'stderr', `启动失败: ${err.message} (文件: ${executable.exec_path})\n`);
    getMainWindow()?.webContents.send('terminal:output', {
      projectId: id,
      type: 'stderr',
      data: `启动失败: ${err.message} (文件: ${executable.exec_path})`,
      time: new Date().toISOString()
    });
  });

  child.on('exit', (code) => {
    runningProcesses.delete(id);
    if (!appQuitting) {
      updateProjectStatus(id, code === 0 ? 'stopped' : 'error');
    }
    appendProjectLog(id, 'system', `进程已退出，退出码: ${code}\n`);
  });

  return await getRuntimeStatus(id);
}

async function stopProject(projectId) {
  const id = Number(projectId);
  const runtime = runningProcesses.get(id);
  if (!runtime) {
    const savedRuntime = getSavedRuntimeStatus(id);
    if (savedRuntime?.pid && isProcessAlive(savedRuntime.pid)) {
      if (process.platform === 'win32') {
        await killProcessTree(savedRuntime.pid);
      } else {
        process.kill(Number(savedRuntime.pid), 'SIGTERM');
      }
      removeRuntimeStatus(id);
      updateProjectStatus(id, 'stopped');
      appendProjectLog(id, 'system', '已停止保存的托管进程\n');
      return { projectId: id, running: false, pid: null, managed: false, source: 'none', stopped: true };
    }
    if (savedRuntime?.pid) {
      removeRuntimeStatus(id);
    }
    const status = await getRuntimeStatus(id);
    if (status.running && !status.managed) {
      return { ...status, message: '检测到外部启动的进程，未执行停止以避免误杀。' };
    }
    updateProjectStatus(id, 'stopped');
    return { projectId: id, running: false, pid: null, managed: false, source: 'none' };
  }

  let stopped = false;
  try {
    if (process.platform === 'win32') {
      const killedTree = await killProcessTree(runtime.process.pid);
      stopped = killedTree;
      if (killedTree) {
        await waitForProcessExit(runtime.process, 2000);
      }
    } else if (!runtime.process.killed) {
      runtime.process.kill('SIGTERM');
    }
    if (!stopped) {
      const gracefulResult = await waitForProcessExit(runtime.process);
      stopped = gracefulResult.exited;
    }
    if (!stopped) {
      if (runningProcesses.has(id)) {
        runtime.process.kill('SIGKILL');
        const forcedResult = await waitForProcessExit(runtime.process, 2000);
        stopped = forcedResult.exited || runtime.process.killed;
      }
    }
  } catch (err) {
    appendProjectLog(id, 'stderr', `停止失败: ${err.message}\n`);
    getMainWindow()?.webContents.send('terminal:output', {
      projectId: id,
      type: 'stderr',
      data: `停止失败: ${err.message}`,
      time: new Date().toISOString()
    });
  }

  runningProcesses.delete(id);
  removeRuntimeStatus(id);
  updateProjectStatus(id, 'stopped');
  appendProjectLog(id, 'system', stopped ? '进程已停止\n' : '已执行停止流程，进程状态待系统刷新\n');
  return { projectId: id, running: false, pid: null, managed: false, source: 'none', stopped };
}

async function restartProject(projectId) {
  const stopResult = await stopProject(projectId);
  if (stopResult.running && !stopResult.managed) {
    return stopResult;
  }
  const status = await waitForStoppedStatus(projectId);
  if (status.running) {
    return { ...status, message: '项目尚未完全停止，已取消重启。' };
  }
  return await startProject(projectId);
}

async function listRuntimeStatuses() {
  const repositories = getRepositories();
  const projects = repositories.projects.findAll();
  const statuses = [];
  for (const project of projects) {
    try {
      const status = await getRuntimeStatus(project.id);
      if (status.running) {
        statuses.push(status);
      }
    } catch (error) {
      appendProjectLog(project.id, 'stderr', `状态检测失败: ${error.message}\n`);
    }
  }
  return statuses;
}

function getOutputHistory(projectId) {
  return outputBuffers.get(Number(projectId)) || [];
}

function clearOutput(projectId) {
  outputBuffers.set(Number(projectId), []);
  return true;
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getExternalStartCommand(projectId) {
  const id = Number(projectId);
  const repositories = getRepositories();
  const project = repositories.projects.findById(id);
  if (!project) {
    throw new Error('项目不存在');
  }
  const executable = getExecutable(id);
  if (!executable?.exec_path) {
    throw new Error('请先配置执行文件');
  }
  const spawnInfo = getSpawnOptions(project, executable);
  const logPath = getLogPath(project);
  const command = [spawnInfo.spawnCmd, ...spawnInfo.spawnArgs].map(quotePowerShell).join(' ');
  const workDir = quotePowerShell(spawnInfo.workDir);
  const quotedLogPath = quotePowerShell(logPath);
  return {
    projectId: id,
    logPath,
    command: `New-Item -ItemType Directory -Force -Path ${quotePowerShell(getLogDirectory())} | Out-Null; Set-Location ${workDir}; & ${command} *>> ${quotedLogPath}`
  };
}

async function selectExecutable(browserWindow) {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(browserWindow, {
    title: '选择执行文件',
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

function registerProcessManagerIpc(ipcMain, getMainWindow) {
  mainWindow = getMainWindow;
  ipcMain.handle('process:get-executable', (_event, projectId) => getExecutable(projectId));
  ipcMain.handle('process:save-executable', (_event, projectId, payload) => saveExecutable(projectId, payload));
  ipcMain.handle('process:start', (_event, projectId) => startProject(projectId));
  ipcMain.handle('process:stop', (_event, projectId) => stopProject(projectId));
  ipcMain.handle('process:restart', (_event, projectId) => restartProject(projectId));
  ipcMain.handle('process:status', (_event, projectId) => getRuntimeStatus(projectId));
  ipcMain.handle('process:list-statuses', () => listRuntimeStatuses());
  ipcMain.handle('process:select-executable', () => selectExecutable(getMainWindow()));
  ipcMain.handle('terminal:get-history', (_event, projectId) => getOutputHistory(projectId));
  ipcMain.handle('terminal:clear', (_event, projectId) => clearOutput(projectId));
  ipcMain.handle('terminal:get-log', (_event, projectId) => readProjectLog(projectId));
  ipcMain.handle('terminal:clear-log', (_event, projectId) => clearProjectLog(projectId));
  ipcMain.handle('terminal:watch-log', (_event, projectId) => watchProjectLog(projectId));
  ipcMain.handle('terminal:unwatch-log', (_event, projectId) => stopLogWatch(projectId));
  ipcMain.handle('terminal:get-start-command', (_event, projectId) => getExternalStartCommand(projectId));
}

module.exports = {
  parseArgs,
  getExecutable,
  saveExecutable,
  startProject,
  stopProject,
  restartProject,
  getRuntimeStatus,
  listRuntimeStatuses,
  getOutputHistory,
  clearOutput,
  readProjectLog,
  clearProjectLog,
  watchProjectLog,
  stopLogWatch,
  getExternalStartCommand,
  appendOutput,
  markAppQuitting,
  registerProcessManagerIpc
};

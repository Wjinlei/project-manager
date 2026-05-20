const { spawn } = require('child_process');
const path = require('path');
const { getRepositories } = require('../database');

const runningProcesses = new Map();
const outputBuffers = new Map();
const MAX_OUTPUT_LINES = 1000;
let mainWindow;

function getMainWindow() {
  return typeof mainWindow === 'function' ? mainWindow() : mainWindow;
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

function getRuntimeStatus(projectId) {
  const runtime = runningProcesses.get(Number(projectId));
  if (!runtime) {
    return { running: false, pid: null };
  }
  return { running: true, pid: runtime.process.pid, startedAt: runtime.startedAt };
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

function startProject(projectId) {
  const id = Number(projectId);
  if (runningProcesses.has(id)) {
    return getRuntimeStatus(id);
  }

  const repositories = getRepositories();
  const project = repositories.projects.findById(id);
  if (!project) {
    throw new Error('项目不存在');
  }

  const executable = getExecutable(id);
  if (!executable || !executable.exec_path) {
    throw new Error('请先配置执行文件');
  }

  const workDir = executable.work_dir || project.path || path.dirname(executable.exec_path);
  const projectType = (project.type || '').toLowerCase();
  const ext = path.extname(executable.exec_path).toLowerCase();
  const args = parseArgs(executable.args);

  let spawnCmd, spawnArgs, needsShell = false;

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

  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workDir,
    shell: needsShell,
    windowsHide: false
  });

  runningProcesses.set(id, {
    process: child,
    startedAt: new Date().toISOString(),
    output: []
  });
  updateProjectStatus(id, 'running');

  child.stdout?.on('data', (chunk) => {
    const output = appendOutput(id, 'stdout', chunk.toString());
    getMainWindow()?.webContents.send('terminal:output', output);
  });

  child.stderr?.on('data', (chunk) => {
    const output = appendOutput(id, 'stderr', chunk.toString());
    getMainWindow()?.webContents.send('terminal:output', output);
  });

  child.on('error', (err) => {
    runningProcesses.delete(id);
    updateProjectStatus(id, 'error');
    getMainWindow()?.webContents.send('terminal:output', {
      projectId: id,
      type: 'stderr',
      data: `启动失败: ${err.message} (文件: ${executable.exec_path})`,
      time: new Date().toISOString()
    });
  });

  child.on('exit', (code) => {
    runningProcesses.delete(id);
    updateProjectStatus(id, code === 0 ? 'stopped' : 'error');
  });

  return getRuntimeStatus(id);
}

function stopProject(projectId) {
  const id = Number(projectId);
  const runtime = runningProcesses.get(id);
  if (!runtime) {
    updateProjectStatus(id, 'stopped');
    return { running: false, pid: null };
  }

  runtime.process.kill();
  runningProcesses.delete(id);
  updateProjectStatus(id, 'stopped');
  return { running: false, pid: null };
}

function restartProject(projectId) {
  stopProject(projectId);
  return startProject(projectId);
}

function listRuntimeStatuses() {
  return Array.from(runningProcesses.entries()).map(([projectId, runtime]) => ({
    projectId,
    pid: runtime.process.pid,
    startedAt: runtime.startedAt,
    running: true
  }));
}

function getOutputHistory(projectId) {
  return outputBuffers.get(Number(projectId)) || [];
}

function clearOutput(projectId) {
  outputBuffers.set(Number(projectId), []);
  return true;
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
  appendOutput,
  registerProcessManagerIpc
};

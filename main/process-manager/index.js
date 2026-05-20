const { spawn } = require('child_process');
const path = require('path');
const { getRepositories } = require('../database');

const runningProcesses = new Map();

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
  const child = spawn(executable.exec_path, parseArgs(executable.args), {
    cwd: workDir,
    shell: false,
    windowsHide: false
  });

  runningProcesses.set(id, {
    process: child,
    startedAt: new Date().toISOString(),
    output: []
  });
  updateProjectStatus(id, 'running');

  child.stdout?.on('data', (chunk) => {
    const runtime = runningProcesses.get(id);
    if (runtime) {
      runtime.output.push({ type: 'stdout', data: chunk.toString(), time: new Date().toISOString() });
    }
  });

  child.stderr?.on('data', (chunk) => {
    const runtime = runningProcesses.get(id);
    if (runtime) {
      runtime.output.push({ type: 'stderr', data: chunk.toString(), time: new Date().toISOString() });
    }
  });

  child.on('error', () => {
    runningProcesses.delete(id);
    updateProjectStatus(id, 'error');
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
  ipcMain.handle('process:get-executable', (_event, projectId) => getExecutable(projectId));
  ipcMain.handle('process:save-executable', (_event, projectId, payload) => saveExecutable(projectId, payload));
  ipcMain.handle('process:start', (_event, projectId) => startProject(projectId));
  ipcMain.handle('process:stop', (_event, projectId) => stopProject(projectId));
  ipcMain.handle('process:restart', (_event, projectId) => restartProject(projectId));
  ipcMain.handle('process:status', (_event, projectId) => getRuntimeStatus(projectId));
  ipcMain.handle('process:list-statuses', () => listRuntimeStatuses());
  ipcMain.handle('process:select-executable', () => selectExecutable(getMainWindow()));
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
  registerProcessManagerIpc
};

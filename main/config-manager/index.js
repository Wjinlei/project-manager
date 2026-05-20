const fs = require('fs');
const path = require('path');
const { getRepositories } = require('../database');

function listConfigs(projectId) {
  return getRepositories()
    .projectConfigs
    .findAll()
    .filter((config) => config.project_id === Number(projectId));
}

function getConfig(configId) {
  return getRepositories().projectConfigs.findById(Number(configId));
}

function createConfig(projectId, payload) {
  return getRepositories().projectConfigs.create({
    project_id: Number(projectId),
    name: payload.name,
    source_path: payload.source_path,
    target_path: payload.target_path,
    is_active: payload.is_active ? 1 : 0
  });
}

function updateConfig(configId, payload) {
  return getRepositories().projectConfigs.update(Number(configId), {
    name: payload.name,
    source_path: payload.source_path,
    target_path: payload.target_path,
    is_active: payload.is_active ? 1 : 0
  });
}

function deleteConfig(configId) {
  return getRepositories().projectConfigs.delete(Number(configId));
}

function previewConfig(configId) {
  const config = getConfig(configId);
  if (!config) {
    throw new Error('配置不存在');
  }
  return fs.readFileSync(config.source_path, 'utf8');
}

function backupTargetFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${targetPath}.${timestamp}.bak`;
  fs.copyFileSync(targetPath, backupPath);
  return backupPath;
}

function switchConfig(configId) {
  const repositories = getRepositories();
  const config = repositories.projectConfigs.findById(Number(configId));
  if (!config) {
    throw new Error('配置不存在');
  }
  if (!fs.existsSync(config.source_path)) {
    throw new Error('源配置文件不存在');
  }

  fs.mkdirSync(path.dirname(config.target_path), { recursive: true });
  const backupPath = backupTargetFile(config.target_path);
  fs.copyFileSync(config.source_path, config.target_path);

  listConfigs(config.project_id).forEach((item) => {
    repositories.projectConfigs.update(item.id, { is_active: item.id === config.id ? 1 : 0 });
  });

  return {
    config: repositories.projectConfigs.findById(config.id),
    backupPath
  };
}

function listBackups(configId) {
  const config = getConfig(configId);
  if (!config) {
    throw new Error('配置不存在');
  }
  const dir = path.dirname(config.target_path);
  const base = path.basename(config.target_path);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter((file) => file.startsWith(`${base}.`) && file.endsWith('.bak'))
    .map((file) => path.join(dir, file));
}

async function selectConfigFile(browserWindow) {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(browserWindow, {
    title: '选择配置文件',
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

function registerConfigManagerIpc(ipcMain, getMainWindow) {
  ipcMain.handle('configs:list', (_event, projectId) => listConfigs(projectId));
  ipcMain.handle('configs:create', (_event, projectId, payload) => createConfig(projectId, payload));
  ipcMain.handle('configs:update', (_event, configId, payload) => updateConfig(configId, payload));
  ipcMain.handle('configs:delete', (_event, configId) => deleteConfig(configId));
  ipcMain.handle('configs:preview', (_event, configId) => previewConfig(configId));
  ipcMain.handle('configs:switch', (_event, configId) => switchConfig(configId));
  ipcMain.handle('configs:list-backups', (_event, configId) => listBackups(configId));
  ipcMain.handle('configs:select-file', () => selectConfigFile(getMainWindow()));
}

module.exports = {
  listConfigs,
  getConfig,
  createConfig,
  updateConfig,
  deleteConfig,
  previewConfig,
  switchConfig,
  listBackups,
  registerConfigManagerIpc
};

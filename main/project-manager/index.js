const fs = require('fs');
const path = require('path');
const { getRepositories } = require('../database');
const { setProjectTags } = require('../tag-manager');

const PROJECT_TYPES = ['Go', 'Node', 'Python', 'Java', '.NET', 'PHP', 'HTML', 'Other'];

function fileExists(projectPath, fileName) {
  return fs.existsSync(path.join(projectPath, fileName));
}

function hasFileByExtension(projectPath, extensions) {
  return fs.readdirSync(projectPath, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile()) {
      return false;
    }
    return extensions.some((extension) => entry.name.toLowerCase().endsWith(extension));
  });
}

function detectProjectType(projectPath) {
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error('项目目录不存在');
  }

  if (fileExists(projectPath, 'go.mod')) return 'Go';
  if (fileExists(projectPath, 'package.json')) return 'Node';
  if (fileExists(projectPath, 'requirements.txt') || fileExists(projectPath, 'setup.py') || fileExists(projectPath, 'pyproject.toml')) return 'Python';
  if (fileExists(projectPath, 'pom.xml') || fileExists(projectPath, 'build.gradle')) return 'Java';
  if (hasFileByExtension(projectPath, ['.csproj', '.sln'])) return '.NET';
  if (fileExists(projectPath, 'composer.json')) return 'PHP';
  if (fileExists(projectPath, 'index.html')) return 'HTML';
  return 'Other';
}

function normalizeProjectPayload(payload) {
  const projectPath = payload.path ? path.normalize(payload.path) : '';
  const name = payload.name || path.basename(projectPath);
  const type = PROJECT_TYPES.includes(payload.type) ? payload.type : detectProjectType(projectPath);

  return {
    name,
    path: projectPath,
    type,
    status: payload.status || 'stopped',
    remark: payload.remark || null,
    updated_at: new Date().toISOString()
  };
}

function listProjects() {
  return getRepositories().projects.findAll();
}

function getProject(id) {
  return getRepositories().projects.findById(id);
}

function createProject(payload) {
  const repositories = getRepositories();
  const data = normalizeProjectPayload(payload);
  const project = repositories.projects.create(data);
  
  if (Array.isArray(payload.tag_ids) && payload.tag_ids.length > 0) {
    setProjectTags(project.id, payload.tag_ids);
  }
  
  return project;
}

function updateProject(id, payload) {
  const repositories = getRepositories();
  const current = repositories.projects.findById(id);
  if (!current) {
    throw new Error('项目不存在');
  }

  const nextPath = payload.path ? path.normalize(payload.path) : current.path;
  const data = {
    name: payload.name || current.name,
    path: nextPath,
    type: PROJECT_TYPES.includes(payload.type) ? payload.type : current.type,
    status: payload.status || current.status,
    remark: payload.remark ?? current.remark,
    updated_at: new Date().toISOString()
  };

  const project = repositories.projects.update(id, data);
  
  if (payload.tag_ids !== undefined) {
    setProjectTags(id, payload.tag_ids);
  }
  
  return project;
}

function deleteProject(id) {
  return getRepositories().projects.delete(id);
}

async function selectProjectDirectory(browserWindow) {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(browserWindow, {
    title: '选择项目目录',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  return {
    path: selectedPath,
    name: path.basename(selectedPath),
    type: detectProjectType(selectedPath)
  };
}

function registerProjectManagerIpc(ipcMain, getMainWindow) {
  ipcMain.handle('projects:list', () => listProjects());
  ipcMain.handle('projects:get', (_event, id) => getProject(id));
  ipcMain.handle('projects:create', (_event, payload) => createProject(payload));
  ipcMain.handle('projects:update', (_event, id, payload) => updateProject(id, payload));
  ipcMain.handle('projects:delete', (_event, id) => deleteProject(id));
  ipcMain.handle('projects:detect-type', (_event, projectPath) => detectProjectType(projectPath));
  ipcMain.handle('projects:select-directory', () => selectProjectDirectory(getMainWindow()));
}

module.exports = {
  PROJECT_TYPES,
  detectProjectType,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  selectProjectDirectory,
  registerProjectManagerIpc
};

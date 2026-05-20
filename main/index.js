const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initializeDatabase, closeDatabase } = require('./database');
const { registerProjectManagerIpc } = require('./project-manager');
const { registerProcessManagerIpc } = require('./process-manager');
const { registerConfigManagerIpc } = require('./config-manager');
const { registerWorkflowManagerIpc } = require('./workflow-manager');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f1f1f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  initializeDatabase();
  registerProjectManagerIpc(ipcMain, () => mainWindow);
  registerProcessManagerIpc(ipcMain, () => mainWindow);
  registerConfigManagerIpc(ipcMain, () => mainWindow);
  registerWorkflowManagerIpc(ipcMain, () => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('navigation:get-pages', () => [
  { id: 'dashboard', title: '首页' },
  { id: 'projects', title: '项目管理' },
  { id: 'workflows', title: '流程编排' },
  { id: 'scheduler', title: '计划任务' },
  { id: 'terminal', title: '终端' },
  { id: 'git', title: 'Git' }
]);

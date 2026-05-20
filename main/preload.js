const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('projectManager', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPages: () => ipcRenderer.invoke('navigation:get-pages'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    get: (id) => ipcRenderer.invoke('projects:get', id),
    create: (payload) => ipcRenderer.invoke('projects:create', payload),
    update: (id, payload) => ipcRenderer.invoke('projects:update', id, payload),
    delete: (id) => ipcRenderer.invoke('projects:delete', id),
    detectType: (projectPath) => ipcRenderer.invoke('projects:detect-type', projectPath),
    selectDirectory: () => ipcRenderer.invoke('projects:select-directory')
  }
});

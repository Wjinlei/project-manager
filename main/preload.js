const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('projectManager', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPages: () => ipcRenderer.invoke('navigation:get-pages')
});

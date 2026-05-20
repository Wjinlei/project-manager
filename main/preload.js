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
  },
  process: {
    getExecutable: (projectId) => ipcRenderer.invoke('process:get-executable', projectId),
    saveExecutable: (projectId, payload) => ipcRenderer.invoke('process:save-executable', projectId, payload),
    start: (projectId) => ipcRenderer.invoke('process:start', projectId),
    stop: (projectId) => ipcRenderer.invoke('process:stop', projectId),
    restart: (projectId) => ipcRenderer.invoke('process:restart', projectId),
    status: (projectId) => ipcRenderer.invoke('process:status', projectId),
    listStatuses: () => ipcRenderer.invoke('process:list-statuses'),
    selectExecutable: () => ipcRenderer.invoke('process:select-executable')
  },
  terminal: {
    getHistory: (projectId) => ipcRenderer.invoke('terminal:get-history', projectId),
    clear: (projectId) => ipcRenderer.invoke('terminal:clear', projectId),
    getLog: (projectId) => ipcRenderer.invoke('terminal:get-log', projectId),
    clearLog: (projectId) => ipcRenderer.invoke('terminal:clear-log', projectId),
    watchLog: (projectId) => ipcRenderer.invoke('terminal:watch-log', projectId),
    unwatchLog: (projectId) => ipcRenderer.invoke('terminal:unwatch-log', projectId),
    getStartCommand: (projectId) => ipcRenderer.invoke('terminal:get-start-command', projectId),
    onOutput: (callback) => {
      const listener = (_event, output) => callback(output);
      ipcRenderer.on('terminal:output', listener);
      return () => ipcRenderer.removeListener('terminal:output', listener);
    },
    onLogOutput: (callback) => {
      const listener = (_event, output) => callback(output);
      ipcRenderer.on('terminal:log-output', listener);
      return () => ipcRenderer.removeListener('terminal:log-output', listener);
    }
  },
  configs: {
    list: (projectId) => ipcRenderer.invoke('configs:list', projectId),
    create: (projectId, payload) => ipcRenderer.invoke('configs:create', projectId, payload),
    update: (configId, payload) => ipcRenderer.invoke('configs:update', configId, payload),
    delete: (configId) => ipcRenderer.invoke('configs:delete', configId),
    preview: (configId) => ipcRenderer.invoke('configs:preview', configId),
    switch: (configId) => ipcRenderer.invoke('configs:switch', configId),
    listBackups: (configId) => ipcRenderer.invoke('configs:list-backups', configId),
    selectFile: () => ipcRenderer.invoke('configs:select-file')
  },
  workflows: {
    list: (projectId) => ipcRenderer.invoke('workflows:list', projectId),
    create: (payload) => ipcRenderer.invoke('workflows:create', payload),
    update: (workflowId, payload) => ipcRenderer.invoke('workflows:update', workflowId, payload),
    delete: (workflowId) => ipcRenderer.invoke('workflows:delete', workflowId),
    createStep: (workflowId, payload) => ipcRenderer.invoke('workflow-steps:create', workflowId, payload),
    updateStep: (stepId, payload) => ipcRenderer.invoke('workflow-steps:update', stepId, payload),
    deleteStep: (stepId) => ipcRenderer.invoke('workflow-steps:delete', stepId),
    execute: (workflowId, options) => ipcRenderer.invoke('workflows:execute', workflowId, options),
    stop: (workflowId) => ipcRenderer.invoke('workflows:stop', workflowId),
    status: (workflowId) => ipcRenderer.invoke('workflows:status', workflowId),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('workflow:status', listener);
      return () => ipcRenderer.removeListener('workflow:status', listener);
    }
  }
});

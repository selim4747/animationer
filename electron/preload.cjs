const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dioramaDesktop', Object.freeze({
  saveGeneratedFile: (file) => ipcRenderer.invoke('files:save-generated', file),
}));

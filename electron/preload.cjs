const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dioramaDesktop', Object.freeze({
  saveGeneratedFile: (file) => ipcRenderer.invoke('files:save-generated', file),
  beginGeneratedFile: (file) => ipcRenderer.invoke('files:save-generated-begin', file),
  writeGeneratedFileChunk: (sessionId, data) => ipcRenderer.invoke('files:save-generated-write', sessionId, data),
  finishGeneratedFile: (sessionId) => ipcRenderer.invoke('files:save-generated-finish', sessionId),
  abortGeneratedFile: (sessionId) => ipcRenderer.invoke('files:save-generated-abort', sessionId),
}));

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectPdf: () => ipcRenderer.invoke('select-pdf'),
  readPdfFile: (filePath) => ipcRenderer.invoke('read-pdf-file', filePath),
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  getFileName: (filePath) => ipcRenderer.invoke('get-file-name', filePath)
});

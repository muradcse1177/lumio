'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keygen', {
  generate: (requestCode, tier) => ipcRenderer.invoke('generate', requestCode, tier),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
});

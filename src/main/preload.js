'use strict';
/* preload.js — the only bridge between the UI and the privileged main process. */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lumio', {
  /* frameless window controls */
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
  },

  /* licence / activation */
  license: {
    status: () => ipcRenderer.invoke('license:status'),
    requestCode: () => ipcRenderer.invoke('license:requestCode'),
    activate: (code) => ipcRenderer.invoke('license:activate', code),
  },

  /* studio */
  meta: () => ipcRenderer.invoke('app:meta'),
  presets: () => ipcRenderer.invoke('app:presets'),
  gpu: () => ipcRenderer.invoke('app:gpu'),
  pickVideo: () => ipcRenderer.invoke('app:pickVideo'),
  videoInfo: (filePath) => ipcRenderer.invoke('app:videoInfo', filePath),
  pickOutputDir: () => ipcRenderer.invoke('app:pickOutputDir'),
  render: (opts) => ipcRenderer.invoke('app:render', opts),
  cancel: () => ipcRenderer.send('app:cancel'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  showItem: (p) => ipcRenderer.invoke('app:showItem', p),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  /* resolve the absolute path of a drag-dropped file */
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },

  /* render progress stream */
  onRenderEvent: (cb) => {
    const fn = (e, msg) => cb(msg);
    ipcRenderer.on('render:event', fn);
    return () => ipcRenderer.removeListener('render:event', fn);
  },

  /* auto-update stream */
  onUpdateEvent: (cb) => {
    const fn = (e, msg) => cb(msg);
    ipcRenderer.on('update:event', fn);
    return () => ipcRenderer.removeListener('update:event', fn);
  },
  installUpdate: () => ipcRenderer.send('update:install'),
});

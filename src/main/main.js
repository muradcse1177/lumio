'use strict';
/*
 * main.js — Lumio (Electron main process).
 * Decides which screen to show based on licence state, wires every IPC bridge.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const license = require('./license');
const presets = require('./presets');
const ffmpeg = require('./ffmpeg');

const RENDERER = path.join(__dirname, '..', 'renderer');
let win = null;

/* Single-instance lock — only one copy runs at a time. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function pageFor(state) {
  return state === 'active' ? 'index.html' : 'activation.html';
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 680,
    frame: false,
    backgroundColor: '#0a1230',
    title: 'Lumio',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const status = license.getStatus();
  win.loadFile(path.join(RENDERER, pageFor(status.state)));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  license.init(app.getPath('userData'));
  createWindow();
  initAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

/* ============================== auto-update ============================== */
/* On launch, quietly check GitHub Releases; download in the background and
   tell the renderer when a new version is ready to install. */
function sendUpdate(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('update:event', msg);
}

function initAutoUpdate() {
  if (!app.isPackaged) return; // the updater only works in a packaged build
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String((err && err.message) || err) }));
  autoUpdater.checkForUpdates().catch(() => { /* offline — ignore */ });
}

ipcMain.on('update:install', () => {
  try { autoUpdater.quitAndInstall(); } catch (e) { /* ignore */ }
});

/* ============================ window controls ============================ */
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win:close', () => win && win.close());

/* ================================ licence ================================ */
ipcMain.handle('license:status', () => license.getStatus());
ipcMain.handle('license:requestCode', () => license.getRequestCode());
ipcMain.handle('license:activate', (e, code) => {
  const res = license.activate(code);
  if (res.ok && win) win.loadFile(path.join(RENDERER, 'index.html'));
  return res;
});

/* ================================ studio ================================= */
ipcMain.handle('app:meta', () => ({
  version: app.getVersion(),
  presetCount: presets.count(),
}));

ipcMain.handle('app:presets', () => presets.list());

ipcMain.handle('app:gpu', async () => {
  const g = await ffmpeg.detectGpu();
  return { type: g.type, label: g.label };
});

ipcMain.handle('app:pickVideo', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select a video',
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'ts'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:pickAudio', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select an audio track',
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:videoInfo', async (e, filePath) => {
  const [info, thumb] = await Promise.all([
    ffmpeg.probeInfo(filePath),
    ffmpeg.thumbnail(filePath),
  ]);
  return { path: filePath, name: path.basename(filePath), info, thumb };
});

ipcMain.handle('app:pickOutputDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:render', (e, opts) => {
  return ffmpeg.renderBatch(opts, (msg) => {
    if (win && !win.isDestroyed()) win.webContents.send('render:event', msg);
  });
});

ipcMain.on('app:cancel', () => ffmpeg.cancelAll());

ipcMain.handle('app:openPath', (e, p) => shell.openPath(p));
ipcMain.handle('app:showItem', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:openExternal', (e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

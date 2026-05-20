'use strict';
/* Resolves bundled-resource paths for both dev and packaged builds.
   Pure Node — no electron require, so it is safe to load at any time. */
const path = require('path');

// `process.defaultApp` is set only while running unpackaged (electron .).
const packaged = !process.defaultApp;

// dev: <project>/resources/  •  prod: extraResources land in resourcesPath
const RES = packaged
  ? process.resourcesPath
  : path.join(__dirname, '..', '..', 'resources');

module.exports = {
  packaged,
  RES,
  presetsFile: path.join(RES, 'presets.json'),
  ffmpeg: path.join(RES, 'ffmpeg', 'ffmpeg.exe'),
  // ffmpeg runs with this as cwd so preset paths like "aud/bg3.mp4" resolve.
  audCwd: RES,
};

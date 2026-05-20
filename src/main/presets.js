'use strict';
/* Loads the 96 extracted FFmpeg effect presets from presets.json. */
const fs = require('fs');
const { presetsFile } = require('./paths');

let _data = null;

function load() {
  if (_data) return _data;
  _data = JSON.parse(fs.readFileSync(presetsFile, 'utf8'));
  return _data;
}

/* Light list for the UI (no heavy args array). */
function list() {
  return load().presets.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category, // METHOD | TRANSFORM
    mode: p.mode,         // REPEAT | PRELOAD | OTHER
    bgTrack: p.bgTrack,
  }));
}

function get(id) {
  return load().presets.find((p) => p.id === id) || null;
}

function count() {
  return load().presets.length;
}

module.exports = { load, list, get, count };

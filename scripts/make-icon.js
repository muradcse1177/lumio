'use strict';
/*
 * make-icon.js — builds assets/icon.ico (navy tile + amber "N") with the
 * bundled FFmpeg, then packs a multi-size PNG icon. No image libraries.
 *
 *   node scripts/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FF = path.join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe');
const ASSETS = path.join(ROOT, 'assets');
const FONT_SRC = 'C:\\Windows\\Fonts\\arialbd.ttf';
const FONT_TMP = path.join(ASSETS, '_font.ttf');
const SIZES = [256, 128, 64, 48, 32, 16];

fs.mkdirSync(ASSETS, { recursive: true });
fs.copyFileSync(FONT_SRC, FONT_TMP); // colon-free relative path for ffmpeg

function renderPng(size) {
  const fontSize = Math.round(size * 0.6);
  const out = path.join(ASSETS, '_ico_' + size + '.png');
  const vf =
    'drawbox=x=0:y=0:w=' + size + ':h=' + size + ':color=0x04107C@1:t=fill,' +
    'drawtext=fontfile=_font.ttf:text=N:fontcolor=0xf59e0b:' +
    'fontsize=' + fontSize + ':x=(w-text_w)/2:y=(h-text_h)/2-' + Math.round(size * 0.06);
  const r = spawnSync(FF, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x030B52:s=' + size + 'x' + size,
    '-vf', vf, '-frames:v', '1', out,
  ], { cwd: ASSETS, encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    throw new Error('ffmpeg failed for ' + size + ': ' + (r.stderr || r.error));
  }
  return fs.readFileSync(out);
}

/* pack PNG buffers into a single .ico (PNG-compressed entries, Vista+) */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(count, 4);  // image count

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    dir.writeUInt8(0, e + 2);              // palette
    dir.writeUInt8(0, e + 3);              // reserved
    dir.writeUInt16LE(1, e + 4);           // colour planes
    dir.writeUInt16LE(32, e + 6);          // bits per pixel
    dir.writeUInt32LE(img.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((x) => x.data)]);
}

try {
  const images = SIZES.map((size) => ({ size, data: renderPng(size) }));
  const ico = buildIco(images);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
  fs.copyFileSync(path.join(ASSETS, '_ico_256.png'), path.join(ASSETS, 'icon.png'));

  // keygen shares the same icon
  fs.copyFileSync(path.join(ASSETS, 'icon.ico'), path.join(ROOT, 'tools', 'keygen', 'icon.ico'));

  console.log('icon.ico built — ' + SIZES.join(', ') + ' px  (' + ico.length + ' bytes)');
} finally {
  // tidy temp files
  for (const f of fs.readdirSync(ASSETS)) {
    if (f.startsWith('_ico_') || f === '_font.ttf') fs.unlinkSync(path.join(ASSETS, f));
  }
}

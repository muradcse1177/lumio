'use strict';
/*
 * add-effects.js — appends the extra Color / Stylize / Speed / Format effects
 * to resources/presets.json. Idempotent: re-running first removes any
 * previously-added effects of these categories, then re-adds them.
 *
 *   node scripts/add-effects.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'resources', 'presets.json');
const NEW_CATS = ['COLOR', 'STYLIZE', 'SPEED', 'FORMAT'];

/* effect definitions ------------------------------------------------------ */
const FX = [
  /* --- Color & Look --- */
  { id: 'Grayscale',       cat: 'COLOR', type: 'vf', f: 'hue=s=0' },
  { id: 'Sepia',           cat: 'COLOR', type: 'vf', f: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131' },
  { id: 'Vintage',         cat: 'COLOR', type: 'vf', f: 'curves=preset=vintage' },
  { id: 'Black & White',   cat: 'COLOR', type: 'vf', f: 'hue=s=0,eq=contrast=1.35' },
  { id: 'Vibrant',         cat: 'COLOR', type: 'vf', f: 'eq=saturation=1.6:contrast=1.08' },
  { id: 'Warm Tone',       cat: 'COLOR', type: 'vf', f: 'colortemperature=temperature=4200' },
  { id: 'Cool Tone',       cat: 'COLOR', type: 'vf', f: 'colortemperature=temperature=9000' },
  { id: 'Cinematic',       cat: 'COLOR', type: 'vf', f: 'colorbalance=rs=-0.08:bs=0.08:rh=0.10:bh=-0.08,eq=contrast=1.08:saturation=1.05' },
  { id: 'Faded Film',      cat: 'COLOR', type: 'vf', f: 'eq=contrast=0.82:brightness=0.06:saturation=0.90' },
  { id: 'Moody Dark',      cat: 'COLOR', type: 'vf', f: 'eq=brightness=-0.06:contrast=1.22:saturation=0.82' },

  /* --- Stylize FX --- */
  { id: 'Vignette',        cat: 'STYLIZE', type: 'vf', f: 'vignette' },
  { id: 'Film Grain',      cat: 'STYLIZE', type: 'vf', f: 'noise=alls=18:allf=t' },
  { id: 'VHS Retro',       cat: 'STYLIZE', type: 'vf', f: 'noise=alls=20:allf=t,eq=saturation=1.3:contrast=1.1,curves=preset=vintage' },
  { id: 'Soft Glow',       cat: 'STYLIZE', type: 'fc', f: '[0:v]split[a][b];[b]gblur=sigma=9[bl];[a][bl]blend=all_mode=screen:all_opacity=0.5[v]' },
  { id: 'Dreamy Blur',     cat: 'STYLIZE', type: 'vf', f: 'gblur=sigma=4' },
  { id: 'Sharpen',         cat: 'STYLIZE', type: 'vf', f: 'unsharp=5:5:1.2' },
  { id: 'Pixelate',        cat: 'STYLIZE', type: 'vf', f: 'pixelize=w=20:h=20' },
  { id: 'Sketch',          cat: 'STYLIZE', type: 'vf', f: 'edgedetect=mode=colormix:high=0.4' },
  { id: 'Negative',        cat: 'STYLIZE', type: 'vf', f: 'negate' },
  { id: 'Mirror',          cat: 'STYLIZE', type: 'fc', f: '[0:v]crop=iw/2:ih:0:0,split[l][r];[r]hflip[rf];[l][rf]hstack[v]' },

  /* --- Speed --- */
  { id: 'Slow Motion 2x',  cat: 'SPEED', type: 'speed', vf: 'setpts=2.0*PTS',  af: 'atempo=0.5' },
  { id: 'Slow Motion 4x',  cat: 'SPEED', type: 'speed', vf: 'setpts=4.0*PTS',  af: 'atempo=0.5,atempo=0.5' },
  { id: 'Fast Forward 2x', cat: 'SPEED', type: 'speed', vf: 'setpts=0.5*PTS',  af: 'atempo=2.0' },
  { id: 'Reverse',         cat: 'SPEED', type: 'speed', vf: 'reverse',          af: 'areverse' },

  /* --- Format / Crop --- */
  { id: 'Reels 9:16',      cat: 'FORMAT', type: 'vf', f: "crop=ih*9/16:ih,scale='trunc(iw/2)*2':'trunc(ih/2)*2'" },
  { id: 'Square 1:1',      cat: 'FORMAT', type: 'vf', f: "crop=ih:ih" },
  { id: 'Widescreen 16:9', cat: 'FORMAT', type: 'vf', f: "crop=iw:iw*9/16,scale='trunc(iw/2)*2':'trunc(ih/2)*2'" },
  { id: 'Portrait 4:5',    cat: 'FORMAT', type: 'vf', f: "crop=ih*4/5:ih,scale='trunc(iw/2)*2':'trunc(ih/2)*2'" },
];

const VENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '30'];

function buildArgs(fx) {
  if (fx.type === 'vf') {
    return ['-y', '-i', '{INPUT}', '-vf', fx.f].concat(VENC, ['-c:a', 'copy', '{OUTPUT}']);
  }
  if (fx.type === 'fc') {
    return ['-y', '-i', '{INPUT}', '-filter_complex', fx.f, '-map', '[v]', '-map', '0:a?']
      .concat(VENC, ['-c:a', 'copy', '{OUTPUT}']);
  }
  // speed — video re-timed, audio tempo-matched
  return ['-y', '-i', '{INPUT}', '-filter_complex',
    '[0:v]' + fx.vf + '[v];[0:a]' + fx.af + '[a]', '-map', '[v]', '-map', '[a]']
    .concat(VENC, ['-c:a', 'aac', '-b:a', '128k', '{OUTPUT}']);
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// drop previously-added effects so the script is idempotent
data.presets = data.presets.filter((p) => NEW_CATS.indexOf(p.category) === -1);
const legacyCount = data.presets.length;

for (const fx of FX) {
  data.presets.push({
    id: fx.id,
    name: fx.id,
    category: fx.cat,
    mode: 'OTHER',
    bgTrack: null,
    args: buildArgs(fx),
  });
}
data.count = data.presets.length;

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log('legacy effects: ' + legacyCount + '  +  new effects: ' + FX.length +
  '  =  ' + data.count + ' total');

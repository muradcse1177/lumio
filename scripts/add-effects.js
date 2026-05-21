'use strict';
/*
 * add-effects.js — appends the extra Lumio effects (Color / Stylize / Speed /
 * Format / Audio / extra Method & Transform) to resources/presets.json.
 * Idempotent: every added preset carries a `lumioNew` flag; re-running first
 * drops all flagged presets, then re-adds them — the original 96 are untouched.
 *
 *   node scripts/add-effects.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'resources', 'presets.json');

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
  { id: 'Teal & Orange',   cat: 'COLOR', type: 'vf', f: 'colorbalance=rs=-0.12:bs=0.12:rh=0.14:bh=-0.12,eq=saturation=1.10' },
  { id: 'Cyberpunk',       cat: 'COLOR', type: 'vf', f: 'colorbalance=rs=0.12:bs=0.20:bh=0.12,eq=saturation=1.50:contrast=1.12' },
  { id: 'Golden Hour',     cat: 'COLOR', type: 'vf', f: 'colortemperature=temperature=3600,eq=saturation=1.12:brightness=0.04' },
  { id: 'Noir',            cat: 'COLOR', type: 'vf', f: 'hue=s=0,eq=contrast=1.50:brightness=-0.05' },
  { id: 'Dramatic',        cat: 'COLOR', type: 'vf', f: 'eq=contrast=1.32:saturation=1.18:brightness=-0.03' },
  { id: 'Pastel',          cat: 'COLOR', type: 'vf', f: 'eq=saturation=0.70:brightness=0.08:contrast=0.92' },
  { id: 'Cross Process',   cat: 'COLOR', type: 'vf', f: 'curves=preset=cross_process' },
  { id: 'Autumn',          cat: 'COLOR', type: 'vf', f: 'colorbalance=rh=0.12:gh=0.04:bh=-0.10,eq=saturation=1.18' },

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
  { id: 'Chromatic Aberration', cat: 'STYLIZE', type: 'vf', f: 'rgbashift=rh=5:bh=-5:gv=3' },
  { id: 'Emboss',          cat: 'STYLIZE', type: 'vf', f: "convolution='-2 -1 0 -1 1 1 0 1 2:0 0 0 0 1 0 0 0 0:0 0 0 0 1 0 0 0 0'" },
  { id: 'Thermal',         cat: 'STYLIZE', type: 'vf', f: 'format=gray,pseudocolor=preset=turbo' },
  { id: 'Motion Trail',    cat: 'STYLIZE', type: 'vf', f: 'tmix=frames=6' },
  { id: 'Heavy Blur',      cat: 'STYLIZE', type: 'vf', f: 'boxblur=10:2' },
  { id: 'Old TV',          cat: 'STYLIZE', type: 'vf', f: 'noise=alls=12:allf=t,curves=preset=vintage,vignette' },

  /* --- Speed --- */
  { id: 'Slow Motion 2x',  cat: 'SPEED', type: 'speed', vf: 'setpts=2.0*PTS',  af: 'atempo=0.5' },
  { id: 'Slow Motion 4x',  cat: 'SPEED', type: 'speed', vf: 'setpts=4.0*PTS',  af: 'atempo=0.5,atempo=0.5' },
  { id: 'Slow Motion 8x',  cat: 'SPEED', type: 'speed', vf: 'setpts=8.0*PTS',  af: 'atempo=0.5,atempo=0.5,atempo=0.5' },
  { id: 'Fast Forward 2x', cat: 'SPEED', type: 'speed', vf: 'setpts=0.5*PTS',  af: 'atempo=2.0' },
  { id: 'Fast Forward 4x', cat: 'SPEED', type: 'speed', vf: 'setpts=0.25*PTS', af: 'atempo=2.0,atempo=2.0' },
  { id: 'Reverse',         cat: 'SPEED', type: 'speed', vf: 'reverse',          af: 'areverse' },
  { id: 'Boomerang',       cat: 'SPEED', type: 'fcav', f: '[0:v]split[v1][v2];[v2]reverse[v2r];[v1][v2r]concat=n=2:v=1:a=0[v];[0:a]asplit[a1][a2];[a2]areverse[a2r];[a1][a2r]concat=n=2:v=0:a=1[a]' },

  /* --- Format / Crop --- */
  { id: 'Reels 9:16',      cat: 'FORMAT', type: 'vf', f: "crop=ih*9/16:ih,scale='trunc(iw/2)*2':'trunc(ih/2)*2'" },
  { id: 'Square 1:1',      cat: 'FORMAT', type: 'vf', f: 'crop=ih:ih' },
  { id: 'Widescreen 16:9', cat: 'FORMAT', type: 'vf', f: "crop=iw:iw*9/16,scale='trunc(iw/2)*2':'trunc(ih/2)*2'" },
  { id: 'Portrait 4:5',    cat: 'FORMAT', type: 'vf', f: "crop=ih*4/5:ih,scale='trunc(iw/2)*2':'trunc(ih/2)*2'" },
  { id: 'Cinematic Bars',  cat: 'FORMAT', type: 'vf', f: 'drawbox=x=0:y=0:w=iw:h=ih*0.11:color=black:t=fill,drawbox=x=0:y=ih*0.89:w=iw:h=ih*0.11:color=black:t=fill' },

  /* --- Audio FX --- */
  { id: 'Bass Boost',        cat: 'AUDIO', type: 'af', f: 'bass=g=12' },
  { id: 'Treble Boost',      cat: 'AUDIO', type: 'af', f: 'treble=g=10' },
  { id: 'Volume Up',         cat: 'AUDIO', type: 'af', f: 'volume=2.0' },
  { id: 'Volume Down',       cat: 'AUDIO', type: 'af', f: 'volume=0.5' },
  { id: 'Echo',              cat: 'AUDIO', type: 'af', f: 'aecho=0.8:0.9:1000:0.3' },
  { id: 'Reverb',            cat: 'AUDIO', type: 'af', f: 'aecho=0.85:0.9:50|70|90:0.4|0.3|0.2' },
  { id: 'Pitch Up',          cat: 'AUDIO', type: 'af', f: 'aformat=sample_rates=44100,asetrate=66150,aresample=44100,atempo=0.667' },
  { id: 'Pitch Down',        cat: 'AUDIO', type: 'af', f: 'aformat=sample_rates=44100,asetrate=30870,aresample=44100,atempo=1.43' },
  { id: 'Audio Fade In/Out', cat: 'AUDIO', type: 'af', f: 'afade=t=in:d=1.5,areverse,afade=t=in:d=1.5,areverse' },
  { id: 'Normalize Audio',   cat: 'AUDIO', type: 'af', f: 'dynaudnorm' },
  { id: 'Noise Reduction',   cat: 'AUDIO', type: 'af', f: 'afftdn=nr=12' },
  { id: 'Surround 8D',       cat: 'AUDIO', type: 'af', f: 'apulsator=hz=0.08' },
  { id: 'Telephone',         cat: 'AUDIO', type: 'af', f: 'highpass=f=400,lowpass=f=3400' },
  { id: 'Lo-fi Radio',       cat: 'AUDIO', type: 'af', f: 'highpass=f=300,lowpass=f=5000,acompressor' },
  { id: 'Vintage Audio',     cat: 'AUDIO', type: 'af', f: 'highpass=f=200,lowpass=f=8000,aecho=0.6:0.5:30:0.2' },
  { id: 'Mute (No Sound)',   cat: 'AUDIO', type: 'mute' },

  /* --- extra Transform (geometry) --- */
  { id: 'Flip Vertical',   cat: 'TRANSFORM', type: 'vf', f: 'vflip' },
  { id: 'Flip 180',        cat: 'TRANSFORM', type: 'vf', f: 'hflip,vflip' },
  { id: 'Rotate Right 90', cat: 'TRANSFORM', type: 'vf', f: 'transpose=1' },
  { id: 'Rotate Left 90',  cat: 'TRANSFORM', type: 'vf', f: 'transpose=2' },
  { id: 'Punch In Zoom',   cat: 'TRANSFORM', type: 'vf', f: 'scale=2*trunc(iw*1.3/2):2*trunc(ih*1.3/2),crop=2*trunc(iw/1.3/2):2*trunc(ih/1.3/2)' },
  { id: 'Mirror Vertical', cat: 'TRANSFORM', type: 'fc', f: '[0:v]crop=iw:ih/2:0:0,split[t][b];[b]vflip[bf];[t][bf]vstack[v]' },

  /* --- extra Method (motion) --- */
  { id: 'Camera Shake',    cat: 'METHOD', type: 'vf', f: 'crop=iw-40:ih-40:20+12*sin(t*40):20+12*sin(t*37),scale=iw+40:ih+40' },
  { id: 'Slow Drift',      cat: 'METHOD', type: 'vf', f: 'crop=iw-120:ih:60+58*sin(t*0.25):0,scale=iw+120:ih' },
  { id: 'Spin',            cat: 'METHOD', type: 'vf', f: 'rotate=a=t*0.6:c=black' },
  { id: 'Slow Spin',       cat: 'METHOD', type: 'vf', f: 'rotate=a=t*0.15:c=black' },
  { id: 'Wobble',          cat: 'METHOD', type: 'vf', f: 'crop=iw-30:ih-30:15+13*sin(t*3):15+13*sin(t*2.3),scale=iw+30:ih+30' },
  { id: 'Vertical Pan',    cat: 'METHOD', type: 'vf', f: 'crop=iw:ih-120:0:60+58*sin(t*0.3),scale=iw:ih+120' },
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
  if (fx.type === 'fcav') {
    return ['-y', '-i', '{INPUT}', '-filter_complex', fx.f, '-map', '[v]', '-map', '[a]']
      .concat(VENC, ['-c:a', 'aac', '-b:a', '128k', '{OUTPUT}']);
  }
  if (fx.type === 'af') {
    // audio-only — video copied through untouched
    return ['-y', '-i', '{INPUT}', '-c:v', 'copy', '-af', fx.f, '-c:a', 'aac', '-b:a', '192k', '{OUTPUT}'];
  }
  if (fx.type === 'mute') {
    return ['-y', '-i', '{INPUT}', '-c:v', 'copy', '-an', '{OUTPUT}'];
  }
  // speed — video re-timed, audio tempo-matched
  return ['-y', '-i', '{INPUT}', '-filter_complex',
    '[0:v]' + fx.vf + '[v];[0:a]' + fx.af + '[a]', '-map', '[v]', '-map', '[a]']
    .concat(VENC, ['-c:a', 'aac', '-b:a', '128k', '{OUTPUT}']);
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// keep ONLY the original 96 legacy effects (each bundles a bgTrack);
// drop every previously-added effect so the script is fully idempotent
data.presets = data.presets.filter((p) => !!p.bgTrack);
const legacyCount = data.presets.length;

for (const fx of FX) {
  data.presets.push({
    id: fx.id,
    name: fx.id,
    category: fx.cat,
    mode: 'OTHER',
    bgTrack: null,
    lumioNew: true,
    args: buildArgs(fx),
  });
}
data.count = data.presets.length;

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log('legacy effects: ' + legacyCount + '  +  new effects: ' + FX.length +
  '  =  ' + data.count + ' total');

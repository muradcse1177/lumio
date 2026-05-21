'use strict';
/*
 * ffmpeg.js — the render engine.
 * --------------------------------------------------------------------------
 *  - Detects a usable hardware encoder (NVIDIA NVENC / Intel QSV) once, with
 *    a real test-encode; falls back to CPU libx264 otherwise.
 *  - Each preset's FFmpeg args are kept verbatim (output matches the legacy
 *    tool); for GPU only the encoder / preset / quality flags are swapped.
 *  - Runs the selected effects through a small concurrency pool. A GPU job
 *    that fails is automatically retried on CPU so a render never gets stuck.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('./paths');
const presets = require('./presets');

const activeProcs = new Set();
let cancelled = false;
let gpuCache = null;

/* ------------------------------------------------------------------ utils */
function runCapture(bin, args, timeout = 25000) {
  return new Promise((resolve, reject) => {
    let proc;
    try { proc = spawn(bin, args); }
    catch (e) { return reject(e); }
    let out = '';
    const to = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} reject(new Error('timeout')); }, timeout);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('error', (e) => { clearTimeout(to); reject(e); });
    proc.on('close', (code) => { clearTimeout(to); code === 0 ? resolve(out) : reject(new Error('exit ' + code + '\n' + out)); });
  });
}

function sanitize(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
}

/* ----------------------------------------------------------- GPU detection */
async function detectGpu() {
  if (gpuCache) return gpuCache;
  let encoders = '';
  try { encoders = await runCapture(paths.ffmpeg, ['-hide_banner', '-encoders']); } catch (e) {}

  const candidates = [];
  if (encoders.includes('h264_nvenc')) candidates.push({ type: 'nvenc', enc: 'h264_nvenc', label: 'NVIDIA NVENC (GPU)' });
  if (encoders.includes('h264_qsv')) candidates.push({ type: 'qsv', enc: 'h264_qsv', label: 'Intel Quick Sync (GPU)' });

  for (const c of candidates) {
    try {
      await runCapture(paths.ffmpeg, [
        '-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=1',
        '-frames:v', '1', '-c:v', c.enc, '-f', 'null', '-',
      ], 18000);
      gpuCache = c;
      return gpuCache;
    } catch (e) { /* encoder listed but unusable — try next */ }
  }
  gpuCache = { type: 'cpu', enc: 'libx264', label: 'CPU — libx264 (no GPU detected)' };
  return gpuCache;
}

/* --------------------------------------------------- preset -> ffmpeg args */
/* Swap the codec flags for a hardware encoder; filters stay untouched. */
function applyEncoder(args, gpu) {
  if (gpu.type === 'cpu') return args.slice();
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-vcodec' || a === '-c:v') && args[i + 1] === 'libx264') {
      out.push('-c:v', gpu.enc); i++; continue;
    }
    if (a === '-preset') {
      out.push('-preset', gpu.type === 'nvenc' ? 'p4' : 'veryfast'); i++; continue;
    }
    if (a === '-crf') {
      out.push(gpu.type === 'nvenc' ? '-cq' : '-global_quality', args[i + 1]); i++; continue;
    }
    out.push(a);
  }
  return out;
}

function buildArgs(preset, input, output, gpu) {
  let args = preset.args.map((a) => {
    if (a === '{INPUT}') return input;
    if (a === '{OUTPUT}') return output;
    return a;
  });
  args = applyEncoder(args, gpu);
  // progress goes to stdout; banner / live stats suppressed
  return ['-hide_banner', '-progress', 'pipe:1', '-nostats'].concat(args);
}

/* --------------------------------------------------------------- probing  */
/* `ffmpeg -i <file>` with no output prints the media info to stderr — we
   parse that, so no separate ffprobe binary needs to ship. */
function ffmpegInspect(file) {
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn(paths.ffmpeg, ['-hide_banner', '-i', file]); }
    catch (e) { return resolve(''); }
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', () => resolve(''));
    proc.on('close', () => resolve(err));
  });
}

function parseDuration(text) {
  const m = String(text).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : 0;
}

async function probeDuration(file) {
  return parseDuration(await ffmpegInspect(file));
}

/* ------------------------------------------------------------- single job */
function runJob(job, gpu, onProgress) {
  return new Promise((resolve) => {
    const args = buildArgs(job.preset, job.input, job.output, gpu);
    let proc;
    try { proc = spawn(paths.ffmpeg, args, { cwd: paths.audCwd }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }

    activeProcs.add(proc);
    let err = '';

    proc.stdout.on('data', (d) => {
      const matches = String(d).match(/out_time_us=(\d+)/g);
      if (matches && job.duration > 0) {
        const us = parseInt(matches[matches.length - 1].split('=')[1], 10);
        const pct = Math.max(0, Math.min(99, (us / 1e6 / job.duration) * 100));
        onProgress(pct);
      }
    });
    proc.stderr.on('data', (d) => { err += d; if (err.length > 6000) err = err.slice(-6000); });

    proc.on('error', (e) => { activeProcs.delete(proc); resolve({ ok: false, error: e.message }); });
    proc.on('close', (code) => {
      activeProcs.delete(proc);
      if (code === 0) return resolve({ ok: true });
      const last = err.trim().split('\n').filter(Boolean).slice(-2).join(' ');
      resolve({ ok: false, error: cancelled ? 'cancelled' : (last || ('ffmpeg exit ' + code)) });
    });
  });
}

/* ---------------------------------------------------------- batch / chain */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) {
    const c = path.join(dir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

/* run one effect, with an automatic GPU -> CPU fallback */
async function runJobWithFallback(preset, input, output, duration, gpu, send) {
  const job = { preset: preset, input: input, output: output, duration: duration };
  const onP = (pct) => send({ type: 'job', id: preset.id, status: 'rendering', pct: pct });
  let res = await runJob(job, gpu, onP);
  if (!res.ok && gpu.type !== 'cpu' && !cancelled) {
    send({ type: 'job', id: preset.id, status: 'rendering', pct: 0, note: 'CPU fallback' });
    res = await runJob(job, { type: 'cpu', enc: 'libx264' }, onP);
  }
  return res;
}

/* mux a video stream with a separate audio stream.
   replace=true  -> user soundtrack: re-encode + pad/truncate to the video length
   replace=false -> same-length internal audio: fast stream-copy */
function muxVideoAudio(videoFile, audioFile, out, replace) {
  return new Promise((resolve) => {
    const args = replace
      ? ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoFile, '-i', audioFile,
         '-filter_complex', '[1:a]apad[a]', '-map', '0:v:0', '-map', '[a]',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]
      : ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoFile, '-i', audioFile,
         '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', out];
    let proc;
    try { proc = spawn(paths.ffmpeg, args); }
    catch (e) { return resolve(false); }
    activeProcs.add(proc);
    proc.on('error', () => { activeProcs.delete(proc); resolve(false); });
    proc.on('close', (code) => { activeProcs.delete(proc); resolve(code === 0); });
  });
}

/*
 * Render the selected effects onto ONE video.
 *  - Multiple effects are chained: each applied to the previous result.
 *  - opts.audioPath (optional): the user's own track replaces the soundtrack.
 *  - No effects + a custom track simply swaps the audio.
 * Combined-clip audio: the custom track if given; otherwise the first effect's
 * audio (so background music is not layered); the final step's own audio when
 * a Speed/Audio effect has already changed it.
 */
async function renderBatch(opts, send) {
  cancelled = false;
  const gpu = await detectGpu();
  const duration = await probeDuration(opts.videoPath);
  const list = opts.presetIds.map((id) => presets.get(id)).filter(Boolean);
  const baseName = path.parse(opts.videoPath).name;
  const finalOutput = uniquePath(path.join(opts.outputDir, sanitize(baseName + ' - Lumio') + '.mp4'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumio-'));

  send({ type: 'start', total: list.length, gpu: { type: gpu.type, label: gpu.label } });

  /* chain the effects: each step renders onto the previous step's output */
  let current = opts.videoPath;
  let firstGood = null;
  let okCount = 0;

  for (let i = 0; i < list.length && !cancelled; i++) {
    const p = list[i];
    const stepOut = path.join(tmp, 'step' + i + '.mp4');
    send({ type: 'job', id: p.id, status: 'rendering', pct: 0 });
    const res = await runJobWithFallback(p, current, stepOut, duration, gpu, send);
    if (res.ok) {
      okCount++;
      current = stepOut;
      if (!firstGood) firstGood = stepOut;
      send({ type: 'job', id: p.id, status: 'done', pct: 100 });
    } else {
      send({ type: 'job', id: p.id, status: cancelled ? 'cancelled' : 'failed', pct: 0, error: res.error });
    }
    send({ type: 'overall', done: i + 1, total: list.length });
  }

  /* the stacked video to keep (last good step, or the source when no effects) */
  const videoResult = okCount > 0 ? current : opts.videoPath;
  const valid = !cancelled && (okCount > 0 || (list.length === 0 && !!opts.audioPath));

  let finalOk = false;
  if (valid) {
    try {
      const hasSpeedOrAudio = list.some((p) => p.category === 'SPEED' || p.category === 'AUDIO');
      if (opts.audioPath) {
        finalOk = await muxVideoAudio(videoResult, opts.audioPath, finalOutput, true);
        if (!finalOk) { fs.copyFileSync(videoResult, finalOutput); finalOk = true; }
      } else if (okCount <= 1 || hasSpeedOrAudio) {
        fs.copyFileSync(videoResult, finalOutput);             // keep the clip's own audio
        finalOk = true;
      } else if (await muxVideoAudio(videoResult, firstGood, finalOutput, false)) {
        finalOk = true;                                        // first effect's audio — no music layering
      } else {
        fs.copyFileSync(videoResult, finalOutput);
        finalOk = true;
      }
    } catch (e) { finalOk = false; }
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  send({ type: 'done', cancelled: cancelled, output: finalOk ? finalOutput : null, okCount: okCount, total: list.length });
  return { output: finalOk ? finalOutput : null };
}

function cancelAll() {
  cancelled = true;
  for (const proc of activeProcs) { try { proc.kill('SIGKILL'); } catch (e) {} }
  activeProcs.clear();
}

/* ------------------------------------------------ video info + thumbnail */
async function probeInfo(file) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) { /* ignore */ }

  const err = await ffmpegInspect(file);
  const vm = err.match(/Video:\s*([A-Za-z0-9_]+).*?,\s*(\d{2,5})x(\d{2,5})/);
  return {
    duration: parseDuration(err),
    size: size,
    width: vm ? parseInt(vm[2], 10) : 0,
    height: vm ? parseInt(vm[3], 10) : 0,
    codec: vm ? vm[1] : '',
  };
}

function thumbnail(file) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(paths.ffmpeg, [
        '-hide_banner', '-ss', '1', '-i', file, '-frames:v', '1',
        '-vf', 'scale=420:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
      ]);
    } catch (e) { return resolve(null); }
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      if (!chunks.length) return resolve(null);
      resolve('data:image/jpeg;base64,' + Buffer.concat(chunks).toString('base64'));
    });
  });
}

module.exports = { detectGpu, renderBatch, cancelAll, probeInfo, thumbnail };

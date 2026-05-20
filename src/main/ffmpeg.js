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

/* -------------------------------------------------------------- the batch */
async function renderBatch(opts, send) {
  cancelled = false;
  const gpu = await detectGpu();
  const duration = await probeDuration(opts.videoPath);
  const baseName = path.parse(opts.videoPath).name;

  const jobs = opts.presetIds
    .map((id) => presets.get(id))
    .filter(Boolean)
    .map((p) => ({
      preset: p,
      input: opts.videoPath,
      output: path.join(opts.outputDir, sanitize(baseName + ' - ' + p.id) + '.mp4'),
      duration,
    }));

  send({ type: 'start', total: jobs.length, gpu: { type: gpu.type, label: gpu.label } });

  const concurrency = Math.min(jobs.length, 2);
  let next = 0, done = 0;
  const results = [];

  async function worker() {
    while (next < jobs.length && !cancelled) {
      const job = jobs[next++];
      send({ type: 'job', id: job.preset.id, status: 'rendering', pct: 0 });

      let res = await runJob(job, gpu, (pct) => {
        send({ type: 'job', id: job.preset.id, status: 'rendering', pct });
      });

      // hardware-encode failure -> guaranteed CPU retry
      if (!res.ok && gpu.type !== 'cpu' && !cancelled) {
        send({ type: 'job', id: job.preset.id, status: 'rendering', pct: 0, note: 'CPU fallback' });
        res = await runJob(job, { type: 'cpu', enc: 'libx264' }, (pct) => {
          send({ type: 'job', id: job.preset.id, status: 'rendering', pct });
        });
      }

      done++;
      const status = res.ok ? 'done' : (cancelled ? 'cancelled' : 'failed');
      results.push({ id: job.preset.id, ok: res.ok, output: job.output, error: res.error });
      send({ type: 'job', id: job.preset.id, status, pct: res.ok ? 100 : 0, error: res.error });
      send({ type: 'overall', done, total: jobs.length });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  send({ type: 'done', cancelled, results });
  return { cancelled, results };
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

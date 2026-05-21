'use strict';
/* Lumio — studio (renderer). */
const $ = (id) => document.getElementById(id);
const nx = window.lumio;

/* ------------------------------- state ------------------------------- */
let allPresets = [];
const selected = new Set();
let filter = 'all';
let searchText = '';
let video = null;        // { path, name, info, thumb }
let outputDir = null;
let rendering = false;
let finalOutputPath = null;

/* ------------------------------ helpers ------------------------------ */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function splitName(id) {
  const m = String(id).match(/^(\d+[A-Za-z]+)\s+(.+)$/);
  return m ? { code: m[1], label: m[2] } : { code: '', label: id };
}
function fmtDur(s) {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
function fmtSize(b) {
  if (!b) return '';
  if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function dirOf(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

/* ============================ window chrome ========================== */
$('winMin').onclick = () => nx.win.minimize();
$('winMax').onclick = () => nx.win.maximize();
$('winClose').onclick = () => nx.win.close();
$('tdCredit').onclick = (e) => { e.preventDefault(); nx.openExternal('https://techdesigner.net/'); };

/* ============================== boot ================================= */
async function boot() {
  const meta = await nx.meta();
  $('verTag').textContent = 'v' + meta.version;
  $('fxCount').textContent = meta.presetCount;

  allPresets = await nx.presets();
  renderGrid();

  /* licence summary */
  const st = await nx.license.status();
  if (st.state === 'active') {
    $('licInfo').textContent = st.lifetime
      ? st.tierLabel
      : st.tierLabel + ' · ' + st.daysLeft + ' days left';
  }

  /* GPU detection (async — may take a moment) */
  nx.gpu().then((g) => {
    $('gpuLabel').textContent = g.label;
    if (g.type === 'cpu') $('gpuDot').classList.add('cpu');
  });

  buildAbout(meta, st);
}

/* =========================== effects grid ============================ */
function visiblePresets() {
  return allPresets.filter((p) => {
    const fOk = filter === 'all' || p.mode === filter || p.category === filter;
    const sOk = !searchText || p.id.toLowerCase().includes(searchText);
    return fOk && sOk;
  });
}

function renderGrid() {
  const list = visiblePresets();
  const grid = $('grid');
  $('gridEmpty').style.display = list.length ? 'none' : 'block';
  grid.innerHTML = list.map((p) => {
    const { code, label } = splitName(p.id);
    const tags = ['<span class="tag ' + p.category.toLowerCase() + '">' + p.category + '</span>'];
    if (p.mode === 'REPEAT' || p.mode === 'PRELOAD') {
      tags.push('<span class="tag ' + p.mode.toLowerCase() + '">' + p.mode + '</span>');
    }
    return '<div class="fx' + (selected.has(p.id) ? ' sel' : '') + '" data-id="' + esc(p.id) + '">' +
      '<div class="fx-top">' +
      '<div class="fx-check">✓</div>' +
      '<div><div class="fx-code">' + esc(code) + '</div>' +
      '<div class="fx-name">' + esc(label) + '</div></div></div>' +
      '<div class="fx-tags">' + tags.join('') + '</div></div>';
  }).join('');
}

$('grid').addEventListener('click', (e) => {
  const card = e.target.closest('.fx');
  if (!card) return;
  const id = card.dataset.id;
  if (selected.has(id)) { selected.delete(id); card.classList.remove('sel'); }
  else { selected.add(id); card.classList.add('sel'); }
  updateSelInfo();
});

/* search + filters */
$('search').addEventListener('input', (e) => {
  searchText = e.target.value.trim().toLowerCase();
  renderGrid();
});
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('.filter');
  if (!b) return;
  document.querySelectorAll('.filter').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  filter = b.dataset.f;
  renderGrid();
});
$('selectAll').onclick = () => {
  visiblePresets().forEach((p) => selected.add(p.id));
  renderGrid();
  updateSelInfo();
};
$('clearSel').onclick = () => {
  selected.clear();
  renderGrid();
  updateSelInfo();
};

function updateSelInfo() {
  $('selCount').textContent = selected.size;
  updateRenderBtn();
}
function updateRenderBtn() {
  const ready = video && outputDir && selected.size > 0 && !rendering;
  $('renderBtn').disabled = !ready;
  let sub = 'Select a video and effects to render';
  if (!video) sub = '⬆️ Upload a video first';
  else if (selected.size === 0) sub = '✓ Select at least one effect';
  else if (!outputDir) sub = '📁 Select an output folder';
  else sub = video.name + ' → 1 combined video (' + selected.size + ' effect' + (selected.size > 1 ? 's' : '') + ')';
  $('selSub').textContent = sub;
}

/* ============================ video input ============================ */
async function setVideo(filePath) {
  if (!filePath) return;
  if (!/\.(mp4|mov|mkv|avi|m4v|webm|wmv|flv|mpg|mpeg|ts)$/i.test(filePath)) {
    toast('⚠ This is not a supported video file');
    return;
  }
  $('dropzone').querySelector('.t1').textContent = 'Loading…';
  const data = await nx.videoInfo(filePath);
  video = data;

  $('vcThumb').src = data.thumb || '';
  if (!data.thumb) $('vcThumb').style.display = 'none';
  else $('vcThumb').style.display = 'block';
  $('vcName').textContent = data.name;

  const info = data.info || {};
  const chips = [];
  if (info.width && info.height) chips.push('<span class="chip amber">' + info.width + '×' + info.height + '</span>');
  if (info.duration) chips.push('<span class="chip">⏱ ' + fmtDur(info.duration) + '</span>');
  if (info.size) chips.push('<span class="chip">' + fmtSize(info.size) + '</span>');
  if (info.codec) chips.push('<span class="chip">' + esc(info.codec.toUpperCase()) + '</span>');
  $('vcMeta').innerHTML = chips.join('');

  $('dropzone').style.display = 'none';
  $('videoCard').classList.add('show');
  $('dropzone').querySelector('.t1').textContent = 'Upload Video';

  if (!outputDir) setOutputDir(dirOf(filePath));
  updateRenderBtn();
}

$('dropzone').onclick = async () => setVideo(await nx.pickVideo());
$('changeVideo').onclick = async () => setVideo(await nx.pickVideo());

/* drag & drop */
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) setVideo(nx.pathForFile(f));
});

/* ============================ output dir ============================= */
function setOutputDir(dir) {
  outputDir = dir;
  $('outPath').textContent = dir;
  updateRenderBtn();
}
$('pickOut').onclick = async () => {
  const d = await nx.pickOutputDir();
  if (d) setOutputDir(d);
};

/* ============================== render =============================== */
$('renderBtn').onclick = startRender;

function startRender() {
  if (rendering || !video || !outputDir || !selected.size) return;
  rendering = true;
  updateRenderBtn();

  const ids = allPresets.map((p) => p.id).filter((id) => selected.has(id));

  /* build job rows */
  const list = $('rmList');
  list.innerHTML = ids.map((id) => {
    const { label } = splitName(id);
    return '<div class="job" id="job-' + cssId(id) + '" data-id="' + esc(id) + '">' +
      '<div class="job-ico">•</div>' +
      '<div class="job-main"><div class="job-name">' + esc(label) + '</div>' +
      '<div class="job-bar"><i></i></div></div>' +
      '<div class="job-pct">—</div></div>';
  }).join('');

  $('rmTitle').textContent = 'Rendering…';
  $('rmSub').textContent = video.name;
  $('rmBar').style.width = '0%';
  $('rmDone').textContent = '0 / ' + ids.length + ' done';
  $('rmPct').textContent = '0%';
  $('rmResult').className = 'rm-result';
  $('cancelBtn').style.display = '';
  $('closeRmBtn').style.display = 'none';
  $('openOutBtn').style.display = 'none';
  $('renderOverlay').classList.add('show');

  nx.render({ videoPath: video.path, presetIds: ids, outputDir: outputDir });
}

function cssId(id) {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

const offRender = nx.onRenderEvent((msg) => {
  if (msg.type === 'start') {
    $('rmSub').textContent = video.name + '  •  ' + (msg.gpu ? msg.gpu.label : '');
  } else if (msg.type === 'job') {
    const row = $('job-' + cssId(msg.id));
    if (!row) return;
    row.className = 'job ' + msg.status;
    const ico = row.querySelector('.job-ico');
    const bar = row.querySelector('.job-bar > i');
    const pct = row.querySelector('.job-pct');
    if (msg.status === 'rendering') {
      ico.textContent = '⟳';
      bar.style.width = (msg.pct || 0) + '%';
      pct.textContent = msg.note ? msg.note : Math.round(msg.pct || 0) + '%';
    } else if (msg.status === 'done') {
      ico.textContent = '✓';
      bar.style.width = '100%';
      pct.textContent = '100%';
    } else {
      ico.textContent = msg.status === 'failed' ? '✕' : '–';
      pct.textContent = msg.status === 'failed' ? 'Failed' : 'Cancelled';
      if (msg.error && msg.status === 'failed') row.title = msg.error;
    }
  } else if (msg.type === 'overall') {
    const p = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
    $('rmBar').style.width = p + '%';
    $('rmPct').textContent = p + '%';
    $('rmDone').textContent = msg.done + ' / ' + msg.total + ' done';
  } else if (msg.type === 'done') {
    finishRender(msg);
  }
});

function finishRender(msg) {
  rendering = false;
  const made = !!msg.output;
  const applied = msg.okCount || 0;
  const total = msg.total || 0;
  const skipped = total - applied;
  finalOutputPath = msg.output || null;

  $('rmTitle').textContent = msg.cancelled ? 'Render cancelled'
    : (made ? 'Render complete ✓' : 'Render failed');
  $('rmResult').className = 'rm-result show';
  if (made) {
    $('rmResult').innerHTML =
      '<span class="ok">1 video created — ' + applied + ' effect' + (applied > 1 ? 's' : '') + ' applied</span>' +
      (skipped > 0 ? '  ·  <span class="bad">' + skipped + ' skipped</span>' : '');
  } else {
    $('rmResult').innerHTML = '<span class="bad">No video produced</span>';
  }
  $('cancelBtn').style.display = 'none';
  $('closeRmBtn').style.display = '';
  $('openOutBtn').style.display = made ? '' : 'none';
  updateRenderBtn();
  if (!msg.cancelled && made) toast('✓ Video created');
}

$('cancelBtn').onclick = () => {
  nx.cancel();
  $('cancelBtn').textContent = 'Cancelling…';
  $('cancelBtn').disabled = true;
};
$('closeRmBtn').onclick = () => {
  $('renderOverlay').classList.remove('show');
  $('cancelBtn').textContent = '⛔ Cancel';
  $('cancelBtn').disabled = false;
};
$('openOutBtn').onclick = () => {
  if (finalOutputPath) nx.showItem(finalOutputPath);
  else if (outputDir) nx.openPath(outputDir);
};

/* ============================== about ================================ */
function buildAbout(meta, st) {
  $('aboutVer').textContent = 'Version ' + meta.version;
  let lic = 'Active';
  if (st.state === 'active') {
    lic = st.lifetime ? st.tierLabel + ' (Lifetime)'
      : st.tierLabel + ' — ' + st.daysLeft + ' days left';
  }
  $('aboutBody').innerHTML =
    '<b>' + meta.presetCount + '</b> professional video effects<br>' +
    'License: <b>' + esc(lic) + '</b><br><br>' +
    'A fully offline video effects studio<br>with a GPU-accelerated rendering engine.<br><br>' +
    'Powered by <a href="#" id="aboutLink">Tech Designer</a><br>' +
    '© 2026 techdesigner.net';
  const lnk = $('aboutLink');
  if (lnk) lnk.onclick = (e) => { e.preventDefault(); nx.openExternal('https://techdesigner.net/'); };
}
$('aboutBtn').onclick = () => $('aboutOverlay').classList.add('show');
$('closeAbout').onclick = () => $('aboutOverlay').classList.remove('show');
$('aboutOverlay').addEventListener('click', (e) => {
  if (e.target === $('aboutOverlay')) $('aboutOverlay').classList.remove('show');
});

boot();

'use strict';
/* Activation / renewal screen logic. */
const $ = (id) => document.getElementById(id);
const nx = window.lumio;

/* ---- window controls ---- */
$('winMin').onclick = () => nx.win.minimize();
$('winClose').onclick = () => nx.win.close();
$('tdLink').onclick = (e) => { e.preventDefault(); nx.openExternal('https://techdesigner.net/'); };

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2000);
}

function showMsg(text, kind) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'act-msg show ' + kind;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ---- adapt the screen to the current licence state ---- */
async function init() {
  const meta = await nx.meta();
  $('verTag').textContent = 'v' + meta.version;

  $('reqCode').textContent = await nx.license.requestCode();

  const st = await nx.license.status();
  const banner = $('banner');

  if (st.state === 'expired') {
    $('headSub').textContent = 'Your license has expired';
    banner.style.display = 'flex';
    banner.className = 'act-banner warn';
    $('bannerIcon').textContent = '⏰';
    const why = st.reason === 'clock'
      ? 'A system clock change was detected. '
      : '';
    $('bannerText').innerHTML = why +
      'Your <b>' + (st.tierLabel || '') + '</b> license has ended' +
      (st.expiresAt ? ' (' + fmtDate(st.expiresAt) + ')' : '') +
      '. Enter a new Activation Code to continue.';
    $('activateBtn').textContent = '🔄 Renew License';
  } else if (st.state === 'invalid') {
    $('headSub').textContent = 'License could not be verified';
    banner.style.display = 'flex';
    banner.className = 'act-banner warn';
    $('bannerIcon').textContent = '⚠';
    $('bannerText').textContent = st.reason ||
      'The stored license does not match this computer. Please activate again.';
  } else {
    $('headSub').textContent = 'Activate your license to start the app';
  }
}

/* ---- copy request code ---- */
$('copyReq').onclick = async () => {
  const code = $('reqCode').textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    toast('Request Code copied ✓');
  } catch (e) {
    const r = document.createRange();
    r.selectNode($('reqCode'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
    toast('Request Code selected — press Ctrl+C');
  }
};

/* ---- activate ---- */
let busy = false;
$('activateBtn').onclick = async () => {
  if (busy) return;
  const code = $('acInput').value.trim();
  if (code.length < 20) {
    showMsg('⚠ Please paste a valid Activation Code.', 'err');
    return;
  }
  busy = true;
  const btn = $('activateBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying…';

  const res = await nx.license.activate(code);
  if (res.ok) {
    showMsg('✓ License activated successfully! Launching app…', 'ok');
    /* main process reloads the window into the studio automatically */
  } else {
    showMsg('⚠ ' + res.error, 'err');
    btn.disabled = false;
    btn.textContent = label;
    busy = false;
  }
};

$('acInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('activateBtn').click();
});

init();

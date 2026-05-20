'use strict';
/*
 * Lumio Keygen — admin-only license generator.
 * Takes a Request Code from a customer, signs an Activation Code with the
 * Ed25519 PRIVATE key. This build must never be distributed to customers.
 */
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'private-key.pem'), 'utf8');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TIERS = {
  1: { label: '1 Month', days: 30 },
  2: { label: '6 Months', days: 180 },
  3: { label: '1 Year', days: 365 },
  4: { label: 'Lifetime', days: null },
};

function b32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function b32decode(str) {
  str = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (let i = 0; i < str.length; i++) {
    value = (value << 5) | B32.indexOf(str[i]);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

function groups(s, n) {
  return (s.match(new RegExp('.{1,' + n + '}', 'g')) || []).join('-');
}

/* Request Code = "LUMIO-" + 16 base32 chars (10-byte device id) */
function decodeRequest(input) {
  let s = String(input).toUpperCase().replace(/[\s\-_.]/g, '').replace(/^LUMIO/, '');
  s = s.replace(/[^A-Z2-7]/g, '');
  if (s.length < 16) return null;
  const dev = b32decode(s.slice(0, 16));
  return dev.length === 10 ? dev : null;
}

function generate(requestCode, tier) {
  const devId = decodeRequest(requestCode);
  if (!devId) return { ok: false, error: 'Invalid Request Code — at least 16 characters required.' };
  tier = parseInt(tier, 10);
  if (!TIERS[tier]) return { ok: false, error: 'Please select a license tier.' };

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.alloc(16);
  payload[0] = 1;                     // version
  payload[1] = tier;                  // tier
  payload.writeUInt32BE(issuedAt, 2); // issued (unix seconds)
  devId.copy(payload, 6);             // 10-byte device id

  const sig = crypto.sign(null, payload, PRIVATE_KEY); // Ed25519 -> 64 bytes
  const code = b32encode(Buffer.concat([payload, sig]));

  const t = TIERS[tier];
  const expiresAt = t.days == null ? null : (issuedAt + t.days * 86400) * 1000;
  return {
    ok: true,
    code: groups(code, 6),
    tierLabel: t.label,
    issuedAt: issuedAt * 1000,
    expiresAt,
    deviceId: b32encode(devId),
  };
}

ipcMain.handle('generate', (e, req, tier) => generate(req, tier));
ipcMain.handle('copy', (e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('openExternal', (e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 940,
    height: 880,
    minWidth: 760,
    minHeight: 680,
    backgroundColor: '#04107C',
    title: 'Lumio Keygen',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'keygen.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

'use strict';
/*
 * license.js — Offline challenge/response activation for Lumio.
 * ------------------------------------------------------------------------
 *  Flow:
 *    1. App computes a hardware-bound Device ID  -> shown as a Request Code.
 *    2. Admin's Keygen signs {version,tier,issuedAt,deviceId} with Ed25519.
 *    3. App verifies the signature with the bundled PUBLIC key, confirms the
 *       embedded deviceId matches THIS machine, then unlocks.
 *
 *  Security properties:
 *    - Activation codes cannot be forged (Ed25519 — private key never ships).
 *    - A code only works on the device whose Request Code produced it.
 *    - Validity is derived ONLY from the signed code, so editing the local
 *      store cannot extend the licence. Re-installing re-uses the same code
 *      and lands on the exact same expiry date.
 *    - Stored in two places (file + registry); a wound-back clock or a
 *      deleted store is detected / self-healed.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/* ---- Ed25519 PUBLIC key (verify-only — the private key lives in Keygen) -- */
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEAIblRiqh0vTuAOTa4Ein14TbP7Zw2hCvYO9+D44Ny/Nw=\n' +
  '-----END PUBLIC KEY-----\n';

const APP_TAG = 'LUMIO::v1';
const REG_PATH = 'HKCU\\Software\\Lumio';
const PAYLOAD_LEN = 16; // ver(1) + tier(1) + issuedAt(4) + deviceId(10)
const SIG_LEN = 64;     // Ed25519 signature

const TIERS = {
  1: { code: 'm1', label: '1 Month', days: 30 },
  2: { code: 'm6', label: '6 Months', days: 180 },
  3: { code: 'y1', label: '1 Year', days: 365 },
  4: { code: 'life', label: 'Lifetime', days: null },
};

/* ============================ base32 (RFC 4648) ========================== */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

/* ============================ device identity ============================ */
let _device = null;

function readMachineGuid() {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    if (m) return m[1].trim();
  } catch (e) { /* fall through */ }
  return '';
}

function getDevice() {
  if (_device) return _device;
  const cpu = (os.cpus()[0] && os.cpus()[0].model) || 'cpu';
  const seed = [readMachineGuid(), cpu, os.arch(), os.platform()].join('|');
  const raw = crypto.createHash('sha256').update(seed).digest().slice(0, 10);
  const id = b32encode(raw); // 16 chars
  _device = { raw, id, requestCode: 'LUMIO-' + groups(id, 4) };
  return _device;
}

/* ============================ code verification ========================== */
function cleanCode(s) {
  return String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function verifyActivation(input) {
  const blob = b32decode(input);
  if (blob.length < PAYLOAD_LEN + SIG_LEN) {
    return { ok: false, error: 'Activation Code is incomplete or has a typo.' };
  }
  const payload = blob.slice(0, PAYLOAD_LEN);
  const sig = blob.slice(PAYLOAD_LEN, PAYLOAD_LEN + SIG_LEN);
  const ver = payload[0];
  const tier = payload[1];
  const issuedAt = payload.readUInt32BE(2);
  const devId = payload.slice(6, 16);

  if (ver !== 1) return { ok: false, error: 'Activation Code version does not match.' };
  if (!TIERS[tier]) return { ok: false, error: 'Activation Code tier is invalid.' };

  let sigOk = false;
  try { sigOk = crypto.verify(null, payload, PUBLIC_KEY, sig); } catch (e) { sigOk = false; }
  if (!sigOk) return { ok: false, error: 'Activation Code is forged or invalid — signature mismatch.' };

  if (!devId.equals(getDevice().raw)) {
    return { ok: false, error: 'This Activation Code was issued for a different device — it will not work on this computer.' };
  }
  return { ok: true, tier, issuedAt };
}

/* ============================ encrypted storage ========================== */
let STORE_FILE = null;

function init(userDataDir) {
  STORE_FILE = path.join(userDataDir, 'license.dat');
}

function storeKey() {
  return crypto.createHash('sha256').update(getDevice().id + '|' + APP_TAG + '|store').digest();
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', storeKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function decrypt(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', storeKey(), buf.slice(0, 12));
    decipher.setAuthTag(buf.slice(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(buf.slice(28)), decipher.final()]).toString('utf8'));
  } catch (e) { return null; }
}

function readFileStore() {
  try { return fs.readFileSync(STORE_FILE, 'utf8').trim(); } catch (e) { return null; }
}
function writeFileStore(b64) {
  try { fs.writeFileSync(STORE_FILE, b64, 'utf8'); } catch (e) { /* ignore */ }
}
function readRegStore() {
  try {
    const out = execFileSync('reg', ['query', REG_PATH, '/v', 'Data'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/Data\s+REG_SZ\s+(.+)/);
    return m ? m[1].trim() : null;
  } catch (e) { return null; }
}
function writeRegStore(b64) {
  try {
    execFileSync('reg', ['add', REG_PATH, '/v', 'Data', '/t', 'REG_SZ', '/d', b64, '/f'], { stdio: 'ignore' });
  } catch (e) { /* ignore */ }
}

function saveRecord(rec) {
  const b64 = encrypt(rec);
  writeFileStore(b64);
  writeRegStore(b64);
}

/* ============================ public API ================================= */
function getRequestCode() {
  return getDevice().requestCode;
}

function describe(tierNum, issuedAt) {
  const tier = TIERS[tierNum];
  const expiresAt = tier.days == null ? null : issuedAt + tier.days * 86400;
  return { tier: tierNum, tierLabel: tier.label, lifetime: tier.days == null, expiresAt };
}

function activate(activationCode) {
  const v = verifyActivation(activationCode);
  if (!v.ok) return v;
  const now = Math.floor(Date.now() / 1000);
  const d = describe(v.tier, v.issuedAt);
  if (d.expiresAt != null && d.expiresAt <= now) {
    return { ok: false, error: 'This Activation Code has already expired.' };
  }
  saveRecord({ v: 1, code: cleanCode(activationCode), activatedAt: now, lastSeen: now });
  return { ok: true, status: getStatus() };
}

function getStatus() {
  const fileB = readFileStore();
  const regB = readRegStore();
  const recF = fileB ? decrypt(fileB) : null;
  const recR = regB ? decrypt(regB) : null;

  if (!recF && !recR) return { state: 'inactive' };

  // prefer the copy that has seen time move furthest forward
  const lf = (recF && recF.lastSeen) || 0;
  const lr = (recR && recR.lastSeen) || 0;
  const rec = lf >= lr ? (recF || recR) : (recR || recF);
  const lastSeen = Math.max(lf, lr);

  // validity comes ONLY from the signed code — a hand-edited store is useless
  const v = verifyActivation(rec.code);
  if (!v.ok) return { state: 'invalid', reason: v.error };

  const now = Math.floor(Date.now() / 1000);
  const d = describe(v.tier, v.issuedAt);
  const base = {
    tier: v.tier,
    tierLabel: d.tierLabel,
    lifetime: d.lifetime,
    issuedAt: v.issuedAt * 1000,
    activatedAt: (rec.activatedAt || now) * 1000,
    expiresAt: d.expiresAt == null ? null : d.expiresAt * 1000,
    daysLeft: d.expiresAt == null ? null : Math.max(0, Math.ceil((d.expiresAt - now) / 86400)),
  };

  // refresh lastSeen (only ever forward) and self-heal a deleted store
  saveRecord({ v: 1, code: rec.code, activatedAt: rec.activatedAt || now, lastSeen: Math.max(now, lastSeen) });

  // wound-back clock (1-day tolerance for normal drift)
  if (now + 86400 < lastSeen) return { state: 'expired', reason: 'clock', ...base };
  if (d.expiresAt != null && now >= d.expiresAt) return { state: 'expired', reason: 'time', ...base };
  return { state: 'active', ...base };
}

module.exports = { init, getRequestCode, getDevice, activate, getStatus, TIERS };

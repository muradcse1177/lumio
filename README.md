# Lumio — Video Effects Studio

Upload a video → pick multiple cinematic effects → get a separate output
video for each. **96 professional effects**, GPU-accelerated, fully offline.

Powered by **Tech Designer** — https://techdesigner.net

---

## Project structure

```
lumio/
  src/main/        Electron main process (window, license, ffmpeg engine)
  src/renderer/    UI — activation screen + studio (navy/amber design)
  resources/       ffmpeg.exe, ffprobe.exe, aud/ (background music), presets.json
  assets/          app icon
  tools/keygen/    Lumio Keygen — admin-only license generator
  scripts/         make-icon.js (dev helper)
  dist/            build output — Lumio Setup .exe
```

> Lumio is fully self-contained — it does not depend on any external folder.

---

## Building

```bash
npm install
npm run dist        # -> dist/Lumio Setup 1.0.0.exe   (for customers)
npm start           # run the app in dev mode
```

**Keygen build (admin tool — never give this to a customer):**
```bash
cd tools/keygen
npm install
npm run dist        # -> tools/keygen/dist/Lumio Keygen Setup.exe
npm start           # run the keygen in dev mode
```

### Install requirements (customer PC)
- Windows 10 / 11, 64-bit — **nothing else needed** (no .NET, VC++, or Node)
- ~250 MB free disk space
- The installer is a standard wizard; per-user install, no admin rights needed

---

## How the license works (offline challenge–response, no server)

```
1. Customer installs Lumio
2. The app shows a Request Code   ->  LUMIO-XXXX-XXXX-XXXX-XXXX
   (derived from that PC's hardware fingerprint — unique per device)
3. Customer sends the Request Code to the admin
4. Admin opens Lumio Keygen -> pastes the Request Code -> picks a tier
   -> gets an Activation Code
5. Customer enters the Activation Code in the app -> the app unlocks
```

- The Activation Code is signed with an **Ed25519 signature** — it cannot be forged
- It works **only on that one device** (a different PC has a different fingerprint)
- The validity period is baked into the code — reinstalling cannot extend it
- Winding the system clock back is detected and blocked

### License tiers
| Tier | Duration |
|------|----------|
| 1 Month  | 30 days  |
| 6 Months | 180 days |
| 1 Year   | 365 days |
| Lifetime | Forever  |

When a license expires the app locks; entering a new Activation Code unlocks it again.

---

## Rendering engine

- The app runs the bundled `ffmpeg.exe` directly (no `.bat` files)
- If a GPU is present (NVIDIA NVENC / Intel QSV) it is auto-detected for fast encoding
- Multiple effects render in parallel with live progress
- If a GPU job fails it automatically falls back to CPU

---

## IMPORTANT — `tools/keygen/private-key.pem`

This file is the secret signing key for licenses. **Keep it safe, never share it.**
If it leaks, anyone could generate fake Activation Codes.

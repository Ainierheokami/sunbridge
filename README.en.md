<p align="center">
  <img src="app/assets/sunbridge-icon.svg" width="96" alt="Sunbridge" />
</p>

<h1 align="center">Sunbridge</h1>

<p align="center">
  <b>Use your computer from any browser.</b><br />
  Sunbridge brings a <a href="https://github.com/LizardByte/Sunshine">Sunshine</a> host's video, audio and input to a web page: no client to install, works from phones, tablets and locked-down PCs.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="License: GPLv3" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933.svg" alt="Node.js 18+" />
  <img src="https://img.shields.io/badge/codecs-AV1%20%7C%20HEVC%20%7C%20H.264-6cd9eb.svg" alt="AV1 / HEVC / H.264" />
  <a href="README.md">中文</a>
</p>

<p align="center">
  <img src="docs/streaming.png" alt="Streaming with live statistics" width="880" />
</p>

---

## Why

Sunshine is a great streaming host, but every device that connects to it needs a client app first. On a work laptop, a borrowed tablet or any machine where you can't install software, that's where it stops.

Sunbridge runs on your own computer (usually the one running Sunshine) and turns the stream into a web page. Anything with a modern browser can log in and use the desktop, play games, and send keyboard, mouse, touch and gamepad input.

- **Nothing to install**: open a URL, on desktop or mobile
- **Built for the internet**: AV1 / HEVC when the device can decode them, adaptive bitrate, automatic reconnect
- **Remote desktop and gaming**: a normal pointer with touch gestures, or a locked mouse with gamepads
- **Self-hosted**: your data stays on your machine, behind a login, HTTPS and access limits

## Highlights

- **Most efficient codec automatically**: AV1 or HEVC when the browser hardware-decodes them (30–50% less bitrate than H.264 for the same picture), H.264 otherwise.
- **Pass-through, never re-encoded**: the browser decodes the host's original bitstream with WebCodecs (hardware first). No extra quality loss or latency.
- **Lean transport**: video is assembled into whole frames before it leaves your machine, so FEC redundancy and packet headers don't travel over the internet (about 25–30% less bandwidth, given back to the encoder as quality).
- **Adaptive resolution**: matches the browser window in device pixels for crisp text, and follows resizes, rotation and fullscreen.
- **Adaptive bitrate with a hard cap**: driven by queueing delay and measured throughput to the browser; the configured bitrate is a ceiling the encoder is held to.
- **Bounded latency**: under congestion whole frames are dropped until the next keyframe, so the picture pauses briefly instead of smearing or drifting behind.
- **Automatic reconnect**: survives network changes, sleep/wake and service restarts; a reloaded page can rejoin the running stream.
- **Remote desktop mode**: absolute pointer, tap / drag / long-press / two-finger gestures, on-screen keyboard with full text input (including CJK).
- **Game mode**: pointer lock with relative motion, gamepads with rumble.
- **Glitch-free audio**: Opus stereo played through a jitter buffer with clock-drift correction.
- **One script to manage it**: `start.bat` / `start.sh` sets the password, configures access (reverse proxy with multiple domains and a generated nginx config, your own certificate, self-signed, or local only), starts it and shows status.
- **Secure by default**: every page and API needs a login, optional two-step verification (authenticator app codes, separately for login, starting a stream and resuming a session), failed logins are rate-limited, cross-site requests are blocked, and pairing keys and account data are never served over the web.

<p align="center">
  <img src="docs/overview.png" alt="Overview" width="49%" />
  <img src="docs/host-settings.png" alt="Host settings" width="49%" />
</p>

## How it works

```
              same machine (or LAN)                            internet / LAN
┌───────────┐   UDP (RTP / FEC)    ┌─────────────┐   HTTPS + WebSocket   ┌──────────────┐
│ Sunshine  │ ───────────────────▶ │  Sunbridge  │ ────────────────────▶ │   Browser    │
│ (encoder) │ ◀─────────────────── │  (bridge)   │ ◀──────────────────── │ (WebCodecs)  │
└───────────┘ control (encrypted)  └─────────────┘  keyboard/mouse/pads  └──────────────┘
```

Sunbridge pairs with Sunshine, negotiates the stream and receives the media, then sends whole video frames and audio to the browser over a single WebSocket. The browser decodes, plays and captures input. It speaks the standard GameStream protocol, so the host needs no changes.

## Quick start

Requires [Node.js](https://nodejs.org/) 18+ (20+ recommended) and a host running Sunshine.

```bash
git clone https://github.com/Ainierheokami/sunbridge.git
cd sunbridge
./start.sh        # Windows: double-click start.bat
```

From the menu:

1. **Set the login password** (only possible on this machine, never from the web).
2. **Configure access**: reverse proxy (recommended; nginx / Caddy / cloudflared terminate HTTPS, multiple domains, nginx config written to `data/nginx.conf`), your own certificate (drop it into `data/certs/`), self-signed, or local only (`http://127.0.0.1:8091/`).
3. **Start**, open the address shown, log in, choose “Add host” and pair with the PIN shown in Sunshine's web UI.

> Browsers only enable video decoding, gamepads and pointer lock on HTTPS or localhost, so use HTTPS when connecting from other devices.

Shortcuts: Ctrl+Alt+Shift+Z releases the mouse, Ctrl+Alt+Shift+Q ends the stream, Ctrl+Alt+Shift+S toggles the stream statistics.

**Settings → Appearance and text** switches between light, dark and system themes and enlarges the text (Large / Extra large); it applies to the current browser only.

### Two-step verification

Turn it on in **Settings → Two-step verification**: confirm the password, scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …) and enter the 6-digit code. You get 10 one-time recovery codes; keep them safe. Other signed-in devices are signed out.

Choose where a code is asked for: **at login** (on by default), **starting a stream**, and **resuming a session** (joining a stream this browser did not start; your own reconnects and page reloads are not affected). After a code you are not asked again for 5 minutes. Lost both the phone and the recovery codes? Run `./start.sh 2fa-off` (`start.bat 2fa-off`) on the bridge machine. Setup only works over HTTPS or on the bridge machine itself, so the secret never crosses the network in clear text.

## Layout

```
sunbridge/
├─ start.bat / start.sh   start and manage
├─ app/                   the program (replace it to upgrade)
├─ data/                  your data, created on first run (git-ignored)
└─ docs/                  images for the docs
```

`data/` holds pairing keys, the account and certificates: never share or commit it, and keep it when upgrading.

## Environment variables (optional)

The menu stores its settings in `data/config.json`; these override them: `SUNBRIDGE_PORT`, `SUNBRIDGE_BIND`, `SUNBRIDGE_TLS` (`cert` / `self-signed` / `off`), `SUNBRIDGE_TLS_CERT`, `SUNBRIDGE_TLS_KEY`, `SUNBRIDGE_TRUST_PROXY`, `SUNBRIDGE_TRUSTED_PROXIES`, `SUNBRIDGE_ALLOWED_ORIGINS`, `SUNBRIDGE_DATA_DIR`.

## Browser support

Latest Chrome / Edge (desktop and Android) are recommended. Other browsers with WebCodecs (recent Safari and Firefox) should work but are not well tested yet. HEVC depends on the platform's hardware decoder.

## License

[GNU General Public License v3.0](LICENSE)

This project is intended for learning and exchange. It is provided “as is”, without warranty of any kind; use it at your own risk and in accordance with applicable laws.

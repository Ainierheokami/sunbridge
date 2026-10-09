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

- **Most efficient codec automatically**: AV1 or HEVC when the browser hardware-decodes them at the stream's resolution and frame rate (30–50% less bitrate than H.264 for the same picture), otherwise the host encodes H.264. If hardware decoding turns out to be unavailable mid-stream, or software decoding can't keep up, it switches automatically.
- **Pass-through, never re-encoded**: the browser decodes the host's original bitstream with WebCodecs (hardware first). No extra quality loss or latency. Receiving, decoding and drawing run in a worker, so a busy page can't hold up the video, and the decoder picks hardware first for the actual bitstream and size.
- **WebRTC (UDP) transport**: video and audio over UDP, so a lost packet costs only its frame instead of stalling the whole TCP connection; paths through a VPS or across ISPs reach their full bandwidth. Falls back to the WebSocket when UDP can't get through. Needs one UDP port open (see below).
- **Lean transport**: video is assembled into whole frames before it leaves your machine, so FEC redundancy and packet headers don't travel over the internet (about 25–30% less bandwidth, given back to the encoder as quality).
- **Adaptive resolution**: matches the browser window in device pixels for crisp text, and follows resizes, rotation and fullscreen (at most one change every 4 seconds); a button in the stream bar keeps the current resolution instead.
- **Interaction test and diagnostic report**: the Network page measures round trip and up/down speed between the browser and Sunbridge, replays fullscreen, keyboard lock and pointer lock exactly as a stream does to show which keys reach the page, and copies or downloads a diagnostic report for bug reports.
- **Two-leg adaptive bitrate with a hard cap**: host → bridge (packet loss, frames FEC couldn't repair) and bridge → browser (queueing delay, backlog, measured throughput) are probed separately and the lower one wins; the stats panel shows both legs. The configured bitrate is a ceiling the encoder is held to.
- **Bounded latency**: under congestion whole frames are dropped until the next keyframe, so the picture pauses briefly instead of smearing or drifting behind.
- **Automatic reconnect**: survives network changes, sleep/wake and service restarts; a reloaded page can rejoin the running stream.
- **Remote desktop mode**: absolute pointer, tap / drag / long-press / two-finger gestures, on-screen keyboard with full text input (including CJK).
- **Clipboard sync**: copied text and images (PNG) between this device and the host; large images go through the host's HTTPS endpoint. Needs [Foundation Sunshine](https://github.com/AlkaidLab/foundation-sunshine) with clipboard sync on and its desktop app running. The browser asks once to allow clipboard reading; without it, the stream toolbar's button sends the clipboard. Ctrl+V on the stream puts this device's clipboard on the host first (image files copied in a file manager included), and images can be dropped on the stream. The protocol carries text and images only: other files can't go through the clipboard.
- **Diagnosis**: the Network page checks every leg: host ports, Sunshine status and pairing, RTSP, the bridge's entrypoints and WebRTC, a real WebRTC connection from the browser, and while streaming the UDP video / audio / control traffic.
- **Game mode**: pointer lock with relative motion, gamepads with rumble.
- **Glitch-free audio**: Opus stereo played through a jitter buffer with clock-drift correction.
- **Set up in the browser**: create the account in the web page on first start; access, certificates and two-step verification are all web settings, and `start.bat` / `start.sh` only start the bridge and get you back in. Installed with git, it checks for updates and updates and restarts itself from the Preferences page.
- **Multiple entrypoints**: several ports at once, each with its own HTTPS and reverse-proxy setting (e.g. one for nginx on this machine, one reached through a router port forward). Certificates are picked by domain, and the allowed domains can be restricted.
- **Logs**: sign-ins, refused connections (address not allowed, untrusted proxy, cross-site requests), settings changes and streams, filterable on the Logs page.
- **Secure by default**: every page and API needs a login, optional two-step verification (authenticator app codes, separately for login, starting a stream and resuming a session), failed logins are rate-limited, cross-site requests are blocked, and pairing keys and account data are never served over the web.

<p align="center">
  <img src="docs/overview.png" alt="Overview" width="49%" />
  <img src="docs/host-settings.png" alt="Host settings" width="49%" />
</p>

## How it works

```
              same machine (or LAN)                            internet / LAN
┌───────────┐   UDP (RTP / FEC)    ┌─────────────┐  WebRTC / WebSocket   ┌──────────────┐
│ Sunshine  │ ───────────────────▶ │  Sunbridge  │ ────────────────────▶ │   Browser    │
│ (encoder) │ ◀─────────────────── │  (bridge)   │ ◀──────────────────── │ (WebCodecs)  │
└───────────┘ control (encrypted)  └─────────────┘  keyboard/mouse/pads  └──────────────┘
```

Sunbridge pairs with Sunshine, negotiates the stream and receives the media, then sends whole video frames and audio to the browser: over WebRTC when UDP gets through, else over the WebSocket, which always carries control messages and input. The browser decodes, plays and captures input. It speaks the standard GameStream protocol, so the host needs no changes.

## Quick start

Requires [Node.js](https://nodejs.org/) 18+ (20+ recommended) and a host running Sunshine.

```bash
git clone https://github.com/Ainierheokami/sunbridge.git
cd sunbridge
./start.sh        # Windows: double-click start.bat
```

1. Choose **Start**. By default it listens on all networks, port 8091, HTTPS with a self-signed certificate, and prints the addresses and a **setup code**.
2. Open `https://<this computer's IP>:8091/` in any browser, accept the certificate warning, and **create the account** with the setup code.
3. Choose “Add host” and pair with the PIN shown in Sunshine's web UI.
4. For domains, a reverse proxy or a router port forward, add entrypoints, certificates and allowed domains under **Access**. A change must be confirmed from the new address within 60 seconds or it is undone, so you cannot lock yourself out.

The script keeps a few commands: `start`, `status` (addresses, setup code, recent warnings), `reset-network` (back to the default network settings when the page is unreachable), `passwd`, `logout-all`, `2fa-off`.

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
├─ app/                   the program (replace it to upgrade; dependencies go to app/node_modules on first start)
├─ data/                  your data, created on first run (git-ignored)
└─ docs/                  images for the docs
```

`data/` holds pairing keys, the account and certificates: never share or commit it, and keep it when upgrading.

## Environment variables (optional)

Settings live in `data/config.json` and are edited in the web page. When the port / bind variables are set they define a single entrypoint and the web entrypoint settings become read-only: `SUNBRIDGE_PORT`, `SUNBRIDGE_BIND`, `SUNBRIDGE_TLS` (`off` disables HTTPS), `SUNBRIDGE_TLS_CERT`, `SUNBRIDGE_TLS_KEY`, `SUNBRIDGE_TRUST_PROXY`, `SUNBRIDGE_TRUSTED_PROXIES`, `SUNBRIDGE_ALLOWED_ORIGINS`, `SUNBRIDGE_DATA_DIR`.

## WebRTC (UDP)

The browser must reach one UDP port on the bridge, by default the same number as the web port (e.g. 8091/TCP and 8091/UDP):
- Direct: forward that UDP port on the router to the Sunbridge machine and allow it in the firewall.
- Through a VPS (EasyTier, frp, ...): add a **UDP forward of the same port** to this machine and allow UDP in the VPS firewall, e.g. EasyTier `--port-forward udp://0.0.0.0:8091/<virtual IP of the PC>:8091`.
- The address is the one the page was opened with; behind a reverse proxy, or with a different UDP port, set the public address in Access → WebRTC (UDP).

If UDP can't get through, media moves to the WebSocket after about 8 seconds and the stats panel ("Media channel") says why. The `node-datachannel` dependency is installed on the first start; without it (offline, npm blocked) WebRTC is unavailable and everything else works. `./start.sh deps` (Windows: `start.bat deps`, or “install / repair dependencies” in the menu) installs it again and explains a failure.

## Browser support

Latest Chrome / Edge (desktop and Android) are recommended. Other browsers with WebCodecs (recent Safari and Firefox) should work but are not well tested yet. HEVC depends on the platform's hardware decoder.

## License

[GNU General Public License v3.0](LICENSE)

This project is intended for learning and exchange. It is provided “as is”, without warranty of any kind; use it at your own risk and in accordance with applicable laws.

// WebRTC transport for media (optional dependency node-datachannel, a binding of libdatachannel).
//
// Video and audio go to the browser over two DataChannels on UDP instead of the WebSocket's TCP connection:
// a packet lost on the way then costs only the frame it belonged to, instead of stalling everything behind
// it until TCP has retransmitted it (head-of-line blocking), which is what made streams through a VPS stutter
// while Moonlight (UDP) ran fine on the same path.
//   - video: unordered, retransmitted for at most VIDEO_PACKET_LIFETIME_MS; frames are split into fragments of
//     at most RTC_FRAGMENT_BYTES (SCTP messages are capped at 256 KB), each with an 8-byte header
//     (u32 sequence number of the frame on this channel, u16 fragment index, u16 fragment count);
//   - audio: unordered, retransmitted for at most AUDIO_PACKET_LIFETIME_MS (later it is useless); each message
//     carries the packet and the one before it, so a lost message is covered by the next one.
// The WebSocket stays: it carries signalling, input and stats, and media again whenever WebRTC is unavailable.
// Every browser shares one UDP port (ICE UDP mux). The browser is told to reach it at the address it used for
// the page (resolved to IPs here) unless a public address is configured.
import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let ndc = null;
let loadError = null;
try {
  ndc = require('node-datachannel');
} catch (error) {
  loadError = error;
}

export const RTC_FRAGMENT_BYTES = 60 * 1024;
export const RTC_FRAGMENT_HEADER_BYTES = 8;
export const VIDEO_PACKET_LIFETIME_MS = 150;
export const AUDIO_PACKET_LIFETIME_MS = 80;
const GATHER_TIMEOUT_MS = 1500;
const MAX_MESSAGE_BYTES = 256 * 1024;

// Native builds of node-datachannel present in node_modules (one per platform: linux-x64-gnu, win32-x64-msvc...).
function installedNativePackages() {
  try {
    return fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', '@node-datachannel'));
  } catch {
    return [];
  }
}

// reason: 'module-missing' (node-datachannel could not be loaded when the bridge started: not installed, or
// installed without the native build for this platform) or 'disabled' (turned off in the settings).
export function rtcSupport(settings) {
  if (!ndc) {
    return {
      available: false,
      reason: 'module-missing',
      detail: loadError ? String(loadError.message || loadError).split('\n')[0].slice(0, 200) : null,
      platform: `${process.platform}-${process.arch}`,
      native: installedNativePackages(),
    };
  }
  if (settings?.enabled === false) return { available: false, reason: 'disabled' };
  return { available: true, reason: null };
}

// Answer a browser's offer. Returns { pc, sdp }: the PeerConnection (its DataChannels arrive through
// onChannel) and the answer with the public address added as a candidate.
export async function answerOffer({ offer, port, publicHost, publicPort, onChannel, onState }) {
  const pc = new ndc.PeerConnection('sunbridge', {
    iceServers: [],
    enableIceUdpMux: true,
    portRangeBegin: port,
    portRangeEnd: port,
    maxMessageSize: MAX_MESSAGE_BYTES,
  });
  try {
    pc.onStateChange((state) => onState?.(state));
    pc.onDataChannel((channel) => onChannel?.(channel));
    const gathered = new Promise((resolve) => {
      pc.onGatheringStateChange((state) => { if (state === 'complete') resolve(); });
      setTimeout(resolve, GATHER_TIMEOUT_MS);
    });
    pc.setRemoteDescription(String(offer), 'offer');
    await gathered;
    const local = pc.localDescription();
    if (!local?.sdp) throw new Error('no local description');
    const addresses = await resolveAddresses(publicHost);
    return { pc, sdp: addCandidates(local.sdp, addresses, publicPort || port) };
  } catch (error) {
    try { pc.close(); } catch { /* already closed */ }
    throw error;
  }
}

async function resolveAddresses(host) {
  const name = String(host || '').replace(/^\[|\]$/g, '');
  if (!name) return [];
  if (net.isIP(name)) return [name];
  if (name === 'localhost') return ['127.0.0.1'];
  try {
    return [...new Set((await dns.lookup(name, { all: true })).map((entry) => entry.address))];
  } catch {
    return [];
  }
}

// Host candidates for the public address(es), ahead of the ones libdatachannel gathered (LAN, virtual
// network adapters), which stay for browsers on the same network.
function addCandidates(sdp, addresses, port) {
  const lines = sdp.split(/\r?\n/).filter((line) => line !== '');
  const present = new Set(lines.filter((line) => line.startsWith('a=candidate:')).map((line) => {
    const parts = line.split(' ');
    return `${parts[4]} ${parts[5]}`;
  }));
  const extra = addresses
    .filter((address) => !present.has(`${address} ${port}`))
    .map((address, index) => `a=candidate:sb${index + 1} 1 UDP ${2130706431 - index} ${address} ${port} typ host`);
  if (!extra.length) return sdp;
  const firstCandidate = lines.findIndex((line) => line.startsWith('a=candidate:'));
  const endOfCandidates = lines.indexOf('a=end-of-candidates');
  const at = firstCandidate >= 0 ? firstCandidate : endOfCandidates >= 0 ? endOfCandidates : lines.length;
  lines.splice(at, 0, ...extra);
  return `${lines.join('\r\n')}\r\n`;
}

// Split one video envelope into DataChannel messages.
export function fragmentFrame(sequence, envelope) {
  const count = Math.max(1, Math.ceil(envelope.length / RTC_FRAGMENT_BYTES));
  const messages = [];
  for (let index = 0; index < count; index += 1) {
    const part = envelope.subarray(index * RTC_FRAGMENT_BYTES, (index + 1) * RTC_FRAGMENT_BYTES);
    const message = Buffer.allocUnsafe(RTC_FRAGMENT_HEADER_BYTES + part.length);
    message.writeUInt32BE(sequence >>> 0, 0);
    message.writeUInt16BE(index, 4);
    message.writeUInt16BE(count, 6);
    part.copy(message, RTC_FRAGMENT_HEADER_BYTES);
    messages.push(message);
  }
  return messages;
}

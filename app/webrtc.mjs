// WebRTC transport for media (optional dependency node-datachannel, a binding of libdatachannel).
//
// Video and audio go to the browser over two DataChannels on UDP instead of the WebSocket's TCP connection:
// a packet lost on the way then costs only the frame it belonged to, instead of stalling everything behind
// it until TCP has retransmitted it (head-of-line blocking), which is what made streams through a VPS stutter
// while Moonlight (UDP) ran fine on the same path.
//   - video: unordered, each message retransmitted at most VIDEO_MAX_RETRANSMITS times (a count, not a lifetime:
//     SCTP starts a lifetime when the message is queued, so a big keyframe burst expired before it was even sent
//     and the browser waited for one keyframe after another). Frames are split into fragments that fit one
//     SCTP packet (RTC_FRAGMENT_BYTES + a 16-byte header, see RTC_FRAGMENT_HEADER_BYTES), so a lost packet costs
//     one fragment instead of 60 KB, grouped into FEC blocks of at most RTC_BLOCK_FRAGMENTS like Sunshine's.
//     Optional parity fragments per block (Reed-Solomon, as Sunshine's FEC) let the browser rebuild a block from
//     any as many of its fragments as it has data fragments; the setting is fecPercent, 0 = off;
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

// One fragment per SCTP packet: libdatachannel's default MTU (1280) less IPv6, UDP, DTLS, SCTP and DATA chunk
// headers leaves about 1150 bytes for a message.
export const RTC_FRAGMENT_BYTES = 1120;
// u32 frame sequence, u32 envelope length, u16 first data fragment of the block, u16 data fragments in the block,
// u16 parity fragments in the block, u16 index in the block (data first, then parity).
export const RTC_FRAGMENT_HEADER_BYTES = 16;
// Data fragments per FEC block. Encoding costs (parity fragments per block) table lookups per byte on the main
// thread: 24 keeps 20 Mbps at 20 % FEC around 3 % of a core (64 took 15 %, and a keyframe blocked for 50 ms).
export const RTC_BLOCK_FRAGMENTS = 24;
export const RTC_FEC_MAX_PERCENT = 50;
export const VIDEO_MAX_RETRANSMITS = 3;
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

// GF(2^8) with polynomial 0x11d, the field Sunshine's FEC uses (media.js recoverShards decodes it).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}
const gfInv = (a) => GF_EXP[255 - GF_LOG[a]];
// GF_MUL[c][v] = c * v
const GF_MUL = Array.from({ length: 256 }, (_, c) => {
  const table = new Uint8Array(256);
  if (c) for (let v = 1; v < 256; v += 1) table[v] = GF_EXP[GF_LOG[c] + GF_LOG[v]];
  return table;
});

// Parity fragments for a block's data fragments: parity j = sum over i of INV[(m + i) ^ j] * data[i], the
// Cauchy matrix of Sunshine's FEC. Data fragments are zero-padded to RTC_FRAGMENT_BYTES. Rounded up, so any
// block gets at least one parity fragment while FEC is on.
export function parityCount(dataCount, fecPercent) {
  const percent = Math.min(RTC_FEC_MAX_PERCENT, Math.max(0, Number(fecPercent) || 0));
  return Math.min(Math.ceil((dataCount * percent) / 100), 255 - dataCount);
}

function parityFragments(data, parities) {
  const out = [];
  for (let j = 0; j < parities; j += 1) {
    const acc = Buffer.alloc(RTC_FRAGMENT_BYTES);
    data.forEach((part, i) => {
      const mul = GF_MUL[gfInv((parities + i) ^ j)];
      for (let b = 0; b < part.length; b += 1) acc[b] ^= mul[part[b]];
    });
    out.push(acc);
  }
  return out;
}

// Split one video envelope into DataChannel messages, block by block: its data fragments, then its parity.
// Blocks are made even in size so the last one isn't a lone fragment with a parity fragment of its own.
export function fragmentFrame(sequence, envelope, fecPercent = 0) {
  const total = Math.max(1, Math.ceil(envelope.length / RTC_FRAGMENT_BYTES));
  const perBlock = Math.ceil(total / Math.ceil(total / RTC_BLOCK_FRAGMENTS));
  const messages = [];
  for (let first = 0; first < total; first += perBlock) {
    const data = [];
    for (let index = first; index < Math.min(total, first + perBlock); index += 1) data.push(envelope.subarray(index * RTC_FRAGMENT_BYTES, (index + 1) * RTC_FRAGMENT_BYTES));
    const parities = parityCount(data.length, fecPercent);
    const parts = parities ? [...data, ...parityFragments(data, parities)] : data;
    parts.forEach((part, index) => {
      const message = Buffer.allocUnsafe(RTC_FRAGMENT_HEADER_BYTES + part.length);
      message.writeUInt32BE(sequence >>> 0, 0);
      message.writeUInt32BE(envelope.length >>> 0, 4);
      message.writeUInt16BE(first, 8);
      message.writeUInt16BE(data.length, 10);
      message.writeUInt16BE(parities, 12);
      message.writeUInt16BE(index, 14);
      part.copy(message, RTC_FRAGMENT_HEADER_BYTES);
      messages.push(message);
    });
  }
  return messages;
}

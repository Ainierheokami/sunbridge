// Clipboard sync with Foundation Sunshine (the protocol of its Android client, moonlight-android's
// ClipboardSyncManager): control-stream packet 0x5508 carries an opaque frame for Sunshine's desktop agent,
//   [u8 version = 1][u8 kind][u32le token][u32le length][payload]
// kind 1 = UTF-8 text, 2 = PNG, 3 = reference: {"type":"ref","id","mime","size"} to a blob uploaded to (or
// offered by) the host's paired HTTPS endpoint /api/v1/clipboard/blob, for payloads too large for one
// control message. Every frame sent carries a fresh token; the agent echoes it back when it applies our
// content to the host clipboard, so frames carrying a token we sent in the last few seconds are dropped.
// The host advertises the feature in its RTSP DESCRIBE answer (x-ss-general.featureFlags 0x04 text,
// 0x08 image) only when clipboard sync is on in Sunshine and its desktop agent is running.
import crypto from 'node:crypto';

export const KIND = Object.freeze({ TEXT: 1, PNG: 2, REF: 3 });
export const FEATURE_CLIPBOARD_TEXT = 0x04;
export const FEATURE_CLIPBOARD_IMAGE = 0x08;
const WIRE_VERSION = 1;
const HEADER_BYTES = 10;
// Sunshine caps a frame at 65500 bytes and its encrypted control length at 65535; stay well inside both.
export const INLINE_MAX_BYTES = 60000 - HEADER_BYTES;
export const BLOB_MAX_BYTES = 64 * 1024 * 1024;
const ECHO_TTL_MS = 5000;
const STORE_TTL_MS = 5 * 60 * 1000;
const STORE_MAX_ITEMS = 4;

export function encodeFrame(kind, payload, token = crypto.randomInt(0, 0x100000000)) {
  const frame = Buffer.alloc(HEADER_BYTES + payload.length);
  frame[0] = WIRE_VERSION;
  frame[1] = kind;
  frame.writeUInt32LE(token >>> 0, 2);
  frame.writeUInt32LE(payload.length, 6);
  payload.copy(frame, HEADER_BYTES);
  return { frame, token: token >>> 0 };
}

export function decodeFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < HEADER_BYTES || frame[0] !== WIRE_VERSION) return null;
  const length = frame.readUInt32LE(6);
  if (length > frame.length - HEADER_BYTES) return null;
  return { kind: frame[1], token: frame.readUInt32LE(2), payload: frame.subarray(HEADER_BYTES, HEADER_BYTES + length) };
}

export function parseRef(payload) {
  try {
    const ref = JSON.parse(payload.toString('utf8'));
    const id = String(ref.id || '').trim();
    const mime = String(ref.mime || '').trim();
    const size = Number(ref.size);
    if ((ref.type && ref.type !== 'ref') || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !mime || !Number.isFinite(size) || size < 0) return null;
    return { id, mime, size };
  } catch {
    return null;
  }
}

// Only UTF-8 (or ASCII) text, as the Android client: other charsets would decode into mojibake.
export function isTextMime(mime) {
  const lower = String(mime || '').toLowerCase();
  if (!lower.startsWith('text/')) return false;
  const charset = lower.match(/;\s*charset=([^;\s]+)/)?.[1]?.replace(/"/g, '');
  return !charset || ['utf-8', 'utf8', 'us-ascii'].includes(charset);
}

export function featureFlagsFromSdp(sdp) {
  const value = String(sdp || '').match(/a=x-ss-general\.featureFlags:\s*(\d+)/)?.[1];
  const flags = value ? Number(value) : 0;
  return { text: Boolean(flags & FEATURE_CLIPBOARD_TEXT), image: Boolean(flags & FEATURE_CLIPBOARD_IMAGE) };
}

// Tokens of frames we sent recently (host echo suppression).
export function createEchoFilter() {
  const sent = new Map(); // token -> sentAt
  const prune = (now) => { for (const [token, at] of sent) if (now - at > ECHO_TTL_MS) sent.delete(token); };
  return {
    sent(token) { const now = Date.now(); prune(now); sent.set(token >>> 0, now); },
    isEcho(token) { const now = Date.now(); prune(now); return sent.delete(token >>> 0); },
  };
}

// Host clipboard content waiting for browsers to fetch it (images, large text): the last few items, briefly.
export function createStore() {
  const items = new Map(); // id -> { data, mime, at }
  return {
    put(data, mime) {
      const now = Date.now();
      for (const [id, item] of items) if (now - item.at > STORE_TTL_MS) items.delete(id);
      while (items.size >= STORE_MAX_ITEMS) items.delete(items.keys().next().value);
      const id = crypto.randomBytes(12).toString('base64url');
      items.set(id, { data, mime, at: now });
      return id;
    },
    get(id) {
      const item = items.get(String(id));
      return item && Date.now() - item.at <= STORE_TTL_MS ? item : null;
    },
  };
}

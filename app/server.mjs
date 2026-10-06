import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { ControlStream, encodeBrowserInput } from './control.mjs';
import { createAuth } from './auth.mjs';
// The browser's media code (RTP / FEC / frame assembly) also runs here: the bridge assembles video frames itself.
await import('./media.js');
const Media = globalThis.SunbridgeMedia;

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const DATA_DIR = process.env.SUNBRIDGE_DATA_DIR ? path.resolve(process.env.SUNBRIDGE_DATA_DIR) : path.join(ROOT, '..', 'data');  // <install>/data next to app/
const IDENTITY_FILE = path.join(DATA_DIR, 'identity.json');
const HOSTS_FILE = path.join(DATA_DIR, 'hosts.json');
// Saved settings from `manage.bat` / `manage.sh` (scripts/manage.mjs); environment variables override them.
const CONFIG = loadJson(path.join(DATA_DIR, 'config.json'), null) || {};
const envList = (value) => (value === undefined ? null : String(value).split(',').map((item) => item.trim()).filter(Boolean));
const PORT = Number(process.env.SUNBRIDGE_PORT || process.env.PORT || CONFIG.port || 8091);
const BIND = process.env.SUNBRIDGE_BIND || CONFIG.bind || '127.0.0.1';
const LOOPBACK_BIND = ['127.0.0.1', '::1', 'localhost'].includes(BIND);
// Set when a reverse proxy / tunnel terminates TLS in front of the bridge (trusts X-Forwarded-*).
const TRUST_PROXY = process.env.SUNBRIDGE_TRUST_PROXY !== undefined
  ? ['1', 'true', 'yes'].includes(String(process.env.SUNBRIDGE_TRUST_PROXY).toLowerCase())
  : CONFIG.trustProxy === true;
// Addresses (IPs or CIDRs) of the reverse proxy. With TRUST_PROXY on, only these may connect at all, so
// X-Forwarded-* cannot be forged even when the bridge listens on a LAN or Docker interface.
const TRUSTED_PROXIES = envList(process.env.SUNBRIDGE_TRUSTED_PROXIES)
  || (Array.isArray(CONFIG.trustedProxies) && CONFIG.trustedProxies.length ? CONFIG.trustedProxies : ['127.0.0.1', '::1']);
const TLS_CERT_FILE = process.env.SUNBRIDGE_TLS_CERT || CONFIG.tlsCert || '';
const TLS_KEY_FILE = process.env.SUNBRIDGE_TLS_KEY || CONFIG.tlsKey || '';
const TLS_HOSTNAMES = envList(process.env.SUNBRIDGE_TLS_HOSTNAMES) || (Array.isArray(CONFIG.tlsHostnames) ? CONFIG.tlsHostnames : []);
// TLS: "cert" (your own certificate + key PEM files, e.g. for a domain), "self-signed", or "off".
// The legacy value "auto" means cert when cert files are configured, otherwise self-signed. HTTPS is
// the default when listening beyond loopback without a trusted proxy, because WebCodecs, gamepads
// and pointer lock only work in a secure context.
const TLS_MODE = (() => {
  const raw = String(process.env.SUNBRIDGE_TLS || CONFIG.tls || '').toLowerCase();
  if (['off', 'cert', 'self-signed'].includes(raw)) return raw;
  if (raw === 'auto' || TLS_CERT_FILE || (!LOOPBACK_BIND && !TRUST_PROXY)) return TLS_CERT_FILE ? 'cert' : 'self-signed';
  return 'off';
})();
const EXTRA_ORIGINS = envList(process.env.SUNBRIDGE_ALLOWED_ORIGINS) || (Array.isArray(CONFIG.allowedOrigins) ? CONFIG.allowedOrigins : []);
const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/assets/sunbridge-icon.svg', '/favicon.ico']);
const VERSION = '0.2.0';
const DEFAULT_HTTP_PORT = 47989;
const DEFAULT_HTTPS_PORT = 47984;
const REQUEST_TIMEOUT_MS = 7000;
const DEFAULT_RTSP_PORT = 48010;
const RTSP_PROBE_TIMEOUT_MS = 4500;
const RTSP_CLIENT_VERSION = 14;
const CLIENT_NAME = process.env.SUNBRIDGE_CLIENT_NAME || 'Sunbridge';
const DEFAULT_VIDEO_PORT = 47998;
const DEFAULT_CONTROL_PORT = 47999;
const DEFAULT_AUDIO_PORT = 48000;
const RTSP_CONNECT_RETRIES = 5;
const RTSP_CONNECT_RETRY_DELAY_MS = 220;
const UDP_PING_INTERVAL_MS = 500;
const MEDIA_EVENT_THROTTLE_MS = 250;
const SESSION_EVENT_HEARTBEAT_MS = 15000;
const MEDIA_GATEWAY_PATH = '/api/bridge/media';
const MEDIA_GATEWAY_PROTOCOL = 'sunbridge-media-v1';
const MEDIA_GATEWAY_MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MEDIA_STREAM_IDS = { video: 1, audio: 2, control: 3, videoFrame: 4 };
const AUDIO_FEC_PAYLOAD_TYPE = 127;
// ServerCodecModeSupport bits (GameStream protocol)
const SCM_HEVC = 0x100;
const SCM_AV1_MAIN8 = 0x10000;
const VIDEO_CODECS = { h264: 0, hevc: 1, av1: 2 };
// Stop queueing media for a browser that cannot keep up: past this much unsent data, packets are dropped
// (the browser sees the loss, waits for the next keyframe and requests one) instead of latency growing.
// Never queue more than ~0.3 s of media for one browser (at least 256 KB): on a slow internet link a fixed
// multi-megabyte queue would mean seconds of latency. Past it, packets are dropped (the browser recovers with an IDR).
const MEDIA_GATEWAY_BACKPRESSURE_MIN_BYTES = 256 * 1024;
const MEDIA_GATEWAY_BACKPRESSURE_SECONDS = 0.3;
// Adaptive bitrate for the bridge -> browser link (Sunshine -> bridge is usually the same machine).
const ABR_MIN_KBPS = 1500;
// Sunshine's default video FEC; corrected from the packets once the stream runs.
const ASSUMED_FEC_PERCENT = 20;
// The kernel's TCP send buffer (auto-tuned to megabytes) hides a slow link from writableLength, so the browser's
// measured queueing delay is the authority: past DRAIN_ENTER the bridge stops sending video to that browser until
// the backlog has drained below DRAIN_EXIT, then asks for a keyframe. Latency stays bounded even when the encoder
// can't follow (stock Sunshine has no live bitrate change).
const DRAIN_ENTER_MS = 350;
const DRAIN_EXIT_MS = 120;
const DRAIN_MAX_MS = 5000;
const ABR_REMOTE_START_KBPS = 8000;
const MEDIA_STATS_INTERVAL_MS = 1000;
const MEDIA_GATEWAY_BATCH_BYTES = 256 * 1024;
// Automatic reconnect to the host (network blip, host Wi-Fi roaming, sleep): RTSP/UDP/control are rebuilt via
// Sunshine /resume, so the app on the host keeps running and browsers stay attached to the same session.
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MEDIA_STALL_IDR_MS = 4000;
const MEDIA_STALL_RECONNECT_MS = 12000;
// Sunshine protocol extension (this fork): change stream parameters live over the control stream.
const CONTROL_DYNAMIC_PARAM = 0x5506;
// ML_ERROR_GRACEFUL_TERMINATION: the host ended the stream on purpose.
const SUNSHINE_GRACEFUL_TERMINATION = 0x80030023;
const DYNAMIC_PARAM = { RESOLUTION: 0, BITRATE: 2 };
const SS_ENC_CONTROL_V2 = 0x01;
const CONTROL_PROTOCOL_ENCRYPTED = 13;
const INPUT_EVENT_THROTTLE_MS = 1000;
// Per-session secrets (remote input AES key) kept out of API snapshots.
const sessionSecrets = new WeakMap();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, value) {
  ensureDataDir();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function concat(...parts) {
  return Buffer.concat(parts.map(toBuffer));
}

function hex(buffer) {
  return Buffer.from(buffer).toString('hex').toUpperCase();
}

function fromHex(value) {
  const text = String(value || '').replace(/\s+/g, '');
  if (!/^(?:[0-9a-f]{2})*$/i.test(text)) throw new Error('无效的十六进制数据');
  return Buffer.from(text, 'hex');
}

function base64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function unbase64(value) {
  return Buffer.from(String(value || ''), 'base64');
}

function randomBytes(length) {
  return crypto.randomBytes(length);
}

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, content = Buffer.alloc(0)) {
  const body = toBuffer(content);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function derSequence(...items) {
  return der(0x30, Buffer.concat(items.map(toBuffer)));
}

function derSet(...items) {
  return der(0x31, Buffer.concat(items.map(toBuffer)));
}

function derInteger(value) {
  let bytes;
  if (typeof value === 'number') {
    if (value === 0) bytes = Buffer.from([0]);
    else {
      const output = [];
      let current = value;
      while (current > 0) {
        output.unshift(current & 0xff);
        current = Math.floor(current / 256);
      }
      bytes = Buffer.from(output);
    }
  } else {
    bytes = Buffer.from(value);
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length === 0) bytes = Buffer.from([0]);
  }
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}

function derOid(oid) {
  const numbers = oid.split('.').map(Number);
  if (numbers.length < 2) throw new Error('无效的 OID');
  const output = [numbers[0] * 40 + numbers[1]];
  for (const number of numbers.slice(2)) {
    const chunks = [number & 0x7f];
    let remaining = Math.floor(number / 128);
    while (remaining > 0) {
      chunks.unshift(0x80 | (remaining & 0x7f));
      remaining = Math.floor(remaining / 128);
    }
    output.push(...chunks);
  }
  return der(0x06, Buffer.from(output));
}

function derNull() {
  return Buffer.from([0x05, 0x00]);
}

function derUtf8(text) {
  return der(0x0c, Buffer.from(String(text), 'utf8'));
}

function derBitString(value) {
  return der(0x03, Buffer.concat([Buffer.from([0]), toBuffer(value)]));
}

function derExplicit(tagNumber, content) {
  return der(0xa0 | tagNumber, content);
}

function generalizedTime(date) {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return der(0x18, Buffer.from(`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`, 'ascii'));
}

function commonName(name) {
  return derSequence(derOid('2.5.4.3'), derUtf8(name));
}

function distinguishedName(name) {
  return derSequence(derSet(commonName(name)));
}

function utcTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return der(0x17, Buffer.from(`${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`, 'ascii'));
}

function tlsHostnames() {
  const names = new Set(['localhost', '127.0.0.1', '::1', os.hostname().toLowerCase()]);
  for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) if (!item.internal) names.add(item.address);
  for (const name of TLS_HOSTNAMES) if (String(name).trim()) names.add(String(name).trim().toLowerCase());
  return [...names].sort();
}

// Self-signed server certificate with subjectAltName entries (browsers ignore the CN).
function makeServerCertificate(hostnames) {
  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const now = new Date(Date.now() - 60 * 60 * 1000);
  const expiry = new Date(now.getTime() + 397 * 24 * 60 * 60 * 1000);
  const signatureAlgorithm = derSequence(derOid('1.2.840.113549.1.1.11'), derNull());
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const name = distinguishedName('Sunbridge');
  const altNames = hostnames.map((host) => {
    if (net.isIPv4(host)) return der(0x87, Buffer.from(host.split('.').map(Number)));
    if (net.isIPv6(host)) {
      const url = new URL(`http://[${host}]/`).hostname.slice(1, -1);
      const parts = url.split('::');
      const head = parts[0] ? parts[0].split(':') : [];
      const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
      const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
      return der(0x87, Buffer.concat(groups.map((group) => { const b = Buffer.alloc(2); b.writeUInt16BE(parseInt(group || '0', 16)); return b; })));
    }
    return der(0x82, Buffer.from(host, 'ascii'));
  });
  const extensions = derExplicit(3, derSequence(
    derSequence(derOid('2.5.29.17'), der(0x04, derSequence(...altNames))),
    derSequence(derOid('2.5.29.37'), der(0x04, derSequence(derOid('1.3.6.1.5.5.7.3.1')))),
  ));
  const tbs = derSequence(
    derExplicit(0, derInteger(2)),
    derInteger(serial),
    signatureAlgorithm,
    name,
    derSequence(utcTime(now), utcTime(expiry)),
    name,
    keyPair.publicKey,
    extensions,
  );
  const signature = crypto.sign('sha256', tbs, keyPair.privateKey);
  const certificateDer = derSequence(tbs, signatureAlgorithm, derBitString(signature));
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${certificateDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    key: keyPair.privateKey,
  };
}

// Your own certificate (e.g. fullchain.pem + privkey.pem for a domain). Throws a readable error when
// the files are missing or the key does not belong to the certificate.
function readOwnCertificate() {
  if (!TLS_CERT_FILE || !TLS_KEY_FILE) throw new Error('tls=cert 需要同时配置证书 (tlsCert / SUNBRIDGE_TLS_CERT) 和私钥 (tlsKey / SUNBRIDGE_TLS_KEY)，可运行 start.bat / start.sh重新配置');
  const cert = fs.readFileSync(TLS_CERT_FILE);
  const key = fs.readFileSync(TLS_KEY_FILE);
  const x509 = new crypto.X509Certificate(cert);
  if (!x509.checkPrivateKey(crypto.createPrivateKey(key))) throw new Error(`证书和私钥不匹配：${TLS_CERT_FILE} / ${TLS_KEY_FILE}`);
  const chainLength = (cert.toString('utf8').match(/-----BEGIN CERTIFICATE-----/g) || []).length;
  const names = (x509.subjectAltName || '').split(', ').filter((item) => item.startsWith('DNS:')).map((item) => item.slice(4));
  return { cert, key, x509, names, incompleteChain: chainLength < 2 && x509.issuer !== x509.subject };
}

function loadTlsOptions() {
  if (TLS_MODE === 'off') return null;
  if (TLS_MODE === 'cert') {
    const own = readOwnCertificate();
    return { cert: own.cert, key: own.key, own, source: TLS_CERT_FILE };
  }
  const file = path.join(DATA_DIR, 'tls.json');
  const hostnames = tlsHostnames();
  const stored = loadJson(file, null);
  const valid = stored?.cert && stored?.key && JSON.stringify(stored.hostnames) === JSON.stringify(hostnames) && (() => {
    try { return new Date(new crypto.X509Certificate(stored.cert).validTo).getTime() - Date.now() > 7 * 24 * 60 * 60 * 1000; } catch { return false; }
  })();
  if (valid) return { cert: stored.cert, key: stored.key, source: `self-signed (${file})` };
  const generated = makeServerCertificate(hostnames);
  saveJson(file, { hostnames, ...generated, createdAt: new Date().toISOString() });
  return { ...generated, source: `self-signed, newly generated (${file})` };
}

function makeClientCertificate(keyPair) {
  const publicKeyDer = keyPair.publicKey;
  const now = new Date();
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 20);
  const signatureAlgorithm = derSequence(derOid('1.2.840.113549.1.1.11'), derNull());
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const name = distinguishedName('NVIDIA GameStream Client');
  const tbs = derSequence(
    derExplicit(0, derInteger(2)),
    derInteger(serial),
    signatureAlgorithm,
    name,
    derSequence(generalizedTime(now), generalizedTime(expiry)),
    name,
    publicKeyDer,
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(tbs);
  signer.end();
  const signature = signer.sign(keyPair.privateKey);
  const certificateDer = derSequence(tbs, signatureAlgorithm, derBitString(signature));
  return {
    certificateDer,
    certificatePem: `-----BEGIN CERTIFICATE-----\n${certificateDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    privateKeyPem: keyPair.privateKey,
  };
}

function createIdentity() {
  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const certificate = makeClientCertificate(keyPair);
  return {
    uniqueId: randomBytes(8).toString('hex').toUpperCase(),
    clientName: CLIENT_NAME,
    certificatePem: certificate.certificatePem,
    certificateDerBase64: base64(certificate.certificateDer),
    privateKeyPem: certificate.privateKeyPem,
    createdAt: new Date().toISOString(),
  };
}

function validateIdentity(identity) {
  if (!identity?.uniqueId || !identity?.certificatePem || !identity?.privateKeyPem) {
    throw new Error('本地客户端身份文件不完整');
  }
  try {
    const certificate = new crypto.X509Certificate(identity.certificatePem);
    if (!certificate.verify(certificate.publicKey)) throw new Error('本地客户端证书自校验失败');
    const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
    if (typeof certificate.checkPrivateKey === 'function' && !certificate.checkPrivateKey(privateKey)) {
      throw new Error('本地客户端证书与私钥不匹配');
    }
    if (!identity.certificateDerBase64 && certificate.raw) identity.certificateDerBase64 = base64(certificate.raw);
    return identity;
  } catch (error) {
    throw new Error(`本地客户端身份无效：${safeError(error)}。请删除 ${IDENTITY_FILE} 后重新启动 Bridge`);
  }
}

function loadIdentity() {
  ensureDataDir();
  const existing = loadJson(IDENTITY_FILE, null);
  if (existing?.uniqueId && existing?.certificatePem && existing?.privateKeyPem) {
    const identity = validateIdentity(existing);
    // The client name is only a label sent to Sunshine; pairing is tied to the certificate, not the name.
    const renamed = identity.clientName !== CLIENT_NAME;
    if (renamed) identity.clientName = CLIENT_NAME;
    if (!existing.certificateDerBase64 || renamed) saveJson(IDENTITY_FILE, identity);
    return identity;
  }
  const identity = createIdentity();
  validateIdentity(identity);
  saveJson(IDENTITY_FILE, identity);
  return identity;
}

const identity = loadIdentity();
function makeAddressMatcher(entries) {
  const blockList = new net.BlockList();
  const family = (address) => (net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null);
  for (const entry of entries) {
    const [address, prefix] = String(entry).trim().split('/');
    const type = family(address);
    const bits = Number(prefix);
    if (!type || (prefix !== undefined && !(Number.isInteger(bits) && bits >= 0 && bits <= (type === 'ipv4' ? 32 : 128)))) {
      throw new Error(`反向代理地址无效：${entry}（应为 IP 或 CIDR，如 172.16.0.0/12）`);
    }
    if (prefix === undefined) blockList.addAddress(address, type);
    else blockList.addSubnet(address, bits, type);
  }
  return (remote) => {
    const address = String(remote || '').replace(/^::ffff:/, '');
    const type = family(address);
    return Boolean(type) && blockList.check(address, type);
  };
}

let isTrustedProxy;
try {
  isTrustedProxy = makeAddressMatcher(TRUSTED_PROXIES);
} catch (error) {
  console.error(safeError(error));
  process.exit(1);
}

// Log each refused address once so the user can see which IP their proxy actually connects from.
const refusedProxyAddresses = new Set();
function refuseUntrustedProxy(socket) {
  if (!TRUST_PROXY) return false;
  const remote = String(socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (isTrustedProxy(remote)) return false;
  if (!refusedProxyAddresses.has(remote) && refusedProxyAddresses.size < 100) {
    refusedProxyAddresses.add(remote);
    console.warn(`[proxy] 拒绝来自 ${remote} 的连接：不在反向代理地址列表（${TRUSTED_PROXIES.join(', ')}）里。如果这是你的 nginx，把它加到 config.json 的 trustedProxies。`);
  }
  return true;
}

let tlsOptions;
try {
  tlsOptions = loadTlsOptions();
} catch (error) {
  console.error(`HTTPS 证书加载失败：${safeError(error)}`);
  process.exit(1);
}
const auth = createAuth({ dataDir: DATA_DIR, trustProxy: TRUST_PROXY, secure: Boolean(tlsOptions), extraOrigins: EXTRA_ORIGINS });
let hosts = loadJson(HOSTS_FILE, {});
if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) hosts = {};
let activeSession = null;
let sessionRuntime = null;
const sessionEventClients = new Set();
const mediaGatewayClients = new Set();
let sessionEventHeartbeat = null;

function persistHosts() {
  saveJson(HOSTS_FILE, hosts);
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function parseHostAddress(address) {
  const value = String(address || '').trim();
  if (!value) throw bridgeError('请输入 Sunshine 主机地址', 'INVALID_ADDRESS');
  if (value.includes('://')) {
    let parsed;
    try { parsed = new URL(value); } catch { throw bridgeError('Sunshine 主机地址格式无效', 'INVALID_ADDRESS'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw bridgeError('仅支持 http:// 或 https:// Sunshine 地址', 'INVALID_ADDRESS');
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!hostname) throw bridgeError('Sunshine 主机地址不能为空', 'INVALID_ADDRESS');
    const port = parsed.port ? validPort(parsed.port) : null;
    if (parsed.port && !port) throw bridgeError('Sunshine 端口必须是 1 到 65535', 'INVALID_PORT');
    return { address: hostname, port, scheme: parsed.protocol.slice(0, -1) };
  }
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    if (closing < 0) throw bridgeError('IPv6 地址缺少 ]', 'INVALID_ADDRESS');
    const hostname = value.slice(1, closing);
    const suffix = value.slice(closing + 1);
    if (suffix && !/^:\d+$/.test(suffix)) throw bridgeError('IPv6 地址端口格式无效', 'INVALID_PORT');
    const port = suffix ? validPort(suffix.slice(1)) : null;
    if (suffix && !port) throw bridgeError('Sunshine 端口必须是 1 到 65535', 'INVALID_PORT');
    return { address: hostname, port, scheme: port === DEFAULT_HTTPS_PORT ? 'https' : 'http' };
  }
  const colonCount = (value.match(/:/g) || []).length;
  if (colonCount === 1 && /:\d+$/.test(value)) {
    const separator = value.lastIndexOf(':');
    const hostname = value.slice(0, separator);
    const port = validPort(value.slice(separator + 1));
    if (!hostname) throw bridgeError('Sunshine 主机地址不能为空', 'INVALID_ADDRESS');
    if (!port) throw bridgeError('Sunshine 端口必须是 1 到 65535', 'INVALID_PORT');
    return { address: hostname, port, scheme: port === DEFAULT_HTTPS_PORT ? 'https' : 'http' };
  }
  return { address: value.replace(/^\[|\]$/g, ''), port: null, scheme: null };
}

function normalizeAddress(address) {
  return parseHostAddress(address).address;
}

function hostIdFor(address, port = null, scheme = null) {
  const suffix = port ? `|${scheme || ''}|${port}` : '';
  return crypto.createHash('sha256').update(`${String(address).toLowerCase()}${suffix}`).digest('hex').slice(0, 16);
}

function ensureHost(input = {}) {
  const parsed = parseHostAddress(input.address || input.host || input.ip);
  const address = parsed.address;
  for (const key of ['port', 'httpPort', 'httpsPort', 'rtspPort']) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '' && !validPort(input[key])) {
      throw bridgeError('Sunshine 端口必须是 1 到 65535', 'INVALID_PORT');
    }
  }
  const inputHttpPort = validPort(input.httpPort);
  const inputHttpsPort = validPort(input.httpsPort);
  const inputRtspPort = validPort(input.rtspPort);
  const requestedPort = validPort(input.port) || parsed.port;
  const requestedScheme = input.scheme || parsed.scheme || (requestedPort === DEFAULT_HTTPS_PORT ? 'https' : 'http');
  const id = input.id || input.hostId || hostIdFor(address, requestedPort, requestedScheme);
  let current = hosts[id];
  if (!current) {
    current = Object.values(hosts).find((host) => {
      if (host.address !== address) return false;
      if (!requestedPort) return true;
      const candidatePort = requestedScheme === 'https' ? host.httpsPort : host.httpPort;
      return candidatePort === requestedPort;
    });
  }
  if (!current) {
    current = {
      id,
      address,
      name: input.name || address,
      httpPort: DEFAULT_HTTP_PORT,
      httpsPort: DEFAULT_HTTPS_PORT,
      paired: false,
      state: 'unknown',
      apps: [],
      createdAt: new Date().toISOString(),
    };
  }
  const hostId = current.id || id;
  current.id = hostId;
  current.address = address;
  if (input.name) current.name = String(input.name).trim();
  if (inputHttpPort) { current.httpPort = inputHttpPort; current.httpPortExplicit = true; }
  if (inputHttpsPort) { current.httpsPort = inputHttpsPort; current.httpsPortExplicit = true; }
  if (inputRtspPort) { current.rtspPort = inputRtspPort; current.rtspPortExplicit = true; }
  if (requestedPort) {
    const portKey = requestedScheme === 'https' ? 'httpsPort' : 'httpPort';
    current[portKey] = requestedPort;
    current[`${portKey}Explicit`] = true;
  }
  if (input.mac) current.mac = String(input.mac).trim();
  hosts[hostId] = current;
  return current;
}

function hostPublic(host) {
  return {
    id: host.id,
    name: host.name || host.address,
    address: host.address,
    httpPort: host.httpPort || DEFAULT_HTTP_PORT,
    httpsPort: host.httpsPort || DEFAULT_HTTPS_PORT,
    rtspPort: host.rtspPort || DEFAULT_RTSP_PORT,
    paired: Boolean(host.paired),
    state: host.state || 'unknown',
    lastSeen: host.lastSeen || null,
    os: host.os || 'Sunshine host',
    sunshine: host.sunshine || host.serverVersion || 'Unknown',
    gpu: host.gpu || 'Unknown GPU',
    apps: Array.isArray(host.apps) ? host.apps : [],
    serverFingerprint: host.serverFingerprint || null,
    mac: host.mac || null,
    stream: normalizeStreamSettings(host.stream),
  };
}

// Per-host stream overrides; null means "use the client default" (bitrate: derived from resolution and fps).
function normalizeStreamSettings(input) {
  const pick = (value, min, max) => {
    if (value === undefined || value === null || value === '') return null;
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || number < min || number > max) throw bridgeError(`串流参数超出范围（${min}–${max}）：${value}`, 'INVALID_STREAM_SETTINGS', { statusCode: 400 });
    return number;
  };
  const source = input && typeof input === 'object' ? input : {};
  const stream = {
    width: pick(source.width, 320, 7680),
    height: pick(source.height, 240, 4320),
    fps: pick(source.fps, 10, 240),
    bitrateKbps: pick(source.bitrateKbps, 500, 500000),
    // Resolution follows the browser window (width/height are then ignored).
    adaptive: source.adaptive === true ? true : source.adaptive === false ? false : null,
    controlMode: ['desktop', 'game'].includes(source.controlMode) ? source.controlMode : null,
    // 'auto': adapt the bitrate to the bridge -> browser link; 'fixed': always the configured bitrate.
    bitrateMode: ['auto', 'fixed'].includes(source.bitrateMode) ? source.bitrateMode : null,
  };
  if ((stream.width === null) !== (stream.height === null)) throw bridgeError('分辨率需要同时设置宽和高', 'INVALID_STREAM_SETTINGS', { statusCode: 400 });
  return stream;
}

function hostById(id) {
  const host = id ? hosts[id] : null;
  if (!host) throw bridgeError(`未找到主机 ${id || ''}`.trim(), 'HOST_NOT_FOUND', { statusCode: 404 });
  return host;
}

function assertHostIdle(host) {
  if (activeSession?.hostId === host.id) throw bridgeError('这台主机正在串流，请先结束会话再修改', 'HOST_BUSY', { statusCode: 409 });
}

const portFields = { httpPort: DEFAULT_HTTP_PORT, httpsPort: DEFAULT_HTTPS_PORT, rtspPort: DEFAULT_RTSP_PORT };

// Edit a saved host: name, address (IP / domain, optionally with port), ports, MAC and stream overrides.
// Pairing is kept: it is pinned to the Sunshine certificate, not to the address.
function updateHost(input = {}) {
  const host = hostById(input.hostId || input.id);
  const changes = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name || name.length > 64) throw bridgeError('主机名称不能为空，且不超过 64 个字符', 'INVALID_NAME', { statusCode: 400 });
    changes.name = name;
  }
  let connectionChanged = false;
  if (input.address !== undefined) {
    const parsed = parseHostAddress(input.address);
    if (!parsed.address) throw bridgeError('Sunshine 主机地址不能为空', 'INVALID_ADDRESS', { statusCode: 400 });
    if (parsed.address !== host.address) connectionChanged = true;
    changes.address = parsed.address;
    if (parsed.port) changes[parsed.scheme === 'https' ? 'httpsPort' : 'httpPort'] = parsed.port;
  }
  for (const key of Object.keys(portFields)) {
    if (input[key] === undefined || changes[key]) continue;
    if (input[key] === null || input[key] === '') { changes[key] = null; continue; }
    const port = validPort(input[key]);
    if (!port) throw bridgeError('Sunshine 端口必须是 1 到 65535', 'INVALID_PORT', { statusCode: 400 });
    changes[key] = port;
  }
  for (const key of Object.keys(portFields)) {
    if (key in changes && (changes[key] || portFields[key]) !== (host[key] || portFields[key])) connectionChanged = true;
  }
  if (input.mac !== undefined) {
    changes.mac = input.mac ? parseMac(input.mac).toString('hex').match(/../g).join(':').toUpperCase() : null;
  }
  if (input.stream !== undefined) changes.stream = normalizeStreamSettings(input.stream);
  const nextAddress = changes.address || host.address;
  const nextHttpPort = 'httpPort' in changes ? (changes.httpPort || DEFAULT_HTTP_PORT) : (host.httpPort || DEFAULT_HTTP_PORT);
  const duplicate = Object.values(hosts).find((item) => item.id !== host.id && item.address === nextAddress && (item.httpPort || DEFAULT_HTTP_PORT) === nextHttpPort);
  if (duplicate) throw bridgeError(`已经有一台主机使用这个地址：${duplicate.name || duplicate.address}`, 'HOST_EXISTS', { statusCode: 409 });
  if (connectionChanged) assertHostIdle(host);

  if (changes.name) host.name = changes.name;
  if (changes.address) host.address = changes.address;
  for (const key of Object.keys(portFields)) {
    if (!(key in changes)) continue;
    if (changes[key]) { host[key] = changes[key]; host[`${key}Explicit`] = true; } else { host[key] = portFields[key]; delete host[`${key}Explicit`]; }
  }
  if ('mac' in changes) { if (changes.mac) host.mac = changes.mac; else delete host.mac; }
  if (changes.stream) host.stream = changes.stream;
  if (connectionChanged) host.state = 'unknown';
  persistHosts();
  return host;
}

// Forget the pairing on this bridge. Sunshine has no unpair API, so the client entry stays in
// Sunshine's web UI (Clients / 已配对的客户端) until it is removed there.
function unpairHost(input = {}) {
  const host = hostById(input.hostId || input.id);
  assertHostIdle(host);
  host.paired = false;
  for (const key of ['serverCertBase64', 'serverFingerprint', 'serverCertSignature']) delete host[key];
  host.apps = [];
  persistHosts();
  return host;
}

function deleteHost(input = {}) {
  const host = hostById(input.hostId || input.id);
  assertHostIdle(host);
  delete hosts[host.id];
  persistHosts();
  return host;
}

function xmlUnescape(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlText(xml, tag, fallback = null) {
  const escapedTag = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, 'i'));
  return match ? xmlUnescape(match[1].trim()) : fallback;
}

function xmlAttr(xml, tag, attr, fallback = null) {
  const escapedTag = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp(`<${escapedTag}\\b[^>]*\\b${attr}=["']([^"']+)["']`, 'i'));
  return match ? xmlUnescape(match[1]) : fallback;
}

function xmlStatus(xml) {
  const status = xmlAttr(xml, 'root', 'status_code', null) || xmlAttr(xml, 'response', 'status_code', null);
  return status == null ? 200 : Number(status);
}

function parseServerInfo(xml) {
  return {
    hostname: xmlText(xml, 'hostname', null),
    appVersion: xmlText(xml, 'appversion', null),
    gfeVersion: xmlText(xml, 'GfeVersion', null),
    sunshineVersion: xmlText(xml, 'SunshineVersion', null),
    uniqueId: xmlText(xml, 'uniqueid', null),
    httpsPort: Number(xmlText(xml, 'HttpsPort', DEFAULT_HTTPS_PORT)) || DEFAULT_HTTPS_PORT,
    httpPort: Number(xmlText(xml, 'ExternalPort', DEFAULT_HTTP_PORT)) || DEFAULT_HTTP_PORT,
    paired: xmlText(xml, 'paired', null),
    currentGame: Number(xmlText(xml, 'currentgame', 0)) || 0,
    serverCodecModeSupport: Number(xmlText(xml, 'ServerCodecModeSupport', 0)) || 0,
    statusCode: xmlStatus(xml),
  };
}

function parseApps(xml) {
  const apps = [];
  const blocks = [...String(xml).matchAll(/<(?:App|app)\b[^>]*>([\s\S]*?)<\/(?:App|app)>/gi)].map((match) => match[1]);
  for (const block of blocks) {
    const name = xmlText(block, 'AppTitle', null) || xmlText(block, 'apptitle', null);
    const id = Number(xmlText(block, 'ID', xmlText(block, 'id', NaN)));
    if (name && Number.isFinite(id)) apps.push({ id, name, hdr: xmlText(block, 'IsHdrSupported', '0') === '1' });
  }
  if (apps.length) return apps;
  const names = [...String(xml).matchAll(/<AppTitle>([\s\S]*?)<\/AppTitle>/gi)].map((match) => xmlUnescape(match[1].trim()));
  const ids = [...String(xml).matchAll(/<ID>([\s\S]*?)<\/ID>/gi)].map((match) => Number(match[1].trim()));
  return names.map((name, index) => ({ id: ids[index] ?? index + 1, name, hdr: false }));
}

function parseDerElement(buffer, offset = 0) {
  if (offset + 2 > buffer.length) throw new Error('证书 DER 数据不完整');
  const tag = buffer[offset];
  const lengthByte = buffer[offset + 1];
  let length;
  let headerLength = 2;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const count = lengthByte & 0x7f;
    if (!count || count > 4 || offset + 2 + count > buffer.length) throw new Error('证书 DER 长度无效');
    length = 0;
    for (let index = 0; index < count; index += 1) length = (length << 8) | buffer[offset + 2 + index];
    headerLength += count;
  }
  const contentStart = offset + headerLength;
  const contentEnd = contentStart + length;
  if (contentEnd > buffer.length) throw new Error('证书 DER 内容不完整');
  return { tag, start: offset, contentStart, contentEnd, end: contentEnd, length };
}

function parseCertificateParts(derBytes) {
  const derBuffer = Buffer.from(derBytes);
  const outer = parseDerElement(derBuffer, 0);
  const tbs = parseDerElement(derBuffer, outer.contentStart);
  const algorithm = parseDerElement(derBuffer, tbs.end);
  const signature = parseDerElement(derBuffer, algorithm.end);
  if (signature.tag !== 0x03) throw new Error('证书签名字段无效');
  const signatureBytes = derBuffer.subarray(signature.contentStart + 1, signature.contentEnd);
  return { der: derBuffer, tbs: derBuffer.subarray(tbs.start, tbs.end), signature: Buffer.from(signatureBytes) };
}

function certificateFingerprint(derBytes) {
  return crypto.createHash('sha256').update(derBytes).digest('hex').match(/.{2}/g).join(':').toUpperCase();
}

function aesEcb(data, key, decrypt = false) {
  const input = Buffer.from(data);
  const paddedLength = Math.ceil(input.length / 16) * 16 || 16;
  const padded = Buffer.alloc(paddedLength);
  input.copy(padded);
  const cipher = decrypt ? crypto.createDecipheriv('aes-128-ecb', key, null) : crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function hashFor(version, data) {
  const major = Number.parseInt(String(version || '').split('.')[0], 10) || 0;
  return crypto.createHash(major >= 7 ? 'sha256' : 'sha1').update(data).digest();
}

function signSha256(data, privateKey) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  return signer.sign(privateKey);
}

function verifySha256(data, signature, publicKey) {
  try {
    return crypto.verify('sha256', data, publicKey, signature);
  } catch {
    return false;
  }
}

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost'
    || value === '::1'
    || value.startsWith('127.')
    || value.startsWith('10.')
    || value.startsWith('192.168.')
    || value.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe80:');
}

function safeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function bridgeError(message, errorCode = 'BRIDGE_ERROR', properties = {}) {
  const error = new Error(String(message));
  error.errorCode = errorCode;
  Object.assign(error, properties);
  return error;
}

function inferErrorCode(error) {
  if (error?.errorCode) return error.errorCode;
  const message = safeError(error);
  if (/certificate|证书.*(?:不一致|不匹配|校验)|tls/i.test(message)) return 'TLS_CERTIFICATE_MISMATCH';
  if (/rtspenc|加密 RTSP|encrypted RTSP/i.test(message)) return 'RTSP_ENCRYPTED_UNSUPPORTED';
  if (/RTSP/i.test(message)) return 'RTSP_NEGOTIATION_FAILED';
  if (/invalid.*(?:address|port|pin)|地址.*(?:无效|不能为空|格式)|端口必须|PIN 必须/i.test(message)) return /port|端口/i.test(message) ? 'INVALID_PORT' : /pin|PIN/i.test(message) ? 'INVALID_PIN' : 'INVALID_ADDRESS';
  if (/host.*(?:not found|不存在|未找到)|主机.*(?:不存在|未找到)|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return 'HOST_NOT_FOUND';
  if (/pair|配对/i.test(message)) return 'NOT_PAIRED';
  if (/MAC|Wake-on-LAN|唤醒/i.test(message)) return 'WAKE_MAC_REQUIRED';
  if (/应用列表|applist/i.test(message)) return 'SUNSHINE_REQUEST_FAILED';
  if (/media.*not connected|媒体.*未接入/i.test(message)) return 'MEDIA_NOT_CONNECTED';
  if (/input.*not connected|输入.*未接入/i.test(message)) return 'INPUT_NOT_CONNECTED';
  if (/主机|Sunshine|ECONN|ENET|EHOST|timeout|超时/i.test(message)) return 'SUNSHINE_UNAVAILABLE';
  return 'BRIDGE_ERROR';
}

function errorPayload(error) {
  const errorCode = inferErrorCode(error);
  return {
    ok: false,
    errorCode,
    error: safeError(error),
    ...(Number.isFinite(Number(error?.statusCode)) ? { statusCode: Number(error.statusCode) } : {}),
    ...(error?.stage ? { stage: String(error.stage) } : {}),
  };
}

function setErrorCode(error, errorCode, properties = {}) {
  if (error && typeof error === 'object') {
    if (!error.errorCode) error.errorCode = errorCode;
    Object.assign(error, properties);
    return error;
  }
  return bridgeError(error, errorCode, properties);
}

function requestHost(host, endpoint, params = {}, options = {}) {
  const secure = options.secure ?? Boolean(host.paired && host.serverCertBase64);
  const transport = secure ? https : http;
  const port = secure ? (host.httpsPort || DEFAULT_HTTPS_PORT) : (host.httpPort || DEFAULT_HTTP_PORT);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  if (secure && options.identityParams !== false) {
    if (!query.has('uniqueid')) query.set('uniqueid', identity.uniqueId);
    if (!query.has('uuid')) query.set('uuid', crypto.randomUUID());
  }
  const requestPath = `${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}${query.toString() ? `?${query.toString()}` : ''}`;
  return new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: secure ? 'https:' : 'http:',
      hostname: host.address,
      port,
      path: requestPath,
      method: 'GET',
      // Sunshine closes the connection after each response; reusing a pooled socket races that close.
      agent: false,
      headers: { Accept: 'application/xml, text/xml, */*', 'User-Agent': 'Sunbridge/0.2', Connection: 'close' },
      timeout: options.timeout ?? REQUEST_TIMEOUT_MS,
    };
    if (secure) {
      requestOptions.cert = identity.certificatePem;
      requestOptions.key = identity.privateKeyPem;
      requestOptions.rejectUnauthorized = false;
    }
    const started = performance.now();
    const request = transport.request(requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (secure && host.serverCertBase64) {
          const peer = request.socket?.getPeerCertificate?.(true) || response.socket?.getPeerCertificate?.(true);
          if (peer?.raw && !peer.raw.equals(unbase64(host.serverCertBase64))) {
            reject(bridgeError('Sunshine TLS 证书与已保存的配对证书不一致', 'TLS_CERTIFICATE_MISMATCH'));
            return;
          }
        }
        const statusCode = response.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(bridgeError(`Sunshine 返回 HTTP ${statusCode}: ${body.slice(0, 240)}`, 'SUNSHINE_REQUEST_FAILED', { statusCode }));
          return;
        }
        resolve({ body, statusCode, elapsedMs: Math.round(performance.now() - started), secure });
      });
    });
    request.on('timeout', () => request.destroy(bridgeError(`连接 Sunshine 超时（${host.address}:${port}）`, 'SUNSHINE_UNAVAILABLE')));
    request.on('error', (error) => {
      const pairStep = ['phrase', 'clientchallenge', 'serverchallengeresp', 'clientpairingsecret'].find((key) => key in params);
      if (endpoint === '/pair' && pairStep && error instanceof Error) error.message = `${error.message} [pair ${pairStep === 'phrase' ? params.phrase : pairStep}, ${secure ? 'https' : 'http'}]`;
      const nodeCode = String(error?.code || '').toUpperCase();
      const errorCode = nodeCode === 'ENOTFOUND' || nodeCode === 'EAI_AGAIN' ? 'HOST_NOT_FOUND' : nodeCode === 'CERT_HAS_EXPIRED' ? 'TLS_CERTIFICATE_MISMATCH' : 'SUNSHINE_UNAVAILABLE';
      reject(setErrorCode(error, errorCode));
    });
    request.end();
  });
}

function assertSunshineSuccess(result, operation) {
  const status = xmlStatus(result.body);
  if (Number.isFinite(status) && status >= 400) {
    throw bridgeError(`Sunshine ${operation} 返回协议状态 ${status}`, 'SUNSHINE_REQUEST_FAILED', { statusCode: status, operation });
  }
  return result;
}

async function requestServerInfo(host, options = {}) {
  const pairedWithCertificate = Boolean(host.paired && host.serverCertBase64);
  // A paired host is pinned to its saved TLS certificate. Never downgrade a
  // failed certificate check to the unencrypted control endpoint.
  const attempts = pairedWithCertificate ? [true] : [false, true];
  const errors = [];
  let result = null;
  let info = null;
  for (const secure of attempts) {
    try {
      const candidate = await requestHost(host, '/serverinfo', {}, { secure, identityParams: false, timeout: options.timeout });
      assertSunshineSuccess(candidate, '/serverinfo');
      result = candidate;
      info = parseServerInfo(candidate.body);
      break;
    } catch (error) {
      errors.push(error);
    }
  }
  if (!result || !info) {
    const detail = errors.map(safeError).filter(Boolean).join('；');
    const code = errors.some((error) => error?.errorCode === 'TLS_CERTIFICATE_MISMATCH')
      ? 'TLS_CERTIFICATE_MISMATCH'
      : errors.find((error) => ['HOST_NOT_FOUND', 'SUNSHINE_REQUEST_FAILED'].includes(error?.errorCode))?.errorCode
        || 'SUNSHINE_UNAVAILABLE';
    throw bridgeError(`无法读取 Sunshine /serverinfo：${detail || '未知错误'}`, code);
  }
  host.serverInfo = info;
  if (!host.httpPortExplicit) host.httpPort = info.httpPort || host.httpPort || DEFAULT_HTTP_PORT;
  if (!host.httpsPortExplicit) host.httpsPort = info.httpsPort || host.httpsPort || DEFAULT_HTTPS_PORT;
  host.serverVersion = info.sunshineVersion || info.appVersion || host.serverVersion || 'Sunshine';
  host.sunshine = info.sunshineVersion || host.sunshine || 'Sunshine';
  host.name = host.name && host.name !== host.address ? host.name : (info.hostname || host.address);
  host.state = 'online';
  host.lastSeen = new Date().toISOString();
  // Only trust Sunshine's PairStatus when this bridge still holds the pinned certificate (not after a local unpair).
  if (info.paired === '1' && host.serverCertBase64) host.paired = true;
  persistHosts();
  return { ...info, elapsedMs: result.elapsedMs, secure: result.secure, raw: result.body };
}

async function requestApps(host) {
  if (!host.paired || !host.serverCertBase64) {
    throw bridgeError('请先完成配对，再读取应用列表', 'NOT_PAIRED');
  }
  const result = assertSunshineSuccess(await requestHost(host, '/applist', {}, { secure: true }), '/applist');
  const apps = parseApps(result.body);
  host.apps = apps;
  host.lastSeen = new Date().toISOString();
  host.state = 'online';
  persistHosts();
  return { apps, elapsedMs: result.elapsedMs };
}

async function pairHost(input) {
  const pin = String(input.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) throw bridgeError('配对 PIN 必须是 4 位数字', 'INVALID_PIN');
  const host = ensureHost(input);
  const info = await requestServerInfo(host, { timeout: 5000 });
  const salt = randomBytes(16);
  const hash = hashFor(info.appVersion || '7.1.0.0', Buffer.concat([salt, Buffer.from(pin, 'utf8')]));
  const aesKey = hash.subarray(0, 16);
  const initialPair = await requestHost(host, '/pair', {
    uniqueid: identity.uniqueId,
    uuid: crypto.randomUUID(),
    devicename: 'roth',
    updateState: 1,
    phrase: 'getservercert',
    salt: hex(salt),
    clientcert: hex(Buffer.from(identity.certificatePem, 'utf8')),
    clientname: input.name || identity.clientName,
  }, { secure: false, identityParams: false, timeout: 180000 });
  if (xmlText(initialPair.body, 'paired', '0') !== '1') {
    throw bridgeError('Sunshine 拒绝了配对请求，可能已有其他客户端正在配对', 'SUNSHINE_REQUEST_FAILED');
  }
  const plainCertHex = xmlText(initialPair.body, 'plaincert', null);
  if (!plainCertHex) throw bridgeError('Sunshine 没有返回服务端证书，请稍后重试', 'SUNSHINE_REQUEST_FAILED');
  // Sunshine sends the hex of its PEM certificate text (GFE historically did the same).
  const plainCert = fromHex(plainCertHex);
  const plainCertText = plainCert.toString('latin1');
  const serverCertDer = plainCertText.includes('-----BEGIN CERTIFICATE-----')
    ? new crypto.X509Certificate(plainCertText).raw
    : plainCert;
  const serverCertParts = parseCertificateParts(serverCertDer);
  const serverCertificate = new crypto.X509Certificate(serverCertDer);
  const temporaryHost = { ...host, paired: false, httpsPort: info.httpsPort || host.httpsPort, serverCertBase64: base64(serverCertDer) };

  const randomChallenge = randomBytes(16);
  const encryptedChallenge = aesEcb(randomChallenge, aesKey);
  const challengeResponse = await requestHost(temporaryHost, '/pair', {
    uniqueid: identity.uniqueId,
    uuid: crypto.randomUUID(),
    devicename: 'roth',
    updateState: 1,
    clientchallenge: hex(encryptedChallenge),
  }, { secure: false, identityParams: false, timeout: 30000 });
  if (xmlText(challengeResponse.body, 'paired', '0') !== '1') throw bridgeError('Sunshine 未接受客户端挑战', 'SUNSHINE_REQUEST_FAILED');
  const decrypted = aesEcb(fromHex(xmlText(challengeResponse.body, 'challengeresponse', '')), aesKey, true);
  const hashLength = hash.length;
  const serverResponse = decrypted.subarray(0, hashLength);
  const serverChallenge = decrypted.subarray(hashLength, hashLength + 16);
  if (serverChallenge.length !== 16) throw bridgeError('Sunshine challenge 响应长度无效', 'SUNSHINE_REQUEST_FAILED');

  const clientSecret = randomBytes(16);
  // Sunshine verifies this against the signature of *our* (client) certificate.
  const clientCertParts = parseCertificateParts(new crypto.X509Certificate(identity.certificatePem).raw);
  const responseHash = hashFor(info.appVersion || '7.1.0.0', Buffer.concat([serverChallenge, clientCertParts.signature, clientSecret]));
  const secretResponse = await requestHost(temporaryHost, '/pair', {
    uniqueid: identity.uniqueId,
    uuid: crypto.randomUUID(),
    devicename: 'roth',
    updateState: 1,
    serverchallengeresp: hex(aesEcb(responseHash, aesKey)),
  }, { secure: false, identityParams: false, timeout: 30000 });
  if (xmlText(secretResponse.body, 'paired', '0') !== '1') throw bridgeError('PIN 不正确或 Sunshine 未接受挑战响应', 'INVALID_PIN');

  const pairingSecret = fromHex(xmlText(secretResponse.body, 'pairingsecret', ''));
  if (pairingSecret.length < 17) throw bridgeError('Sunshine 返回的 pairingsecret 无效', 'SUNSHINE_REQUEST_FAILED');
  const serverSecret = pairingSecret.subarray(0, 16);
  const serverSignature = pairingSecret.subarray(16);
  if (!verifySha256(serverSecret, serverSignature, serverCertificate.publicKey)) {
    throw bridgeError('服务端配对签名校验失败，已中止以防止中间人攻击', 'TLS_CERTIFICATE_MISMATCH');
  }
  const expectedServerResponse = hashFor(info.appVersion || '7.1.0.0', Buffer.concat([randomChallenge, serverCertParts.signature, serverSecret]));
  if (serverResponse.length !== expectedServerResponse.length || !crypto.timingSafeEqual(Buffer.from(serverResponse), Buffer.from(expectedServerResponse))) {
    throw bridgeError('配对 PIN 不正确', 'INVALID_PIN');
  }

  const clientPairingSecret = Buffer.concat([clientSecret, signSha256(clientSecret, identity.privateKeyPem)]);
  const clientSecretResponse = await requestHost(temporaryHost, '/pair', {
    uniqueid: identity.uniqueId,
    uuid: crypto.randomUUID(),
    devicename: 'roth',
    updateState: 1,
    clientpairingsecret: hex(clientPairingSecret),
  }, { secure: false, identityParams: false, timeout: 30000 });
  if (xmlText(clientSecretResponse.body, 'paired', '0') !== '1') throw bridgeError('Sunshine 未保存客户端证书', 'SUNSHINE_REQUEST_FAILED');

  const pairChallenge = await requestHost(temporaryHost, '/pair', {
    uniqueid: identity.uniqueId,
    uuid: crypto.randomUUID(),
    devicename: 'roth',
    updateState: 1,
    phrase: 'pairchallenge',
  }, { secure: true, identityParams: false, timeout: 10000 });
  if (xmlText(pairChallenge.body, 'paired', '0') !== '1') throw bridgeError('配对完成校验失败', 'SUNSHINE_REQUEST_FAILED');

  host.paired = true;
  host.serverCertBase64 = base64(serverCertDer);
  host.serverFingerprint = certificateFingerprint(serverCertDer);
  host.serverCertSignature = hex(serverCertParts.signature);
  if (!host.httpsPortExplicit) host.httpsPort = info.httpsPort || host.httpsPort || DEFAULT_HTTPS_PORT;
  if (!host.httpPortExplicit) host.httpPort = info.httpPort || host.httpPort || DEFAULT_HTTP_PORT;
  host.name = String(input.name || info.hostname || host.address).trim();
  host.serverVersion = info.sunshineVersion || info.appVersion || host.serverVersion;
  host.sunshine = info.sunshineVersion || host.sunshine;
  host.state = 'online';
  host.lastSeen = new Date().toISOString();
  persistHosts();
  try {
    await requestApps(host);
  } catch (error) {
    host.apps = [];
    persistHosts();
    host.appsError = safeError(error);
  }
  return hostPublic(host);
}

function tcpProbe(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.createConnection({ host: host.address, port });
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, elapsedMs: ok ? Math.round(performance.now() - started) : null, error: error ? safeError(error) : null });
    };
    socket.setTimeout(timeout, () => finish(false, new Error('timeout')));
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(false, error));
  });
}

function normalizeRtspHost(value, fallback = '') {
  const text = String(value || fallback || '').trim();
  return text.replace(/^\[|\]$/g, '');
}

function rtspHostHeader(address, port) {
  const host = normalizeRtspHost(address);
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function parseRtspUrl(value, fallbackAddress, fallbackPort = DEFAULT_RTSP_PORT) {
  const raw = String(value || '').trim();
  if (!raw) {
    const address = normalizeRtspHost(fallbackAddress);
    const port = validPort(fallbackPort) || DEFAULT_RTSP_PORT;
    return { scheme: 'rtsp', address, port, target: '/', uri: `rtsp://${rtspHostHeader(address, port)}/` };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw rtspFailure('Sunshine 返回的 RTSP sessionUrl0 格式无效', { stage: 'URL' });
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'rtsp' && scheme !== 'rtspenc') {
    throw rtspFailure(`不支持的 RTSP 协议：${parsed.protocol}`, { stage: 'URL' });
  }
  // As GameStream clients do, only the port is taken from sessionUrl0: hosts behind NAT/tunnels
  // report their own local address (often 127.0.0.1), so always dial the address the user configured.
  let address = normalizeRtspHost(fallbackAddress) || normalizeRtspHost(parsed.hostname);
  if (address === '0.0.0.0' || address === '::') address = '';
  if (!address) throw rtspFailure('RTSP sessionUrl0 没有主机地址', { stage: 'URL' });
  const port = validPort(parsed.port) || (validPort(fallbackPort) || DEFAULT_RTSP_PORT);
  const targetPath = parsed.pathname || '/';
  const target = `${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}${parsed.search || ''}`;
  return { scheme, address, port, target, uri: `${scheme}://${rtspHostHeader(address, port)}${target}` };
}

function parseRtspResponse(buffer, atEof = false) {
  const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
  if (headerEnd < 0) return null;
  const headerText = buffer.subarray(0, headerEnd).toString('latin1');
  const lines = headerText.split('\r\n');
  const statusMatch = /^RTSP\/([0-9.]+)\s+(\d{3})(?:\s+(.*))?$/i.exec(lines.shift() || '');
  if (!statusMatch) throw rtspFailure('RTSP 响应状态行无效', { stage: 'RESPONSE' });
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const content = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${content}` : content;
  }
  const bodyStart = headerEnd + 4;
  const hasLength = headers['content-length'] !== undefined;
  // Without Content-Length the body runs until the server closes the connection (Sunshine).
  if (!hasLength && !atEof) return null;
  const contentLength = hasLength ? Math.max(0, Number.parseInt(headers['content-length'], 10) || 0) : buffer.length - bodyStart;
  if (buffer.length < bodyStart + contentLength) return null;
  return {
    protocol: `RTSP/${statusMatch[1]}`,
    statusCode: Number(statusMatch[2]),
    statusMessage: statusMatch[3] || '',
    headers,
    body: buffer.subarray(bodyStart, bodyStart + contentLength),
    bytes: bodyStart + contentLength,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRtspSessionId(value) {
  const token = String(value || '').split(';', 1)[0].trim();
  return token || null;
}

function parseServerPort(transport, fallback = null) {
  const match = /(?:^|[;,\s])server_port\s*=\s*(\d+)(?:\s*-\s*(\d+))?/i.exec(String(transport || ''));
  const first = match ? validPort(match[1]) : null;
  return first || fallback || null;
}

function createMediaStats(serverPort = null, clientPort = null) {
  return {
    state: 'waiting',
    packets: 0,
    bytes: 0,
    firstPacketAt: null,
    lastPacketAt: null,
    payloadTypes: [],
    source: null,
    serverPort,
    clientPort,
    bitrateKbps: null,
    rtp: null,
  };
}

function createMediaGatewayStats() {
  return {
    state: 'waiting',
    protocol: MEDIA_GATEWAY_PROTOCOL,
    clients: 0,
    packets: 0,
    bytes: 0,
    videoPackets: 0,
    audioPackets: 0,
    connectedAt: null,
    firstPacketAt: null,
    lastPacketAt: null,
    lastError: null,
  };
}

function rtspFailure(message, properties = {}) {
  return bridgeError(message, 'RTSP_NEGOTIATION_FAILED', properties);
}

function sessionSnapshot(session = activeSession) {
  if (!session) return null;
  try { return JSON.parse(JSON.stringify(session)); } catch { return null; }
}

function writeSessionEvent(client, type, payload = {}) {
  const event = {
    type,
    at: new Date().toISOString(),
    ...payload,
  };
  if (!Object.prototype.hasOwnProperty.call(event, 'session')) event.session = sessionSnapshot();
  const text = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  try {
    if (client.destroyed || client.writableEnded) return false;
    // A false return value means the writable buffer is temporarily full, not
    // that the SSE client has disconnected. Keep the stream and let Node drain
    // it instead of silently dropping the browser's event subscription.
    client.write(text);
    return true;
  } catch {
    return false;
  }
}

function stopSessionEventHeartbeatIfIdle() {
  if (sessionEventClients.size || !sessionEventHeartbeat) return;
  clearInterval(sessionEventHeartbeat);
  sessionEventHeartbeat = null;
}

function removeSessionEventClient(client) {
  sessionEventClients.delete(client);
  stopSessionEventHeartbeatIfIdle();
}

function startSessionEventHeartbeat() {
  if (sessionEventHeartbeat || !sessionEventClients.size) return;
  sessionEventHeartbeat = setInterval(() => {
    for (const client of sessionEventClients) {
      try {
        if (client.destroyed || client.writableEnded) removeSessionEventClient(client);
        else client.write(': keep-alive\n\n');
      } catch { removeSessionEventClient(client); }
    }
    stopSessionEventHeartbeatIfIdle();
  }, SESSION_EVENT_HEARTBEAT_MS);
  sessionEventHeartbeat.unref?.();
}

function openSessionEventStream(request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();
  sessionEventClients.add(response);
  const cleanup = () => removeSessionEventClient(response);
  request.once('aborted', cleanup);
  response.once('close', cleanup);
  if (!writeSessionEvent(response, 'session-snapshot', { session: sessionSnapshot() })) {
    cleanup();
    return;
  }
  startSessionEventHeartbeat();
}

function emitSessionEvent(type, payload = {}) {
  for (const client of sessionEventClients) {
    if (!writeSessionEvent(client, type, payload)) removeSessionEventClient(client);
  }
}

function closeSessionEventStreams() {
  for (const client of sessionEventClients) {
    try { client.end(); } catch { /* already closed */ }
  }
  sessionEventClients.clear();
  stopSessionEventHeartbeatIfIdle();
}

function parseRtpPacket(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 12) return null;
  const version = packet[0] >> 6;
  if (version !== 2) return null;
  const csrcCount = packet[0] & 0x0f;
  // The GameStream RTP extension bit is not the generic RFC 3550 extension
  // layout. Sunshine uses the four bytes after the CSRC list for its two
  // additional transport fields, followed by NV_VIDEO_PACKET / audio data.
  const hasExtension = Boolean(packet[0] & 0x10);
  let headerLength = 12 + csrcCount * 4;
  if (packet.length < headerLength) return null;
  if (hasExtension) {
    headerLength += 4;
    if (packet.length < headerLength) return null;
  }
  return {
    version,
    payloadType: packet[1] & 0x7f,
    marker: Boolean(packet[1] & 0x80),
    sequenceNumber: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    headerLength,
    extension: hasExtension,
  };
}

function mediaGatewayClientCount(session) {
  let count = 0;
  for (const client of mediaGatewayClients) if (client.session === session) count += 1;
  return count;
}

function updateMediaGatewayState(session, state = null, extra = {}) {
  if (!session?.transport?.media) return;
  const gateway = session.transport.media.gateway || (session.transport.media.gateway = createMediaGatewayStats());
  gateway.clients = mediaGatewayClientCount(session);
  if (state) gateway.state = state;
  Object.assign(gateway, extra);
  emitSessionEvent('media-gateway', { state: gateway.state, clients: gateway.clients });
}

function mediaGatewayEnvelope(streamName, packet, receivedAt = Date.now()) {
  const payload = toBuffer(packet);
  const frame = Buffer.allocUnsafe(16 + payload.length);
  frame.write('SBMF', 0, 4, 'ascii');
  frame[4] = 1;
  frame[5] = MEDIA_STREAM_IDS[streamName] || 0;
  frame.writeUInt16BE(0, 6);
  frame.writeUInt32BE(receivedAt >>> 0, 8);
  frame.writeUInt32BE(payload.length, 12);
  payload.copy(frame, 16);
  return frame;
}

function broadcastMediaPacket(session, streamName, packet) {
  if (activeSession !== session || !session?.transport?.media || !MEDIA_STREAM_IDS[streamName]) return;
  const gateway = session.transport.media.gateway || (session.transport.media.gateway = createMediaGatewayStats());
  const envelope = mediaGatewayEnvelope(streamName, packet);
  gateway.packets += 1;
  gateway.bytes += packet.length;
  gateway.firstPacketAt ||= new Date().toISOString();
  if (streamName === 'video') gateway.videoPackets += 1;
  if (streamName === 'audio') gateway.audioPackets += 1;
  for (const client of mediaGatewayClients) {
    if (client.session !== session) continue;
    if (client.wantsFrames && streamName === 'video') continue; // gets whole frames instead
    if (client.draining && streamName === 'video') {
      if (Date.now() - client.draining > DRAIN_MAX_MS) stopDraining(client);
      else {
        client.droppedPackets += 1;
        gateway.droppedPackets = (gateway.droppedPackets || 0) + 1;
        continue;
      }
    }
    // Audio (~100 kbps) is never dropped: it can't relieve a backlog, it would only crackle.
    if (streamName === 'video' && client.socket.writableLength + client.mediaBatchBytes > backpressureLimit(session)) {
      client.droppedPackets += 1;
      gateway.droppedPackets = (gateway.droppedPackets || 0) + 1;
      continue;
    }
    if (!client.queueMedia(envelope)) removeMediaGatewayClient(client);
  }
  const lastEventAt = sessionRuntime?.mediaGatewayLastEventAt || 0;
  const nowMs = performance.now();
  if (!lastEventAt || nowMs - lastEventAt >= MEDIA_EVENT_THROTTLE_MS) {
    gateway.lastPacketAt = new Date().toISOString();
    if (sessionRuntime) sessionRuntime.mediaGatewayLastEventAt = nowMs;
    emitSessionEvent('media-gateway-stats', { stream: streamName });
  }
}

function hasFrameClients(session) {
  for (const client of mediaGatewayClients) if (client.session === session && client.wantsFrames) return true;
  return false;
}

// Assemble Sunshine's video packets into frames (FEC recovery included) once, for every frame client.
function feedFrameAssembler(session, runtime, packet) {
  const video = Media.parseVideoPacket(Media.parseRtp(packet));
  if (!video || video.raw || !(video.dataShards > 0)) return;
  if (Number.isFinite(video.fecPercentage)) session.fecPercent = video.fecPercentage;
  runtime.frameAssembler ||= Media.createFrameAssembler({
    onFrame: (frame) => broadcastFrame(session, runtime, frame),
    onLoss: () => {
      runtime.framesLost = (runtime.framesLost || 0) + 1;
      requestIdrThrottled(session, runtime);
    },
  });
  runtime.frameAssembler.push(video);
}

function requestIdrThrottled(session, runtime) {
  const now = Date.now();
  if (now - (runtime.lastIdrRequestAt || 0) < 1000) return;
  runtime.lastIdrRequestAt = now;
  requestIdrFrame(session);
}

// Frame envelope: SBMF header (stream 4, flags = frames lost right before this one) + 12-byte frame header
// (frame index, RTP timestamp, frame type, codec, host processing in 0.1 ms) + the codec payload.
// Under congestion whole frames are dropped and the client skips ahead to the next keyframe (IDR requested),
// so the picture freezes briefly instead of breaking up.
function broadcastFrame(session, runtime, frame) {
  if (activeSession !== session) return;
  const media = session.transport.media;
  const gateway = media.gateway || (media.gateway = createMediaGatewayStats());
  const lost = runtime.framesLost || 0;
  runtime.framesLost = 0;
  const bytes = frame.bytes;
  const body = Buffer.allocUnsafe(12 + bytes.length);
  body.writeUInt32BE(frame.frameIndex >>> 0, 0);
  body.writeUInt32BE(Number(frame.timestamp) >>> 0, 4);
  body[8] = Number(frame.frameType) || 0;
  body[9] = VIDEO_CODECS[session.videoCodec] || 0;
  body.writeUInt16BE(Math.min(0xffff, Math.round((frame.hostProcessingMs || 0) * 10)), 10);
  body.set(bytes, 12);
  media.forwardedBytes = (media.forwardedBytes || 0) + body.length;
  gateway.frames = (gateway.frames || 0) + 1;
  const keyframe = frame.frameType === 2;
  const receivedAt = Date.now() >>> 0;
  for (const client of mediaGatewayClients) {
    if (client.session !== session || !client.wantsFrames) continue;
    if (client.draining && Date.now() - client.draining > DRAIN_MAX_MS) stopDraining(client);
    const congested = client.draining || client.socket.writableLength + client.mediaBatchBytes > backpressureLimit(session);
    if (congested || (client.skipToKeyframe && !keyframe)) {
      client.droppedFrames = (client.droppedFrames || 0) + 1;
      client.framesLostSinceSent = (client.framesLostSinceSent || 0) + 1;
      if (!client.skipToKeyframe) { client.skipToKeyframe = true; }
      if (!client.draining) requestIdrThrottled(session, runtime);
      continue;
    }
    client.skipToKeyframe = false;
    const header = Buffer.allocUnsafe(16);
    header.write('SBMF', 0, 4, 'ascii');
    header[4] = 1;
    header[5] = MEDIA_STREAM_IDS.videoFrame;
    header.writeUInt16BE(Math.min(0xffff, lost + (client.framesLostSinceSent || 0)), 6);
    header.writeUInt32BE(receivedAt, 8);
    header.writeUInt32BE(body.length, 12);
    client.framesLostSinceSent = 0;
    if (!client.queueMedia(Buffer.concat([header, body]))) removeMediaGatewayClient(client);
  }
}

function stopDraining(client) {
  if (!client.draining) return;
  client.draining = 0;
  if (activeSession === client.session) requestIdrFrame(client.session);
}

function backpressureLimit(session) {
  const kbps = session.abr?.targetKbps || session.bitrateKbps || 20000;
  return Math.max(MEDIA_GATEWAY_BACKPRESSURE_MIN_BYTES, (kbps * 1000 / 8) * MEDIA_GATEWAY_BACKPRESSURE_SECONDS);
}

// ---------------------------------------------------------------------------
// Adaptive bitrate. Signals (worst browser wins): queueing delay reported by the browser (one-way delay above
// its recent minimum), bytes waiting in the bridge's send queue, packets dropped for backpressure, and the
// bandwidth the browser actually receives. Congestion -> quickly below the measured throughput; a clean link
// -> step back up towards the configured bitrate.
// ---------------------------------------------------------------------------
// Hard cap: what actually arrives from Sunshine (video + audio + FEC, measured over 3 s) must stay within the
// target. Encoders overshoot (AMF/QSV rate control, keyframes) and live bitrate changes don't reserve audio,
// so the encoder setting is scaled down until the measured rate fits, and relaxed again when well below.
function governRate(session) {
  const abr = session.abr;
  const media = session.transport.media;
  const totalBytes = session.frameTransport ? (media.forwardedBytes || 0) : (media.video?.bytes || 0) + (media.audio?.bytes || 0);
  const maxScale = session.frameTransport ? 100 / (100 - Math.min(80, session.fecPercent ?? ASSUMED_FEC_PERCENT)) : 1;
  const now = Date.now();
  if (!abr.rateWindow || totalBytes < abr.rateWindow.bytes) { abr.rateWindow = { at: now, bytes: totalBytes }; return; }
  if (now - abr.rateWindow.at < 3000) return;
  const measuredKbps = ((totalBytes - abr.rateWindow.bytes) * 8) / (now - abr.rateWindow.at);
  abr.rateWindow = { at: now, bytes: totalBytes };
  abr.measuredKbps = Math.round(measuredKbps);
  const scale = abr.encoderScale;
  let next = scale;
  if (measuredKbps > abr.targetKbps * 1.1) {
    abr.overshootWindows += 1;
    next = Math.max(0.3, scale * (abr.targetKbps / measuredKbps) * 0.97);
  } else {
    abr.overshootWindows = 0;
    if (measuredKbps < abr.targetKbps * 0.85 && scale < maxScale) next = Math.min(maxScale, scale * 1.08);
  }
  if (Math.abs(next - scale) / scale < 0.03) return;
  abr.encoderScale = next;
  void applyBitrate(session, abr.targetKbps, measuredKbps > abr.targetKbps ? 'over-target' : 'relax', { force: true });
}

function evaluateAbr(session) {
  const abr = session.abr;
  if (!abr || session.reconnect || abr.applying) return;
  governRate(session);
  if (abr.mode !== 'auto' || abr.applying) return;
  const now = Date.now();
  let queueDelayMs = 0;
  let receivedKbps = null;
  let backlogMs = 0;
  let drops = 0;
  let clients = 0;
  for (const client of mediaGatewayClients) {
    if (client.session !== session) continue;
    clients += 1;
    const feedback = client.feedback && now - client.feedback.at < 3000 ? client.feedback : null;
    if (feedback) {
      queueDelayMs = Math.max(queueDelayMs, feedback.queueDelayMs || 0);
      if (feedback.receivedKbps > 0) receivedKbps = receivedKbps == null ? feedback.receivedKbps : Math.min(receivedKbps, feedback.receivedKbps);
    }
    backlogMs = Math.max(backlogMs, ((client.socket.writableLength + client.mediaBatchBytes) * 8) / abr.targetKbps);
    drops += client.droppedPackets - (client.abrDropsSeen || 0);
    client.abrDropsSeen = client.droppedPackets;
  }
  if (!clients) return;
  Object.assign(abr, { queueDelayMs: Math.round(queueDelayMs), backlogMs: Math.round(backlogMs), receivedKbps });
  const severe = queueDelayMs > 400 || backlogMs > 800 || drops > 20;
  const congested = severe || queueDelayMs > 120 || backlogMs > 250 || drops > 0;
  if (congested) {
    abr.goodSince = null;
    abr.state = 'congested';
    if (now - abr.lastChangeAt < (severe ? 1000 : 2000)) return;
    const throughputCap = receivedKbps ? receivedKbps * 0.85 : Infinity;
    const next = Math.max(ABR_MIN_KBPS, Math.min(abr.targetKbps * (severe ? 0.6 : 0.8), throughputCap));
    if (next < abr.targetKbps * 0.95) void applyBitrate(session, next, severe ? 'severe-congestion' : 'congestion');
    return;
  }
  if (queueDelayMs < 40 && backlogMs < 60) {
    abr.state = abr.targetKbps < abr.capKbps ? 'probing' : 'stable';
    abr.goodSince ||= now;
    if (abr.targetKbps < abr.capKbps && now - abr.goodSince >= 4000 && now - abr.lastChangeAt >= 4000) {
      abr.goodSince = now;
      void applyBitrate(session, Math.min(abr.capKbps, abr.targetKbps * 1.12 + 250), 'probe-up');
    }
  } else {
    abr.goodSince = null;
    abr.state = 'holding';
  }
}

// Change the encoder bitrate. This Sunshine fork: GET /bitrate (live, confirmed), else the control-stream dynamic
// parameter. Stock Sunshine cannot change it live: only a large sustained drop reconnects (/resume) at the new rate.
async function applyBitrate(session, kbps, reason, { force = false } = {}) {
  const abr = session.abr;
  const host = hosts[session.hostId];
  if (!abr || !host || activeSession !== session) return;
  const target = Math.round(Math.max(ABR_MIN_KBPS, Math.min(abr.capKbps, kbps)) / 100) * 100;
  if (target === abr.targetKbps && !force) return;
  // target = what may go over the wire; the encoder gets it scaled by what the governor learned.
  const encoderKbps = Math.max(500, Math.round((target * abr.encoderScale) / 100) * 100);
  if (encoderKbps === abr.encoderKbps && target === abr.targetKbps) return;
  abr.applying = true;
  abr.lastChangeAt = Date.now();
  let applied = false;
  try {
    if (abr.method !== 'none') {
      try {
        const result = await requestHost(host, '/bitrate', { bitrate: encoderKbps, clientname: identity.clientName }, { secure: true, timeout: 3000 });
        if (xmlText(result.body, 'bitrate', '0') === '1') { abr.method = 'http'; applied = true; }
      } catch (error) {
        if (error?.statusCode === 404) abr.method = 'none';
      }
      if (!applied && abr.method !== 'none') {
        const control = activeControl(session);
        if (control) {
          const payload = Buffer.alloc(8);
          payload.writeInt32LE(DYNAMIC_PARAM.BITRATE, 0);
          payload.writeInt32LE(encoderKbps, 4);
          applied = control.sendMessage(CONTROL_DYNAMIC_PARAM, payload) !== false;
          if (applied) abr.method = 'control';
        }
      }
    }
    // Stock Sunshine can't change the bitrate live: reconnect at the new rate, but only for a large drop or a
    // persistent overshoot, and not more than once a minute.
    const bigDrop = reason !== 'probe-up' && reason !== 'relax' && encoderKbps <= (abr.encoderKbps || target) * 0.7;
    const persistentOvershoot = reason === 'over-target' && abr.overshootWindows >= 2;
    if (!applied && abr.method === 'none' && (bigDrop || persistentOvershoot) && Date.now() - (abr.lastReconnectAt || 0) > 60000) {
      abr.lastReconnectAt = Date.now();
      Object.assign(abr, { targetKbps: target, encoderKbps });
      session.bitrateKbps = encoderKbps;
      void reconnectSession(session, 'bitrate');
      applied = true;
    }
    if (applied && activeSession === session) {
      abr.targetKbps = target;
      abr.encoderKbps = encoderKbps;
      session.bitrateKbps = encoderKbps;
      abr.changes += 1;
      broadcastGatewayJson(session, { type: 'bitrate', kbps: target, encoderKbps, reason, method: abr.method });
      emitSessionEvent('session-bitrate', { kbps: target, encoderKbps, reason, method: abr.method });
    }
  } finally {
    abr.applying = false;
  }
}

function websocketHeader(opcode, length) {
  if (length > MEDIA_GATEWAY_MAX_FRAME_BYTES) throw new Error('媒体网关 WebSocket 帧过大');
  if (length < 126) return Buffer.from([0x80 | (opcode & 0x0f), length]);
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | (opcode & 0x0f);
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

function writeUpgradeError(socket, statusCode, message) {
  const body = Buffer.from(String(message || 'WebSocket upgrade rejected'), 'utf8');
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] || 'Error'}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n`);
    socket.write(body);
  } catch { /* the browser may already have closed the handshake socket */ }
  socket.destroy();
}

function isAllowedMediaOrigin(request) {
  return auth.isSameOrigin(request);
}

class MediaGatewayClient {
  constructor(socket, session) {
    this.socket = socket;
    this.session = session;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.closeNotified = false;
    this.corked = false;
    this.droppedPackets = 0;
    this.mediaBatch = [];
    this.mediaBatchBytes = 0;
    this.mediaAudioCount = 0;
    this.mediaFlushScheduled = false;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.handleData(chunk));
    socket.once('close', () => this.cleanup());
    socket.once('error', () => this.cleanup());
  }

  send(opcode, payload = Buffer.alloc(0)) {
    if (this.closed || this.socket.destroyed || this.socket.writableEnded) return false;
    try {
      if (!this.corked) {
        this.corked = true;
        this.socket.cork();
        setImmediate(() => { this.corked = false; this.socket.uncork(); });
      }
      const body = toBuffer(payload);
      this.socket.write(websocketHeader(opcode, body.length));
      if (body.length) this.socket.write(body);
      return true;
    } catch {
      this.cleanup();
      return false;
    }
  }

  sendJson(value) {
    return this.send(0x1, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  sendBinary(payload) {
    return this.send(0x2, payload);
  }

  // Media envelopes that arrive in the same event-loop turn (a UDP burst: one video frame is many packets)
  // go out as ONE WebSocket message of back-to-back envelopes. The browser then handles one message event
  // per burst instead of one per packet.
  queueMedia(envelope) {
    if (this.closed || this.socket.destroyed || this.socket.writableEnded) return false;
    // Audio first: a few hundred bytes that must not wait behind a burst of video packets.
    if (envelope[5] === MEDIA_STREAM_IDS.audio) this.mediaBatch.splice(this.mediaAudioCount++, 0, envelope);
    else this.mediaBatch.push(envelope);
    this.mediaBatchBytes += envelope.length;
    if (this.mediaBatchBytes >= MEDIA_GATEWAY_BATCH_BYTES) this.flushMedia();
    else if (!this.mediaFlushScheduled) {
      this.mediaFlushScheduled = true;
      setImmediate(() => this.flushMedia());
    }
    return true;
  }

  flushMedia() {
    this.mediaFlushScheduled = false;
    if (!this.mediaBatch.length) return;
    const batch = this.mediaBatch;
    const length = this.mediaBatchBytes;
    this.mediaBatch = [];
    this.mediaBatchBytes = 0;
    this.mediaAudioCount = 0;
    if (this.closed || this.socket.destroyed || this.socket.writableEnded) return;
    try {
      this.socket.cork();
      this.socket.write(websocketHeader(0x2, length));
      for (const envelope of batch) this.socket.write(envelope);
      this.socket.uncork();
    } catch {
      this.cleanup();
    }
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const text = Buffer.from(String(reason || '').slice(0, 123), 'utf8');
    const body = Buffer.alloc(2 + text.length);
    body.writeUInt16BE(Number(code) || 1000, 0);
    text.copy(body, 2);
    this.send(0x8, body);
    this.closed = true;
    try { this.socket.end(); } catch { /* already closed */ }
  }

  handleData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, toBuffer(chunk)]);
    if (this.buffer.length > MEDIA_GATEWAY_MAX_FRAME_BYTES * 2) {
      this.close(1009, 'frame too large');
      return;
    }
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        if (high > 0 || low > MEDIA_GATEWAY_MAX_FRAME_BYTES) {
          this.close(1009, 'frame too large');
          return;
        }
        length = low;
        offset += 8;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (!fin) {
        this.close(1003, 'fragmented frames are not supported');
        return;
      }
      if (opcode === 0x8) {
        this.close(1000, '');
        return;
      }
      if (masked && mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      if (opcode === 0x9) this.send(0xA, payload);
      else if (opcode === 0x1) this.handleText(payload.toString('utf8'));
      else if (opcode !== 0xA && opcode !== 0x2) this.close(1003, 'unsupported frame');
    }
  }

  handleText(text) {
    try {
      const message = JSON.parse(text);
      if (message?.type === 'subscribe' && message.sessionId && message.sessionId !== this.session.id) {
        this.close(1008, 'session mismatch');
      } else if (message?.type === 'subscribe') {
        this.wantsFrames = message.frames === true;
      } else if (message?.type === 'input') {
        handleBrowserInput(this.session, message);
      } else if (message?.type === 'request-idr') {
        requestIdrFrame(this.session);
      } else if (message?.type === 'feedback') {
        this.feedback = {
          at: Date.now(),
          queueDelayMs: Math.max(0, Math.min(60000, Number(message.queueDelayMs) || 0)),
          receivedKbps: Math.max(0, Number(message.receivedKbps) || 0),
          lostFrames: Number(message.lostFrames) || 0,
        };
        if (!this.draining && this.feedback.queueDelayMs > DRAIN_ENTER_MS) {
          this.draining = Date.now();
          this.drainEpisodes = (this.drainEpisodes || 0) + 1;
        } else if (this.draining && this.feedback.queueDelayMs < DRAIN_EXIT_MS) {
          stopDraining(this);
        }
      } else if (message?.type === 'ping') {
        this.sendJson({ type: 'pong', id: message.id ?? null, t: message.t ?? null });
      }
    } catch { /* subscription metadata is optional */ }
  }

  cleanup() {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.closed = true;
    removeMediaGatewayClient(this);
  }
}

// Once a second: what only the bridge can see (ENet RTT to the host, UDP receive rate, packets dropped for backpressure).
let mediaStatsTimer = null;
function sendMediaStats() {
  if (!mediaGatewayClients.size) { clearInterval(mediaStatsTimer); mediaStatsTimer = null; return; }
  const session = activeSession;
  const media = session?.transport?.media || {};
  const control = sessionRuntime?.control;
  if (session) evaluateAbr(session);
  for (const client of mediaGatewayClients) {
    if (client.session !== session) continue;
    client.sendJson({
      type: 'stats',
      at: Date.now(),
      hostRttMs: control?.connected ? control.rtt : null,
      hostRttVarianceMs: control?.connected ? control.rttVariance : null,
      videoKbps: media.video?.bitrateKbps ?? null,
      audioKbps: media.audio?.bitrateKbps ?? null,
      videoPackets: media.video?.packets ?? 0,
      droppedPackets: client.droppedPackets,
      draining: Boolean(client.draining),
      drainEpisodes: client.drainEpisodes || 0,
      queuedBytes: client.socket.writableLength,
      width: session?.width ?? null,
      height: session?.height ?? null,
      fps: session?.fps ?? null,
      bitrateKbps: session?.bitrateKbps ?? null,
      abr: session?.abr ? {
        mode: session.abr.mode, targetKbps: session.abr.targetKbps, capKbps: session.abr.capKbps, state: session.abr.state,
        measuredKbps: session.abr.measuredKbps, encoderKbps: session.abr.encoderKbps, encoderScale: Math.round(session.abr.encoderScale * 100) / 100,
        method: session.abr.method, queueDelayMs: session.abr.queueDelayMs, backlogMs: session.abr.backlogMs, changes: session.abr.changes,
      } : null,
      reconnects: session?.reconnects ?? 0,
      videoCodec: session?.videoCodec ?? null,
      frameTransport: Boolean(client.wantsFrames),
      fecPercent: session?.fecPercent ?? null,
      audioPacketMs: session?.audioPacketDurationMs ?? null,
      droppedFrames: client.droppedFrames || 0,
    });
  }
}

function removeMediaGatewayClient(client) {
  if (!mediaGatewayClients.delete(client)) return;
  const session = client.session;
  if (activeSession === session) {
    const nextState = mediaGatewayClientCount(session) ? 'connected' : 'waiting';
    updateMediaGatewayState(session, nextState);
  }
}

function closeMediaGatewayClients(session, code = 1000, reason = '') {
  for (const client of [...mediaGatewayClients]) {
    if (client.session === session) client.close(code, reason);
  }
}

function acceptMediaGateway(request, socket, head) {
  if (request.method !== 'GET' || String(request.headers.upgrade || '').toLowerCase() !== 'websocket') {
    writeUpgradeError(socket, 400, 'Invalid WebSocket upgrade');
    return;
  }
  if (!isAllowedMediaOrigin(request)) {
    writeUpgradeError(socket, 403, 'Local origin required');
    return;
  }
  const key = String(request.headers['sec-websocket-key'] || '').trim();
  if (!key || String(request.headers['sec-websocket-version'] || '13') !== '13') {
    writeUpgradeError(socket, 400, 'Unsupported WebSocket version');
    return;
  }
  if (!activeSession) {
    writeUpgradeError(socket, 409, 'No active stream session');
    return;
  }
  let url;
  try { url = new URL(request.url || MEDIA_GATEWAY_PATH, `http://${request.headers.host || `${BIND}:${PORT}`}`); } catch {
    writeUpgradeError(socket, 400, 'Invalid WebSocket URL');
    return;
  }
  const sessionId = url.searchParams.get('sessionId');
  if (sessionId && sessionId !== activeSession.id) {
    writeUpgradeError(socket, 409, 'Session no longer active');
    return;
  }
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: ${MEDIA_GATEWAY_PROTOCOL}\r\n\r\n`);
  const client = new MediaGatewayClient(socket, activeSession);
  mediaGatewayClients.add(client);
  mediaStatsTimer ||= setInterval(sendMediaStats, MEDIA_STATS_INTERVAL_MS);
  updateMediaGatewayState(activeSession, 'connected', { connectedAt: activeSession.transport.media.gateway?.connectedAt || new Date().toISOString(), lastError: null });
  client.sendJson({ type: 'media-ready', protocol: MEDIA_GATEWAY_PROTOCOL, sessionId: activeSession.id });
  if (head?.length) client.handleData(head);
}

// Sunshine answers each RTSP request and then closes the TCP connection (its responses carry no
// Content-Length), so like other GameStream clients we use one short-lived connection per request and
// read the reply until EOF. A Content-Length, when present, lets us finish early.
class RtspConnection {
  constructor(target, timeout = RTSP_PROBE_TIMEOUT_MS) {
    this.target = target;
    this.timeout = timeout;
    this.closed = false;
    this.nextCseq = 1;
    this.sockets = new Set();
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(rtspFailure('RTSP 会话已关闭'));
        return;
      }
      const socket = net.createConnection({ host: this.target.address, port: this.target.port });
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      socket.setNoDelay(true);
      socket.setTimeout(this.timeout, () => {
        socket.destroy();
        reject(rtspFailure(`RTSP 连接超时（${this.target.address}:${this.target.port}）`));
      });
      socket.once('error', (error) => reject(setErrorCode(error, 'RTSP_NEGOTIATION_FAILED')));
      socket.once('connect', () => {
        socket.removeAllListeners('error');
        socket.setTimeout(0);
        resolve(socket);
      });
    });
  }

  // Reachability probe used by connectRtspWithRetry.
  async connect() {
    const socket = await this.openSocket();
    socket.destroy();
  }

  async request(method, requestTarget, options = {}) {
    const socket = await this.openSocket();
    const cseq = this.nextCseq++;
    const body = options.body == null ? Buffer.alloc(0) : Buffer.from(options.body);
    const headers = {
      CSeq: String(cseq),
      'User-Agent': `Sunbridge/${VERSION}`,
      'X-GS-ClientVersion': String(RTSP_CLIENT_VERSION),
      Host: rtspHostHeader(this.target.address, this.target.port),
      ...(options.headers || {}),
    };
    const hasContentLength = Object.keys(headers).some((key) => key.toLowerCase() === 'content-length');
    if (body.length && !hasContentLength) headers['Content-Length'] = String(body.length);
    const requestText = `${method} ${requestTarget} RTSP/1.0\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`;
    const started = performance.now();
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let settled = false;
      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve({ ...response, elapsedMs: Math.round(performance.now() - started) });
      };
      const timer = setTimeout(() => finish(rtspFailure(`RTSP ${method} 超时（${this.target.address}:${this.target.port}）`, { method, cseq })), options.timeout || this.timeout);
      const tryParse = (atEof) => {
        let response;
        try { response = parseRtspResponse(buffer, atEof); } catch (error) { finish(setErrorCode(error, 'RTSP_NEGOTIATION_FAILED')); return; }
        if (response) finish(null, response);
        else if (atEof) finish(rtspFailure(buffer.length ? `RTSP ${method} 响应不完整` : `RTSP 服务器在 ${method} 响应前关闭连接`, { method, cseq }));
      };
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 4 * 1024 * 1024) finish(rtspFailure('RTSP 响应超过 4 MiB，已停止协商'));
        else tryParse(false);
      });
      socket.once('end', () => tryParse(true));
      socket.once('close', () => tryParse(true));
      socket.once('error', (error) => finish(setErrorCode(error, 'RTSP_NEGOTIATION_FAILED')));
      socket.write(Buffer.concat([Buffer.from(requestText, 'latin1'), body]));
    });
  }

  close() {
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }
}

function pseqKey(value) {
  return String(value);
}

async function connectRtspWithRetry(connection) {
  let lastError = null;
  for (let attempt = 0; attempt < RTSP_CONNECT_RETRIES; attempt += 1) {
    try {
      await connection.connect();
      return;
    } catch (error) {
      lastError = error;
      connection.close();
      connection.closed = false;
      connection.buffer = Buffer.alloc(0);
      connection.socket = null;
      if (attempt + 1 < RTSP_CONNECT_RETRIES) await delay(RTSP_CONNECT_RETRY_DELAY_MS);
    }
  }
  throw setErrorCode(lastError || new Error('RTSP 连接失败'), 'RTSP_NEGOTIATION_FAILED');
}

function bindUdpSocket(type, onMessage) {
  const socketType = type === 'udp6' ? 'udp6' : 'udp4';
  const socket = dgram.createSocket(socketType);
  if (onMessage) socket.on('message', onMessage);
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      socket.removeListener('error', fail);
      try { socket.close(); } catch { /* already closed */ }
      reject(error);
    };
    socket.once('error', fail);
    socket.bind(0, type === 'udp6' ? '::' : '0.0.0.0', () => {
      socket.removeListener('error', fail);
      // Keyframes arrive as bursts of hundreds of packets; a small kernel buffer drops them.
      try { socket.setRecvBufferSize(8 * 1024 * 1024); } catch { /* capped by the OS */ }
      socket.on('error', () => {});
      resolve(socket);
    });
  });
}

function sendUdpPing(runtime, streamName) {
  const setup = runtime.setup[streamName];
  const socket = runtime.udp[streamName];
  if (!setup?.serverPort || !socket || runtime.closed) return;
  const payloadText = /^[0-9a-f]{16}$/i.test(String(setup.pingPayload || '').trim()) ? String(setup.pingPayload).trim() : 'PING';
  const packet = Buffer.alloc(Buffer.byteLength(payloadText, 'ascii') + 4);
  packet.write(payloadText, 0, 'ascii');
  packet.writeUInt32BE(runtime.pingSequence = (runtime.pingSequence + 1) >>> 0, packet.length - 4);
  socket.send(packet, setup.serverPort, runtime.target.address, () => {});
}

function startUdpPings(runtime, streamName) {
  if (!runtime.setup[streamName]?.serverPort || !runtime.udp[streamName]) return;
  sendUdpPing(runtime, streamName);
  runtime.pingTimers[streamName] = setInterval(() => sendUdpPing(runtime, streamName), UDP_PING_INTERVAL_MS);
}

// No video for a while although the stream was running: ask for a keyframe, then rebuild the connection.
function startMediaWatchdog(session, runtime) {
  if (runtime.watchdog) return;
  runtime.watchdog = setInterval(() => {
    if (runtime.closed || activeSession !== session || session.reconnect || session.terminatedBy) return;
    const silentMs = performance.now() - runtime.lastVideoAtMs;
    if (silentMs >= MEDIA_STALL_RECONNECT_MS) {
      void reconnectSession(session, 'media-stall');
    } else if (silentMs >= MEDIA_STALL_IDR_MS && performance.now() - (runtime.lastStallIdrAtMs || 0) >= MEDIA_STALL_IDR_MS) {
      runtime.lastStallIdrAtMs = performance.now();
      requestIdrFrame(session);
    }
  }, 1000);
  runtime.watchdog.unref?.();
}

function stopRuntime(runtime) {
  if (!runtime || runtime.closed) return;
  runtime.closed = true;
  if (sessionRuntime === runtime) sessionRuntime = null;
  clearInterval(runtime.watchdog);
  for (const timer of Object.values(runtime.pingTimers || {})) clearInterval(timer);
  runtime.pingTimers = {};
  runtime.rtsp?.close();
  try { runtime.control?.close(); } catch { /* already closed */ }
  runtime.control = null;
  for (const socket of Object.values(runtime.udp || {})) {
    try { socket.close(); } catch { /* already closed */ }
  }
  runtime.udp = {};
}

function updateMediaState(session, runtime, streamName, packet, rinfo) {
  if (activeSession !== session || runtime.closed) return;
  const rtp = parseRtpPacket(packet);
  if (!rtp) return;
  const media = session.transport.media[streamName] || (session.transport.media[streamName] = createMediaStats());
  const nowMs = performance.now();
  if (streamName === 'video') {
    runtime.lastVideoAtMs = nowMs;
    startMediaWatchdog(session, runtime);
  }
  media.state = 'connected';
  media.packets += 1;
  media.bytes += packet.length;
  media.firstPacketAt ||= new Date().toISOString();
  if (!media.payloadTypes.includes(rtp.payloadType) && media.payloadTypes.length < 16) media.payloadTypes.push(rtp.payloadType);
  if (!media.source || media.source.port !== rinfo.port || media.source.address !== rinfo.address) media.source = { address: rinfo.address, port: rinfo.port };
  media.rtp = rtp;
  // Bitrate over a ~1 s window (a per-packet rate is just noise).
  const rate = runtime.mediaLastAt[streamName] || (runtime.mediaLastAt[streamName] = { at: nowMs, bytes: media.bytes - packet.length });
  if (nowMs - rate.at >= 1000) {
    media.bitrateKbps = Math.round(((media.bytes - rate.bytes) * 8 / (nowMs - rate.at)) * 10) / 10;
    rate.at = nowMs;
    rate.bytes = media.bytes;
  }
  if (session.transport.media.state !== 'connected') {
    session.transport.media.state = 'connected';
    session.mediaTransport = 'connected';
    emitSessionEvent('media-first-packet', { stream: streamName });
  }
  const lastEventAt = runtime.mediaLastEventAt[streamName] || 0;
  if (!lastEventAt || nowMs - lastEventAt >= MEDIA_EVENT_THROTTLE_MS) {
    runtime.mediaLastEventAt[streamName] = nowMs;
    media.lastPacketAt = new Date().toISOString();
    emitSessionEvent('media-stats', { stream: streamName });
  }
  if (streamName === 'audio') {
    // Audio FEC: the link to Sunshine is lossless here and browsers don't use it (a third of all audio packets).
    if (rtp.payloadType === AUDIO_FEC_PAYLOAD_TYPE) return;
    session.transport.media.forwardedBytes = (session.transport.media.forwardedBytes || 0) + packet.length;
    broadcastMediaPacket(session, 'audio', packet);
  } else if (streamName === 'video') {
    broadcastMediaPacket(session, 'video', packet);
    if (hasFrameClients(session)) feedFrameAssembler(session, runtime, packet);
  }
}

// GameStream-style defaults: ~5 Mbps for 720p30, scaling with pixels and frame rate (720p60 = 10, 1080p60 = 22.5, 4K60 = 90).
function defaultBitrateKbps(width = 1920, height = 1080, fps = 60) {
  const scale = (Number(width) * Number(height) * Number(fps)) / (1280 * 720 * 30);
  return Math.min(150000, Math.max(2000, Math.round((5000 * scale) / 500) * 500));
}

function buildAnnounceSdp(session, target, videoServerPort) {
  const bitrate = Math.max(500, Math.round(Number(session.bitrateKbps) || defaultBitrateKbps(session.width, session.height, session.fps)));
  const addressFamily = target.address.includes(':') ? 'IP6' : 'IP4';
  const lines = [
    'v=0',
    `o=android 0 ${RTSP_CLIENT_VERSION} IN ${addressFamily} ${target.address}`,
    's=NVIDIA Streaming Client',
    'a=x-ml-general.featureFlags:3',
    `a=x-ss-general.encryptionEnabled:${SS_ENC_CONTROL_V2}`,
    'a=x-ss-video[0].chromaSamplingType:0',
    `a=x-nv-video[0].clientViewportWd:${session.width || 1920}`,
    `a=x-nv-video[0].clientViewportHt:${session.height || 1080}`,
    `a=x-nv-video[0].maxFPS:${session.fps || 60}`,
    'a=x-nv-video[0].packetSize:1392',
    'a=x-nv-video[0].rateControlMode:4',
    'a=x-nv-video[0].timeoutLengthMs:7000',
    'a=x-nv-video[0].framesWithInvalidRefThreshold:0',
    `a=x-nv-video[0].initialBitrateKbps:${bitrate}`,
    `a=x-nv-video[0].initialPeakBitrateKbps:${bitrate}`,
    `a=x-nv-vqos[0].bw.minimumBitrateKbps:${bitrate}`,
    `a=x-nv-vqos[0].bw.maximumBitrateKbps:${bitrate}`,
    `a=x-ml-video.configuredBitrateKbps:${bitrate}`,
    'a=x-nv-video[0].videoEncoderSlicesPerFrame:1',
    'a=x-nv-video[0].maxNumReferenceFrames:1',
    'a=x-nv-video[0].encoderCscMode:0',
    'a=x-nv-video[0].dynamicRangeMode:0',
    'a=x-nv-audio.surround.numChannels:2',
    'a=x-nv-audio.surround.channelMask:3',
    'a=x-nv-audio.surround.enable:0',
    'a=x-nv-audio.surround.AudioQuality:0',
    `a=x-nv-aqos.packetDuration:${session.audioPacketDurationMs || 5}`,
    `a=x-nv-general.useReliableUdp:${CONTROL_PROTOCOL_ENCRYPTED}`,
    'a=x-nv-general.featureFlags:135',
    'a=x-nv-vqos[0].fec.minRequiredFecPackets:0',
    `a=x-nv-vqos[0].bitStreamFormat:${VIDEO_CODECS[session.videoCodec] || 0}`,
    `a=x-nv-clientSupportHevc:${session.videoCodec === 'hevc' ? 1 : 0}`,
    'a=x-nv-vqos[0].qosTrafficType:5',
    'a=x-nv-aqos.qosTrafficType:4',
    't=0 0',
    `m=video ${videoServerPort || DEFAULT_VIDEO_PORT} RTP/AVP 96`,
  ];
  return `${lines.join('\r\n')}\r\n`;
}

async function setupRtspStream(connection, session, runtime, streamName, targetName, fallbackServerPort) {
  const onMessage = streamName === 'control' ? null : (packet, rinfo) => updateMediaState(session, runtime, streamName, packet, rinfo);
  const socket = await bindUdpSocket(runtime.target.address.includes(':') ? 'udp6' : 'udp4', onMessage);
  runtime.udp[streamName] = socket;
  const clientPort = socket.address().port;
  const headers = {
    Transport: `unicast;X-GS-ClientPort=${clientPort}`,
    'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
  };
  if (runtime.sessionId) headers.Session = runtime.sessionId;
  const response = await connection.request('SETUP', targetName, { headers });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw rtspFailure(`RTSP SETUP ${streamName} 返回 ${response.statusCode}${response.statusMessage ? ` ${response.statusMessage}` : ''}`, { stage: `SETUP ${streamName}`, statusCode: response.statusCode });
  }
  const sessionId = parseRtspSessionId(response.headers.session);
  if (sessionId && !runtime.sessionId) runtime.sessionId = sessionId;
  if (!runtime.sessionId) throw rtspFailure(`RTSP SETUP ${streamName} 缺少 Session`, { stage: `SETUP ${streamName}`, statusCode: response.statusCode });
  const serverPort = parseServerPort(response.headers.transport, fallbackServerPort);
  const setup = {
    state: 'connected',
    statusCode: response.statusCode,
    clientPort,
    serverPort,
    serverPortSource: parseServerPort(response.headers.transport, null) ? 'rtsp' : 'default',
    transport: response.headers.transport || null,
    hasPingPayload: Boolean(response.headers['x-ss-ping-payload']),
  };
  session.transport.rtsp.setup[streamName] = setup;
  runtime.setup[streamName] = { ...setup, pingPayload: response.headers['x-ss-ping-payload'] || '', connectData: response.headers['x-ss-connect-data'] || null };
  if (streamName === 'video' || streamName === 'audio') {
    session.transport.media[streamName] = createMediaStats(serverPort, clientPort);
    startUdpPings(runtime, streamName);
  } else {
    session.transport.input = { state: 'waiting', clientPort, serverPort, errorCode: null, protocol: 'enet-encrypted-v2' };
  }
  runtime.setupOrder.push(streamName);
  emitSessionEvent('rtsp-setup', { stream: streamName, statusCode: response.statusCode, serverPort, clientPort });
  return response;
}

function broadcastGatewayJson(session, value) {
  for (const client of mediaGatewayClients) {
    if (client.session === session) client.sendJson(value);
  }
}

function activeControl(session) {
  if (activeSession !== session || !sessionRuntime || sessionRuntime.session !== session) return null;
  const control = sessionRuntime.control;
  return control?.connected ? control : null;
}

function handleBrowserInput(session, message) {
  const control = activeControl(session);
  if (!control) return false;
  const events = Array.isArray(message.events) ? message.events : [message];
  const input = session.transport.input;
  let sent = 0;
  for (const event of events.slice(0, 256)) {
    let encoded = null;
    try { encoded = encodeBrowserInput(event); } catch { encoded = null; }
    if (!encoded) continue;
    const [packet, channelId, mode] = encoded;
    if (control.sendInput(packet, channelId, mode)) sent += 1;
  }
  input.packets = (input.packets || 0) + sent;
  input.lastInputAt = new Date().toISOString();
  input.rttMs = control.rtt;
  const now = performance.now();
  if (!input.lastEventAt || now - input.lastEventAt >= INPUT_EVENT_THROTTLE_MS) {
    input.lastEventAt = now;
    emitSessionEvent('input-stats', { packets: input.packets, rttMs: input.rttMs });
  }
  return sent > 0;
}

function requestIdrFrame(session) {
  const control = activeControl(session);
  if (!control) return false;
  session.transport.input.idrRequests = (session.transport.input.idrRequests || 0) + 1;
  return control.requestIdr();
}

async function startControlStream(session, runtime) {
  const input = session.transport.input;
  const setup = runtime.setup.control;
  const secret = sessionSecrets.get(session);
  if (!setup?.serverPort || !secret) {
    Object.assign(input, { state: 'failed', errorCode: 'CONTROL_SETUP_MISSING', error: 'RTSP SETUP 未返回控制流端口或会话密钥' });
    emitSessionEvent('input-failed', { errorCode: input.errorCode });
    return;
  }
  const control = new ControlStream({
    address: runtime.target.address,
    port: setup.serverPort,
    key: secret.riKey,
    connectData: Number(setup.connectData) || 0,
    socket: runtime.udp.control || null,
  });
  // The control stream now owns the socket so its DISCONNECT is flushed before closing.
  if (runtime.udp.control) {
    delete runtime.udp.control;
    control.enet.ownsSocket = true;
  }
  runtime.control = control;
  Object.assign(input, { state: 'connecting', errorCode: null, error: null });
  emitSessionEvent('input-connecting', { serverPort: setup.serverPort });
  control.on('close', (reason) => {
    if (runtime.closed || activeSession !== session) return;
    const wasConnected = input.state === 'connected';
    Object.assign(input, { state: 'not-connected', errorCode: 'INPUT_DISCONNECTED', error: `control stream closed (${reason})` });
    emitSessionEvent('input-disconnected', { reason });
    // Only a control stream that was up and then dropped means the host link broke (a blocked control port
    // would otherwise reconnect forever). The host ending the stream on purpose is respected: a termination
    // message, or an ENet DISCONNECT from Sunshine (session stopped in Sunshine, Sunshine's own ping timeout).
    if (!wasConnected || session.terminatedBy) return;
    if (reason === 'remote') endSession(session, { errorCode: 'HOST_DISCONNECTED', error: 'Sunshine closed the control stream' });
    else void reconnectSession(session, `control-${reason}`);
  });
  control.on('termination', (code) => {
    if (runtime.closed || activeSession !== session) return;
    const hex = code == null ? null : `0x${(code >>> 0).toString(16).padStart(8, '0')}`;
    session.terminatedBy = hex;
    broadcastGatewayJson(session, { type: 'termination', code: hex });
    emitSessionEvent('session-terminated', { code: hex });
    // As in other GameStream clients: a graceful termination means the host ended the stream (stopped in Sunshine, app quit,
    // another client took over) -> end the session and say so. Anything else is an error on the host side
    // (encoder failure, ...) -> try to get the stream back via /resume; if the app is gone that ends it too.
    if ((code >>> 0) === SUNSHINE_GRACEFUL_TERMINATION || code == null) {
      endSession(session, { errorCode: 'HOST_TERMINATED', error: hex });
    } else {
      session.terminatedBy = null;
      void reconnectSession(session, 'host-error');
    }
  });
  control.on('rumble', (rumble) => broadcastGatewayJson(session, { type: 'rumble', ...rumble }));
  control.on('hdr', (hdr) => broadcastGatewayJson(session, { type: 'hdr', ...hdr }));
  try {
    await control.start();
  } catch (error) {
    if (runtime.closed || activeSession !== session) return;
    Object.assign(input, { state: 'failed', errorCode: error?.errorCode || 'CONTROL_CONNECT_FAILED', error: safeError(error) });
    emitSessionEvent('input-failed', { errorCode: input.errorCode, error: input.error });
    return;
  }
  if (runtime.closed || activeSession !== session) {
    control.close();
    return;
  }
  Object.assign(input, { state: 'connected', connectedAt: new Date().toISOString(), packets: 0, idrRequests: 1 });
  emitSessionEvent('input-connected', { serverPort: setup.serverPort });
}

async function negotiateSessionTransport(session, host, { rethrow = false } = {}) {
  let runtime = null;
  const started = performance.now();
  try {
    const target = parseRtspUrl(session.sessionUrl, host.address, host.rtspPort || DEFAULT_RTSP_PORT);
    // Resolve hostnames once so the UDP media/control sockets don't hit DNS on every datagram.
    if (!net.isIP(target.address)) {
      const resolved = await dns.promises.lookup(target.address);
      target.hostname = target.address;
      target.address = resolved.address;
    }
    session.transport.rtsp.url = target.uri;
    session.transport.rtsp.scheme = target.scheme;
    if (target.scheme === 'rtspenc') {
      const error = bridgeError('Sunshine 返回加密 RTSP（rtspenc://）；当前 Bridge 不解密加密媒体。', 'RTSP_ENCRYPTED_UNSUPPORTED');
      session.transport.rtsp = { ...session.transport.rtsp, state: 'unsupported', statusCode: null, errorCode: error.errorCode, error: error.message };
      session.transport.media.state = 'not-connected';
      session.mediaTransport = 'not-connected';
      session.transport.media.gateway.state = 'unsupported';
      session.transport.media.gateway.lastError = error.errorCode;
      closeMediaGatewayClients(session, 1003, 'encrypted media is unsupported');
      emitSessionEvent('session-failed', { errorCode: error.errorCode, error: error.message });
      return;
    }
    runtime = {
      session,
      target,
      rtsp: new RtspConnection(target),
      udp: {},
      setup: {},
      pingTimers: {},
      pingSequence: 0,
      setupOrder: [],
      mediaLastAt: {},
      mediaLastEventAt: {},
      closed: false,
    };
    sessionRuntime = runtime;
    emitSessionEvent('rtsp-probing', { url: target.uri });
    await connectRtspWithRetry(runtime.rtsp);
    const optionsResponse = await runtime.rtsp.request('OPTIONS', target.uri);
    if (optionsResponse.statusCode < 200 || optionsResponse.statusCode >= 300) {
      throw rtspFailure(`RTSP OPTIONS 返回 ${optionsResponse.statusCode}${optionsResponse.statusMessage ? ` ${optionsResponse.statusMessage}` : ''}`, { stage: 'OPTIONS', statusCode: optionsResponse.statusCode });
    }
    session.transport.rtsp.optionsStatusCode = optionsResponse.statusCode;
    session.transport.rtsp.public = optionsResponse.headers.public || null;
    emitSessionEvent('rtsp-options', { statusCode: optionsResponse.statusCode });

    const describeResponse = await runtime.rtsp.request('DESCRIBE', target.uri, {
      headers: { Accept: 'application/sdp', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
    });
    if (describeResponse.statusCode < 200 || describeResponse.statusCode >= 300) {
      throw rtspFailure(`RTSP DESCRIBE 返回 ${describeResponse.statusCode}${describeResponse.statusMessage ? ` ${describeResponse.statusMessage}` : ''}`, { stage: 'DESCRIBE', statusCode: describeResponse.statusCode });
    }
    session.transport.rtsp.describeStatusCode = describeResponse.statusCode;
    session.transport.rtsp.contentType = describeResponse.headers['content-type'] || null;
    session.transport.rtsp.sdpBytes = describeResponse.body.length;
    emitSessionEvent('rtsp-describe', { statusCode: describeResponse.statusCode, sdpBytes: describeResponse.body.length });

    await setupRtspStream(runtime.rtsp, session, runtime, 'audio', 'streamid=audio/0/0', DEFAULT_AUDIO_PORT);
    await setupRtspStream(runtime.rtsp, session, runtime, 'video', 'streamid=video/0/0', DEFAULT_VIDEO_PORT);
    await setupRtspStream(runtime.rtsp, session, runtime, 'control', 'streamid=control/13/0', DEFAULT_CONTROL_PORT);

    const announceBody = buildAnnounceSdp(session, target, session.transport.rtsp.setup.video.serverPort);
    const announceHeaders = {
      Session: runtime.sessionId,
      'Content-Type': 'application/sdp',
      'Content-Length': String(Buffer.byteLength(announceBody)),
    };
    const announceResponse = await runtime.rtsp.request('ANNOUNCE', 'streamid=control/13/0', { headers: announceHeaders, body: announceBody });
    if (announceResponse.statusCode < 200 || announceResponse.statusCode >= 300) {
      throw rtspFailure(`RTSP ANNOUNCE 返回 ${announceResponse.statusCode}${announceResponse.statusMessage ? ` ${announceResponse.statusMessage}` : ''}`, { stage: 'ANNOUNCE', statusCode: announceResponse.statusCode });
    }
    session.transport.rtsp.announce = { statusCode: announceResponse.statusCode, sdpBytes: Buffer.byteLength(announceBody) };
    emitSessionEvent('rtsp-announce', { statusCode: announceResponse.statusCode, sdpBytes: Buffer.byteLength(announceBody) });

    const playResponse = await runtime.rtsp.request('PLAY', '/', { headers: { Session: runtime.sessionId } });
    if (playResponse.statusCode < 200 || playResponse.statusCode >= 300) {
      throw rtspFailure(`RTSP PLAY 返回 ${playResponse.statusCode}${playResponse.statusMessage ? ` ${playResponse.statusMessage}` : ''}`, { stage: 'PLAY', statusCode: playResponse.statusCode });
    }
    session.transport.rtsp.play = { statusCode: playResponse.statusCode };
    session.transport.rtsp.statusCode = playResponse.statusCode;
    session.transport.rtsp.state = 'negotiated';
    session.transport.rtsp.elapsedMs = Math.round(performance.now() - started);
    session.transport.rtsp.sessionId = runtime.sessionId;
    session.transport.media.state = 'waiting';
    session.mediaTransport = 'waiting';
    emitSessionEvent('rtsp-negotiated', { statusCode: playResponse.statusCode, elapsedMs: session.transport.rtsp.elapsedMs });
    // Media already flows after PLAY; the control stream connects in the background (it reports its own state).
    void startControlStream(session, runtime);
  } catch (error) {
    if (activeSession !== session) {
      stopRuntime(runtime);
      return;
    }
    if (rethrow) {
      stopRuntime(runtime);
      throw error;
    }
    // Superseded by a reconnect (it closed this attempt's RTSP connection): not a session failure.
    if (session.reconnect) {
      stopRuntime(runtime);
      return;
    }
    const failure = setErrorCode(error, error?.errorCode || 'RTSP_NEGOTIATION_FAILED');
    const unsupported = failure.errorCode === 'RTSP_ENCRYPTED_UNSUPPORTED';
    session.transport.rtsp = {
      ...(session.transport.rtsp || {}),
      state: unsupported ? 'unsupported' : 'failed',
      statusCode: Number.isFinite(Number(failure.statusCode)) ? Number(failure.statusCode) : session.transport.rtsp?.statusCode || null,
      errorCode: failure.errorCode,
      error: safeError(failure),
      elapsedMs: Math.round(performance.now() - started),
    };
    session.transport.media.state = 'not-connected';
    session.transport.input.state = 'not-connected';
    session.mediaTransport = 'not-connected';
    session.transport.media.gateway.state = unsupported ? 'unsupported' : 'failed';
    session.transport.media.gateway.lastError = failure.errorCode;
    closeMediaGatewayClients(session, unsupported ? 1003 : 1011, safeError(failure));
    emitSessionEvent('session-failed', { errorCode: failure.errorCode, error: safeError(failure), stage: failure.stage || null });
    stopRuntime(runtime);
  }
}

async function pingHost(host) {
  const secureControl = Boolean(host.paired && host.serverCertBase64);
  const controlProtocol = secureControl ? 'https' : 'http';
  const controlPort = secureControl ? (host.httpsPort || DEFAULT_HTTPS_PORT) : (host.httpPort || DEFAULT_HTTP_PORT);
  const rtspPort = host.rtspPort || DEFAULT_RTSP_PORT;
  const probes = [];
  for (let index = 0; index < 3; index += 1) probes.push(await tcpProbe(host, controlPort));
  const successful = probes.filter((probe) => probe.ok).map((probe) => probe.elapsedMs);
  const latency = successful.length ? Math.round(successful.reduce((sum, value) => sum + value, 0) / successful.length) : null;
  const differences = successful.slice(1).map((value, index) => Math.abs(value - successful[index]));
  const jitter = differences.length ? Math.round((differences.reduce((sum, value) => sum + value, 0) / differences.length) * 10) / 10 : null;
  const loss = Math.round((1 - successful.length / probes.length) * 100);
  const rtspProbe = await tcpProbe(host, rtspPort);
  return {
    host: hostPublic(host),
    controlPort,
    controlProtocol,
    latency,
    jitter,
    loss,
    route: isPrivateAddress(host.address) ? 'LAN' : 'Remote',
    probes,
    rtsp: {
      ok: rtspProbe.ok,
      port: rtspPort,
      elapsedMs: rtspProbe.elapsedMs,
      error: rtspProbe.error,
    },
  };
}

function parseMac(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '');
  if (!/^[0-9a-f]{12}$/i.test(compact)) throw bridgeError('Wake-on-LAN 需要 12 位十六进制 MAC 地址', 'WAKE_MAC_REQUIRED');
  return Buffer.from(compact, 'hex');
}

function sendWakeOnLan(macAddress) {
  const mac = parseMac(macAddress);
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)]);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (error) => { socket.close(); reject(error); });
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.send(packet, 0, packet.length, 9, '255.255.255.255', (error) => {
          socket.close();
          if (error) reject(error); else resolve();
        });
      } catch (error) {
        socket.close();
        reject(error);
      }
    });
  });
}

function findHost(input = {}) {
  const id = input.hostId || input.id;
  if (id && hosts[id]) return hosts[id];
  const address = input.address || input.host || input.ip;
  if (id && !address) throw bridgeError(`未找到主机 ${id}`, 'HOST_NOT_FOUND');
  if (address) {
    const parsed = parseHostAddress(address);
    const requestedPort = validPort(input.port) || parsed.port;
    const requestedScheme = input.scheme || parsed.scheme || (requestedPort === DEFAULT_HTTPS_PORT ? 'https' : 'http');
    const found = Object.values(hosts).find((host) => {
      if (host.address !== parsed.address) return false;
      if (!requestedPort) return true;
      return (requestedScheme === 'https' ? host.httpsPort : host.httpPort) === requestedPort;
    });
    if (found) return found;
    return ensureHost({ ...input, address });
  }
  const first = Object.values(hosts)[0];
  if (!first) throw bridgeError('尚未添加 Sunshine 主机', 'HOST_NOT_FOUND');
  return first;
}

async function getAppForLaunch(host, input) {
  if (input.appId !== undefined && input.appId !== null && input.appId !== '') {
    const id = Number(input.appId);
    return { id: Number.isFinite(id) ? id : input.appId, name: input.appName || String(input.appId) };
  }
  const requestedName = String(input.appName || 'Desktop').trim();
  let apps = Array.isArray(host.apps) ? host.apps : [];
  if (!apps.length) {
    try { apps = (await requestApps(host)).apps; } catch (error) {
      throw bridgeError(`无法读取应用列表：${safeError(error)}`, error?.errorCode || 'SUNSHINE_REQUEST_FAILED', { cause: error });
    }
  }
  const match = apps.find((app) => app.name.toLowerCase() === requestedName.toLowerCase()) || apps.find((app) => app.name.toLowerCase().includes(requestedName.toLowerCase()));
  if (!match) throw bridgeError(`应用列表中没有找到“${requestedName}”，请先刷新主机应用列表`, 'SUNSHINE_REQUEST_FAILED');
  return match;
}

async function launchHost(input) {
  if (activeSession) await stopSession();
  const host = findHost(input);
  if (!host.paired) throw bridgeError('请先完成主机配对', 'NOT_PAIRED');
  const app = await getAppForLaunch(host, input);
  // Per-host overrides (host management panel) win over the client's global defaults.
  const stream = normalizeStreamSettings(host.stream);
  const width = Number(stream.width || input.width || 1920);
  const height = Number(stream.height || input.height || 1080);
  const fps = Number(stream.fps || input.fps || 60);
  const requestedBitrate = stream.bitrateKbps || Number(input.bitrateKbps);
  const capKbps = requestedBitrate > 0 ? Math.round(requestedBitrate) : defaultBitrateKbps(width, height, fps);
  const bitrateMode = stream.bitrateMode || (input.bitrateMode === 'fixed' ? 'fixed' : 'auto');
  // Browser on the internet: start moderate and probe up instead of flooding an unknown uplink.
  const remoteClient = input.clientAddress ? !isPrivateAddress(input.clientAddress) : false;
  const targetKbps = bitrateMode === 'auto' && remoteClient ? Math.min(capKbps, ABR_REMOTE_START_KBPS) : capKbps;
  const riKey = randomBytes(16);
  const riKeyId = crypto.randomInt(1, 0x7fffffff);
  const launchOptions = {
    sops: input.sops ? 1 : 0,
    // 1 = keep audio on the host PC ("play audio on host"); default streams it to the client.
    localAudioPlayMode: input.localAudioPlayMode === true ? 1 : 0,
    surroundAudioInfo: input.surroundAudioInfo || 196610,
    remoteControllersBitmap: input.remoteControllersBitmap || 0,
    gcmap: input.gcmap || 0,
    gcpersist: input.gcpersist || 0,
  };
  // Same app still running on the host (bridge restarted, browser reconnecting): resume it instead of
  // launching, as GameStream clients do. A different running app is left to Sunshine to refuse.
  const info = await requestServerInfo(host).catch(() => null);
  const resume = Boolean(info?.currentGame) && info.currentGame === Number(app.id);
  // Most efficient codec both sides can do (browser lists what it decodes, in its order of preference).
  const hostCodecs = info?.serverCodecModeSupport || 0;
  const hostSupports = { h264: true, hevc: Boolean(hostCodecs & SCM_HEVC), av1: Boolean(hostCodecs & SCM_AV1_MAIN8) };
  const browserCodecs = Array.isArray(input.videoCodecs) ? input.videoCodecs.filter((codec) => codec in VIDEO_CODECS) : [];
  const videoCodec = browserCodecs.find((codec) => hostSupports[codec]) || 'h264';
  // Whole frames to the browser (no FEC parity / RTP headers): the encoder may then use the bandwidth FEC took.
  const frameTransport = input.frames === true;
  const encoderScale = frameTransport ? 100 / (100 - ASSUMED_FEC_PERCENT) : 1;
  const bitrateKbps = Math.round((targetKbps * encoderScale) / 100) * 100;
  const endpoint = resume ? '/resume' : '/launch';
  const response = assertSunshineSuccess(await requestHost(host, endpoint, {
    ...sunshineStreamParams({ width, height, fps, launchOptions }, riKey, riKeyId),
    ...(resume ? {} : { appid: app.id }),
  }, { secure: true }), endpoint);
  if (resume ? xmlText(response.body, 'resume', '0') === '0' : xmlText(response.body, 'gamesession', '0') === '0') {
    throw bridgeError(xmlText(response.body, 'paired', null) === '0' ? 'Sunshine 拒绝启动请求' : 'Sunshine 没有建立游戏会话', 'SUNSHINE_REQUEST_FAILED');
  }
  const session = {
    id: crypto.randomUUID(),
    hostId: host.id,
    hostName: host.name,
    appId: app.id,
    appName: app.name,
    width,
    height,
    fps,
    bitrateKbps,
    bitrateExplicit: requestedBitrate > 0,
    videoCodec,
    frameTransport,
    // 10 ms audio packets halve the packet rate over the internet (GameStream clients do the same on slow links).
    audioPacketDurationMs: remoteClient ? 10 : 5,
    fecPercent: null,
    abr: { mode: bitrateMode, capKbps, targetKbps, encoderKbps: bitrateKbps, encoderScale, overshootWindows: 0, measuredKbps: null, rateWindow: null, state: 'starting', method: null, changes: 0, lastChangeAt: Date.now(), goodSince: null, remoteClient },
    launchOptions,
    resumed: resume,
    reconnects: 0,
    reconnect: null,
    startedAt: new Date().toISOString(),
    sessionUrl: xmlText(response.body, 'sessionUrl0', null),
    controlPlane: 'started',
    mediaTransport: 'waiting',
    transport: {
      rtsp: { state: 'probing', statusCode: null, optionsStatusCode: null, describeStatusCode: null, elapsedMs: null, setup: {} },
      media: { state: 'waiting', video: createMediaStats(), audio: createMediaStats(), gateway: createMediaGatewayStats() },
      input: { state: 'not-connected' },
    },
  };
  sessionSecrets.set(session, { riKey, riKeyId });
  activeSession = session;
  emitSessionEvent('session-started', { hostId: host.id, appId: app.id, appName: app.name });
  void negotiateSessionTransport(session, host);
  return { ...session, host: hostPublic(host), raw: response.body };
}

function sunshineStreamParams(session, riKey, riKeyId) {
  return {
    mode: `${session.width}x${session.height}x${session.fps}`,
    additionalStates: 1,
    rikey: hex(riKey),
    rikeyid: riKeyId,
    ...session.launchOptions,
    uniqueid: identity.uniqueId,
    clientname: identity.clientName,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resetTransportForReconnect(session) {
  session.transport.rtsp = { state: 'probing', statusCode: null, optionsStatusCode: null, describeStatusCode: null, elapsedMs: null, setup: {} };
  session.transport.input = { state: 'not-connected' };
  session.transport.media.state = 'waiting';
  session.mediaTransport = 'waiting';
}

// Rebuild RTSP/UDP/control for the active session via /resume (app keeps running on the host).
// Browsers stay subscribed to the same session object; they get "reconnecting" and then "stream-reset".
function reconnectSession(session, reason, size = null) {
  if (activeSession !== session) return null;
  if (size) Object.assign(session, size);
  if (session.reconnect?.promise) return session.reconnect.promise;
  const host = hosts[session.hostId];
  if (!host) return null;
  const state = { reason, attempt: 0, startedAt: new Date().toISOString(), promise: null };
  session.reconnect = state;
  state.promise = (async () => {
    stopRuntime(sessionRuntime);
    resetTransportForReconnect(session);
    let lastError = null;
    for (let attempt = 0; attempt <= RECONNECT_DELAYS_MS.length; attempt += 1) {
      if (activeSession !== session) return false;
      state.attempt = attempt + 1;
      broadcastGatewayJson(session, { type: 'reconnecting', reason, attempt: state.attempt, maxAttempts: RECONNECT_DELAYS_MS.length + 1 });
      emitSessionEvent('session-reconnecting', { reason, attempt: state.attempt });
      try {
        const riKey = randomBytes(16);
        const riKeyId = crypto.randomInt(1, 0x7fffffff);
        const response = assertSunshineSuccess(await requestHost(host, '/resume', sunshineStreamParams(session, riKey, riKeyId), { secure: true }), '/resume');
        if (xmlText(response.body, 'resume', '0') === '0') throw bridgeError('主机上的应用已经退出，无法恢复会话', 'HOST_APP_EXITED', { fatal: true });
        if (activeSession !== session) return false;
        sessionSecrets.set(session, { riKey, riKeyId });
        session.sessionUrl = xmlText(response.body, 'sessionUrl0', session.sessionUrl);
        resetTransportForReconnect(session);
        await negotiateSessionTransport(session, host, { rethrow: true });
        if (activeSession !== session) return false;
        session.reconnects += 1;
        session.reconnect = null;
        session.lastReconnectAt = new Date().toISOString();
        // A new RTP stream starts (new frame numbers, new keyframe): browsers rebuild their decoders.
        broadcastGatewayJson(session, { type: 'stream-reset', reason, width: session.width, height: session.height });
        emitSessionEvent('session-reconnected', { reason, attempts: state.attempt });
        return true;
      } catch (error) {
        lastError = error;
        stopRuntime(sessionRuntime);
        if (error?.fatal || error?.statusCode === 503) break;
        if (attempt < RECONNECT_DELAYS_MS.length) await sleep(RECONNECT_DELAYS_MS[attempt]);
      }
    }
    if (activeSession !== session) return false;
    session.reconnect = null;
    const errorCode = lastError?.errorCode === 'HOST_APP_EXITED' || lastError?.statusCode === 503 ? 'HOST_APP_EXITED' : 'RECONNECT_FAILED';
    endSession(session, { errorCode, error: safeError(lastError) });
    return false;
  })();
  return state.promise;
}

// End a session on the bridge only (no /cancel: the app keeps running and can be resumed later).
function endSession(session, { errorCode = null, error = null } = {}) {
  if (activeSession !== session) return;
  stopRuntime(sessionRuntime);
  session.transport.media.state = 'not-connected';
  session.transport.input.state = 'not-connected';
  session.mediaTransport = 'not-connected';
  broadcastGatewayJson(session, { type: 'session-ended', errorCode, error });
  closeMediaGatewayClients(session, 1011, errorCode || 'session ended');
  activeSession = null;
  emitSessionEvent('session-stopped', { session, errorCode, error });
}

// Live resize: Sunshine forks with the dynamic-parameter extension change resolution (and bitrate) over the
// control stream; otherwise, or when asked to, reconnect via /resume with the new mode.
function resizeSession(input = {}) {
  const session = activeSession;
  if (!session) throw bridgeError('没有正在进行的串流会话', 'HOST_NOT_FOUND', { statusCode: 409 });
  const even = (value) => Math.round(Number(value) / 2) * 2;
  const width = even(input.width);
  const height = even(input.height);
  if (!(width >= 320 && width <= 7680 && height >= 240 && height <= 4320)) throw bridgeError('分辨率超出范围', 'INVALID_STREAM_SETTINGS', { statusCode: 400 });
  if (width === session.width && height === session.height && input.method !== 'reconnect') return { method: 'none', width, height };
  let bitrateKbps = session.bitrateKbps;
  if (!session.bitrateExplicit) {
    const capKbps = defaultBitrateKbps(width, height, session.fps);
    if (session.abr) {
      session.abr.capKbps = capKbps;
      session.abr.targetKbps = Math.min(session.abr.mode === 'auto' ? session.abr.targetKbps : capKbps, capKbps);
      bitrateKbps = Math.max(500, Math.round((session.abr.targetKbps * session.abr.encoderScale) / 100) * 100);
      session.abr.encoderKbps = bitrateKbps;
    } else {
      bitrateKbps = capKbps;
    }
  }
  const control = activeControl(session);
  if (input.method !== 'reconnect' && control && !session.reconnect) {
    const payload = Buffer.alloc(12);
    payload.writeInt32LE(DYNAMIC_PARAM.RESOLUTION, 0);
    payload.writeInt32LE(width, 4);
    payload.writeInt32LE(height, 8);
    control.sendMessage(CONTROL_DYNAMIC_PARAM, payload);
    if (bitrateKbps !== session.bitrateKbps) {
      const bitrate = Buffer.alloc(8);
      bitrate.writeInt32LE(DYNAMIC_PARAM.BITRATE, 0);
      bitrate.writeInt32LE(bitrateKbps, 4);
      control.sendMessage(CONTROL_DYNAMIC_PARAM, bitrate);
    }
    Object.assign(session, { width, height, bitrateKbps });
    emitSessionEvent('session-resized', { width, height, method: 'dynamic' });
    return { method: 'dynamic', width, height };
  }
  void reconnectSession(session, 'resize', { width, height, bitrateKbps });
  emitSessionEvent('session-resized', { width, height, method: 'reconnect' });
  return { method: 'reconnect', width, height };
}

async function stopSession() {
  const previous = activeSession;
  if (!previous) return { stopped: false, session: null };
  previous.reconnect = null;
  const runtime = sessionRuntime;
  sessionRuntime = null;
  stopRuntime(runtime);
  const host = hosts[previous.hostId];
  let response = null;
  let failure = null;
  try {
    if (host?.paired) {
      response = assertSunshineSuccess(await requestHost(host, '/cancel', { uniqueid: identity.uniqueId }, { secure: true }), '/cancel');
      if (xmlText(response.body, 'cancel', '1') === '0') throw bridgeError('Sunshine 拒绝结束游戏会话', 'SUNSHINE_REQUEST_FAILED');
    }
  } catch (error) {
    failure = setErrorCode(error, error?.errorCode || 'SUNSHINE_REQUEST_FAILED');
  }
  previous.transport.media.state = 'not-connected';
  previous.transport.input.state = 'not-connected';
  previous.mediaTransport = 'not-connected';
  if (previous.transport.media.gateway) {
    previous.transport.media.gateway.state = 'not-connected';
    previous.transport.media.gateway.clients = mediaGatewayClientCount(previous);
  }
  closeMediaGatewayClients(previous, 1000, 'session stopped');
  activeSession = null;
  emitSessionEvent('session-stopped', { session: previous, errorCode: failure?.errorCode || null, error: failure ? safeError(failure) : null });
  if (failure) throw failure;
  return { stopped: true, session: previous, response: response ? { cancel: xmlText(response.body, 'cancel', null) } : null };
}

function jsonResponse(response, statusCode, payload, request = response.__sunbridgeRequest) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function textResponse(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw bridgeError('请求体过大', 'BRIDGE_ERROR', { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { throw bridgeError('请求体必须是 JSON', 'BRIDGE_ERROR', { statusCode: 400 }); }
}

function authErrorMessage(code) {
  return {
    AUTH_REQUIRED: '请先登录',
    AUTH_INVALID_CREDENTIALS: '用户名或密码错误',
    AUTH_RATE_LIMITED: '登录失败次数过多，请稍后再试',
    AUTH_SETUP_REQUIRED: '尚未设置登录密码，请在运行 Sunbridge 的电脑上运行 start.bat（或 ./start.sh）设置密码',
  }[code] || '认证失败';
}

function applySecurityHeaders(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (auth.isSecureRequest(request)) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

async function handleApi(request, response, pathname) {
  response.__sunbridgeRequest = request;
  if (request.method === 'OPTIONS') {
    // Same-origin only: no CORS preflight is ever granted.
    response.writeHead(204);
    response.end();
    return;
  }
  const body = request.method === 'POST' ? await readBody(request) : {};
  if (pathname === '/api/auth/status' && request.method === 'GET') {
    jsonResponse(response, 200, { ok: true, ...auth.status(request) });
    return;
  }
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const result = await auth.login(request, body.username, body.password);
    if (!result.ok) {
      const status = result.errorCode === 'AUTH_RATE_LIMITED' ? 429 : result.errorCode === 'AUTH_SETUP_REQUIRED' ? 503 : 401;
      if (result.retryAfterMs) response.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      jsonResponse(response, status, { ok: false, errorCode: result.errorCode, retryAfterMs: result.retryAfterMs || null, error: authErrorMessage(result.errorCode) });
      return;
    }
    console.log(`[auth] login ${result.username} from ${auth.clientIp(request)}`);
    response.setHeader('Set-Cookie', result.cookie);
    jsonResponse(response, 200, { ok: true, username: result.username });
    return;
  }
  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    response.setHeader('Set-Cookie', auth.logout(request));
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (pathname === '/api/auth/password' && request.method === 'POST') {
    const result = await auth.changePassword(request, body.currentPassword, body.newPassword);
    if (!result.ok) {
      const status = result.errorCode === 'AUTH_RATE_LIMITED' ? 429 : result.errorCode === 'AUTH_WEAK_PASSWORD' ? 400 : 401;
      jsonResponse(response, status, { ok: false, errorCode: result.errorCode, error: result.error || authErrorMessage(result.errorCode) });
      return;
    }
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (!auth.sessionFor(request)) {
    jsonResponse(response, 401, { ok: false, errorCode: 'AUTH_REQUIRED', error: authErrorMessage('AUTH_REQUIRED') });
    return;
  }
  if (pathname === '/api/bridge/session/events' && request.method === 'GET') {
    openSessionEventStream(request, response);
    return;
  }
  if (pathname === '/api/bridge/health' && request.method === 'GET') {
    jsonResponse(response, 200, { ok: true, mode: 'live', version: VERSION, clientId: identity.uniqueId, uptime: process.uptime(), dataDir: DATA_DIR });
    return;
  }
  if (pathname === '/api/bridge/session' && request.method === 'GET') {
    jsonResponse(response, 200, { ok: true, session: sessionSnapshot() });
    return;
  }
  if (pathname === '/api/bridge/hosts' && request.method === 'GET') {
    jsonResponse(response, 200, { ok: true, hosts: Object.values(hosts).map(hostPublic) });
    return;
  }
  if (pathname === '/api/bridge/discover' && request.method === 'POST') {
    if (!body.address && !body.host && !body.ip) {
      jsonResponse(response, 200, { ok: true, hosts: Object.values(hosts).map(hostPublic), scanned: false, note: '浏览器无法发起局域网广播；请填写 Sunshine 地址，或使用已保存主机。' });
      return;
    }
    const host = ensureHost(body);
    const info = await requestServerInfo(host);
    jsonResponse(response, 200, { ok: true, host: hostPublic(host), info });
    return;
  }
  if (pathname === '/api/bridge/info' && request.method === 'POST') {
    const host = findHost(body);
    const info = await requestServerInfo(host);
    jsonResponse(response, 200, { ok: true, host: hostPublic(host), info });
    return;
  }
  if (pathname === '/api/bridge/apps' && request.method === 'POST') {
    const host = findHost(body);
    const result = await requestApps(host);
    jsonResponse(response, 200, { ok: true, host: hostPublic(host), ...result });
    return;
  }
  if (pathname === '/api/bridge/pair' && request.method === 'POST') {
    const host = await pairHost(body);
    jsonResponse(response, 200, { ok: true, host });
    return;
  }
  if (pathname === '/api/bridge/ping' && request.method === 'POST') {
    const host = findHost(body);
    const result = await pingHost(host);
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }
  if (pathname === '/api/bridge/wake' && request.method === 'POST') {
    const host = findHost(body);
    const mac = body.mac || host.mac;
    if (!mac) throw bridgeError('此主机没有保存 MAC 地址；请在请求中提供 mac', 'WAKE_MAC_REQUIRED');
    await sendWakeOnLan(mac);
    host.mac = mac;
    host.state = 'waking';
    persistHosts();
    jsonResponse(response, 200, { ok: true, host: hostPublic(host), sent: true });
    return;
  }
  if (pathname === '/api/bridge/host/update' && request.method === 'POST') {
    jsonResponse(response, 200, { ok: true, host: hostPublic(updateHost(body)) });
    return;
  }
  if (pathname === '/api/bridge/host/unpair' && request.method === 'POST') {
    jsonResponse(response, 200, { ok: true, host: hostPublic(unpairHost(body)) });
    return;
  }
  if (pathname === '/api/bridge/host/delete' && request.method === 'POST') {
    const host = deleteHost(body);
    jsonResponse(response, 200, { ok: true, deleted: host.id });
    return;
  }
  if (pathname === '/api/bridge/launch' && request.method === 'POST') {
    const session = await launchHost({ ...body, clientAddress: auth.clientIp(request) });
    jsonResponse(response, 200, { ok: true, session });
    return;
  }
  if (pathname === '/api/bridge/session/resize' && request.method === 'POST') {
    jsonResponse(response, 200, { ok: true, ...resizeSession(body) });
    return;
  }
  if (pathname === '/api/bridge/session/reconnect' && request.method === 'POST') {
    if (!activeSession) throw bridgeError('没有正在进行的串流会话', 'HOST_NOT_FOUND', { statusCode: 409 });
    void reconnectSession(activeSession, 'manual');
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (pathname === '/api/bridge/stop' && request.method === 'POST') {
    const result = await stopSession();
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }
  jsonResponse(response, 404, { ok: false, errorCode: 'BRIDGE_ERROR', error: 'API 路径不存在' }, request);
}

// Only the web client itself is served. Everything else in this directory (data with the pairing
// key, password hashes and TLS keys, certs/, scripts, tests, backups, server sources) must never be readable.
const STATIC_FILES = new Set(['/index.html', '/login.html', '/styles.css', '/app.js', '/bridge.js', '/media.js', '/input.js', '/i18n.js', '/login.js', '/audio-worklet.js', '/favicon.ico']);
const isServableStatic = (requestedPath) => STATIC_FILES.has(requestedPath) || /^\/assets\/[\w.-]+\.(png|jpe?g|svg|webp|ico)$/i.test(requestedPath);

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  if (!isServableStatic(requestedPath)) {
    textResponse(response, 404, 'Not found');
    return;
  }
  const resolved = path.resolve(ROOT, `.${requestedPath}`);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    textResponse(response, 403, 'Forbidden');
    return;
  }
  fs.stat(resolved, (error, stat) => {
    if (error || !stat.isFile()) {
      textResponse(response, 404, 'Not found');
      return;
    }
    const extension = path.extname(resolved).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': ['.html', '.js', '.css'].includes(extension) ? 'no-store' : 'public, max-age=3600',
    });
    fs.createReadStream(resolved).pipe(response);
  });
}

const handleRequest = async (request, response) => {
  if (refuseUntrustedProxy(request.socket)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden: only the configured reverse proxy may connect to this bridge.\n');
    return;
  }
  try {
    applySecurityHeaders(request, response);
    const url = new URL(request.url || '/', `http://${request.headers.host || `${BIND}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) {
      // Cross-site request forgery guard: every state-changing call must come from our own page.
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS' && !auth.isSameOrigin(request)) {
        jsonResponse(response, 403, { ok: false, errorCode: 'AUTH_BAD_ORIGIN', error: '请求来源不被允许' }, request);
        return;
      }
      await handleApi(request, response, url.pathname);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      textResponse(response, 405, 'Method Not Allowed');
      return;
    }
    if (!PUBLIC_PATHS.has(url.pathname) && !auth.sessionFor(request)) {
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        response.writeHead(302, { Location: `/login.html?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' });
        response.end();
      } else {
        textResponse(response, 401, 'Login required');
      }
      return;
    }
    serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error('[bridge]', error);
    if (!response.headersSent) {
      const requestedStatus = Number(error?.statusCode);
      const statusCode = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 400;
      jsonResponse(response, statusCode, errorPayload(error), request);
    }
    else response.end();
  }
};
const server = tlsOptions ? https.createServer({ cert: tlsOptions.cert, key: tlsOptions.key }, handleRequest) : http.createServer(handleRequest);

server.on('clientError', (error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.on('upgrade', (request, socket, head) => {
  if (refuseUntrustedProxy(socket)) {
    writeUpgradeError(socket, 403, 'Reverse proxy address not allowed');
    return;
  }
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${BIND}:${PORT}`}`);
    if (url.pathname !== MEDIA_GATEWAY_PATH) {
      socket.destroy();
      return;
    }
    if (!auth.isSameOrigin(request)) {
      writeUpgradeError(socket, 403, 'Origin not allowed');
      return;
    }
    if (!auth.sessionFor(request)) {
      writeUpgradeError(socket, 401, 'Login required');
      return;
    }
    acceptMediaGateway(request, socket, head);
  } catch (error) {
    writeUpgradeError(socket, 400, safeError(error));
  }
});
function describeOwnCertificate(own) {
  const days = Math.floor((new Date(own.x509.validTo).getTime() - Date.now()) / 86400000);
  console.log(`TLS certificate: ${TLS_CERT_FILE}（${own.names.join(', ') || own.x509.subject}，剩余 ${days} 天）`);
  if (days < 0) console.warn('警告：HTTPS 证书已过期，浏览器会拒绝连接。');
  else if (days < 14) console.warn(`警告：HTTPS 证书将在 ${days} 天后过期。续期后替换文件即可，Bridge 会自动重新加载。`);
  if (own.incompleteChain) console.warn('警告：证书文件只包含站点证书、没有中间证书，部分设备（尤其手机）会提示不受信任。请改用 fullchain.pem / *_bundle.crt。');
}

// Pick up renewed certificates (certbot, acme.sh, ...) without restarting the bridge.
function watchOwnCertificate() {
  let pending = null;
  const reload = () => {
    clearTimeout(pending);
    // Renewals usually replace the certificate and key one after another; wait for both.
    pending = setTimeout(() => {
      try {
        const own = readOwnCertificate();
        if (own.x509.fingerprint256 === tlsOptions.own.x509.fingerprint256) return;
        server.setSecureContext({ cert: own.cert, key: own.key });
        tlsOptions = { ...tlsOptions, cert: own.cert, key: own.key, own };
        console.log('HTTPS 证书已更新并重新加载。');
        describeOwnCertificate(own);
      } catch (error) {
        console.warn(`HTTPS 证书文件已变化，但重新加载失败，继续使用旧证书：${safeError(error)}`);
      }
    }, 2000);
  };
  for (const file of [TLS_CERT_FILE, TLS_KEY_FILE]) fs.watchFile(file, { interval: 60 * 1000, persistent: false }, reload);
}

server.listen(PORT, BIND, () => {
  const scheme = tlsOptions ? 'https' : 'http';
  const shownHost = LOOPBACK_BIND ? BIND : (BIND === '0.0.0.0' || BIND === '::' ? '<本机地址>' : BIND);
  const portSuffix = (scheme === 'https' && PORT === 443) || (scheme === 'http' && PORT === 80) ? '' : `:${PORT}`;
  console.log(`Sunbridge ${VERSION} listening at ${scheme}://${shownHost.includes(':') ? `[${shownHost}]` : shownHost}:${PORT}`);
  if (tlsOptions?.own) {
    describeOwnCertificate(tlsOptions.own);
    for (const name of tlsOptions.own.names.filter((item) => !item.startsWith('*.'))) console.log(`访问地址: https://${name}${portSuffix}/`);
    watchOwnCertificate();
  } else if (tlsOptions) {
    console.log(`TLS certificate: ${tlsOptions.source}`);
  }
  if (TRUST_PROXY) console.log(`反向代理模式：只接受来自 ${TRUSTED_PROXIES.join(', ')} 的连接，并信任其 X-Forwarded-* 头。浏览器请访问 nginx 的 https 地址。`);
  if (auth.setupRequired) console.log('\n  尚未设置登录密码：运行 start.bat（或 ./start.sh）选择“设置或重置登录密码”后才能登录。\n');
  if (!LOOPBACK_BIND && !tlsOptions && !TRUST_PROXY) console.warn('警告：监听非本机地址但未启用 HTTPS，密码和串流会以明文传输。');
  console.log(`Client ID: ${identity.uniqueId}`);
  console.log(`Private identity storage: ${IDENTITY_FILE}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  closeMediaGatewayClients(activeSession, 1001, 'bridge shutting down');
  closeSessionEventStreams();
  server.close(() => process.exit(0));
  // Fetch keep-alive sockets should not keep a local Bridge alive after an
  // explicit shutdown. These methods are available in supported Node.js LTS
  // releases, but optional chaining keeps the Bridge compatible with older 18.x.
  server.closeIdleConnections?.();
  setTimeout(() => server.closeAllConnections?.(), 1000).unref?.();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

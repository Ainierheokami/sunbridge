// Network settings: where the bridge listens and who may reach it. Edited in the web UI (Settings → Access),
// stored in <data>/config.json:
//   { version: 2,
//     entrypoints: [{ id, name, bind, port, https, proxy: { enabled, trusted: [ip | cidr] } }],
//     allowedHosts: ["example.com", "b.example.com:8443", "*.example.net"],   // empty: any address
//     allowedOrigins: [...], certificateNames: [...], extraCertificates: [{ cert, key }] }   // carried over from v1
// An entrypoint is one listening socket. With https on, it serves the certificate in <data>/certs that matches
// the requested domain (SNI), or a self-signed one. With a reverse proxy, only the listed proxy addresses may
// connect to it and their X-Forwarded-* headers are trusted. Entrypoints can be mixed freely: e.g. a loopback
// one for nginx plus a public HTTPS one reached through a router port forward.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const DEFAULT_PORT = 8091;
export const DEFAULT_ENTRYPOINT = Object.freeze({ id: 'main', name: '', bind: '0.0.0.0', port: DEFAULT_PORT, https: true, proxy: { enabled: false, trusted: [] } });
const MAX_ENTRYPOINTS = 8;
const MAX_HOSTS = 64;
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const configFile = (dataDir) => path.join(dataDir, 'config.json');
export const certsDir = (dataDir) => path.join(dataDir, 'certs');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function defaultConfig() {
  return { version: 2, entrypoints: [structuredClone(DEFAULT_ENTRYPOINT)], allowedHosts: [], allowedOrigins: [], certificateNames: [], extraCertificates: [] };
}

// v1 (one global mode written by the old setup wizard) -> v2 entrypoints. Nothing gets stricter on upgrade.
export function migrateConfig(old) {
  if (!old || typeof old !== 'object') return defaultConfig();
  if (old.version === 2 && Array.isArray(old.entrypoints)) return old;
  const tls = String(old.tls || '').toLowerCase();
  const bind = old.bind || '127.0.0.1';
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(bind);
  const https = tls === 'off' ? false : ['cert', 'self-signed', 'auto'].includes(tls) || Boolean(old.tlsCert) || (!loopback && !old.trustProxy);
  return {
    version: 2,
    entrypoints: [{
      id: 'main', name: '', bind, port: Number(old.port) || DEFAULT_PORT, https,
      proxy: { enabled: old.trustProxy === true, trusted: Array.isArray(old.trustedProxies) && old.trustedProxies.length ? old.trustedProxies : (old.trustProxy ? ['127.0.0.1', '::1'] : []) },
    }],
    allowedHosts: [],
    allowedOrigins: Array.isArray(old.allowedOrigins) ? old.allowedOrigins : [],
    certificateNames: Array.isArray(old.tlsHostnames) ? old.tlsHostnames : [],
    extraCertificates: old.tlsCert && old.tlsKey ? [{ cert: old.tlsCert, key: old.tlsKey }] : [],
  };
}

export function loadConfig(dataDir) {
  const raw = readJson(configFile(dataDir), null);
  const { config } = validateConfig(migrateConfig(raw), { lenient: true });
  return config;
}

export function saveConfig(dataDir, config) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = configFile(dataDir);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

// Environment variables (SUNBRIDGE_PORT / _BIND / _TLS / _TRUST_PROXY / _TRUSTED_PROXIES) define a single
// entrypoint and lock the network settings in the web UI.
export function environmentEntrypoint(env = process.env) {
  if (![env.SUNBRIDGE_PORT, env.PORT, env.SUNBRIDGE_BIND, env.SUNBRIDGE_TLS, env.SUNBRIDGE_TRUST_PROXY].some((value) => value !== undefined)) return null;
  const list = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  const proxy = ['1', 'true', 'yes'].includes(String(env.SUNBRIDGE_TRUST_PROXY || '').toLowerCase());
  const bind = env.SUNBRIDGE_BIND || (proxy ? '127.0.0.1' : '0.0.0.0');
  return {
    id: 'env', name: 'environment', bind, port: Number(env.SUNBRIDGE_PORT || env.PORT) || DEFAULT_PORT,
    https: String(env.SUNBRIDGE_TLS || '').toLowerCase() === 'off' ? false : !proxy || ['cert', 'self-signed'].includes(String(env.SUNBRIDGE_TLS || '').toLowerCase()),
    proxy: { enabled: proxy, trusted: list(env.SUNBRIDGE_TRUSTED_PROXIES).length ? list(env.SUNBRIDGE_TRUSTED_PROXIES) : ['127.0.0.1', '::1'] },
  };
}

// ----- addresses -----
export function makeAddressMatcher(entries) {
  const blockList = new net.BlockList();
  const family = (address) => (net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null);
  for (const entry of entries) {
    const [address, prefix] = String(entry).trim().split('/');
    const type = family(address);
    const bits = Number(prefix);
    if (!type || (prefix !== undefined && !(Number.isInteger(bits) && bits >= 0 && bits <= (type === 'ipv4' ? 32 : 128)))) {
      throw new Error(`地址无效：${entry}（应为 IP 或网段，如 192.168.1.2 或 172.16.0.0/12）`);
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

const isLoopbackAddress = (address) => {
  const value = String(address || '').replace(/^::ffff:/, '');
  return value === '::1' || value.startsWith('127.');
};
export { isLoopbackAddress };

// "Host" header value -> { name, port } (port null when absent).
export function parseHost(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  const v6 = text.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) return { name: `[${v6[1]}]`, port: v6[2] ? Number(v6[2]) : null };
  const index = text.lastIndexOf(':');
  if (index > 0 && text.indexOf(':') === index) return { name: text.slice(0, index).replace(/\.$/, ''), port: Number(text.slice(index + 1)) || null };
  return { name: text, port: null };
}

export function normalizeHostPattern(value) {
  let text = String(value || '').trim().toLowerCase();
  text = text.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (!text) return null;
  const { name, port } = parseHost(text);
  const bare = name.replace(/^\*\./, '');
  const validName = /^\[[0-9a-f:.]+\]$/.test(name) || net.isIPv4(name) || /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(bare);
  if (!validName || (port !== null && !(port >= 1 && port <= 65535))) return null;
  return port ? `${name}:${port}` : name;
}

// Is the address the browser used allowed? Patterns: "name", "name:port", "*.domain" (subdomains).
// Loopback names are always allowed so the bridge machine itself can get in to fix a mistake.
export function hostAllowed(patterns, hostHeader, defaultPort) {
  const { name, port } = parseHost(hostHeader);
  if (!name) return false;
  if (LOOPBACK_NAMES.has(name)) return true;
  if (!patterns.length) return true;
  const effectivePort = port || defaultPort;
  return patterns.some((pattern) => {
    const parsed = parseHost(pattern);
    if (parsed.port && parsed.port !== effectivePort) return false;
    if (parsed.name.startsWith('*.')) return name.endsWith(parsed.name.slice(1)) && name.length > parsed.name.length - 1;
    return parsed.name === name;
  });
}

// ----- validation -----
// Returns { config, errors }. lenient: drop bad items (used when loading); otherwise report them.
export function validateConfig(input, { lenient = false } = {}) {
  const errors = [];
  const fail = (message) => { errors.push(message); };
  const source = input && typeof input === 'object' ? input : {};
  const entrypoints = [];
  const ids = new Set();
  for (const [index, raw] of (Array.isArray(source.entrypoints) ? source.entrypoints : []).slice(0, MAX_ENTRYPOINTS).entries()) {
    const label = `入口 ${index + 1}`;
    const bind = String(raw?.bind || '').trim() || '0.0.0.0';
    const port = Number(raw?.port);
    if (!(net.isIP(bind) || bind === 'localhost')) { fail(`${label}：监听地址 ${bind} 不是有效的 IP`); if (lenient) continue; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { fail(`${label}：端口必须是 1 到 65535`); if (lenient) continue; }
    let id = String(raw?.id || '').replace(/[^\w-]/g, '').slice(0, 32) || crypto.randomBytes(4).toString('hex');
    while (ids.has(id)) id = crypto.randomBytes(4).toString('hex');
    ids.add(id);
    const proxyEnabled = raw?.proxy?.enabled === true;
    const trusted = [...new Set((Array.isArray(raw?.proxy?.trusted) ? raw.proxy.trusted : []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 32);
    try { makeAddressMatcher(trusted); } catch (error) { fail(`${label}：${error.message}`); if (lenient) trusted.length = 0; }
    if (proxyEnabled && !trusted.length) fail(`${label}：启用反向代理时至少要填一个代理地址`);
    entrypoints.push({ id, name: String(raw?.name || '').trim().slice(0, 40), bind, port, https: raw?.https !== false, proxy: { enabled: proxyEnabled, trusted } });
  }
  // Two entrypoints cannot share a port when either listens on all addresses (or both on the same one).
  for (let a = 0; a < entrypoints.length; a += 1) {
    for (let b = a + 1; b < entrypoints.length; b += 1) {
      const x = entrypoints[a]; const y = entrypoints[b];
      const wildcard = (bind) => bind === '0.0.0.0' || bind === '::';
      if (x.port === y.port && (x.bind === y.bind || wildcard(x.bind) || wildcard(y.bind))) fail(`入口 ${a + 1} 和入口 ${b + 1} 使用了同一个端口 ${x.port}`);
    }
  }
  if (!entrypoints.length) {
    fail('至少需要一个入口');
    if (lenient) entrypoints.push(structuredClone(DEFAULT_ENTRYPOINT));
  }
  const allowedHosts = [];
  for (const item of (Array.isArray(source.allowedHosts) ? source.allowedHosts : []).slice(0, MAX_HOSTS)) {
    const normalized = normalizeHostPattern(item);
    if (!normalized) { fail(`允许的地址无效：${item}`); continue; }
    if (!allowedHosts.includes(normalized)) allowedHosts.push(normalized);
  }
  const strings = (value) => (Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 64) : []);
  const config = {
    version: 2,
    entrypoints,
    allowedHosts,
    allowedOrigins: strings(source.allowedOrigins),
    certificateNames: strings(source.certificateNames),
    extraCertificates: (Array.isArray(source.extraCertificates) ? source.extraCertificates : []).filter((item) => item?.cert && item?.key).map((item) => ({ cert: String(item.cert), key: String(item.key) })).slice(0, 16),
  };
  return { config, errors: lenient ? [] : errors };
}

// ----- certificates -----
const certNameMatches = (pattern, name) => {
  if (pattern === name) return true;
  if (pattern.startsWith('*.')) { const suffix = pattern.slice(1); return name.endsWith(suffix) && !name.slice(0, -suffix.length).includes('.'); }
  return false;
};

function describeCertificate(certPem, keyPem, files) {
  const x509 = new crypto.X509Certificate(certPem);
  const key = crypto.createPrivateKey(keyPem);
  if (!x509.checkPrivateKey(key)) throw new Error('证书和私钥不匹配');
  const names = (x509.subjectAltName || '').split(', ').filter((item) => item.startsWith('DNS:') || item.startsWith('IP Address:')).map((item) => item.replace(/^(DNS|IP Address):/, '').toLowerCase());
  const chain = (String(certPem).match(/-----BEGIN CERTIFICATE-----/g) || []).length;
  return {
    id: path.basename(files.cert).replace(/\.(pem|crt|cer)$/i, ''),
    certFile: files.cert,
    keyFile: files.key,
    cert: certPem,
    key: keyPem,
    names,
    issuer: x509.issuer.split('\n').find((line) => line.startsWith('CN=') || line.startsWith('O='))?.replace(/^(CN|O)=/, '') || x509.issuer,
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    fingerprint: x509.fingerprint256,
    incompleteChain: chain < 2 && x509.issuer !== x509.subject,
  };
}

// Every certificate + key pair in <data>/certs (any file names: fullchain.pem + privkey.pem, a.com_bundle.crt +
// a.com.key, ...) plus the ones carried over from v1. Unusable files are reported, not fatal.
export function scanCertificates(dataDir, extra = []) {
  const dir = certsDir(dataDir);
  const certs = [];
  const keys = [];
  const problems = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* none yet */ }
  for (const name of names) {
    if (!/\.(pem|crt|cer|key)$/i.test(name)) continue;
    const file = path.join(dir, name);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (text.includes('PRIVATE KEY-----')) keys.push({ file, text });
    else if (text.includes('-----BEGIN CERTIFICATE-----')) certs.push({ file, text });
  }
  const result = [];
  const usedKeys = new Set();
  for (const cert of certs) {
    let found = null;
    for (const key of keys) {
      if (usedKeys.has(key.file)) continue;
      try { found = describeCertificate(cert.text, key.text, { cert: cert.file, key: key.file }); usedKeys.add(key.file); break; } catch { /* not its key */ }
    }
    if (found) result.push(found);
    else problems.push({ file: path.basename(cert.file), error: '没有找到匹配的私钥' });
  }
  for (const item of extra) {
    try { result.push(describeCertificate(fs.readFileSync(item.cert, 'utf8'), fs.readFileSync(item.key, 'utf8'), item)); } catch (error) { problems.push({ file: item.cert, error: error.message }); }
  }
  return { certificates: result, problems };
}

// Best certificate for a requested name: matching, not expired, the latest expiry.
export function pickCertificate(certificates, servername) {
  const name = String(servername || '').toLowerCase();
  if (!name) return null;
  const now = Date.now();
  return certificates
    .filter((item) => item.names.some((pattern) => certNameMatches(pattern, name)) && new Date(item.validTo).getTime() > now)
    .sort((a, b) => new Date(b.validTo) - new Date(a.validTo))[0] || null;
}

const safeFileName = (value) => String(value || '').toLowerCase().replace(/^\*\./, 'wildcard.').replace(/[^a-z0-9.-]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'certificate';

// Store a pasted / uploaded certificate (PEM, chain allowed) and key in <data>/certs.
export function storeCertificate(dataDir, certPem, keyPem) {
  const cert = String(certPem || '').trim();
  const key = String(keyPem || '').trim();
  if (!cert.includes('-----BEGIN CERTIFICATE-----')) throw new Error('证书内容不是 PEM 格式（应以 -----BEGIN CERTIFICATE----- 开头）');
  if (!key.includes('PRIVATE KEY-----')) throw new Error('私钥内容不是 PEM 格式（应包含 PRIVATE KEY）');
  const described = describeCertificate(cert, key, { cert: 'upload.crt', key: 'upload.key' });
  const dir = certsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = safeFileName(described.names.find((item) => !net.isIP(item)) || described.names[0]);
  let stem = base;
  for (let n = 2; fs.existsSync(path.join(dir, `${stem}.crt`)); n += 1) stem = `${base}-${n}`;
  fs.writeFileSync(path.join(dir, `${stem}.crt`), `${cert}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, `${stem}.key`), `${key}\n`, { mode: 0o600 });
  return stem;
}

export function deleteCertificate(dataDir, id) {
  const { certificates } = scanCertificates(dataDir);
  const item = certificates.find((entry) => entry.id === id && path.dirname(entry.certFile) === certsDir(dataDir));
  if (!item) throw new Error('证书不存在');
  fs.unlinkSync(item.certFile);
  fs.unlinkSync(item.keyFile);
}

// ----- nginx -----
export function nginxSnippet(entrypoint, domains, publicPort = 443) {
  const upstreamHost = ['0.0.0.0', '::'].includes(entrypoint.bind) ? '127.0.0.1' : entrypoint.bind.includes(':') ? `[${entrypoint.bind}]` : entrypoint.bind;
  const names = domains.length ? domains : ['example.com'];
  return `# Sunbridge 反向代理配置（由 Sunbridge 生成）。放进 nginx 的 conf.d/ 后执行 nginx -t && nginx -s reload。
# 每个域名一个 server 块；多个域名共用一张证书时填同一个文件。
${names.map((domain) => `server {
    listen ${publicPort} ssl;
    listen [::]:${publicPort} ssl;
    server_name ${domain};

    ssl_certificate     /path/to/${domain}/fullchain.pem;   # 换成这个域名的证书（要包含中间证书）
    ssl_certificate_key /path/to/${domain}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass ${entrypoint.https ? 'https' : 'http'}://${upstreamHost}:${entrypoint.port};${entrypoint.https ? '\n        proxy_ssl_verify off;                                   # Sunbridge 自签名证书' : ''}
        proxy_http_version 1.1;
        proxy_set_header Host              $http_host;          # 带上端口，Sunbridge 用它检查允许的地址和同源
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;        # 不要用 $proxy_add_x_forwarded_for，客户端可借此伪造 IP
        proxy_set_header Upgrade           $http_upgrade;       # 串流画面使用 WebSocket
        proxy_set_header Connection        "upgrade";
        proxy_buffering off;                                    # 会话事件使用 SSE，不能缓冲
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
`).join('\n')}`;
}

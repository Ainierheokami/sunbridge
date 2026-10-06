// Management tool behind start.bat / start.sh (in the install folder).
//   Interactive menu:  start.bat            ./start.sh
//   One-off commands:  start.bat status     ./start.sh start   (see `help`)
// Settings are saved to data/config.json, which server.mjs reads on start
// (SUNBRIDGE_* environment variables take precedence).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { disableTwoFactor, loadAuthState, normalizePolicy, saveAuthState } from '../auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.SUNBRIDGE_DATA_DIR ? path.resolve(process.env.SUNBRIDGE_DATA_DIR) : path.join(ROOT, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TLS_FILE = path.join(DATA_DIR, 'tls.json');
const HOSTS_FILE = path.join(DATA_DIR, 'hosts.json');
const EXPORTED_CERT = path.join(DATA_DIR, 'sunbridge-cert.crt');
// Your own certificate files go to data/certs (auto-detected when configuring HTTPS).
const CERTS_DIR = path.join(DATA_DIR, 'certs');
const NGINX_FILE = path.join(DATA_DIR, 'nginx.conf');
const IS_WINDOWS = process.platform === 'win32';

// How HTTPS is provided. Where the bridge listens (all interfaces vs. loopback for a TCP tunnel) is asked separately.
const MODES = {
  proxy: { label: '反向代理（nginx 等）负责 HTTPS', describe: '证书配在 nginx / Caddy / cloudflared 上，可以多个域名；Sunbridge 只在本机用 HTTP 接收代理转发', config: { tls: 'off', trustProxy: true } },
  cert: { label: 'Sunbridge 直接用域名证书', describe: '用你的域名证书直接提供 HTTPS，浏览器不会提示不安全', config: { tls: 'cert', trustProxy: false } },
  'self-signed': { label: '自签名证书', describe: '没有域名证书时使用；浏览器会提示不安全，需要在每台设备上导入证书', config: { tls: 'self-signed', trustProxy: false } },
  local: { label: '仅本机访问', describe: '只在这台电脑上用浏览器打开（127.0.0.1，HTTP）', config: { bind: '127.0.0.1', tls: 'off', trustProxy: false } },
};

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = color('1');
const dim = color('2');
const green = color('32');
const yellow = color('33');
const red = color('31');
const cyan = color('36');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadConfig() {
  const config = { mode: 'local', port: 8091, ...MODES.local.config, tlsHostnames: [], allowedOrigins: [], ...readJson(CONFIG_FILE, {}) };
  // Older config files: tls "auto" + modes direct / tunnel / custom.
  if (config.tls === 'auto') config.tls = config.tlsCert ? 'cert' : 'self-signed';
  if (!MODES[config.mode]) config.mode = config.tls === 'off' ? (config.trustProxy ? 'proxy' : 'local') : config.tls;
  return config;
}

const hostPort = (scheme, host, port) => `${scheme}://${host.includes(':') ? `[${host}]` : host}${(scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? '' : `:${port}`}/`;

// Parse a certificate PEM file (may be a chain) and check the private key against it.
function inspectCertificate(certFile, keyFile) {
  const pem = fs.readFileSync(certFile, 'utf8');
  const cert = new crypto.X509Certificate(pem);
  if (keyFile && !cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyFile)))) throw new Error('证书和私钥不匹配');
  return {
    pem,
    cert,
    validTo: new Date(cert.validTo),
    names: (cert.subjectAltName || '').replace(/DNS:|IP Address:/g, '').split(', ').filter(Boolean),
    incompleteChain: (pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length < 2 && cert.issuer !== cert.subject,
  };
}

// Look for a certificate + matching key in certs/ and the data directory (certbot fullchain.pem / privkey.pem,
// or the nginx download from Aliyun / Tencent Cloud: example.com_bundle.crt / example.com.key, ...).
function findCertificateFiles() {
  const certs = [];
  const keys = [];
  for (const dir of [CERTS_DIR, DATA_DIR]) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!/\.(pem|crt|cer|key)$/i.test(name)) continue;
      const file = path.join(dir, name);
      const text = readText(file);
      if (text.includes('PRIVATE KEY-----')) keys.push(file);
      else if (text.includes('-----BEGIN CERTIFICATE-----')) certs.push({ file, chain: (text.match(/-----BEGIN CERTIFICATE-----/g) || []).length });
    }
  }
  certs.sort((a, b) => b.chain - a.chain);
  for (const { file } of certs) {
    for (const key of keys) {
      try { inspectCertificate(file, key); return { cert: file, key }; } catch { /* not a pair */ }
    }
  }
  return null;
}

function lanAddresses() {
  const list = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) if (!item.internal && item.family === 'IPv4' && !item.address.startsWith('169.254.')) list.push(item.address);
  }
  return list;
}

function accessUrls(config) {
  const scheme = config.tls === 'off' ? 'http' : 'https';
  if (config.tls === 'cert') {
    const names = (certificateInfo(config)?.names || []).filter((name) => !name.startsWith('*.'));
    const hosts = [...new Set([...(config.domain ? [config.domain] : []), ...names])];
    return hosts.length ? hosts.map((host) => hostPort(scheme, host, config.port)) : [dim('https://<证书里的域名>/')];
  }
  if (config.mode === 'proxy') {
    const origins = config.allowedOrigins || [];
    const localDebug = (config.trustedProxies?.length ? config.trustedProxies : ['127.0.0.1']).includes('127.0.0.1') && ['127.0.0.1', '0.0.0.0'].includes(config.bind);
    return [...(origins.length ? origins.map((origin) => `${origin}/  ${dim('（经 nginx）')}`) : [dim('https://<你的域名>/  （经 nginx）')]), ...(localDebug ? [`http://127.0.0.1:${config.port}/  ${dim('（仅本机调试，不经 nginx）')}`] : [])];
  }
  const hosts = ['127.0.0.1', ...(config.bind === '0.0.0.0' ? lanAddresses() : []), ...(config.tls === 'self-signed' ? (config.tlsHostnames || []) : [])];
  return [...new Set(hosts)].map((host) => hostPort(scheme, host, config.port));
}

function isPortOpen(port, bind = loadConfig().bind) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ['0.0.0.0', '::'].includes(bind) ? '127.0.0.1' : bind, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(600, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function certificateInfo(config) {
  try {
    if (config.tls === 'cert') return { ...inspectCertificate(config.tlsCert), selfSigned: false };
    const pem = readJson(TLS_FILE, {}).cert;
    if (!pem) return null;
    const cert = new crypto.X509Certificate(pem);
    return { pem, validTo: new Date(cert.validTo), names: (cert.subjectAltName || '').replace(/DNS:|IP Address:/g, '').split(', ').filter(Boolean), selfSigned: true };
  } catch {
    return null;
  }
}

function validSessions() {
  const now = Date.now();
  return loadAuthState(DATA_DIR).sessions.filter((session) => session.expiresAt > now && now - session.lastSeenAt < 7 * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Prompts (one shared readline interface; closed while child processes own the terminal)
// ---------------------------------------------------------------------------
let rl = null;
const prompt = () => (rl ||= readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) }));
const releasePrompt = () => { rl?.close(); rl = null; };
// Ctrl+C at a prompt rejects with Cancelled: inside a command it returns to the menu, at the menu it exits.
class Cancelled extends Error {}
const ask = (question, fallback = '') => new Promise((resolve, reject) => {
  const current = prompt();
  const onInterrupt = () => {
    process.stdout.write('\n');
    releasePrompt(); // a fresh interface drops the unanswered question
    reject(new Cancelled('已取消'));
  };
  current.once('SIGINT', onInterrupt);
  current.question(question, (answer) => {
    current.removeListener('SIGINT', onInterrupt);
    resolve(answer.trim() === '' ? fallback : answer.trim());
  });
});
const confirm = async (question, fallback = false) => {
  const answer = (await ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `, fallback ? 'y' : 'n')).toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === '是';
};

// Ctrl+C while a child (Bridge, tests, passwd) owns the terminal reaches both processes; the child
// handles it and exits, and this process just carries on so the menu comes back.
process.on('SIGINT', () => {});

function runNode(args, extra = {}) {
  releasePrompt();
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', ...extra });
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function status() {
  const config = loadConfig();
  const auth = loadAuthState(DATA_DIR);
  const hosts = Object.values(readJson(HOSTS_FILE, {}));
  const running = await isPortOpen(config.port);
  const cert = config.tls !== 'off' ? certificateInfo(config) : null;
  console.log(`\n${bold('Sunbridge 状态')}`);
  console.log(`  Node.js        ${process.version}（${process.platform}）`);
  console.log(`  Sunbridge      ${running ? green(`运行中（端口 ${config.port}）`) : dim('未运行')}`);
  const listen = config.bind === '0.0.0.0' ? '监听所有网卡' : config.bind === '127.0.0.1' ? '仅监听本机' : `监听 ${config.bind}`;
  console.log(`  访问方式       ${MODES[config.mode].label}，${listen}，端口 ${config.port}`);
  if (config.mode === 'proxy') console.log(`  nginx 位置     ${PROXY_LOCATIONS[config.proxyFrom || 'local'].label}，只接受 ${(config.trustedProxies?.length ? config.trustedProxies : ['127.0.0.1', '::1']).join(', ')} 的连接`);
  console.log('  访问地址');
  for (const url of accessUrls(config)) console.log(`    ${cyan(url)}`);
  console.log(`  登录账号       ${auth.user ? `${auth.user.username}（${validSessions().length} 个有效登录会话）` : red('未设置 —— 请先设置登录密码')}`);
  const twoFactor = auth.user?.twoFactor;
  if (auth.user) {
    const policy = normalizePolicy(twoFactor?.policy);
    const scopes = [['login', '登录'], ['stream', '开始串流'], ['resume', '恢复会话']].filter(([key]) => policy[key]).map(([, label]) => label);
    console.log(`  两步验证       ${twoFactor ? green(`已启用（${scopes.join('、') || '未选择场景'}；剩余 ${(twoFactor.recoveryCodes || []).length} 个恢复码）`) : dim('未启用（登录后在网页“设置”里开启）')}`);
  }
  console.log(`  已配对主机     ${hosts.filter((host) => host.paired).map((host) => `${host.name} (${host.address})`).join(', ') || dim('无')}`);
  if (config.tls !== 'off') {
    if (cert) {
      const days = Math.floor((cert.validTo - Date.now()) / 86400000);
      console.log(`  HTTPS 证书     ${cert.selfSigned ? '自签名' : config.tlsCert}，${days > 14 ? `剩余 ${days} 天` : yellow(days < 0 ? '已过期' : `剩余 ${days} 天`)}`);
      console.log(`                 ${dim(cert.names.join(', '))}`);
      if (cert.incompleteChain) console.log(`                 ${yellow('缺少中间证书，部分设备会提示不受信任，请改用 fullchain / bundle 证书')}`);
    } else if (config.tls === 'cert') {
      console.log(`  HTTPS 证书     ${red(`无法读取 ${config.tlsCert || '（未配置）'}`)}`);
    } else {
      console.log(`  HTTPS 证书     ${dim('自签名，首次启动时自动生成')}`);
    }
  }
  if (process.platform === 'linux') {
    const rmem = Number(readText('/proc/sys/net/core/rmem_max'));
    if (rmem && rmem < 4 * 1024 * 1024) console.log(`  UDP 缓冲区     ${yellow(`rmem_max=${rmem}，关键帧可能丢包`)} ${dim('建议：sudo sysctl -w net.core.rmem_max=8388608')}`);
  }
  console.log('');
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

async function configureOwnCertificate(current, config) {
  const found = current.tlsCert ? { cert: current.tlsCert, key: current.tlsKey } : findCertificateFiles();
  if (!found) console.log(dim(`  提示：把证书和私钥放进 ${CERTS_DIR}${path.sep} 可以自动识别（PEM 格式，如 fullchain.pem + privkey.pem 或 xxx_bundle.crt + xxx.key）。`));
  const cert = await ask(`证书文件（PEM，建议包含中间证书的 fullchain）${found ? ` [${found.cert}]` : ''}: `, found?.cert || '');
  const key = await ask(`私钥文件（PEM）${found ? ` [${found.key}]` : ''}: `, found?.key || '');
  let info;
  try {
    info = inspectCertificate(cert, key);
  } catch (error) {
    console.log(red(`证书或私钥不可用：${error.message}`));
    return false;
  }
  const days = Math.floor((info.validTo - Date.now()) / 86400000);
  console.log(`  证书域名：${info.names.join(', ') || info.cert.subject}，${days < 0 ? red('已过期') : days < 14 ? yellow(`剩余 ${days} 天`) : `剩余 ${days} 天`}`);
  if (info.incompleteChain) console.log(yellow('  证书文件里没有中间证书，部分设备（尤其手机）会提示不受信任，建议改用 fullchain / bundle 证书。'));
  const suggested = current.domain || info.names.find((name) => !name.startsWith('*.') && !net.isIP(name)) || '';
  const domain = (await ask(`浏览器访问用的域名${suggested ? ` [${suggested}]` : ''}: `, suggested)).toLowerCase();
  if (domain && !info.cert.checkHost(domain)) console.log(yellow(`  注意：证书不包含 ${domain}，用这个域名访问会提示证书错误。`));
  config.tlsCert = path.resolve(cert);
  config.tlsKey = path.resolve(key);
  config.domain = domain || undefined;
  return true;
}

// Where nginx runs decides where the bridge listens, which source addresses it accepts, and what proxy_pass points at.
const PROXY_LOCATIONS = {
  local: { label: '同一台电脑', describe: 'nginx 直接装在这台电脑上，经 127.0.0.1 转发', bind: '127.0.0.1', trusted: ['127.0.0.1', '::1'] },
  docker: { label: 'Docker 容器', describe: 'nginx 跑在这台电脑的 Docker 里，从 Docker 网段（172.16.0.0/12）连进来', bind: '0.0.0.0', trusted: ['127.0.0.1', '::1', '172.16.0.0/12'] },
  remote: { label: '另一台机器 / 其他网卡', describe: 'nginx 在局域网另一台机器、软路由或 VPS（经 Tailscale / WireGuard 等）上', bind: '0.0.0.0', trusted: [] },
};

function defaultUpstream(config) {
  if (config.proxyFrom === 'docker') return 'host.docker.internal';
  if (config.proxyFrom === 'remote') return config.bind !== '0.0.0.0' ? config.bind : (lanAddresses()[0] || '<这台电脑的 IP>');
  return '127.0.0.1';
}

async function configureProxyLocation(current, config) {
  const keys = Object.keys(PROXY_LOCATIONS);
  const previous = Math.max(keys.indexOf(current.proxyFrom), 0) + 1;
  console.log(`\n${bold('nginx 在哪里')}`);
  keys.forEach((key, index) => console.log(`  ${index + 1}) ${PROXY_LOCATIONS[key].label}  ${dim(PROXY_LOCATIONS[key].describe)}`));
  const from = keys[Number(await ask(`请输入 1-${keys.length} [${previous}]: `, String(previous))) - 1];
  if (!from) { console.log(red('无效的选择，未修改配置。')); return false; }
  const location = PROXY_LOCATIONS[from];
  config.proxyFrom = from;
  config.bind = location.bind;
  const sameKind = current.proxyFrom === from && current.trustedProxies?.length;
  let trusted = sameKind ? current.trustedProxies : location.trusted;
  if (from === 'remote') {
    if (!sameKind) trusted = [];
    const bind = await ask(`Sunbridge 监听的地址（0.0.0.0 = 所有网卡，也可以填某张网卡的 IP，如 Tailscale 的 100.x）[${current.proxyFrom === 'remote' ? current.bind : '0.0.0.0'}]: `, current.proxyFrom === 'remote' ? current.bind : '0.0.0.0');
    if (!net.isIP(bind)) { console.log(red(`监听地址应为 IP：${bind}`)); return false; }
    config.bind = bind;
  }
  console.log(dim('  Sunbridge 只接受下面这些地址的连接（其他来源一律 403，防止有人绕过 nginx 直连或伪造 X-Forwarded-For）。'));
  console.log(dim('  不确定 nginx 从哪个 IP 连进来时，先随便填，启动后看 Sunbridge 日志里“拒绝来自 x.x.x.x”的提示再补上。'));
  const answer = await ask(`nginx 的来源 IP 或网段，逗号分隔${trusted.length ? ` [${trusted.join(',')}]` : '（如 192.168.1.2 或 192.168.1.0/24）'}: `, trusted.join(','));
  const list = [...new Set(answer.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean))];
  const bad = list.find((item) => { const [address, prefix] = item.split('/'); return !net.isIP(address) || (prefix !== undefined && !/^\d{1,3}$/.test(prefix)); });
  if (!list.length || bad) { console.log(red(bad ? `地址格式不对：${bad}` : '至少需要一个 nginx 来源地址。')); return false; }
  config.trustedProxies = list;
  return true;
}

// Domains and the public HTTPS port the reverse proxy serves, derived from allowedOrigins (https://name[:port]).
function proxyTargets(config) {
  const origins = (config.allowedOrigins || []).map((origin) => { try { return new URL(origin); } catch { return null; } }).filter(Boolean);
  const domains = origins.length ? origins.map((url) => url.hostname) : (config.tlsHostnames || []);
  return { domains: [...new Set(domains)], publicPort: Number(origins[0]?.port) || 443 };
}

function explainProxy() {
  console.log(`\n${bold('反向代理的工作方式')}`);
  console.log('  浏览器 ──HTTPS──▶ nginx（证书在这里，可以多个域名）──HTTP──▶ Sunbridge');
  console.log(dim('  · 证书只配在 nginx 上，Sunbridge 不需要证书，只接受 nginx 的连接。'));
  console.log(dim('  · 浏览器访问 nginx 的地址，例如 https://域名/，不要直接访问 Sunbridge 的端口。'));
  console.log(dim('  · nginx 的 proxy_pass 必须写 http://，nginx 的 listen 必须带 ssl，否则浏览器会报 ERR_SSL_PROTOCOL_ERROR。'));
}

// One server block per domain so each can use its own certificate (same file twice is fine for SAN / wildcard certs).
function nginxConfig(config) {
  const { domains, publicPort } = proxyTargets(config);
  const blocks = (domains.length ? domains : ['example.com']).map((domain) => `server {
    listen ${publicPort} ssl;            # 必须带 ssl
    listen [::]:${publicPort} ssl;
    server_name ${domain};

    ssl_certificate     /path/to/${domain}/fullchain.pem;   # 换成这个域名的证书（要包含中间证书）
    ssl_certificate_key /path/to/${domain}/privkey.pem;     # 换成对应的私钥
    ssl_protocols       TLSv1.2 TLSv1.3;                    # 不接受过时的 TLS 1.0 / 1.1

    location / {
        proxy_pass http://${defaultUpstream(config)}:${config.port};    # 是 http，不是 https
        proxy_http_version 1.1;
        proxy_set_header Host              $http_host;          # 带上端口，Sunbridge 用它做同源检查
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $remote_addr;        # 不要用 $proxy_add_x_forwarded_for，客户端可借此伪造 IP 绕过登录限速
        proxy_set_header Upgrade           $http_upgrade;       # 媒体流使用 WebSocket
        proxy_set_header Connection        "upgrade";
        proxy_buffering off;                                    # 会话事件使用 SSE，不能缓冲
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
`);
  return `# Sunbridge 的 nginx 反向代理配置（由 start.bat / start.sh 生成）
# 放进 nginx 的 conf.d/（或在 nginx.conf 的 http { } 里 include 这个文件），改好证书路径后执行 nginx -t 检查，再 nginx -s reload。
# 每个域名一个 server 块，可以分别使用不同的证书；多个域名共用一张证书时，填同一个文件即可。
${config.proxyFrom === 'docker' ? `#
# Docker：Linux 上需要让容器能解析 host.docker.internal，docker run 加 --add-host=host.docker.internal:host-gateway，
# 或 compose 里加 extra_hosts: ["host.docker.internal:host-gateway"]（Docker Desktop 自带，无需添加）。
# Sunbridge 只接受 ${(config.trustedProxies || []).join(', ')} 的连接；容器网段不同时，按 Sunbridge 日志提示修改 trustedProxies。
` : ''}
${blocks.join('\n')}${publicPort === 443 ? `
# 可选：把 http:// 访问跳转到 https://（需要 80 端口可用）。登录密码和串流不要走明文 HTTP。
# server {
#     listen 80;
#     listen [::]:80;
#     server_name ${(domains.length ? domains : ['example.com']).join(' ')};
#     return 301 https://$host$request_uri;
# }
` : ''}`;
}

function writeNginxConfig(config = loadConfig()) {
  if (config.mode !== 'proxy') { console.log(yellow('当前不是反向代理模式，请先在“配置访问方式”里选择反向代理。')); return; }
  fs.writeFileSync(NGINX_FILE, nginxConfig(config));
  console.log(green(`已生成 nginx 配置：${NGINX_FILE}`));
  console.log(dim('  把里面的证书路径改成你的实际路径，放进 nginx 的 conf.d/ 后执行 nginx -t && nginx -s reload。'));
}

async function configure() {
  const current = loadConfig();
  const keys = Object.keys(MODES);
  console.log(`\n${bold('选择 HTTPS 方式')}（当前：${MODES[current.mode].label}）`);
  keys.forEach((key, index) => console.log(`  ${index + 1}) ${MODES[key].label}\n     ${dim(MODES[key].describe)}`));
  const choice = Number(await ask(`请输入 1-${keys.length} [${keys.indexOf(current.mode) + 1}]: `, String(keys.indexOf(current.mode) + 1)));
  const mode = keys[choice - 1];
  if (!mode) { console.log(red('无效的选择，未修改配置。')); return; }
  const config = { ...current, mode, ...MODES[mode].config };
  for (const field of ['tlsCert', 'tlsKey', 'domain', 'proxyFrom', 'trustedProxies']) delete config[field];

  if (mode === 'cert' || mode === 'self-signed') {
    console.log(`\n${bold('监听范围')}`);
    console.log(`  1) 所有网卡  ${dim('局域网、公网 IP、路由器端口映射直接访问')}`);
    console.log(`  2) 仅本机    ${dim('frp tcp 等内网穿透把端口原样转发到本机')}`);
    const scope = await ask(`请输入 1-2 [${current.bind === '127.0.0.1' && current.tls !== 'off' ? 2 : 1}]: `, current.bind === '127.0.0.1' && current.tls !== 'off' ? '2' : '1');
    config.bind = scope === '2' ? '127.0.0.1' : '0.0.0.0';
  }

  const defaultPort = current.port;
  if (mode === 'proxy') {
    explainProxy();
    if (!await configureProxyLocation(current, config)) return;
  }
  const portLabel = mode === 'proxy' ? `\nBridge 端口${dim('（只给 nginx 的 proxy_pass 用，浏览器不直接访问）')}` : `端口${mode === 'cert' ? dim('（443 时地址里不用写端口）') : ''}`;
  const port = Number(await ask(`${portLabel} [${defaultPort}]: `, String(defaultPort)));
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.log(red('端口无效，未修改配置。')); return; }
  config.port = port;
  if (port < 1024 && !IS_WINDOWS && process.getuid?.() !== 0) {
    console.log(yellow(`  Linux 上非 root 监听 ${port} 端口需要授权：sudo setcap 'cap_net_bind_service=+ep' "${process.execPath}"`));
  }

  if (mode === 'cert' && !await configureOwnCertificate(current, config)) return;
  if (mode === 'self-signed') {
    const names = await ask(`对外使用的域名或公网 IP，写进证书（逗号分隔，可留空）[${(current.tlsHostnames || []).join(',')}]: `, (current.tlsHostnames || []).join(','));
    config.tlsHostnames = names.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  if (mode === 'proxy') {
    const previous = proxyTargets(current);
    const answer = await ask(`浏览器访问用的域名，多个用逗号分隔（如 example.com,ml.example.com）[${previous.domains.join(',')}]: `, previous.domains.join(','));
    const domains = [...new Set(answer.split(/[,，\s]+/).map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')).filter(Boolean))];
    const bad = domains.find((domain) => !/^[a-z0-9.-]+$/.test(domain));
    if (bad) { console.log(red(`域名格式不对：${bad}`)); return; }
    const publicPort = Number(await ask(`nginx 对外的 HTTPS 端口${dim('（宽带封了 443 就填 nginx 实际监听的端口）')} [${previous.publicPort}]: `, String(previous.publicPort)));
    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) { console.log(red('端口无效，未修改配置。')); return; }
    if (publicPort === port) { console.log(red('nginx 对外端口不能和 Sunbridge 本机端口相同。')); return; }
    config.allowedOrigins = domains.map((domain) => `https://${domain}${publicPort === 443 ? '' : `:${publicPort}`}`);
    config.tlsHostnames = [];
  }
  writeJson(CONFIG_FILE, config);
  console.log(green(`\n已保存到 ${CONFIG_FILE}`));
  console.log('重启 Sunbridge 后生效。访问地址：');
  for (const url of accessUrls(config)) console.log(`  ${cyan(url)}`);
  if (config.bind !== '127.0.0.1') {
    console.log(`\n${yellow('防火墙')}：需要放行 TCP ${config.port}${mode === 'proxy' ? `（只需对 nginx 所在地址放行：${config.trustedProxies.join(', ')}）` : ''}。`);
    if (IS_WINDOWS) console.log(dim(`  以管理员身份运行：netsh advfirewall firewall add rule name="Sunbridge" dir=in action=allow protocol=TCP localport=${config.port}`));
    else console.log(dim(`  例如：sudo ufw allow ${config.port}/tcp   或   sudo firewall-cmd --add-port=${config.port}/tcp --permanent && sudo firewall-cmd --reload`));
  }
  if (mode === 'cert') console.log(dim('\n域名需要解析到这台电脑（或映射到它的路由器）的公网 IP。证书续期后直接替换文件，Sunbridge 会自动重新加载。'));
  if (mode === 'self-signed') console.log(dim('\n自签名证书会让浏览器提示不安全，可在菜单里导出证书，导入到设备的受信任根证书中消除提示。'));
  if (mode === 'proxy') {
    console.log('');
    writeNginxConfig(config);
  }
  if (!loadAuthState(DATA_DIR).user) console.log(yellow('\n还没有设置登录密码，启动前请先设置。'));
}

async function setPassword() {
  return runNode([path.join('scripts', 'passwd.mjs')]);
}

function logoutAll() {
  const state = loadAuthState(DATA_DIR);
  const count = validSessions().length;
  state.sessions = [];
  saveAuthState(DATA_DIR, state);
  console.log(green(`已注销所有登录会话（${count} 个）。运行中的 Sunbridge 会立即生效。`));
}

// The way back in when the authenticator app and the recovery codes are both lost; only possible on this machine.
async function twoFactorOff() {
  if (!loadAuthState(DATA_DIR).user?.twoFactor) { console.log(dim('两步验证没有启用。')); return; }
  if (!await confirm('关闭两步验证？之后只用密码就能登录，可以随时在网页设置里重新开启。', false)) return;
  disableTwoFactor(DATA_DIR);
  console.log(green('已关闭两步验证。运行中的 Sunbridge 会立即生效。'));
}

function regenerateCertificate() {
  if (loadConfig().tls !== 'self-signed') { console.log(yellow('当前没有使用自签名证书，无需重新生成。')); return; }
  try { fs.unlinkSync(TLS_FILE); } catch { /* not generated yet */ }
  console.log(green('已删除自签名证书，下次启动 Sunbridge 时会重新生成。'));
}

function exportCertificate() {
  const config = loadConfig();
  if (config.tls !== 'self-signed') { console.log(yellow('只有自签名证书需要导入到设备；当前方式下浏览器本身就信任证书（或由代理提供）。')); return; }
  const cert = certificateInfo(config);
  if (!cert) { console.log(yellow('还没有证书：请先把访问方式设为 HTTPS 并启动一次 Sunbridge。')); return; }
  fs.writeFileSync(EXPORTED_CERT, cert.pem);
  console.log(green(`已导出：${EXPORTED_CERT}`));
  console.log(dim('把它复制到要访问的设备上导入为受信任的根证书：'));
  console.log(dim('  Windows：双击 → 安装证书 → 当前用户 → 将所有证书放入“受信任的根证书颁发机构”，然后重启浏览器'));
  console.log(dim('  macOS：双击导入“钥匙串访问”，在证书详情里设为“始终信任”'));
  console.log(dim('  Linux Chrome/Edge：设置 → 隐私和安全 → 管理证书 → 授权机构 → 导入'));
  console.log(dim('证书包含的地址：') + dim(cert.names.join(', ')));
}

async function start() {
  if (!loadAuthState(DATA_DIR).user) {
    console.log(yellow('还没有设置登录密码，Sunbridge 启动后将无法登录。'));
    if (await confirm('现在设置密码？', true)) {
      if (await setPassword() !== 0) return 1;
    }
  }
  const config = loadConfig();
  if (await isPortOpen(config.port)) {
    console.log(red(`端口 ${config.port} 已被占用，Sunbridge 可能已经在运行。`));
    return 1;
  }
  console.log(dim('按 Ctrl+C 停止 Sunbridge 并返回菜单。\n'));
  const code = runNode(['server.mjs']);
  console.log(dim('\nBridge 已停止。'));
  return code;
}

const COMMANDS = {
  start: { label: '启动 Sunbridge', run: start },
  config: { label: '配置访问方式（nginx 反向代理 / 域名证书 / 自签名 / 仅本机）、端口', run: configure },
  passwd: { label: '设置或重置登录密码', run: setPassword },
  status: { label: '查看状态', run: status },
  nginx: { label: '生成 nginx 反向代理配置（反向代理模式）', run: () => writeNginxConfig() },
  'logout-all': { label: '注销所有已登录设备', run: logoutAll },
  '2fa-off': { label: '关闭两步验证（验证器和恢复码都丢失时）', run: twoFactorOff },
  'export-cert': { label: '导出自签名证书（导入到其他设备以消除安全提示）', run: exportCertificate },
  'regen-cert': { label: '重新生成自签名证书', run: regenerateCertificate },
};

function help() {
  console.log(`用法：${IS_WINDOWS ? 'start.bat' : './start.sh'} [命令]\n`);
  for (const [name, command] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(12)} ${command.label}`);
  console.log(`\n不带命令时进入交互菜单。`);
}

async function menu() {
  const entries = Object.entries(COMMANDS);
  while (true) {
    const config = loadConfig();
    const auth = loadAuthState(DATA_DIR);
    const running = await isPortOpen(config.port);
    console.log(`\n${bold('Sunbridge 管理')}  ${dim(`${MODES[config.mode].label} · 端口 ${config.port} · `)}${running ? green('运行中') : dim('未运行')}${auth.user ? '' : `  ${red('未设置密码')}`}`);
    entries.forEach(([, command], index) => console.log(`  ${index + 1}) ${command.label}`));
    console.log('  0) 退出');
    let answer;
    try {
      answer = await ask('请选择: ');
    } catch (error) {
      if (error instanceof Cancelled) return;
      throw error;
    }
    if (answer === '0' || answer.toLowerCase() === 'q' || answer === '') { releasePrompt(); return; }
    const entry = entries[Number(answer) - 1];
    if (!entry) { console.log(red('无效的选择。')); continue; }
    try {
      await entry[1].run();
    } catch (error) {
      console.log(error instanceof Cancelled ? dim('已取消，返回菜单。') : red(`失败：${error.message}`));
    }
  }
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(red(`需要 Node.js 18 或更高版本，当前是 ${process.version}。`));
  process.exit(1);
}

const command = process.argv[2];
if (!command) {
  await menu();
  process.exit(0);
} else if (command === 'help' || command === '-h' || command === '--help') {
  help();
} else if (COMMANDS[command]) {
  let code;
  try {
    code = await COMMANDS[command].run();
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    console.log(dim('已取消。'));
    code = 130;
  }
  releasePrompt();
  process.exit(typeof code === 'number' ? code : 0);
} else {
  console.error(red(`未知命令：${command}`));
  help();
  process.exit(1);
}

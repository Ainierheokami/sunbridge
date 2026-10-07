// Management tool behind start.bat / start.sh (in the install folder).
//   Interactive menu:  start.bat            ./start.sh
//   One-off commands:  start.bat status     ./start.sh start   (see `help`)
// Everything else (how the bridge is reached, certificates, two-step verification, logs) is set up in the web
// page. This script only starts the bridge and gets you back in when the web page is out of reach.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { disableTwoFactor, loadAuthState, normalizePolicy, saveAuthState, setupCodeFile } from '../auth.mjs';
import { defaultConfig, environmentEntrypoint, loadConfig, saveConfig } from '../netconfig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.SUNBRIDGE_DATA_DIR ? path.resolve(process.env.SUNBRIDGE_DATA_DIR) : path.join(ROOT, '..', 'data');
const HOSTS_FILE = path.join(DATA_DIR, 'hosts.json');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'sunbridge.log');
const IS_WINDOWS = process.platform === 'win32';
const SCRIPT = IS_WINDOWS ? 'start.bat' : './start.sh';

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
function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

const entrypoints = () => (environmentEntrypoint() ? [environmentEntrypoint()] : loadConfig(DATA_DIR).entrypoints);

function lanAddresses() {
  const list = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) if (!item.internal && item.family === 'IPv4' && !item.address.startsWith('169.254.')) list.push(item.address);
  }
  return list;
}

function entryUrls(entry) {
  const scheme = entry.https ? 'https' : 'http';
  const suffix = (scheme === 'https' && entry.port === 443) || (scheme === 'http' && entry.port === 80) ? '' : `:${entry.port}`;
  const hosts = ['0.0.0.0', '::'].includes(entry.bind) ? ['127.0.0.1', ...lanAddresses()] : [entry.bind];
  return hosts.map((host) => `${scheme}://${host.includes(':') ? `[${host}]` : host}${suffix}/`);
}

function isPortOpen(entry) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ['0.0.0.0', '::'].includes(entry.bind) ? '127.0.0.1' : entry.bind, port: entry.port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(600, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
const isRunning = async () => (await Promise.all(entrypoints().map(isPortOpen))).some(Boolean);

function validSessions() {
  const now = Date.now();
  return loadAuthState(DATA_DIR).sessions.filter((session) => session.expiresAt > now && now - session.lastSeenAt < 7 * 24 * 60 * 60 * 1000);
}

// Last warnings from the event log, so problems show up here too.
function recentWarnings(limit = 5) {
  const lines = readText(LOG_FILE).split('\n').slice(-500).reverse();
  const result = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.level !== 'info') result.push(entry);
    } catch { /* partial line */ }
    if (result.length >= limit) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
let rl = null;
const prompt = () => (rl ||= readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) }));
const releasePrompt = () => { rl?.close(); rl = null; };
class Cancelled extends Error {}
const ask = (question, fallback = '') => new Promise((resolve, reject) => {
  const current = prompt();
  const onInterrupt = () => {
    process.stdout.write('\n');
    releasePrompt();
    reject(new Cancelled('已取消'));
  };
  current.once('SIGINT', onInterrupt);
  current.question(question, (answer) => {
    current.removeListener('SIGINT', onInterrupt);
    resolve(answer.trim() === '' ? fallback : answer.trim());
  });
});
// Ctrl+C while the bridge owns the terminal reaches both processes; the bridge exits, the menu comes back.
process.on('SIGINT', () => {});

function runNode(args, env = process.env) {
  releasePrompt();
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function status() {
  const auth = loadAuthState(DATA_DIR);
  const hosts = Object.values(readJson(HOSTS_FILE, {}));
  const config = loadConfig(DATA_DIR);
  console.log(`\n${bold('Sunbridge 状态')}`);
  console.log(`  Node.js        ${process.version}（${process.platform}）`);
  console.log(`  Sunbridge      ${await isRunning() ? green('运行中') : dim('未运行')}`);
  console.log(`  入口${environmentEntrypoint() ? dim('（由环境变量指定）') : ''}`);
  for (const entry of entrypoints()) {
    console.log(`    ${entry.name || entry.id}：${entry.https ? 'HTTPS' : 'HTTP'}，监听 ${entry.bind}:${entry.port}${entry.proxy.enabled ? `，反向代理 ${entry.proxy.trusted.join(', ')}` : ''}`);
    if (!entry.proxy.enabled) for (const url of entryUrls(entry)) console.log(`      ${cyan(url)}`);
  }
  console.log(`  允许的地址     ${config.allowedHosts.length ? config.allowedHosts.join(', ') : dim('不限')}`);
  const missing = missingDependencies();
  console.log(`  WebRTC 组件    ${missing.length ? yellow(`未安装（${missing.join('、')}）`) + dim(` —— 运行 ${SCRIPT} deps 安装`) : green('已安装')}${config.webrtc?.enabled === false ? dim('，已在设置中关闭') : ''}`);
  const setupCode = readText(setupCodeFile(DATA_DIR));
  if (auth.user) {
    console.log(`  登录账号       ${auth.user.username}（${validSessions().length} 个有效登录会话）`);
    const twoFactor = auth.user.twoFactor;
    const policy = normalizePolicy(twoFactor?.policy);
    const scopes = [['login', '登录'], ['stream', '开始串流'], ['resume', '恢复会话']].filter(([key]) => policy[key]).map(([, label]) => label);
    console.log(`  两步验证       ${twoFactor ? green(`已启用（${scopes.join('、') || '未选择场景'}；剩余 ${(twoFactor.recoveryCodes || []).length} 个恢复码）`) : dim('未启用（在网页“设置”里开启）')}`);
  } else {
    console.log(`  登录账号       ${yellow('未创建 —— 启动后在浏览器里打开上面的地址创建')}${setupCode ? `，设置码 ${bold(setupCode)}` : ''}`);
  }
  console.log(`  已配对主机     ${hosts.filter((host) => host.paired).map((host) => `${host.name} (${host.address})`).join(', ') || dim('无')}`);
  if (process.platform === 'linux') {
    const rmem = Number(readText('/proc/sys/net/core/rmem_max'));
    if (rmem && rmem < 4 * 1024 * 1024) console.log(`  UDP 缓冲区     ${yellow(`rmem_max=${rmem}，关键帧可能丢包`)} ${dim('建议：sudo sysctl -w net.core.rmem_max=8388608')}`);
  }
  const warnings = recentWarnings();
  if (warnings.length) {
    console.log(`  最近的警告${dim(`（完整日志：网页“日志”或 ${LOG_FILE}）`)}`);
    for (const entry of warnings) console.log(`    ${dim(entry.time.replace('T', ' ').slice(0, 19))} ${entry.level === 'error' ? red(entry.message) : yellow(entry.message)}${entry.ip ? dim(`（${entry.ip}）`) : ''}`);
  }
  console.log('');
}

// Optional npm dependencies (package.json optionalDependencies; node-datachannel for WebRTC). Checked by
// loading the modules themselves: npm reports success even when an optional package failed to download, so
// its exit code proves nothing. Without them Sunbridge runs with media over WebSocket only.
const NPM = IS_WINDOWS ? 'npm.cmd' : 'npm';
const MIRROR = 'https://registry.npmmirror.com';

function optionalDependencies() {
  return readJson(path.join(ROOT, 'package.json'), {}).optionalDependencies || {};
}

// Missing = can't be loaded, not just can't be found: node-datachannel's JavaScript can be there with its native
// part for this platform missing (an interrupted download, node_modules copied from another OS).
// Loaded in a child process: Node remembers a failed load, so the check after installing would still fail here.
function missingDependencies() {
  return Object.keys(optionalDependencies()).filter((name) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(name)})`], { cwd: ROOT, stdio: 'ignore', timeout: 20000 }).status !== 0);
}

// package-lock.json newer than the last install (an update brought new versions).
function dependenciesOutdated() {
  const lock = path.join(ROOT, 'package-lock.json');
  const installed = path.join(ROOT, 'node_modules', '.package-lock.json');
  return fs.existsSync(lock) && fs.existsSync(installed) && fs.statSync(lock).mtimeMs > fs.statSync(installed).mtimeMs;
}

const npm = (args, options = {}) => spawnSync(NPM, args, { cwd: ROOT, shell: IS_WINDOWS, encoding: 'utf8', timeout: 180000, ...options });

// After a failed install, starting doesn't try again for a day (offline it would cost a minute every time).
const INSTALL_FAILED_FILE = path.join(DATA_DIR, '.deps-install-failed');
const RETRY_AFTER_MS = 24 * 3600 * 1000;
const recentlyFailed = () => { try { return Date.now() - fs.statSync(INSTALL_FAILED_FILE).mtimeMs < RETRY_AFTER_MS; } catch { return false; } };
const noteInstall = (ok) => {
  try {
    if (ok) fs.rmSync(INSTALL_FAILED_FILE, { force: true });
    else { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(INSTALL_FAILED_FILE, new Date().toISOString()); }
  } catch { /* only a reminder */ }
};

// Why npm couldn't fetch: npm ping talks to the registry and fails with a readable error code.
function diagnoseRegistry(registry) {
  const ping = npm(['ping', '--fetch-retries=0', '--fetch-timeout=10000'], { timeout: 30000 });
  if (ping.status === 0) return { reachable: true };
  const text = `${ping.stdout || ''}\n${ping.stderr || ''}`;
  const code = (text.match(/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|CERT_\w+|UNABLE_TO_\w+|SELF_SIGNED_\w+|E40[13]|E407)\b/) || [])[1];
  const why = {
    ECONNREFUSED: '连接被拒绝', ECONNRESET: '连接被重置', ETIMEDOUT: '连接超时', ENOTFOUND: '域名解析失败', EAI_AGAIN: '域名解析失败（DNS 暂时不可用）',
    ENETUNREACH: '网络不可达', EHOSTUNREACH: '网络不可达', E401: '下载源要求登录', E403: '下载源拒绝访问', E407: '代理要求认证',
  }[code] || (code ? `证书问题（${code}，常见于公司网络的代理）` : '无法访问');
  return { reachable: false, why: `${why}：${registry}` };
}

// quiet: called on every start, says nothing when all is in place.
function ensureDependencies({ quiet = true } = {}) {
  let missing = missingDependencies();
  const outdated = !missing.length && dependenciesOutdated();
  if (!missing.length && !outdated) {
    noteInstall(true);
    if (!quiet) console.log(green('依赖已就绪：WebRTC 可用。'));
    return true;
  }
  if (quiet && missing.length && recentlyFailed()) {
    console.log(dim(`WebRTC 组件未安装，画面走 WebSocket。联网后运行 ${SCRIPT} deps 安装。`));
    return false;
  }
  console.log(`\n${bold('安装依赖')} ${dim(missing.length ? `缺少 ${missing.join('、')}（WebRTC 需要，约 10 MB，只需安装一次）` : '程序更新后需要更新依赖')}`);
  const version = npm(['--version']);
  if (version.status !== 0) {
    console.log(yellow('  未找到 npm（Node.js 自带）。请重新安装 Node.js 并保留 npm 组件：https://nodejs.org/'));
    console.log(dim('  在此之前 Sunbridge 照常运行，画面走 WebSocket（没有 WebRTC）。'));
    return false;
  }
  const registry = (npm(['config', 'get', 'registry']).stdout || '').trim();
  console.log(dim(`  npm ${String(version.stdout).trim()}，下载源 ${registry || '默认'}`));
  npm(['install', '--omit=dev', '--no-audit', '--no-fund', '--fetch-retries=1', '--fetch-timeout=30000'], { stdio: 'inherit', encoding: undefined });
  missing = missingDependencies();
  if (!missing.length) {
    console.log(green('  依赖已安装：WebRTC 可用。\n'));
    return true;
  }
  // npm skips an optional package it couldn't install without saying why (and exits 0): find out here.
  noteInstall(false);
  const diagnosis = diagnoseRegistry(registry || 'npm 下载源');
  console.log(yellow(`  ${missing.join('、')} 没有装上：${diagnosis.reachable ? `下载源可以访问，但没有这个平台（${process.platform}-${process.arch}）可用的版本，或下载中途失败` : diagnosis.why}。`));
  console.log(dim('  Sunbridge 照常运行，画面走 WebSocket（没有 WebRTC）。'));
  console.log('  解决办法：');
  if (!diagnosis.reachable && !registry.includes('npmmirror')) console.log(`    1. 访问 npm 慢或失败（国内常见）时换成镜像源：${cyan(`npm config set registry ${MIRROR}`)}`);
  console.log(`    ${!diagnosis.reachable && !registry.includes('npmmirror') ? '2' : '1'}. 重新安装：${cyan(`${SCRIPT} deps`)}（或在 app 目录执行 ${cyan('npm install --omit=dev --loglevel=verbose')} 查看详细过程）`);
  console.log(dim(`  之后 24 小时内启动不再自动重试，避免每次都等。\n`));
  return false;
}

function installDependencies() {
  return ensureDependencies({ quiet: false }) ? 0 : 1;
}

async function start() {
  if (await isRunning()) {
    console.log(red('Sunbridge 已经在运行（入口端口已被占用）。'));
    return 1;
  }
  ensureDependencies();
  console.log(dim('按 Ctrl+C 停止 Sunbridge 并返回菜单。\n'));
  // The bridge exits with this code when restarted from the web page: start it again.
  const RESTART_EXIT_CODE = 75;
  let code;
  for (;;) {
    code = runNode(['server.mjs'], { ...process.env, SUNBRIDGE_SUPERVISOR: 'manage' });
    if (code !== RESTART_EXIT_CODE) break;
    console.log(dim('\nSunbridge 正在重启…\n'));
  }
  console.log(dim('\nSunbridge 已停止。'));
  return code;
}

// Back to the default: one HTTPS entrypoint on all addresses, port 8091, any address allowed.
async function resetNetwork() {
  if (environmentEntrypoint()) console.log(yellow('注意：设置了 SUNBRIDGE_PORT / SUNBRIDGE_BIND 等环境变量时，以环境变量为准。'));
  console.log('将把网络设置恢复为默认：所有网卡、端口 8091、HTTPS（自签名证书），不限制访问地址。证书文件不受影响。');
  const current = loadConfig(DATA_DIR);
  saveConfig(DATA_DIR, { ...defaultConfig(), allowedOrigins: current.allowedOrigins, certificateNames: current.certificateNames, extraCertificates: current.extraCertificates });
  console.log(green('已恢复默认网络设置。'));
  if (await isRunning()) console.log(yellow('Sunbridge 正在运行：请停止后重新启动，新设置才会生效。'));
  for (const url of entryUrls(defaultConfig().entrypoints[0])) console.log(`  ${cyan(url)}`);
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
  disableTwoFactor(DATA_DIR);
  console.log(green('已关闭两步验证：之后只用密码就能登录，可以随时在网页设置里重新开启。运行中的 Sunbridge 会立即生效。'));
}

const COMMANDS = {
  start: { label: '启动 Sunbridge', run: start },
  deps: { label: '安装 / 修复依赖（WebRTC 组件）', run: installDependencies },
  status: { label: '查看状态、访问地址和最近的警告', run: status },
  'reset-network': { label: '恢复默认网络设置（网页打不开时）', run: resetNetwork },
  passwd: { label: '重置登录密码', run: setPassword },
  'logout-all': { label: '注销所有已登录设备', run: logoutAll },
  '2fa-off': { label: '关闭两步验证（验证器和恢复码都丢失时）', run: twoFactorOff },
};

function help() {
  console.log(`用法：${SCRIPT} [命令]\n`);
  for (const [name, command] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(14)} ${command.label}`);
  console.log(`\n不带命令时进入交互菜单。访问方式、证书、两步验证和日志都在网页里设置。`);
}

async function menu() {
  const entries = Object.entries(COMMANDS);
  while (true) {
    const auth = loadAuthState(DATA_DIR);
    console.log(`\n${bold('Sunbridge 管理')}  ${await isRunning() ? green('运行中') : dim('未运行')}${auth.user ? '' : `  ${yellow('未创建账户')}`}`);
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

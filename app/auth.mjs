// Login / session layer for the bridge. The bridge holds the Sunshine pairing identity, so anyone
// who can reach it can control the paired hosts: every page, API call, event stream and WebSocket
// requires a logged-in session. State lives in <data dir>/auth.json (mode 0600):
//   { version, user: { username, salt, hash, params, updatedAt }, sessions: [{ id, createdAt, lastSeenAt, expiresAt, ip, userAgent }] }
// Session ids are stored as SHA-256 hashes; the raw token only ever exists in the HttpOnly cookie.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SESSION_COOKIE = 'sb_session';
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 64 };
const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_PERSIST_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 20;
const FAILURES_BEFORE_LOCK = 5;
const LOCK_BASE_MS = 60 * 1000;
const LOCK_MAX_MS = 60 * 60 * 1000;
const GLOBAL_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_FAILURE_LIMIT = 50;
const FAILURE_DELAY_MS = 400;
export const MIN_PASSWORD_LENGTH = 10;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrypt(password, salt, params = SCRYPT_PARAMS) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), params: { ...SCRYPT_PARAMS } };
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) return `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`;
  if (value.length > 1024) return '密码过长';
  return null;
}

export function authFilePath(dataDir) {
  return path.join(dataDir, 'auth.json');
}

export function loadAuthState(dataDir) {
  try {
    const state = JSON.parse(fs.readFileSync(authFilePath(dataDir), 'utf8'));
    return { version: 1, user: state.user || null, sessions: Array.isArray(state.sessions) ? state.sessions : [] };
  } catch {
    return { version: 1, user: null, sessions: [] };
  }
}

export function saveAuthState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = authFilePath(dataDir);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
}

// Used by the passwd command (start.bat / start.sh): set the account and revoke every existing session.
export async function setCredentials(dataDir, username, password) {
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const name = String(username || '').trim();
  if (!/^[\w.@-]{1,64}$/.test(name)) throw new Error('用户名只能包含字母、数字、下划线、点、@ 和 -，最长 64 个字符');
  const state = loadAuthState(dataDir);
  state.user = { username: name, ...(await hashPassword(password)), updatedAt: new Date().toISOString() };
  state.sessions = [];
  saveAuthState(dataDir, state);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

export function createAuth({ dataDir, trustProxy = false, secure = false, extraOrigins = [] }) {
  let state = loadAuthState(dataDir);
  const failures = new Map(); // ip -> { count, lockedUntil }
  let globalFailures = [];
  let lastPersist = 0;

  let loadedMtime = 0;
  const mtime = () => { try { return fs.statSync(authFilePath(dataDir)).mtimeMs; } catch { return 0; } };
  const persist = () => { saveAuthState(dataDir, state); lastPersist = Date.now(); loadedMtime = mtime(); };
  // Pick up changes made by the passwd command while the bridge is running.
  const reload = () => {
    const current = mtime();
    if (current !== loadedMtime) { state = loadAuthState(dataDir); loadedMtime = current; }
  };
  loadedMtime = mtime();

  const clientIp = (request) => {
    if (trustProxy) {
      const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return String(request.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  };

  const isSecureRequest = (request) => secure || (trustProxy && String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');

  // The host the browser used to reach us (the tunnel/proxy's public host when trusted).
  const effectiveHost = (request) => normalizeHost((trustProxy && String(request.headers['x-forwarded-host'] || '').split(',')[0]) || request.headers.host);

  // Same-origin check for state-changing requests and WebSocket upgrades (CSRF / cross-site WebSocket hijacking).
  const isSameOrigin = (request, { allowMissing = false } = {}) => {
    const origin = request.headers.origin;
    if (!origin || origin === 'null') {
      if (!allowMissing) return false;
      const referer = request.headers.referer;
      if (!referer) return true;
      try { return normalizeHost(new URL(referer).host) === effectiveHost(request); } catch { return false; }
    }
    if (extraOrigins.includes(origin)) return true;
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      return normalizeHost(parsed.host) === effectiveHost(request);
    } catch {
      return false;
    }
  };

  const pruneSessions = (now = Date.now()) => {
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((session) => session.expiresAt > now && now - session.lastSeenAt < SESSION_IDLE_MS);
    return before !== state.sessions.length;
  };

  const sessionFor = (request) => {
    reload();
    if (!state.user) return null;
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token || token.length > 128) return null;
    const id = sha256(token);
    const now = Date.now();
    const session = state.sessions.find((item) => item.id === id);
    if (!session || session.expiresAt <= now || now - session.lastSeenAt >= SESSION_IDLE_MS) return null;
    session.lastSeenAt = now;
    if (now - lastPersist > LAST_SEEN_PERSIST_MS) { pruneSessions(now); persist(); }
    return { ...session, username: state.user.username };
  };

  const cookie = (request, token, maxAgeSeconds) => {
    const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
    if (isSecureRequest(request)) parts.push('Secure');
    return parts.join('; ');
  };

  const lockState = (ip, now = Date.now()) => {
    const entry = failures.get(ip);
    if (entry?.lockedUntil > now) return entry.lockedUntil - now;
    globalFailures = globalFailures.filter((at) => now - at < GLOBAL_WINDOW_MS);
    if (globalFailures.length >= GLOBAL_FAILURE_LIMIT) return GLOBAL_WINDOW_MS - (now - globalFailures[0]);
    return 0;
  };

  const recordFailure = (ip, now = Date.now()) => {
    const entry = failures.get(ip) || { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= FAILURES_BEFORE_LOCK) {
      entry.lockedUntil = now + Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (entry.count - FAILURES_BEFORE_LOCK));
    }
    failures.set(ip, entry);
    globalFailures.push(now);
    if (failures.size > 10000) failures.delete(failures.keys().next().value);
  };

  const dummy = { salt: crypto.randomBytes(16).toString('base64'), params: SCRYPT_PARAMS };

  return {
    SESSION_COOKIE,
    clientIp,
    isSameOrigin,
    isSecureRequest,
    get setupRequired() { reload(); return !state.user; },
    sessionFor,

    status(request) {
      reload();
      const session = sessionFor(request);
      return { authenticated: Boolean(session), setupRequired: !state.user, username: session?.username || null };
    },

    // Returns { ok, cookie } or { ok: false, errorCode, retryAfterMs }.
    async login(request, username, password) {
      reload();
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      if (!state.user) return { ok: false, errorCode: 'AUTH_SETUP_REQUIRED' };
      const user = state.user;
      const params = user.params || SCRYPT_PARAMS;
      const nameMatches = typeof username === 'string' && username.length <= 64
        && crypto.timingSafeEqual(Buffer.from(sha256(username)), Buffer.from(sha256(user.username)));
      // Always run scrypt so response time does not reveal whether the username exists.
      const key = await scrypt(typeof password === 'string' ? password.slice(0, 1024) : '', Buffer.from(nameMatches ? user.salt : dummy.salt, 'base64'), params);
      const expected = Buffer.from(user.hash, 'base64');
      const passwordMatches = key.length === expected.length && crypto.timingSafeEqual(key, expected);
      if (!nameMatches || !passwordMatches) {
        recordFailure(ip);
        await delay(FAILURE_DELAY_MS);
        return { ok: false, errorCode: 'AUTH_INVALID_CREDENTIALS' };
      }
      failures.delete(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      pruneSessions(now);
      state.sessions.push({ id: sha256(token), createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_MAX_MS, ip, userAgent: String(request.headers['user-agent'] || '').slice(0, 200) });
      state.sessions = state.sessions.slice(-MAX_SESSIONS);
      persist();
      return { ok: true, username: user.username, cookie: cookie(request, token, Math.floor(SESSION_IDLE_MS / 1000)) };
    },

    logout(request) {
      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      if (token) {
        const id = sha256(token);
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((session) => session.id !== id);
        if (state.sessions.length !== before) persist();
      }
      return cookie(request, '', 0);
    },

    // Change the password from the web UI; keeps the current session and revokes all others.
    async changePassword(request, currentPassword, nextPassword) {
      reload();
      const session = sessionFor(request);
      if (!session) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      const key = await scrypt(String(currentPassword || '').slice(0, 1024), Buffer.from(state.user.salt, 'base64'), state.user.params || SCRYPT_PARAMS);
      const expected = Buffer.from(state.user.hash, 'base64');
      if (key.length !== expected.length || !crypto.timingSafeEqual(key, expected)) {
        recordFailure(ip);
        await delay(FAILURE_DELAY_MS);
        return { ok: false, errorCode: 'AUTH_INVALID_CREDENTIALS' };
      }
      const problem = validatePassword(nextPassword);
      if (problem) return { ok: false, errorCode: 'AUTH_WEAK_PASSWORD', error: problem };
      state.user = { ...state.user, ...(await hashPassword(nextPassword)), updatedAt: new Date().toISOString() };
      state.sessions = state.sessions.filter((item) => item.id === session.id);
      persist();
      return { ok: true };
    },
  };
}

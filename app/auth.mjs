// Login / session layer for the bridge. The bridge holds the Sunshine pairing identity, so anyone
// who can reach it can control the paired hosts: every page, API call, event stream and WebSocket
// requires a logged-in session. State lives in <data dir>/auth.json (mode 0600):
//   { version, user: { username, salt, hash, params, updatedAt, twoFactor? }, sessions: [{ id, createdAt, lastSeenAt, expiresAt, ip, userAgent }] }
//   twoFactor: { secret (base32), enabledAt, lastStep, recoveryCodes: [sha256], policy: { login, stream, resume } }
// Session ids are stored as SHA-256 hashes; the raw token only ever exists in the HttpOnly cookie.
// Two-step verification is TOTP (RFC 6238: SHA-1, 6 digits, 30 s, any authenticator app) plus one-time
// recovery codes. The policy decides where a code is asked for: at login, before starting a stream, and
// before a browser attaches to a stream it did not start (resume / take over).
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
const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;
const TOTP_DRIFT_STEPS = 1;
const RECOVERY_CODE_COUNT = 10;
const LOGIN_CHALLENGE_MS = 5 * 60 * 1000;
const LOGIN_CHALLENGE_ATTEMPTS = 5;
const ENROLL_MS = 10 * 60 * 1000;
// A verified code unlocks the protected actions of that login session for this long.
export const STEP_UP_MS = 5 * 60 * 1000;
export const TWO_FACTOR_PURPOSES = ['login', 'stream', 'resume'];
const DEFAULT_POLICY = { login: true, stream: false, resume: false };

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text).toUpperCase().replace(/[\s=-]/g, '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(secret, counter, digits = TOTP_DIGITS) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// Returns the matched time step, or -1. Steps at or before lastStep are rejected (no code replay).
export function verifyTotp(secretBase32, code, { now = Date.now(), lastStep = -1 } = {}) {
  if (!/^\d{6}$/.test(code)) return -1;
  const secret = base32Decode(secretBase32);
  const current = Math.floor(now / 1000 / TOTP_PERIOD_S);
  let matched = -1;
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step += 1) {
    // Check every candidate so timing does not reveal which step matched.
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code)) && step > lastStep) matched = step;
  }
  return matched;
}

export function totpUri(secretBase32, username, issuer = 'Sunbridge') {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_S}`;
}

const normalizeCode = (value) => String(value || '').replace(/[\s-]/g, '').toUpperCase().slice(0, 32);

function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => base32Encode(crypto.randomBytes(7)).slice(0, 10).toLowerCase());
  return { codes: codes.map((code) => `${code.slice(0, 5)}-${code.slice(5)}`), hashes: codes.map((code) => sha256(code.toUpperCase())) };
}

export function normalizePolicy(input, fallback = DEFAULT_POLICY) {
  const policy = {};
  for (const purpose of TWO_FACTOR_PURPOSES) policy[purpose] = typeof input?.[purpose] === 'boolean' ? input[purpose] : Boolean(fallback[purpose]);
  return policy;
}

// Turn two-step verification off (start.bat / start.sh, on the bridge machine): the way back in when the
// authenticator and the recovery codes are both lost.
export function disableTwoFactor(dataDir) {
  const state = loadAuthState(dataDir);
  if (!state.user?.twoFactor) return false;
  delete state.user.twoFactor;
  saveAuthState(dataDir, state);
  return true;
}

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
  // Resetting the password keeps two-step verification; `start.sh 2fa-off` removes it separately.
  const twoFactor = state.user?.twoFactor;
  state.user = { username: name, ...(await hashPassword(password)), updatedAt: new Date().toISOString(), ...(twoFactor ? { twoFactor } : {}) };
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

// Setup code for creating the account from the web page (first run). Printed on the console and kept in
// <data>/setup-code so `start.sh status` can show it; whoever can read either is on the bridge machine.
export const setupCodeFile = (dataDir) => path.join(dataDir, 'setup-code');

// Transport facts come from the entrypoint the request arrived on (server.mjs sets request.sunbridgeEntry):
// whether it is HTTPS, and whether it sits behind a trusted reverse proxy whose X-Forwarded-* to believe.
const entryOf = (request) => request.sunbridgeEntry || request.socket?.sunbridgeEntry || {};
const viaProxy = (request) => entryOf(request).proxy?.enabled === true;

export function createAuth({ dataDir, extraOrigins = [] }) {
  let state = loadAuthState(dataDir);
  const failures = new Map(); // ip -> { count, lockedUntil }
  let globalFailures = [];
  let lastPersist = 0;
  // In memory only (a restart asks again): password-verified logins waiting for their code, enrolments
  // in progress, and per-login-session step-up state { verifiedAt, streams: Set<stream session id> }.
  let setupCode = null;
  const loginChallenges = new Map(); // sha256(challenge) -> { expiresAt, attempts, ip }
  const enrollments = new Map(); // login session id -> { secret, expiresAt }
  const elevations = new Map(); // login session id -> { verifiedAt, streams }

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
    if (viaProxy(request)) {
      const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return String(request.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  };

  const isSecureRequest = (request) => (viaProxy(request)
    ? String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
    : entryOf(request).https === true);

  // The host the browser used to reach us (the tunnel/proxy's public host when trusted).
  const effectiveHost = (request) => normalizeHost((viaProxy(request) && String(request.headers['x-forwarded-host'] || '').split(',')[0]) || request.headers.host);

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

  const checkPassword = async (password) => {
    const key = await scrypt(String(password || '').slice(0, 1024), Buffer.from(state.user.salt, 'base64'), state.user.params || SCRYPT_PARAMS);
    const expected = Buffer.from(state.user.hash, 'base64');
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  };

  const fail = async (ip, errorCode) => {
    recordFailure(ip);
    await delay(FAILURE_DELAY_MS);
    return { ok: false, errorCode };
  };

  const createSession = (request, ip) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    pruneSessions(now);
    const id = sha256(token);
    state.sessions.push({ id, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_MAX_MS, ip, userAgent: String(request.headers['user-agent'] || '').slice(0, 200) });
    state.sessions = state.sessions.slice(-MAX_SESSIONS);
    persist();
    return { id, cookie: cookie(request, token, Math.floor(SESSION_IDLE_MS / 1000)) };
  };

  const twoFactor = () => state.user?.twoFactor || null;
  const policy = () => normalizePolicy(twoFactor()?.policy);
  const requires = (purpose) => Boolean(twoFactor()) && policy()[purpose] === true;

  // Accepts a 6-digit TOTP code or an unused recovery code; consumes it on success.
  const consumeCode = (code) => {
    const config = twoFactor();
    if (!config) return null;
    const value = normalizeCode(code);
    if (/^\d{6}$/.test(value)) {
      const step = verifyTotp(config.secret, value, { lastStep: config.lastStep ?? -1 });
      if (step < 0) return null;
      config.lastStep = step;
      persist();
      return { method: 'totp' };
    }
    if (value.length !== 10) return null;
    const hash = sha256(value);
    const index = (config.recoveryCodes || []).findIndex((item) => crypto.timingSafeEqual(Buffer.from(item), Buffer.from(hash)));
    if (index < 0) return null;
    config.recoveryCodes.splice(index, 1);
    persist();
    return { method: 'recovery', recoveryRemaining: config.recoveryCodes.length };
  };

  const elevation = (sessionId) => {
    let entry = elevations.get(sessionId);
    if (!entry) {
      if (elevations.size > 200) {
        const live = new Set(state.sessions.map((item) => item.id));
        for (const key of elevations.keys()) if (!live.has(key)) elevations.delete(key);
      }
      entry = { verifiedAt: 0, streams: new Set() };
      elevations.set(sessionId, entry);
    }
    return entry;
  };
  const recentlyVerified = (sessionId, now = Date.now()) => now - (elevations.get(sessionId)?.verifiedAt || 0) < STEP_UP_MS;

  // Codes and secrets must not cross the network in clear text; loopback (local only) is fine.
  const transportOk = (request) => {
    if (isSecureRequest(request)) return true;
    const ip = clientIp(request);
    return ip === '::1' || ip.startsWith('127.');
  };

  const twoFactorStatus = (session) => {
    const config = twoFactor();
    return {
      enabled: Boolean(config),
      enabledAt: config?.enabledAt || null,
      policy: config ? policy() : normalizePolicy(null),
      recoveryRemaining: config ? (config.recoveryCodes || []).length : 0,
      verifiedForMs: session && config ? Math.max(0, STEP_UP_MS - (Date.now() - (elevations.get(session.id)?.verifiedAt || 0))) : 0,
    };
  };

  return {
    SESSION_COOKIE,
    clientIp,
    effectiveHost,
    isSameOrigin,
    isSecureRequest,
    get setupRequired() { reload(); return !state.user; },

    // The current setup code while no account exists (created on first call), else null.
    setupCode() {
      reload();
      const file = setupCodeFile(dataDir);
      if (state.user) {
        setupCode = null;
        try { fs.unlinkSync(file); } catch { /* already gone */ }
        return null;
      }
      if (!setupCode) {
        const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8);
        setupCode = `${raw.slice(0, 4)}-${raw.slice(4)}`;
        try { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); fs.writeFileSync(file, `${setupCode}\n`, { mode: 0o600 }); } catch { /* console only */ }
      }
      return setupCode;
    },

    // First run from the web page: the setup code proves the person can see the bridge's console or files.
    async createAccount(request, code, username, password) {
      reload();
      if (state.user) return { ok: false, errorCode: 'AUTH_ALREADY_SET_UP' };
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      if (!transportOk(request)) return { ok: false, errorCode: 'AUTH_INSECURE_TRANSPORT' };
      const expected = this.setupCode();
      const given = normalizeCode(code).replace(/[^A-Z0-9]/g, '');
      const want = expected.replace(/-/g, '');
      if (given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) return fail(ip, 'AUTH_SETUP_CODE_INVALID');
      const name = String(username || '').trim();
      if (!/^[\w.@-]{1,64}$/.test(name)) return { ok: false, errorCode: 'AUTH_WEAK_PASSWORD', error: '用户名只能包含字母、数字、下划线、点、@ 和 -，最长 64 个字符' };
      const problem = validatePassword(password);
      if (problem) return { ok: false, errorCode: 'AUTH_WEAK_PASSWORD', error: problem };
      state.user = { username: name, ...(await hashPassword(password)), updatedAt: new Date().toISOString() };
      state.sessions = [];
      failures.delete(ip);
      const created = createSession(request, ip);
      this.setupCode();
      return { ok: true, username: name, cookie: created.cookie };
    },

    // Re-enter the password for sensitive changes (network settings).
    async verifyPassword(request, password) {
      reload();
      if (!sessionFor(request)) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      if (!(await checkPassword(password))) return fail(ip, 'AUTH_INVALID_CREDENTIALS');
      return { ok: true };
    },
    sessionFor,

    status(request) {
      reload();
      const session = sessionFor(request);
      return { authenticated: Boolean(session), setupRequired: !state.user, username: session?.username || null, insecureTransport: !transportOk(request) };
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
      if (!nameMatches || !passwordMatches) return fail(ip, 'AUTH_INVALID_CREDENTIALS');
      if (requires('login')) {
        // The password is right, but the failure counter is only cleared once the code is too, so a known
        // password cannot be used to reset the lockout between code guesses.
        const now = Date.now();
        for (const [key, item] of loginChallenges) if (item.expiresAt <= now) loginChallenges.delete(key);
        if (loginChallenges.size > 100) loginChallenges.delete(loginChallenges.keys().next().value);
        const challenge = crypto.randomBytes(32).toString('base64url');
        loginChallenges.set(sha256(challenge), { expiresAt: now + LOGIN_CHALLENGE_MS, attempts: 0, ip });
        return { ok: false, errorCode: 'AUTH_2FA_REQUIRED', challenge };
      }
      failures.delete(ip);
      const created = createSession(request, ip);
      return { ok: true, username: user.username, cookie: created.cookie };
    },

    // Second login step: the challenge from login() plus a TOTP or recovery code.
    async loginWithCode(request, challenge, code) {
      reload();
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      const key = typeof challenge === 'string' && challenge.length <= 128 ? sha256(challenge) : '';
      const pending = loginChallenges.get(key);
      if (!pending || pending.expiresAt <= Date.now() || !twoFactor()) {
        loginChallenges.delete(key);
        return { ok: false, errorCode: 'AUTH_2FA_EXPIRED' };
      }
      const used = consumeCode(code);
      if (!used) {
        pending.attempts += 1;
        if (pending.attempts >= LOGIN_CHALLENGE_ATTEMPTS) loginChallenges.delete(key);
        return fail(ip, 'AUTH_2FA_INVALID');
      }
      loginChallenges.delete(key);
      failures.delete(ip);
      const created = createSession(request, ip);
      elevation(created.id).verifiedAt = Date.now();
      return { ok: true, username: state.user.username, cookie: created.cookie, method: used.method, recoveryRemaining: used.recoveryRemaining };
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
      if (!(await checkPassword(currentPassword))) return fail(ip, 'AUTH_INVALID_CREDENTIALS');
      const problem = validatePassword(nextPassword);
      if (problem) return { ok: false, errorCode: 'AUTH_WEAK_PASSWORD', error: problem };
      state.user = { ...state.user, ...(await hashPassword(nextPassword)), updatedAt: new Date().toISOString() };
      state.sessions = state.sessions.filter((item) => item.id === session.id);
      persist();
      return { ok: true };
    },

    twoFactorStatus(request) {
      reload();
      return twoFactorStatus(sessionFor(request));
    },

    // Whether this login session may do `purpose` right now. 'resume' is about one stream: a browser may
    // always rejoin a stream it started or was already let into; anything else needs a recent code.
    allows(request, purpose, streamId = null) {
      reload();
      const session = sessionFor(request);
      if (!session) return false;
      if (!requires(purpose)) return true;
      const entry = elevations.get(session.id);
      if (purpose === 'resume' && streamId && entry?.streams.has(streamId)) return true;
      if (!recentlyVerified(session.id)) return false;
      if (streamId) elevation(session.id).streams.add(streamId);
      return true;
    },

    // The browser that launched a stream may reconnect to it without being asked again.
    grantStream(request, streamId) {
      const session = sessionFor(request);
      if (session && streamId) elevation(session.id).streams.add(streamId);
    },

    // Step-up: verify a code for the current login session.
    async verify(request, code) {
      reload();
      const session = sessionFor(request);
      if (!session) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      if (!twoFactor()) return { ok: false, errorCode: 'AUTH_2FA_NOT_ENABLED' };
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      const used = consumeCode(code);
      if (!used) return fail(ip, 'AUTH_2FA_INVALID');
      failures.delete(ip);
      elevation(session.id).verifiedAt = Date.now();
      return { ok: true, method: used.method, recoveryRemaining: used.recoveryRemaining, ...twoFactorStatus(session) };
    },

    // Enrolment, step 1: confirm the password, get a fresh secret to put into the authenticator app.
    async beginTwoFactor(request, password) {
      reload();
      const session = sessionFor(request);
      if (!session) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      if (!transportOk(request)) return { ok: false, errorCode: 'AUTH_INSECURE_TRANSPORT' };
      if (twoFactor()) return { ok: false, errorCode: 'AUTH_2FA_ALREADY_ENABLED' };
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      if (!(await checkPassword(password))) return fail(ip, 'AUTH_INVALID_CREDENTIALS');
      const secret = base32Encode(crypto.randomBytes(20));
      enrollments.set(session.id, { secret, expiresAt: Date.now() + ENROLL_MS });
      return { ok: true, secret, uri: totpUri(secret, state.user.username), expiresInMs: ENROLL_MS };
    },

    // Enrolment, step 2: a code from the app proves it was set up; returns the recovery codes once.
    // Every other login session is signed out, since they never passed the second step.
    async enableTwoFactor(request, code, requestedPolicy) {
      reload();
      const session = sessionFor(request);
      if (!session) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      const pending = enrollments.get(session.id);
      if (!pending || pending.expiresAt <= Date.now()) { enrollments.delete(session.id); return { ok: false, errorCode: 'AUTH_2FA_EXPIRED' }; }
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      const step = verifyTotp(pending.secret, normalizeCode(code));
      if (step < 0) return fail(ip, 'AUTH_2FA_INVALID');
      enrollments.delete(session.id);
      const recovery = newRecoveryCodes();
      state.user.twoFactor = { secret: pending.secret, enabledAt: new Date().toISOString(), lastStep: step, recoveryCodes: recovery.hashes, policy: normalizePolicy(requestedPolicy) };
      state.sessions = state.sessions.filter((item) => item.id === session.id);
      persist();
      elevation(session.id).verifiedAt = Date.now();
      return { ok: true, recoveryCodes: recovery.codes, ...twoFactorStatus(session) };
    },

    // Changing what is protected, new recovery codes and turning it off all need a code
    // (or a code verified in the last few minutes); turning it off needs the password as well.
    async updateTwoFactor(request, { action, code, password, policy: requestedPolicy }) {
      reload();
      const session = sessionFor(request);
      if (!session) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      const config = twoFactor();
      if (!config) return { ok: false, errorCode: 'AUTH_2FA_NOT_ENABLED' };
      const ip = clientIp(request);
      const locked = lockState(ip);
      if (locked > 0) return { ok: false, errorCode: 'AUTH_RATE_LIMITED', retryAfterMs: locked };
      if (action === 'disable' && !(await checkPassword(password))) return fail(ip, 'AUTH_INVALID_CREDENTIALS');
      if (code) {
        if (!consumeCode(code)) return fail(ip, 'AUTH_2FA_INVALID');
        elevation(session.id).verifiedAt = Date.now();
      } else if (!recentlyVerified(session.id)) {
        return { ok: false, errorCode: 'AUTH_2FA_REQUIRED' };
      }
      failures.delete(ip);
      if (action === 'disable') {
        delete state.user.twoFactor;
        persist();
        return { ok: true, ...twoFactorStatus(session) };
      }
      if (action === 'recovery-codes') {
        const recovery = newRecoveryCodes();
        config.recoveryCodes = recovery.hashes;
        persist();
        return { ok: true, recoveryCodes: recovery.codes, ...twoFactorStatus(session) };
      }
      if (action === 'policy') {
        config.policy = normalizePolicy(requestedPolicy, policy());
        persist();
        return { ok: true, ...twoFactorStatus(session) };
      }
      return { ok: false, errorCode: 'BRIDGE_ERROR' };
    },
  };
}

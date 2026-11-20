// Files copied with Foundation Sunshine's clipboard sync (both directions), on top of clipboard.mjs's frames:
//   kind 4 (file offer): a UTF-8 JSON list of the files copied on one side,
//     {"id": "<uuid>", "type": "clipboard"|"send", "total_size": N, "expires_in": S,
//      "files": [{"path": "dir/a.txt", "size": N, "dir": false, "mtime": T}, ...]}
//     paths relative and '/'-separated, every folder listed before what it holds. A long list travels as a
//     clipboard blob of mime OFFER_MIME behind a kind 3 reference.
//   host -> here: each file is fetched from the paired HTTPS port, GET /api/v1/file-transfer/<id>/<index>
//     (Range: bytes=N- resumes), only when the browser asks for it.
//   here -> host: the host's agent pastes them by asking for one chunk at a time, kind 5
//     {"ticket": "<32 hex>", "id", "index", "offset", "length"}; the answer is
//     POST /api/v1/file-transfer/chunk/<ticket> with the bytes (fewer only at the end of the file), or an empty
//     body with "X-File-Transfer-Error: <word>". The browser holds the files, so the bridge asks it for each chunk.
// The rules a paste target trusts (no traversal, names Windows accepts, MAX_PATH) are checked on both sides.
import zlib from 'node:zlib';

export const KIND_FILE_OFFER = 4;
export const KIND_FILE_PULL = 5;
export const OFFER_MIME = 'application/vnd.sunshine.file-offer+json';
export const MAX_ENTRIES = 10000;
export const MAX_PATH_UNITS = 259;
export const MAX_CHUNK = 4 * 1024 * 1024;
export const OFFER_TTL_MS = 60 * 60 * 1000;
export const MAX_OFFERS = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TICKET = /^[0-9a-f]{32}$/;
const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`COM${n}`, `LPT${n}`])]);
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

export const isOfferId = (id) => UUID.test(String(id));
export const isTicket = (ticket) => TICKET.test(String(ticket));

function validName(name) {
  if (!name || name === '.' || name === '..' || BAD_CHARS.test(name) || /[. ]$/.test(name)) return false;
  return !RESERVED.has(name.split('.')[0].trimEnd().toUpperCase());
}

const wholeNumber = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

// The checked list: { entries: [{ path, size, dir, mtime }], totalSize } or { error }.
// Names are normalized to NFC (macOS hands out decomposed names) before the duplicate check.
export function checkEntries(files) {
  if (!Array.isArray(files) || !files.length) return { error: 'no files' };
  if (files.length > MAX_ENTRIES) return { error: 'too many files' };
  const seen = new Set();
  const folders = new Set();
  const entries = [];
  let totalSize = 0;
  for (const file of files) {
    const path = typeof file?.path === 'string' ? file.path.normalize('NFC') : '';
    const parts = path.split('/');
    if (!parts.every(validName)) return { error: `bad path: ${path}` };
    if (parts.join('\\').length > MAX_PATH_UNITS) return { error: `path too long: ${path}` };
    const key = path.toLowerCase();
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : null;
    if (parent !== null && !folders.has(parent)) return { error: `folder not listed first: ${path}` };
    if (seen.has(key)) return { error: `duplicate: ${path}` };
    seen.add(key);
    const dir = file.dir === true;
    const size = dir ? 0 : file.size;
    if (!wholeNumber(size) || (dir && file.size && file.size !== 0)) return { error: `bad size: ${path}` };
    const mtime = wholeNumber(file.mtime) ? file.mtime : 0;
    if (dir) folders.add(key);
    totalSize += size;
    entries.push({ path, size, dir, mtime });
  }
  return { entries, totalSize };
}

// A kind 4 payload: { id, type, entries, totalSize, expiresInMs } or null.
export function parseOffer(payload) {
  let value;
  try { value = JSON.parse(Buffer.from(payload).toString('utf8')); } catch { return null; }
  if (!value || typeof value !== 'object' || !isOfferId(value.id)) return null;
  const checked = checkEntries(value.files);
  if (checked.error) return null;
  const expiresIn = wholeNumber(value.expires_in) && value.expires_in > 0 ? Math.min(value.expires_in * 1000, OFFER_TTL_MS) : OFFER_TTL_MS;
  return { id: value.id, type: value.type === 'send' ? 'send' : 'clipboard', entries: checked.entries, totalSize: checked.totalSize, expiresInMs: expiresIn };
}

// The kind 4 payload of files offered from here.
export function encodeOffer(id, entries, totalSize) {
  return Buffer.from(JSON.stringify({
    id, type: 'clipboard', total_size: totalSize, expires_in: OFFER_TTL_MS / 1000,
    files: entries.map(({ path, size, dir, mtime }) => ({ path, size, dir, mtime })),
  }));
}

// A kind 5 payload: { ticket, id, index, offset, length } or null.
export function parsePull(payload) {
  let value;
  try { value = JSON.parse(Buffer.from(payload).toString('utf8')); } catch { return null; }
  if (!value || !isTicket(value.ticket) || !isOfferId(value.id)) return null;
  const { index, offset, length } = value;
  if (!wholeNumber(index) || index >= MAX_ENTRIES || !wholeNumber(offset) || !wholeNumber(length) || length < 1 || length > MAX_CHUNK) return null;
  return { ticket: value.ticket, id: value.id, index, offset, length };
}

// Offers kept for a while, the oldest dropped past `max`.
export function createOfferStore({ max = MAX_OFFERS, now = Date.now } = {}) {
  const offers = new Map(); // id -> { ...value, expiresAt }
  const prune = () => { const t = now(); for (const [id, o] of offers) if (o.expiresAt <= t) offers.delete(id); };
  return {
    put(id, value, ttlMs = OFFER_TTL_MS) {
      prune();
      offers.delete(id);
      while (offers.size >= max) offers.delete(offers.keys().next().value);
      offers.set(id, { ...value, expiresAt: now() + ttlMs });
    },
    get(id) { prune(); return offers.get(String(id)) || null; },
    clear() { offers.clear(); },
    get size() { prune(); return offers.size; },
  };
}

// ---- A zip of an offer, written as the files arrive (stored, not compressed: streams go out as they come) ----

export const ZIP_MAX_BYTES = 0xffffffff - 1;

function dosTime(seconds) {
  const date = seconds > 0 ? new Date(seconds * 1000) : new Date(1980, 0, 1);
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// Whether a zip without ZIP64 holds the offer.
export function zipFits(entries) {
  let total = 0;
  for (const entry of entries) total += entry.size + 2 * (30 + 46 + Buffer.byteLength(entry.path) + 16);
  return entries.length < 0xffff && total < ZIP_MAX_BYTES;
}

// The exact size of zipEntries' output (stored entries: known up front), for a Content-Length.
export function zipSize(entries) {
  let size = 22;
  for (const entry of entries) {
    const name = Buffer.byteLength(entry.dir ? `${entry.path}/` : entry.path, 'utf8');
    size += 30 + name + (entry.dir ? 0 : entry.size + 16) + 46 + name;
  }
  return size;
}

// Yields the zip's bytes. openEntry(index) resolves an async iterable of the file's bytes; a file that ends up a
// different size than announced throws (the archive would be wrong).
export async function* zipEntries(entries, openEntry) {
  const central = [];
  let offset = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = Buffer.from(entry.dir ? `${entry.path}/` : entry.path, 'utf8');
    const { time, date } = dosTime(entry.mtime);
    const flags = entry.dir ? 0x0800 : 0x0808; // UTF-8 names; files: sizes and CRC in a trailing descriptor
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    const headerOffset = offset;
    yield local; yield name;
    offset += local.length + name.length;
    let crc = 0;
    let size = 0;
    if (!entry.dir) {
      for await (const chunk of await openEntry(index)) {
        crc = zlib.crc32(chunk, crc);
        size += chunk.length;
        if (size > entry.size) throw new Error(`${entry.path} is larger than announced`);
        yield chunk;
      }
      if (size !== entry.size) throw new Error(`${entry.path} ended early`);
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      yield descriptor;
      offset += size + descriptor.length;
    }
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc >>> 0, 16);
    record.writeUInt32LE(size, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(entry.dir ? 0x10 : 0, 38);
    record.writeUInt32LE(headerOffset, 42);
    central.push(record, name);
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield directory;
  yield end;
}

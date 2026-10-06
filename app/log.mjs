// Event log: what happened on the bridge, readable in the web UI (Logs) and kept in <data>/logs/sunbridge.log
// (JSON lines, rotated at 2 MB, 4 files kept). Every entry is also printed to the console.
//   { time, level: info | warn | error, category: access | auth | settings | stream | system, event, message, ...fields }
// The same refusal from the same address (a scanner, a misconfigured proxy) is written once per minute
// with a repeat count, so a flood cannot fill the disk or bury everything else.
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const KEEP_FILES = 4;
const MEMORY_ENTRIES = 2000;
const REPEAT_WINDOW_MS = 60 * 1000;
export const LOG_CATEGORIES = ['access', 'auth', 'settings', 'stream', 'system'];

export function createLog(dataDir) {
  const dir = path.join(dataDir, 'logs');
  const file = path.join(dir, 'sunbridge.log');
  const entries = [];
  const repeats = new Map(); // key -> { first, count }
  const listeners = new Set();
  let size = 0;

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    size = fs.statSync(file).size;
    // Load the tail of the current file so the web view survives a restart.
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n').slice(-MEMORY_ENTRIES)) {
      if (!line) continue;
      try { entries.push(JSON.parse(line)); } catch { /* partial line */ }
    }
  } catch { /* first run */ }

  const rotate = () => {
    try {
      for (let index = KEEP_FILES - 1; index >= 1; index -= 1) {
        const from = index === 1 ? file : `${file}.${index - 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, `${file}.${index}`);
      }
    } catch { /* keep writing to the current file */ }
    size = 0;
  };

  const write = (entry) => {
    const line = `${JSON.stringify(entry)}\n`;
    try {
      if (size + line.length > MAX_FILE_BYTES) rotate();
      fs.appendFileSync(file, line, { mode: 0o600 });
      size += Buffer.byteLength(line);
    } catch { /* the console line below still shows it */ }
    entries.push(entry);
    if (entries.length > MEMORY_ENTRIES) entries.splice(0, entries.length - MEMORY_ENTRIES);
    const print = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log;
    const where = [entry.ip, entry.host].filter(Boolean).join(' ');
    print(`[${entry.category}] ${entry.message}${where ? `（${where}）` : ''}${entry.repeat ? ` ×${entry.repeat}` : ''}`);
    for (const listener of listeners) { try { listener(entry); } catch { /* ignore */ } }
  };

  // dedupeKey: entries with the same key within a minute are folded into one.
  const add = (level, category, event, message, fields = {}, dedupeKey = null) => {
    const now = Date.now();
    if (dedupeKey) {
      const seen = repeats.get(dedupeKey);
      if (seen && now - seen.first < REPEAT_WINDOW_MS) { seen.count += 1; return; }
      const repeat = seen?.count || 0;
      repeats.set(dedupeKey, { first: now, count: 0 });
      if (repeats.size > 5000) repeats.delete(repeats.keys().next().value);
      if (repeat) fields = { ...fields, repeat };
    }
    const clean = {};
    for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== '') clean[key] = typeof value === 'string' ? value.slice(0, 300) : value;
    write({ time: new Date(now).toISOString(), level, category, event, message, ...clean });
  };

  return {
    info: (category, event, message, fields, dedupeKey) => add('info', category, event, message, fields, dedupeKey),
    warn: (category, event, message, fields, dedupeKey) => add('warn', category, event, message, fields, dedupeKey),
    error: (category, event, message, fields, dedupeKey) => add('error', category, event, message, fields, dedupeKey),
    // Newest first.
    list({ category = null, level = null, limit = 300, before = null } = {}) {
      const result = [];
      for (let index = entries.length - 1; index >= 0 && result.length < limit; index -= 1) {
        const entry = entries[index];
        if (category && entry.category !== category) continue;
        if (level === 'warn' && entry.level === 'info') continue;
        if (before && entry.time >= before) continue;
        result.push(entry);
      }
      return result;
    },
    onEntry(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    file,
  };
}

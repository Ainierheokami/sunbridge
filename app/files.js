// Files copied through the host's clipboard sync, on the stream page (bridge side: files.mjs).
//   - this device -> host: files pasted (Ctrl/Cmd+V) or dropped on the stream, folders included when the
//     browser gives them, are listed and the list is sent to the host, which puts them on its clipboard. Their
//     bytes stay here until the host pastes them: then the host asks for one chunk at a time (a 'file-pull'
//     message), and this page posts that chunk back. The page has to stay open until the paste is done.
//   - host -> this device: a 'files' message lists what was copied there; the page offers it as a download,
//     one file directly, several as a zip or (where the browser can) written into a folder the user picks.
(function () {
  'use strict';

  const MAX_ENTRIES = 10000;
  const LOCAL_OFFERS = 4;
  // The host stopped asking for chunks this long ago: its paste ended (or was given up), hide the progress.
  const PASTE_IDLE_MS = 15000;
  const tooManyError = () => Object.assign(new Error(`More than ${MAX_ENTRIES} files`), { name: 'TooManyFiles' });

  const readEntries = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  const entryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

  // [{ path, file, dir }], every folder before what it holds. snap: clipboard.js's snapshot of a paste or drop.
  async function collect(snap) {
    const out = [];
    const walk = async (entry, prefix) => {
      if (out.length >= MAX_ENTRIES) throw tooManyError();
      const path = (prefix ? `${prefix}/${entry.name}` : entry.name).normalize('NFC');
      if (entry.isDirectory) {
        out.push({ path, file: null, dir: true });
        const reader = entry.createReader();
        // readEntries hands out a folder in batches until it returns none.
        for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
          for (const child of batch) await walk(child, path);
        }
      } else if (entry.isFile) {
        out.push({ path, file: await entryFile(entry), dir: false });
      }
    };
    if (snap.entries?.length) {
      for (const entry of snap.entries) await walk(entry, '');
    } else {
      for (const file of snap.files) out.push({ path: file.name.normalize('NFC'), file, dir: false });
    }
    if (out.length > MAX_ENTRIES) throw tooManyError();
    return out;
  }

  const describe = (items) => items.map(({ path, file, dir }) => ({
    path, dir, size: dir ? 0 : file.size, mtime: file ? Math.max(0, Math.floor(file.lastModified / 1000)) : 0,
  }));

  async function postJson(url, value) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), credentials: 'same-origin' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { name: 'BridgeError' });
    return result;
  }

  // A name not taken yet in `folder`: "a.txt", then "a (1).txt", ...
  async function freeName(folder, name, dir) {
    const dot = dir ? -1 : name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 0; n < 1000; n += 1) {
      const candidate = n ? `${stem} (${n})${ext}` : name;
      try {
        await (dir ? folder.getDirectoryHandle(candidate) : folder.getFileHandle(candidate));
      } catch (error) {
        if (error?.name === 'NotFoundError') return candidate;
        if (error?.name !== 'TypeMismatchError') throw error;
      }
    }
    throw new Error(`No free name for ${name}`);
  }

  function createFileTransfer({ onNotice = () => {}, onProgress = () => {} } = {}) {
    const offers = new Map(); // id -> { items, total, sent, cancelled }
    let hostOffer = null; // the last list the host sent
    let saving = null; // { cancelled, controller } of a save into a folder
    let pasteIdle = null;

    async function offer(snap) {
      let items;
      try {
        items = await collect(snap);
      } catch (error) {
        onNotice(error?.name === 'TooManyFiles' ? 'too-many' : 'send-failed', { error });
        return false;
      }
      if (!items.length) return false;
      try {
        const result = await postJson('/api/bridge/files/offer', { files: describe(items) });
        offers.set(result.id, { items, total: result.totalSize, sent: 0, cancelled: false });
        while (offers.size > LOCAL_OFFERS) offers.delete(offers.keys().next().value);
        onNotice('sent', { count: items.filter((item) => !item.dir).length, size: result.totalSize });
        return true;
      } catch (error) {
        onNotice('send-failed', { error });
        return false;
      }
    }

    // The host asks for a chunk of a list sent from this page (another tab may hold it: then stay quiet).
    async function pull({ ticket, id, index, offset, length }) {
      const local = offers.get(id);
      if (!local) return;
      const item = local.items[index];
      let error = null;
      let body = null;
      if (local.cancelled) error = 'cancelled';
      else if (!item || item.dir) error = 'not_found';
      else if (offset > item.file.size) error = 'range';
      else {
        try {
          body = await item.file.slice(offset, offset + length).arrayBuffer();
        } catch {
          error = 'gone'; // moved, deleted or changed since it was copied
        }
      }
      try {
        await fetch(`/api/bridge/files/chunk/${ticket}`, {
          method: 'POST', credentials: 'same-origin', body: body || new ArrayBuffer(0),
          headers: { 'Content-Type': 'application/octet-stream', ...(error ? { 'X-File-Transfer-Error': error } : {}) },
        });
      } catch { /* the host gives up on its own */ }
      if (error || !local.total) return;
      local.sent += body.byteLength;
      const done = local.sent >= local.total;
      onProgress({ direction: 'send', mime: 'files', phase: done ? 'done' : 'upload', loaded: Math.min(local.sent, local.total), total: local.total });
      clearTimeout(pasteIdle);
      if (!done) pasteIdle = setTimeout(() => onProgress({ direction: 'send', mime: 'files', phase: 'idle' }), PASTE_IDLE_MS);
    }

    const fileUrl = (id, which) => `/api/bridge/files/${id}/${which}`;
    const click = (url) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = '';
      document.body.append(link);
      link.click();
      link.remove();
    };

    // Writes the host's files into a folder the user picks, the folder structure kept.
    async function saveToFolder(list) {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' });
      const current = { cancelled: false, controller: null };
      saving = current;
      const total = list.totalSize;
      let loaded = 0;
      const folders = new Map([['', root]]);
      const renamed = new Map(); // top-level name taken in the folder -> the free one used
      const report = (phase) => onProgress({ direction: 'receive', mime: 'files', phase, loaded, total });
      report('download');
      try {
        for (let index = 0; index < list.files.length; index += 1) {
          if (current.cancelled) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
          const entry = list.files[index];
          const parts = entry.path.split('/');
          if (parts.length === 1 && !renamed.has(parts[0])) renamed.set(parts[0], await freeName(root, parts[0], entry.dir));
          parts[0] = renamed.get(parts[0]) || parts[0];
          const name = parts.pop();
          const parent = folders.get(parts.join('/'));
          if (entry.dir) {
            folders.set([...parts, name].join('/'), await parent.getDirectoryHandle(name, { create: true }));
            continue;
          }
          current.controller = new AbortController();
          const response = await fetch(fileUrl(list.id, index), { credentials: 'same-origin', signal: current.controller.signal });
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || `HTTP ${response.status}`);
          }
          const writable = await (await parent.getFileHandle(name, { create: true })).createWritable();
          const counter = new TransformStream({
            transform(chunk, controller) { loaded += chunk.byteLength; report('download'); controller.enqueue(chunk); },
          });
          await response.body.pipeThrough(counter).pipeTo(writable);
        }
        report('done');
        onNotice('saved', { count: list.files.filter((entry) => !entry.dir).length });
      } catch (error) {
        report(error?.name === 'AbortError' ? 'cancelled' : 'failed');
        if (error?.name !== 'AbortError') onNotice('save-failed', { error });
      } finally {
        if (saving === current) saving = null;
      }
    }

    return {
      offer,
      pull,
      // The host's list: kept for the card's buttons.
      receive(message) { hostOffer = message; return message; },
      get hostOffer() { return hostOffer; },
      canSaveToFolder: () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext,
      download(which) { if (hostOffer) click(fileUrl(hostOffer.id, which)); },
      saveToFolder: () => (hostOffer ? saveToFolder(hostOffer) : Promise.resolve()),
      dismiss() { hostOffer = null; },
      // The progress box's cancel: a save in progress, or the host's paste of what this page sent.
      cancel(direction) {
        if (direction === 'receive' && saving) { saving.cancelled = true; saving.controller?.abort(); return true; }
        if (direction === 'send') {
          let any = false;
          for (const local of offers.values()) if (local.sent && local.sent < local.total) { local.cancelled = true; any = true; }
          return any;
        }
        return false;
      },
    };
  }

  window.SunbridgeFiles = { createFileTransfer, collect };
})();

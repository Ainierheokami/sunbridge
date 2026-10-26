// Clipboard sync for the stream page, with Foundation Sunshine's clipboard sync (bridge side: clipboard.mjs).
// Like its Android client:
//   - this device -> host: the local clipboard is read when the page gets focus back (the user copied
//     something elsewhere and returns) and sent when it changed; sendNow() does it on demand (a button: some
//     browsers only allow reading the clipboard during a click);
//   - Ctrl/Cmd+V on the stream (beforePaste + the page's paste event): the paste event carries the clipboard
//     without a permission prompt, image files copied in a file manager included, and the keystroke is held
//     until the host has it; files and images dropped on the stream go the same way (sendDataTransfer).
//     The host side only takes text and images (Foundation Sunshine's protocol has no file kind), so other
//     files are refused with a notice; images in other formats are converted to PNG;
//   - host -> this device: written to the local clipboard; when the browser refuses (page not focused, no
//     user gesture yet) it is kept and written on the next focus or click.
// A fingerprint of the last content sent or received stops it bouncing back and forth.
// Large content (images, mostly) reports its progress through onProgress: the PNG conversion, the upload to
// the bridge in bytes, then the bridge's hand-off to the host (no byte count there) until the host has it on its
// clipboard; host content fetched from the bridge reports its download the same way. cancel() ends the transfer
// in progress (the bridge then drops it before it reaches the host clipboard).
// Size limits: content over MAX_BYTES (the bridge's cap) is refused up front; content of getConfirmBytes() or
// more is only sent or received once onConfirm says so (a large image can also go scaled down instead).
(function () {
  'use strict';

  async function fingerprint(content) {
    const bytes = content.mime === 'text/plain' ? new TextEncoder().encode(content.data) : new Uint8Array(await content.data.arrayBuffer());
    if (globalThis.crypto?.subtle) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return content.mime + ':' + Array.from(digest.subarray(0, 12), (value) => value.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    for (const value of bytes) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    return content.mime + ':' + bytes.length + ':' + hash;
  }

  // Any image the browser can decode, as PNG (the only image format of the protocol).
  async function toPng(blob) {
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('PNG encoding failed');
      return png;
    } finally {
      bitmap.close?.();
    }
  }

  // The same image with its longest side at most maxSide, as PNG: far fewer bytes for photos and screenshots
  // from high-resolution screens. null when it is already that small.
  async function scaledPng(blob, maxSide) {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = maxSide / Math.max(bitmap.width, bitmap.height);
      if (scale >= 1) return null;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } finally {
      bitmap.close?.();
    }
  }

  async function imageSize(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      return null;
    }
  }

  // Below this the upload is over before a progress bar could mean anything.
  const PROGRESS_MIN_BYTES = 256 * 1024;
  // The bridge's cap (clipboard.mjs BLOB_MAX_BYTES).
  const MAX_BYTES = 64 * 1024 * 1024;
  const DEFAULT_CONFIRM_BYTES = 4 * 1024 * 1024;
  // Longest side of an image sent scaled down.
  const SCALED_MAX_SIDE = 1920;

  const cancelledError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });

  // XHR for its progress events (fetch has no upload progress). transfer.abort is set to cancel it.
  function xhrRequest(method, url, { body = null, headers = {}, responseType = 'json', onUpload, onDownload, transfer }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.responseType = responseType;
      if (onUpload) xhr.upload.onprogress = (event) => onUpload(event.loaded, event.lengthComputable ? event.total : body.size);
      if (onDownload) xhr.onprogress = (event) => onDownload(event.loaded, event.lengthComputable ? event.total : 0);
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, result: xhr.response });
      xhr.onerror = () => reject(new TypeError('Network error'));
      xhr.onabort = () => reject(cancelledError());
      if (transfer) transfer.abort = () => xhr.abort();
      xhr.send(body);
    });
  }

  // onConfirm({ direction: 'send' | 'receive', mime, size, width, height, canScale }) asks the user about large
  // content: resolves 'accept', 'scale' (send the image scaled down) or null (don't).
  function createClipboardSync({ isEnabled = () => true, onNotice = () => {}, onState = () => {}, onProgress = () => {}, onConfirm = async () => 'accept', getConfirmBytes = () => DEFAULT_CONFIRM_BYTES } = {}) {
    let capability = { text: false, image: false };
    let lastFingerprint = null;
    let localFingerprint = null; // what this device's clipboard is known to hold (last sent from or written to it)
    let pendingInbound = null;
    let readBlocked = false;
    let busy = false;
    let stopped = false;
    let pasteWaiter = null; // { resolve, timer } while a Ctrl+V waits for the paste event
    const transfers = { send: null, receive: null }; // { cancelled, abort, progress } of each direction's transfer
    let declinedFingerprint = null; // large local content the user chose not to send: not offered again on focus
    let receiveSerial = 0;
    const supported = Boolean(navigator.clipboard && window.isSecureContext);
    const state = () => ({ supported, capability: { ...capability }, readBlocked, pending: Boolean(pendingInbound) });
    const active = () => !stopped && supported && isEnabled() && (capability.text || capability.image);

    async function readLocal() {
      if (capability.image && typeof navigator.clipboard.read === 'function') {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('image/png')) return { mime: 'image/png', data: await item.getType('image/png') };
          const imageType = item.types.find((type) => type.startsWith('image/'));
          if (imageType) return { mime: 'image/png', data: await toPng(await item.getType(imageType)) };
          if (capability.text && item.types.includes('text/plain')) {
            const text = await (await item.getType('text/plain')).text();
            return text ? { mime: 'text/plain', data: text } : null;
          }
        }
        return null;
      }
      if (!capability.text) return null;
      const text = await navigator.clipboard.readText();
      return text ? { mime: 'text/plain', data: text } : null;
    }

    const TERMINAL = new Set(['done', 'failed', 'cancelled', 'idle']);
    const abortTransfer = (current) => { if (!current) return; current.cancelled = true; current.abort?.(); };
    // One transfer per direction: a new one supersedes the one before it.
    const beginTransfer = (direction) => {
      abortTransfer(transfers[direction]);
      const current = { direction, cancelled: false, abort: null, shown: false, ended: false };
      current.progress = (progress) => {
        current.shown = true;
        if (TERMINAL.has(progress.phase)) current.ended = true;
        onProgress({ direction, ...progress });
      };
      transfers[direction] = current;
      return current;
    };
    // Whatever showed progress and stopped without a last word (nothing sent after all) hides it again.
    const endTransfer = (current) => {
      if (transfers[current.direction] === current) transfers[current.direction] = null;
      if (current.shown && !current.ended) current.progress({ phase: 'idle' });
    };
    const checkCancelled = (current) => { if (current.cancelled || stopped) throw cancelledError(); };

    // Size limits before anything goes out: too large is refused, large asks first. Resolves the content to
    // send (possibly scaled down) or null. onAsk() runs before the question (a held Ctrl+V lets go then).
    async function approve(content, print, manual, current, onAsk) {
      const size = content.mime === 'text/plain' ? new Blob([content.data]).size : content.data.size;
      if (size > MAX_BYTES) { onAsk?.(); onNotice('too-large', content, null, null, { size, max: MAX_BYTES }); return null; }
      if (size < getConfirmBytes()) return content;
      // Declined before and offered again only because the page got focus back: stay quiet.
      if (!manual && print === declinedFingerprint) return null;
      const dims = content.mime === 'text/plain' ? null : await imageSize(content.data);
      checkCancelled(current);
      onAsk?.();
      current.asked = true;
      const answer = await onConfirm({ direction: 'send', mime: content.mime, size, width: dims?.width, height: dims?.height, canScale: Boolean(dims && Math.max(dims.width, dims.height) > SCALED_MAX_SIDE) });
      checkCancelled(current);
      if (!answer) { declinedFingerprint = print; return null; }
      if (answer === 'scale' && dims) {
        current.progress({ phase: 'prepare', mime: content.mime, total: size });
        const scaled = await scaledPng(content.data, SCALED_MAX_SIDE);
        checkCancelled(current);
        if (scaled) return { mime: 'image/png', data: scaled, scaled: true };
      }
      return content;
    }

    async function upload(content, manual, current, onAsk) {
      const print = await fingerprint(content);
      if (print === lastFingerprint && !manual) return false;
      checkCancelled(current);
      const approved = await approve(content, print, manual, current, onAsk);
      if (!approved) return false;
      const body = approved.mime === 'text/plain' ? new Blob([approved.data], { type: 'text/plain' }) : approved.data;
      const total = body.size;
      const report = total >= PROGRESS_MIN_BYTES || current.asked || current.shown ? current.progress : () => {};
      const mime = approved.mime;
      report({ phase: 'upload', mime, loaded: 0, total });
      let response;
      try {
        response = await xhrRequest('POST', '/api/bridge/clipboard', {
          body,
          headers: { 'X-Clipboard-Mime': mime },
          transfer: current,
          onUpload: (loaded) => {
            // All of it with the bridge: what is left is the bridge's own upload to the host.
            report(loaded >= total ? { phase: 'host', mime, loaded: total, total } : { phase: 'upload', mime, loaded, total });
          },
        });
      } catch (error) {
        report({ phase: error?.name === 'AbortError' ? 'cancelled' : 'failed', mime, total });
        throw error;
      }
      const result = response.result || {};
      if (!response.ok || result.ok === false) {
        report({ phase: 'failed', mime, total });
        throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { name: 'BridgeError' });
      }
      report({ phase: 'done', mime, loaded: total, total });
      // The original's fingerprint: the scaled copy stands for it, so it is not offered again on focus.
      lastFingerprint = print;
      localFingerprint = approved.scaled ? await fingerprint(approved) : print;
      // A Ctrl+V let go while the user decided pasted nothing: say where the content is now.
      if (manual === 'drop' || (current.asked && !manual)) onNotice('dropped', approved);
      else if (manual) onNotice('sent', approved);
      return true;
    }

    // What a paste event or a drop carries, read synchronously (a DataTransfer is emptied once its event ends).
    function snapshot(transfer) {
      if (!transfer) return null;
      const files = Array.from(transfer.files || []);
      if (!files.length) {
        for (const item of Array.from(transfer.items || [])) if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
      }
      return { files, text: transfer.getData?.('text/plain') || '' };
    }

    async function contentOf(snap, manual, current) {
      const image = snap.files.find((file) => file.type.startsWith('image/'));
      if (image && capability.image) {
        if (image.size > MAX_BYTES) { onNotice('too-large', null, null, image, { size: image.size, max: MAX_BYTES }); return null; }
        // Converting a large photo takes a moment: show it, and let it be cancelled.
        if (image.type !== 'image/png' && image.size >= PROGRESS_MIN_BYTES) current.progress({ phase: 'prepare', mime: 'image/png', total: image.size });
        try {
          const png = await toPng(image);
          checkCancelled(current);
          return { mime: 'image/png', data: png };
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          /* a format this browser can't decode */
        }
      }
      if (snap.text && capability.text) return { mime: 'text/plain', data: snap.text };
      if (snap.files.length) { onNotice('file-unsupported', null, null, snap.files[0]); return null; }
      if (manual) onNotice('empty');
      return null;
    }

    async function sendSnapshot(snap, manual, onAsk) {
      if (!active() || !snap) return false;
      busy = true;
      const current = beginTransfer('send');
      try {
        const content = await contentOf(snap, manual, current);
        return content ? await upload(content, manual, current, onAsk) : false;
      } catch (error) {
        if (error?.name === 'AbortError') { if (!current.ended) current.progress({ phase: 'cancelled' }); }
        else onNotice('send-failed', null, error);
        return false;
      } finally {
        endTransfer(current);
        busy = false;
        onState(state());
      }
    }

    async function sendLocal(manual, onAsk) {
      if (!active() || busy) return false;
      busy = true;
      const current = beginTransfer('send');
      try {
        const content = await readLocal();
        readBlocked = false;
        if (!content) { if (manual) onNotice('empty'); return false; }
        checkCancelled(current);
        return await upload(content, manual, current, onAsk);
      } catch (error) {
        // NotAllowedError: no permission, or a browser that only allows reading during a click.
        if (error?.name === 'AbortError') {
          if (!current.ended) current.progress({ phase: 'cancelled' });
        } else if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
          readBlocked = true;
          if (manual) onNotice('read-blocked');
        } else if (manual) {
          onNotice('send-failed', null, error);
        }
        return false;
      } finally {
        endTransfer(current);
        busy = false;
        onState(state());
      }
    }

    async function writeLocal(content) {
      try {
        if (content.mime === 'text/plain') await navigator.clipboard.writeText(content.data);
        else await navigator.clipboard.write([new ClipboardItem({ [content.mime]: content.data })]);
        pendingInbound = null;
        localFingerprint = await fingerprint(content);
        onNotice('received', content);
        // The browser re-encodes images it writes: remember what it actually holds now, or the next focus
        // (or Ctrl+V) would send the same picture back to the host as a "new" one.
        if (content.mime !== 'text/plain') {
          try {
            if ((await navigator.permissions.query({ name: 'clipboard-read' })).state === 'granted') {
              const stored = await readLocal();
              if (stored) lastFingerprint = localFingerprint = await fingerprint(stored);
            }
          } catch { /* can't read it back here: at worst the picture is sent back once */ }
        }
      } catch {
        pendingInbound = content;
      }
      onState(state());
    }

    // Host content: inline text as it is, anything else fetched from the bridge (which only then downloads it
    // from the host) - after asking, when it is large. Newer host content supersedes a question still open.
    async function receive(message) {
      if (stopped || !supported || !isEnabled()) return;
      const serial = ++receiveSerial;
      let content;
      if (typeof message.text === 'string') {
        content = { mime: 'text/plain', data: message.text };
      } else if (message.id) {
        const size = Number(message.size) || 0;
        const mime = message.mime;
        if (size >= getConfirmBytes()) {
          const answer = await onConfirm({ direction: 'receive', mime, size, canScale: false });
          if (!answer || serial !== receiveSerial || stopped) return;
        }
        const current = beginTransfer('receive');
        const report = size >= PROGRESS_MIN_BYTES ? current.progress : () => {};
        report({ phase: 'download', mime, loaded: 0, total: size });
        try {
          const response = await xhrRequest('GET', '/api/bridge/clipboard/' + encodeURIComponent(message.id), {
            responseType: 'blob',
            transfer: current,
            onDownload: (loaded, total) => report({ phase: 'download', mime, loaded, total: total || size }),
          });
          if (!response.ok) { report({ phase: 'failed', mime, total: size }); return; }
          const blob = response.result;
          content = mime === 'text/plain' ? { mime: 'text/plain', data: await blob.text() } : { mime, data: new Blob([blob], { type: mime }) };
          report({ phase: 'done', mime, loaded: blob.size, total: blob.size });
        } catch (error) {
          report({ phase: error?.name === 'AbortError' ? 'cancelled' : 'failed', mime, total: size });
          return;
        } finally {
          endTransfer(current);
        }
      } else {
        return;
      }
      if (serial !== receiveSerial || stopped) return;
      lastFingerprint = await fingerprint(content);
      await writeLocal(content);
    }

    // Ctrl/Cmd+V (from the input controller, before the keystroke goes out): resolves once this device's
    // clipboard is on the host. The paste event that follows the keydown carries it; a browser that sends no
    // paste event here falls back to reading the clipboard (the keypress allows that).
    function beforePaste() {
      if (!active()) return null;
      if (pasteWaiter) pasteWaiter.resolve();
      return new Promise((resolve) => {
        // resolve(false): the content needs the user's go-ahead first, so the held Ctrl+V is dropped (it would
        // paste the host's old content); the user pastes on the host once it is there.
        const waiter = { resolve: (value) => { clearTimeout(waiter.timer); if (pasteWaiter === waiter) pasteWaiter = null; resolve(value); } };
        waiter.timer = setTimeout(() => {
          if (pasteWaiter !== waiter) return;
          pasteWaiter = null;
          let asked = false;
          sendLocal(false, () => { asked = true; resolve(false); }).finally(() => { if (!asked) resolve(); });
        }, 100);
        pasteWaiter = waiter;
      });
    }
    const onPaste = (event) => {
      if (!pasteWaiter || stopped) return;
      const waiter = pasteWaiter;
      pasteWaiter = null;
      clearTimeout(waiter.timer);
      event.preventDefault();
      const snap = snapshot(event.clipboardData);
      pendingInbound = null;
      let asked = false;
      void sendSnapshot(snap, false, () => { asked = true; waiter.resolve(false); }).finally(() => { if (!asked) waiter.resolve(); });
    };

    // Host content still waiting to be written, unless this device's clipboard changed meanwhile (the user
    // copied something here after it arrived): that is newer, it goes to the host and the waiting one is dropped.
    async function writePendingOrSend() {
      const pending = pendingInbound;
      if (!pending) return void sendLocal(false);
      if (busy) return;
      let local = null;
      busy = true;
      try {
        if ((await navigator.permissions.query({ name: 'clipboard-read' })).state === 'granted') local = await readLocal();
      } catch { /* can't tell: the waiting content wins, as before */ } finally {
        busy = false;
      }
      if (pendingInbound !== pending || stopped) return;
      if (local && localFingerprint && (await fingerprint(local)) !== localFingerprint) {
        pendingInbound = null;
        onState(state());
        void sendLocal(false);
      } else {
        void writeLocal(pending);
      }
    }
    const onFocus = () => { if (!stopped) void writePendingOrSend(); };
    const onVisible = () => { if (document.visibilityState === 'visible' && document.hasFocus()) onFocus(); };
    // A click is a user gesture: the moment a refused write goes through. A click that brings the page back
    // is left to onFocus (pointerdown comes first), which checks for a newer copy on this device.
    const onPointer = () => { if (pendingInbound && !stopped && document.hasFocus()) void writeLocal(pendingInbound); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('paste', onPaste, true);

    return {
      get state() { return state(); },
      setCapability(next) {
        const value = { text: Boolean(next?.text), image: Boolean(next?.image) };
        const changed = value.text !== capability.text || value.image !== capability.image;
        capability = value;
        if (changed) {
          onState(state());
          // The host just started accepting: offer what is on this device's clipboard now.
          if (active() && document.hasFocus()) void sendLocal(false);
        }
      },
      sendNow: () => sendLocal(true),
      beforePaste,
      // A drop on the stream: put the dropped image (or text) on the host's clipboard.
      sendDataTransfer: (transfer) => sendSnapshot(snapshot(transfer), 'drop'),
      receive,
      // End the transfer in progress (an open question is the page's to close: onConfirm).
      cancel(direction) {
        const current = direction ? [transfers[direction]] : [transfers.send, transfers.receive];
        current.forEach(abortTransfer);
        return current.some(Boolean);
      },
      stop() {
        stopped = true;
        abortTransfer(transfers.send);
        abortTransfer(transfers.receive);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisible);
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('paste', onPaste, true);
        pasteWaiter?.resolve();
      },
    };
  }

  window.SunbridgeClipboard = { createClipboardSync, MAX_BYTES, DEFAULT_CONFIRM_BYTES };
})();

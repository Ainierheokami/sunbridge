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

  function createClipboardSync({ isEnabled = () => true, onNotice = () => {}, onState = () => {} } = {}) {
    let capability = { text: false, image: false };
    let lastFingerprint = null;
    let pendingInbound = null;
    let readBlocked = false;
    let busy = false;
    let stopped = false;
    let pasteWaiter = null; // { resolve, timer } while a Ctrl+V waits for the paste event
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

    async function upload(content, manual) {
      const print = await fingerprint(content);
      if (print === lastFingerprint && !manual) return false;
      const body = content.mime === 'text/plain' ? new Blob([content.data], { type: 'text/plain' }) : content.data;
      const response = await fetch('/api/bridge/clipboard', { method: 'POST', headers: { 'X-Clipboard-Mime': content.mime }, body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { name: 'BridgeError' });
      lastFingerprint = print;
      if (manual) onNotice(manual === 'drop' ? 'dropped' : 'sent', content);
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

    async function contentOf(snap, manual) {
      const image = snap.files.find((file) => file.type.startsWith('image/'));
      if (image && capability.image) {
        try { return { mime: 'image/png', data: await toPng(image) }; } catch { /* a format this browser can't decode */ }
      }
      if (snap.text && capability.text) return { mime: 'text/plain', data: snap.text };
      if (snap.files.length) { onNotice('file-unsupported', null, null, snap.files[0]); return null; }
      if (manual) onNotice('empty');
      return null;
    }

    async function sendSnapshot(snap, manual) {
      if (!active() || !snap) return false;
      busy = true;
      try {
        const content = await contentOf(snap, manual);
        return content ? await upload(content, manual) : false;
      } catch (error) {
        onNotice('send-failed', null, error);
        return false;
      } finally {
        busy = false;
        onState(state());
      }
    }

    async function sendLocal(manual) {
      if (!active() || busy) return false;
      busy = true;
      try {
        const content = await readLocal();
        readBlocked = false;
        if (!content) { if (manual) onNotice('empty'); return false; }
        return await upload(content, manual);
      } catch (error) {
        // NotAllowedError: no permission, or a browser that only allows reading during a click.
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
          readBlocked = true;
          if (manual) onNotice('read-blocked');
        } else if (manual) {
          onNotice('send-failed', null, error);
        }
        return false;
      } finally {
        busy = false;
        onState(state());
      }
    }

    async function writeLocal(content) {
      try {
        if (content.mime === 'text/plain') await navigator.clipboard.writeText(content.data);
        else await navigator.clipboard.write([new ClipboardItem({ [content.mime]: content.data })]);
        pendingInbound = null;
        onNotice('received', content);
        // The browser re-encodes images it writes: remember what it actually holds now, or the next focus
        // (or Ctrl+V) would send the same picture back to the host as a "new" one.
        if (content.mime !== 'text/plain') {
          try {
            if ((await navigator.permissions.query({ name: 'clipboard-read' })).state === 'granted') {
              const stored = await readLocal();
              if (stored) lastFingerprint = await fingerprint(stored);
            }
          } catch { /* can't read it back here: at worst the picture is sent back once */ }
        }
      } catch {
        pendingInbound = content;
      }
      onState(state());
    }

    async function receive(message) {
      if (stopped || !supported || !isEnabled()) return;
      let content;
      try {
        if (typeof message.text === 'string') {
          content = { mime: 'text/plain', data: message.text };
        } else if (message.id) {
          const response = await fetch('/api/bridge/clipboard/' + encodeURIComponent(message.id), { cache: 'no-store' });
          if (!response.ok) return;
          const blob = await response.blob();
          content = message.mime === 'text/plain' ? { mime: 'text/plain', data: await blob.text() } : { mime: message.mime, data: new Blob([blob], { type: message.mime }) };
        } else {
          return;
        }
      } catch {
        return;
      }
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
        const waiter = { resolve: () => { clearTimeout(waiter.timer); if (pasteWaiter === waiter) pasteWaiter = null; resolve(); } };
        waiter.timer = setTimeout(() => {
          if (pasteWaiter !== waiter) return;
          pasteWaiter = null;
          sendLocal(false).finally(resolve);
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
      void sendSnapshot(snap, false).finally(() => waiter.resolve());
    };

    const onFocus = () => {
      if (stopped) return;
      if (pendingInbound) void writeLocal(pendingInbound);
      else void sendLocal(false);
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && document.hasFocus()) onFocus(); };
    // A click is a user gesture: the moment a refused write goes through.
    const onPointer = () => { if (pendingInbound && !stopped) void writeLocal(pendingInbound); };
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
      stop() {
        stopped = true;
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisible);
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('paste', onPaste, true);
        pasteWaiter?.resolve();
      },
    };
  }

  window.SunbridgeClipboard = { createClipboardSync };
})();

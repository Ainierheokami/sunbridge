// Clipboard sync for the stream page, with Foundation Sunshine's clipboard sync (bridge side: clipboard.mjs).
// Like its Android client:
//   - this device -> host: the local clipboard is read when the page gets focus back (the user copied
//     something elsewhere and returns) and sent when it changed; sendNow() does it on demand (a button: some
//     browsers only allow reading the clipboard during a click);
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

  function createClipboardSync({ isEnabled = () => true, onNotice = () => {}, onState = () => {} } = {}) {
    let capability = { text: false, image: false };
    let lastFingerprint = null;
    let pendingInbound = null;
    let readBlocked = false;
    let busy = false;
    let stopped = false;
    const supported = Boolean(navigator.clipboard && window.isSecureContext);
    const state = () => ({ supported, capability: { ...capability }, readBlocked, pending: Boolean(pendingInbound) });
    const active = () => !stopped && supported && isEnabled() && (capability.text || capability.image);

    async function readLocal() {
      if (capability.image && typeof navigator.clipboard.read === 'function') {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('image/png')) return { mime: 'image/png', data: await item.getType('image/png') };
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

    async function sendLocal(manual) {
      if (!active() || busy) return false;
      busy = true;
      try {
        const content = await readLocal();
        readBlocked = false;
        if (!content) { if (manual) onNotice('empty'); return false; }
        const print = await fingerprint(content);
        if (print === lastFingerprint && !manual) return false;
        const body = content.mime === 'text/plain' ? new Blob([content.data], { type: 'text/plain' }) : content.data;
        const response = await fetch('/api/bridge/clipboard', { method: 'POST', headers: { 'X-Clipboard-Mime': content.mime }, body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { name: 'BridgeError' });
        lastFingerprint = print;
        if (manual) onNotice('sent', content);
        return true;
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
      receive,
      stop() {
        stopped = true;
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisible);
        document.removeEventListener('pointerdown', onPointer, true);
      },
    };
  }

  window.SunbridgeClipboard = { createClipboardSync };
})();

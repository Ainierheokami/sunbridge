// Network → interaction test: what a stream gets from this browser, without a host.
// - Link: round trip and throughput between this browser and the bridge (HTTP and the WebRTC path streams use).
// - Interaction: fullscreen, keyboard lock and pointer lock asked for exactly as a stream asks for them
//   (SunbridgeApp.enterFullscreen), and a record of which keys and buttons reach the page. A key the system
//   or the browser keeps shows up as the page losing focus or fullscreen right after it.
// - Report: browser, screen, settings, the last diagnosis, this test and the recent bridge log in one JSON
//   to copy or download for a bug report.
(function () {
  'use strict';
  const t = (key, params) => (window.t ? window.t(key, params) : key);
  const app = () => window.SunbridgeApp;
  const MAX_EVENTS = 400;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgentData?.platform || '');

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
    return node;
  };
  const icons = (scope) => window.SunbridgeIcons?.hydrate?.(scope);
  const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
  const round = (value, digits = 1) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

  // Keys a stream wants on the host that the system or the browser takes unless the keyboard is locked.
  // `on` decides when a key counts as having reached the page: Win opens the Start menu on release.
  const primary = (event) => (isMac ? event.metaKey : event.ctrlKey);
  const KEY_CHECKS = [
    { id: 'meta', label: isMac ? '⌘' : 'Win', match: (event) => /^(Meta|OS)(Left|Right)$/.test(event.code), on: 'keyup' },
    { id: 'switcher', label: isMac ? '⌘ Tab' : 'Alt + Tab', match: (event) => event.code === 'Tab' && (isMac ? event.metaKey : event.altKey) },
    { id: 'escape', label: 'Esc', match: (event) => event.code === 'Escape' },
    { id: 'closeTab', label: isMac ? '⌘ W' : 'Ctrl + W', match: (event) => event.code === 'KeyW' && primary(event) },
    { id: 'newTab', label: isMac ? '⌘ T' : 'Ctrl + T', match: (event) => event.code === 'KeyT' && primary(event) },
    { id: 'f11', label: 'F11', match: (event) => event.code === 'F11' },
  ];
  const CONFIRM_MS = 800; // no focus or fullscreen lost this long after the key: it stayed in the page

  const state = {
    root: null, refs: {}, started: performance.now(),
    events: [], keys: {}, pending: [], held: new Set(),
    lock: null, fullscreenAt: 0, exitingOnPurpose: false, movement: { x: 0, y: 0 },
    speed: null, speedRunning: false, speedError: '',
  };
  const resetKeys = () => { state.keys = Object.fromEntries(KEY_CHECKS.map((check) => [check.id, { status: 'untested', note: '' }])); };
  resetKeys();

  // ----- event record -----
  const log = (type, detail = {}) => {
    state.events.push({ ms: Math.round(performance.now() - state.started), type, ...detail });
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    scheduleUpdate();
  };
  const pad = () => state.refs.pad;
  const active = () => {
    const node = pad();
    return Boolean(node && (document.fullscreenElement === node || document.pointerLockElement === node || document.activeElement === node));
  };
  const setKey = (id, status, note = '') => {
    const entry = state.keys[id];
    if (!entry || (entry.status === 'ok' && status === 'pending')) return;
    state.keys[id] = { status, note };
    scheduleUpdate();
  };
  const markPending = (check) => {
    setKey(check.id, 'pending');
    const item = { id: check.id, timer: null };
    item.timer = window.setTimeout(() => {
      state.pending = state.pending.filter((other) => other !== item);
      if (state.keys[check.id].status === 'pending') setKey(check.id, 'ok');
    }, CONFIRM_MS);
    state.pending.push(item);
  };
  // The page lost focus or fullscreen: whatever was just pressed (or is held) was taken by the system / browser.
  const takenAway = (why) => {
    const taken = new Set(state.pending.map((item) => item.id));
    state.pending.forEach((item) => window.clearTimeout(item.timer));
    state.pending = [];
    const held = state.held;
    const has = (pattern) => [...held].some((code) => pattern.test(code));
    // Which shortcut the held modifiers point to (the key itself never reached the page).
    if (isMac) {
      if (has(/^Meta/)) taken.add(why === 'unload' ? 'closeTab' : held.has('KeyT') ? 'newTab' : 'switcher');
    } else {
      if (has(/^(Meta|OS)/)) taken.add('meta');
      if (has(/^Alt/)) taken.add('switcher');
      if (has(/^Control/)) taken.add(why === 'unload' ? 'closeTab' : 'newTab');
    }
    if (why === 'fullscreen' && !taken.size) taken.add(held.has('F11') ? 'f11' : 'escape');
    taken.forEach((id) => { if (state.keys[id]?.status !== 'ok') setKey(id, 'lost', t('test.lost.' + why)); });
    held.clear();
    log('taken', { why, keys: [...taken] });
  };

  const onKey = (event) => {
    if (!active()) return;
    const down = event.type === 'keydown';
    if (down) state.held.add(event.code); else state.held.delete(event.code);
    // Like a stream: the page keeps every key (the browser still acts on those it never hands over).
    event.preventDefault();
    if (!event.repeat) {
      log(event.type, { code: event.code, key: event.key, mods: ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'].filter((name) => event[name]).map((name) => name.slice(0, -3)).join('+') || undefined });
    }
    if (event.repeat) return;
    for (const check of KEY_CHECKS) {
      if ((check.on || 'keydown') === event.type && check.match(event)) markPending(check);
      else if (check.on === 'keyup' && down && check.match(event)) setKey(check.id, 'pending');
    }
  };

  const onBlur = () => { if (state.held.size || state.pending.length) takenAway('blur'); log('blur'); };
  const onVisibility = () => { log('visibility', { state: document.visibilityState }); if (document.hidden && (state.held.size || state.pending.length)) takenAway('hidden'); };
  const onFullscreen = () => {
    const mine = document.fullscreenElement === pad();
    log('fullscreen', { on: Boolean(document.fullscreenElement), mine });
    if (!document.fullscreenElement && state.fullscreenAt) {
      if (!state.exitingOnPurpose) takenAway('fullscreen');
      state.fullscreenAt = 0;
      state.exitingOnPurpose = false;
    }
    scheduleUpdate();
  };
  const onPointerLock = () => {
    const locked = document.pointerLockElement === pad();
    log('pointerlock', { locked });
    if (locked) state.movement = { x: 0, y: 0 };
    scheduleUpdate();
  };
  const onBeforeUnload = (event) => {
    if (!state.fullscreenAt && !(active() && state.held.size)) return;
    takenAway('unload');
    event.preventDefault();
    event.returnValue = '';
  };

  // ----- actions -----
  const startFullscreen = async () => {
    const node = pad(); if (!node) return;
    resetKeys();
    try {
      const { lockError, permission, permissionBefore } = await app().enterFullscreen(node);
      state.fullscreenAt = performance.now();
      state.lock = lockError === 'unsupported' ? { status: 'unsupported' } : lockError ? { status: 'denied', error: `${lockError.name || ''} ${lockError.message || ''}`.trim() } : { status: 'granted' };
      Object.assign(state.lock, { permission, permissionBefore });
      log('keyboard-lock', state.lock);
      node.focus({ preventScroll: true });
    } catch (error) {
      // After a permission prompt the click's activation may be used up: the next click goes fullscreen.
      const retry = error?.permissionBefore === 'prompt' && error.permission === 'granted';
      state.lock = { status: retry ? 'allowed-retry' : 'no-fullscreen', error: `${error?.name || ''} ${error?.message || ''}`.trim(), permission: error?.permission, permissionBefore: error?.permissionBefore };
      log('fullscreen-error', state.lock);
    }
    void refreshPermissions();
    scheduleUpdate();
  };
  const leaveFullscreen = () => { state.exitingOnPurpose = true; void document.exitFullscreen?.().catch(() => {}); };
  const capturePointer = () => {
    const node = pad(); if (!node?.requestPointerLock) { log('pointerlock-error', { error: 'unsupported' }); return; }
    const fallback = () => { try { node.requestPointerLock(); } catch (error) { log('pointerlock-error', { error: String(error?.message || error) }); } };
    try {
      const result = node.requestPointerLock({ unadjustedMovement: true });
      result?.catch?.((error) => { log('pointerlock-retry', { error: `${error?.name || ''}`.trim() }); fallback(); });
    } catch { fallback(); }
  };

  const runSpeed = async () => {
    if (state.speedRunning) return;
    state.speedRunning = true; state.speedError = ''; state.speed = {};
    scheduleUpdate();
    try {
      const rtts = [];
      for (let index = 0; index < 10; index += 1) {
        const started = performance.now();
        const response = await fetch('/api/bridge/health', { cache: 'no-store' });
        await response.arrayBuffer();
        rtts.push(performance.now() - started);
      }
      state.speed.httpRtt = round(median(rtts));
      state.speed.httpJitter = round(Math.max(...rtts) - Math.min(...rtts));
      scheduleUpdate();
      const download = async (bytes) => {
        const started = performance.now();
        const response = await fetch('/api/bridge/speedtest?bytes=' + bytes, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const reader = response.body.getReader();
        let received = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; received += value.length; }
        return { mbps: (received * 8) / ((performance.now() - started) * 1000), bytes: received };
      };
      const randomBlock = new Uint8Array(256 * 1024);
      for (let offset = 0; offset < randomBlock.length; offset += 65536) crypto.getRandomValues(randomBlock.subarray(offset, offset + 65536));
      const upload = async (bytes) => {
        const parts = []; for (let left = bytes; left > 0; left -= randomBlock.length) parts.push(left >= randomBlock.length ? randomBlock : randomBlock.subarray(0, left));
        const started = performance.now();
        const response = await fetch('/api/bridge/speedtest', { method: 'POST', body: new Blob(parts), cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || 'HTTP ' + response.status);
        return { mbps: (payload.bytes * 8) / ((performance.now() - started) * 1000), bytes: payload.bytes };
      };
      // A small probe, then a transfer sized to take about two seconds at the probed rate.
      const measure = async (run, key) => {
        const probe = await run(2 * 1024 * 1024);
        const bytes = Math.min(64 * 1024 * 1024, Math.max(2 * 1024 * 1024, Math.round((probe.mbps * 1e6 / 8) * 2)));
        const result = bytes > probe.bytes * 1.5 ? await run(bytes) : probe;
        state.speed[key] = round(result.mbps);
        state.speed[key + 'Bytes'] = result.bytes;
        scheduleUpdate();
      };
      await measure(download, 'download');
      await measure(upload, 'upload');
      const webrtc = await app()?.testWebrtc?.();
      if (webrtc) state.speed.webrtc = { status: webrtc.status, rtt: webrtc.rtt ?? null, connectMs: webrtc.elapsedMs ?? null, path: webrtc.path || null, detail: webrtc.detail };
      state.speed.at = new Date().toISOString();
      log('speed', { ...state.speed, webrtc: state.speed.webrtc?.rtt });
    } catch (error) {
      state.speedError = error?.message || String(error);
      log('speed-error', { error: state.speedError });
    } finally {
      state.speedRunning = false;
      scheduleUpdate();
    }
  };

  // Edge asks for keyboard-lock / pointer-lock permission; Chrome has no such permission (the query throws).
  const refreshPermissions = async () => {
    const query = async (name) => { try { return (await navigator.permissions.query({ name })).state; } catch { return 'n/a'; } };
    state.permissions = { keyboardLock: await query('keyboard-lock'), pointerLock: await query('pointer-lock') };
    scheduleUpdate();
  };

  // ----- report -----
  const buildReport = async () => {
    let uaData = null;
    try {
      uaData = navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture', 'model']) : null;
    } catch { uaData = null; }
    let codecs = null;
    try { const size = app()?.adaptiveSize?.(); codecs = size ? await app().decodableCodecs({ ...size, fps: app().settings().fps || 60 }) : null; } catch { codecs = null; }
    let bridgeLog = null;
    try {
      const response = await fetch('/api/logs?limit=150', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json();
      bridgeLog = payload.ok ? payload.entries : { error: payload.error || 'HTTP ' + response.status };
    } catch (error) { bridgeLog = { error: error?.message || String(error) }; }
    const diagnosis = app()?.diagnostic?.();
    return {
      sunbridgeReport: 1,
      generatedAt: new Date().toISOString(),
      page: { host: location.host, protocol: location.protocol, secureContext: window.isSecureContext, locale: window.SunbridgeI18n?.getLocale?.() },
      browser: { userAgent: navigator.userAgent, uaData, language: navigator.language, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null },
      apis: {
        keyboardLock: Boolean(navigator.keyboard?.lock), pointerLock: 'requestPointerLock' in Element.prototype, fullscreen: Boolean(document.fullscreenEnabled),
        webCodecs: typeof window.VideoDecoder === 'function', webrtc: typeof window.RTCPeerConnection === 'function', clipboard: Boolean(navigator.clipboard),
        offscreenCanvas: typeof window.OffscreenCanvas === 'function',
      },
      display: {
        screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth },
        window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        adaptiveSize: app()?.adaptiveSize?.() || null,
      },
      settings: app()?.settings?.() || null,
      codecs,
      diagnosis: diagnosis?.result ? { status: diagnosis.status, latency: diagnosis.result.latency, worst: diagnosis.result.worst, checks: diagnosis.result.checks || null } : { status: diagnosis?.status || null, error: diagnosis?.error || null },
      speed: state.speed,
      interaction: { keyboardLock: state.lock, permissions: state.permissions || null, keys: state.keys, events: state.events },
      stream: app()?.stream?.() || null,
      bridgeLog,
    };
  };
  const copyReport = async () => {
    const text = JSON.stringify(await buildReport(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = h('textarea', { class: 'testbench-copy', 'aria-hidden': 'true' }); area.value = text;
      document.body.append(area); area.select();
      try { document.execCommand('copy'); } finally { area.remove(); }
    }
    flash(t('test.copied'));
  };
  const downloadReport = async () => {
    const text = JSON.stringify(await buildReport(), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = h('a', { href: url, download: `sunbridge-report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json` });
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    flash(t('test.downloaded'));
  };
  const flash = (message) => { const node = state.refs.reportNote; if (!node) return; node.textContent = message; window.setTimeout(() => { if (node.textContent === message) node.textContent = ''; }, 4000); };
  const clearRecord = () => { state.events = []; resetKeys(); state.lock = null; state.started = performance.now(); scheduleUpdate(); };

  // ----- view -----
  const tile = (key) => {
    const value = h('strong', { text: '—' });
    const note = h('small', { text: '' });
    state.refs['speed_' + key] = { value, note };
    return h('div', { class: 'testbench-tile' }, h('span', { text: t('test.speed.' + key) }), value, note);
  };
  const render = () => {
    const container = document.getElementById('testbenchView');
    if (!container) return;
    // Rebuilding would drop the pad out of fullscreen / pointer lock: only when nothing is in progress.
    if (state.root && (document.fullscreenElement === pad() || document.pointerLockElement === pad())) return;
    state.refs = {};
    const refs = state.refs;
    refs.chips = h('div', { class: 'testbench-chips' });
    refs.keys = h('div', { class: 'testbench-keys' });
    refs.ticker = h('ol', { class: 'testbench-ticker' });
    refs.mouse = h('p', { class: 'testbench-mouse' });
    refs.fullscreenButton = h('button', { class: 'primary-button', type: 'button', onclick: () => (document.fullscreenElement === pad() ? leaveFullscreen() : void startFullscreen()) });
    refs.pad = h('div', { class: 'testbench-pad', tabindex: '0', role: 'application', 'aria-label': t('test.padLabel') },
      h('div', { class: 'testbench-pad-head' }, refs.chips,
        h('div', { class: 'testbench-pad-actions' }, refs.fullscreenButton,
          h('button', { class: 'secondary-button', type: 'button', text: t('test.pointer'), onclick: capturePointer }))),
      h('p', { class: 'testbench-pad-hint', text: t('test.padHint') }),
      refs.keys, refs.mouse, refs.ticker);
    refs.pad.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      refs.pad.focus({ preventScroll: true });
      log('mouse-down', { button: event.button, type: event.pointerType });
    });
    refs.pad.addEventListener('pointerup', (event) => { if (!event.target.closest('button')) log('mouse-up', { button: event.button }); });
    // Back / forward buttons would navigate away; the wheel would scroll the page.
    refs.pad.addEventListener('mouseup', (event) => { if (event.button > 2) event.preventDefault(); });
    refs.pad.addEventListener('auxclick', (event) => event.preventDefault());
    refs.pad.addEventListener('contextmenu', (event) => { event.preventDefault(); });
    refs.pad.addEventListener('wheel', (event) => { event.preventDefault(); log('wheel', { dx: round(event.deltaX), dy: round(event.deltaY), mode: event.deltaMode }); }, { passive: false });
    refs.pad.addEventListener('pointermove', (event) => {
      if (document.pointerLockElement !== refs.pad) return;
      state.movement.x += event.movementX || 0; state.movement.y += event.movementY || 0;
      scheduleUpdate();
    });
    refs.speedButton = h('button', { class: 'secondary-button', type: 'button', onclick: () => void runSpeed() });
    refs.speedError = h('p', { class: 'host-hint testbench-error' });
    refs.speedAdvice = h('p', { class: 'host-hint' });
    refs.reportNote = h('span', { class: 'host-hint' });
    const root = h('div', { class: 'testbench' },
      h('section', { class: 'diagnostic-log testbench-card' },
        h('div', { class: 'testbench-head' }, h('div', {}, h('div', { class: 'section-overline', text: t('test.speedOverline') }), h('h2', { text: t('test.speedTitle') })), refs.speedButton),
        h('div', { class: 'testbench-tiles' }, tile('httpRtt'), tile('webrtc'), tile('download'), tile('upload')),
        refs.speedAdvice, refs.speedError),
      h('section', { class: 'diagnostic-log testbench-card' },
        h('div', { class: 'testbench-head' }, h('div', {}, h('div', { class: 'section-overline', text: t('test.interactionOverline') }), h('h2', { text: t('test.interactionTitle') }))),
        h('p', { class: 'host-hint', text: t('test.interactionHint') }),
        refs.pad),
      h('section', { class: 'diagnostic-log testbench-card' },
        h('div', { class: 'testbench-head' }, h('div', {}, h('div', { class: 'section-overline', text: t('test.reportOverline') }), h('h2', { text: t('test.reportTitle') })),
          h('div', { class: 'testbench-report-actions' },
            h('button', { class: 'secondary-button', type: 'button', onclick: clearRecord, text: t('test.clear') }),
            h('button', { class: 'secondary-button', type: 'button', onclick: () => void copyReport() }, h('span', { 'data-icon': 'copy', 'aria-hidden': 'true' }), t('test.copy')),
            h('button', { class: 'primary-button', type: 'button', onclick: () => void downloadReport() }, h('span', { 'data-icon': 'download', 'aria-hidden': 'true' }), t('test.download')))),
        h('p', { class: 'host-hint', text: t('test.reportHint') }), refs.reportNote));
    container.replaceChildren(root);
    state.root = root;
    icons(root);
    update();
  };

  let updateQueued = false;
  const scheduleUpdate = () => { if (updateQueued) return; updateQueued = true; requestAnimationFrame(() => { updateQueued = false; update(); }); };
  const chip = (label, status, title) => h('span', { class: 'testbench-chip', 'data-status': status, title: title || null }, h('i'), label);
  const update = () => {
    const refs = state.refs;
    if (!refs.pad) return;
    const fullscreen = document.fullscreenElement === refs.pad;
    const lock = state.lock;
    const lockLabel = !navigator.keyboard?.lock ? t('test.chip.lockUnsupported') : !lock ? t('test.chip.lockIdle') : t('test.chip.lock.' + lock.status);
    const lockStatus = !navigator.keyboard?.lock || lock?.status === 'denied' || lock?.status === 'unsupported' || lock?.status === 'no-fullscreen' ? 'fail' : lock?.status === 'granted' && fullscreen ? 'ok' : 'idle';
    const permission = state.permissions?.keyboardLock;
    refs.chips.replaceChildren(
      chip(t('test.chip.secure'), window.isSecureContext ? 'ok' : 'fail'),
      chip(lockLabel, lockStatus, lock?.error || null),
      permission && permission !== 'n/a' ? chip(t('test.chip.permission.' + permission), permission === 'granted' ? 'ok' : permission === 'denied' ? 'fail' : 'idle') : null,
      chip(t(fullscreen ? 'test.chip.fullscreenOn' : 'test.chip.fullscreenOff'), fullscreen ? 'ok' : 'idle'),
      chip(t(document.pointerLockElement === refs.pad ? 'test.chip.pointerOn' : 'test.chip.pointerOff'), document.pointerLockElement === refs.pad ? 'ok' : 'idle'),
      chip(t(active() ? 'test.chip.focusOn' : 'test.chip.focusOff'), active() ? 'ok' : 'idle'));
    refs.fullscreenButton.textContent = t(fullscreen ? 'test.exitFullscreen' : 'test.fullscreen');
    refs.keys.replaceChildren(...KEY_CHECKS.map((check) => {
      const entry = state.keys[check.id];
      return h('div', { class: 'testbench-key', 'data-status': entry.status },
        h('kbd', { text: check.label }), h('span', { text: t('test.key.' + entry.status) }), entry.note ? h('small', { text: entry.note }) : null);
    }));
    refs.mouse.textContent = document.pointerLockElement === refs.pad ? t('test.movement', { x: Math.round(state.movement.x), y: Math.round(state.movement.y) }) : '';
    refs.ticker.replaceChildren(...state.events.slice(-8).reverse().map((event) => {
      const { ms, type, ...rest } = event;
      const detail = Object.entries(rest).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' ');
      return h('li', {}, h('time', { text: (ms / 1000).toFixed(2) + 's' }), h('code', { text: type }), h('span', { text: detail }));
    }));
    const speed = state.speed || {};
    const set = (key, value, note = '') => { const ref = refs['speed_' + key]; if (ref) { ref.value.textContent = value; ref.note.textContent = note; } };
    set('httpRtt', speed.httpRtt != null ? speed.httpRtt + ' ms' : '—', speed.httpJitter != null ? t('test.speed.jitter', { value: speed.httpJitter }) : '');
    set('webrtc', speed.webrtc?.rtt != null ? speed.webrtc.rtt + ' ms' : speed.webrtc ? t('test.speed.failed') : '—', speed.webrtc?.path || (speed.webrtc && speed.webrtc.status !== 'ok' ? speed.webrtc.detail : ''));
    set('download', speed.download != null ? speed.download + ' Mbps' : '—', speed.downloadBytes ? (speed.downloadBytes / 1048576).toFixed(0) + ' MB' : '');
    set('upload', speed.upload != null ? speed.upload + ' Mbps' : '—', speed.uploadBytes ? (speed.uploadBytes / 1048576).toFixed(0) + ' MB' : '');
    refs.speedButton.textContent = t(state.speedRunning ? 'test.speedRunning' : 'test.speedRun');
    refs.speedButton.disabled = state.speedRunning;
    refs.speedError.textContent = state.speedError;
    // Stream video goes bridge → browser: the download rate decides the bitrate it can carry (with headroom).
    refs.speedAdvice.textContent = speed.download != null ? t('test.speed.advice', { mbps: Math.max(1, Math.floor(speed.download * 0.7)) }) : '';
  };

  // ----- wiring -----
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', () => log('focus'));
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('pointerlockchange', onPointerLock);
  document.addEventListener('pointerlockerror', () => log('pointerlock-error', { error: 'pointerlockerror' }));
  document.addEventListener('focusin', () => scheduleUpdate());
  document.addEventListener('focusout', () => scheduleUpdate());
  window.addEventListener('resize', () => { if (state.root) log('resize', { inner: `${window.innerWidth}x${window.innerHeight}`, dpr: window.devicePixelRatio }); });
  window.addEventListener('sunbridge:locale', () => { if (state.root) render(); });
  const init = () => { render(); void refreshPermissions(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();

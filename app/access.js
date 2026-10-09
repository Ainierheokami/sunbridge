// Settings → Access (entrypoints, allowed addresses, certificates, nginx helper), the Logs page, and the
// Sunbridge service card on the settings page (version, updates, restart).
// Network changes are applied by the bridge right away and reverted after 60 seconds unless confirmed from a
// working address; the confirmation banner shows on every page while a change is pending.
(function () {
  'use strict';
  const t = (key, params) => (window.t ? window.t(key, params) : key);
  const state = { update: null, updateChecking: false, updateError: '', network: null, certs: null, draft: null, logs: [], logFilter: { category: '', warnOnly: false }, pendingTimer: null, logTimer: null, nginx: '' };
  const isDemo = () => Boolean(window.sunbridgeClient?.isDemo);

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
    return node;
  };
  const icons = (scope) => window.SunbridgeIcons?.hydrate?.(scope);

  async function call(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && payload.errorCode === 'AUTH_REQUIRED') {
      window.location.assign(`/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.errorCode = payload.errorCode || null;
      throw error;
    }
    return payload;
  }

  const fmtTime = (iso) => {
    try { return new Intl.DateTimeFormat(window.SunbridgeI18n?.getLocale?.() || 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso)); } catch { return iso; }
  };
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(window.SunbridgeI18n?.getLocale?.() || 'zh-CN'); } catch { return iso; } };

  // ----- small dialog: password before a network / certificate change -------------------------------
  function askPassword(title, copy) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: '1024' });
      const close = (value) => { root.remove(); resolve(value); };
      const form = h('form', { class: 'pair-form', onsubmit: (event) => { event.preventDefault(); close(input.value); } },
        h('label', {}, h('span', { text: t('access.password') }), h('div', { class: 'input-shell' }, h('span', { 'data-icon': 'key', 'aria-hidden': 'true' }), input)),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'secondary-button', type: 'button', text: t('access.cancel'), onclick: () => close(null) }),
          h('button', { class: 'primary-button', type: 'submit', text: t('access.continue') })));
      const root = h('div', { class: 'modal-backdrop access-modal', onmousedown: (event) => { if (event.target === root) close(null); } },
        h('section', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true' }, h('h2', { text: title }), h('p', { class: 'modal-copy', text: copy }), form));
      root.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(null); } });
      document.body.append(root);
      icons(root);
      setTimeout(() => input.focus(), 30);
    });
  }

  // ----- data -----------------------------------------------------------------------------------------
  async function loadNetwork() {
    state.network = await call('/api/settings/network');
    if (!state.draft || !state.dirty) state.draft = structuredClone(state.network.config);
    renderPendingBanner();
    return state.network;
  }
  async function loadCertificates() {
    state.certs = await call('/api/settings/certificates');
  }

  // ----- pending change banner (all pages) ---------------------------------------------------------
  function renderPendingBanner() {
    const scroll = document.querySelector('.content-scroll');
    if (!scroll) return;
    let banner = document.getElementById('networkPendingBanner');
    const pending = state.network?.pending;
    clearInterval(state.pendingTimer);
    if (!pending) { banner?.remove(); return; }
    if (!banner) { banner = h('div', { class: 'pending-banner', id: 'networkPendingBanner', role: 'alert' }); scroll.prepend(banner); }
    const update = () => {
      const seconds = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
      banner.replaceChildren(
        h('div', {}, h('strong', { text: t('access.pendingTitle') }), h('small', { text: t('access.pendingCopy', { seconds }) })),
        h('button', { class: 'secondary-button', type: 'button', text: t('access.revert'), onclick: () => void revertChange() }),
        h('button', { class: 'primary-button', type: 'button', text: t('access.keep'), onclick: () => void confirmChange() }),
      );
      if (seconds <= 0) { clearInterval(state.pendingTimer); setTimeout(() => void loadNetwork().then(() => render({ background: true })).catch(() => {}), 1500); }
    };
    update();
    state.pendingTimer = setInterval(update, 1000);
  }

  async function confirmChange() {
    try { state.network = await call('/api/settings/network/confirm', {}); state.dirty = false; state.draft = structuredClone(state.network.config); } catch (error) { window.alert(error.message); }
    renderPendingBanner();
    render();
  }
  async function revertChange() {
    try { await call('/api/settings/network/revert', {}); } catch (error) { window.alert(error.message); }
    setTimeout(() => void loadNetwork().then(() => { state.dirty = false; state.draft = structuredClone(state.network.config); render(); }).catch(() => showUnreachable(null)), 1500);
  }

  // After saving: the address in use may be gone. Show where to go instead.
  function showUnreachable(urls) {
    const view = document.getElementById('accessView');
    if (!view) return;
    view.replaceChildren(h('section', { class: 'settings-card settings-card-wide access-moved' },
      h('h2', { text: t('access.movedTitle') }),
      h('p', { class: 'modal-copy', text: t('access.movedCopy') }),
      urls?.length ? h('ul', { class: 'access-url-list' }, urls.flatMap((item) => item.urls).map((url) => h('li', {}, h('a', { href: url, text: url })))) : null,
      h('button', { class: 'secondary-button', type: 'button', text: t('access.retry'), onclick: () => void refreshView() })));
  }

  async function saveNetwork() {
    const draft = state.draft;
    const password = await askPassword(t('access.saveTitle'), t('access.saveCopy'));
    if (password == null) return;
    const output = document.getElementById('accessSaveMessage');
    if (output) output.textContent = '';
    let result;
    try {
      result = await call('/api/settings/network', { password, config: draft });
    } catch (error) {
      if (output) output.textContent = error.message;
      return;
    }
    state.dirty = false;
    // Give the bridge a moment to swap listeners, then check whether this page can still reach it.
    setTimeout(async () => {
      try { await loadNetwork(); render(); } catch { showUnreachable(result.urls); }
    }, 1800);
  }

  // ----- access view ---------------------------------------------------------------------------------
  const card = (title, caption, ...content) => h('section', { class: 'settings-card settings-card-wide access-card' },
    h('div', { class: 'panel-header' }, h('div', {}, caption ? h('div', { class: 'section-overline', text: caption }) : null, h('h2', { text: title }))), ...content);

  function currentCard() {
    const current = state.network.current;
    const entry = state.network.config.entrypoints.find((item) => item.id === current.entryId);
    const rows = [
      [t('access.currentAddress'), current.host || '—'],
      [t('access.currentEntry'), entry ? `${entry.name || entry.id} · ${entry.https ? 'HTTPS' : 'HTTP'} · ${entry.bind}:${entry.port}` : '—'],
      [t('access.currentClient'), current.viaProxy ? t('access.viaProxy', { ip: current.clientIp, proxy: current.remoteAddress }) : current.clientIp],
      [t('access.currentSecure'), current.secure ? t('access.secureYes') : t('access.secureNo')],
    ];
    return card(t('access.currentTitle'), t('access.currentCaption'),
      h('dl', { class: 'access-facts' }, rows.map(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })])),
      current.secure ? null : h('p', { class: 'security-warning', text: t('access.insecureWarning') }));
  }

  function entryRow(entry, index) {
    const listener = state.network.listeners.find((item) => item.id === entry.id);
    const locked = state.network.locked;
    const update = (changes) => { Object.assign(entry, changes); state.dirty = true; render(); };
    const bindChoice = ['0.0.0.0', '127.0.0.1'].includes(entry.bind) ? entry.bind : 'custom';
    const statusText = !listener ? t('access.stateNew') : listener.state === 'listening' ? t('access.stateListening') : listener.error ? t('access.stateError', { error: listener.error }) : t('access.stateStopped');
    return h('div', { class: 'entry-row' },
      h('div', { class: 'entry-head' },
        h('input', { class: 'entry-name', value: entry.name, placeholder: t('access.entryName', { n: index + 1 }), maxlength: '40', disabled: locked, oninput: (event) => { entry.name = event.target.value; markDirty(); } }),
        h('span', { class: `entry-state ${listener?.state === 'listening' ? 'is-ok' : listener?.error ? 'is-error' : ''}`, text: statusText }),
        state.draft.entrypoints.length > 1 && !locked ? h('button', { class: 'icon-button', type: 'button', 'aria-label': t('access.remove'), title: t('access.remove'), onclick: () => { state.draft.entrypoints.splice(index, 1); state.dirty = true; render(); } }, h('span', { 'data-icon': 'trash', 'aria-hidden': 'true' })) : null),
      h('div', { class: 'entry-grid' },
        h('label', { class: 'host-field' }, h('span', { text: t('access.bind') }),
          h('select', { disabled: locked, onchange: (event) => update({ bind: event.target.value === 'custom' ? '' : event.target.value }) },
            h('option', { value: '0.0.0.0', text: t('access.bindAll'), selected: bindChoice === '0.0.0.0' }),
            h('option', { value: '127.0.0.1', text: t('access.bindLocal'), selected: bindChoice === '127.0.0.1' }),
            h('option', { value: 'custom', text: t('access.bindCustom'), selected: bindChoice === 'custom' }))),
        bindChoice === 'custom' ? h('label', { class: 'host-field' }, h('span', { text: t('access.bindAddress') }), h('div', { class: 'input-shell' }, h('input', { value: entry.bind, placeholder: state.network.machine.addresses[0] || '192.168.1.10', disabled: locked, oninput: (event) => { entry.bind = event.target.value.trim(); markDirty(); } }))) : null,
        h('label', { class: 'host-field' }, h('span', { text: t('access.port') }), h('div', { class: 'input-shell' }, h('input', { type: 'number', min: '1', max: '65535', value: String(entry.port), disabled: locked, oninput: (event) => { entry.port = Number(event.target.value); markDirty(); } })))),
      h('div', { class: 'setting-row' }, h('span', {}, h('strong', { text: t('access.https') }), h('small', { text: t('access.httpsHint') })),
        h('button', { class: `toggle${entry.https ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(entry.https), 'aria-label': t('access.https'), disabled: locked, onclick: () => update({ https: !entry.https }) }, h('span'))),
      h('div', { class: 'setting-row' }, h('span', {}, h('strong', { text: t('access.proxy') }), h('small', { text: t('access.proxyHint') })),
        h('button', { class: `toggle${entry.proxy.enabled ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(entry.proxy.enabled), 'aria-label': t('access.proxy'), disabled: locked, onclick: () => update({ proxy: { ...entry.proxy, enabled: !entry.proxy.enabled, trusted: entry.proxy.trusted.length ? entry.proxy.trusted : ['127.0.0.1', '::1'] } }) }, h('span'))),
      entry.proxy.enabled ? h('label', { class: 'host-field entry-proxy' }, h('span', { text: t('access.proxyTrusted') }),
        h('div', { class: 'input-shell' }, h('input', { value: entry.proxy.trusted.join(', '), placeholder: '127.0.0.1, 172.16.0.0/12', disabled: locked, oninput: (event) => { entry.proxy.trusted = event.target.value.split(/[,\s]+/).filter(Boolean); markDirty(); } })),
        h('small', { class: 'host-hint', text: t('access.proxyTrustedHint') })) : null,
      listener?.urls?.length && !entry.proxy.enabled ? h('p', { class: 'host-hint' }, t('access.urls'), ' ', listener.urls.map((url, i) => [i ? ' · ' : '', h('a', { href: url, text: url })])) : null);
  }

  function entrypointsCard() {
    const locked = state.network.locked;
    return card(t('access.entriesTitle'), t('access.entriesCaption'),
      h('p', { class: 'host-hint', text: t('access.entriesHint') }),
      locked ? h('p', { class: 'security-warning', text: t('access.locked') }) : null,
      h('div', { class: 'entry-list' }, state.draft.entrypoints.map(entryRow)),
      locked || state.draft.entrypoints.length >= 8 ? null : h('button', { class: 'secondary-button', type: 'button', onclick: () => {
        const used = new Set(state.draft.entrypoints.map((entry) => entry.port));
        let port = 8443; while (used.has(port)) port += 1;
        state.draft.entrypoints.push({ id: '', name: '', bind: '0.0.0.0', port, https: true, proxy: { enabled: false, trusted: [] } });
        state.dirty = true; render();
      } }, h('span', { 'data-icon': 'plus', 'aria-hidden': 'true' }), t('access.addEntry')));
  }

  function hostsCard() {
    const list = state.draft.allowedHosts;
    const current = state.network.current.host;
    const input = h('input', { placeholder: 'example.com, b.example.com:8443, *.example.net', onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } } });
    const add = (value = input.value) => {
      for (const item of String(value).split(/[,\s]+/).map((part) => part.trim().toLowerCase()).filter(Boolean)) if (!list.includes(item)) list.push(item);
      state.dirty = true; render();
    };
    // Same rule as the bridge (netconfig.mjs hostAllowed), roughly: loopback always works.
    const bare = current.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const currentListed = !list.length || ['localhost', '127.0.0.1', '::1'].includes(bare) || list.some((pattern) => pattern === current || pattern === bare
      || (pattern.startsWith('*.') && bare.endsWith(pattern.slice(1))));
    return card(t('access.hostsTitle'), t('access.hostsCaption'),
      h('p', { class: 'host-hint', text: t('access.hostsHint') }),
      list.length ? h('div', { class: 'chip-list' }, list.map((item, index) => h('span', { class: 'chip' }, item,
        state.network.locked ? null : h('button', { type: 'button', 'aria-label': t('access.remove'), onclick: () => { list.splice(index, 1); state.dirty = true; render(); } }, '×')))) : h('p', { class: 'chip-empty', text: t('access.hostsAny') }),
      h('div', { class: 'chip-add' }, h('div', { class: 'input-shell' }, input), h('button', { class: 'secondary-button', type: 'button', text: t('access.add'), onclick: () => add() })),
      !currentListed ? h('p', { class: 'security-warning' }, t('access.currentNotListed', { host: current }), ' ', h('button', { class: 'text-button', type: 'button', text: t('access.addCurrent'), onclick: () => add(current) })) : null);
  }

  // Typing changes the draft without re-rendering; just bring the save bar up to date.
  function markDirty() {
    state.dirty = true;
    const bar = document.querySelector('.access-save');
    if (!bar) return;
    bar.classList.add('is-dirty');
    const hint = bar.querySelector('.host-hint'); if (hint) hint.textContent = t('access.unsaved');
    bar.querySelectorAll('button').forEach((button) => { button.disabled = button.dataset.role === 'save' && Boolean(state.network?.pending); });
  }

  function saveBar() {
    if (state.network.locked) return null;
    return h('div', { class: `access-save ${state.dirty ? 'is-dirty' : ''}` },
      h('p', { class: 'security-message', id: 'accessSaveMessage' }),
      h('span', { class: 'host-hint', text: state.dirty ? t('access.unsaved') : t('access.saveHint') }),
      h('button', { class: 'secondary-button', type: 'button', 'data-role': 'discard', text: t('access.discard'), disabled: !state.dirty, onclick: () => { state.draft = structuredClone(state.network.config); state.dirty = false; render(); } }),
      h('button', { class: 'primary-button', type: 'button', 'data-role': 'save', text: t('access.save'), disabled: !state.dirty || Boolean(state.network.pending), onclick: () => void saveNetwork() }));
  }

  function certificatesCard() {
    const certs = state.certs;
    if (!certs) return card(t('access.certsTitle'), t('access.certsCaption'), h('p', { class: 'host-hint', text: t('sec.loading') }));
    const certInput = h('textarea', { rows: '4', placeholder: '-----BEGIN CERTIFICATE-----', spellcheck: 'false' });
    const keyInput = h('textarea', { rows: '4', placeholder: '-----BEGIN PRIVATE KEY-----', spellcheck: 'false' });
    const output = h('p', { class: 'security-message' });
    const fileLoader = (target) => h('input', { type: 'file', accept: '.pem,.crt,.cer,.key,.txt', onchange: async (event) => { const file = event.target.files?.[0]; if (file) target.value = await file.text(); } });
    const daysLeft = (iso) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
    const upload = async () => {
      output.textContent = '';
      const password = await askPassword(t('access.uploadTitle'), t('access.uploadCopy'));
      if (password == null) return;
      try { await call('/api/settings/certificates/upload', { password, cert: certInput.value, key: keyInput.value }); await loadCertificates(); render(); } catch (error) { output.textContent = error.message; }
    };
    const remove = async (id) => {
      const password = await askPassword(t('access.deleteTitle', { id }), t('access.deleteCopy'));
      if (password == null) return;
      try { await call('/api/settings/certificates/delete', { password, id }); await loadCertificates(); render(); } catch (error) { window.alert(error.message); }
    };
    const regenerate = async () => {
      const password = await askPassword(t('access.regenTitle'), t('access.regenCopy'));
      if (password == null) return;
      try { await call('/api/settings/certificates/self-signed/regenerate', { password }); await loadCertificates(); render(); } catch (error) { window.alert(error.message); }
    };
    return card(t('access.certsTitle'), t('access.certsCaption'),
      h('p', { class: 'host-hint', text: t('access.certsHint', { dir: certs.directory }) }),
      h('div', { class: 'cert-list' },
        certs.certificates.map((item) => {
          const days = daysLeft(item.validTo);
          return h('div', { class: 'cert-row' },
            h('div', {}, h('strong', { text: item.names.join(', ') }),
              h('small', { text: `${item.issuer} · ${t('access.expires', { date: fmtDate(item.validTo) })} · ${item.file}` }),
              days < 14 ? h('small', { class: 'is-warn', text: days < 0 ? t('access.expired') : t('access.expiresSoon', { days }) }) : null,
              item.incompleteChain ? h('small', { class: 'is-warn', text: t('access.incompleteChain') }) : null),
            item.removable ? h('button', { class: 'icon-button', type: 'button', 'aria-label': t('access.remove'), title: t('access.remove'), onclick: () => void remove(item.id) }, h('span', { 'data-icon': 'trash', 'aria-hidden': 'true' })) : null);
        }),
        h('div', { class: 'cert-row' },
          h('div', {}, h('strong', { text: t('access.selfSigned') }),
            h('small', { text: `${t('access.selfSignedHint')} · ${t('access.expires', { date: fmtDate(certs.selfSigned.validTo) })}` }),
            h('small', { text: certs.selfSigned.names.join(', ') })),
          h('div', { class: 'cert-actions' },
            h('a', { class: 'icon-button', href: '/api/settings/certificates/self-signed.crt', download: 'sunbridge-self-signed.crt', 'aria-label': t('access.download'), title: t('access.download') }, h('span', { 'data-icon': 'download', 'aria-hidden': 'true' })),
            h('button', { class: 'text-button subtle', type: 'button', text: t('access.regen'), onclick: () => void regenerate() })))),
      certs.problems.length ? h('ul', { class: 'cert-problems' }, certs.problems.map((item) => h('li', { text: `${item.file}：${item.error}` }))) : null,
      h('details', { class: 'cert-upload' }, h('summary', { text: t('access.uploadTitle') }),
        h('div', { class: 'cert-upload-grid' },
          h('label', { class: 'host-field' }, h('span', { text: t('access.certPem') }), certInput, fileLoader(certInput)),
          h('label', { class: 'host-field' }, h('span', { text: t('access.keyPem') }), keyInput, fileLoader(keyInput))),
        h('button', { class: 'primary-button', type: 'button', text: t('access.upload'), onclick: () => void upload() }), output));
  }

  function nginxCard() {
    const proxies = state.network.config.entrypoints.filter((entry) => entry.proxy.enabled);
    if (!proxies.length) return null;
    const select = h('select', {}, proxies.map((entry) => h('option', { value: entry.id, text: `${entry.name || entry.id} (${entry.bind}:${entry.port})` })));
    const domains = h('input', { value: state.network.config.allowedHosts.filter((item) => !/^\d+\.\d+\.\d+\.\d+/.test(item)).map((item) => item.replace(/:\d+$/, '')).join(', '), placeholder: 'a.example.com, b.example.com' });
    const port = h('input', { type: 'number', value: '443', min: '1', max: '65535' });
    const output = h('textarea', { class: 'nginx-output', rows: '12', readonly: true, spellcheck: 'false', value: state.nginx });
    const generate = async () => {
      try {
        const result = await call('/api/settings/nginx', { entryId: select.value, domains: domains.value.split(/[,\s]+/).filter(Boolean), publicPort: Number(port.value) || 443 });
        state.nginx = result.text; output.value = result.text;
      } catch (error) { output.value = error.message; }
    };
    return card(t('access.nginxTitle'), t('access.nginxCaption'),
      h('p', { class: 'host-hint', text: t('access.nginxHint') }),
      h('div', { class: 'entry-grid' },
        h('label', { class: 'host-field' }, h('span', { text: t('access.nginxEntry') }), select),
        h('label', { class: 'host-field' }, h('span', { text: t('access.nginxDomains') }), h('div', { class: 'input-shell' }, domains)),
        h('label', { class: 'host-field' }, h('span', { text: t('access.nginxPort') }), h('div', { class: 'input-shell' }, port))),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'secondary-button', type: 'button', text: t('access.copy'), onclick: async () => { try { await navigator.clipboard.writeText(output.value); } catch { output.select(); } } }),
        h('button', { class: 'primary-button', type: 'button', text: t('access.generate'), onclick: () => void generate() })),
      output);
  }

  // ----- WebRTC --------------------------------------------------------------------------------------
  function webrtcCard() {
    const info = state.network.webrtc;
    if (!info) return null;
    const enabled = h('input', { type: 'checkbox', checked: info.settings.enabled });
    const port = h('input', { type: 'number', min: '1', max: '65535', value: info.settings.port || '', placeholder: String(info.target.udpPort) });
    const address = h('input', { value: info.settings.publicAddress || '', placeholder: t('access.webrtcAddressAuto', { value: info.target.host ? `${info.target.host}:${info.target.port}` : '—' }), spellcheck: 'false' });
    const output = h('p', { class: 'security-message', role: 'status' });
    const status = info.support.available
      ? t('access.webrtcReady', { host: info.target.host || '—', port: info.target.port, udp: info.target.udpPort })
      : t('stats.webrtcReason.' + info.support.reason);
    const save = async () => {
      const password = await askPassword(t('access.webrtcTitle'), t('access.webrtcSaveCopy'));
      if (password == null) return;
      try {
        const result = await call('/api/settings/webrtc', { password, webrtc: { enabled: enabled.checked, port: port.value ? Number(port.value) : null, publicAddress: address.value.trim() || null } });
        state.network = { ...state.network, ...result };
        render();
      } catch (error) { output.textContent = error.message; }
    };
    return card(t('access.webrtcTitle'), t('access.webrtcCaption'),
      h('p', { class: 'host-hint', text: t('access.webrtcHint') }),
      h('p', { class: info.support.available ? 'host-hint' : 'security-warning', text: status }),
      h('label', { class: 'host-field access-checkbox' }, enabled, h('span', { text: t('access.webrtcEnabled') })),
      h('div', { class: 'entry-grid' },
        h('label', { class: 'host-field' }, h('span', { text: t('access.webrtcPort') }), h('div', { class: 'input-shell' }, port)),
        h('label', { class: 'host-field' }, h('span', { text: t('access.webrtcAddress') }), h('div', { class: 'input-shell' }, address))),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'primary-button', type: 'button', text: t('access.save'), onclick: () => void save() })),
      output);
  }

  // ----- Settings → Sunbridge service: version, updates, restart (update.mjs) --------------------------
  // Restarting (or updating, which restarts) keeps the stream on the host running; this page reloads once the
  // bridge answers again.
  function reloadWhenBack(output, message) {
    output.textContent = message;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const response = await fetch('/api/auth/status', { cache: 'no-store' });
        if (response.ok) { window.location.reload(); return; }
      } catch { /* still down */ }
      if (Date.now() - startedAt > 90000) { output.textContent = t('access.restartSlow'); return; }
      setTimeout(poll, 1000);
    };
    // Give the old process time to close its ports first.
    setTimeout(poll, 2500);
  }

  async function restartBridge(output) {
    const password = await askPassword(t('access.restartTitle'), t('access.restartCopy'));
    if (password == null) return;
    output.textContent = '';
    try { await call('/api/settings/restart', { password }); } catch (error) { output.textContent = error.message; return; }
    reloadWhenBack(output, t('access.restarting'));
  }

  async function applyUpdate(output) {
    const password = await askPassword(t('service.updateTitle'), t('service.updateCopy'));
    if (password == null) return;
    output.textContent = t('service.updating');
    try {
      const result = await call('/api/settings/update', { password });
      reloadWhenBack(output, t(result.dependencies ? 'service.updatedDeps' : 'service.updated'));
    } catch (error) {
      output.textContent = error.message;
    }
  }

  const CHECK_EVERY_MS = 6 * 3600 * 1000;
  const short = (hash) => String(hash || '').slice(0, 7);

  async function checkUpdates({ quiet = false } = {}) {
    state.updateChecking = true;
    state.updateError = '';
    renderService();
    try { state.update = await call('/api/settings/update?check=1'); } catch (error) { if (!quiet) state.updateError = error.message; }
    state.updateChecking = false;
    renderService();
  }

  async function refreshService() {
    if (isDemo()) { document.getElementById('serviceView')?.replaceChildren(); return; }
    try { state.update = await call('/api/settings/update'); } catch (error) { state.updateError = error.message; }
    renderService();
    const last = Date.parse(state.update?.checkedAt || '') || 0;
    if (state.update && !state.updateChecking && Date.now() - last > CHECK_EVERY_MS) void checkUpdates({ quiet: true });
  }

  function updateSummary(info) {
    if (!info.checkedAt) return { text: t('service.notChecked') };
    const count = info.behind;
    switch (info.state) {
      case 'up-to-date': return { text: t('service.upToDate'), tone: 'ok' };
      case 'ahead': return { text: t('service.ahead', { count: info.ahead }), tone: 'ok' };
      case 'available': return { text: t('service.available', { count }), tone: 'new' };
      case 'dirty': return { text: t('service.dirty', { count, files: info.changedFiles.slice(0, 3).join(', ') }), tone: 'warn' };
      case 'diverged': return { text: t('service.diverged', { count, ahead: info.ahead }), tone: 'warn' };
      case 'no-upstream': return { text: t('service.noUpstream', { branch: info.branch }), tone: 'warn' };
      case 'manual': return { text: t('service.manual', { date: fmtDate(info.commits[0]?.date), subject: info.commits[0]?.subject || '' }), tone: 'warn' };
      default: return { text: '' };
    }
  }

  function renderService() {
    const view = document.getElementById('serviceView');
    if (!view) return;
    const info = state.update;
    const output = h('p', { class: 'security-message', role: 'status' });
    const installed = !info ? '' : info.kind === 'git'
      ? t('service.versionGit', { version: info.version, commit: short(info.commit?.hash), date: fmtDate(info.commit?.date), branch: info.branch })
      : t('service.versionArchive', { version: info.version });
    const summary = info ? updateSummary(info) : { text: '' };
    const commits = info?.state === 'available' || info?.state === 'dirty' || info?.state === 'diverged' ? info.commits : [];
    const canUpdate = info?.state === 'available';
    // Two rows like the other settings cards: version and updates, then restart.
    const updateRow = h('div', { class: 'setting-row service-row' },
      h('span', {},
        h('strong', { text: installed }),
        summary.text ? h('small', { class: summary.tone === 'warn' ? 'service-warn' : summary.tone === 'new' ? 'service-new' : null, text: summary.text }) : null,
        info?.checkedAt ? h('small', { text: t('service.checkedAt', { time: fmtTime(info.checkedAt) }) }) : null,
        state.updateError ? h('small', { class: 'service-warn', text: state.updateError }) : null,
        commits.length ? h('ul', { class: 'update-commits' }, commits.map((commit) => h('li', {}, h('code', { text: short(commit.hash) }), h('span', { text: commit.subject }), h('small', { text: fmtDate(commit.date) })))) : null,
        info?.state === 'manual' ? h('small', {}, h('a', { href: info.download, target: '_blank', rel: 'noopener', text: t('service.download') }), ' · ', h('a', { href: info.repository, target: '_blank', rel: 'noopener', text: 'GitHub' })) : null),
      h('div', { class: 'service-actions' },
        h('button', { class: 'secondary-button', type: 'button', disabled: state.updateChecking || !info, text: t(state.updateChecking ? 'service.checking' : 'service.check'), onclick: () => void checkUpdates() }),
        canUpdate ? h('button', { class: 'primary-button', type: 'button', text: t('service.update'), onclick: () => void applyUpdate(output) }) : null));
    const restartRow = h('div', { class: 'setting-row service-row' },
      h('span', {}, h('strong', { text: t('access.restart') }), h('small', { text: t('access.restartHint') })),
      h('div', { class: 'service-actions' }, h('button', { class: 'secondary-button', type: 'button', text: t('access.restart'), onclick: () => void restartBridge(output) })));
    view.replaceChildren(h('div', { class: 'settings-layout' }, card(t('service.title'), t('service.caption'), updateRow, restartRow, output)));
    icons(view);
  }

  // background: a refresh nobody asked for; skipped while the user is typing in the form.
  function render({ background = false } = {}) {
    const view = document.getElementById('accessView');
    if (!view || !state.network) return;
    if (background && state.typing) return;
    view.replaceChildren(h('div', { class: 'settings-layout' }, currentCard(), entrypointsCard(), hostsCard(), saveBar(), certificatesCard(), nginxCard(), webrtcCard()));
    icons(view);
  }

  async function refreshView() {
    if (isDemo()) { document.getElementById('accessView')?.replaceChildren(h('p', { class: 'host-hint', text: t('access.demo') })); return; }
    try { await Promise.all([loadNetwork(), loadCertificates()]); render(); } catch (error) {
      document.getElementById('accessView')?.replaceChildren(h('p', { class: 'security-warning', text: error.message }));
    }
  }

  // ----- logs view -----------------------------------------------------------------------------------
  const CATEGORIES = ['', 'access', 'auth', 'settings', 'stream', 'system'];
  async function loadLogs() {
    const params = new URLSearchParams({ limit: '500' });
    if (state.logFilter.category) params.set('category', state.logFilter.category);
    if (state.logFilter.warnOnly) params.set('level', 'warn');
    state.logs = (await call(`/api/logs?${params}`)).entries;
  }

  function renderLogs() {
    const view = document.getElementById('logsView');
    if (!view) return;
    const filters = h('div', { class: 'logs-toolbar' },
      h('div', { class: 'segmented', role: 'group' }, CATEGORIES.map((category) => h('button', {
        type: 'button', 'aria-pressed': String(state.logFilter.category === category), text: t(`logs.cat.${category || 'all'}`),
        onclick: () => { state.logFilter.category = category; void refreshLogs(); },
      }))),
      h('label', { class: 'logs-warn-only' }, h('input', { type: 'checkbox', checked: state.logFilter.warnOnly, onchange: (event) => { state.logFilter.warnOnly = event.target.checked; void refreshLogs(); } }), t('logs.warnOnly')),
      h('button', { class: 'secondary-button', type: 'button', text: t('logs.refresh'), onclick: () => void refreshLogs() }));
    const rows = state.logs.map((entry) => h('div', { class: `log-row is-${entry.level}` },
      h('time', { text: fmtTime(entry.time), datetime: entry.time }),
      h('span', { class: 'log-badge', text: t(`logs.cat.${entry.category}`) }),
      h('div', { class: 'log-text' },
        h('span', { text: entry.message + (entry.repeat ? ` ${t('logs.repeat', { count: entry.repeat })}` : '') }),
        [entry.ip, entry.host, entry.entry].some(Boolean) ? h('small', { text: [entry.ip && `IP ${entry.ip}`, entry.host && `${t('logs.host')} ${entry.host}`, entry.entry && `${t('logs.entry')} ${entry.entry}`].filter(Boolean).join(' · ') }) : null)));
    view.replaceChildren(filters, h('section', { class: 'settings-card settings-card-wide log-list' }, rows.length ? rows : h('p', { class: 'chip-empty', text: t('logs.empty') })));
  }

  async function refreshLogs() {
    if (isDemo()) { document.getElementById('logsView')?.replaceChildren(h('p', { class: 'host-hint', text: t('access.demo') })); return; }
    try { await loadLogs(); } catch (error) { state.logs = [{ time: new Date().toISOString(), level: 'error', category: 'system', message: error.message }]; }
    renderLogs();
  }

  // ----- wiring --------------------------------------------------------------------------------------
  let currentView = 'overview';
  window.addEventListener('sunbridge:view', (event) => {
    currentView = event.detail.view;
    clearInterval(state.logTimer);
    if (currentView === 'access') void refreshView();
    if (currentView === 'settings') void refreshService();
    if (currentView === 'logs') {
      void refreshLogs();
      state.logTimer = setInterval(() => { if (!document.hidden) void refreshLogs(); }, 10000);
    }
  });
  // Typing in a field must not be interrupted by a re-render.
  document.addEventListener('focusin', (event) => { state.typing = Boolean(event.target.closest?.('#accessView')); });
  document.addEventListener('focusout', () => { state.typing = false; });
  window.addEventListener('sunbridge:locale', () => { if (currentView === 'access') render({ background: true }); if (currentView === 'logs') renderLogs(); if (currentView === 'settings') renderService(); renderPendingBanner(); });
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

  // A change may be pending from another tab or address: check once on load.
  const init = () => { if (!isDemo()) void loadNetwork().catch(() => {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();

// Two-step verification in the web client: the card in Settings (enable / disable, where codes are asked
// for, recovery codes), the setup flow with a QR code, and the code prompt. app.js calls
// SunbridgeSecurity.ensure('stream' | 'resume', streamId) before starting or attaching to a stream; the
// bridge enforces the same rules on its side (auth.mjs), this only asks up front.
(function () {
  'use strict';
  const t = (key, params) => (window.t ? window.t(key, params) : key);
  const PURPOSES = ['login', 'stream', 'resume'];
  const state = { status: null, root: null, panel: null, pending: null, busy: false };

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
  };
  const icons = () => window.SunbridgeIcons?.hydrate?.(state.root);

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
      error.retryAfterMs = payload.retryAfterMs || null;
      throw error;
    }
    return payload;
  }

  const errorText = (error) => {
    const key = `sec.error.${error?.errorCode}`;
    const text = t(key, { seconds: Math.ceil((error?.retryAfterMs || 60000) / 1000) });
    return text !== key ? text : (error?.message || t('common.unknown'));
  };

  const isDemo = () => Boolean(window.sunbridgeClient?.isDemo);

  async function refresh() {
    if (isDemo()) return null;
    try { state.status = await call('/api/auth/2fa'); } catch { /* keep the last known state */ }
    renderCard();
    return state.status;
  }

  // ----- modal -----
  function modal() {
    if (!state.root) {
      state.panel = h('section', { class: 'modal-panel security-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'security-title' });
      state.root = h('div', { class: 'modal-backdrop security-modal', hidden: true }, state.panel);
      state.root.addEventListener('mousedown', (event) => { if (event.target === state.root && !state.busy) close(false); });
    }
    // In fullscreen only the fullscreen element is rendered: open inside it.
    const parent = document.fullscreenElement || document.body;
    if (state.root.parentNode !== parent) parent.appendChild(state.root);
    return state.panel;
  }

  function show(content) {
    const panel = modal();
    panel.replaceChildren(
      h('button', { class: 'modal-close icon-button', type: 'button', 'aria-label': t('sec.close'), onclick: () => close(false) }, h('span', { 'data-icon': 'x', 'aria-hidden': 'true' })),
      ...content.flat().filter(Boolean),
    );
    state.root.hidden = false;
    icons();
    window.setTimeout(() => panel.querySelector('input')?.focus(), 40);
  }

  function close(result) {
    if (state.root) state.root.hidden = true;
    const pending = state.pending;
    state.pending = null;
    state.busy = false;
    pending?.(result);
  }

  const header = (eyebrow, title, copy) => [
    h('div', { class: 'modal-eyebrow' }, h('span', { class: 'live-dot' }), ` ${eyebrow}`),
    h('h2', { id: 'security-title', text: title }),
    copy ? h('p', { class: 'modal-copy', text: copy }) : null,
  ];
  const field = (label, input) => h('label', {}, h('span', { text: label }), h('div', { class: 'input-shell' }, h('span', { 'data-icon': 'key', 'aria-hidden': 'true' }), input));
  const message = () => h('p', { class: 'security-message', role: 'alert', 'aria-live': 'polite' });
  const submitButton = (label) => h('button', { class: 'primary-button full-width', type: 'submit' }, h('span', { text: label }));

  // A code field that accepts a 6-digit TOTP code or (after the switch) a recovery code.
  function codeField({ allowRecovery = true, onComplete } = {}) {
    let recovery = false;
    const input = h('input', { class: 'security-code', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '123456', required: true });
    const label = h('span', { text: t('sec.code') });
    const toggle = allowRecovery ? h('button', { class: 'text-button subtle', type: 'button', text: t('sec.useRecovery') }) : null;
    toggle?.addEventListener('click', () => {
      recovery = !recovery;
      input.value = '';
      input.maxLength = recovery ? 11 : 6;
      input.inputMode = recovery ? 'text' : 'numeric';
      input.placeholder = recovery ? 'abcde-fghij' : '123456';
      label.textContent = recovery ? t('sec.recoveryCode') : t('sec.code');
      toggle.textContent = recovery ? t('sec.useApp') : t('sec.useRecovery');
      input.focus();
    });
    input.addEventListener('input', () => { if (!recovery && /^\d{6}$/.test(input.value)) onComplete?.(); });
    const node = h('div', { class: 'security-code-field' }, h('label', {}, label, h('div', { class: 'input-shell' }, h('span', { 'data-icon': 'key', 'aria-hidden': 'true' }), input)), toggle);
    return { node, input };
  }

  // Runs `action` from a form submit with the button disabled and errors shown in `output`.
  function bindForm(form, output, action) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) return;
      state.busy = true;
      output.textContent = '';
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      try {
        await action();
      } catch (error) {
        output.textContent = errorText(error);
        form.querySelector('input.security-code')?.select?.();
      } finally {
        state.busy = false;
        if (button) button.disabled = false;
      }
    });
  }

  // ----- code prompt (step-up) -----
  function prompt(purpose) {
    if (state.pending) close(false);
    return new Promise((resolve) => {
      const output = message();
      const form = h('form', { class: 'pair-form security-form' });
      const code = codeField({ onComplete: () => form.requestSubmit() });
      form.append(code.node, h('div', { class: 'pair-note' }, h('span', { 'data-icon': 'shield', 'aria-hidden': 'true' }), h('span', { text: t('sec.promptNote') })), submitButton(t('sec.verify')), output);
      bindForm(form, output, async () => {
        const result = await call('/api/auth/2fa/verify', { code: code.input.value });
        state.status = result;
        renderCard();
        if (result.method === 'recovery') window.alert(t('sec.recoveryUsed', { count: result.recoveryRemaining }));
        close(true);
      });
      show([...header(t('sec.eyebrow'), t(`sec.prompt.${purpose}`), t(`sec.prompt.${purpose}Copy`)), form]);
      state.pending = resolve;
    });
  }

  // Resolves true when `purpose` may go ahead (nothing needed, or a code was entered), false if cancelled.
  async function ensure(purpose, streamId = null) {
    if (isDemo()) return true;
    let required = false;
    try {
      required = (await call('/api/auth/2fa/check', { purpose, sessionId: streamId })).required;
    } catch {
      return true; // let the real request fail with its own error
    }
    return required ? prompt(purpose) : true;
  }

  // Runs a settings change; when the bridge wants a fresh code, asks for one and retries.
  async function withCode(request) {
    try {
      return await request();
    } catch (error) {
      if (error?.errorCode !== 'AUTH_2FA_REQUIRED') throw error;
      if (!(await prompt('settings'))) return null;
      return request();
    }
  }

  // ----- setup -----
  function startSetup() {
    const output = message();
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: '1024' });
    const form = h('form', { class: 'pair-form security-form' }, field(t('sec.password'), password), submitButton(t('sec.next')), output);
    bindForm(form, output, async () => {
      const setup = await call('/api/auth/2fa/setup', { password: password.value });
      showScan(setup);
    });
    show([...header(t('sec.eyebrow'), t('sec.setupTitle'), t('sec.setupCopy')), form]);
  }

  function showScan(setup) {
    const output = message();
    const form = h('form', { class: 'pair-form security-form' });
    const code = codeField({ allowRecovery: false, onComplete: () => form.requestSubmit() });
    const grouped = setup.secret.match(/.{1,4}/g).join(' ');
    let qr = null;
    try { qr = window.SunbridgeQr.svg(setup.uri); } catch { /* the key below still works */ }
    const copy = h('button', { class: 'text-button subtle', type: 'button', text: t('sec.copyKey') });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(setup.secret); copy.textContent = t('sec.copied'); } catch { copy.textContent = t('sec.copyFailed'); }
    });
    form.append(
      h('div', { class: 'security-scan' },
        qr ? h('div', { class: 'security-qr', role: 'img', 'aria-label': t('sec.qrLabel') }, qr) : null,
        h('div', { class: 'security-key' },
          h('ol', { class: 'security-steps' }, h('li', { text: t('sec.step1') }), h('li', { text: t('sec.step2') }), h('li', { text: t('sec.step3') })),
          h('small', { text: t('sec.manualKey') }),
          h('code', { text: grouped }),
          h('div', { class: 'security-key-actions' }, copy, h('a', { class: 'text-button subtle', href: setup.uri, text: t('sec.openApp') })))),
      code.node,
      submitButton(t('sec.enable')),
      output,
    );
    bindForm(form, output, async () => {
      const result = await call('/api/auth/2fa/enable', { code: code.input.value });
      state.status = result;
      renderCard();
      showRecoveryCodes(result.recoveryCodes, true);
    });
    show([...header(t('sec.eyebrow'), t('sec.scanTitle'), t('sec.scanCopy')), form]);
  }

  function showRecoveryCodes(codes, justEnabled) {
    const text = `Sunbridge ${t('sec.recoveryTitle')}\n${new Date().toLocaleString()}\n\n${codes.join('\n')}\n`;
    const copy = h('button', { class: 'secondary-button', type: 'button', text: t('sec.copy') });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = t('sec.copied'); } catch { copy.textContent = t('sec.copyFailed'); }
    });
    const download = h('button', { class: 'secondary-button', type: 'button', text: t('sec.download') });
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const link = h('a', { href: url, download: 'sunbridge-recovery-codes.txt' });
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    show([
      ...header(t('sec.eyebrow'), justEnabled ? t('sec.enabledTitle') : t('sec.recoveryTitle'), t('sec.recoveryCopy')),
      h('ul', { class: 'security-recovery' }, codes.map((code) => h('li', {}, h('code', { text: code })))),
      h('div', { class: 'security-actions' }, copy, download),
      justEnabled ? h('p', { class: 'modal-copy', text: t('sec.othersSignedOut') }) : null,
      h('button', { class: 'primary-button full-width security-done', type: 'button', text: t('sec.saved'), onclick: () => close(true) }),
    ]);
  }

  function startDisable() {
    const output = message();
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: '1024' });
    const form = h('form', { class: 'pair-form security-form' });
    const code = codeField();
    form.append(field(t('sec.password'), password), code.node, h('button', { class: 'primary-button full-width security-danger', type: 'submit' }, h('span', { text: t('sec.disable') })), output);
    bindForm(form, output, async () => {
      state.status = await call('/api/auth/2fa/disable', { password: password.value, code: code.input.value });
      renderCard();
      close(true);
    });
    show([...header(t('sec.eyebrow'), t('sec.disableTitle'), t('sec.disableCopy')), form]);
  }

  async function regenerateRecovery() {
    if (!window.confirm(t('sec.regenConfirm'))) return;
    try {
      const result = await withCode(() => call('/api/auth/2fa/recovery-codes', {}));
      if (!result) return;
      state.status = result;
      renderCard();
      showRecoveryCodes(result.recoveryCodes, false);
    } catch (error) {
      window.alert(errorText(error));
    }
  }

  async function setPolicy(purpose, value) {
    const policy = { ...(state.status?.policy || {}), [purpose]: value };
    try {
      const result = await withCode(() => call('/api/auth/2fa/policy', { policy }));
      if (result) state.status = result;
    } catch (error) {
      window.alert(errorText(error));
    }
    renderCard();
  }

  // ----- settings card -----
  function renderCard() {
    const layout = document.querySelector('[data-view="settings"] .settings-layout');
    if (!layout || isDemo()) return;
    let card = document.getElementById('securityCard');
    if (!card) {
      card = h('section', { class: 'settings-card settings-card-wide security-card', id: 'securityCard' });
      layout.append(card);
    }
    const status = state.status;
    const enabled = Boolean(status?.enabled);
    const toggle = (purpose) => {
      const on = Boolean(status?.policy?.[purpose]);
      return h('button', {
        class: `toggle${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': t(`sec.policy.${purpose}`), 'data-security-policy': purpose,
        onclick: () => void setPolicy(purpose, !on),
      }, h('span'));
    };
    const row = (title, hint, control) => h('div', { class: 'setting-row' }, h('span', {}, h('strong', { text: title }), h('small', { text: hint })), control);
    card.replaceChildren(...[
      h('div', { class: 'panel-header' }, h('div', {}, h('div', { class: 'section-overline', text: t('sec.overline') }), h('h2', { text: t('sec.title') })), h('span', { class: 'settings-card-index', text: '03' })),
      row(
        enabled ? t('sec.statusOn') : t('sec.statusOff'),
        !status ? t('sec.loading') : enabled ? t('sec.statusOnHint', { count: status.recoveryRemaining }) : t('sec.statusOffHint'),
        status ? h('button', { class: enabled ? 'secondary-button' : 'primary-button', type: 'button', text: enabled ? t('sec.disable') : t('sec.enable'), onclick: enabled ? startDisable : startSetup }) : null,
      ),
      enabled ? PURPOSES.map((purpose) => row(t(`sec.policy.${purpose}`), t(`sec.policy.${purpose}Hint`), toggle(purpose))) : null,
      enabled && PURPOSES.every((purpose) => !status.policy?.[purpose]) ? h('p', { class: 'security-warning', text: t('sec.noPolicy') }) : null,
      enabled ? row(t('sec.recoveryTitle'), t('sec.recoveryHint', { count: status.recoveryRemaining }), h('button', { class: 'secondary-button', type: 'button', text: t('sec.regenerate'), onclick: () => void regenerateRecovery() })) : null,
    ].flat().filter(Boolean));
  }

  // Keys typed into the dialog must not reach the stream's input capture or the page shortcuts (Esc ends a stream).
  const guardKeys = (event) => {
    if (!state.root || state.root.hidden) return;
    if (event.type === 'keydown' && event.key === 'Escape') { event.preventDefault(); if (!state.busy) close(false); }
    event.stopPropagation();
  };
  window.addEventListener('keydown', guardKeys, true);
  window.addEventListener('keyup', guardKeys, true);
  window.addEventListener('sunbridge:locale', renderCard);

  const init = () => { renderCard(); void refresh(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();

  window.SunbridgeSecurity = { ensure, refresh, prompt };
})();

// Touch controls for the stream page on phones and tablets, which have no hover (the fullscreen header only
// shows on hover) and no Ctrl / Alt / Win / Esc keys:
//   - a floating button, draggable to either edge, always on top of the stream (fullscreen included); a tap
//     opens a menu: soft keyboard, the floating PC keyboard / gamepad / mouse (floating.js), touch mode (direct / trackpad), pointer DPI, desktop / game controls, fullscreen;
//   - a key bar above the soft keyboard while it is open: Esc, Tab, latched Ctrl / Alt / Shift / Win, arrows
//     and a few more, sent through the input controller (pressKey / toggleModifier).
// Shown where the primary pointer is a finger, or once a finger touches the stream (a touchscreen laptop).
(function () {
  'use strict';

  const KEYS = [
    ['Escape', 'Esc'], ['Tab', 'Tab'],
    ['ControlLeft', 'Ctrl', true], ['AltLeft', 'Alt', true], ['ShiftLeft', 'Shift', true], ['MetaLeft', 'Win', true],
    ['ArrowLeft', '←'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowRight', '→'],
    ['Insert', 'Ins'], ['Delete', 'Del'], ['Home', 'Home'], ['End', 'End'], ['PageUp', 'PgUp'], ['PageDown', 'PgDn'],
    ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], ['F5', 'F5'], ['F11', 'F11'], ['F12', 'F12'],
  ];
  const POSITION_KEY = 'sunbridge.touchbar.position';
  const DRAG_SLOP_PX = 6;
  const EDGE_PX = 12;

  const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

  // options: overlay, keyboardInput (the soft keyboard's textarea), t (i18n), hydrateIcons, and
  // getState() -> { controlMode, touchMode, fullscreen, sticky }, plus the actions showKeyboard(),
  // setTouchMode(mode), toggleControlMode(), toggleFullscreen(), pressKey(code), toggleModifier(code).
  function createTouchBar(options) {
    const { overlay, keyboardInput, t, hydrateIcons = () => {}, getState } = options;
    const root = document.createElement('div');
    root.className = 'touchbar';
    root.innerHTML = '<button class="touchbar-fab" type="button" aria-haspopup="menu" aria-expanded="false"><span data-icon="more" aria-hidden="true"></span></button>'
      + '<div class="touchbar-menu" role="menu" hidden></div>';
    const keybar = document.createElement('div');
    keybar.className = 'touchbar-keys';
    keybar.hidden = true;
    keybar.innerHTML = KEYS.map(([code, label, latch]) => `<button type="button" data-key="${code}"${latch ? ' data-latch=""' : ''}>${label}</button>`).join('')
      + '<button type="button" data-key-action="hide" class="touchbar-keys-hide"><span data-icon="keyboard" aria-hidden="true"></span></button>';
    overlay.append(root, keybar);
    hydrateIcons(root);
    hydrateIcons(keybar);
    const fab = root.querySelector('.touchbar-fab');
    const menu = root.querySelector('.touchbar-menu');
    const listeners = [];
    const on = (target, type, handler, opts) => { target.addEventListener(type, handler, opts); listeners.push(() => target.removeEventListener(type, handler, opts)); };

    // ----- where it shows -----
    const coarse = window.matchMedia('(pointer: coarse)');
    let touched = false;
    const visible = () => coarse.matches || touched;
    on(overlay, 'pointerdown', (event) => { if (event.pointerType === 'touch' && !touched) { touched = true; render(); } }, true);
    on(coarse, 'change', () => render());

    // ----- position: an edge (left / right) and a height, as a fraction of the overlay -----
    let position = readJson(POSITION_KEY) || { side: 'right', y: 0.62 };
    const place = () => {
      const viewport = window.visualViewport;
      const keyboardOpen = document.activeElement === keyboardInput && viewport && viewport.height < window.innerHeight - 80;
      const height = keyboardOpen ? viewport.height : (overlay.clientHeight || window.innerHeight);
      const size = fab.offsetHeight || 48;
      const y = Math.max(EDGE_PX, Math.min(height - size - EDGE_PX, position.y * height));
      root.style.top = y + 'px';
      root.style.left = position.side === 'left' ? 'calc(' + EDGE_PX + 'px + env(safe-area-inset-left))' : '';
      root.style.right = position.side === 'right' ? 'calc(' + EDGE_PX + 'px + env(safe-area-inset-right))' : '';
      root.dataset.side = position.side;
      // The menu opens towards the middle of the screen, upwards in the lower half.
      root.dataset.vertical = y > height / 2 ? 'up' : 'down';
    };
    let drag = null;
    on(fab, 'pointerdown', (event) => {
      event.stopPropagation(); // not a touch on the stream
      fab.setPointerCapture?.(event.pointerId);
      const rect = root.getBoundingClientRect();
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, moved: false };
    });
    on(fab, 'pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_SLOP_PX) return;
      drag.moved = true;
      closeMenu();
      root.classList.add('is-dragging');
      root.style.right = '';
      root.style.left = (event.clientX - drag.offsetX) + 'px';
      root.style.top = (event.clientY - drag.offsetY) + 'px';
    });
    const endDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const moved = drag.moved;
      drag = null;
      root.classList.remove('is-dragging');
      // A tap toggles the menu here rather than on click: Chrome drops the click of a tap that comes right
      // after a swipe on the stream (it takes it for stopping the fling).
      if (!moved) { if (event.type === 'pointerup') toggleMenu(); return; }
      const bounds = overlay.getBoundingClientRect();
      const rect = root.getBoundingClientRect();
      position = { side: rect.left + rect.width / 2 < bounds.left + bounds.width / 2 ? 'left' : 'right', y: (rect.top - bounds.top) / (bounds.height || 1) };
      writeJson(POSITION_KEY, position);
      place();
    };
    on(fab, 'pointerup', endDrag);
    on(fab, 'pointercancel', endDrag);
    on(window, 'resize', () => { place(); if (!keybar.hidden) placeKeys(); });

    // ----- menu -----
    const item = (action, icon, label, extra = '') => `<button type="button" role="menuitem" data-touch-action="${action}"${extra}><span data-icon="${icon}" aria-hidden="true"></span><span>${label}</span></button>`;
    const renderMenu = () => {
      const state = getState();
      const desktop = state.controlMode === 'desktop';
      menu.innerHTML = item('keyboard', 'keyboard', t('touch.keyboard'))
        + '<div class="touchbar-floating" role="group" aria-label="' + t('touch.floating') + '"><span>' + t('touch.floating') + '</span><div>'
        + [['keyboard', 'keyboard', 'touch.pcKeyboard'], ['gamepad', 'gamepad', 'touch.gamepad'], ['mouse', 'mouse', 'touch.mouse']].map(([name, icon, label]) => '<button type="button" data-floating-toggle="' + name + '" aria-pressed="' + Boolean(floating?.isOpen(name)) + '"><span data-icon="' + icon + '" aria-hidden="true"></span><span>' + t(label) + '</span></button>').join('')
        + '</div></div>'
        + (desktop ? `<div class="touchbar-segment" role="group" aria-label="${t('touch.mode')}"><span>${t('touch.mode')}</span><div>`
          + `<button type="button" data-touch-mode="direct" aria-pressed="${state.touchMode !== 'trackpad'}">${t('touch.direct')}</button>`
          + `<button type="button" data-touch-mode="trackpad" aria-pressed="${state.touchMode === 'trackpad'}">${t('touch.trackpad')}</button></div></div>` : '')
        + item('control-mode', desktop ? 'gamepad' : 'mouse', t(desktop ? 'touch.toGame' : 'touch.toDesktop'))
        + (document.fullscreenEnabled ? item('fullscreen', state.fullscreen ? 'compress' : 'expand', t(state.fullscreen ? 'control.exitFullscreen' : 'touch.fullscreen')) : '')
        + `<label class="touchbar-dpi"><span>${t('touch.scale')} <strong>${state.videoZoom}%</strong></span><input type="range" min="50" max="150" step="5" value="${state.videoZoom}" data-touch-scale aria-label="${t('touch.scale')}"></label>`
        + (desktop ? `<label class="touchbar-dpi"><span>${t('touch.dpi')} <strong>${state.touchDpi}%</strong></span><input type="range" min="25" max="300" step="5" value="${state.touchDpi}" data-touch-dpi aria-label="${t('touch.dpi')}"></label><p class="touchbar-hint">${t(state.touchMode === 'trackpad' ? 'touch.trackpadHint' : 'touch.directHint')}</p>` : '');
      hydrateIcons(menu);
    };
    const openMenu = () => { renderMenu(); menu.hidden = false; fab.setAttribute('aria-expanded', 'true'); };
    const closeMenu = () => { menu.hidden = true; fab.setAttribute('aria-expanded', 'false'); };
    const toggleMenu = () => { if (menu.hidden) openMenu(); else closeMenu(); };
    // The floating keyboard, gamepad and mouse (floating.js). Opening one puts the soft keyboard away.
    const floating = window.SunbridgeFloating?.createFloatingControls({
      overlay, t, hydrateIcons, getState,
      pressKey: options.pressKey,
      toggleModifier: options.toggleModifier,
      gamepad: options.gamepad,
      mouseMove: options.mouseMove,
      mouseButton: options.mouseButton,
      mouseScroll: options.mouseScroll,
      onChange: () => { if (!menu.hidden) renderMenu(); options.onFloatingChange?.(); },
    }) || null;
    const togglePanel = (name) => {
      if (!floating) return;
      if (!floating.isOpen(name)) keyboardInput?.blur();
      floating.toggle(name);
    };
    // Pointer taps toggle in endDrag; this is Enter / Space on the focused button.
    on(fab, 'click', (event) => { if (event.detail === 0) toggleMenu(); });
    on(menu, 'pointerdown', (event) => event.stopPropagation());
    on(menu, 'input', (event) => {
      if (event.target.matches('[data-touch-dpi]')) {
        options.setTouchDpi?.(event.target.value);
        const value = event.target.closest('.touchbar-dpi')?.querySelector('strong');
        if (value) value.textContent = event.target.value + '%';
      }
      if (event.target.matches('[data-touch-scale]')) {
        options.setVideoZoom?.(event.target.value);
        const value = event.target.closest('.touchbar-dpi')?.querySelector('strong');
        if (value) value.textContent = event.target.value + '%';
      }
    });
    on(menu, 'click', (event) => {
      const panel = event.target.closest('[data-floating-toggle]')?.dataset.floatingToggle;
      if (panel) { closeMenu(); togglePanel(panel); return; }
      const mode = event.target.closest('[data-touch-mode]')?.dataset.touchMode;
      if (mode) { options.setTouchMode(mode); renderMenu(); return; }
      const action = event.target.closest('[data-touch-action]')?.dataset.touchAction;
      if (!action) return;
      closeMenu();
      // Synchronous in the tap: iOS only opens the keyboard for a focus() made during a user gesture.
      if (action === 'keyboard') options.showKeyboard();
      else if (action === 'control-mode') options.toggleControlMode();
      else if (action === 'fullscreen') void options.toggleFullscreen();
    });
    // A touch anywhere else closes the menu.
    on(document, 'pointerdown', (event) => { if (!menu.hidden && !root.contains(event.target)) closeMenu(); }, true);

    // ----- key bar, above the soft keyboard -----
    const placeKeys = () => {
      const viewport = window.visualViewport;
      // Keep the bar attached to the visible viewport. Using the layout viewport here leaves a gap above the
      // keyboard on mobile browsers that resize or pan the visual viewport independently.
      const bottom = viewport?.height || window.innerHeight;
      keybar.style.top = Math.max(0, bottom - keybar.offsetHeight) + 'px';
    };
    const keysOpen = () => document.activeElement === keyboardInput;
    const renderKeys = () => {
      keybar.hidden = !keysOpen();
      if (keybar.hidden) return;
      const sticky = new Set(getState().sticky || []);
      keybar.querySelectorAll('[data-latch]').forEach((button) => button.setAttribute('aria-pressed', String(sticky.has(button.dataset.key))));
      placeKeys();
    };
    // Keep the soft keyboard open: a tap on the bar must not move focus off the textarea.
    on(keybar, 'pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); });
    on(keybar, 'mousedown', (event) => event.preventDefault());
    on(keybar, 'click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.keyAction === 'hide') { keyboardInput.blur(); return; }
      if (button.dataset.latch !== undefined) options.toggleModifier(button.dataset.key);
      else options.pressKey(button.dataset.key);
      renderKeys();
    });
    if (keyboardInput) {
      on(keyboardInput, 'focus', () => { renderKeys(); place(); });
      on(keyboardInput, 'blur', () => { options.clearModifiers?.(); renderKeys(); place(); });
    }
    if (window.visualViewport) {
      on(window.visualViewport, 'resize', () => { place(); if (!keybar.hidden) placeKeys(); });
      on(window.visualViewport, 'scroll', () => { place(); if (!keybar.hidden) placeKeys(); });
    }

    function render() {
      root.hidden = !visible();
      if (!root.hidden) {
        place();
        fab.title = t('touch.menu');
        fab.setAttribute('aria-label', t('touch.menu'));
        if (!menu.hidden) renderMenu();
      } else {
        closeMenu();
      }
      renderKeys();
      floating?.render();
    }
    render();

    return {
      render,
      togglePanel,
      isPanelOpen: (name) => Boolean(floating?.isOpen(name)),
      destroy() {
        floating?.destroy();
        listeners.splice(0).forEach((off) => off());
        root.remove();
        keybar.remove();
      },
    };
  }

  window.SunbridgeTouchBar = { createTouchBar };
})();

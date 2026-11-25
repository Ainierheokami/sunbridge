// Floating controls over the stream: a PC keyboard, a gamepad and a mouse (touchpad, wheel and buttons), for
// devices that have none of them (phones, tablets) or for keys a desktop keyboard can't send to the host.
// Each is a panel dragged by its title bar. Where a panel was left is kept as a fraction of the room around it,
// so it stays on screen across rotations and window sizes.
(function () {
  'use strict';

  // The PC keyboard: a standard Windows layout measured in key units (u). The main block is 15u wide (each
  // row adds up to that); the navigation cluster sits 0.5u to its right. Right-hand modifiers latch the same
  // modifier as the left ones (the input controller latches by the left key).
  const pcKey = (code, label, width = 1, extra = {}) => ({ code, label, width, ...extra });
  const pcGap = (width) => ({ gap: true, width });
  const pcMod = (code, label, width, latch) => pcKey(code, label, width, { latch, className: 'pc-key-mod' });
  const pcChar = (code, label, shifted) => pcKey(code, label, 1, { shifted });
  const PC_MAIN_ROWS = [
    [pcKey('Escape', 'Esc'), pcGap(1), ...[1, 2, 3, 4].map((n) => pcKey('F' + n, 'F' + n)), pcGap(0.5),
      ...[5, 6, 7, 8].map((n) => pcKey('F' + n, 'F' + n)), pcGap(0.5), ...[9, 10, 11, 12].map((n) => pcKey('F' + n, 'F' + n))],
    [pcChar('Backquote', '`', '~'), ...'1234567890'.split('').map((digit, index) => pcChar('Digit' + digit, digit, '!@#$%^&*()'[index])),
      pcChar('Minus', '-', '_'), pcChar('Equal', '=', '+'), pcKey('Backspace', 'Backspace', 2, { short: 'Bksp', className: 'pc-key-mod' })],
    [pcKey('Tab', 'Tab', 1.5, { className: 'pc-key-mod' }), ...'QWERTYUIOP'.split('').map((letter) => pcKey('Key' + letter, letter)),
      pcChar('BracketLeft', '[', '{'), pcChar('BracketRight', ']', '}'), pcKey('Backslash', '\\', 1.5, { shifted: '|' })],
    [pcKey('CapsLock', 'Caps', 1.75, { className: 'pc-key-mod' }), ...'ASDFGHJKL'.split('').map((letter) => pcKey('Key' + letter, letter)),
      pcChar('Semicolon', ';', ':'), pcChar('Quote', "'", '"'), pcKey('Enter', 'Enter', 2.25, { className: 'pc-key-mod' })],
    [pcMod('ShiftLeft', 'Shift', 2.25, 'ShiftLeft'), ...'ZXCVBNM'.split('').map((letter) => pcKey('Key' + letter, letter)),
      pcChar('Comma', ',', '<'), pcChar('Period', '.', '>'), pcChar('Slash', '/', '?'), pcMod('ShiftRight', 'Shift', 2.75, 'ShiftLeft')],
    [pcMod('ControlLeft', 'Ctrl', 1.25, 'ControlLeft'), pcMod('MetaLeft', 'Win', 1.25, 'MetaLeft'), pcMod('AltLeft', 'Alt', 1.25, 'AltLeft'),
      pcKey('Space', '', 6.25, { name: 'Space' }), pcMod('AltRight', 'Alt', 1.25, 'AltLeft'), pcMod('MetaRight', 'Win', 1.25, 'MetaLeft'),
      pcKey('ContextMenu', '☰', 1.25, { name: 'Menu', className: 'pc-key-mod' }), pcMod('ControlRight', 'Ctrl', 1.25, 'ControlLeft')],
  ];
  // Navigation cluster: placed by grid area, so it can sit beside the main block or wrap under it (styles.css).
  const PC_NAV_KEYS = [
    ['PrintScreen', 'PrtSc', 'prt'], ['ScrollLock', 'ScrLk', 'scr'], ['Pause', 'Pause', 'pause'],
    ['Insert', 'Ins', 'ins'], ['Home', 'Home', 'home'], ['PageUp', 'PgUp', 'pgup'],
    ['Delete', 'Del', 'del'], ['End', 'End', 'end'], ['PageDown', 'PgDn', 'pgdn'],
    ['ArrowUp', '↑', 'up', 'Up'], ['ArrowLeft', '←', 'left', 'Left'], ['ArrowDown', '↓', 'down', 'Down'], ['ArrowRight', '→', 'right', 'Right'],
  ].map(([code, label, area, name]) => pcKey(code, label, 1, { area, name, className: 'pc-key-mod' }));
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const renderPcKey = (item, sticky) => {
    if (item.gap) return '<span class="pc-key-gap" style="grid-column: span ' + Math.round(item.width * 4) + '" aria-hidden="true"></span>';
    const place = item.area ? 'grid-area: ' + item.area : 'grid-column: span ' + Math.round(item.width * 4);
    const label = item.shifted
      ? '<span class="pc-key-shifted">' + escapeHtml(item.shifted) + '</span><span>' + escapeHtml(item.label) + '</span>'
      : item.short ? '<span class="pc-key-long">' + escapeHtml(item.label) + '</span><span class="pc-key-short" aria-hidden="true">' + escapeHtml(item.short) + '</span>'
      : escapeHtml(item.label);
    const code = item.latch || item.code;
    return '<button type="button" class="' + (item.className || '') + (item.shifted ? ' pc-key-dual' : '') + '" style="' + place + '"'
      + ' data-pc-key="' + code + '"' + (item.name ? ' aria-label="' + item.name + '"' : '')
      + (item.latch ? ' data-latch="" aria-pressed="' + sticky.has(code) + '"' : '') + '>' + label + '</button>';
  };

  // Gamepad buttons, as GameStream button flags (input.js sends them on unchanged).
  const PAD = {
    A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000, LB: 0x0100, RB: 0x0200, VIEW: 0x0020, MENU: 0x0010, GUIDE: 0x0400,
    LS: 0x0040, RS: 0x0080, UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  };
  const STICK_MAX = 32767;
  const STICK_DEADZONE = 0.06;
  const STICK_TAP_MS = 220; // a stick touched and let go without moving clicks it (L3 / R3)
  const TAP_SLOP_PX = 6;
  const TAP_MS = 280;
  const WHEEL_PX_PER_NOTCH = 28; // finger travel on the wheel strip for one 120-unit notch
  const MOUSE_SPEED = 1.6; // touchpad px -> host px, times the touch DPI setting
  const MARGIN_PX = 8;
  const POSITION_KEY = 'sunbridge.floating.';
  const DEFAULT_POSITION = { keyboard: { x: 0.5, y: 1 }, gamepad: { x: 0.5, y: 1 }, mouse: { x: 1, y: 1 } };
  const TITLE_KEY = { keyboard: 'touch.pcKeyboard', gamepad: 'touch.gamepad', mouse: 'touch.mouse' };

  const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };
  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch { /* not allowed */ } };

  // options: overlay, t, hydrateIcons, getState() -> { sticky, touchDpi }, pressKey(code), toggleModifier(code),
  // gamepad(state | null), mouseMove(dx, dy), mouseButton(button, down), mouseScroll(amount), onChange().
  function createFloatingControls(options) {
    const { overlay, t, hydrateIcons = () => {}, getState = () => ({}) } = options;
    const listeners = [];
    const on = (target, type, handler, opts) => { target.addEventListener(type, handler, opts); listeners.push(() => target.removeEventListener(type, handler, opts)); };
    const panels = new Map();

    const room = () => ({ width: overlay.clientWidth || window.innerWidth, height: overlay.clientHeight || window.innerHeight });
    const place = (panel) => {
      if (panel.el.hidden) return;
      const { width, height } = room();
      const freeX = Math.max(0, width - panel.el.offsetWidth - 2 * MARGIN_PX);
      const freeY = Math.max(0, height - panel.el.offsetHeight - 2 * MARGIN_PX);
      panel.el.style.left = Math.round(MARGIN_PX + freeX * panel.position.x) + 'px';
      panel.el.style.top = Math.round(MARGIN_PX + freeY * panel.position.y) + 'px';
    };
    // The panel last touched is in front of the others (still under the touch button, styles.css).
    const raise = (panel) => { for (const other of panels.values()) other.el.style.zIndex = other === panel ? '23' : ''; };

    const createPanel = (name, body) => {
      const el = document.createElement('section');
      el.className = 'floating-panel floating-' + name;
      el.hidden = true;
      el.innerHTML = '<header class="floating-head"><span class="floating-grip" aria-hidden="true"></span><strong></strong>'
        + '<button type="button" class="floating-close" data-floating-close><span data-icon="x" aria-hidden="true"></span></button></header>'
        + '<div class="floating-body">' + body + '</div>';
      overlay.append(el);
      hydrateIcons(el);
      const saved = readJson(POSITION_KEY + name);
      const panel = { name, el, body: el.querySelector('.floating-body'), position: saved ? { x: clamp01(saved.x), y: clamp01(saved.y) } : { ...DEFAULT_POSITION[name] } };
      panels.set(name, panel);
      // Nothing in a panel is a touch on the stream, takes focus or opens a context menu.
      on(el, 'pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); raise(panel); });
      on(el, 'contextmenu', (event) => event.preventDefault());
      on(el.querySelector('[data-floating-close]'), 'click', () => setOpen(name, false));
      // Dragged by the title bar.
      const head = el.querySelector('.floating-head');
      let drag = null;
      on(head, 'pointerdown', (event) => {
        if (event.target.closest('button') || drag) return;
        head.setPointerCapture?.(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX - el.offsetLeft, y: event.clientY - el.offsetTop };
        el.classList.add('is-dragging');
      });
      on(head, 'pointermove', (event) => {
        if (drag?.id !== event.pointerId) return;
        const { width, height } = room();
        const left = Math.max(MARGIN_PX, Math.min(width - el.offsetWidth - MARGIN_PX, event.clientX - drag.x));
        const top = Math.max(MARGIN_PX, Math.min(height - el.offsetHeight - MARGIN_PX, event.clientY - drag.y));
        el.style.left = left + 'px';
        el.style.top = top + 'px';
      });
      const endDrag = (event) => {
        if (drag?.id !== event.pointerId) return;
        drag = null;
        el.classList.remove('is-dragging');
        const { width, height } = room();
        const freeX = width - el.offsetWidth - 2 * MARGIN_PX;
        const freeY = height - el.offsetHeight - 2 * MARGIN_PX;
        panel.position = { x: freeX > 0 ? clamp01((el.offsetLeft - MARGIN_PX) / freeX) : 0.5, y: freeY > 0 ? clamp01((el.offsetTop - MARGIN_PX) / freeY) : 1 };
        writeJson(POSITION_KEY + name, panel.position);
        place(panel);
      };
      on(head, 'pointerup', endDrag);
      on(head, 'pointercancel', endDrag);
      return panel;
    };

    // ----- PC keyboard -----
    const keyboard = createPanel('keyboard', '<div class="touchbar-pc-keyboard-keys"><div class="pc-keyboard-main">'
      + PC_MAIN_ROWS.flat().map((item) => renderPcKey(item, new Set())).join('') + '</div>'
      + '<div class="pc-keyboard-nav">' + PC_NAV_KEYS.map((item) => renderPcKey(item, new Set())).join('') + '</div></div>');
    const syncSticky = () => {
      const sticky = new Set(getState().sticky || []);
      keyboard.body.querySelectorAll('[data-latch]').forEach((button) => button.setAttribute('aria-pressed', String(sticky.has(button.dataset.pcKey))));
    };
    on(keyboard.body, 'click', (event) => {
      const button = event.target.closest('[data-pc-key]');
      if (!button) return;
      if (button.dataset.latch !== undefined) options.toggleModifier?.(button.dataset.pcKey);
      else options.pressKey?.(button.dataset.pcKey);
      syncSticky();
    });

    // ----- gamepad (Xbox layout) -----
    const padButton = (flag, label, className = '', name = '') => '<button type="button" class="' + className + '" data-pad-button="' + flag + '"' + (name ? ' aria-label="' + name + '"' : '') + '>' + label + '</button>';
    const gamepad = createPanel('gamepad', '<div class="pad">'
      + '<div class="pad-shoulders pad-shoulders-left"><button type="button" class="pad-trigger" data-pad-trigger="left">LT</button>' + padButton(PAD.LB, 'LB', 'pad-bumper') + '</div>'
      + '<div class="pad-shoulders pad-shoulders-right">' + padButton(PAD.RB, 'RB', 'pad-bumper') + '<button type="button" class="pad-trigger" data-pad-trigger="right">RT</button></div>'
      + '<div class="pad-stick pad-stick-left" data-pad-stick="left" aria-label="LS"><span class="pad-knob"></span></div>'
      + '<div class="pad-system">' + padButton(PAD.VIEW, '⧉', 'pad-small', 'View') + padButton(PAD.GUIDE, '', 'pad-guide', 'Guide') + padButton(PAD.MENU, '≡', 'pad-small', 'Menu') + '</div>'
      + '<div class="pad-face">' + padButton(PAD.Y, 'Y', 'pad-y') + padButton(PAD.X, 'X', 'pad-x') + padButton(PAD.B, 'B', 'pad-b') + padButton(PAD.A, 'A', 'pad-a') + '</div>'
      + '<div class="pad-dpad">' + padButton(PAD.UP, '▲', 'pad-up', 'Up') + padButton(PAD.LEFT, '◀', 'pad-left', 'Left') + padButton(PAD.RIGHT, '▶', 'pad-right', 'Right') + padButton(PAD.DOWN, '▼', 'pad-down', 'Down') + '</div>'
      + '<div class="pad-stick pad-stick-right" data-pad-stick="right" aria-label="RS"><span class="pad-knob"></span></div>'
      + '</div>');
    const padState = { buttons: 0, leftTrigger: 0, rightTrigger: 0, leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0 };
    const padHeld = new Map(); // pointerId -> what that finger holds
    let padFrame = null;
    const sendPad = (now = false) => {
      if (now) {
        if (padFrame) cancelAnimationFrame(padFrame);
        padFrame = null;
        options.gamepad?.({ ...padState });
      } else if (!padFrame) {
        padFrame = requestAnimationFrame(() => { padFrame = null; options.gamepad?.({ ...padState }); });
      }
    };
    // Several fingers can hold the same button: it is down while any of them is.
    const pressCount = new Map();
    const pressFlag = (flag, down) => {
      const count = Math.max(0, (pressCount.get(flag) || 0) + (down ? 1 : -1));
      pressCount.set(flag, count);
      if (count) padState.buttons |= flag; else padState.buttons &= ~flag;
    };
    const moveStick = (hold, event) => {
      const rect = hold.el.getBoundingClientRect();
      const radius = rect.width * 0.36;
      let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
      let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      if (Math.hypot(x, y) > 0.15) hold.moved = true;
      hold.knob.style.transform = 'translate(' + (x * radius).toFixed(1) + 'px, ' + (y * radius).toFixed(1) + 'px)';
      const value = (v) => Math.abs(v) < STICK_DEADZONE ? 0 : Math.round(v * STICK_MAX);
      padState[hold.side + 'StickX'] = value(x);
      padState[hold.side + 'StickY'] = value(-y);
      sendPad();
    };
    const releasePad = (pointerId) => {
      const hold = padHeld.get(pointerId);
      if (!hold) return;
      padHeld.delete(pointerId);
      hold.el.classList.remove('is-active');
      if (hold.stick) {
        hold.knob.style.transform = '';
        padState[hold.side + 'StickX'] = 0;
        padState[hold.side + 'StickY'] = 0;
        if (!hold.moved && performance.now() - hold.at < STICK_TAP_MS) {
          const flag = hold.side === 'left' ? PAD.LS : PAD.RS;
          pressFlag(flag, true);
          sendPad(true);
          setTimeout(() => { pressFlag(flag, false); if (!gamepad.el.hidden) sendPad(true); }, 60);
          return;
        }
      } else if (hold.trigger) {
        padState[hold.trigger + 'Trigger'] = 0;
      } else {
        pressFlag(hold.flag, false);
      }
      sendPad(true);
    };
    on(gamepad.body, 'pointerdown', (event) => {
      const el = event.target.closest('[data-pad-button], [data-pad-trigger], [data-pad-stick]');
      if (!el || padHeld.has(event.pointerId)) return;
      el.setPointerCapture?.(event.pointerId);
      el.classList.add('is-active');
      vibrate(8);
      if (el.dataset.padStick) {
        const hold = { el, stick: true, side: el.dataset.padStick, knob: el.querySelector('.pad-knob'), moved: false, at: performance.now() };
        padHeld.set(event.pointerId, hold);
        moveStick(hold, event);
        return;
      }
      if (el.dataset.padTrigger) {
        padHeld.set(event.pointerId, { el, trigger: el.dataset.padTrigger });
        padState[el.dataset.padTrigger + 'Trigger'] = 255;
      } else {
        const flag = Number(el.dataset.padButton);
        padHeld.set(event.pointerId, { el, flag });
        pressFlag(flag, true);
      }
      sendPad(true);
    });
    on(gamepad.body, 'pointermove', (event) => {
      const hold = padHeld.get(event.pointerId);
      if (hold?.stick) moveStick(hold, event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(gamepad.body, type, (event) => releasePad(event.pointerId));
    const resetPad = () => {
      for (const id of [...padHeld.keys()]) releasePad(id);
      if (padFrame) cancelAnimationFrame(padFrame);
      padFrame = null;
      pressCount.clear();
      Object.keys(padState).forEach((key) => { padState[key] = 0; });
      options.gamepad?.(null);
    };

    // ----- mouse: touchpad, wheel strip and buttons -----
    const mouse = createPanel('mouse', '<div class="mouse-surface"><div class="mouse-pad" data-mouse-pad><span></span></div>'
      + '<div class="mouse-wheel" data-mouse-wheel><span aria-hidden="true">▲</span><i aria-hidden="true"></i><span aria-hidden="true">▼</span></div></div>'
      + '<div class="mouse-buttons"><button type="button" data-mouse-button="1"></button><button type="button" data-mouse-button="2"></button><button type="button" data-mouse-button="3"></button></div>');
    const mouseHeld = new Map(); // pointerId -> { kind: 'pad' | 'wheel' | 'button', ... }
    let wheelRemainder = 0;
    const releaseMouse = (pointerId) => {
      const hold = mouseHeld.get(pointerId);
      if (!hold) return;
      mouseHeld.delete(pointerId);
      hold.el.classList.remove('is-active');
      if (hold.kind === 'button') {
        // Down while any finger holds it.
        if (![...mouseHeld.values()].some((other) => other.kind === 'button' && other.button === hold.button)) options.mouseButton?.(hold.button, false);
      } else if (hold.kind === 'pad' && !hold.moved && performance.now() - hold.at < TAP_MS) {
        options.mouseButton?.(1, true);
        options.mouseButton?.(1, false);
      }
    };
    on(mouse.body, 'pointerdown', (event) => {
      const el = event.target.closest('[data-mouse-pad], [data-mouse-wheel], [data-mouse-button]');
      if (!el || mouseHeld.has(event.pointerId)) return;
      // One finger moves the pointer; a second one on the pad is ignored.
      if (el.dataset.mouseButton === undefined && el.dataset.mouseWheel === undefined && [...mouseHeld.values()].some((hold) => hold.kind === 'pad')) return;
      el.setPointerCapture?.(event.pointerId);
      el.classList.add('is-active');
      const base = { el, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: performance.now(), moved: false };
      if (el.dataset.mouseButton) {
        const button = Number(el.dataset.mouseButton);
        vibrate(8);
        mouseHeld.set(event.pointerId, { ...base, kind: 'button', button });
        options.mouseButton?.(button, true);
      } else if (el.dataset.mouseWheel !== undefined) {
        mouseHeld.set(event.pointerId, { ...base, kind: 'wheel' });
      } else {
        mouseHeld.set(event.pointerId, { ...base, kind: 'pad' });
      }
    });
    on(mouse.body, 'pointermove', (event) => {
      const hold = mouseHeld.get(event.pointerId);
      if (!hold || hold.kind === 'button') return;
      const dx = event.clientX - hold.x;
      const dy = event.clientY - hold.y;
      hold.x = event.clientX;
      hold.y = event.clientY;
      if (Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) > TAP_SLOP_PX) hold.moved = true;
      if (hold.kind === 'pad') {
        const speed = MOUSE_SPEED * (Number(getState().touchDpi) || 100) / 100;
        hold.restX = (hold.restX || 0) + dx * speed;
        hold.restY = (hold.restY || 0) + dy * speed;
        const moveX = Math.trunc(hold.restX);
        const moveY = Math.trunc(hold.restY);
        hold.restX -= moveX;
        hold.restY -= moveY;
        options.mouseMove?.(moveX, moveY);
      } else {
        // Like a wheel: a finger rolling it up scrolls up.
        wheelRemainder += (-dy / WHEEL_PX_PER_NOTCH) * 120;
        const amount = Math.trunc(wheelRemainder);
        wheelRemainder -= amount;
        options.mouseScroll?.(amount);
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(mouse.body, type, (event) => releaseMouse(event.pointerId));
    const resetMouse = () => { for (const id of [...mouseHeld.keys()]) releaseMouse(id); wheelRemainder = 0; };

    // ----- open / close -----
    const isOpen = (name) => Boolean(panels.get(name) && !panels.get(name).el.hidden);
    function setOpen(name, open) {
      const panel = panels.get(name);
      if (!panel || isOpen(name) === open) return;
      if (!open) {
        if (name === 'gamepad') resetPad();
        if (name === 'mouse') resetMouse();
      }
      panel.el.hidden = !open;
      if (open) { raise(panel); render(); }
      options.onChange?.();
    }
    const toggle = (name) => setOpen(name, !isOpen(name));

    // Text (the language can change while streaming), latched keys and positions.
    function render() {
      for (const panel of panels.values()) {
        panel.el.setAttribute('aria-label', t(TITLE_KEY[panel.name]));
        panel.el.querySelector('.floating-head strong').textContent = t(TITLE_KEY[panel.name]);
        panel.el.querySelector('.floating-head').title = t('floating.drag');
        panel.el.querySelector('[data-floating-close]').setAttribute('aria-label', t('floating.close'));
      }
      mouse.body.querySelector('.mouse-pad span').textContent = t('mouse.padHint');
      mouse.body.querySelector('[data-mouse-wheel]').setAttribute('aria-label', t('mouse.wheel'));
      mouse.body.querySelectorAll('[data-mouse-button]').forEach((button) => { button.textContent = t(['', 'mouse.left', 'mouse.middle', 'mouse.right'][button.dataset.mouseButton]); });
      syncSticky();
      for (const panel of panels.values()) place(panel);
    }
    const placeAll = () => { for (const panel of panels.values()) place(panel); };
    on(window, 'resize', placeAll);
    if (window.visualViewport) on(window.visualViewport, 'resize', placeAll);
    render();

    return {
      render,
      isOpen,
      toggle,
      open: (name) => setOpen(name, true),
      close: (name) => setOpen(name, false),
      destroy() {
        resetPad();
        resetMouse();
        listeners.splice(0).forEach((off) => off());
        for (const panel of panels.values()) panel.el.remove();
        panels.clear();
      },
    };
  }

  window.SunbridgeFloating = { createFloatingControls };
})();

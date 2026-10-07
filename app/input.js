(function () {
  'use strict';

  // KeyboardEvent.code (physical key) -> Windows virtual-key code, which is what Sunshine expects.
  const VK = {
    Backspace: 0x08, Tab: 0x09, Enter: 0x0d, NumpadEnter: 0x0d, Pause: 0x13, CapsLock: 0x14, Escape: 0x1b, Space: 0x20,
    PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
    PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e,
    MetaLeft: 0x5b, MetaRight: 0x5c, OSLeft: 0x5b, OSRight: 0x5c, ContextMenu: 0x5d,
    Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64, Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
    NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
    NumLock: 0x90, ScrollLock: 0x91,
    ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3, AltLeft: 0xa4, AltRight: 0xa5,
    Semicolon: 0xba, Equal: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf, Backquote: 0xc0,
    BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde, IntlBackslash: 0xe2,
    AudioVolumeMute: 0xad, AudioVolumeDown: 0xae, AudioVolumeUp: 0xaf, MediaTrackNext: 0xb0, MediaTrackPrevious: 0xb1, MediaStop: 0xb2, MediaPlayPause: 0xb3,
  };
  for (let i = 0; i < 26; i += 1) VK['Key' + String.fromCharCode(65 + i)] = 0x41 + i;
  for (let i = 0; i < 10; i += 1) VK['Digit' + i] = 0x30 + i;
  for (let i = 1; i <= 24; i += 1) VK['F' + i] = 0x6f + i;

  const MODIFIER = { SHIFT: 0x01, CTRL: 0x02, ALT: 0x04, META: 0x08 };
  // Standard Gamepad mapping (https://w3c.github.io/gamepad/#remapping) -> GameStream button flags
  const GAMEPAD_BUTTONS = [
    0x1000, // 0 A
    0x2000, // 1 B
    0x4000, // 2 X
    0x8000, // 3 Y
    0x0100, // 4 LB
    0x0200, // 5 RB
    0, // 6 LT (analog)
    0, // 7 RT (analog)
    0x0020, // 8 Back / View
    0x0010, // 9 Start / Menu
    0x0040, // 10 LS click
    0x0080, // 11 RS click
    0x0001, // 12 Up
    0x0002, // 13 Down
    0x0004, // 14 Left
    0x0008, // 15 Right
    0x0400, // 16 Guide
    0x200000, // 17 Misc (share / capture / touchpad click on some pads)
  ];
  const WHEEL_DELTA = 120;
  const STICK_DEADZONE = 0.08;

  function modifiersOf(event) {
    return (event.shiftKey ? MODIFIER.SHIFT : 0) | (event.ctrlKey ? MODIFIER.CTRL : 0) | (event.altKey ? MODIFIER.ALT : 0) | (event.metaKey ? MODIFIER.META : 0);
  }

  function axis(value) {
    const v = Number(value) || 0;
    if (Math.abs(v) < STICK_DEADZONE) return 0;
    return Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }

  // Map a pointer position to host coordinates, honouring the canvas' object-fit: contain letterbox.
  function videoPoint(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // A canvas drawn by the media worker reports the video size in data attributes (its own width is fixed).
    const width = Number(canvas.dataset.videoWidth) || canvas.width || 1;
    const height = Number(canvas.dataset.videoHeight) || canvas.height || 1;
    const scale = Math.min(rect.width / width, rect.height / height) || 1;
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    const left = rect.left + (rect.width - drawnWidth) / 2;
    const top = rect.top + (rect.height - drawnHeight) / 2;
    const x = (clientX - left) / scale;
    const y = (clientY - top) / scale;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x: Math.round(x), y: Math.round(y), width, height };
  }

  // Modes: 'game' locks the pointer on click and sends relative motion (the classic GameStream behaviour);
  // 'desktop' never locks it: absolute positions, local cursor, touch gestures and a soft keyboard.
  function createInputController({ canvas, send, isEnabled = () => true, onStateChange, shouldCapturePointer = () => true, onQuit, getMode = () => 'game', textInput = null } = {}) {
    if (!canvas || typeof send !== 'function') throw new TypeError('createInputController needs a canvas and a send function');
    const pressedKeys = new Map(); // code -> vk
    const pressedButtons = new Set();
    const pads = new Map(); // gamepad.index -> { controllerNumber, lastKey }
    const listeners = [];
    let queue = [];
    let flushScheduled = false;
    let pendingDx = 0;
    let pendingDy = 0;
    let pendingAbs = null;
    let wheelRemainder = 0;
    let hwheelRemainder = 0;
    let gamepadFrame = null;
    let stopped = false;
    const stats = { events: 0, pointerLocked: false, gamepads: 0 };

    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    };
    const pointerLocked = () => document.pointerLockElement === canvas;
    const desktopMode = () => getMode() === 'desktop';
    const active = () => !stopped && isEnabled();
    const notify = () => onStateChange?.({ ...stats });

    const flush = () => {
      flushScheduled = false;
      if (pendingDx || pendingDy) {
        queue.push({ kind: 'mouse-rel', dx: pendingDx, dy: pendingDy });
        pendingDx = 0;
        pendingDy = 0;
      }
      if (pendingAbs) {
        queue.push({ kind: 'mouse-abs', ...pendingAbs });
        pendingAbs = null;
      }
      if (!queue.length) return;
      const events = queue;
      queue = [];
      stats.events += events.length;
      send({ type: 'input', events });
    };
    // Discrete events (keys/buttons) go out in the same task; motion is coalesced to one message per task.
    const push = (event) => {
      if (!active()) return;
      queue.push(event);
      schedule();
    };
    const schedule = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(flush);
    };

    const releaseAll = () => {
      for (const [code, vk] of pressedKeys) queue.push({ kind: 'key', keyCode: vk, down: false, modifiers: 0, code });
      pressedKeys.clear();
      for (const button of pressedButtons) queue.push({ kind: 'mouse-button', button, down: false });
      pressedButtons.clear();
      if (queue.length) flush();
    };

    // ----- keyboard -----
    on(window, 'keydown', (event) => {
      if (!active()) return;
      // Ctrl+Alt+Shift+Q ends the session, Z toggles mouse capture (the usual GameStream client shortcuts).
      // S toggles the stats overlay; the page handles it, it just must not reach the host.
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyS') {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey && event.altKey && event.shiftKey && (event.code === 'KeyQ' || event.code === 'KeyZ')) {
        event.preventDefault();
        releaseAll();
        if (event.code === 'KeyQ') onQuit?.();
        else if (pointerLocked()) document.exitPointerLock?.();
        else requestCapture();
        return;
      }
      const vk = VK[event.code];
      if (!vk) return;
      event.preventDefault();
      if (event.repeat && pressedKeys.has(event.code)) {
        push({ kind: 'key', keyCode: vk, down: true, modifiers: modifiersOf(event) });
        return;
      }
      pressedKeys.set(event.code, vk);
      push({ kind: 'key', keyCode: vk, down: true, modifiers: modifiersOf(event) });
    }, true);
    on(window, 'keyup', (event) => {
      if (!active()) return;
      const vk = VK[event.code];
      if (!vk) return;
      event.preventDefault();
      pressedKeys.delete(event.code);
      push({ kind: 'key', keyCode: vk, down: false, modifiers: modifiersOf(event) });
    }, true);
    on(window, 'blur', releaseAll);
    on(document, 'visibilitychange', () => { if (document.hidden) releaseAll(); });

    // ----- mouse -----
    const requestCapture = () => {
      if (!active() || pointerLocked() || !canvas.requestPointerLock) return;
      try {
        const result = canvas.requestPointerLock({ unadjustedMovement: true });
        if (result?.catch) result.catch(() => { try { canvas.requestPointerLock(); } catch { /* not allowed */ } });
      } catch {
        try { canvas.requestPointerLock(); } catch { /* not allowed */ }
      }
    };
    on(document, 'pointerlockchange', () => {
      stats.pointerLocked = pointerLocked();
      if (stats.pointerLocked) navigator.keyboard?.lock?.().catch?.(() => {});
      else if (!document.fullscreenElement) navigator.keyboard?.unlock?.();
      notify();
    });
    on(canvas, 'pointerdown', (event) => {
      if (!active()) return;
      if (event.pointerType === 'touch' && desktopMode()) return; // handled by the touch gestures below
      event.preventDefault();
      if (!pointerLocked() && !desktopMode() && shouldCapturePointer()) requestCapture();
      if (!pointerLocked()) {
        const point = videoPoint(canvas, event.clientX, event.clientY);
        if (!point) return;
        // Move first, then press: otherwise the host clicks at the previous cursor position.
        pendingAbs = point;
        flush();
      }
      const button = event.button + 1;
      if (button < 1 || button > 5) return;
      pressedButtons.add(button);
      push({ kind: 'mouse-button', button, down: true });
    });
    on(window, 'pointerup', (event) => {
      if (!active()) return;
      if (event.pointerType === 'touch' && desktopMode()) return;
      const button = event.button + 1;
      if (!pressedButtons.has(button)) return;
      pressedButtons.delete(button);
      push({ kind: 'mouse-button', button, down: false });
    });
    on(window, 'pointermove', (event) => {
      if (!active()) return;
      if (event.pointerType === 'touch' && desktopMode()) return;
      if (pointerLocked()) {
        pendingDx += event.movementX || 0;
        pendingDy += event.movementY || 0;
      } else if (event.target === canvas || pressedButtons.size) {
        const point = videoPoint(canvas, event.clientX, event.clientY);
        if (!point) return;
        pendingAbs = point;
      } else {
        return;
      }
      schedule();
    });
    on(canvas, 'contextmenu', (event) => { if (active()) event.preventDefault(); });
    on(canvas, 'wheel', (event) => {
      if (!active()) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
      // 100 CSS px of wheel travel ~= one 120-unit notch, which matches typical Windows scrolling.
      wheelRemainder += (-event.deltaY * unit * WHEEL_DELTA) / 100;
      hwheelRemainder += (event.deltaX * unit * WHEEL_DELTA) / 100;
      const vertical = Math.trunc(wheelRemainder);
      const horizontal = Math.trunc(hwheelRemainder);
      wheelRemainder -= vertical;
      hwheelRemainder -= horizontal;
      if (vertical) push({ kind: 'scroll', amount: vertical });
      if (horizontal) push({ kind: 'hscroll', amount: horizontal });
    }, { passive: false });

    // ----- touch gestures (desktop mode) -----
    // One finger: tap = click, drag = left-button drag, hold = right click.
    // Two fingers: tap = right click, drag = scroll.
    const touches = new Map();
    let gesture = null;
    const LONG_PRESS_MS = 550;
    const TAP_SLOP_PX = 10;
    const moveTo = (x, y) => {
      const point = videoPoint(canvas, x, y);
      if (point) { pendingAbs = point; schedule(); }
      return point;
    };
    const click = (button, x, y) => {
      if (!moveTo(x, y)) return;
      flush();
      push({ kind: 'mouse-button', button, down: true });
      push({ kind: 'mouse-button', button, down: false });
    };
    const endGesture = () => {
      if (gesture?.timer) clearTimeout(gesture.timer);
      if (gesture?.dragging) push({ kind: 'mouse-button', button: 1, down: false });
      gesture = null;
    };
    on(canvas, 'pointerdown', (event) => {
      if (!active() || event.pointerType !== 'touch' || !desktopMode()) return;
      event.preventDefault();
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 1) {
        gesture = { fingers: 1, startX: event.clientX, startY: event.clientY, startAt: performance.now(), moved: false, dragging: false, longPressed: false, timer: null };
        gesture.timer = setTimeout(() => {
          if (!gesture || gesture.moved || gesture.fingers !== 1) return;
          gesture.longPressed = true;
          click(3, gesture.startX, gesture.startY);
        }, LONG_PRESS_MS);
      } else if (touches.size === 2 && gesture) {
        clearTimeout(gesture.timer);
        if (gesture.dragging) push({ kind: 'mouse-button', button: 1, down: false });
        const [a, b] = [...touches.values()];
        Object.assign(gesture, { fingers: 2, dragging: false, scrolled: false, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 });
      }
    });
    on(window, 'pointermove', (event) => {
      if (!active() || event.pointerType !== 'touch' || !desktopMode() || !touches.has(event.pointerId) || !gesture) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture.fingers === 1) {
        if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < TAP_SLOP_PX) return;
        gesture.moved = true;
        clearTimeout(gesture.timer);
        if (gesture.longPressed) return;
        if (!gesture.dragging) {
          gesture.dragging = true;
          moveTo(gesture.startX, gesture.startY);
          flush();
          push({ kind: 'mouse-button', button: 1, down: true });
        }
        moveTo(event.clientX, event.clientY);
      } else if (gesture.fingers === 2 && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        // Natural scrolling: content follows the fingers.
        wheelRemainder += ((midY - gesture.midY) * WHEEL_DELTA) / 40;
        hwheelRemainder += ((gesture.midX - midX) * WHEEL_DELTA) / 40;
        gesture.midX = midX;
        gesture.midY = midY;
        const vertical = Math.trunc(wheelRemainder);
        const horizontal = Math.trunc(hwheelRemainder);
        wheelRemainder -= vertical;
        hwheelRemainder -= horizontal;
        if (vertical) { gesture.scrolled = true; push({ kind: 'scroll', amount: vertical }); }
        if (horizontal) { gesture.scrolled = true; push({ kind: 'hscroll', amount: horizontal }); }
      }
    });
    const touchEnd = (event) => {
      if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
      touches.delete(event.pointerId);
      if (!gesture || !active()) { if (!touches.size) endGesture(); return; }
      if (touches.size) return;
      const quick = performance.now() - gesture.startAt < 350;
      if (event.type !== 'pointercancel') {
        if (gesture.fingers === 2 && !gesture.scrolled && quick) click(3, gesture.startX, gesture.startY);
        else if (gesture.fingers === 1 && !gesture.moved && !gesture.longPressed) click(1, gesture.startX, gesture.startY);
      }
      endGesture();
    };
    on(window, 'pointerup', touchEnd);
    on(window, 'pointercancel', touchEnd);

    // ----- soft keyboard (touch devices): a hidden textarea turns typed text into UTF-8 text input -----
    const sendText = (text) => {
      // Sunshine takes at most 32 UTF-8 bytes per text packet.
      let chunk = '';
      for (const char of text) {
        if (new TextEncoder().encode(chunk + char).length > 32) { push({ kind: 'text', text: chunk }); chunk = ''; }
        chunk += char;
      }
      if (chunk) push({ kind: 'text', text: chunk });
    };
    const tapKey = (vk) => {
      push({ kind: 'key', keyCode: vk, down: true, modifiers: 0 });
      push({ kind: 'key', keyCode: vk, down: false, modifiers: 0 });
    };
    if (textInput) {
      on(textInput, 'input', (event) => {
        if (!active()) return;
        if (event.inputType === 'deleteContentBackward') tapKey(VK.Backspace);
        else if (event.inputType === 'insertLineBreak') tapKey(VK.Enter);
        else if (event.data) sendText(event.data);
        else if (textInput.value) sendText(textInput.value);
        textInput.value = '';
      });
      // Hardware-like keys from soft keyboards that do send a usable code (Enter/Backspace on some platforms).
      on(textInput, 'keydown', (event) => {
        if (event.key === 'Enter' && !VK[event.code]) { event.preventDefault(); tapKey(VK.Enter); }
        if (event.key === 'Backspace' && !VK[event.code] && !textInput.value) { event.preventDefault(); tapKey(VK.Backspace); }
      });
    }

    // ----- gamepads -----
    const controllerMask = () => {
      let mask = 0;
      for (const pad of pads.values()) mask |= 1 << pad.controllerNumber;
      return mask;
    };
    const pollGamepads = () => {
      gamepadFrame = null;
      if (stopped) return;
      const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      for (const gamepad of list) {
        if (!gamepad || !gamepad.connected) continue;
        let pad = pads.get(gamepad.index);
        if (!pad) {
          const used = new Set([...pads.values()].map((item) => item.controllerNumber));
          let controllerNumber = 0;
          while (used.has(controllerNumber) && controllerNumber < 15) controllerNumber += 1;
          pad = { controllerNumber, lastKey: '', arrived: false };
          pads.set(gamepad.index, pad);
          stats.gamepads = pads.size;
          notify();
        }
        if (!active()) continue;
        if (!pad.arrived) {
          pad.arrived = true;
          const hasRumble = Boolean(gamepad.vibrationActuator);
          push({ kind: 'gamepad-arrival', controllerNumber: pad.controllerNumber, type: 1, capabilities: 0x01 | (hasRumble ? 0x02 : 0), supportedButtonFlags: 0x20f7ff });
        }
        let buttons = 0;
        gamepad.buttons.forEach((button, index) => { if (button?.pressed && GAMEPAD_BUTTONS[index]) buttons |= GAMEPAD_BUTTONS[index]; });
        const state = {
          kind: 'gamepad',
          controllerNumber: pad.controllerNumber,
          activeGamepadMask: controllerMask(),
          buttons,
          leftTrigger: Math.round((gamepad.buttons[6]?.value || 0) * 255),
          rightTrigger: Math.round((gamepad.buttons[7]?.value || 0) * 255),
          leftStickX: axis(gamepad.axes[0]),
          leftStickY: -axis(gamepad.axes[1]),
          rightStickX: axis(gamepad.axes[2]),
          rightStickY: -axis(gamepad.axes[3]),
        };
        const key = [state.buttons, state.leftTrigger, state.rightTrigger, state.leftStickX, state.leftStickY, state.rightStickX, state.rightStickY, state.activeGamepadMask].join(',');
        if (key !== pad.lastKey) {
          pad.lastKey = key;
          push(state);
        }
      }
      if (pads.size) gamepadFrame = requestAnimationFrame(pollGamepads);
    };
    const startGamepadPolling = () => { if (!gamepadFrame && !stopped) gamepadFrame = requestAnimationFrame(pollGamepads); };
    on(window, 'gamepadconnected', startGamepadPolling);
    on(window, 'gamepaddisconnected', (event) => {
      const pad = pads.get(event.gamepad.index);
      if (!pad) return;
      pads.delete(event.gamepad.index);
      stats.gamepads = pads.size;
      // Report a neutral state with this controller removed from the active mask.
      push({ kind: 'gamepad', controllerNumber: pad.controllerNumber, activeGamepadMask: controllerMask(), buttons: 0, leftTrigger: 0, rightTrigger: 0, leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0 });
      notify();
    });
    if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(Boolean)) startGamepadPolling();

    const rumble = ({ controller, lowFreq, highFreq }) => {
      const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      for (const [index, pad] of pads) {
        if (pad.controllerNumber !== controller) continue;
        const actuator = list[index]?.vibrationActuator;
        if (!actuator?.playEffect) continue;
        if (!lowFreq && !highFreq) { actuator.reset?.(); continue; }
        actuator.playEffect('dual-rumble', { duration: 5000, strongMagnitude: lowFreq / 65535, weakMagnitude: highFreq / 65535 }).catch?.(() => {});
      }
    };

    return {
      get stats() { return { ...stats }; },
      capture: requestCapture,
      // Switching to desktop mode releases the pointer lock.
      modeChanged() { if (desktopMode() && pointerLocked()) document.exitPointerLock?.(); },
      releaseAll,
      rumble,
      stop() {
        if (stopped) return;
        releaseAll();
        stopped = true;
        if (gamepadFrame) cancelAnimationFrame(gamepadFrame);
        gamepadFrame = null;
        if (pointerLocked()) document.exitPointerLock?.();
        navigator.keyboard?.unlock?.();
        listeners.splice(0).forEach((off) => off());
      },
    };
  }

  const api = { VK, GAMEPAD_BUTTONS, createInputController, videoPoint };
  if (typeof window !== 'undefined') window.SunbridgeInput = api;
  if (typeof globalThis !== 'undefined') globalThis.SunbridgeInput = api;
})();

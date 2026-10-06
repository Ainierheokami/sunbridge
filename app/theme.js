// Appearance: light / dark theme (following the system by default) and text size. Loaded in <head> so the
// page is painted in the right theme from the first frame. Settings → Appearance writes the choices;
// they are stored per browser.
(function () {
  'use strict';
  const THEME_KEY = 'sunbridge.theme';
  const SIZE_KEY = 'sunbridge.textSize';
  const THEMES = ['system', 'light', 'dark'];
  const SIZES = ['normal', 'large', 'xlarge'];
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode: this page only */ } };
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const root = document.documentElement;
  let theme = THEMES.includes(read(THEME_KEY)) ? read(THEME_KEY) : 'system';
  let textSize = SIZES.includes(read(SIZE_KEY)) ? read(SIZE_KEY) : 'normal';

  const syncControls = () => {
    document.querySelectorAll('[data-appearance] [data-value]').forEach((button) => {
      const group = button.closest('[data-appearance]').dataset.appearance;
      button.setAttribute('aria-pressed', String(button.dataset.value === (group === 'theme' ? theme : textSize)));
    });
  };

  const apply = () => {
    const resolved = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme;
    root.dataset.theme = resolved;
    root.dataset.textSize = textSize;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1e1e20' : '#f5f5f7');
    syncControls();
    window.dispatchEvent(new CustomEvent('sunbridge:appearance', { detail: { theme, resolved, textSize } }));
  };

  const setTheme = (value) => { if (THEMES.includes(value)) { theme = value; write(THEME_KEY, value); apply(); } };
  const setTextSize = (value) => { if (SIZES.includes(value)) { textSize = value; write(SIZE_KEY, value); apply(); } };

  media?.addEventListener?.('change', () => { if (theme === 'system') apply(); });
  // Another tab changed it.
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY && THEMES.includes(event.newValue)) { theme = event.newValue; apply(); }
    if (event.key === SIZE_KEY && SIZES.includes(event.newValue)) { textSize = event.newValue; apply(); }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-appearance] [data-value]');
    if (!button) return;
    const group = button.closest('[data-appearance]').dataset.appearance;
    if (group === 'theme') setTheme(button.dataset.value);
    if (group === 'text-size') setTextSize(button.dataset.value);
  });
  document.addEventListener('DOMContentLoaded', syncControls, { once: true });

  window.SunbridgeTheme = { setTheme, setTextSize, get theme() { return theme; }, get textSize() { return textSize; } };
  apply();
})();

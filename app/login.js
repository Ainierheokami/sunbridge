(function () {
  'use strict';
  const form = document.getElementById('loginForm');
  const message = document.getElementById('message');
  const submit = document.getElementById('submit');
  // Only allow same-site relative targets after login (no open redirects).
  const next = (() => {
    const value = new URLSearchParams(window.location.search).get('next') || '/';
    return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
  })();
  const show = (text, info = false) => {
    message.textContent = text;
    message.classList.toggle('is-info', info);
  };

  fetch('/api/auth/status', { headers: { Accept: 'application/json' } })
    .then((response) => response.json())
    .then((status) => {
      if (status.authenticated) window.location.replace(next);
      else if (status.setupRequired) {
        show('尚未设置登录密码。请在运行 Sunbridge 的电脑上运行 start.bat（或 ./start.sh）设置登录密码，然后刷新本页。', true);
        submit.disabled = true;
      }
    })
    .catch(() => show('无法连接 Bridge。'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    show('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) {
        window.location.replace(next);
        return;
      }
      form.password.value = '';
      if (payload.errorCode === 'AUTH_RATE_LIMITED') {
        const seconds = Math.ceil((payload.retryAfterMs || 60000) / 1000);
        show(`登录失败次数过多，请 ${seconds >= 120 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`}后再试。`);
      } else {
        show(payload.error || '登录失败。');
      }
    } catch {
      show('无法连接 Bridge。');
    } finally {
      submit.disabled = false;
    }
  });
})();

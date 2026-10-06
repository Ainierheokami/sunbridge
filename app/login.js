(function () {
  'use strict';
  const form = document.getElementById('loginForm');
  const message = document.getElementById('message');
  const submit = document.getElementById('submit');
  const codeForm = document.getElementById('codeForm');
  const codeInput = document.getElementById('code');
  const codeMessage = document.getElementById('codeMessage');
  const codeSubmit = document.getElementById('codeSubmit');
  const useRecovery = document.getElementById('useRecovery');
  let challenge = null;
  let recoveryMode = false;
  // Only allow same-site relative targets after login (no open redirects).
  const next = (() => {
    const value = new URLSearchParams(window.location.search).get('next') || '/';
    return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
  })();
  const show = (text, info = false, target = message) => {
    target.textContent = text;
    target.classList.toggle('is-info', info);
  };
  const retryText = (payload) => {
    const seconds = Math.ceil((payload.retryAfterMs || 60000) / 1000);
    return `失败次数过多，请 ${seconds >= 120 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`}后再试。`;
  };
  const post = async (path, body) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  const setRecoveryMode = (on) => {
    recoveryMode = on;
    codeInput.value = '';
    codeInput.maxLength = on ? 11 : 6;
    codeInput.inputMode = on ? 'text' : 'numeric';
    codeInput.autocomplete = on ? 'off' : 'one-time-code';
    if (on) codeInput.removeAttribute('pattern'); else codeInput.setAttribute('pattern', '[0-9]{6}');
    document.getElementById('codeLabel').textContent = on ? '恢复码' : '验证码';
    document.getElementById('codeHint').textContent = on
      ? '输入启用两步验证时保存的任一恢复码（形如 abcde-fghij）。每个恢复码只能用一次。'
      : '已启用两步验证。打开手机上的验证器应用（Google Authenticator、Microsoft Authenticator 等），输入 Sunbridge 的 6 位验证码。';
    useRecovery.textContent = on ? '使用验证器的验证码' : '手机不在身边？使用恢复码';
    show('', false, codeMessage);
    codeInput.focus();
  };
  const showPasswordStep = () => {
    challenge = null;
    codeForm.hidden = true;
    form.hidden = false;
    form.password.value = '';
    form.password.focus();
  };

  fetch('/api/auth/status', { headers: { Accept: 'application/json' } })
    .then((response) => response.json())
    .then((status) => {
      if (status.authenticated) window.location.replace(next);
      else if (status.setupRequired) {
        show('尚未设置登录密码。请在运行 Sunbridge 的电脑上运行 start.bat（或 ./start.sh）设置登录密码，然后刷新本页。', true);
        submit.disabled = true;
      }
      document.getElementById('insecureWarning').hidden = !status.insecureTransport;
    })
    .catch(() => show('无法连接 Bridge。'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    show('');
    try {
      const { response, payload } = await post('/api/auth/login', { username: form.username.value.trim(), password: form.password.value });
      if (response.ok && payload.ok) {
        window.location.replace(next);
        return;
      }
      if (payload.errorCode === 'AUTH_2FA_REQUIRED' && payload.challenge) {
        challenge = payload.challenge;
        form.hidden = true;
        codeForm.hidden = false;
        setRecoveryMode(false);
        return;
      }
      form.password.value = '';
      show(payload.errorCode === 'AUTH_RATE_LIMITED' ? retryText(payload) : payload.error || '登录失败。');
    } catch {
      show('无法连接 Bridge。');
    } finally {
      submit.disabled = false;
    }
  });

  // Six digits is a complete TOTP code: submit right away (also when pasted or autofilled).
  codeInput.addEventListener('input', () => {
    if (!recoveryMode && /^\d{6}$/.test(codeInput.value)) codeForm.requestSubmit();
  });

  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (codeSubmit.disabled) return;
    codeSubmit.disabled = true;
    show('', false, codeMessage);
    try {
      const { response, payload } = await post('/api/auth/login/2fa', { challenge, code: codeInput.value });
      if (response.ok && payload.ok) {
        if (payload.recoveryRemaining != null) {
          // A recovery code was used: say how many are left before moving on.
          show(`已使用恢复码登录，还剩 ${payload.recoveryRemaining} 个。可以在“设置 → 两步验证”里重新生成。`, true, codeMessage);
          window.setTimeout(() => window.location.replace(next), 2500);
          return;
        }
        window.location.replace(next);
        return;
      }
      codeInput.value = '';
      if (payload.errorCode === 'AUTH_2FA_EXPIRED') {
        showPasswordStep();
        show('验证已超时或失败次数过多，请重新输入密码。');
        return;
      }
      show(payload.errorCode === 'AUTH_RATE_LIMITED' ? retryText(payload) : payload.error || '验证失败。', false, codeMessage);
      codeInput.focus();
    } catch {
      show('无法连接 Bridge。', false, codeMessage);
    } finally {
      codeSubmit.disabled = false;
    }
  });

  useRecovery.addEventListener('click', () => setRecoveryMode(!recoveryMode));
  document.getElementById('backToPassword').addEventListener('click', showPasswordStep);
})();

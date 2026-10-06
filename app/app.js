(() => {
  const bridge = window.sunbridgeClient;
  const qs = (selector, scope = document) => scope.querySelector(selector);
  const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const resolveNode = (target, scope = document) => target && typeof target === 'object' && target.nodeType === 1 ? target : qs(target, scope);
  const t = (key, params) => (window.t ? window.t(key, params) : key);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  const icons = {
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    host: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="13" rx="2"/><path d="M8 20h8M12 17v3M8 8h3M8 12h5M16 8h.01M16 12h.01"/></svg>',
    pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.2-6 4.1 12 2.3-6H21"/><path d="M3 4v16M21 4v16" opacity=".25"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    'arrow-up-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/></svg>',
    'chevron-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7V5Z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m10 13.5-1.3 1.3a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0"/><path d="m14 10.5 1.3-1.3a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/><path d="m8 16 8-8"/></svg>',
    browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M7 6h.01M10 6h.01M13 6h.01"/></svg>',
    bridge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 17h16M7 4v16M17 4v16"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 8.5a14 14 0 0 1 18 0M6.5 12a8.5 8.5 0 0 1 11 0M10 15.5a3.7 3.7 0 0 1 4 0M12 19h.01"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 6v5c0 4.3-2.4 7.7-7 10-4.6-2.3-7-5.7-7-10V6l7-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v6l9 9 7-7-9-9H5a1 1 0 0 0-1 1Z"/><circle cx="8" cy="8" r="1"/></svg>',
    mouse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/></svg>',
    gamepad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10a4 4 0 0 1 4 4v4.5a2.5 2.5 0 0 1-4.6 1.4L15 15H9l-1.4 1.9A2.5 2.5 0 0 1 3 15.5V11a4 4 0 0 1 4-4Z"/><path d="M8 10v3M6.5 11.5h3M15 11h.01M17 13h.01"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    compress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></svg>',
  };

  const state = {
    activeView: 'overview',
    health: null,
    hosts: [],
    selectedHost: null,
    selectedApps: [],
    diagnostic: { status: 'idle', result: null, error: null },
    streamSession: null,
    streamHost: null,
    streamApp: null,
    settings: (() => {
      // resolution: 'auto' (follow the window) or 'WxH'; controlMode: auto | desktop | game; bitrateMode: auto | fixed.
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('sunbridge.settings.v1') || '{}') || {}; } catch { saved = {}; }
      return { resolution: 'auto', width: 1920, height: 1080, fps: 60, controlMode: 'auto', bitrateMode: 'auto', codec: 'auto', ...saved };
    })(),
    activity: [],
    loading: true,
    stopping: false,
    sessionPollTimer: null,
    sessionPollBusy: false,
    sessionPollGeneration: 0,
    sessionPollError: null,
    sessionEventClose: null,
    sessionEventConnected: false,
    sessionEventError: null,
    mediaGateway: null,
    mediaGatewayState: 'waiting',
    mediaGatewayError: null,
    videoPipeline: null,
    videoDecoderState: 'waiting-keyframe',
    videoDecoderError: null,
    audioPipeline: null,
    audioDecoderState: 'waiting',
    audioDecoderError: null,
    audioContext: null,
    mediaGatewayGeneration: 0,
    bridgePollTimer: null,
    bridgePollBusy: false,
    bridgePollGeneration: 0,
  };

  // Keep demo history isolated from real Sunshine activity so a live client never renders stale demo events.
  const activityStorageKey = bridge.isDemo ? 'sunbridge.activity.demo.v2' : 'sunbridge.activity.live.v2';

  const safeJson = (value, fallback) => {
    try { return JSON.parse(value); } catch { return fallback; }
  };

  const loadActivity = () => {
    const saved = safeJson(localStorage.getItem(activityStorageKey), []);
    state.activity = Array.isArray(saved) ? saved.slice(0, 20) : [];
  };

  const saveActivity = () => localStorage.setItem(activityStorageKey, JSON.stringify(state.activity.slice(0, 20)));

  const recordActivity = (icon, title, detailKey, params = {}) => {
    state.activity.unshift({ icon, title, detailKey, params, at: new Date().toISOString() });
    state.activity = state.activity.slice(0, 20);
    saveActivity();
  };

  const hydrateIcons = (scope = document) => {
    qsa('[data-icon]', scope).forEach((node) => {
      const icon = icons[node.dataset.icon];
      if (icon) node.innerHTML = icon;
    });
  };
  window.SunbridgeIcons = { hydrate: hydrateIcons };

  const setText = (target, value, scope = document) => {
    const node = resolveNode(target, scope);
    if (node) node.textContent = value == null ? '' : String(value);
    return node;
  };

  const setEyebrow = (target, value, scope = document) => {
    const node = resolveNode(target, scope);
    if (!node) return null;
    const dot = node.querySelector('.live-dot');
    node.replaceChildren();
    if (dot) node.append(dot, document.createTextNode(' '));
    node.append(document.createTextNode(value == null ? '' : String(value)));
    return node;
  };

  const setHtml = (target, value, scope = document) => {
    const node = resolveNode(target, scope);
    if (node) node.innerHTML = value;
    return node;
  };

  const setStatusDot = (node, status) => {
    if (!node) return;
    node.classList.remove('is-green', 'is-yellow', 'is-red');
    if (status === 'online' || status === 'ready') node.classList.add('is-green');
    if (status === 'waking' || status === 'checking') node.classList.add('is-yellow');
    if (status === 'offline' || status === 'error') node.classList.add('is-red');
  };

  const showToast = (title, detail, kind = 'info') => {
    const stack = qs('#toastStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconName = kind === 'success' ? 'check' : kind === 'warning' ? 'info' : 'pulse';
    toast.innerHTML = '<span class="toast-icon" data-icon="' + iconName + '"></span><div class="toast-copy"><strong></strong><span></span></div>';
    qs('strong', toast).textContent = title;
    qs('span', toast.querySelector('.toast-copy')).textContent = detail;
    stack.appendChild(toast);
    hydrateIcons(toast);
    window.setTimeout(() => toast.classList.add('is-leaving'), 3600);
    window.setTimeout(() => toast.remove(), 3900);
  };

  const errorMessage = (error) => {
    const raw = error instanceof Error ? error.message : String(error || t('common.unknown'));
    if (error?.i18nKey) {
      const localizedMessage = t(error.i18nKey);
      if (localizedMessage !== error.i18nKey) return localizedMessage;
    }
    const codeKey = `error.code.${error?.errorCode || ''}`;
    const localized = t(codeKey);
    if (localized !== codeKey) return localized;
    if (/failed to fetch|networkerror|load failed/i.test(raw)) return t('error.bridgeUnavailable');
    if (/bridge request timed out/i.test(raw)) return t('error.bridgeRequestTimeout');
    if (/timed out|timeout|超时/i.test(raw)) return t('error.requestTimeout');
    if (/pin.*(incorrect|wrong|4|four)|不正确.*pin|pin.*不正确|四位|四位数字|four digit/i.test(raw)) return t('error.invalidPin');
    if (/端口.*1.*65535|port.*between 1 and 65535|invalid.*port/i.test(raw)) return t('error.invalidPort');
    if (/地址.*(无效|不能为空|格式)|invalid.*address|address.*invalid|only supports http|仅支持 http|ipv6.*(?:缺少|格式)/i.test(raw)) return t('error.invalidAddress');
    if (/应用列表|application list|applist/i.test(raw)) return t('error.appsUnavailable');
    if (/serverinfo|无法读取 Sunshine.*主机信息|sunshine.*host information/i.test(raw)) return t('error.sunshineUnavailable');
    if (/certificate.*(?:mismatch|does not match)|证书.*(?:不一致|不匹配)/i.test(raw)) return t('error.certificateMismatch');
    if (/wake[- ]on[- ]lan|mac/i.test(raw)) return t('error.wakeMac');
    if (/rtspenc|加密 RTSP|encrypted RTSP/i.test(raw)) return t('error.rtspUnsupported');
    if (/请先.*配对|pair.*before|not paired|pair required|required.*pair/i.test(raw)) return t('error.notPaired');
    if (/没有.*主机|no host|host.*not found/i.test(raw)) return t('error.noHost');
    if (/配对|pair/i.test(raw)) return t('error.pairFailed');
    if (/sunshine.*(?:http|返回|拒绝|没有建立|did not|returned|rejected)|Sunshine .*协议状态/i.test(raw)) return t('error.sunshineRequestFailed');
    if (/econnrefused|econnreset|ehostunreach|enetunreach|enotfound|getaddrinfo|socket hang up|证书验证/i.test(raw)) return t('error.connectionFailed');
    return raw;
  };

  const hostIsOnline = (host) => Boolean(host && (host.state === 'online' || host.state === 'ready'));
  const hostByRef = (ref) => {
    if (!ref) return state.selectedHost || state.hosts[0] || null;
    return state.hosts.find((host) => host.id === ref || host.name === ref || host.address === ref) || state.selectedHost || null;
  };
  const choosePrimaryHost = () => state.selectedHost = state.selectedHost && state.hosts.find((host) => host.id === state.selectedHost.id) || state.hosts.find(hostIsOnline) || state.hosts[0] || null;
  const currentHost = () => choosePrimaryHost();
  const hostLastSeen = (host) => {
    if (!host || !host.lastSeen) return t('common.none');
    if (host.lastSeen === 'demo') return t('common.demo');
    const date = new Date(host.lastSeen);
    if (Number.isNaN(date.getTime())) return String(host.lastSeen);
    try { return new Intl.DateTimeFormat(window.SunbridgeI18n?.getLocale?.() || 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date); } catch { return date.toLocaleString(); }
  };
  const formatMs = (value) => Number.isFinite(Number(value)) ? String(Math.round(Number(value))) + ' ' + t('common.ms') : '—';
  const formatLoss = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(1) + '%' : '—';
  const hostSummary = (host) => {
    if (!host) return t('overview.noHostMeta');
    return [host.os || t('common.sunshineHost'), host.gpu || t('common.unknownGpu'), host.sunshine || t('common.unknown')].join(' · ');
  };

  const renderStaticCopy = () => {
    const nav = [t('nav.overview'), t('nav.hosts'), t('nav.network'), t('nav.settings'), t('nav.addHost')];
    qsa('.nav-item > span:nth-child(2)').forEach((node, index) => { if (nav[index]) node.textContent = nav[index]; });
    setText('.nav-label:not(.nav-label-spaced)', t('nav.workspace'));
    setText('.nav-label-spaced', t('nav.preferences'));
    setText('.brand-subtitle', t('brand.subtitle'));
    setText('.topbar-kicker', t('topbar.local'));
    setText('.topbar-title', t('topbar.desktop'));
    setText('.profile-meta', t('profile.local'));
    setEyebrow('.eyebrow-row .eyebrow', t('eyebrow.private'));
    setText('.build-chip', t('build.preview'));
    const title = qs('#overview-title');
    if (title) title.innerHTML = esc(t('overview.titleA')) + '<br /><em>' + esc(t('overview.titleB')) + '</em>';
    const intro = qs('.intro-copy');
    if (intro) intro.innerHTML = esc(t('overview.copyA')) + '<br />' + esc(t('overview.copyB'));
    setText('.intro-aside-label', t('overview.lastSession'));
    setText('.hero-overline', t('overview.primaryRig'));
    setText('.hero-stat:nth-child(1) .hero-stat-label', t('overview.targetOutput'));
    setText('.hero-stat:nth-child(2) .hero-stat-label', t('overview.frames'));
    setText('.hero-stat:nth-child(3) .hero-stat-label', t('overview.estimatedPing'));
    const hostTag = qs('.host-tag');
    if (hostTag) hostTag.innerHTML = '<span class="status-dot" id="primaryHostStatusDot"></span>' + esc(t('overview.ready'));
    const hostTransport = qs('.host-transport');
    if (hostTransport) hostTransport.innerHTML = '<span data-icon="lock" aria-hidden="true"></span>' + esc(t('overview.pairedHost'));
    const connect = qs('.hero-actions [data-action="connect"]');
    if (connect) qs('span', connect).textContent = t('action.connectHost');
    const details = qs('.hero-actions [data-action="open-host-details"]');
    if (details) details.innerHTML = esc(t('action.hostDetails')) + '<span data-icon="chevron-right" aria-hidden="true"></span>';
    setText('.signal-card .section-overline', t('signal.health'));
    setText('.signal-card h3', t('signal.cleanPath'));
    setText('.signal-legend span:first-child', t('signal.latency'));
    setText('.signal-legend span:last-child', t('signal.last60'));
    setText('.signal-metrics .metric-label:nth-child(1)', t('signal.jitter'));
    setText('.signal-metrics .metric-label:nth-child(2)', t('signal.loss'));
    setText('.signal-metrics .metric-label:nth-child(3)', t('signal.route'));
    const inspect = qs('.signal-card [data-view-target="network"]');
    if (inspect) inspect.innerHTML = esc(t('action.inspectPath')) + '<span data-icon="arrow-up-right" aria-hidden="true"></span>';
    setText('.library-heading .section-overline', t('library.recent'));
    setText('.library-heading h2', t('library.title'));
    setText('.activity-panel .section-overline', t('activity.log'));
    setText('.activity-panel h2', t('activity.recent'));
    const clear = qs('[data-action="clear-activity"]');
    if (clear) clear.innerHTML = esc(t('activity.clear')) + '<span data-icon="x" aria-hidden="true"></span>';
    setText('.protocol-panel .section-overline', t('protocol.compatibility'));
    setText('.protocol-panel h2', t('protocol.path'));
    setText('.protocol-panel .protocol-note', bridge.isDemo ? t('protocol.noteDemo') : t('protocol.noteLive'));
    const portLink = qs('.protocol-panel [data-view-target="network"]');
    if (portLink) portLink.innerHTML = esc(t('protocol.viewPorts')) + '<span data-icon="arrow-up-right" aria-hidden="true"></span>';
    const protocolNodes = qsa('.protocol-flow .protocol-node');
    const protocolCopy = [
      ['protocol.browser', 'protocol.uiControls'],
      ['protocol.bridge', 'protocol.localApi'],
      ['protocol.sunshine', 'protocol.gameStream'],
    ];
    protocolCopy.forEach(([titleKey, detailKey], index) => {
      const node = protocolNodes[index];
      if (!node) return;
      setText('strong', t(titleKey), node);
      setText('small', t(detailKey), node);
    });
    setEyebrow('[data-view="hosts"] .eyebrow', t('hosts.eyebrow'));
    setText('#hosts-title', t('hosts.title'));
    setText('#hosts-title + p', t('hosts.copy'));
    qsa('[data-view="hosts"] [data-action="open-pair"] span:last-child').forEach((node) => { node.textContent = t('action.addHost'); });
    const transportNote = qs('.info-callout');
    if (transportNote) {
      const strong = qs('strong', transportNote); const p = qs('p', transportNote);
      if (strong) strong.textContent = t('protocol.compatibility');
      if (p) p.textContent = bridge.isDemo ? t('protocol.noteDemo') : t('protocol.noteLive');
    }
    setEyebrow('[data-view="network"] .eyebrow', t('network.eyebrow'));
    setText('#network-title', t('network.title'));
    setText('#network-title + p', t('network.copy'));
    qsa('[data-view="network"] [data-action="run-diagnostic"]').forEach((node) => { node.innerHTML = '<span data-icon="pulse" aria-hidden="true"></span>' + esc(t('network.diagnostic')); });
    const network = qs('[data-view="network"]');
    if (network) {
      setText('.network-map-panel .section-overline', t('network.requestSession'), network);
      setText('.network-map-panel h2', t('network.browserToBridgeHost'), network);
      setText('.map-browser strong', t('network.webClient'), network);
      setText('.map-browser span', t('network.httpsUi'), network);
      setText('.map-bridge strong', t('network.localBridge'), network);
      setText('.map-bridge span', t('network.websocketDecode'), network);
      setText('.port-panel .section-overline', t('network.sunshineDefaults'), network);
      setText('.port-panel h2', t('network.portMap'), network);
      const copyPortsButton = qs('[data-action="copy-ports"]', network);
      if (copyPortsButton) copyPortsButton.innerHTML = esc(t('network.copyPorts')) + '<span data-icon="copy" aria-hidden="true"></span>';
      setText('.diagnostic-log-head span:first-child', t('network.liveDiagnostic'), network);
    }
    setText('.settings-saved-text', t('settings.autosaved'));
    setEyebrow('[data-view="settings"] .eyebrow', t('settings.eyebrow'));
    setText('#settings-title', t('settings.title'));
    setText('#settings-title + p', t('settings.copy'));
    const cards = qsa('.settings-card');
    if (cards[0]) {
      setText('.section-overline', t('settings.video'), cards[0]);
      setText('h2', t('settings.outputDefaults'), cards[0]);
      const outputRows = qsa('.setting-row', cards[0]);
      const outputCopy = [
        ['settings.resolution', 'settings.resolutionHint'],
        ['settings.frameRate', 'settings.frameRateHint'],
        ['settings.codec', 'settings.codecHint'],
      ];
      outputCopy.forEach(([titleKey, hintKey], index) => {
        const row = outputRows[index];
        if (!row) return;
        setText('strong', t(titleKey), row);
        setText('small', t(hintKey), row);
      });
    }
    if (cards[1]) { setText('.section-overline', t('settings.inputUi'), cards[1]); setText('h2', t('settings.session'), cards[1]); }
    const settingText = [
      ['[data-toggle="match-display"]', 'settings.matchDisplay', 'settings.matchDisplayHint'],
      ['[data-toggle="capture-pointer"]', 'settings.capturePointer', 'settings.capturePointerHint'],
      ['[data-toggle="show-telemetry"]', 'settings.telemetry', 'settings.telemetryHint'],
      ['[data-toggle="ask-launch"]', 'settings.askLaunch', 'settings.askLaunchHint'],
      ['[data-toggle="reduce-motion"]', 'settings.reduceMotion', 'settings.reduceMotionHint'],
    ];
    settingText.forEach(([selector, titleKey, hintKey]) => { const toggle = qs(selector); if (!toggle) return; const row = toggle.closest('.setting-row'); setText('strong', t(titleKey), row); setText('small', t(hintKey), row); });
    const rowCopy = [['#controlModeRow', 'settings.controlMode', 'settings.controlModeHint'], ['#bitrateModeRow', 'settings.bitrateMode', 'settings.bitrateModeHint']];
    rowCopy.forEach(([selector, titleKey, hintKey]) => { const row = qs(selector); if (!row) return; setText('strong', t(titleKey), row); setText('small', t(hintKey), row); });
    const optionCopy = { '#resolutionSelect option[value="auto"]': 'settings.adaptiveWindow', '#controlModeSelect option[value="auto"]': 'control.auto', '#controlModeSelect option[value="desktop"]': 'control.desktop', '#controlModeSelect option[value="game"]': 'control.game', '#bitrateModeSelect option[value="auto"]': 'bitrate.auto', '#codecSelect option[value="auto"]': 'codec.auto', '#bitrateModeSelect option[value="fixed"]': 'bitrate.fixed' };
    Object.entries(optionCopy).forEach(([selector, key]) => setText(selector, t(key)));
    setText('.settings-footnote p', t('settings.footnote'));
    const drawer = qs('#settingsDrawer');
    if (drawer) {
      setText('.section-overline', t('drawer.quick'), drawer);
      setText('.drawer-head h2', t('drawer.defaults'), drawer);
      qsa('.drawer-section-label', drawer).forEach((node, index) => { node.textContent = index === 0 ? t('settings.video') : t('settings.inputUi'); });
      setText('.drawer-footer .text-button', t('drawer.openAll'), drawer);
      const drawerRows = qsa('.drawer-setting', drawer);
      if (drawerRows[0]) setText('span', t('drawer.quality'), drawerRows[0]);
      if (drawerRows[1]) setText('span', t('drawer.hdr'), drawerRows[1]);
      if (drawerRows[2]) setText('span', t('drawer.pointer'), drawerRows[2]);
      if (drawerRows[3]) setText('span', t('drawer.stats'), drawerRows[3]);
    }
    const modal = qs('#pairModal');
    if (modal) {
      setText('.modal-eyebrow', t('pair.newHost'), modal); setText('#pair-title', t('pair.title'), modal); setText('.modal-copy', t('pair.copy'), modal);
      const steps = qsa('.pair-step small', modal); [t('pair.discover'), t('pair.pair'), t('pair.sync')].forEach((value, index) => { if (steps[index]) steps[index].textContent = value; });
      setText('label:nth-of-type(1) > span', t('pair.address'), modal); setText('.form-grid label:nth-child(1) > span', t('pair.displayName'), modal); setText('.form-grid label:nth-child(2) > span', t('pair.pin'), modal); setText('.pair-note span:last-child', t('pair.note'), modal); setText('#pairForm button[type="submit"] span:first-child', t('pair.submit'), modal); const closeButton = qs('.modal-close', modal); if (closeButton) closeButton.setAttribute('aria-label', t('pair.close'));
    }
    const stream = qs('#streamOverlay');
    if (stream) {
      setText('#streamLiveLabel', t('common.live'), stream);
      setText('#streamEndLabel', t('session.end'), stream);
      setText('#streamHint', t('session.pointerHint'), stream);
      setText('#streamControlBadge', t('session.controlPlane'), stream);
      setText('#streamRtspBadge', t('session.rtspProbing'), stream);
      setText('#streamMediaBadge', t('session.mediaNotConnected'), stream);
      setText('#streamInputBadge', t('session.inputNotConnected'), stream);
      setText('#streamFpsLabel', t('common.fps'), stream);
      setText('#streamLatencyLabel', t('signal.latency'), stream);
      setText('#streamBitrateLabel', t('common.bitrate'), stream);
    }
    hydrateIcons();
  };

  const renderBridgeStatus = () => {
    const online = Boolean(state.health?.ok);
    const initializing = Boolean(state.loading && !state.health);
    const label = initializing ? t('bridge.initializing') : online ? t('bridge.online') : t('bridge.offline');
    const meta = initializing ? t('bridge.initializingMeta') : online ? (bridge.isDemo ? t('bridge.demoMeta') : t('bridge.liveMeta')) : t('bridge.startHint');
    const dot = qs('#bridgeStatusDot') || qs('.bridge-title .status-dot');
    setStatusDot(dot, initializing ? 'checking' : online ? 'online' : 'offline');
    setText('#bridgeStatusLabel', label);
    setText('#bridgeStatusMeta', meta);
    if (!qs('#bridgeStatusLabel')) { const title = qs('.bridge-title'); if (title) title.innerHTML = '<span class="status-dot" id="bridgeStatusDot"></span>' + esc(label); }
    if (!qs('#bridgeStatusMeta')) setText('.bridge-meta', meta);
    const connectionPill = qs('.connection-pill');
    if (connectionPill) connectionPill.title = t('aria.bridgeStatus');
    const connectionDot = qs('#connectionStatusDot') || qs('.connection-pill .status-dot');
    setStatusDot(connectionDot, initializing ? 'checking' : online ? 'online' : 'offline');
    setText('#connectionStatusLabel', label);
    if (!qs('#connectionStatusLabel')) { const pill = qs('.connection-pill'); if (pill) { const span = qsa('span', pill)[1]; if (span) span.textContent = label; } }
    setText('#connectionLatency', state.diagnostic.result ? formatMs(state.diagnostic.result.latency) : '—');
    if (!qs('#connectionLatency')) setText('.connection-latency', state.diagnostic.result ? formatMs(state.diagnostic.result.latency) : '—');
    const drawerDot = qs('#drawerBridgeStatusDot') || qs('.drawer-status .status-dot');
    setStatusDot(drawerDot, initializing ? 'checking' : online ? 'online' : 'offline');
    setText('#drawerBridgeStatus', initializing ? t('bridge.initializing') : online ? t('drawer.ready') : t('bridge.offline'));
    setText('#drawerBridgeMeta', initializing ? t('bridge.initializingMeta') : online ? t('drawer.responds', { latency: state.diagnostic.result ? formatMs(state.diagnostic.result.latency) : '—' }) : t('bridge.startHint'));
    setText('#protocolBadge', bridge.isDemo ? t('protocol.demo') : t('protocol.live'));
  };

  const renderPrimaryHost = () => {
    const host = currentHost();
    const online = hostIsOnline(host);
    const dot = qs('#primaryHostStatusDot') || qs('.host-tag .status-dot');
    setStatusDot(dot, online ? 'online' : 'offline');
    setText('#primaryHostName', host ? host.name : t('overview.noHost'));
    if (!qs('#primaryHostName')) setText('.hero-heading-wrap h2', host ? host.name : t('overview.noHost'));
    setText('#primaryHostMeta', host ? hostSummary(host) : t('overview.noHostMeta'));
    if (!qs('#primaryHostMeta')) setText('.hero-heading-wrap p', host ? hostSummary(host) : t('overview.noHostMeta'));
    setText('#primaryHostStatus', host ? (online ? t('overview.ready') : t('common.offline')) : t('overview.noHostStatus'));
    setText('#primaryHostTransport', host?.paired ? t('overview.pairedHost') : t('host.unpaired'));
    setText('#primaryHostOutput', host ? (state.settings.resolution === 'auto' ? t('settings.adaptiveShort') : state.settings.height + 'p') : '—');
    setText('#primaryHostFps', host ? String(state.settings.fps) : '—');
    setText('#primaryHostPing', state.diagnostic.result ? formatMs(state.diagnostic.result.latency) : '—');
    const button = qs('.hero-actions [data-action="connect"]');
    if (button) { button.dataset.host = host?.id || ''; button.disabled = !online; button.setAttribute('aria-disabled', String(!online)); }
    const detailButton = qs('.hero-actions [data-action="open-host-details"]');
    if (detailButton) { detailButton.dataset.host = host?.id || ''; detailButton.disabled = !host; }
    const aside = qs('.intro-aside-value'); const asideMeta = qs('.intro-aside-meta');
    const sessionActivity = state.activity.find((item) => item.detailKey === 'activity.sessionEnded');
    if (sessionActivity) { const date = new Date(sessionActivity.at); setTextNode(aside, formatDate(date), ' · ' + formatTime(date)); setText(asideMeta, t(sessionActivity.detailKey, sessionActivity.params)); }
    else { setText(aside, t('common.none')); setText(asideMeta, host ? t('overview.noSessionMeta') : t('overview.noHostMeta')); }
    const consoleReadout = qs('.screen-readout'); if (consoleReadout) consoleReadout.innerHTML = esc(online ? t('session.controlPlane') : t('session.notStreaming')) + '<br /><strong>' + esc(host ? state.settings.width + ' / ' + state.settings.height : '—') + '</strong>';
    const consoleFooter = qs('.console-footer'); if (consoleFooter) consoleFooter.innerHTML = '<span>' + esc(t('session.controlPlane')) + '</span><span>' + esc(t('session.mediaPlane')) + '</span><span>' + esc(t('session.inputPlane')) + '</span>';
  };

  const formatDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return t('common.none');
    try { return new Intl.DateTimeFormat(window.SunbridgeI18n?.getLocale?.() || 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date); } catch { return date.toLocaleDateString(); }
  };
  const formatTime = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try { return new Intl.DateTimeFormat(window.SunbridgeI18n?.getLocale?.() || 'zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date); } catch { return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  };
  const setTextNode = (node, first, second) => { if (node) node.textContent = String(first || '') + String(second || ''); };

  const renderSignal = () => {
    const result = state.diagnostic.result;
    const chart = qs('.signal-chart');
    if (chart) chart.classList.toggle('is-empty', !result);
    const signalTitle = qs('.signal-card h3');
    if (signalTitle) signalTitle.textContent = result ? (Number(result.loss || 0) > 0 ? t('signal.degradedPath') : t('signal.cleanPath')) : t('signal.waiting');
    setText('.chart-tooltip strong', result ? formatMs(result.latency) : '—');
    setText('.chart-tooltip span', result ? t('common.now') : t('diagnostic.waiting'));
    const metrics = qsa('.signal-metrics strong');
    if (metrics[0]) metrics[0].textContent = result ? formatMs(result.jitter) : '—';
    if (metrics[1]) metrics[1].textContent = result ? formatLoss(result.loss) : '—';
    if (metrics[2]) metrics[2].textContent = result?.route || '—';
    setText('#signalTooltipValue', result ? formatMs(result.latency) : '—');
    setText('#signalTooltipTime', result ? t('common.now') : t('diagnostic.waiting'));
  };

  // A plain app icon: the first letter on a colour picked from the name (stable across renders).
  const gameArt = (index, name) => {
    const text = String(name || t('common.desktop')).trim();
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return '<span class="app-tile" data-tone="' + (hash % 6) + '" aria-hidden="true">' + esc((Array.from(text)[0] || '?').toUpperCase()) + '</span>';
  };

  const renderLibrary = () => {
    const host = currentHost();
    const library = qs('#gameLibrary') || qs('.game-grid');
    if (!library) return;
    const apps = Array.isArray(host?.apps) ? host.apps : [];
    const count = qs('#libraryCount') || qs('.library-count');
    if (count) count.textContent = t('library.synced', { count: apps.length });
    if (!apps.length) {
      library.innerHTML = '<div class="activity-empty"><strong>' + esc(t('library.empty')) + '</strong><span>' + esc(host ? t('library.emptyHint') : t('overview.noHostMeta')) + '</span></div>';
      return;
    }
    library.innerHTML = apps.map((app, index) => {
      const name = app.name || t('common.desktop');
      const recent = index === 0 ? t('library.lastPlayed', { time: t('common.now') }) : t('library.available');
      return '<article class="game-card ' + (index === 0 ? 'game-card-featured' : '') + '" data-game="app-' + esc(app.id) + '"><div class="game-art">' + gameArt(index, name) + '</div><div class="game-info"><div><h3>' + esc(name) + '</h3><p>' + esc(recent) + '</p></div><button class="play-button" type="button" data-action="connect" data-host="' + esc(host.id) + '" data-app-id="' + esc(app.id) + '" data-app="' + esc(name) + '" aria-label="' + esc(t('library.play', { name })) + '"><span data-icon="play" aria-hidden="true"></span></button></div></article>';
    }).join('');
    hydrateIcons(library);
  };

  const hostStatus = (host) => {
    if (host.state === 'online' || host.state === 'ready') return { key: 'host.online', className: 'online', dot: 'online' };
    if (host.state === 'waking') return { key: 'host.waking', className: 'offline', dot: 'waking' };
    if (host.state === 'sleeping') return { key: 'host.sleeping', className: 'offline', dot: 'offline' };
    if (!host.paired) return { key: 'host.unpaired', className: 'offline', dot: 'offline' };
    return { key: 'common.offline', className: 'offline', dot: 'offline' };
  };

  const hostAction = (host, status) => {
    if (hostIsOnline(host)) return '<button class="secondary-button" type="button" data-action="connect" data-host="' + esc(host.id) + '" data-app="Desktop">' + esc(t('host.connect')) + '<span data-icon="arrow-up-right" aria-hidden="true"></span></button>';
    if (host.mac) return '<button class="secondary-button" type="button" data-action="wake-host" data-host="' + esc(host.id) + '">' + esc(t('host.wake')) + '<span data-icon="sun" aria-hidden="true"></span></button>';
    return '<button class="secondary-button" type="button" data-action="refresh-host" data-host="' + esc(host.id) + '">' + esc(t('host.refresh')) + '<span data-icon="pulse" aria-hidden="true"></span></button>';
  };

  const renderHosts = () => {
    const list = qs('#hostList');
    if (!list) return;
    const count = qs('.nav-count'); if (count) count.textContent = String(state.hosts.length);
    if (!state.hosts.length) {
      list.innerHTML = '<div class="activity-empty"><strong>' + esc(t('host.noHosts')) + '</strong><span>' + esc(t('host.noHostsHint')) + '</span><button class="primary-button" type="button" data-action="open-pair"><span data-icon="plus"></span>' + esc(t('action.addHost')) + '</button></div>';
      hydrateIcons(list);
      return;
    }
    list.innerHTML = state.hosts.map((host, index) => {
      const status = hostStatus(host);
      const online = hostIsOnline(host);
      const tags = [host.gpu || t('common.unknownGpu'), host.mac ? t('host.wol') : t('host.lan'), host.lastSeen ? t('host.lastSeen', { time: hostLastSeen(host) }) : t('common.none')];
      return '<article class="host-row ' + (index === 0 ? 'is-primary' : '') + '"><div class="host-row-orb ' + (index ? 'orb-secondary' : '') + '"><span data-icon="host" aria-hidden="true"></span></div><div class="host-row-main"><div class="host-row-title"><h2>' + esc(host.name || host.address) + '</h2><span class="host-chip ' + status.className + '"><span class="status-dot ' + (status.dot === 'online' ? 'is-green' : '') + '"></span> ' + esc(t(status.key)) + '</span>' + (host.paired ? '<span class="host-chip paired"><span data-icon="lock" aria-hidden="true"></span> ' + esc(t('host.paired')) + '</span>' : '') + '</div><p>' + esc(host.address + ' · ' + (host.os || t('common.sunshineHost')) + ' · ' + (host.sunshine || t('common.unknown'))) + '</p><div class="host-row-tags">' + tags.map((tag) => '<span>' + esc(tag) + '</span>').join('') + '</div></div><div class="host-row-actions">' + hostAction(host, status) + '<button class="icon-button" type="button" data-action="open-host-details" data-host="' + esc(host.id) + '" aria-label="' + esc(t('toast.hostDetails')) + '"><span data-icon="more" aria-hidden="true"></span></button></div></article>';
    }).join('');
    hydrateIcons(list);
  };

  const renderNetwork = () => {
    const host = currentHost();
    const result = state.diagnostic.result;
    const isDemoResult = Boolean(result?.demo);
    const controlProtocol = String(result?.controlProtocol || (host?.paired ? 'https' : 'http')).toUpperCase();
    const controlPort = result?.controlPort || (controlProtocol === 'HTTPS' ? host?.httpsPort : host?.httpPort);
    const rtspPort = result?.rtsp?.port || host?.rtspPort || 48010;
    const controlReachable = isDemoResult ? null : Array.isArray(result?.probes) && result.probes.some((probe) => probe?.ok);
    const rtspReachable = isDemoResult ? null : result?.rtsp ? Boolean(result.rtsp.ok) : null;
    const probeLabel = (reachable) => reachable == null ? t('diagnostic.waiting') : reachable ? t('diagnostic.reachable') : t('diagnostic.unreachable');
    setText('#latencyValue', result ? formatMs(result.latency) : '—');
    const cards = qsa('.network-summary-card');
    if (cards[0]) { setText('div span', t('signal.latency'), cards[0]); setText('strong', result ? formatMs(result.latency) : '—', cards[0]); setText('small', state.diagnostic.status === 'running' ? t('network.running') : isDemoResult ? t('network.demo') : result ? t('network.healthy') : t('diagnostic.waiting'), cards[0]); }
    if (cards[1]) { setText('div span', t('network.linkQuality'), cards[1]); setText('strong', isDemoResult ? t('network.demo') : result ? (Number(result.loss || 0) > 0 ? t('network.degraded') : t('network.excellent')) : '—', cards[1]); setText('small', isDemoResult ? t('network.notProbed') : result ? (String(result.route).toUpperCase() === 'LAN' ? t('common.local') : t('common.remote')) : '—', cards[1]); }
    if (cards[2]) { setText('div span', t('network.pairing'), cards[2]); setText('strong', host?.paired ? t('host.paired') : '—', cards[2]); setText('small', host?.serverFingerprint ? t('network.certificate') : isDemoResult ? t('network.demo') : '—', cards[2]); }
    setText('#networkHostName', host ? host.name : t('overview.noHost'));
    setText('#networkHostAddress', host ? host.address : t('diagnostic.noHost'));
    if (!qs('#networkHostName')) { const node = qs('.map-host'); if (node) { setText('strong', host ? host.name : t('overview.noHost'), node); setText('span', host ? (host.sunshine || t('common.sunshine')) : t('diagnostic.noHost'), node); } }
    const legend = qs('.map-legend'); if (legend) legend.innerHTML = '<span><i class="legend-dot is-green"></i> ' + esc(t('network.paired')) + '</span><span><i class="legend-dot is-blue"></i> ' + esc(t('network.controlOnly')) + '</span>';
    const log = qs('#diagnosticLog');
    if (log) {
      const status = qs('#diagnosticStatus', log); if (status) status.textContent = t(state.diagnostic.status === 'running' ? 'network.running' : state.diagnostic.status === 'healthy' ? 'network.healthy' : state.diagnostic.status === 'demo' ? 'network.demo' : state.diagnostic.status === 'failed' ? 'diagnostic.failed' : 'network.idle');
      const lines = qs('.log-lines', log);
      if (lines) {
        if (!host) {
          lines.innerHTML = '<div><time>—</time><span class="log-ok">--</span><code>' + esc(t('diagnostic.noHost')) + '</code><small>—</small></div>';
        } else if (state.diagnostic.status === 'running') {
          lines.innerHTML = '<div><time>…</time><span class="log-ok">--</span><code>bridge.ping("' + esc(host.address) + '")</code><small>' + esc(t('network.running')) + '</small></div>';
        } else if (result) {
          const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const controlClass = isDemoResult ? 'log-muted' : controlReachable ? 'log-ok' : 'log-error';
          const rtspClass = isDemoResult ? 'log-muted' : rtspReachable ? 'log-ok' : 'log-error';
          const controlStatus = isDemoResult ? t('diagnostic.demo') : probeLabel(controlReachable);
          const rtspStatus = isDemoResult ? t('diagnostic.demo') : probeLabel(rtspReachable);
          const controlTarget = controlPort ? controlProtocol.toLowerCase() + ':' + controlPort : controlProtocol.toLowerCase();
          const rtspTarget = host.address + ':' + rtspPort;
          lines.innerHTML = '<div><time>' + esc(now) + '</time><span class="log-ok">OK</span><code>bridge.health()</code><small>' + esc(bridge.isDemo ? t('bridge.demoMeta') : t('bridge.online')) + '</small></div>'
            + '<div><time>—</time><span class="' + controlClass + '">' + esc(isDemoResult ? 'DEMO' : controlReachable ? 'OK' : 'ERR') + '</span><code>sunshine.control("' + esc(controlTarget) + '")</code><small>' + esc(controlStatus + (result.latency != null ? ' · ' + formatMs(result.latency) : '')) + '</small></div>'
            + '<div><time>—</time><span class="' + rtspClass + '">' + esc(isDemoResult ? 'DEMO' : rtspReachable ? 'OK' : 'ERR') + '</span><code>sunshine.rtsp("' + esc(rtspTarget) + '")</code><small>' + esc(rtspStatus + (result.rtsp?.elapsedMs != null ? ' · ' + formatMs(result.rtsp.elapsedMs) : '')) + '</small></div>';
        } else {
          lines.innerHTML = '<div><time>—</time><span class="log-ok">--</span><code>bridge.ping("' + esc(host.address) + '")</code><small>' + esc(state.diagnostic.error || t('diagnostic.waiting')) + '</small></div>';
        }
      }
    }
    renderPortTable(host, result);
  };

  const renderPortTable = (host, result = state.diagnostic.result) => {
    const table = qs('#portTable');
    if (!table) return;
    const isDemoResult = Boolean(result?.demo);
    const controlProtocol = String(result?.controlProtocol || (host?.paired ? 'https' : 'http')).toUpperCase();
    const controlReachable = isDemoResult ? null : Array.isArray(result?.probes) && result.probes.some((probe) => probe?.ok);
    const rtspReachable = isDemoResult ? null : result?.rtsp ? Boolean(result.rtsp.ok) : null;
    const stateFor = (reachable, fallback = t('network.waiting')) => {
      if (isDemoResult) return { label: t('network.demo'), className: 'is-muted is-demo' };
      if (reachable == null) return { label: fallback, className: 'is-muted' };
      return reachable ? { label: t('diagnostic.reachable'), className: 'is-ok' } : { label: t('diagnostic.unreachable'), className: 'is-error' };
    };
    const controlState = result ? stateFor(controlReachable) : stateFor(null);
    const rtspState = result?.rtsp || isDemoResult ? stateFor(rtspReachable) : stateFor(null);
    const unprobed = { label: t('network.notProbed'), className: 'is-muted' };
    const httpsState = controlProtocol === 'HTTPS' ? controlState : host ? unprobed : stateFor(null);
    const httpState = controlProtocol === 'HTTP' ? controlState : host ? unprobed : stateFor(null);
    const ports = [
      ['HTTPS', host?.httpsPort || 47984, 'TCP', httpsState, ''],
      ['HTTP', host?.httpPort || 47989, 'TCP', httpState, ''],
      [t('network.webUi'), 47990, 'TCP', unprobed, ''],
      ['RTSP', host?.rtspPort || 48010, 'TCP', rtspState, 'is-blue'],
      [t('common.video'), 47998, 'UDP', unprobed, 'is-blue'],
      [t('common.input'), 47999, 'UDP', unprobed, 'is-blue'],
      [t('common.audio'), 48000, 'UDP', unprobed, 'is-blue'],
    ];
    table.innerHTML = '<div class="port-row port-head"><span>' + esc(t('network.service')) + '</span><span>' + esc(t('network.port')) + '</span><span>' + esc(t('network.transport')) + '</span><span>' + esc(t('network.state')) + '</span></div>' + ports.map((row) => '<div class="port-row"><span>' + esc(row[0]) + '</span><strong>' + esc(row[1]) + '</strong><span>' + esc(row[2]) + '</span><span class="port-state ' + row[4] + ' ' + row[3].className + '"><i></i> ' + esc(row[3].label) + '</span></div>').join('');
  };

  const renderActivity = () => {
    const list = qs('#activityList');
    if (!list) return;
    if (!state.activity.length) { list.innerHTML = '<div class="activity-empty">' + esc(t('activity.empty')) + '</div>'; return; }
    list.innerHTML = state.activity.slice(0, 6).map((item) => {
      const date = new Date(item.at);
      const when = Number.isNaN(date.getTime()) ? t('common.none') : formatDate(date);
      return '<div class="activity-item"><div class="activity-icon activity-icon-' + esc(item.icon || 'check') + '"><span data-icon="' + esc(item.icon || 'check') + '" aria-hidden="true"></span></div><div class="activity-copy"><strong>' + esc(item.title || '') + '</strong><span>' + esc(t(item.detailKey, item.params || {})) + '</span></div><time>' + esc(when) + '</time></div>';
    }).join('');
    hydrateIcons(list);
  };

  const saveSettings = () => {
    try { localStorage.setItem('sunbridge.settings.v1', JSON.stringify(state.settings)); } catch { /* private mode */ }
  };
  const resolutionLabel = () => (state.settings.resolution === 'auto' ? t('settings.adaptive') : state.settings.width + '×' + state.settings.height);

  const renderSettings = () => {
    const resolution = qs('#resolutionSelect') || qsa('.settings-card .setting-row select')[0];
    const fps = qs('#fpsSelect') || qsa('.settings-card .setting-row select')[1];
    if (resolution) resolution.value = state.settings.resolution === 'auto' ? 'auto' : state.settings.width + 'x' + state.settings.height;
    if (fps) fps.value = String(state.settings.fps);
    const controlMode = qs('#controlModeSelect'); if (controlMode) controlMode.value = state.settings.controlMode;
    const bitrateMode = qs('#bitrateModeSelect'); if (bitrateMode) bitrateMode.value = state.settings.bitrateMode;
    const codec = qs('#codecSelect'); if (codec) codec.value = state.settings.codec;
  };

  const renderStream = (phase = 'idle') => {
    const stream = qs('#streamOverlay');
    if (!stream) return;
    const host = state.streamHost;
    const app = state.streamApp;
    const session = state.streamSession || {};
    const transport = session.transport || {};
    const rtsp = transport.rtsp || {};
    const media = transport.media || {};
    const video = media.video || {};
    const audio = media.audio || {};
    const gateway = media.gateway || {};
    const rtspState = String(rtsp.state || (phase === 'negotiating' ? 'probing' : 'unknown')).toLowerCase();
    const mediaState = String(media.state || 'not-connected').toLowerCase();
    const inputState = String(transport.input?.state || 'not-connected').toLowerCase();
    const gatewayState = String(state.mediaGatewayState || gateway.state || (phase === 'negotiating' ? 'waiting' : 'unknown')).toLowerCase();
    const decoderState = String(state.videoDecoderState || (bridge.isDemo ? 'demo' : 'waiting-keyframe')).toLowerCase();
    const audioDecoderState = String(state.audioDecoderState || (bridge.isDemo ? 'demo' : 'waiting')).toLowerCase();
    const audioOutputState = audioDecoderState === 'playing'
      ? 'active'
      : audioDecoderState === 'autoplay-blocked'
        ? 'blocked'
        : audioDecoderState === 'unsupported' || audioDecoderState === 'decode-error'
          ? 'unavailable'
          : bridge.isDemo
            ? 'demo'
            : 'pending';
    const rtspLabels = {
      probing: t('session.rtspProbing'),
      negotiated: t('session.rtspNegotiated'),
      connected: t('session.rtspConnected'),
      failed: t('session.rtspFailed'),
      unsupported: t('session.rtspUnsupported'),
      demo: t('session.rtspDemo'),
      unknown: t('session.rtspUnknown'),
    };
    const mediaLabels = {
      waiting: t('session.mediaWaiting'),
      'not-connected': t('session.mediaNotConnected'),
      connected: t('session.mediaConnected'),
      demo: t('session.mediaDemo'),
      unknown: t('session.mediaUnknown'),
    };
    const gatewayLabels = {
      waiting: t('session.mediaGatewayWaiting'),
      connected: t('session.mediaGatewayConnected'),
      disconnected: t('session.mediaGatewayDisconnected'),
      unsupported: t('session.mediaGatewayUnsupported'),
      failed: t('session.mediaGatewayFailed'),
      demo: t('session.mediaDemo'),
      unknown: t('session.mediaGatewayWaiting'),
    };
    const inputLabels = {
      'not-connected': t('session.inputNotConnected'),
      connected: state.inputController?.stats?.pointerLocked ? t('session.inputCaptured') : t('session.inputConnected'),
      connecting: t('session.inputConnecting'),
      waiting: t('session.inputConnecting'),
      failed: t('session.inputFailed'),
      demo: t('session.inputDemo'),
      unknown: t('session.inputUnknown'),
    };
    const decoderLabels = {
      unsupported: t('session.videoDecoderUnsupported'),
      'waiting-keyframe': t('session.videoWaitingForKeyframe'),
      receiving: t('session.videoWaitingForKeyframe'),
      playing: t('session.videoPlaying'),
      'decode-error': t('session.videoDecodeFailed'),
      stopped: '—',
      demo: t('session.mediaDemo'),
      unknown: '—',
    };
    const audioDecoderLabels = {
      waiting: t('session.audioWaiting'),
      receiving: t('session.audioReceiving'),
      playing: t('session.audioPlaying'),
      unsupported: t('session.audioUnsupported'),
      'autoplay-blocked': t('session.audioAutoplayBlocked'),
      'decode-error': t('session.audioDecodeFailed'),
      stopped: '—',
      demo: t('session.mediaDemo'),
      unknown: '—',
    };
    const audioOutputLabels = {
      active: t('session.audioOutputActive'),
      pending: t('session.audioOutputPending'),
      blocked: t('session.audioOutputBlocked'),
      unavailable: t('session.audioOutputUnavailable'),
      demo: t('session.mediaDemo'),
      unknown: '—',
    };
    const rtspLabel = rtspLabels[rtspState] || `${t('session.rtspPrefix')} / ${rtspState.toUpperCase()}`;
    const mediaLabel = mediaLabels[mediaState] || `${t('session.mediaPrefix')} / ${mediaState.toUpperCase()}`;
    const gatewayLabel = gatewayLabels[gatewayState] || `${t('session.browserMedia')} / ${gatewayState.toUpperCase()}`;
    const inputLabel = inputLabels[inputState] || `${t('session.inputPrefix')} / ${inputState.toUpperCase()}`;
    const decoderLabel = decoderLabels[decoderState] || decoderState.toUpperCase();
    const audioDecoderLabel = audioDecoderLabels[audioDecoderState] || audioDecoderState.toUpperCase();
    const audioOutputLabel = audioOutputLabels[audioOutputState] || audioOutputState.toUpperCase();
    const hasControl = Boolean(state.streamSession) && phase !== 'negotiating';
    const setStreamBadge = (selector, label, stateValue) => {
      const node = qs(selector, stream);
      if (!node) return;
      node.textContent = label;
      node.dataset.state = stateValue;
    };
    setText('#streamSessionName', app ? String(app.name || app).toUpperCase() + ' ' + t('session.session').toUpperCase() : t('session.session').toUpperCase());
    setText('#streamLiveLabel', t('common.live'));
    setText('#streamEndLabel', t('session.end'));
    setStreamBadge('#streamControlBadge', hasControl ? t('session.controlPlane') : t('session.controlStarting'), hasControl ? 'connected' : 'starting');
    setStreamBadge('#streamRtspBadge', rtspLabel, rtspState);
    setStreamBadge('#streamMediaBadge', mediaLabel, mediaState);
    setStreamBadge('#streamGatewayBadge', gatewayLabel, gatewayState);
    setStreamBadge('#streamInputBadge', inputLabel, inputState);
    setText('#streamFooterStatus', host ? host.name + ' · ' + (hasControl ? t('session.controlPlane') : t('session.controlStarting')) : t('session.controlPlane'));
    const shown = state.streamSession?.width ? state.streamSession : effectiveStream(state.streamHost);
    setText('#streamFooterResolution', shown.width + '×' + shown.height + ' / ' + shown.fps + ' fps');
    setText('#streamFooterTransport', bridge.isDemo ? t('protocol.demo') : t('protocol.live'));
    setText('#streamFooterBridge', bridge.isDemo ? t('app.modeDemo') : t('app.modeLive'));
    setText('#streamHint', t('session.pointerHint'));
    state.streamStatusRows = [
      [t('stats.rtsp'), rtspLabel, rtspState],
      [t('stats.videoDecoder'), decoderLabel, decoderState],
      [t('stats.audio'), audioDecoderLabel + ' · ' + audioOutputLabel, audioDecoderState],
      [t('stats.input'), inputLabel, inputState],
      [t('stats.gateway'), gatewayLabel, gatewayState],
    ];
    const status = qs('#streamCenterStatus');
    if (status) {
      const gatewayError = gatewayState === 'failed' || gatewayState === 'unsupported' || gatewayState === 'disconnected';
      const decoderError = decoderState === 'decode-error' || decoderState === 'unsupported';
      const isError = rtspState === 'failed' || rtspState === 'unsupported' || gatewayError || decoderError;
      const isMediaConnected = mediaState === 'connected';
      const isDecoderPlaying = decoderState === 'playing';
      const isRtspNegotiated = rtspState === 'negotiated' || rtspState === 'connected';
      const isPending = !isError && !isDecoderPlaying && (phase === 'negotiating' || rtspState === 'probing' || mediaState === 'waiting' || gatewayState === 'waiting' || decoderState === 'waiting-keyframe');
      status.classList.toggle('is-error', isError);
      status.classList.toggle('is-connected', isDecoderPlaying);
      status.classList.toggle('is-probed', isRtspNegotiated && !isMediaConnected && !isDecoderPlaying);
      status.classList.toggle('is-pending', isPending);
      status.classList.toggle('is-demo', bridge.isDemo);
      let message = t('session.controlPlane');
      if (phase === 'negotiating' && !state.streamSession) message = t('session.negotiating');
      else if (rtspState === 'probing') message = t('session.rtspDetail');
      else if (rtspState === 'failed') message = t('session.rtspFailedDetail');
      else if (rtspState === 'unsupported') message = t('session.rtspUnsupportedDetail');
      else if (gatewayState === 'unsupported') message = t('session.browserMediaUnsupported');
      else if (gatewayState === 'failed') message = t('session.browserMediaFailed');
      else if (gatewayState === 'disconnected') message = t('session.browserMediaDisconnected');
      else if (decoderState === 'unsupported') message = t('session.videoDecoderUnsupported');
      else if (decoderState === 'decode-error') message = t('session.videoDecodeFailed');
      else if (decoderState === 'playing') message = t('session.videoPlaying');
      else if (gatewayState === 'connected' && mediaState === 'connected' && decoderState === 'waiting-keyframe') message = t('session.videoWaitingForKeyframe');
      else if (gatewayState === 'connected') message = t('session.browserMediaConnected');
      else if (rtspState === 'negotiated' && mediaState === 'waiting') message = t('session.mediaWaitingDetail');
      else if (rtspState === 'connected') message = t('session.rtspConnectedDetail');
      else if (mediaState === 'connected') message = t('session.mediaConnectedDetail');
      else if (bridge.isDemo) message = t('session.demoDetail');
      else message = t('session.notStreaming');
      status.innerHTML = '<div class="stream-spinner"></div><span>' + esc(message) + '</span>';
    }
    const enableAudio = qs('#streamEnableAudio', stream);
    if (enableAudio) enableAudio.hidden = audioDecoderState !== 'autoplay-blocked';
    stream.dataset.phase = phase;
    stream.dataset.rtspState = rtspState;
    stream.dataset.mediaState = mediaState;
    stream.dataset.gatewayState = gatewayState;
    stream.dataset.decoderState = decoderState;
    stream.dataset.audioDecoderState = audioDecoderState;
    stream.dataset.videoState = decoderState === 'playing' ? 'playing' : 'pending';
    hydrateIcons(stream);
  };

  const renderAll = () => {
    renderStaticCopy();
    renderBridgeStatus();
    renderPrimaryHost();
    renderSignal();
    renderLibrary();
    renderHosts();
    renderNetwork();
    renderActivity();
    renderSettings();
    if (!qs('#streamOverlay')?.hidden) renderStream(state.streamSession ? 'started' : 'negotiating');
    hydrateIcons();
  };

  const setView = (viewName) => {
    state.activeView = viewName;
    qsa('.view').forEach((view) => view.classList.toggle('is-visible', view.dataset.view === viewName));
    qsa('[data-view-target]').forEach((item) => item.classList.toggle('is-active', item.dataset.viewTarget === viewName));
    const scroll = qs('.content-scroll'); if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetPairModal = () => {
    const form = qs('#pairForm'); const progress = qs('#pairProgress'); if (!form || !progress) return;
    form.hidden = false; progress.hidden = true; form.reset();
    const host = currentHost();
    qs('#hostAddress').value = bridge.isDemo ? (host?.address || '192.168.1.42') : '';
    qs('#hostName').value = bridge.isDemo ? (host?.name || "Mira's Rig") : '';
    qs('#pairPin').value = bridge.isDemo ? '1234' : '';
    qsa('input, button', form).forEach((control) => { control.disabled = false; });
    qsa('.pair-step', qs('#pairStepper')).forEach((step, index) => { step.classList.toggle('is-active', index === 0); step.classList.remove('is-done'); });
    setPairProgress(0, t('pair.opening'), t('pair.waiting'), 0);
  };

  const openPairModal = () => { closeSettings(); resetPairModal(); const modal = qs('#pairModal'); if (modal) { modal.hidden = false; window.setTimeout(() => qs('#hostAddress')?.focus(), 60); } };
  const closePairModal = () => { const modal = qs('#pairModal'); if (modal) modal.hidden = true; };
  const setPairProgress = (percent, label, detail, activeStep) => {
    setText('#pairProgressPercent', percent + '%'); setText('#pairProgressLabel', label); setText('#pairProgressDetail', detail);
    const bar = qs('#pairProgressBar'); if (bar) bar.style.width = percent + '%';
    qsa('.pair-step', qs('#pairStepper')).forEach((step, index) => { step.classList.toggle('is-active', index === activeStep); step.classList.toggle('is-done', index < activeStep); });
  };

  const syncHostState = () => { state.hosts = Array.isArray(bridge.hosts) ? bridge.hosts : []; choosePrimaryHost(); };

  const refreshHost = async (host, includeApps = true) => {
    if (!host) throw new Error(t('diagnostic.noHost'));
    const info = await bridge.info(host);
    syncHostState();
    const updated = hostByRef(host.id) || host;
    if (includeApps && updated.paired) { await bridge.apps(updated); syncHostState(); }
    return info;
  };

  const stopBridgeHealthPolling = () => {
    if (state.bridgePollTimer) window.clearInterval(state.bridgePollTimer);
    state.bridgePollTimer = null;
    state.bridgePollBusy = false;
    state.bridgePollGeneration += 1;
  };

  const pollBridgeHealth = async (generation) => {
    if (bridge.isDemo || generation !== state.bridgePollGeneration || state.loading || state.bridgePollBusy) return;
    state.bridgePollBusy = true;
    const wasOnline = Boolean(state.health?.ok);
    try {
      const health = await bridge.healthCheck();
      if (generation !== state.bridgePollGeneration) return;
      state.health = health;
      if (!wasOnline) {
        try {
          await bridge.refreshHosts();
          syncHostState();
          const host = currentHost();
          if (host) {
            try { await refreshHost(host, Boolean(host.paired)); } catch (error) { host.state = 'offline'; state.lastHostError = errorMessage(error); }
          }
        } catch (error) {
          state.lastHostError = errorMessage(error);
        }
      }
    } catch (error) {
      if (generation === state.bridgePollGeneration) state.health = { ok: false, error: errorMessage(error) };
    } finally {
      if (generation === state.bridgePollGeneration) {
        state.bridgePollBusy = false;
        renderAll();
      }
    }
  };

  const startBridgeHealthPolling = () => {
    stopBridgeHealthPolling();
    if (bridge.isDemo) return;
    const generation = state.bridgePollGeneration;
    state.bridgePollTimer = window.setInterval(() => { void pollBridgeHealth(generation); }, 12000);
  };

  const initializeApp = async () => {
    loadActivity();
    renderAll();
    try {
      const result = await bridge.initialize();
      state.health = result.health;
      syncHostState();
      const host = currentHost();
      if (host) {
        try {
          await refreshHost(host, Boolean(host.paired));
          state.lastHostError = null;
          if (!bridge.isDemo) await runDiagnostic({ silent: true });
        } catch (error) {
          host.state = 'offline';
          state.lastHostError = errorMessage(error);
        }
      }
    } catch (error) {
      state.health = { ok: false, error: errorMessage(error) };
      // Keep the last known host list visible while the local Bridge is restarting.
      syncHostState();
    } finally {
      state.loading = false;
      renderAll();
      startBridgeHealthPolling();
      void refreshActiveSession();
    }
  };

  const handlePairSubmit = async (event) => {
    event.preventDefault();
    const values = { address: qs('#hostAddress').value.trim(), name: qs('#hostName').value.trim(), pin: qs('#pairPin').value.trim() };
    const form = qs('#pairForm'); const progress = qs('#pairProgress');
    if (!values.address || !values.name || !/^\d{4}$/.test(values.pin)) { showToast(t('pair.failed'), t('pair.validation'), 'warning'); return; }
    qsa('input, button', form).forEach((control) => { control.disabled = true; }); form.hidden = true; progress.hidden = false;
    try {
      setPairProgress(18, t('pair.opening'), t('pair.checking'), 0);
      await bridge.discover({ address: values.address, name: values.name });
      setPairProgress(55, t('pair.certificate'), t('pair.certificateDetail'), 1);
      const host = await bridge.pair(values);
      setPairProgress(82, t('pair.syncing'), t('pair.syncDetail'), 2);
      if (host) { state.selectedHost = host; try { await bridge.apps(host); } catch (error) { throw new Error(t('pair.failed') + ': ' + errorMessage(error)); } }
      syncHostState();
      setPairProgress(100, t('pair.done'), t('pair.doneDetail'), 3);
      recordActivity('link', host?.name || values.name, 'activity.paired');
      renderAll();
      await wait(320);
      closePairModal(); setView('hosts'); showToast(t('pair.done'), host?.name || values.name, 'success');
    } catch (error) {
      form.hidden = false; progress.hidden = true; qsa('input, button', form).forEach((control) => { control.disabled = false; });
      showToast(t('pair.failed'), errorMessage(error), 'warning');
    }
  };

  const runDiagnostic = async ({ silent = false } = {}) => {
    const host = currentHost();
    if (!host) {
      state.diagnostic = { status: 'idle', result: null, error: null };
      renderNetwork();
      if (!silent) showToast(t('diagnostic.failed'), t('diagnostic.noHost'), 'warning');
      return null;
    }
    state.diagnostic = { status: 'running', result: null, error: null };
    renderNetwork();
    if (!silent) showToast(t('diagnostic.running'), t('diagnostic.copy'));
    try {
      const result = await bridge.ping(host);
      const isDemoResult = Boolean(result?.demo);
      const controlReachable = isDemoResult ? null : Array.isArray(result?.probes) ? result.probes.some((probe) => probe?.ok) : result?.latency != null;
      state.diagnostic = { status: isDemoResult ? 'demo' : controlReachable ? 'healthy' : 'failed', result, error: isDemoResult || controlReachable ? null : t('diagnostic.unreachable') };
      if (!silent && controlReachable) recordActivity('check', host.name, 'activity.diagnostic', { latency: formatMs(result.latency) });
      renderAll();
      if (!silent) {
        if (isDemoResult) showToast(t('diagnostic.demo'), t('diagnostic.demoDetail'), 'success');
        else if (controlReachable) showToast(t('diagnostic.clean'), t('diagnostic.result', { latency: formatMs(result.latency), jitter: formatMs(result.jitter), loss: formatLoss(result.loss) }), 'success');
        else showToast(t('diagnostic.failed'), t('diagnostic.unreachable'), 'warning');
      }
      return result;
    } catch (error) {
      const message = errorMessage(error);
      state.diagnostic = { status: 'failed', result: null, error: message };
      renderNetwork();
      if (!silent) showToast(t('diagnostic.failed'), message, 'warning');
      return null;
    }
  };

  const stopSessionPolling = () => {
    if (state.sessionPollTimer) window.clearInterval(state.sessionPollTimer);
    state.sessionPollTimer = null;
    state.sessionPollBusy = false;
    state.sessionPollError = null;
    state.sessionPollGeneration += 1;
  };

  const stopSessionEvents = () => {
    if (state.sessionEventClose) state.sessionEventClose();
    state.sessionEventClose = null;
    state.sessionEventConnected = false;
  };

  // Status text changes rarely; coalesce bursts (SSE, decoder, input) into at most one render per 200 ms.
  // Live numbers are drawn separately by the stats loop, never per packet.
  const STREAM_RENDER_INTERVAL_MS = 200;
  const queueStreamRender = () => {
    if (state.mediaRenderPending) return;
    state.mediaRenderPending = true;
    const wait = Math.max(0, STREAM_RENDER_INTERVAL_MS - (performance.now() - (state.lastStreamRenderAt || 0)));
    window.setTimeout(() => {
      state.mediaRenderPending = false;
      state.lastStreamRenderAt = performance.now();
      if (!qs('#streamOverlay')?.hidden) renderStream(state.streamSession ? 'started' : 'negotiating');
    }, wait);
  };

  // ---------------------------------------------------------------------------
  // Live stats (fps, traffic, latency): sampled every 500 ms, averaged over the last ~1 s.
  // ---------------------------------------------------------------------------
  const STATS_INTERVAL_MS = 500;
  const PING_INTERVAL_MS = 1000;
  // Queueing delay on the bridge -> browser path: the bridge stamps each envelope with its clock (32-bit ms);
  // arrival minus stamp includes an unknown clock offset, so only the excess over the 30 s minimum counts.
  const noteOneWayDelay = (receivedAt) => {
    if (!Number.isFinite(receivedAt)) return;
    const delay = ((Date.now() >>> 0) - receivedAt) | 0;
    const owd = state.owd;
    const second = Math.floor(performance.now() / 1000);
    const bucket = owd.buckets[owd.buckets.length - 1];
    if (!bucket || bucket.second !== second) {
      owd.buckets.push({ second, min: delay });
      while (owd.buckets.length > 30) owd.buckets.shift();
    } else if (delay < bucket.min) {
      bucket.min = delay;
    }
    const baseline = Math.min(...owd.buckets.map((item) => item.min));
    const queue = delay - baseline;
    owd.maxQueue = Math.max(owd.maxQueue, queue);
    // Backlog building up: tell the bridge now instead of at the next 500 ms tick, so it starts draining sooner.
    const now = performance.now();
    if (queue > 300 && now - (owd.urgentAt || 0) > 200 && state.mediaGatewayState === 'connected') {
      owd.urgentAt = now;
      state.mediaGateway?.send?.({ type: 'feedback', queueDelayMs: Math.round(queue), receivedKbps: Math.round((state.liveStats?.mbps || 0) * 1000), lostFrames: state.liveStats?.lostFrames || 0 });
    }
  };
  const sendFeedback = (live) => {
    if (state.mediaGatewayState !== 'connected' || !live) return;
    state.queueDelayMs = state.owd.maxQueue;
    state.mediaGateway?.send?.({ type: 'feedback', queueDelayMs: Math.round(state.owd.maxQueue), receivedKbps: Math.round(live.mbps * 1000), lostFrames: live.lostFrames });
    state.owd.maxQueue = 0;
  };

  const resetLiveStats = () => {
    state.owd = { buckets: [], maxQueue: 0 };
    state.queueDelayMs = null;
    state.net = { bytes: 0, packets: 0 };
    state.statsSamples = [];
    state.bridgeStats = null;
    state.browserRttMs = null;
    state.liveStats = null;
  };
  resetLiveStats();

  const statsSnapshot = () => {
    const video = state.videoPipeline?.stats || {};
    return {
      at: performance.now(),
      bytes: state.net.bytes,
      frames: video.frames || 0,
      decodedFrames: video.decodedFrames || 0,
      renderedFrames: video.renderedFrames || 0,
      lostFrames: video.lostFrames || 0,
      recoveredShards: video.recoveredShards || 0,
      hostProcessingSum: video.hostProcessingSum || 0, hostProcessingCount: video.hostProcessingCount || 0,
      assemblySum: video.assemblySum || 0, assemblyCount: video.assemblyCount || 0,
      decodeSum: video.decodeSum || 0, decodeCount: video.decodeCount || 0,
      decodeQueue: video.decodeQueue || 0,
      backlogResets: video.backlogResets || 0,
      codec: video.codec || null,
      decodedWidth: state.liveCanvasSize?.width || 0,
      decodedHeight: state.liveCanvasSize?.height || 0,
      droppedPackets: state.bridgeStats?.droppedPackets || 0,
    };
  };

  const computeLiveStats = () => {
    const now = statsSnapshot();
    state.statsSamples.push(now);
    while (state.statsSamples.length > 2 && now.at - state.statsSamples[1].at >= 1000) state.statsSamples.shift();
    const then = state.statsSamples[0];
    const seconds = (now.at - then.at) / 1000;
    if (seconds <= 0) return null;
    const delta = (key) => now[key] - then[key];
    const average = (sum, count) => (delta(count) > 0 ? delta(sum) / delta(count) : null);
    const bridge = state.bridgeStats || {};
    const frames = delta('frames');
    const lost = delta('lostFrames');
    const hostProcessing = average('hostProcessingSum', 'hostProcessingCount');
    const assembly = average('assemblySum', 'assemblyCount');
    const decode = average('decodeSum', 'decodeCount');
    const hostRtt = Number.isFinite(bridge.hostRttMs) ? bridge.hostRttMs : null;
    const browserRtt = state.browserRttMs;
    // One-way network ≈ half of each round trip. The display itself is not included.
    const parts = [hostProcessing, hostRtt != null ? hostRtt / 2 : null, browserRtt != null ? browserRtt / 2 : null, assembly, decode];
    const total = parts.some((value) => value != null) ? parts.reduce((sum, value) => sum + (value || 0), 0) : null;
    return {
      fps: delta('renderedFrames') / seconds,
      decodedFps: delta('decodedFrames') / seconds,
      receivedFps: frames / seconds,
      mbps: (delta('bytes') * 8) / seconds / 1e6,
      lossPercent: frames + lost > 0 ? (lost * 100) / (frames + lost) : 0,
      lostFrames: now.lostFrames,
      recoveredShards: now.recoveredShards,
      droppedPackets: now.droppedPackets,
      decodeQueue: now.decodeQueue,
      backlogResets: now.backlogResets,
      codec: now.codec,
      decodedWidth: now.decodedWidth,
      decodedHeight: now.decodedHeight,
      hostProcessing, assembly, decode, hostRtt, hostRttVariance: bridge.hostRttVarianceMs ?? null, browserRtt, total,
      target: { width: bridge.width || state.streamSession?.width, height: bridge.height || state.streamSession?.height, fps: bridge.fps || state.streamSession?.fps, kbps: bridge.bitrateKbps || state.streamSession?.bitrateKbps },
    };
  };

  const latencyLevel = (ms) => (ms == null ? 'idle' : ms < 40 ? 'good' : ms < 80 ? 'warn' : 'bad');
  const fmt = (value, digits = 0) => (value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits));
  const fmtMs = (value) => (value == null ? '—' : (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ms');

  const renderHud = () => {
    const hud = qs('#streamHud'); if (!hud) return;
    const live = state.liveStats;
    hud.hidden = localStorage.getItem('sunbridge.setting.show-telemetry') === 'false' && !state.statsExpanded;
    setText('#hudFps', live ? fmt(live.fps) : '—');
    setText('#hudMbps', live ? fmt(live.mbps, 1) : '—');
    setText('#hudLatency', live?.total != null ? '~' + Math.round(live.total) : '—');
    hud.dataset.level = live?.fps > 0 ? latencyLevel(live.total) : 'idle';
    const detail = qs('#streamHudDetail');
    if (!detail || detail.hidden) return;
    const row = (label, value, level = '') => '<div class="hud-row' + (level ? ' is-' + level : '') + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
    const section = (title, rows) => '<section><h4>' + esc(title) + '</h4>' + rows.join('') + '</section>';
    const target = live?.target || {};
    const abr = state.bridgeStats?.abr || null;
    const audio = state.audioPipeline?.stats || {};
    const lossLevel = !live ? '' : live.lossPercent >= 5 ? 'bad' : live.lossPercent > 0.5 ? 'warn' : '';
    detail.innerHTML =
      section(t('stats.video'), [
        row(t('stats.stream'), target.width ? target.width + '×' + target.height + ' @ ' + target.fps + ' fps' : '—'),
        row(t('stats.decodedSize'), live?.decodedWidth ? live.decodedWidth + '×' + live.decodedHeight : '—'),
        row(t('stats.renderedFps'), live ? fmt(live.fps, 1) + ' fps' : '—'),
        row(t('stats.decodedFps'), live ? fmt(live.decodedFps, 1) + ' fps' : '—'),
        row(t('stats.receivedFps'), live ? fmt(live.receivedFps, 1) + ' fps' : '—'),
        row(t('stats.codec'), live?.codec ? String(live.codec).replace(/^avc1\..*/, 'H.264').replace(/^(hev1|hvc1)\..*/, 'HEVC').replace(/^av01\..*/, 'AV1') : '—'),
        row(t('stats.transport'), state.bridgeStats ? (state.bridgeStats.frameTransport ? t('stats.transportFrames', { fec: state.bridgeStats.fecPercent ?? '—' }) : t('stats.transportPackets')) + (state.bridgeStats.audioPacketMs ? ' · ' + t('stats.audioPackets', { ms: state.bridgeStats.audioPacketMs }) : '') : '—'),
        row(t('stats.decodeQueue'), live ? String(live.decodeQueue) + (live.backlogResets ? ' · ' + t('stats.backlogResets', { count: live.backlogResets }) : '') : '—', live?.decodeQueue > 2 || live?.backlogResets ? 'warn' : ''),
      ]) +
      section(t('stats.network'), [
        row(t('stats.traffic'), live ? fmt(live.mbps, 2) + ' Mbps' : '—'),
        row(t('stats.targetBitrate'), abr ? fmt(abr.targetKbps / 1000, 1) + ' / ' + fmt(abr.capKbps / 1000, 1) + ' Mbps' : target.kbps ? fmt(target.kbps / 1000, 1) + ' Mbps' : '—', abr?.state === 'congested' ? 'warn' : ''),
        row(t('stats.hostRate'), abr?.measuredKbps != null ? fmt(abr.measuredKbps / 1000, 2) + ' Mbps' + (abr.encoderKbps ? ' · ' + t('stats.encoderSetting', { value: fmt(abr.encoderKbps / 1000, 1) }) : '') : '—', abr?.measuredKbps > abr?.targetKbps * 1.1 ? 'warn' : ''),
        row(t('stats.bitrateControl'), abr ? t('bitrate.' + abr.mode) + (abr.mode === 'auto' ? ' · ' + t('bitrate.state.' + (abr.state || 'starting')) : '') : '—'),
        row(t('stats.queueDelay'), state.queueDelayMs != null ? fmtMs(state.queueDelayMs) : '—', latencyLevel(state.queueDelayMs != null ? state.queueDelayMs * 2 : null)),
        row(t('stats.reconnects'), String(state.bridgeStats?.reconnects ?? 0)),
        row(t('stats.hostRtt'), live?.hostRtt != null ? fmtMs(live.hostRtt) + (live.hostRttVariance != null ? ' ± ' + Math.round(live.hostRttVariance) : '') : '—', latencyLevel(live?.hostRtt)),
        row(t('stats.browserRtt'), fmtMs(live?.browserRtt), latencyLevel(live?.browserRtt)),
        row(t('stats.frameLoss'), live ? fmt(live.lossPercent, 1) + '% · ' + t('stats.lostTotal', { count: live.lostFrames }) : '—', lossLevel),
        row(t('stats.fecRecovered'), live ? String(live.recoveredShards) : '—'),
        row(t('stats.congestionDrops'), live ? String(live.droppedPackets) + (state.bridgeStats?.drainEpisodes ? ' · ' + t('stats.drainEpisodes', { count: state.bridgeStats.drainEpisodes }) : '') : '—', state.bridgeStats?.draining ? 'bad' : live?.droppedPackets ? 'warn' : ''),
      ]) +
      section(t('stats.audio'), [
        row(t('stats.audioBuffer'), audio.bufferedMs != null ? fmtMs(audio.bufferedMs) + ' / ' + t('stats.audioTarget', { value: audio.targetBufferMs }) : '—'),
        row(t('stats.audioUnderruns'), audio.underruns != null ? String(audio.underruns) : '—', audio.underruns ? 'warn' : ''),
      ]) +
      section(t('stats.latency'), [
        row(t('stats.hostProcessing'), fmtMs(live?.hostProcessing)),
        row(t('stats.networkOneWay'), live && (live.hostRtt != null || live.browserRtt != null) ? fmtMs(((live.hostRtt || 0) + (live.browserRtt || 0)) / 2) : '—'),
        row(t('stats.assembly'), fmtMs(live?.assembly)),
        row(t('stats.decode'), fmtMs(live?.decode)),
        row(t('stats.total'), live?.total != null ? '~' + fmtMs(live.total) : '—', latencyLevel(live?.total)),
      ]) +
      section(t('stats.status'), (state.streamStatusRows || []).map(([label, value]) => row(label, value))) +
      '<p class="hud-footnote">' + esc(t('stats.footnote')) + '</p>';
  };

  const STALL_NOTICE_MS = 3000;
  const checkStall = () => {
    const now = performance.now();
    if (state.net.packets !== state.stallPackets) {
      state.stallPackets = state.net.packets;
      state.lastMediaAt = now;
      if (state.reconnect?.source === 'stall') { state.reconnect = null; renderReconnect(); }
      return;
    }
    const silentMs = now - (state.lastMediaAt || now);
    if (silentMs >= STALL_NOTICE_MS && state.mediaGatewayState === 'connected' && !state.reconnect && state.streamSession) {
      state.reconnect = { source: 'stall', since: now - silentMs };
      renderReconnect();
    } else if (state.reconnect?.source === 'stall') {
      renderReconnect();
    }
  };

  const statsTick = () => {
    if (qs('#streamOverlay')?.hidden) return;
    checkStall();
    const canvas = qs('#streamVideoCanvas');
    state.liveCanvasSize = state.videoDecoderState === 'playing' && canvas ? { width: canvas.width, height: canvas.height } : null;
    state.liveStats = computeLiveStats();
    sendFeedback(state.liveStats);
    renderHud();
  };

  const sendPing = () => {
    if (state.mediaGatewayState !== 'connected') return;
    // A socket that silently died (laptop sleep, network switch) never fires "close": no pong for 6 s = dead.
    if (state.lastPongAt && performance.now() - state.lastPongAt > 6000) {
      state.lastPongAt = 0;
      state.mediaGateway?.close?.(4000, 'ping timeout');
      return;
    }
    state.mediaGateway?.send?.({ type: 'ping', id: (state.pingId = (state.pingId || 0) + 1), t: performance.now() });
  };

  const startStatsLoop = () => {
    stopStatsLoop();
    resetLiveStats();
    state.lastMediaAt = performance.now();
    state.stallPackets = 0;
    state.statsTimer = window.setInterval(statsTick, STATS_INTERVAL_MS);
    state.pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
    let expanded = false;
    try { expanded = localStorage.getItem('sunbridge.stats.expanded') === 'true'; } catch { /* optional */ }
    toggleStatsDetail(expanded);
  };
  const stopStatsLoop = () => {
    window.clearInterval(state.statsTimer);
    window.clearInterval(state.pingTimer);
    state.statsTimer = null;
    state.pingTimer = null;
  };

  const toggleStatsDetail = (force) => {
    const detail = qs('#streamHudDetail'); if (!detail) return;
    state.statsExpanded = typeof force === 'boolean' ? force : detail.hidden;
    detail.hidden = !state.statsExpanded;
    qs('.stream-hud-bar')?.setAttribute('aria-expanded', String(state.statsExpanded));
    try { localStorage.setItem('sunbridge.stats.expanded', String(state.statsExpanded)); } catch { /* optional */ }
    renderHud();
  };

  const inputConnected = () => String(state.streamSession?.transport?.input?.state || '') === 'connected';
  const requestIdrFrame = () => {
    const now = Date.now();
    if (!state.mediaGateway || now - (state.lastIdrRequestAt || 0) < 1000) return;
    state.lastIdrRequestAt = now;
    state.mediaGateway.send({ type: 'request-idr' });
  };

  const stopMediaGateway = () => {
    stopStatsLoop();
    state.mediaGatewayGeneration += 1;
    try { state.mediaGateway?.close?.(1000, 'client stopped'); } catch { /* already closed */ }
    try { state.videoPipeline?.stop?.(); } catch { /* already stopped */ }
    try { state.audioPipeline?.stop?.(); } catch { /* already stopped */ }
    try { state.inputController?.stop?.(); } catch { /* already stopped */ }
    state.inputController = null;
    state.mediaGateway = null;
    state.videoPipeline = null;
    state.audioPipeline = null;
    state.mediaGatewayState = 'waiting';
    state.mediaGatewayError = null;
    state.videoDecoderState = 'waiting-keyframe';
    state.videoDecoderError = null;
    state.audioDecoderState = 'waiting';
    state.audioDecoderError = null;
  };

  const closeAudioContext = () => {
    const context = state.audioContext;
    state.audioContext = null;
    if (context && typeof context.close === 'function' && context.state !== 'closed') {
      try { void context.close(); } catch { /* already closed */ }
    }
  };

  const prepareAudioPlayback = () => {
    if (bridge.isDemo) return Promise.resolve(false);
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextCtor !== 'function') return Promise.resolve(false);
    if (!state.audioContext || state.audioContext.state === 'closed') {
      try {
        state.audioContext = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: 48000 });
      } catch {
        state.audioContext = null;
        return Promise.resolve(false);
      }
    }
    if (state.audioContext.state === 'running' || typeof state.audioContext.resume !== 'function') return Promise.resolve(state.audioContext.state === 'running');
    return Promise.resolve(state.audioContext.resume())
      .then(() => state.audioContext?.state === 'running')
      .catch(() => false);
  };

  const resumeAudio = async () => {
    if (!state.audioPipeline?.resume) return false;
    const resumed = await state.audioPipeline.resume();
    state.audioDecoderState = state.audioPipeline.state;
    state.audioDecoderError = state.audioPipeline.stats?.lastError || null;
    queueStreamRender();
    return resumed;
  };

  const startMediaGateway = (session) => {
    stopMediaGateway();
    const generation = state.mediaGatewayGeneration;
    state.mediaGatewayState = bridge.isDemo ? 'demo' : 'waiting';
    state.videoDecoderState = bridge.isDemo ? 'demo' : 'waiting-keyframe';
    state.mediaGatewayError = null;
    state.videoDecoderError = null;
    state.audioDecoderState = bridge.isDemo ? 'demo' : 'waiting';
    state.audioDecoderError = null;
    if (bridge.isDemo) {
      queueStreamRender();
      return;
    }
    const mediaApi = window.SunbridgeMedia;
    const canvas = qs('#streamVideoCanvas');
    if (!mediaApi || typeof mediaApi.createVideoPipeline !== 'function') {
      state.videoDecoderState = 'unsupported';
    } else {
      state.videoPipeline = mediaApi.createVideoPipeline(canvas, {
        videoCodec: session.videoCodec || 'h264',
        onState: (next) => {
          if (generation !== state.mediaGatewayGeneration) return;
          if ((next.state || next) === 'playing' && state.videoDecoderState !== 'playing') window.setTimeout(() => { void checkAdaptiveResize(); }, 1000);
          state.videoDecoderState = next.state || next;
          state.videoDecoderError = next.lastError || null;
          queueStreamRender();
        },
        onFrame: (frame) => {
          if (generation !== state.mediaGatewayGeneration) return;
          if (frame?.waitingKeyframe) requestIdrFrame();
        },
        onError: (error) => {
          if (generation !== state.mediaGatewayGeneration) return;
          requestIdrFrame();
          state.videoDecoderState = 'decode-error';
          state.videoDecoderError = errorMessage(error);
          queueStreamRender();
        },
      });
      state.videoDecoderState = state.videoPipeline.state;
    }
    if (!mediaApi || typeof mediaApi.createAudioPipeline !== 'function') {
      state.audioDecoderState = 'unsupported';
    } else {
      state.audioPipeline = mediaApi.createAudioPipeline({
        audioContext: state.audioContext,
        workletUrl: 'audio-worklet.js',
        onState: (next) => {
          if (generation !== state.mediaGatewayGeneration) return;
          state.audioDecoderState = next.state || next;
          state.audioDecoderError = next.lastError || null;
          queueStreamRender();
        },
        onFrame: () => {},
        onError: (error) => {
          if (generation !== state.mediaGatewayGeneration) return;
          state.audioDecoderState = 'decode-error';
          state.audioDecoderError = errorMessage(error);
          queueStreamRender();
        },
      });
      state.audioDecoderState = state.audioPipeline.state;
    }
    if (!session?.id || typeof bridge.mediaGateway !== 'function') {
      state.mediaGatewayState = 'unsupported';
      state.mediaGatewayError = t('error.mediaGatewayUnsupported');
      queueStreamRender();
      return;
    }
    startStatsLoop();
    state.mediaGateway = bridge.mediaGateway({
      sessionId: session.id,
      onOpen: (info) => {
        if (generation !== state.mediaGatewayGeneration) return;
        state.gatewayRetry = 0;
        state.lastPongAt = performance.now();
        if (state.reconnect?.source === 'bridge') { state.reconnect = null; renderReconnect(); }
        state.mediaGatewayState = info?.demo ? 'demo' : 'connected';
        state.mediaGatewayError = null;
        queueStreamRender();
      },
      onMessage: (message) => {
        if (generation !== state.mediaGatewayGeneration) return;
        if (message?.type === 'media-ready') {
          state.mediaGatewayState = 'connected';
          state.mediaGatewayError = null;
          queueStreamRender();
        } else if (message?.type === 'stats') {
          state.bridgeStats = message;
        } else if (message?.type === 'reconnecting') {
          state.reconnect = { source: 'host', attempt: message.attempt, max: message.maxAttempts, reason: message.reason };
          renderReconnect();
        } else if (message?.type === 'stream-reset') {
          // The bridge rebuilt the host connection (new RTP stream, new keyframe): start the decoders over.
          state.reconnect = null;
          state.streamSession = { ...(state.streamSession || {}), width: message.width, height: message.height };
          renderReconnect();
          startMediaGateway(state.streamSession);
        } else if (message?.type === 'session-ended') {
          endStreamLocally(endedReasonKey(message.errorCode));
        } else if (message?.type === 'bitrate') {
          state.lastBitrateChange = message;
        } else if (message?.type === 'pong') {
          state.lastPongAt = performance.now();
          if (message.id === state.pingId && Number.isFinite(message.t)) {
            const sample = performance.now() - message.t;
            state.browserRttMs = state.browserRttMs == null ? sample : state.browserRttMs * 0.7 + sample * 0.3;
          }
        } else if (message?.type === 'rumble') {
          state.inputController?.rumble?.(message);
        } else if (message?.type === 'termination') {
          state.lastTermination = message.code;
        }
      },
      onPacket: (packet) => {
        if (generation !== state.mediaGatewayGeneration) return;
        state.net.bytes += packet.byteLength || 0;
        state.net.packets += 1;
        // One message = one or more envelopes; parse each once and hand it to the pipeline it belongs to.
        let first = true;
        try {
          mediaApi.forEachEnvelope(packet, (envelope) => {
            if (first) { first = false; noteOneWayDelay(envelope.receivedAt); }
            if (envelope.stream === 'video-frame' || envelope.stream === 'video') state.videoPipeline?.ingest(envelope);
            else if (envelope.stream === 'audio') state.audioPipeline?.ingest(envelope);
          });
        } catch { /* a malformed message is dropped; the frame assembler reports the loss */ }
      },
      onError: (error) => {
        if (generation !== state.mediaGatewayGeneration) return;
        state.mediaGatewayError = errorMessage(error);
        state.mediaGatewayState = error?.errorCode === 'MEDIA_GATEWAY_UNSUPPORTED' || error?.i18nKey === 'error.mediaGatewayUnsupported'
          ? 'unsupported'
          : error?.errorCode === 'MEDIA_GATEWAY_DISCONNECTED' || error?.i18nKey === 'error.mediaGatewayDisconnected'
            ? 'disconnected'
            : 'failed';
        queueStreamRender();
      },
      onClose: (info) => {
        if (generation !== state.mediaGatewayGeneration) return;
        if (info?.expected && state.stopping) return;
        if (state.mediaGatewayState === 'connected') state.mediaGatewayState = 'disconnected';
        queueStreamRender();
        scheduleGatewayRetry();
      },
    });
    const inputApi = window.SunbridgeInput;
    if (inputApi && canvas) {
      state.inputController = inputApi.createInputController({
        canvas,
        send: (message) => state.mediaGateway?.send?.(message),
        isEnabled: () => generation === state.mediaGatewayGeneration && !state.stopping && !qs('#streamOverlay')?.hidden && inputConnected(),
        shouldCapturePointer: () => localStorage.getItem('sunbridge.setting.capture-pointer') !== 'false',
        onStateChange: () => queueStreamRender(),
        onQuit: () => { void stopStream(); },
        getMode: () => state.controlMode || 'game',
        textInput: qs('#streamKeyboardInput'),
      });
    }
    queueStreamRender();
  };

  const startSessionEvents = () => {
    stopSessionEvents();
    if (bridge.isDemo) return;
    state.sessionEventError = null;
    state.sessionEventClose = bridge.sessionEvents({
      onEvent: (event) => {
        state.sessionEventConnected = true;
        state.sessionEventError = null;
        if (event.type === 'session-stopped') {
          if (event.errorCode) { endStreamLocally(endedReasonKey(event.errorCode)); return; }
          if (!state.stopping && state.streamSession) { endStreamLocally('reconnect.stoppedElsewhere'); return; }
          stopMediaGateway();
          closeAudioContext();
          state.streamSession = null;
          renderStream('stopped');
          return;
        }
        if (event.type === 'session-reconnecting') { state.reconnect = { source: 'host', attempt: event.attempt, max: 7, reason: event.reason }; renderReconnect(); }
        if (event.session) state.streamSession = { ...(state.streamSession || {}), ...event.session };
        if (state.streamSession) queueStreamRender();
      },
      onError: (error) => {
        state.sessionEventConnected = false;
        state.sessionEventError = errorMessage(error);
        if (!qs('#streamOverlay')?.hidden) renderStream(state.streamSession ? 'started' : 'negotiating');
      },
    });
  };

  const pollSession = async (generation) => {
    if (generation !== state.sessionPollGeneration || state.stopping || qs('#streamOverlay')?.hidden || state.sessionPollBusy) return;
    // The SSE stream already pushes every change; polling is only the fallback while it is down.
    if (state.sessionEventConnected && state.streamSession) return;
    state.sessionPollBusy = true;
    try {
      const result = await bridge.session();
      if (generation !== state.sessionPollGeneration || state.stopping || qs('#streamOverlay')?.hidden) return;
      if (result?.session) {
        state.streamSession = { ...(state.streamSession || {}), ...result.session };
        state.sessionPollError = null;
        queueStreamRender();
      }
    } catch (error) {
      if (generation === state.sessionPollGeneration && !state.stopping) state.sessionPollError = errorMessage(error);
    } finally {
      if (generation === state.sessionPollGeneration) state.sessionPollBusy = false;
    }
  };

  const startSessionPolling = () => {
    stopSessionPolling();
    const generation = state.sessionPollGeneration;
    void pollSession(generation);
    state.sessionPollTimer = window.setInterval(() => { void pollSession(generation); }, 850);
  };

  // Adaptive resolution: the stream area in device pixels (sharp 1:1 text for remote desktop), at most 4K worth
  // of pixels, width a multiple of 8 and height even (encoder friendly).
  const MAX_ADAPTIVE_PIXELS = 3840 * 2160;
  const adaptiveSize = () => {
    const stage = qs('.stream-stage');
    const rect = stage && !qs('#streamOverlay')?.hidden ? stage.getBoundingClientRect() : { width: window.innerWidth, height: Math.max(240, window.innerHeight - 105) };
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let width = rect.width * dpr;
    let height = rect.height * dpr;
    const scale = Math.min(1, Math.sqrt(MAX_ADAPTIVE_PIXELS / Math.max(1, width * height)));
    width = Math.max(640, Math.round((width * scale) / 8) * 8);
    height = Math.max(360, Math.round((height * scale) / 2) * 2);
    return { width, height };
  };
  // Video codecs this browser decodes, most bandwidth-efficient first. Hardware decoders win "auto": AV1 and HEVC
  // need 30-50 % less bitrate than H.264 for the same picture; software AV1 is used only when chosen explicitly.
  const CODEC_PROBES = { av1: 'av01.0.08M.08', hevc: 'hev1.1.6.L120.90', h264: 'avc1.640028' };
  const probeDecoder = async (codec, hardwareAcceleration) => {
    try {
      return (await window.VideoDecoder?.isConfigSupported?.({ codec: CODEC_PROBES[codec], hardwareAcceleration }))?.supported === true;
    } catch {
      return false;
    }
  };
  const decodableCodecs = async () => {
    if (state.codecSupport) return state.codecSupport;
    const [av1Hw, hevcHw, av1Any, hevcAny] = await Promise.all([probeDecoder('av1', 'prefer-hardware'), probeDecoder('hevc', 'prefer-hardware'), probeDecoder('av1', 'no-preference'), probeDecoder('hevc', 'no-preference')]);
    state.codecSupport = { av1Hw, hevcHw, av1: av1Any, hevc: hevcAny };
    return state.codecSupport;
  };
  const preferredCodecs = async () => {
    const support = await decodableCodecs();
    const choice = state.settings.codec || 'auto';
    if (choice === 'h264') return ['h264'];
    if (choice === 'av1') return support.av1 ? ['av1', 'h264'] : ['h264'];
    if (choice === 'hevc') return support.hevc ? ['hevc', 'h264'] : ['h264'];
    return [support.av1Hw && 'av1', (support.hevcHw || support.hevc) && 'hevc', 'h264'].filter(Boolean);
  };

  const isDesktopApp = (app) => /desktop|桌面|remote|mstsc|rdp/i.test(String(app?.name || app || ''));
  // Effective settings for one stream: host overrides > global settings; "auto" control mode = desktop for the Desktop app.
  const streamPlan = (host, app) => {
    const hs = host?.stream || {};
    const adaptive = hs.adaptive === true || (!hs.width && hs.adaptive !== false && state.settings.resolution === 'auto');
    const size = hs.width ? { width: hs.width, height: hs.height } : adaptive ? adaptiveSize() : { width: state.settings.width, height: state.settings.height };
    const globalMode = state.settings.controlMode !== 'auto' ? state.settings.controlMode : (isDesktopApp(app) ? 'desktop' : 'game');
    return { adaptive, ...size, fps: hs.fps || state.settings.fps, controlMode: hs.controlMode || globalMode, bitrateMode: hs.bitrateMode || state.settings.bitrateMode };
  };

  const applyControlModeUi = () => {
    const overlay = qs('#streamOverlay'); if (!overlay) return;
    const desktop = state.controlMode === 'desktop';
    overlay.dataset.controlMode = desktop ? 'desktop' : 'game';
    const button = qs('#streamModeButton');
    if (button) {
      button.innerHTML = '<span data-icon="' + (desktop ? 'mouse' : 'gamepad') + '" aria-hidden="true"></span><span id="streamModeLabel">' + esc(t(desktop ? 'control.desktopShort' : 'control.gameShort')) + '</span>';
      button.title = t('control.toggleHint');
      hydrateIcons(button);
    }
    const fullscreen = qs('#streamFullscreenButton');
    if (fullscreen) {
      fullscreen.innerHTML = '<span data-icon="' + (document.fullscreenElement ? 'compress' : 'expand') + '" aria-hidden="true"></span>';
      fullscreen.title = t(document.fullscreenElement ? 'control.exitFullscreen' : 'control.fullscreen');
      hydrateIcons(fullscreen);
    }
    const keyboard = qs('#streamKeyboardButton'); if (keyboard) keyboard.title = t('control.keyboard');
  };
  const toggleControlMode = () => {
    state.controlMode = state.controlMode === 'desktop' ? 'game' : 'desktop';
    applyControlModeUi();
    state.inputController?.modeChanged?.();
    showToast(t(state.controlMode === 'desktop' ? 'control.desktop' : 'control.game'), t(state.controlMode === 'desktop' ? 'control.desktopHint' : 'control.gameHint'));
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await qs('#streamOverlay')?.requestFullscreen?.({ navigationUI: 'hide' });
    } catch { /* not allowed (iOS Safari) */ }
  };
  const showSoftKeyboard = () => {
    const input = qs('#streamKeyboardInput'); if (!input) return;
    input.value = '';
    input.focus({ preventScroll: true });
  };

  // ---------------------------------------------------------------------------
  // Reconnect. Host side (bridge <-> Sunshine) is handled by the bridge and reported here; browser side
  // (WebSocket to the bridge) retries with backoff and relaunches if the bridge lost the session (restart).
  // ---------------------------------------------------------------------------
  const GATEWAY_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];
  const GATEWAY_MAX_RETRIES = 20;
  const renderReconnect = () => {
    const box = qs('#streamReconnect'); if (!box) return;
    const info = state.reconnect;
    box.hidden = !info;
    if (!info) return;
    if (info.source === 'stall') {
      setText('#streamReconnectTitle', t('reconnect.stall'));
      setText('#streamReconnectDetail', t('reconnect.stallDetail', { seconds: Math.round((performance.now() - info.since) / 1000) }));
      return;
    }
    setText('#streamReconnectTitle', t(info.source === 'host' ? 'reconnect.host' : 'reconnect.bridge'));
    const reason = info.reason ? t('reconnect.reason.' + String(info.reason).replace(/^control-.*/, 'control')) : '';
    setText('#streamReconnectDetail', t('reconnect.attempt', { attempt: info.attempt, max: info.max || '∞' }) + (reason && !reason.startsWith('reconnect.') ? ' · ' + reason : ''));
  };
  const scheduleGatewayRetry = () => {
    if (state.stopping || !state.streamSession || state.gatewayRetryTimer || bridge.isDemo) return;
    const attempt = (state.gatewayRetry || 0) + 1;
    if (attempt > GATEWAY_MAX_RETRIES) { endStreamLocally('reconnect.failed'); return; }
    state.gatewayRetry = attempt;
    if (state.reconnect?.source !== 'host') { state.reconnect = { source: 'bridge', attempt, max: GATEWAY_MAX_RETRIES }; renderReconnect(); }
    const delay = GATEWAY_RETRY_DELAYS_MS[Math.min(attempt - 1, GATEWAY_RETRY_DELAYS_MS.length - 1)];
    state.gatewayRetryTimer = window.setTimeout(() => { void retryGateway(); }, navigator.onLine === false ? Math.max(delay, 3000) : delay);
  };
  const retryGateway = async () => {
    window.clearTimeout(state.gatewayRetryTimer);
    state.gatewayRetryTimer = null;
    if (state.stopping || !state.streamSession) return;
    try {
      const { session } = await bridge.session();
      if (state.stopping || !state.streamSession) return;
      if (session && session.id === state.streamSession.id) {
        state.streamSession = { ...state.streamSession, ...session };
        startMediaGateway(state.streamSession);
        return;
      }
      if (session) { endStreamLocally('reconnect.replaced'); return; }
      // The bridge has no session any more (it restarted): launch again; it resumes the app still running on the host.
      if (!(await confirmTwoFactor('stream'))) { endStreamLocally('reconnect.verifyCancelled'); return; }
      if (state.stopping || !state.streamSession) return;
      const host = state.streamHost; const app = state.streamApp;
      const base = state.streamPlan || streamPlan(host, app);
      const plan = base.adaptive ? { ...base, ...adaptiveSize() } : base;
      const fresh = await bridge.launch({ hostId: host.id, address: host.address, hostName: host.name, appId: app.id, appName: app.name, width: plan.width, height: plan.height, fps: plan.fps, bitrateMode: plan.bitrateMode, videoCodecs: await preferredCodecs() });
      state.streamSession = fresh;
      startSessionEvents();
      startMediaGateway(fresh);
    } catch {
      scheduleGatewayRetry();
    }
  };
  const ENDED_REASON_KEYS = {
    HOST_TERMINATED: 'reconnect.hostEnded',
    HOST_DISCONNECTED: 'reconnect.hostDisconnected',
    HOST_APP_EXITED: 'reconnect.appExited',
    RECONNECT_FAILED: 'reconnect.failed',
  };
  const endedReasonKey = (errorCode) => ENDED_REASON_KEYS[errorCode] || 'reconnect.failed';
  // The session ended without the user stopping it here (host app exited, reconnect gave up, replaced).
  const endStreamLocally = (reasonKey) => {
    if (state.stopping || !state.streamSession) return;
    window.clearTimeout(state.gatewayRetryTimer);
    state.gatewayRetryTimer = null;
    state.gatewayRetry = 0;
    state.reconnect = null;
    renderReconnect();
    stopResizeWatcher();
    stopSessionPolling();
    stopSessionEvents();
    stopMediaGateway();
    closeAudioContext();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    state.streamSession = null; state.streamHost = null; state.streamApp = null;
    const overlay = qs('#streamOverlay'); if (overlay) overlay.hidden = true;
    document.body.style.overflow = ''; document.body.classList.remove('is-streaming');
    renderAll();
    showToast(t('session.ended'), t(reasonKey), 'warning');
  };

  // Adaptive resolution: follow the stream area while streaming (live where the host supports it).
  const startResizeWatcher = () => {
    stopResizeWatcher();
    const stage = qs('.stream-stage');
    if (!stage || typeof ResizeObserver !== 'function') return;
    state.resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(() => { void checkAdaptiveResize(); }, 700);
    });
    state.resizeObserver.observe(stage);
  };
  const stopResizeWatcher = () => {
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    window.clearTimeout(state.resizeTimer);
    window.clearTimeout(state.resizeVerifyTimer);
  };
  const checkAdaptiveResize = async () => {
    const session = state.streamSession;
    if (!state.streamPlan?.adaptive || !session?.width || state.reconnect || state.stopping || state.videoDecoderState !== 'playing' || state.resizeBusy) return;
    const { width, height } = adaptiveSize();
    if (Math.abs(width - session.width) < 32 && Math.abs(height - session.height) < 32) return;
    state.resizeBusy = true;
    try {
      const result = await bridge.resize(width, height);
      if (!result || result.method === 'none' || !state.streamSession) return;
      state.streamSession = { ...state.streamSession, width: result.width, height: result.height };
      if (result.method === 'dynamic') {
        window.clearTimeout(state.resizeVerifyTimer);
        state.resizeVerifyTimer = window.setTimeout(async () => {
          const canvas = qs('#streamVideoCanvas');
          if (!canvas || !state.streamSession || state.reconnect) return;
          if (Math.abs(canvas.width - result.width) <= 16 && Math.abs(canvas.height - result.height) <= 16) return;
          // The host ignored the live change (stock Sunshine): reconnect at the new size instead.
          try { await bridge.resize(result.width, result.height, 'reconnect'); } catch { /* keep the current size */ }
        }, 5000);
      }
    } catch {
      /* keep the current size */
    } finally {
      state.resizeBusy = false;
    }
  };

  // A stream that is still running on the bridge (page reloaded, another tab, phone switched networks).
  const refreshActiveSession = async () => {
    if (bridge.isDemo || state.streamSession || state.stopping) return;
    try {
      const { session } = await bridge.session();
      state.activeRemoteSession = session && session.transport?.media?.state !== 'not-connected' ? session : null;
    } catch {
      state.activeRemoteSession = null;
    }
    renderResumeBar();
  };
  const renderResumeBar = () => {
    const bar = qs('#sessionResumeBar'); if (!bar) return;
    const session = state.activeRemoteSession;
    bar.hidden = !session || Boolean(state.streamSession);
    if (bar.hidden) return;
    setText('#sessionResumeTitle', t('resume.title'));
    setText('#sessionResumeDetail', t('resume.detail', { app: session.appName || t('common.desktop'), host: session.hostName || '' }));
    setText('#sessionResumeLabel', t('resume.return'));
    setText('#sessionEndLabel', t('resume.end'));
  };
  // Two-step verification (security.js): resolves false when the user cancels the code prompt.
  const confirmTwoFactor = (purpose, streamId) => (window.SunbridgeSecurity ? window.SunbridgeSecurity.ensure(purpose, streamId) : Promise.resolve(true));
  const resumeStream = async (session) => {
    // Unlock audio inside the click before the (possibly prompting) check yields.
    void prepareAudioPlayback();
    if (!(await confirmTwoFactor('resume', session.id))) { closeAudioContext(); return; }
    attachStream(session);
  };
  const attachStream = (session) => {
    const host = hostByRef(session.hostId) || { id: session.hostId, name: session.hostName, address: '', apps: [] };
    const app = { id: session.appId, name: session.appName };
    const overlay = qs('#streamOverlay'); if (!overlay) return;
    void prepareAudioPlayback();
    state.selectedHost = host; state.streamHost = host; state.streamApp = app; state.streamSession = session; state.activeRemoteSession = null;
    overlay.hidden = false; document.body.style.overflow = 'hidden'; document.body.classList.add('is-streaming');
    state.streamPlan = streamPlan(host, app);
    state.controlMode = state.streamPlan.controlMode;
    applyControlModeUi();
    renderResumeBar();
    renderStream('started'); startSessionEvents(); startSessionPolling();
    startMediaGateway(session);
    startResizeWatcher();
  };

  const openStream = async (ref, appName, appId) => {
    const host = hostByRef(ref);
    const app = host?.apps?.find((item) => String(item.id) === String(appId) || item.name === appName) || { id: appId, name: appName || t('common.desktop') };
    if (!host) { showToast(t('session.couldNotStart'), t('diagnostic.noHost'), 'warning'); return; }
    if (!hostIsOnline(host)) { showToast(t('session.couldNotStart'), t('host.offlineHint'), 'warning'); return; }
    const overlay = qs('#streamOverlay'); if (!overlay) return;
    // Start/resume the Web Audio context from the user gesture before the async
    // Sunshine launch request yields control, so browsers are less likely to
    // classify the first decoded Opus frame as unsolicited autoplay.
    void prepareAudioPlayback();
    if (!(await confirmTwoFactor('stream'))) { closeAudioContext(); return; }
    state.selectedHost = host; state.streamHost = host; state.streamApp = app; state.streamSession = null;
    overlay.hidden = false; document.body.style.overflow = 'hidden'; document.body.classList.add('is-streaming'); renderStream('negotiating'); startSessionEvents(); startSessionPolling();
    // Plan after the overlay is visible: adaptive resolution measures the stream area.
    const plan = streamPlan(host, app);
    state.streamPlan = plan;
    state.controlMode = plan.controlMode;
    applyControlModeUi();
    try {
      const videoCodecs = await preferredCodecs();
      const session = await bridge.launch({ hostId: host.id, address: host.address, hostName: host.name, appId: app.id, appName: app.name, width: plan.width, height: plan.height, fps: plan.fps, bitrateMode: plan.bitrateMode, videoCodecs });
      state.streamSession = session;
      state.activeRemoteSession = null;
      startMediaGateway(session);
      startResizeWatcher();
      renderStream('started');
      showToast(t('session.controlStarted', { app: app.name }), t('session.mediaPending'), bridge.isDemo ? 'info' : 'success');
    } catch (error) {
      stopSessionPolling();
      stopSessionEvents();
      stopMediaGateway();
      closeAudioContext();
      overlay.hidden = true; document.body.style.overflow = ''; document.body.classList.remove('is-streaming'); state.streamSession = null; showToast(t('session.couldNotStart'), errorMessage(error), 'warning');
    }
  };

  const stopStream = async () => {
    if (state.stopping) return;
    state.stopping = true;
    window.clearTimeout(state.gatewayRetryTimer);
    state.gatewayRetryTimer = null;
    state.gatewayRetry = 0;
    state.reconnect = null;
    renderReconnect();
    stopResizeWatcher();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    stopSessionPolling();
    stopSessionEvents();
    stopMediaGateway();
    closeAudioContext();
    let stopError = null;
    try { await bridge.stop(); } catch (error) { stopError = error; }
    const appName = state.streamApp?.name || state.streamApp || t('common.desktop');
    if (state.streamSession) recordActivity('play', appName, 'activity.sessionEnded', { app: appName });
    state.streamSession = null; state.streamHost = null; state.streamApp = null;
    const overlay = qs('#streamOverlay'); if (overlay) overlay.hidden = true;
    document.body.style.overflow = ''; document.body.classList.remove('is-streaming'); state.stopping = false; state.activeRemoteSession = null; renderAll(); renderResumeBar(); if (stopError) showToast(t('session.stopFailed'), errorMessage(stopError), 'warning'); else showToast(t('session.ended'), t('session.disconnected', { app: appName }), 'success');
  };

  const openSettings = () => { const drawer = qs('#settingsDrawer'); if (drawer) { drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); } };
  const closeSettings = () => { const drawer = qs('#settingsDrawer'); if (drawer) { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); } };
  const toggleSetting = (toggle) => { const isOn = toggle.classList.toggle('is-on'); toggle.setAttribute('aria-pressed', String(isOn)); if (toggle.dataset.toggle === 'reduce-motion') document.documentElement.classList.toggle('reduce-motion', isOn); localStorage.setItem('sunbridge.setting.' + toggle.dataset.toggle, String(isOn)); showToast(isOn ? t('settings.enabled') : t('settings.disabled'), t('settings.updated'), 'success'); };
  const clearActivity = () => { state.activity = []; saveActivity(); renderActivity(); showToast(t('toast.activityCleared'), t('toast.activityReady')); };

  const copyPorts = async () => {
    const host = currentHost();
    const lines = [
      'HTTPS ' + (host?.httpsPort || 47984) + '/TCP',
      'HTTP ' + (host?.httpPort || 47989) + '/TCP',
      'RTSP ' + (host?.rtspPort || 48010) + '/TCP',
      t('common.video') + ' 47998/UDP',
      t('common.input') + ' 47999/UDP',
      t('common.audio') + ' 48000/UDP',
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); showToast(t('toast.portsCopied'), t('toast.portsCopiedDetail'), 'success'); } catch { showToast(t('toast.portsCopied'), t('toast.clipboardUnavailable')); }
  };

  const handleWake = async (ref) => {
    const host = hostByRef(ref); if (!host) return;
    host.state = 'waking'; renderHosts(); showToast(t('toast.waking'), t('toast.wakingDetail', { name: host.name }));
    try { await bridge.wake(host); syncHostState(); renderAll(); showToast(t('toast.wakeSent'), t('toast.wakeSentDetail'), 'success'); } catch (error) { host.state = 'sleeping'; renderHosts(); showToast(t('toast.wakeFailed'), errorMessage(error), 'warning'); }
  };

  const handleRefreshHost = async (ref) => {
    const host = hostByRef(ref); if (!host) return;
    showToast(t('host.refresh'), host.name);
    try { await refreshHost(host, Boolean(host.paired)); renderAll(); showToast(t('host.refreshDone'), host.name, 'success'); } catch (error) { host.state = 'offline'; renderAll(); showToast(t('host.refreshFailed'), errorMessage(error), 'warning'); }
  };

  // Host management panel (the ⋯ button): connection, per-host stream settings, pairing, unpair / delete.
  const RESOLUTIONS = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
  const FRAME_RATES = [30, 60, 90, 120, 144];
  // Same rule as the bridge: ~5 Mbps for 720p30, scaled by pixels × fps, 2–150 Mbps.
  const autoBitrateKbps = (width, height, fps) => Math.min(150000, Math.max(2000, Math.round((5000 * (width * height * fps) / (1280 * 720 * 30)) / 500) * 500));
  const formatMbps = (kbps) => (Math.round(kbps / 100) / 10) + ' Mbps';
  const hostModalHost = () => state.hostModalId && state.hosts.find((host) => host.id === state.hostModalId) || null;

  const effectiveStream = (host, form) => {
    const stream = host?.stream || {};
    const fixed = (value) => /^\d+x\d+$/.test(value || '') ? value.split('x').map(Number) : null;
    const globalSize = state.settings.resolution === 'auto' ? adaptiveSize() : { width: state.settings.width, height: state.settings.height };
    const formSize = form ? (fixed(form.resolution.value) || (form.resolution.value === 'auto' ? Object.values(adaptiveSize()) : [globalSize.width, globalSize.height])) : null;
    const [width, height] = formSize || (stream.width ? [stream.width, stream.height] : stream.adaptive ? Object.values(adaptiveSize()) : [globalSize.width, globalSize.height]);
    const fps = form ? (Number(form.fps.value) || state.settings.fps) : (stream.fps || state.settings.fps);
    return { width, height, fps };
  };

  const renderHostModal = () => {
    const panel = qs('#hostPanel');
    const host = hostModalHost();
    if (!panel || !host) return;
    const status = hostStatus(host);
    const stream = host.stream || {};
    const field = (label, control, extra = '') => '<label class="host-field' + extra + '"><span>' + esc(label) + '</span>' + control + '</label>';
    const input = (name, value, placeholder, attrs = '') => '<div class="input-shell"><input name="' + name + '" value="' + esc(value ?? '') + '" placeholder="' + esc(placeholder || '') + '" autocomplete="off" ' + attrs + ' /></div>';
    const currentResolution = stream.width ? stream.width + 'x' + stream.height : stream.adaptive ? 'auto' : '';
    const resolutionOptions = [['', t('hostm.followGlobal', { value: resolutionLabel() })], ['auto', t('settings.adaptiveWindow')], ...RESOLUTIONS.map(([w, h]) => [w + 'x' + h, w + ' × ' + h])];
    if (currentResolution && !resolutionOptions.some(([value]) => value === currentResolution)) resolutionOptions.push([currentResolution, stream.width + ' × ' + stream.height]);
    const fpsOptions = [['', t('hostm.followGlobal', { value: state.settings.fps + ' fps' })], ...FRAME_RATES.map((fps) => [String(fps), fps + ' fps'])];
    const controlOptions = [['', t('hostm.followGlobal', { value: t('control.' + state.settings.controlMode) })], ['desktop', t('control.desktop')], ['game', t('control.game')]];
    const bitrateModeOptions = [['', t('hostm.followGlobal', { value: t('bitrate.' + state.settings.bitrateMode) })], ['auto', t('bitrate.auto')], ['fixed', t('bitrate.fixed')]];
    if (stream.fps && !FRAME_RATES.includes(stream.fps)) fpsOptions.push([String(stream.fps), stream.fps + ' fps']);
    const select = (name, options, value) => '<select name="' + name + '">' + options.map(([optionValue, label]) => '<option value="' + esc(optionValue) + '"' + (String(optionValue) === String(value || '') ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select>';
    const primaryAction = hostIsOnline(host)
      ? (host.paired ? '<button class="secondary-button" type="button" data-action="connect" data-host="' + esc(host.id) + '" data-app="Desktop">' + esc(t('host.connect')) + '<span data-icon="arrow-up-right" aria-hidden="true"></span></button>' : '')
      : host.mac ? '<button class="secondary-button" type="button" data-action="wake-host" data-host="' + esc(host.id) + '">' + esc(t('host.wake')) + '<span data-icon="sun" aria-hidden="true"></span></button>' : '';

    panel.innerHTML =
      '<button class="modal-close icon-button" type="button" data-action="close-host" aria-label="' + esc(t('aria.closeHost')) + '"><span data-icon="x" aria-hidden="true"></span></button>' +
      '<div class="modal-eyebrow"><span class="live-dot"></span> ' + esc(t('hostm.eyebrow')) + '</div>' +
      '<h2 id="host-modal-title">' + esc(host.name || host.address) + '</h2>' +
      '<div class="host-panel-meta"><span class="host-chip ' + status.className + '"><span class="status-dot ' + (status.dot === 'online' ? 'is-green' : '') + '"></span> ' + esc(t(status.key)) + '</span>' + (host.paired ? '<span class="host-chip paired"><span data-icon="lock" aria-hidden="true"></span> ' + esc(t('host.paired')) + '</span>' : '') + '<span class="host-panel-sub">' + esc([host.sunshine, host.gpu].filter((item) => item && !/^unknown/i.test(item)).join(' · ')) + '</span></div>' +
      '<div class="host-panel-actions">' + primaryAction + '<button class="secondary-button" type="button" data-action="refresh-host" data-host="' + esc(host.id) + '">' + esc(t('host.refresh')) + '<span data-icon="pulse" aria-hidden="true"></span></button></div>' +
      '<form id="hostForm" class="host-form" novalidate>' +
        '<fieldset class="host-section"><legend>' + esc(t('hostm.connection')) + '</legend>' +
          '<div class="host-grid host-grid-2">' + field(t('hostm.name'), input('name', host.name, '', 'maxlength="64" required')) + field(t('hostm.address'), input('address', host.address, t('hostm.addressPlaceholder'), 'required')) + '</div>' +
          '<div class="host-grid host-grid-3">' + field(t('hostm.httpPort'), input('httpPort', host.httpPort && host.httpPort !== 47989 ? host.httpPort : '', t('hostm.portDefault', { port: 47989 }), 'inputmode="numeric"')) + field(t('hostm.httpsPort'), input('httpsPort', host.httpsPort && host.httpsPort !== 47984 ? host.httpsPort : '', t('hostm.portDefault', { port: 47984 }), 'inputmode="numeric"')) + field(t('hostm.mac'), input('mac', host.mac, t('hostm.macPlaceholder'))) + '</div>' +
          '<p class="host-hint">' + esc(t('hostm.connectionHint')) + '</p>' +
        '</fieldset>' +
        '<fieldset class="host-section"><legend>' + esc(t('hostm.stream')) + '</legend>' +
          '<div class="host-grid host-grid-3">' + field(t('hostm.resolution'), select('resolution', resolutionOptions, currentResolution), ' host-select') + field(t('hostm.fps'), select('fps', fpsOptions, stream.fps), ' host-select') + field(t('hostm.bitrate'), input('bitrate', stream.bitrateKbps ? stream.bitrateKbps / 1000 : '', '', 'inputmode="decimal"')) + '</div>' +
          '<div class="host-grid host-grid-2">' + field(t('settings.controlMode'), select('controlMode', controlOptions, stream.controlMode), ' host-select') + field(t('settings.bitrateMode'), select('bitrateMode', bitrateModeOptions, stream.bitrateMode), ' host-select') + '</div>' +
          '<p class="host-hint">' + esc(t('hostm.streamHint')) + '</p>' +
        '</fieldset>' +
        '<div class="host-form-footer"><button class="primary-button" type="submit"><span>' + esc(t('hostm.save')) + '</span><span data-icon="check" aria-hidden="true"></span></button></div>' +
      '</form>' +
      '<section class="host-section"><h3>' + esc(t('hostm.pairing')) + '</h3>' +
        (host.paired && host.serverFingerprint
          ? '<p class="host-hint">' + esc(t('hostm.pairedWith')) + '</p><div class="host-fingerprint"><code>' + esc(host.serverFingerprint) + '</code><button class="icon-button" type="button" data-action="copy-fingerprint" aria-label="' + esc(t('hostm.copyFingerprint')) + '"><span data-icon="copy" aria-hidden="true"></span></button></div>'
          : '<p class="host-hint">' + esc(t('hostm.notPaired')) + '</p><button class="secondary-button" type="button" data-action="pair-existing">' + esc(t('hostm.pairNow')) + '<span data-icon="link" aria-hidden="true"></span></button>') +
      '</section>' +
      '<section class="host-section host-danger"><h3>' + esc(t('hostm.danger')) + '</h3>' +
        (host.paired ? '<div class="host-danger-row"><div><strong>' + esc(t('hostm.unpair')) + '</strong><p>' + esc(t('hostm.unpairDetail')) + '</p></div><button class="danger-button" type="button" data-action="host-unpair">' + esc(t('hostm.unpair')) + '</button></div>' : '') +
        '<div class="host-danger-row"><div><strong>' + esc(t('hostm.delete')) + '</strong><p>' + esc(t('hostm.deleteDetail')) + '</p></div><button class="danger-button" type="button" data-action="host-delete">' + esc(t('hostm.delete')) + '</button></div>' +
      '</section>';
    hydrateIcons(panel);
    updateBitratePlaceholder();
  };

  const updateBitratePlaceholder = () => {
    const form = qs('#hostForm'); const host = hostModalHost();
    if (!form || !host) return;
    const { width, height, fps } = effectiveStream(host, form);
    form.bitrate.placeholder = t('hostm.bitrateAuto', { value: formatMbps(autoBitrateKbps(width, height, fps)) });
  };

  const openHostModal = (ref) => {
    const host = hostByRef(ref); if (!host) { showToast(t('toast.hostDetails'), t('diagnostic.noHost')); return; }
    closeSettings();
    state.hostModalId = host.id;
    renderHostModal();
    const modal = qs('#hostModal'); if (modal) modal.hidden = false;
    // Reset after showing: scrollTop is ignored while the panel is display:none.
    const panel = qs('#hostPanel'); if (panel) panel.scrollTop = 0;
  };
  const closeHostModal = () => { state.hostModalId = null; const modal = qs('#hostModal'); if (modal) modal.hidden = true; };

  const hostFormChanges = (form, host) => {
    const value = (name) => form[name].value.trim();
    const [width, height] = /^\d+x\d+$/.test(value('resolution')) ? value('resolution').split('x').map(Number) : [null, null];
    const adaptive = value('resolution') === 'auto' ? true : width ? false : null;
    const bitrate = value('bitrate').replace(',', '.');
    return {
      name: value('name'),
      address: value('address'),
      httpPort: value('httpPort') || null,
      httpsPort: value('httpsPort') || null,
      mac: value('mac') || null,
      stream: { width, height, adaptive, fps: Number(value('fps')) || null, bitrateKbps: bitrate ? Math.round(Number(bitrate) * 1000) || bitrate : null, controlMode: value('controlMode') || null, bitrateMode: value('bitrateMode') || null },
    };
  };

  const handleHostSave = async (event) => {
    event.preventDefault();
    const form = event.target; const host = hostModalHost(); if (!host) return;
    const submit = qs('button[type="submit"]', form);
    submit.disabled = true;
    try {
      const updated = await bridge.updateHost(host.id, hostFormChanges(form, host));
      syncHostState();
      renderAll();
      renderHostModal();
      showToast(t('hostm.saved'), t('hostm.savedDetail', { name: updated?.name || host.name }), 'success');
    } catch (error) {
      submit.disabled = false;
      showToast(t('hostm.saveFailed'), errorMessage(error), 'warning');
    }
  };

  // Destructive buttons need a second click within 4 s.
  const confirmed = (button, labelKey) => {
    if (button.dataset.armed === '1') return true;
    const original = button.textContent;
    button.dataset.armed = '1'; button.classList.add('is-armed'); button.textContent = t(labelKey);
    window.setTimeout(() => { if (button.isConnected) { button.dataset.armed = ''; button.classList.remove('is-armed'); button.textContent = original; } }, 4000);
    return false;
  };

  const handleHostUnpair = async (button) => {
    const host = hostModalHost(); if (!host || !confirmed(button, 'hostm.confirmUnpair')) return;
    button.disabled = true;
    try {
      await bridge.unpairHost(host.id);
      syncHostState(); recordActivity('lock', host.name, 'hostm.unpaired'); renderAll(); renderHostModal();
      showToast(t('hostm.unpaired'), t('hostm.unpairedDetail'), 'success');
    } catch (error) { button.disabled = false; showToast(t('hostm.actionFailed'), errorMessage(error), 'warning'); }
  };

  const handleHostDelete = async (button) => {
    const host = hostModalHost(); if (!host || !confirmed(button, 'hostm.confirmDelete')) return;
    button.disabled = true;
    try {
      await bridge.deleteHost(host.id);
      if (state.selectedHost?.id === host.id) state.selectedHost = null;
      closeHostModal(); syncHostState(); recordActivity('x', host.name, 'hostm.deleted'); renderAll();
      showToast(t('hostm.deleted'), host.name, 'success');
    } catch (error) { button.disabled = false; showToast(t('hostm.actionFailed'), errorMessage(error), 'warning'); }
  };

  const pairExistingHost = () => {
    const host = hostModalHost(); if (!host) return;
    closeHostModal(); openPairModal();
    const port = host.httpPort && host.httpPort !== 47989 ? ':' + host.httpPort : '';
    qs('#hostAddress').value = (host.address.includes(':') ? '[' + host.address + ']' : host.address) + port;
    qs('#hostName').value = host.name || '';
    window.setTimeout(() => qs('#pairPin')?.focus(), 80);
  };

  const copyFingerprint = async () => {
    const host = hostModalHost(); if (!host?.serverFingerprint) return;
    try { await navigator.clipboard.writeText(host.serverFingerprint); showToast(t('hostm.copied'), host.serverFingerprint, 'success'); } catch { showToast(t('hostm.copyFingerprint'), t('toast.clipboardUnavailable')); }
  };

  document.addEventListener('click', (event) => {
    const viewTarget = event.target.closest('[data-view-target]');
    if (viewTarget) { event.preventDefault(); setView(viewTarget.dataset.viewTarget); closeSettings(); return; }
    const actionTarget = event.target.closest('[data-action]'); if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === 'open-pair') openPairModal();
    if (action === 'close-pair') closePairModal();
    if (action === 'open-settings') openSettings();
    if (action === 'close-settings') closeSettings();
    if (action === 'run-diagnostic') runDiagnostic();
    if (action === 'open-host-details') openHostModal(actionTarget.dataset.host);
    if (action === 'close-host') closeHostModal();
    if (action === 'toggle-stats') toggleStatsDetail();
    if (action === 'toggle-control-mode') toggleControlMode();
    if (action === 'toggle-fullscreen') void toggleFullscreen();
    if (action === 'show-keyboard') showSoftKeyboard();
    if (action === 'resume-session' && state.activeRemoteSession) void resumeStream(state.activeRemoteSession);
    if (action === 'end-active-session') void (async () => { try { await bridge.stop(); } catch (error) { showToast(t('session.stopFailed'), errorMessage(error), 'warning'); } state.activeRemoteSession = null; renderResumeBar(); })();
    if (action === 'host-unpair') void handleHostUnpair(actionTarget);
    if (action === 'host-delete') void handleHostDelete(actionTarget);
    if (action === 'pair-existing') pairExistingHost();
    if (action === 'copy-fingerprint') void copyFingerprint();
    if (action === 'clear-activity') clearActivity();
    if (action === 'copy-ports') copyPorts();
    if (action === 'wake-host') handleWake(actionTarget.dataset.host);
    if (action === 'refresh-host' || action === 'refresh-apps') handleRefreshHost(actionTarget.dataset.host);
    if (action === 'stop-session') stopStream();
    if (action === 'logout') void (async () => { if (state.streamSession) await stopStream(); await bridge.logout(); })();
    if (action === 'enable-audio') void resumeAudio();
    if (action === 'connect') closeHostModal();
    if (action === 'connect') openStream(actionTarget.dataset.host, actionTarget.dataset.app, actionTarget.dataset.appId);
  });

  document.addEventListener('submit', (event) => { if (event.target.matches('#pairForm')) handlePairSubmit(event); if (event.target.matches('#hostForm')) void handleHostSave(event); });
  document.addEventListener('mousedown', (event) => { if (event.target.matches('#hostModal')) closeHostModal(); });
  document.addEventListener('click', (event) => { const toggle = event.target.closest('[data-toggle]'); if (toggle) toggleSetting(toggle); });
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('#resolutionSelect')) {
      const match = String(target.value).match(/(\d+)x(\d+)/);
      if (target.value === 'auto') state.settings.resolution = 'auto';
      else if (match) Object.assign(state.settings, { resolution: target.value, width: Number(match[1]), height: Number(match[2]) });
      saveSettings(); renderAll();
    }
    if (target.matches('#controlModeSelect')) { state.settings.controlMode = target.value; saveSettings(); }
    if (target.matches('#bitrateModeSelect')) { state.settings.bitrateMode = target.value; saveSettings(); }
    if (target.matches('#codecSelect')) { state.settings.codec = target.value; saveSettings(); }
    if (target.matches('#hostForm select')) updateBitratePlaceholder();
    if (target.matches('#fpsSelect')) { const fps = Number.parseInt(target.value, 10); if (Number.isFinite(fps)) { state.settings.fps = fps; saveSettings(); renderAll(); } }
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyS' && !qs('#streamOverlay')?.hidden) { event.preventDefault(); if (!event.repeat) toggleStatsDetail(); }
  });
  document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; if (!qs('#hostModal')?.hidden) closeHostModal(); else if (!qs('#pairModal')?.hidden) closePairModal(); else if (qs('#settingsDrawer')?.classList.contains('is-open')) closeSettings(); else if (qs('#streamOverlay') && !qs('#streamOverlay').hidden && !(state.inputController && inputConnected())) stopStream(); });
  window.addEventListener('sunbridge:locale', () => { renderAll(); renderHostModal(); applyControlModeUi(); renderReconnect(); renderResumeBar(); });
  // Fullscreen: capture system keys (Win, Alt+Tab, Esc) for the host where the browser allows it.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) navigator.keyboard?.lock?.().catch?.(() => {});
    else navigator.keyboard?.unlock?.();
    applyControlModeUi();
  });
  // Network back: retry right away instead of waiting for the backoff timer.
  window.addEventListener('online', () => { if (state.gatewayRetryTimer) void retryGateway(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.streamSession) void refreshActiveSession(); });

  // Paint localized, state-accurate shell copy before the first asynchronous Bridge probe.
  // This keeps the initial frame in the selected language and avoids a demo/English flash.
  hydrateIcons();
  renderAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeApp, { once: true }); else initializeApp();
})();

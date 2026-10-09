(function () {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
  const DEMO_HOSTS = [
    { id: 'demo-mira', name: "Mira's Rig", address: '192.168.1.42', os: 'Windows 11', sunshine: '0.23-demo', gpu: 'RTX 4080 Super', state: 'online', paired: true, lastSeen: 'demo', apps: [{ id: 1, name: 'Desktop' }, { id: 2, name: 'Cyberpunk 2077' }, { id: 3, name: 'Hades II' }, { id: 4, name: 'Elden Ring' }] },
    { id: 'demo-studio', name: 'Studio NUC', address: '192.168.1.76', os: 'Windows 11', sunshine: '0.23-demo', gpu: 'RTX 3060 Ti', state: 'sleeping', paired: true, lastSeen: 'demo', mac: '00:11:22:33:44:55', apps: [{ id: 1, name: 'Desktop' }] },
  ];

  class SunbridgeClient {
    constructor() {
      this.demo = new URLSearchParams(window.location.search).get('demo') === '1';
      this.baseUrl = window.location.origin;
      this.mode = this.demo ? 'demo' : 'live';
      this.health = null;
      this.hosts = this.demo ? DEMO_HOSTS.map((host) => ({ ...host, apps: host.apps.map((app) => ({ ...app })) })) : [];
      this.activeSession = null;
    }

    get isDemo() { return this.demo; }
    get transportLabel() { return this.demo ? 'demo' : 'live-control'; }

    async request(path, options = {}) {
      const callerSignal = options.signal;
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(1, Number(options.timeoutMs)) : DEFAULT_REQUEST_TIMEOUT_MS;
      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort(callerSignal?.reason);
      if (callerSignal?.aborted) abortFromCaller();
      else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: options.method || 'GET',
          headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        let payload = null;
        try { payload = await response.json(); } catch { payload = {}; }
        if (response.status === 401 && payload.errorCode === 'AUTH_REQUIRED') {
          // Session expired or revoked: go back to the login page and return here afterwards.
          window.location.assign(`/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
        if (!response.ok || payload.ok === false) {
          const error = new Error(payload.error || `Bridge request failed (${response.status})`);
          error.errorCode = payload.errorCode || null;
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        if (timedOut) {
          const timeoutError = new Error(`Bridge request timed out after ${timeoutMs} ms`);
          timeoutError.errorCode = 'SUNSHINE_UNAVAILABLE';
          timeoutError.status = 408;
          throw timeoutError;
        }
        if (!error?.errorCode && (error?.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(String(error?.message || '')))) {
          error.errorCode = 'SUNSHINE_UNAVAILABLE';
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        callerSignal?.removeEventListener('abort', abortFromCaller);
      }
    }

    async logout() {
      if (!this.demo) {
        try { await this.request('/api/auth/logout', { method: 'POST' }); } catch { /* go to the login page anyway */ }
      }
      window.location.assign('/login.html');
    }

    async healthCheck() {
      if (this.demo) {
        await wait(80);
        this.health = { ok: true, mode: 'demo', version: '0.3-demo', clientId: 'demo-client' };
        return this.health;
      }
      this.health = await this.request('/api/bridge/health');
      return this.health;
    }

    async refreshHosts() {
      if (this.demo) return this.hosts;
      const result = await this.request('/api/bridge/hosts');
      this.hosts = Array.isArray(result.hosts) ? result.hosts : [];
      return this.hosts;
    }

    async initialize() {
      if (this.demo) {
        await wait(120);
        await this.healthCheck();
        return { health: this.health, hosts: this.hosts };
      }
      const health = await this.healthCheck();
      const hosts = await this.refreshHosts();
      return { health, hosts };
    }

    async discover(input = {}) {
      if (this.demo) {
        await wait(240);
        return this.hosts;
      }
      const result = await this.request('/api/bridge/discover', { method: 'POST', body: input });
      if (Array.isArray(result.hosts)) this.hosts = result.hosts;
      if (result.host) this.upsertHost(result.host);
      return result.hosts || (result.host ? [result.host] : this.hosts);
    }

    async info(hostOrInput) {
      const input = this.inputForHost(hostOrInput);
      if (this.demo) {
        await wait(160);
        const host = this.getHost(input) || this.hosts[0];
        return { host, info: { hostname: host.name, appVersion: '7.1.0.0-demo', sunshineVersion: host.sunshine, httpsPort: 47984, httpPort: 47989, statusCode: 200, secure: false } };
      }
      const result = await this.request('/api/bridge/info', { method: 'POST', body: input });
      if (result.host) this.upsertHost(result.host);
      return result;
    }

    async apps(hostOrInput) {
      const input = this.inputForHost(hostOrInput);
      if (this.demo) {
        await wait(120);
        const host = this.getHost(input) || this.hosts[0];
        return { host, apps: host.apps || [] };
      }
      const result = await this.request('/api/bridge/apps', { method: 'POST', body: input });
      if (result.host) this.upsertHost(result.host);
      return result;
    }

    async pair(values) {
      if (this.demo) {
        await wait(420);
        if (!values.address || !values.name || !/^\d{4}$/.test(values.pin)) throw new Error(window.t ? window.t('pair.validation') : 'Enter a host address, display name, and four digit PIN.');
        const existing = this.hosts.find((host) => host.address === values.address);
        const host = existing || { id: `demo-${Date.now()}`, address: values.address, os: 'Windows 11', sunshine: '0.23-demo', gpu: 'Demo GPU', apps: [{ id: 1, name: 'Desktop' }] };
        Object.assign(host, { name: values.name, paired: true, state: 'online', lastSeen: 'demo' });
        this.upsertHost(host);
        return host;
      }
      // Sunshine holds this request open until the PIN is typed into its web UI.
      const result = await this.request('/api/bridge/pair', { method: 'POST', body: values, timeoutMs: 190000 });
      if (result.host) this.upsertHost(result.host);
      return result.host;
    }

    async ping(hostOrInput) {
      const input = this.inputForHost(hostOrInput);
      if (this.demo) {
        await wait(260);
        return { latency: 8, jitter: 0.9, loss: 0, route: 'LAN', demo: true, host: this.getHost(input) || this.hosts[0] };
      }
      return this.request('/api/bridge/ping', { method: 'POST', body: input });
    }

    // Full check of the host, the stream and the bridge (server-side part of the Network page's diagnosis).
    async diagnose(hostOrInput) {
      const input = this.inputForHost(hostOrInput);
      if (this.demo) return { ...(await this.ping(hostOrInput)), checks: [] };
      return this.request('/api/bridge/diagnose', { method: 'POST', body: input, timeoutMs: 30000 });
    }

    // Answer for a test WebRTC connection to the bridge's UDP port.
    async webrtcTest(sdp) {
      return this.request('/api/bridge/webrtc-test', { method: 'POST', body: { sdp }, timeoutMs: 10000 });
    }

    async wake(hostOrInput, mac) {
      const input = this.inputForHost(hostOrInput);
      if (mac) input.mac = mac;
      if (this.demo) {
        await wait(260);
        const host = this.getHost(input);
        if (!host) throw new Error('Host not found.');
        host.state = 'online';
        host.lastSeen = 'demo';
        return host;
      }
      const result = await this.request('/api/bridge/wake', { method: 'POST', body: input });
      if (result.host) this.upsertHost(result.host);
      return result.host;
    }

    async launch({ hostName, hostId, address, appName, appId, width = 1920, height = 1080, fps = 60, bitrateMode = 'auto', videoCodecs = ['h264'], codecProbe = null, codecChoice = null }) {
      const input = { hostName, hostId, address, appName, appId, width, height, fps, bitrateMode, videoCodecs, codecProbe, codecChoice, frames: true };
      if (this.demo) {
        await wait(360);
        const host = this.getHost(input);
        if (!host || host.state !== 'online') throw new Error('The selected host is not online.');
        this.activeSession = { hostId: host.id, hostName: host.name, appId: appId || 1, appName: appName || 'Desktop', startedAt: new Date().toISOString(), controlPlane: 'demo', transport: { rtsp: { state: 'demo' }, media: { state: 'demo' }, input: { state: 'demo' } } };
        return { ...this.activeSession, host, mediaTransport: 'demo-scene' };
      }
      const result = await this.request('/api/bridge/launch', { method: 'POST', body: input });
      this.activeSession = result.session || null;
      return result.session;
    }

    async updateHost(hostId, changes) {
      if (this.demo) {
        await wait(160);
        const host = this.getHost({ hostId });
        if (!host) throw new Error('Host not found.');
        const { address, ...rest } = changes;
        Object.assign(host, rest, address ? { address: String(address).replace(/:\d+$/, '') } : {});
        return host;
      }
      const result = await this.request('/api/bridge/host/update', { method: 'POST', body: { hostId, ...changes } });
      if (result.host) this.upsertHost(result.host);
      return result.host;
    }

    async unpairHost(hostId) {
      if (this.demo) {
        await wait(160);
        const host = this.getHost({ hostId });
        if (host) Object.assign(host, { paired: false, serverFingerprint: null, apps: [] });
        return host;
      }
      const result = await this.request('/api/bridge/host/unpair', { method: 'POST', body: { hostId } });
      if (result.host) this.upsertHost(result.host);
      return result.host;
    }

    async deleteHost(hostId) {
      if (!this.demo) await this.request('/api/bridge/host/delete', { method: 'POST', body: { hostId } });
      else await wait(160);
      this.hosts = this.hosts.filter((host) => host.id !== hostId);
    }

    async session() {
      if (this.demo) return { ok: true, session: this.activeSession };
      const result = await this.request('/api/bridge/session');
      this.activeSession = result.session || null;
      return result;
    }

    mediaGateway({ sessionId, onOpen, onPacket, onMessage, onClose, onError, video = null } = {}) {
      const makeError = (i18nKey, fallback, extra = {}) => {
        const error = new Error(window.t ? window.t(i18nKey) : fallback);
        error.errorCode = extra.errorCode || 'MEDIA_GATEWAY_FAILED';
        error.i18nKey = i18nKey;
        Object.assign(error, extra);
        return error;
      };
      const gateway = {
        socket: null,
        state: this.demo ? 'demo' : 'connecting',
        closed: false,
        close: (code = 1000, reason = '') => {
          gateway.closed = true;
          gateway.state = 'closed';
          try {
            if (gateway.socket && gateway.socket.readyState < 2) gateway.socket.close(code, reason);
          } catch { /* the browser may already have closed the socket */ }
        },
        send: (value) => {
          if (!gateway.socket || gateway.socket.readyState !== window.WebSocket.OPEN) return false;
          try {
            gateway.socket.send(typeof value === 'string' ? value : JSON.stringify(value));
            return true;
          } catch (error) {
            onError?.(makeError('error.mediaGatewayFailed', 'The browser media gateway failed.', { cause: error }));
            return false;
          }
        },
      };
      if (this.demo) {
        window.setTimeout(() => onOpen?.({ demo: true, protocol: 'demo' }), 0);
        return gateway;
      }
      if (typeof window.WebSocket !== 'function') {
        const error = makeError('error.mediaGatewayUnsupported', 'This browser does not support the media gateway.', { errorCode: 'MEDIA_GATEWAY_UNSUPPORTED' });
        gateway.state = 'unsupported';
        onError?.(error);
        onClose?.({ code: 1003, reason: error.message, wasClean: false, error });
        return gateway;
      }
      let url;
      try {
        url = new URL('/api/bridge/media', this.baseUrl);
        if (sessionId) url.searchParams.set('sessionId', sessionId);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        // video = { canvas, options, callbacks }: the socket lives in a worker that also decodes and draws the
        // video (media-worker.js); gateway.videoPipeline is its handle. Otherwise a plain WebSocket.
        if (video?.canvas) {
          const worker = window.SunbridgeMedia.createWorkerSocket(url.toString(), 'sunbridge-media-v1', video.canvas, { video: video.options, audio: video.audio || null, webrtc: video.webrtc !== false, callbacks: video.callbacks });
          gateway.socket = worker.socket;
          gateway.videoPipeline = worker.pipeline;
          gateway.workerControl = worker;
        } else {
          gateway.socket = new window.WebSocket(url.toString(), 'sunbridge-media-v1');
        }
        gateway.socket.binaryType = 'arraybuffer';
      } catch (error) {
        const failure = makeError('error.mediaGatewayFailed', 'The browser media gateway failed.', { cause: error });
        gateway.state = 'failed';
        onError?.(failure);
        onClose?.({ code: 1006, reason: failure.message, wasClean: false, error: failure });
        return gateway;
      }
      let errorReported = false;
      gateway.socket.onopen = () => {
        if (gateway.closed) return;
        if (gateway.socket.protocol && gateway.socket.protocol !== 'sunbridge-media-v1') {
          const error = makeError('error.mediaGatewayUnsupported', 'The media gateway protocol is not supported.', { errorCode: 'MEDIA_GATEWAY_UNSUPPORTED' });
          errorReported = true;
          gateway.state = 'unsupported';
          onError?.(error);
          gateway.close(1002, 'unsupported subprotocol');
          return;
        }
        gateway.state = 'connected';
        // frames: whole video frames assembled by the bridge (no FEC parity / RTP headers over this link).
        gateway.send({ type: 'subscribe', sessionId: sessionId || null, frames: true, ...(video?.subscribe || {}) });
        onOpen?.({ protocol: gateway.socket.protocol || 'sunbridge-media-v1', sessionId: sessionId || null });
      };
      // Hot path (thousands of packets per second): stay synchronous for ArrayBuffer data.
      gateway.socket.onmessage = (event) => {
        if (gateway.closed) return;
        const data = event.data;
        if (data instanceof ArrayBuffer) {
          onPacket?.(data, event.meta || null);
          return;
        }
        if (typeof data === 'string') {
          try { onMessage?.(JSON.parse(data)); } catch { onMessage?.({ type: 'text', data }); }
          return;
        }
        void deliverOther(data);
      };
      const deliverOther = async (data) => {
        try {
          const packet = ArrayBuffer.isView(data)
            ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            : data && typeof data.arrayBuffer === 'function'
              ? await data.arrayBuffer()
              : data;
          if (!gateway.closed) onPacket?.(packet);
        } catch (error) {
          const failure = makeError('error.mediaGatewayFailed', 'The browser media gateway failed.', { cause: error });
          onError?.(failure);
        }
      };
      gateway.socket.onerror = () => {
        if (gateway.closed || errorReported) return;
        errorReported = true;
        const error = makeError('error.mediaGatewayFailed', 'The browser media gateway failed.');
        gateway.state = 'failed';
        onError?.(error);
      };
      gateway.socket.onclose = (event) => {
        gateway.state = 'closed';
        const expected = gateway.closed || event.code === 1000;
        if (!expected && !errorReported) {
          const error = makeError('error.mediaGatewayDisconnected', 'The browser media gateway disconnected.', { errorCode: 'MEDIA_GATEWAY_DISCONNECTED', closeCode: event.code });
          onError?.(error);
        }
        onClose?.({ code: event.code, reason: event.reason || '', wasClean: event.wasClean, expected });
      };
      return gateway;
    }

    sessionEvents({ onEvent, onError } = {}) {
      if (this.demo) return () => {};
      if (typeof window.EventSource !== 'function') {
        const error = new Error(window.t ? window.t('error.sessionEventsUnsupported') : 'This browser does not support live session events.');
        error.errorCode = 'BRIDGE_ERROR';
        error.i18nKey = 'error.sessionEventsUnsupported';
        onError?.(error);
        return () => {};
      }
      const source = new EventSource(`${this.baseUrl}/api/bridge/session/events`);
      const eventNames = [
        'session-snapshot', 'session-started', 'rtsp-probing', 'rtsp-options',
        'rtsp-describe', 'rtsp-setup', 'rtsp-announce', 'rtsp-negotiated',
        'media-first-packet', 'media-stats', 'media-gateway', 'media-gateway-stats', 'session-failed', 'session-stopped',
        'session-reconnecting', 'session-reconnected', 'session-resized', 'session-terminated',
        'input-connecting', 'input-connected', 'input-disconnected', 'input-failed',
      ];
      let closed = false;
      let errorReported = false;
      const handleEvent = (event) => {
        try {
          const payload = JSON.parse(event.data || '{}');
          if (payload.type === 'session-stopped') this.activeSession = null;
          else if (Object.prototype.hasOwnProperty.call(payload, 'session')) this.activeSession = payload.session || null;
          onEvent?.(payload);
        } catch (error) {
          error.errorCode = 'BRIDGE_ERROR';
          onError?.(error);
        }
      };
      eventNames.forEach((name) => source.addEventListener(name, handleEvent));
      source.onopen = () => { errorReported = false; };
      source.onerror = () => {
        if (closed || errorReported) return;
        errorReported = true;
          const error = new Error(window.t ? window.t('error.sessionEventsDisconnected') : 'The live session event stream disconnected; reconnecting.');
        error.errorCode = 'BRIDGE_ERROR';
          error.i18nKey = 'error.sessionEventsDisconnected';
        onError?.(error);
      };
      return () => {
        if (closed) return;
        closed = true;
        eventNames.forEach((name) => source.removeEventListener(name, handleEvent));
        source.close();
      };
    }

    // Ask the bridge to change the stream resolution (live when the host supports it, else via reconnect).
    async resize(width, height, method = 'auto') {
      if (this.demo) return { method: 'none', width, height };
      return this.request('/api/bridge/session/resize', { method: 'POST', body: { width, height, method } });
    }

    async reconnect() {
      if (this.demo) return { ok: true };
      return this.request('/api/bridge/session/reconnect', { method: 'POST', body: {} });
    }

    async stop() {
      if (this.demo) {
        await wait(120);
        const previous = this.activeSession;
        this.activeSession = null;
        return previous;
      }
      const result = await this.request('/api/bridge/stop', { method: 'POST', body: {} });
      if (result.stopped === false) return null;
      this.activeSession = null;
      return result.session || null;
    }

    inputForHost(hostOrInput) {
      if (typeof hostOrInput === 'string') {
        const host = this.hosts.find((item) => item.name === hostOrInput || item.id === hostOrInput || item.address === hostOrInput);
        return host ? { hostId: host.id, address: host.address } : { hostId: hostOrInput };
      }
      if (!hostOrInput) return {};
      if (hostOrInput.id || hostOrInput.hostId || hostOrInput.address) {
        return {
          hostId: hostOrInput.hostId || hostOrInput.id,
          address: hostOrInput.address,
          mac: hostOrInput.mac,
          httpPort: hostOrInput.httpPort,
          httpsPort: hostOrInput.httpsPort,
          rtspPort: hostOrInput.rtspPort,
          port: hostOrInput.port,
          scheme: hostOrInput.scheme,
        };
      }
      if (hostOrInput.hostName) {
        const host = this.hosts.find((item) => item.name === hostOrInput.hostName);
        return { ...hostOrInput, hostId: host?.id, address: host?.address };
      }
      return { ...hostOrInput };
    }

    getHost(input = {}) {
      const id = input.hostId || input.id;
      return this.hosts.find((host) => host.id === id || host.address === input.address || host.name === input.hostName || host.name === input.name);
    }

    upsertHost(host) {
      if (!host) return;
      const index = this.hosts.findIndex((item) => item.id === host.id || item.address === host.address);
      if (index >= 0) this.hosts[index] = { ...this.hosts[index], ...host };
      else this.hosts.push(host);
    }
  }

  window.SunbridgeClient = SunbridgeClient;
  window.sunbridgeClient = new SunbridgeClient();
})();

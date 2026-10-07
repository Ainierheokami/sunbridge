// Media worker: owns the media WebSockets, decodes video and draws it on an OffscreenCanvas, decodes audio and
// hands it straight to the AudioWorklet, and passes JSON messages to the page. Off the main thread, page work
// (layout, the stats panel, input, garbage collection) can't hold up video or audio, and each message is
// timestamped when it really arrives: measured on the main thread, a busy page looked like network queueing
// and made the bridge lower the bitrate.
//
// Audio has a socket of its own when the page asks for it (open.audio): on one TCP connection, a video packet
// lost on the way held every audio packet behind it until it was retransmitted, which emptied the audio
// buffer. If that socket can't be kept up, audio moves back onto the video socket.
importScripts('media.js');

(function () {
  'use strict';
  const Media = self.SunbridgeMedia;
  const STATS_INTERVAL_MS = 250;
  const AUDIO_SOCKET_FAILURES_BEFORE_FALLBACK = 2;
  let socket = null;
  let protocol = null;
  let pipeline = null;
  let statsTimer = null;
  let closed = false;
  // The page's subscribe message on the video socket, kept to move audio onto it if needed.
  let mainSubscribe = null;
  let audio = null; // { url, sessionId, group } while audio has its own socket
  let audioSocket = null;
  let audioFailures = 0;
  let audioRetryTimer = null;
  let audioPipeline = null; // decodes here once the page hands over the worklet's port
  let audioBytes = 0; // received on the audio socket since the last report

  const post = (message, transfer = []) => self.postMessage(message, transfer);
  const postStats = () => {
    if (pipeline) post({ type: 'video-stats', stats: pipeline.stats });
    if (audioPipeline) post({ type: 'audio-stats', stats: audioPipeline.stats });
  };

  function open(message) {
    protocol = message.protocol;
    audio = message.audio || null;
    pipeline = Media.createVideoPipeline(message.canvas, {
      ...message.video,
      onState: (stats) => post({ type: 'video-stats', stats }),
      onFrame: (frame) => { if (frame?.waitingKeyframe) post({ type: 'video-keyframe-needed' }); },
      onError: (error) => post({ type: 'video-error', name: error?.name || null, message: String(error?.message || error) }),
      onHardwareFallback: ({ codecFamily }) => post({ type: 'video-hardware-fallback', codecFamily }),
    });
    statsTimer = setInterval(postStats, STATS_INTERVAL_MS);
    try {
      socket = new WebSocket(message.url, protocol);
    } catch (error) {
      post({ type: 'socket-error', message: String(error?.message || error) });
      post({ type: 'socket-close', code: 1006, reason: '', wasClean: false });
      return;
    }
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => post({ type: 'socket-open', protocol: socket.protocol });
    socket.onerror = () => post({ type: 'socket-error' });
    socket.onclose = (event) => post({ type: 'socket-close', code: event.code, reason: event.reason || '', wasClean: event.wasClean });
    socket.onmessage = (event) => {
      const data = event.data;
      if (typeof data === 'string') { post({ type: 'socket-text', data }); return; }
      handleMedia(data, Date.now());
    };
    if (audio) openAudioSocket();
  }

  // One media message (from the socket, or a frame reassembled from the video DataChannel): video is decoded
  // here; audio too once the worklet's port has arrived, until then its envelopes go to the page. lostBefore:
  // frames lost on the way right before this one (the pipeline then waits for a keyframe and asks for one).
  // ownBytes: what to count for this message (DataChannel fragments are counted as they arrive).
  function handleMedia(data, arrivedAt, lostBefore = 0, ownBytes = data.byteLength) {
    // Video stays here. Audio is decoded here too once the worklet's port has arrived; until then (or when
    // the page decodes it) its envelopes go to the page as one buffer.
    const forward = [];
    let forwardBytes = 0;
    let receivedAt = null;
    try {
      Media.forEachEnvelope(data, (envelope, view) => {
        if (receivedAt == null) receivedAt = envelope.receivedAt;
        if (envelope.stream === 'audio') {
          if (audioPipeline) audioPipeline.ingest(envelope);
          else { forward.push(view); forwardBytes += view.length; }
        } else if (envelope.stream === 'video-frame' || envelope.stream === 'video') {
          if (lostBefore) { envelope.flags += lostBefore; lostBefore = 0; }
          pipeline.ingest(envelope);
        }
      });
    } catch { /* a malformed message is dropped; the frame header reports the loss */ }
    let buffer = null;
    if (forward.length) {
      const bytes = new Uint8Array(forwardBytes);
      let offset = 0;
      for (const view of forward) { bytes.set(view, offset); offset += view.length; }
      buffer = bytes.buffer;
    }
    const bytes = ownBytes + audioBytes + rtcBytes;
    audioBytes = 0;
    rtcBytes = 0;
    post({ type: 'socket-media', bytes, receivedAt, arrivedAt, audio: buffer }, buffer ? [buffer] : []);
  }

  // ----- WebRTC DataChannels (see webrtc.mjs) -----
  // video: unordered fragments [u32 frame sequence][u16 index][u16 count][part of an envelope]; frames are
  // reassembled and delivered in sequence. A gap waits up to RTC_REORDER_MS for a late (retransmitted) frame,
  // then is skipped and reported as lost. audio: each message holds a packet and the one before it (a copy
  // covering a lost message); the audio pipeline orders them and drops the duplicates.
  const RTC_REORDER_MS = 150;
  const RTC_PARTIAL_MS = 500;
  const RTC_HEADER_BYTES = 8;
  const rtcPartial = new Map(); // sequence -> { parts, received, bytes, firstAt }
  const rtcReady = new Map(); // sequence -> { data, at }
  let rtcExpected = null;
  let rtcBytes = 0; // fragment bytes not yet reported
  let rtcTimer = null;
  const seqBefore = (a, b) => ((a - b) | 0) < 0;

  function attachRtc({ video, audio: audioChannel }) {
    for (const channel of [video, audioChannel]) channel.binaryType = 'arraybuffer';
    video.onmessage = (event) => onVideoFragment(event.data);
    audioChannel.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      if (!audioPipeline) {
        post({ type: 'socket-media', bytes: data.byteLength, receivedAt: null, arrivedAt: Date.now(), audio: data }, [data]);
        return;
      }
      rtcBytes += data.byteLength;
      try { Media.forEachEnvelope(data, (envelope) => { if (envelope.stream === 'audio') audioPipeline.ingest(envelope); }); } catch { /* dropped */ }
    };
    clearInterval(rtcTimer);
    rtcTimer = setInterval(() => drainRtc(performance.now()), 20);
  }

  function onVideoFragment(data) {
    if (!(data instanceof ArrayBuffer) || data.byteLength <= RTC_HEADER_BYTES) return;
    const view = new DataView(data);
    const sequence = view.getUint32(0);
    const index = view.getUint16(4);
    const count = view.getUint16(6);
    rtcBytes += data.byteLength;
    if (rtcExpected != null && seqBefore(sequence, rtcExpected)) return; // gave up on it already
    if (!count || index >= count) return;
    const now = performance.now();
    let entry = rtcPartial.get(sequence);
    if (!entry) {
      entry = { parts: new Array(count), received: 0, bytes: 0, firstAt: now };
      rtcPartial.set(sequence, entry);
    }
    if (entry.parts[index]) return;
    entry.parts[index] = new Uint8Array(data, RTC_HEADER_BYTES);
    entry.received += 1;
    entry.bytes += data.byteLength - RTC_HEADER_BYTES;
    if (entry.received < count) return;
    rtcPartial.delete(sequence);
    let whole;
    if (count === 1) {
      whole = data.slice(RTC_HEADER_BYTES);
    } else {
      const bytes = new Uint8Array(entry.bytes);
      let offset = 0;
      for (const part of entry.parts) { bytes.set(part, offset); offset += part.length; }
      whole = bytes.buffer;
    }
    rtcReady.set(sequence, { data: whole, at: now });
    drainRtc(now);
  }

  function drainRtc(now) {
    for (const [sequence, entry] of rtcPartial) {
      if (now - entry.firstAt > RTC_PARTIAL_MS) rtcPartial.delete(sequence);
    }
    if (!rtcReady.size) return;
    if (rtcExpected == null) rtcExpected = [...rtcReady.keys()].reduce((a, b) => (seqBefore(b, a) ? b : a));
    let lost = 0;
    for (;;) {
      const entry = rtcReady.get(rtcExpected);
      if (entry) {
        rtcReady.delete(rtcExpected);
        rtcExpected = (rtcExpected + 1) >>> 0;
        handleMedia(entry.data, Date.now(), lost, 0);
        lost = 0;
        continue;
      }
      if (!rtcReady.size) break;
      // A later frame is complete but this one isn't: wait a little for a retransmission, then skip it.
      const oldest = Math.min(...[...rtcReady.values()].map((item) => item.at));
      if (now - oldest < RTC_REORDER_MS) break;
      const next = [...rtcReady.keys()].reduce((a, b) => (seqBefore(b, a) ? b : a));
      lost += (next - rtcExpected) >>> 0;
      for (const sequence of [...rtcPartial.keys()]) if (seqBefore(sequence, next)) rtcPartial.delete(sequence);
      rtcExpected = next;
    }
  }

  function openAudioSocket() {
    audioRetryTimer = null;
    if (closed || !audio) return;
    let ws;
    try {
      ws = new WebSocket(audio.url, protocol);
    } catch {
      audioSocketFailed(false);
      return;
    }
    let opened = false;
    audioSocket = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      opened = true;
      audioFailures = 0;
      ws.send(JSON.stringify({ type: 'subscribe', sessionId: audio?.sessionId || null, frames: true, video: false, audio: true, group: audio?.group || null }));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') return; // the video socket carries the JSON the page needs
      // Not decoding here (the page's worklet isn't ready, or failed): the page decodes it.
      if (!audioPipeline) {
        post({ type: 'socket-media', bytes: event.data.byteLength, receivedAt: null, arrivedAt: Date.now(), audio: event.data }, [event.data]);
        return;
      }
      audioBytes += event.data.byteLength;
      try {
        Media.forEachEnvelope(event.data, (envelope) => { if (envelope.stream === 'audio') audioPipeline.ingest(envelope); });
      } catch { /* dropped */ }
    };
    ws.onclose = () => {
      if (audioSocket === ws) audioSocket = null;
      audioSocketFailed(opened);
    };
  }

  // Reconnect a dropped audio socket; one that keeps failing to open hands audio back to the video socket.
  function audioSocketFailed(hadOpened) {
    if (closed || !audio) return;
    if (!hadOpened) audioFailures += 1;
    if (audioFailures >= AUDIO_SOCKET_FAILURES_BEFORE_FALLBACK) {
      audio = null;
      if (mainSubscribe && socket?.readyState === 1) socket.send(JSON.stringify({ ...mainSubscribe, audio: true }));
      post({ type: 'audio-socket-fallback' });
      return;
    }
    audioRetryTimer = setTimeout(openAudioSocket, hadOpened ? 500 : 2000);
  }

  function attachAudio(port) {
    try { audioPipeline?.stop(); } catch { /* already stopped */ }
    audioPipeline = Media.createAudioPipeline({
      outputPort: port,
      onState: (stats) => post({ type: 'audio-stats', stats }),
      onError: (error) => post({ type: 'audio-error', message: String(error?.message || error) }),
    });
  }

  function close(code, reason) {
    closed = true;
    clearInterval(statsTimer);
    clearInterval(rtcTimer);
    clearTimeout(audioRetryTimer);
    statsTimer = null;
    try { pipeline?.stop(); } catch { /* already stopped */ }
    try { audioPipeline?.stop(); } catch { /* already stopped */ }
    postStats();
    pipeline = null;
    audioPipeline = null;
    try { if (audioSocket && audioSocket.readyState < 2) audioSocket.close(code, reason); } catch { /* already closed */ }
    try { if (socket && socket.readyState < 2) socket.close(code, reason); } catch { /* already closed */ }
  }

  self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === 'open') open(message);
    else if (message.type === 'audio-port') attachAudio(message.port);
    else if (message.type === 'rtc-channels') attachRtc(message);
    else if (message.type === 'send') {
      if (typeof message.data === 'string' && message.data.includes('"subscribe"')) {
        try { mainSubscribe = JSON.parse(message.data); } catch { /* not JSON */ }
      }
      if (socket?.readyState === 1) socket.send(message.data);
    } else if (message.type === 'close') close(message.code, message.reason);
  };
})();

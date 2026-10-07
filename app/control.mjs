// GameStream control stream for the local bridge: a minimal ENet client (the wire
// protocol Sunshine's control port speaks), AES-GCM "control V2" encryption, and
// encoders for the NV/Sunshine input packets. No third-party dependencies.
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// ENet wire constants (enet/protocol.h)
// ---------------------------------------------------------------------------
const CMD = Object.freeze({
  ACKNOWLEDGE: 1,
  CONNECT: 2,
  VERIFY_CONNECT: 3,
  DISCONNECT: 4,
  PING: 5,
  SEND_RELIABLE: 6,
  SEND_UNRELIABLE: 7,
  SEND_FRAGMENT: 8,
  SEND_UNSEQUENCED: 9,
  BANDWIDTH_LIMIT: 10,
  THROTTLE_CONFIGURE: 11,
  SEND_UNRELIABLE_FRAGMENT: 12,
});
const CMD_MASK = 0x0f;
const FLAG_ACKNOWLEDGE = 0x80;
const FLAG_UNSEQUENCED = 0x40;
const HEADER_FLAG_COMPRESSED = 0x4000;
const HEADER_FLAG_SENT_TIME = 0x8000;
const HEADER_SESSION_MASK = 0x3000;
const HEADER_SESSION_SHIFT = 12;
const MAXIMUM_PEER_ID = 0x0fff;
const PEER_CHANNEL = 0xff;
const COMMAND_SIZES = [0, 8, 48, 44, 8, 4, 6, 8, 24, 8, 12, 16, 24];

const ENET_MTU = 1392;
// Data per SEND_FRAGMENT command: the MTU less the datagram header (with sent time) and the 24-byte command.
const ENET_FRAGMENT_BYTES = ENET_MTU - 8 - 24;
// Largest message reassembled from fragments (clipboard frames are ~64 KB).
const MAX_REASSEMBLED_BYTES = 1024 * 1024;
const ENET_WINDOW_SIZE = 65536;
const CONNECT_RETRY_MS = 500;
const CONNECT_TIMEOUT_MS = 10000;
const PEER_TIMEOUT_MS = 10000;
const MIN_RTO_MS = 50;
const MAX_RTO_MS = 2000;

// ---------------------------------------------------------------------------
// GameStream control stream constants (Gen7, encrypted)
// ---------------------------------------------------------------------------
export const CONTROL_CHANNEL = Object.freeze({
  GENERIC: 0x00,
  URGENT: 0x01,
  KEYBOARD: 0x02,
  MOUSE: 0x03,
  PEN: 0x04,
  TOUCH: 0x05,
  UTF8: 0x06,
  GAMEPAD_BASE: 0x10,
  SENSOR_BASE: 0x20,
  COUNT: 0x30,
});

export const CONTROL_TYPE = Object.freeze({
  REQUEST_IDR: 0x0302,
  START_B: 0x0307,
  INVALIDATE_REF_FRAMES: 0x0301,
  LOSS_STATS: 0x0201,
  INPUT_DATA: 0x0206,
  RUMBLE: 0x010b,
  TERMINATION: 0x0109,
  PERIODIC_PING: 0x0200,
  ENCRYPTED: 0x0001,
  HDR_MODE: 0x010e,
  RUMBLE_TRIGGERS: 0x5500,
  // Foundation Sunshine clipboard sync: an opaque frame for its desktop agent (see clipboard.mjs).
  CLIPBOARD: 0x5508,
});

const PERIODIC_PING_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// Minimal ENet peer (client side, single peer)
// ---------------------------------------------------------------------------
export class EnetClient extends EventEmitter {
  constructor({ address, port, channelCount = CONTROL_CHANNEL.COUNT, connectData = 0, socket = null } = {}) {
    super();
    this.address = address;
    this.port = port;
    this.channelCount = channelCount;
    this.connectData = connectData >>> 0;
    this.socket = socket;
    this.ownsSocket = !socket;
    this.state = 'disconnected';
    this.epoch = Date.now();
    this.outgoingPeerId = MAXIMUM_PEER_ID;
    this.incomingSessionId = 0xff;
    this.outgoingSessionId = 0xff;
    this.connectId = crypto.randomBytes(4).readUInt32BE(0);
    this.peerReliableSeq = 0;
    this.channels = Array.from({ length: channelCount }, () => ({ outgoingReliable: 0, outgoingUnreliable: 0, incomingReliable: 0 }));
    this.unsequencedGroup = 0;
    this.pending = new Map(); // `${channel}:${seq}` -> { buffer, sentAt, firstSentAt, rto }
    this.pendingAcks = [];
    this.outgoing = [];
    this.flushScheduled = false;
    this.rtt = 100;
    this.rttVariance = 50;
    this.lastReceiveAt = 0;
    this.timer = null;
    this.onMessage = (packet, rinfo) => this.handleDatagram(packet, rinfo);
  }

  now() {
    return (Date.now() - this.epoch) & 0xffff;
  }

  async connect(timeoutMs = CONNECT_TIMEOUT_MS) {
    if (!this.socket) {
      this.socket = dgram.createSocket(this.address.includes(':') ? 'udp6' : 'udp4');
      await new Promise((resolve, reject) => {
        this.socket.once('error', reject);
        this.socket.bind(0, () => { this.socket.removeListener('error', reject); resolve(); });
      });
    }
    this.socket.on('message', this.onMessage);
    this.socket.on('error', (error) => this.emit('error', error));
    this.state = 'connecting';
    const connectCommand = Buffer.alloc(48);
    connectCommand[0] = CMD.CONNECT | FLAG_ACKNOWLEDGE;
    connectCommand[1] = PEER_CHANNEL;
    connectCommand.writeUInt16BE(this.peerReliableSeq = (this.peerReliableSeq + 1) & 0xffff, 2);
    connectCommand.writeUInt16BE(0, 4); // our incoming peer id
    connectCommand[6] = this.incomingSessionId;
    connectCommand[7] = this.outgoingSessionId;
    connectCommand.writeUInt32BE(ENET_MTU, 8);
    connectCommand.writeUInt32BE(ENET_WINDOW_SIZE, 12);
    connectCommand.writeUInt32BE(this.channelCount, 16);
    connectCommand.writeUInt32BE(0, 20);
    connectCommand.writeUInt32BE(0, 24);
    connectCommand.writeUInt32BE(5000, 28);
    connectCommand.writeUInt32BE(2, 32);
    connectCommand.writeUInt32BE(2, 36);
    connectCommand.writeUInt32BE(this.connectId, 40);
    connectCommand.writeUInt32BE(this.connectData, 44);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const send = () => this.sendDatagram([connectCommand], true);
      send();
      const retry = setInterval(() => {
        if (this.state !== 'connecting') return;
        if (Date.now() - started > timeoutMs) {
          cleanup();
          this.close(false);
          const error = new Error(`ENet control connection to ${this.address}:${this.port} timed out`);
          error.errorCode = 'CONTROL_CONNECT_TIMEOUT';
          reject(error);
          return;
        }
        send();
      }, CONNECT_RETRY_MS);
      const onConnect = () => { cleanup(); resolve(); };
      const onClose = () => {
        cleanup();
        const error = new Error('ENet control connection was refused');
        error.errorCode = 'CONTROL_CONNECT_REFUSED';
        reject(error);
      };
      const cleanup = () => {
        clearInterval(retry);
        this.removeListener('connect', onConnect);
        this.removeListener('disconnect', onClose);
      };
      this.once('connect', onConnect);
      this.once('disconnect', onClose);
    });
  }

  headerFor(withSentTime) {
    let peerId = this.outgoingPeerId;
    if (this.outgoingPeerId < MAXIMUM_PEER_ID) peerId |= (this.outgoingSessionId & 0x3) << HEADER_SESSION_SHIFT;
    const header = Buffer.alloc(withSentTime ? 4 : 2);
    if (withSentTime) {
      header.writeUInt16BE(peerId | HEADER_FLAG_SENT_TIME, 0);
      header.writeUInt16BE(this.now(), 2);
    } else {
      header.writeUInt16BE(peerId, 0);
    }
    return header;
  }

  sendDatagram(commands, withSentTime, callback = () => {}) {
    if (!this.socket || this.state === 'closed') return;
    const packet = Buffer.concat([this.headerFor(withSentTime), ...commands]);
    try { this.socket.send(packet, this.port, this.address, callback); } catch { callback(); }
  }

  // Queue a command for the next flush; reliable ones are tracked for retransmission.
  queue(buffer, reliable) {
    this.outgoing.push({ buffer, reliable });
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.flush());
  }

  flush() {
    this.flushScheduled = false;
    if (this.state === 'closed') return;
    const commands = [...this.pendingAcks, ...this.outgoing.map((item) => item.buffer)];
    const needsSentTime = this.outgoing.some((item) => item.reliable);
    this.pendingAcks = [];
    this.outgoing = [];
    let batch = [];
    let size = 4;
    for (const command of commands) {
      if (batch.length && size + command.length > ENET_MTU) {
        this.sendDatagram(batch, needsSentTime);
        batch = [];
        size = 4;
      }
      batch.push(command);
      size += command.length;
    }
    if (batch.length) this.sendDatagram(batch, needsSentTime);
  }

  trackReliable(channelId, seq, buffer) {
    const now = Date.now();
    this.pending.set(`${channelId}:${seq}`, { buffer, sentAt: now, firstSentAt: now, rto: this.currentRto() });
  }

  currentRto() {
    return Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, Math.round(this.rtt + 4 * this.rttVariance)));
  }

  // Send application data. mode: 'reliable' | 'unsequenced'
  send(channelId, data, mode = 'reliable') {
    if (this.state !== 'connected') return false;
    if (channelId >= this.channelCount) channelId = 0;
    const payload = Buffer.from(data);
    if (payload.length > ENET_MTU - 16) {
      // Larger than one datagram (clipboard sync): reliable fragments, reassembled by the host.
      if (mode === 'unsequenced') throw new RangeError('control message too large for an unsequenced ENet command');
      return this.sendFragments(channelId, payload);
    }
    if (mode === 'unsequenced') {
      const command = Buffer.alloc(8 + payload.length);
      command[0] = CMD.SEND_UNSEQUENCED | FLAG_UNSEQUENCED;
      command[1] = channelId;
      command.writeUInt16BE(0, 2);
      this.unsequencedGroup = (this.unsequencedGroup + 1) & 0xffff;
      command.writeUInt16BE(this.unsequencedGroup, 4);
      command.writeUInt16BE(payload.length, 6);
      payload.copy(command, 8);
      this.queue(command, false);
      return true;
    }
    const channel = this.channels[channelId];
    channel.outgoingReliable = (channel.outgoingReliable + 1) & 0xffff;
    const command = Buffer.alloc(6 + payload.length);
    command[0] = CMD.SEND_RELIABLE | FLAG_ACKNOWLEDGE;
    command[1] = channelId;
    command.writeUInt16BE(channel.outgoingReliable, 2);
    command.writeUInt16BE(payload.length, 4);
    payload.copy(command, 6);
    this.trackReliable(channelId, channel.outgoingReliable, command);
    this.queue(command, true);
    return true;
  }

  // ENet SEND_FRAGMENT: each fragment is a reliable command with its own sequence number; startSequenceNumber
  // (the first one's) ties them together. Layout after the 4-byte command header: startSequenceNumber u16,
  // dataLength u16, fragmentCount u32, fragmentNumber u32, totalLength u32, fragmentOffset u32.
  sendFragments(channelId, payload) {
    const channel = this.channels[channelId];
    const count = Math.ceil(payload.length / ENET_FRAGMENT_BYTES);
    const start = (channel.outgoingReliable + 1) & 0xffff;
    for (let index = 0; index < count; index += 1) {
      const offset = index * ENET_FRAGMENT_BYTES;
      const part = payload.subarray(offset, offset + ENET_FRAGMENT_BYTES);
      channel.outgoingReliable = (channel.outgoingReliable + 1) & 0xffff;
      const command = Buffer.alloc(24 + part.length);
      command[0] = CMD.SEND_FRAGMENT | FLAG_ACKNOWLEDGE;
      command[1] = channelId;
      command.writeUInt16BE(channel.outgoingReliable, 2);
      command.writeUInt16BE(start, 4);
      command.writeUInt16BE(part.length, 6);
      command.writeUInt32BE(count, 8);
      command.writeUInt32BE(index, 12);
      command.writeUInt32BE(payload.length, 16);
      command.writeUInt32BE(offset, 20);
      part.copy(command, 24);
      this.trackReliable(channelId, channel.outgoingReliable, command);
      this.queue(command, true);
    }
    return true;
  }

  // Reassemble a fragmented message; delivered once every fragment is in.
  receiveFragment(channelId, seq, command) {
    if (channelId >= this.channels.length) return;
    const channel = this.channels[channelId];
    const start = command.readUInt16BE(4);
    const length = command.readUInt16BE(6);
    const count = command.readUInt32BE(8);
    const index = command.readUInt32BE(12);
    const total = command.readUInt32BE(16);
    const offset = command.readUInt32BE(20);
    if (!count || index >= count || total > MAX_REASSEMBLED_BYTES || offset + length > total) return;
    channel.fragments ||= new Map();
    let entry = channel.fragments.get(start);
    if (!entry) {
      // Keep at most a few messages in reassembly; a stale one (its sender gave up) is dropped.
      if (channel.fragments.size >= 4) channel.fragments.delete(channel.fragments.keys().next().value);
      entry = { data: Buffer.alloc(total), received: new Set(), count };
      channel.fragments.set(start, entry);
    }
    if (entry.received.has(index) || entry.count !== count || entry.data.length !== total) return;
    command.copy(entry.data, offset, 24, 24 + length);
    entry.received.add(index);
    if (((seq - channel.incomingReliable) & 0xffff) < 0x8000) channel.incomingReliable = seq;
    if (entry.received.size < count) return;
    channel.fragments.delete(start);
    this.emit('packet', channelId, entry.data);
  }

  ack(channelId, seq, sentTime) {
    const command = Buffer.alloc(8);
    command[0] = CMD.ACKNOWLEDGE;
    command[1] = channelId;
    command.writeUInt16BE(seq, 2);
    command.writeUInt16BE(seq, 4);
    command.writeUInt16BE(sentTime, 6);
    this.pendingAcks.push(command);
    this.scheduleFlush();
  }

  startTimers() {
    this.lastReceiveAt = Date.now();
    this.timer = setInterval(() => this.service(), 20);
  }

  service() {
    if (this.state !== 'connected') return;
    const now = Date.now();
    if (now - this.lastReceiveAt > PEER_TIMEOUT_MS) {
      this.close(false, 'timeout');
      return;
    }
    const resend = [];
    for (const [key, entry] of this.pending) {
      if (now - entry.firstSentAt > PEER_TIMEOUT_MS) {
        this.close(false, 'timeout');
        return;
      }
      if (now - entry.sentAt >= entry.rto) {
        entry.sentAt = now;
        entry.rto = Math.min(MAX_RTO_MS, entry.rto * 2);
        resend.push(entry.buffer);
        this.pending.set(key, entry);
      }
    }
    for (const buffer of resend) this.outgoing.push({ buffer, reliable: true });
    if (resend.length) this.flush();
  }

  handleDatagram(packet, rinfo) {
    if (this.state === 'closed' || packet.length < 2) return;
    if (rinfo && rinfo.port !== this.port) return;
    const rawPeerId = packet.readUInt16BE(0);
    if (rawPeerId & HEADER_FLAG_COMPRESSED) return; // Sunshine never compresses
    let offset = 2;
    let sentTime = 0;
    if (rawPeerId & HEADER_FLAG_SENT_TIME) {
      if (packet.length < 4) return;
      sentTime = packet.readUInt16BE(2);
      offset = 4;
    }
    this.lastReceiveAt = Date.now();
    while (offset + 4 <= packet.length) {
      const commandByte = packet[offset];
      const commandNumber = commandByte & CMD_MASK;
      const channelId = packet[offset + 1];
      const seq = packet.readUInt16BE(offset + 2);
      const baseSize = COMMAND_SIZES[commandNumber];
      if (!baseSize || offset + baseSize > packet.length) return;
      let size = baseSize;
      let data = null;
      if (commandNumber === CMD.SEND_RELIABLE) {
        const length = packet.readUInt16BE(offset + 4);
        size += length;
        data = packet.subarray(offset + 6, offset + 6 + length);
      } else if (commandNumber === CMD.SEND_UNRELIABLE || commandNumber === CMD.SEND_UNSEQUENCED) {
        const length = packet.readUInt16BE(offset + 6);
        size += length;
        data = packet.subarray(offset + 8, offset + 8 + length);
      } else if (commandNumber === CMD.SEND_FRAGMENT || commandNumber === CMD.SEND_UNRELIABLE_FRAGMENT) {
        size += packet.readUInt16BE(offset + 6);
      }
      if (offset + size > packet.length) return;
      const command = packet.subarray(offset, offset + size);
      offset += size;
      if (commandByte & FLAG_ACKNOWLEDGE) this.ack(channelId, seq, sentTime);
      this.handleCommand(commandNumber, channelId, seq, command, data);
    }
  }

  handleCommand(commandNumber, channelId, seq, command, data) {
    switch (commandNumber) {
      case CMD.VERIFY_CONNECT: {
        if (this.state !== 'connecting') return;
        if (command.readUInt32BE(40) !== this.connectId) return;
        this.outgoingPeerId = command.readUInt16BE(4);
        this.incomingSessionId = command[6];
        this.outgoingSessionId = command[7];
        const channelCount = command.readUInt32BE(16);
        if (channelCount < this.channelCount) this.channelCount = channelCount;
        this.state = 'connected';
        this.flush(); // push the verify ACK out immediately
        this.startTimers();
        this.emit('connect');
        break;
      }
      case CMD.ACKNOWLEDGE: {
        const ackedSeq = command.readUInt16BE(4);
        const receivedSentTime = command.readUInt16BE(6);
        const entry = this.pending.get(`${channelId}:${ackedSeq}`);
        if (entry) {
          this.pending.delete(`${channelId}:${ackedSeq}`);
          const sample = (this.now() - receivedSentTime) & 0xffff;
          if (sample < 10000) {
            this.rttVariance = this.rttVariance * 0.75 + Math.abs(sample - this.rtt) * 0.25;
            this.rtt = this.rtt * 0.875 + sample * 0.125;
          }
        }
        break;
      }
      case CMD.DISCONNECT:
        this.close(false, 'remote');
        break;
      case CMD.SEND_RELIABLE: {
        if (channelId >= this.channels.length) return;
        const channel = this.channels[channelId];
        const expected = (channel.incomingReliable + 1) & 0xffff;
        const distance = (seq - expected) & 0xffff;
        if (distance >= 0x8000) return; // duplicate of something we already delivered
        channel.incomingReliable = seq;
        this.emit('packet', channelId, Buffer.from(data));
        break;
      }
      case CMD.SEND_UNRELIABLE:
      case CMD.SEND_UNSEQUENCED:
        this.emit('packet', channelId, Buffer.from(data));
        break;
      case CMD.SEND_FRAGMENT:
        // Messages larger than a datagram (clipboard frames).
        this.receiveFragment(channelId, seq, command);
        break;
      default:
        // PING, BANDWIDTH_LIMIT, THROTTLE_CONFIGURE: acknowledged above, nothing else to do.
        break;
    }
  }

  close(graceful = true, reason = 'local') {
    if (this.state === 'closed') return;
    const socket = this.socket;
    const releaseSocket = () => {
      if (!socket) return;
      socket.removeListener('message', this.onMessage);
      if (this.ownsSocket) {
        try { socket.close(); } catch { /* already closed */ }
      }
    };
    if (graceful && this.state === 'connected') {
      // Same as enet_peer_disconnect_now(): one unsequenced DISCONNECT, no ACK expected.
      const command = Buffer.alloc(8);
      command[0] = CMD.DISCONNECT | FLAG_UNSEQUENCED;
      command[1] = PEER_CHANNEL;
      this.peerReliableSeq = (this.peerReliableSeq + 1) & 0xffff;
      command.writeUInt16BE(this.peerReliableSeq, 2);
      this.sendDatagram([...this.pendingAcks, command], false, releaseSocket);
    } else {
      releaseSocket();
    }
    this.state = 'closed';
    clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
    this.emit('disconnect', reason);
  }
}

// ---------------------------------------------------------------------------
// Encrypted control stream (SS_ENC_CONTROL_V2, AES-128-GCM)
// ---------------------------------------------------------------------------
function controlIv(seq, origin) {
  const iv = Buffer.alloc(12);
  iv.writeUInt32LE(seq >>> 0, 0);
  iv[10] = origin.charCodeAt(0);
  iv[11] = 'C'.charCodeAt(0);
  return iv;
}

export function encryptControlMessage(key, seq, type, payload, origin = 'C') {
  const body = Buffer.alloc(4 + payload.length);
  body.writeUInt16LE(type, 0);
  body.writeUInt16LE(payload.length, 2);
  payload.copy(body, 4);
  const cipher = crypto.createCipheriv('aes-128-gcm', key, controlIv(seq, origin));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.alloc(8);
  header.writeUInt16LE(CONTROL_TYPE.ENCRYPTED, 0);
  header.writeUInt16LE(4 + tag.length + encrypted.length, 2);
  header.writeUInt32LE(seq >>> 0, 4);
  return Buffer.concat([header, tag, encrypted]);
}

export function decryptControlMessage(key, packet, origin = 'H') {
  if (packet.length < 8 + 16 + 4 || packet.readUInt16LE(0) !== CONTROL_TYPE.ENCRYPTED) return null;
  const length = packet.readUInt16LE(2);
  const seq = packet.readUInt32LE(4);
  if (length < 4 + 16 + 4 || 4 + length > packet.length) return null;
  const tag = packet.subarray(8, 24);
  const ciphertext = packet.subarray(24, 4 + length);
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, controlIv(seq, origin));
  decipher.setAuthTag(tag);
  let plain;
  try { plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]); } catch { return null; }
  if (plain.length < 4) return null;
  return { seq, type: plain.readUInt16LE(0), payload: plain.subarray(4, 4 + plain.readUInt16LE(2)) };
}

export class ControlStream extends EventEmitter {
  constructor({ address, port, key, connectData = 0, socket = null }) {
    super();
    this.key = Buffer.from(key);
    this.seq = 0;
    this.enet = new EnetClient({ address, port, connectData, socket });
    this.pingTimer = null;
    this.stats = { sent: 0, received: 0, inputPackets: 0, lastError: null };
    this.enet.on('packet', (channelId, data) => this.handlePacket(channelId, data));
    this.enet.on('disconnect', (reason) => {
      clearInterval(this.pingTimer);
      this.emit('close', reason);
    });
    this.enet.on('error', (error) => { this.stats.lastError = error.message; });
  }

  get connected() {
    return this.enet.state === 'connected';
  }

  get rtt() {
    return Math.round(this.enet.rtt);
  }

  get rttVariance() {
    return Math.round(this.enet.rttVariance);
  }

  async start() {
    await this.enet.connect();
    // Gen7 encrypted start sequence: "Start A" slot is an IDR request, then Start B.
    this.sendMessage(CONTROL_TYPE.REQUEST_IDR, Buffer.from([0, 0]), CONTROL_CHANNEL.URGENT);
    this.sendMessage(CONTROL_TYPE.START_B, Buffer.from([0]), CONTROL_CHANNEL.GENERIC);
    const pingPayload = Buffer.alloc(6);
    pingPayload.writeUInt16LE(4, 0);
    this.pingTimer = setInterval(() => {
      this.sendMessage(CONTROL_TYPE.PERIODIC_PING, pingPayload, CONTROL_CHANNEL.GENERIC);
    }, PERIODIC_PING_INTERVAL_MS);
  }

  sendMessage(type, payload, channelId = CONTROL_CHANNEL.GENERIC, mode = 'reliable') {
    if (!this.connected) return false;
    const packet = encryptControlMessage(this.key, this.seq, type, Buffer.from(payload));
    this.seq = (this.seq + 1) >>> 0;
    this.stats.sent += 1;
    return this.enet.send(channelId, packet, mode);
  }

  requestIdr() {
    return this.sendMessage(CONTROL_TYPE.REQUEST_IDR, Buffer.from([0, 0]), CONTROL_CHANNEL.URGENT);
  }

  sendInput(packet, channelId, mode = 'reliable') {
    const ok = this.sendMessage(CONTROL_TYPE.INPUT_DATA, packet, channelId, mode);
    if (ok) this.stats.inputPackets += 1;
    return ok;
  }

  handlePacket(channelId, data) {
    const message = decryptControlMessage(this.key, data);
    if (!message) return;
    this.stats.received += 1;
    const { type, payload } = message;
    if (type === CONTROL_TYPE.TERMINATION) {
      const reason = payload.length >= 4 ? payload.readUInt32BE(0) : null;
      this.emit('termination', reason);
    } else if (type === CONTROL_TYPE.RUMBLE && payload.length >= 10) {
      this.emit('rumble', { controller: payload.readUInt16LE(4), lowFreq: payload.readUInt16LE(6), highFreq: payload.readUInt16LE(8) });
    } else if (type === CONTROL_TYPE.HDR_MODE && payload.length >= 1) {
      this.emit('hdr', { enabled: payload[0] !== 0 });
    } else if (type === CONTROL_TYPE.CLIPBOARD) {
      this.emit('clipboard', payload);
    } else {
      this.emit('message', { type, payload, channelId });
    }
  }

  close() {
    clearInterval(this.pingTimer);
    this.enet.close(true);
  }
}

// ---------------------------------------------------------------------------
// GameStream input packet encoders
// ---------------------------------------------------------------------------
function inputPacket(magic, bodyLength, fill) {
  const packet = Buffer.alloc(8 + bodyLength);
  packet.writeUInt32BE(4 + bodyLength, 0);
  packet.writeUInt32LE(magic >>> 0, 4);
  fill(packet, 8);
  return packet;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

export const INPUT = Object.freeze({
  KEY_DOWN: 0x03,
  KEY_UP: 0x04,
  MOUSE_MOVE_ABS: 0x05,
  MOUSE_MOVE_REL: 0x07,
  MOUSE_BUTTON_DOWN: 0x08,
  MOUSE_BUTTON_UP: 0x09,
  SCROLL: 0x0a,
  MULTI_CONTROLLER: 0x0c,
  UTF8_TEXT: 0x17,
  HSCROLL: 0x55000001,
  CONTROLLER_ARRIVAL: 0x55000004,
});

export function keyboardPacket(keyCode, down, modifiers = 0, flags = 0) {
  return inputPacket(down ? INPUT.KEY_DOWN : INPUT.KEY_UP, 6, (packet, offset) => {
    packet[offset] = flags & 0xff;
    packet.writeUInt16LE((0x8000 | (keyCode & 0xff)) & 0xffff, offset + 1);
    packet[offset + 3] = modifiers & 0xff;
  });
}

export function mouseMoveRelPacket(dx, dy) {
  return inputPacket(INPUT.MOUSE_MOVE_REL, 4, (packet, offset) => {
    packet.writeInt16BE(clamp(dx, -32768, 32767), offset);
    packet.writeInt16BE(clamp(dy, -32768, 32767), offset + 2);
  });
}

export function mouseMoveAbsPacket(x, y, width, height) {
  const w = clamp(width, 1, 32767);
  const h = clamp(height, 1, 32767);
  return inputPacket(INPUT.MOUSE_MOVE_ABS, 10, (packet, offset) => {
    packet.writeInt16BE(clamp(x, 0, w - 1), offset);
    packet.writeInt16BE(clamp(y, 0, h - 1), offset + 2);
    packet.writeInt16BE(0, offset + 4);
    packet.writeInt16BE(w - 1, offset + 6);
    packet.writeInt16BE(h - 1, offset + 8);
  });
}

export function mouseButtonPacket(button, down) {
  return inputPacket(down ? INPUT.MOUSE_BUTTON_DOWN : INPUT.MOUSE_BUTTON_UP, 1, (packet, offset) => {
    packet[offset] = clamp(button, 1, 5);
  });
}

export function scrollPacket(amount) {
  return inputPacket(INPUT.SCROLL, 6, (packet, offset) => {
    const value = clamp(amount, -32768, 32767);
    packet.writeInt16BE(value, offset);
    packet.writeInt16BE(value, offset + 2);
  });
}

export function hscrollPacket(amount) {
  return inputPacket(INPUT.HSCROLL, 2, (packet, offset) => {
    packet.writeInt16BE(clamp(amount, -32768, 32767), offset);
  });
}

export function utf8TextPacket(text) {
  const bytes = Buffer.from(String(text), 'utf8').subarray(0, 32);
  return inputPacket(INPUT.UTF8_TEXT, bytes.length, (packet, offset) => bytes.copy(packet, offset));
}

export function controllerArrivalPacket(controllerNumber, type = 1, capabilities = 0x03, supportedButtonFlags = 0x3ff3ff) {
  return inputPacket(INPUT.CONTROLLER_ARRIVAL, 8, (packet, offset) => {
    packet[offset] = controllerNumber & 0x0f;
    packet[offset + 1] = type & 0xff;
    packet.writeUInt16LE(capabilities & 0xffff, offset + 2);
    packet.writeUInt32LE(supportedButtonFlags >>> 0, offset + 4);
  });
}

export function multiControllerPacket(state) {
  return inputPacket(INPUT.MULTI_CONTROLLER, 26, (packet, offset) => {
    const buttons = Number(state.buttons) >>> 0;
    packet.writeUInt16LE(0x001a, offset);
    packet.writeUInt16LE(clamp(state.controllerNumber, 0, 15), offset + 2);
    packet.writeUInt16LE(clamp(state.activeGamepadMask ?? 1, 0, 0xffff), offset + 4);
    packet.writeUInt16LE(0x0014, offset + 6);
    packet.writeUInt16LE(buttons & 0xffff, offset + 8);
    packet[offset + 10] = clamp(state.leftTrigger, 0, 255);
    packet[offset + 11] = clamp(state.rightTrigger, 0, 255);
    packet.writeInt16LE(clamp(state.leftStickX, -32768, 32767), offset + 12);
    packet.writeInt16LE(clamp(state.leftStickY, -32768, 32767), offset + 14);
    packet.writeInt16LE(clamp(state.rightStickX, -32768, 32767), offset + 16);
    packet.writeInt16LE(clamp(state.rightStickY, -32768, 32767), offset + 18);
    packet.writeUInt16LE(0x009c, offset + 20);
    packet.writeUInt16LE((buttons >>> 16) & 0xffff, offset + 22);
    packet.writeUInt16LE(0x0055, offset + 24);
  });
}

// Translate a browser input message (JSON from input.js) into [packet, channel, mode].
export function encodeBrowserInput(message) {
  switch (message?.kind) {
    case 'key':
      return [keyboardPacket(message.keyCode, Boolean(message.down), message.modifiers, message.flags), CONTROL_CHANNEL.KEYBOARD, 'reliable'];
    case 'text':
      return [utf8TextPacket(message.text), CONTROL_CHANNEL.UTF8, 'reliable'];
    case 'mouse-rel':
      return [mouseMoveRelPacket(message.dx, message.dy), CONTROL_CHANNEL.MOUSE, 'reliable'];
    case 'mouse-abs':
      return [mouseMoveAbsPacket(message.x, message.y, message.width, message.height), CONTROL_CHANNEL.MOUSE, 'unsequenced'];
    case 'mouse-button':
      return [mouseButtonPacket(message.button, Boolean(message.down)), CONTROL_CHANNEL.MOUSE, 'reliable'];
    case 'scroll':
      return [scrollPacket(message.amount), CONTROL_CHANNEL.MOUSE, 'reliable'];
    case 'hscroll':
      return [hscrollPacket(message.amount), CONTROL_CHANNEL.MOUSE, 'reliable'];
    case 'gamepad-arrival':
      return [controllerArrivalPacket(message.controllerNumber, message.type, message.capabilities, message.supportedButtonFlags), CONTROL_CHANNEL.GAMEPAD_BASE + (message.controllerNumber & 0x0f), 'reliable'];
    case 'gamepad':
      return [multiControllerPacket(message), CONTROL_CHANNEL.GAMEPAD_BASE + (message.controllerNumber & 0x0f), 'reliable'];
    default:
      return null;
  }
}

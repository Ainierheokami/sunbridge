(function () {
  'use strict';

  const MAGIC = 'SBMF';
  const VERSION = 1;
  // 4 = whole video frames assembled by the bridge (no RTP / FEC), see parseFrameEnvelope().
  const STREAM_IDS = Object.freeze({ video: 1, audio: 2, control: 3, videoFrame: 4 });
  const STREAM_NAMES = Object.freeze({ 1: 'video', 2: 'audio', 3: 'control', 4: 'video-frame' });
  const RTP_STREAMS = new Set(['video', 'audio', 'control']);
  const VIDEO_FLAGS = Object.freeze({ CONTAINS_PIC_DATA: 0x01, EOF: 0x02, SOF: 0x04 });
  const AUDIO_PAYLOAD_TYPES = Object.freeze({ OPUS: 97, FEC: 127 });
  const MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;
  const text = (value) => String(value == null ? '' : value);

  const toBytes = (value) => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('媒体包必须是 ArrayBuffer 或 Uint8Array');
  };

  const readU16BE = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
  const readU32BE = (bytes, offset) => (bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
  const readU16LE = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const readU32LE = (bytes, offset) => ((bytes[offset]) | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function parseRtp(value) {
    const packet = toBytes(value);
    if (packet.length < 12) throw new RangeError('RTP 包头长度不足');
    const version = packet[0] >> 6;
    if (version !== 2) throw new Error('RTP 版本不是 2');
    const csrcCount = packet[0] & 0x0f;
    const hasExtension = Boolean(packet[0] & 0x10);
    const headerLength = 12 + csrcCount * 4 + (hasExtension ? 4 : 0);
    if (packet.length < headerLength) throw new RangeError('RTP CSRC / 扩展字段不完整');
    return {
      packet,
      version,
      payloadType: packet[1] & 0x7f,
      marker: Boolean(packet[1] & 0x80),
      sequenceNumber: readU16BE(packet, 2),
      timestamp: readU32BE(packet, 4),
      ssrc: readU32BE(packet, 8),
      csrcCount,
      extension: hasExtension,
      headerLength,
      payload: packet.subarray(headerLength),
    };
  }

  function parseEnvelope(value) {
    const bytes = toBytes(value);
    if (bytes.length < 16) throw new RangeError('媒体网关 envelope 长度不足');
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== MAGIC) throw new Error('媒体网关 envelope magic 无效');
    if (bytes[4] !== VERSION) throw new Error(`媒体网关 envelope 版本 ${bytes[4]} 不受支持`);
    const streamId = bytes[5];
    const stream = STREAM_NAMES[streamId] || 'unknown';
    const flags = readU16BE(bytes, 6);
    const receivedAt = readU32BE(bytes, 8);
    const packetLength = readU32BE(bytes, 12);
    if (packetLength > MAX_ENVELOPE_BYTES || bytes.length < 16 + packetLength) throw new RangeError('媒体网关 envelope RTP 长度无效');
    const packet = bytes.subarray(16, 16 + packetLength);
    return {
      magic,
      version: bytes[4],
      streamId,
      stream,
      flags,
      receivedAt,
      packetLength,
      packet,
      rtp: RTP_STREAMS.has(stream) ? parseRtp(packet) : null,
    };
  }

  // A gateway message carries one or more envelopes back to back (the bridge batches each UDP burst).
  function forEachEnvelope(value, callback) {
    const bytes = toBytes(value);
    let offset = 0;
    while (offset + 16 <= bytes.length) {
      const length = 16 + readU32BE(bytes, offset + 12);
      if (offset + length > bytes.length) throw new RangeError('媒体网关 envelope RTP 长度无效');
      callback(parseEnvelope(bytes.subarray(offset, offset + length)));
      offset += length;
    }
  }

  function hasAnnexBStartCode(bytes, offset = 0) {
    return (bytes.length >= offset + 4 && bytes[offset] === 0 && bytes[offset + 1] === 0 && bytes[offset + 2] === 0 && bytes[offset + 3] === 1)
      || (bytes.length >= offset + 3 && bytes[offset] === 0 && bytes[offset + 1] === 0 && bytes[offset + 2] === 1);
  }

  // Split an Annex-B access unit into NAL units (views, no copies). Runs on every frame, so start codes
  // are found with the native indexOf(1) instead of a byte-by-byte JS loop.
  function annexBNals(bytes) {
    const output = [];
    let start = -1;
    let cursor = 2;
    while (cursor < bytes.length) {
      const one = bytes.indexOf(1, cursor);
      if (one < 0) break;
      if (bytes[one - 1] !== 0 || bytes[one - 2] !== 0) { cursor = one + 1; continue; }
      const codeStart = one >= 3 && bytes[one - 3] === 0 ? one - 3 : one - 2;
      if (start >= 0 && codeStart > start) output.push(bytes.subarray(start, codeStart));
      start = one + 1;
      cursor = start + 2;
    }
    if (start >= 0 && start < bytes.length) output.push(bytes.subarray(start));
    if (start < 0 && bytes.length) output.push(bytes);
    return output;
  }

  function avccNals(bytes) {
    const output = [];
    let cursor = 0;
    while (cursor + 4 <= bytes.length) {
      const length = readU32BE(bytes, cursor);
      cursor += 4;
      if (!length || cursor + length > bytes.length) return [];
      output.push(bytes.slice(cursor, cursor + length));
      cursor += length;
    }
    return cursor === bytes.length ? output : [];
  }

  function looksLikeAvcc(bytes) {
    if (bytes.length < 8 || hasAnnexBStartCode(bytes)) return false;
    const nals = avccNals(bytes);
    return nals.length > 0 && nals.every((nal) => nal.length > 0 && (nal[0] & 0x80) === 0 && (nal[0] & 0x1f) !== 0);
  }

  function h264Nals(bytes) {
    if (hasAnnexBStartCode(bytes)) return annexBNals(bytes);
    if (looksLikeAvcc(bytes)) return avccNals(bytes);
    return bytes.length ? [bytes.slice()] : [];
  }

  // HEVC: codec string from the SPS profile_tier_level (ISO/IEC 14496-15 E.3), parameter sets for change detection.
  function hevcInfo(bytes) {
    const nals = annexBNals(bytes);
    let keyframe = false;
    let sps = null;
    const params = [];
    for (const nal of nals) {
      const type = (nal[0] >> 1) & 0x3f;
      if (type >= 16 && type <= 23) keyframe = true; // IRAP: BLA / IDR / CRA
      if (type >= 32 && type <= 34) params.push(nal); // VPS / SPS / PPS
      if (type === 33) sps = nal;
    }
    return { nals, keyframe, codec: hevcCodecString(sps), paramKey: params.length ? concatBytes(params) : null };
  }

  function hevcCodecString(sps) {
    if (!sps || sps.length < 16) return null;
    const p = removeEmulationPrevention(sps); // drops the first header byte: p[0] is the second one
    if (p.length < 14) return null;
    const space = p[2] >> 6;
    const tier = (p[2] >> 5) & 1;
    const profile = p[2] & 0x1f;
    let compat = ((p[3] << 24) | (p[4] << 16) | (p[5] << 8) | p[6]) >>> 0;
    let reversed = 0;
    for (let bit = 0; bit < 32; bit += 1) { reversed = ((reversed << 1) | (compat & 1)) >>> 0; compat >>>= 1; }
    const constraints = Array.from(p.subarray(7, 13));
    while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
    const level = p[13];
    return `hev1.${['', 'A', 'B', 'C'][space]}${profile}.${reversed.toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${level}`
      + constraints.map((value) => '.' + value.toString(16).toUpperCase().padStart(2, '0')).join('');
  }

  // AV1 (low-overhead OBU stream): codec string from the sequence header, which encoders send with every keyframe.
  function av1Info(bytes) {
    let offset = 0;
    let sequenceHeader = null;
    while (offset < bytes.length) {
      const header = bytes[offset];
      const type = (header >> 3) & 0x0f;
      const hasExtension = (header >> 2) & 1;
      const hasSize = (header >> 1) & 1;
      let cursor = offset + 1 + hasExtension;
      let size = bytes.length - cursor;
      if (hasSize) {
        size = 0;
        for (let i = 0; i < 8 && cursor < bytes.length; i += 1) {
          const byte = bytes[cursor++];
          size += (byte & 0x7f) * 2 ** (7 * i);
          if (!(byte & 0x80)) break;
        }
      }
      if (type === 1) sequenceHeader = bytes.subarray(cursor, cursor + size);
      if (!hasSize) break;
      offset = cursor + size;
    }
    return { nals: null, keyframe: Boolean(sequenceHeader), codec: av1CodecString(sequenceHeader), paramKey: sequenceHeader };
  }

  function av1CodecString(sequenceHeader) {
    if (!sequenceHeader?.length) return null;
    let bitPos = 0;
    const read = (count) => {
      let value = 0;
      for (let i = 0; i < count; i += 1) {
        const byte = sequenceHeader[bitPos >> 3] ?? 0;
        value = (value << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
        bitPos += 1;
      }
      return value;
    };
    const profile = read(3);
    read(1); // still_picture
    const reduced = read(1);
    let level = 8;
    let tier = 0;
    if (reduced) {
      level = read(5);
    } else {
      if (read(1)) return `av01.${profile}.08M.08`; // timing_info_present: rare for streaming, keep a safe default
      read(1); // initial_display_delay_present_flag (assumed 0 below)
      read(5); // operating_points_cnt_minus_1
      read(12); // operating_point_idc[0]
      level = read(5);
      if (level > 7) tier = read(1);
    }
    return `av01.${profile}.${String(level).padStart(2, '0')}${tier ? 'H' : 'M'}.08`;
  }

  function removeEmulationPrevention(bytes) {
    const output = [];
    for (let index = 1; index < bytes.length; index += 1) {
      if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 3) {
        output.push(0, 0);
        index += 2;
      } else {
        output.push(bytes[index]);
      }
    }
    return new Uint8Array(output);
  }

  function readBit(state) {
    if (state.offset >= state.bytes.length * 8) throw new RangeError('SPS bitstream ended unexpectedly');
    const value = (state.bytes[state.offset >> 3] >> (7 - (state.offset & 7))) & 1;
    state.offset += 1;
    return value;
  }

  function readBits(state, count) {
    let value = 0;
    for (let index = 0; index < count; index += 1) value = (value * 2) + readBit(state);
    return value;
  }

  function readUnsignedExpGolomb(state) {
    let leadingZeroBits = 0;
    while (readBit(state) === 0) {
      leadingZeroBits += 1;
      if (leadingZeroBits > 31) throw new RangeError('SPS Exp-Golomb value is too large');
    }
    const suffix = leadingZeroBits ? readBits(state, leadingZeroBits) : 0;
    return (2 ** leadingZeroBits) - 1 + suffix;
  }

  function readSignedExpGolomb(state) {
    const value = readUnsignedExpGolomb(state);
    return value % 2 === 0 ? -(value / 2) : (value + 1) / 2;
  }

  function skipScalingList(state, size) {
    let lastScale = 8;
    let nextScale = 8;
    for (let index = 0; index < size; index += 1) {
      if (nextScale !== 0) nextScale = (lastScale + readSignedExpGolomb(state) + 256) % 256;
      lastScale = nextScale === 0 ? lastScale : nextScale;
    }
  }

  function parseSps(sps) {
    if (!sps || sps.length < 4) return null;
    try {
      const rbsp = removeEmulationPrevention(sps);
      if (rbsp.length < 3) return null;
      const profileIdc = rbsp[0];
      const constraintFlags = rbsp[1];
      const levelIdc = rbsp[2];
      const state = { bytes: rbsp, offset: 24 };
      readUnsignedExpGolomb(state); // seq_parameter_set_id
      let chromaFormatIdc = 1;
      let separateColourPlaneFlag = 0;
      const highProfiles = new Set([44, 83, 86, 100, 110, 118, 122, 128, 134, 138, 139, 244]);
      if (highProfiles.has(profileIdc)) {
        chromaFormatIdc = readUnsignedExpGolomb(state);
        if (chromaFormatIdc === 3) separateColourPlaneFlag = readBit(state);
        readUnsignedExpGolomb(state); // bit_depth_luma_minus8
        readUnsignedExpGolomb(state); // bit_depth_chroma_minus8
        readBit(state); // qpprime_y_zero_transform_bypass_flag
        if (readBit(state)) {
          const scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
          for (let index = 0; index < scalingListCount; index += 1) {
            if (readBit(state)) skipScalingList(state, index < 6 ? 16 : 64);
          }
        }
      }
      readUnsignedExpGolomb(state); // log2_max_frame_num_minus4
      const picOrderCntType = readUnsignedExpGolomb(state);
      if (picOrderCntType === 0) readUnsignedExpGolomb(state);
      else if (picOrderCntType === 1) {
        readBit(state); // delta_pic_order_always_zero_flag
        readSignedExpGolomb(state);
        readSignedExpGolomb(state);
        const cycle = readUnsignedExpGolomb(state);
        for (let index = 0; index < cycle; index += 1) readSignedExpGolomb(state);
      }
      readUnsignedExpGolomb(state); // max_num_ref_frames
      readBit(state); // gaps_in_frame_num_value_allowed_flag
      const widthInMbs = readUnsignedExpGolomb(state) + 1;
      const heightInMapUnits = readUnsignedExpGolomb(state) + 1;
      const frameMbsOnlyFlag = readBit(state);
      if (!frameMbsOnlyFlag) readBit(state); // mb_adaptive_frame_field_flag
      readBit(state); // direct_8x8_inference_flag
      let cropLeft = 0;
      let cropRight = 0;
      let cropTop = 0;
      let cropBottom = 0;
      if (readBit(state)) {
        cropLeft = readUnsignedExpGolomb(state);
        cropRight = readUnsignedExpGolomb(state);
        cropTop = readUnsignedExpGolomb(state);
        cropBottom = readUnsignedExpGolomb(state);
      }
      const chromaArrayType = separateColourPlaneFlag ? 0 : chromaFormatIdc;
      const subWidthC = [1, 2, 2, 1][chromaArrayType] || 1;
      const subHeightC = [1, 2, 1, 1][chromaArrayType] || 1;
      const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC;
      const cropUnitY = chromaArrayType === 0 ? (2 - frameMbsOnlyFlag) : subHeightC * (2 - frameMbsOnlyFlag);
      const width = widthInMbs * 16 - (cropLeft + cropRight) * cropUnitX;
      const height = (2 - frameMbsOnlyFlag) * heightInMapUnits * 16 - (cropTop + cropBottom) * cropUnitY;
      return { profileIdc, constraintFlags, levelIdc, width, height };
    } catch {
      return { profileIdc: sps[1], constraintFlags: sps[2], levelIdc: sps[3], width: null, height: null };
    }
  }

  function avcCodecString(sps) {
    if (!sps || sps.length < 4) return null;
    return 'avc1.' + [sps[1], sps[2], sps[3]].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function buildAvcDecoderConfigurationRecord(sps, pps) {
    if (!sps?.length || !pps?.length || sps.length > 0xffff || pps.length > 0xffff) return null;
    const output = new Uint8Array(11 + sps.length + pps.length);
    output.set([1, sps[1] || 0, sps[2] || 0, sps[3] || 0, 0xff, 0xe1], 0);
    output[6] = (sps.length >> 8) & 0xff;
    output[7] = sps.length & 0xff;
    output.set(sps, 8);
    const ppsOffset = 8 + sps.length;
    output[ppsOffset] = 1;
    output[ppsOffset + 1] = (pps.length >> 8) & 0xff;
    output[ppsOffset + 2] = pps.length & 0xff;
    output.set(pps, ppsOffset + 3);
    return output;
  }

  function toAvcSample(bytes, nals = h264Nals(bytes)) {
    if (!nals.length) return bytes.slice();
    const output = new Uint8Array(nals.reduce((total, nal) => total + 4 + nal.length, 0));
    let offset = 0;
    for (const nal of nals) {
      output[offset] = (nal.length >>> 24) & 0xff;
      output[offset + 1] = (nal.length >>> 16) & 0xff;
      output[offset + 2] = (nal.length >>> 8) & 0xff;
      output[offset + 3] = nal.length & 0xff;
      output.set(nal, offset + 4);
      offset += 4 + nal.length;
    }
    return output;
  }

  function h264Info(bytes) {
    const nals = h264Nals(bytes);
    let hasIdr = false;
    let hasSps = false;
    let hasPps = false;
    let sps = null;
    let pps = null;
    for (const nal of nals) {
      const type = nal[0] & 0x1f;
      if (type === 5) hasIdr = true;
      if (type === 7) { hasSps = true; sps = nal; }
      if (type === 8) { hasPps = true; pps = nal; }
    }
    const spsInfo = parseSps(sps);
    return {
      nals,
      hasIdr,
      hasSps,
      hasPps,
      keyframe: hasIdr,
      sps,
      pps,
      codec: avcCodecString(sps),
      description: buildAvcDecoderConfigurationRecord(sps, pps),
      profileIdc: spsInfo?.profileIdc ?? null,
      constraintFlags: spsInfo?.constraintFlags ?? null,
      levelIdc: spsInfo?.levelIdc ?? null,
      width: spsInfo?.width ?? null,
      height: spsInfo?.height ?? null,
    };
  }

  function parseVideoPacket(rtp) {
    if (!rtp?.payload) return null;
    const payload = rtp.payload;
    // GameStream NV_VIDEO_PACKET fields are little-endian and follow the
    // four-byte transport extension accounted for by parseRtp(). If the
    // stream has no NV header, retain a raw RTP fallback for H.264 Annex-B.
    if (payload.length >= 16) {
      // Sunshine stores (sequence << 8) here.
      const streamPacketIndex = readU32LE(payload, 0) >>> 8;
      const frameIndex = readU32LE(payload, 4);
      const flags = payload[8];
      const extraFlags = payload[9];
      const multiFecFlags = payload[10];
      const multiFecBlocks = payload[11];
      const fecInfo = readU32LE(payload, 12);
      // fecInfo is written by Sunshine after FEC encoding, so it is valid even on parity packets
      // (whose flags byte is parity data). Data shards always have sane flags.
      const dataShards = fecInfo >>> 22;
      const fecIndex = (fecInfo >>> 12) & 0x3ff;
      const isFecPacket = dataShards > 0 && fecIndex >= 0 && (fecIndex >= dataShards || (flags & 0xf8) === 0);
      const looksLikeNvHeader = isFecPacket || ((flags & 0xf8) === 0 && frameIndex < 0xf0000000);
      if (looksLikeNvHeader) {
        const containsPictureData = Boolean(flags & VIDEO_FLAGS.CONTAINS_PIC_DATA);
        const first = Boolean(flags & VIDEO_FLAGS.SOF);
        const last = Boolean(flags & VIDEO_FLAGS.EOF);
        let data = payload.subarray(16);
        let frameHeaderLength = 0;
        let hostProcessingMs = null;
        if (first && data.length && !hasAnnexBStartCode(data)) {
          // Sunshine prepends an 8-byte frame header for newer
          // clients and a 44-byte header when extended metadata is present.
          if (data[0] === 0x81 && data.length >= 44) frameHeaderLength = 44;
          else if (data[0] === 0x01 && data.length >= 8) { frameHeaderLength = 8; hostProcessingMs = readU16LE(data, 1) / 10; }
          if (frameHeaderLength) data = data.subarray(frameHeaderLength);
        }
        return {
          raw: false,
          // fecInfo = fecIndex << 12 | dataShards << 22 | percentage << 4; multiFecBlocks = block << 4 | lastBlock << 6
          fecIndex,
          dataShards,
          fecPercentage: (fecInfo >>> 4) & 0xff,
          blockIndex: (multiFecBlocks >> 4) & 0x3,
          lastBlock: (multiFecBlocks >> 6) & 0x3,
          shard: payload.subarray(16),
          streamPacketIndex,
          frameIndex,
          flags,
          extraFlags,
          multiFecFlags,
          multiFecBlocks,
          fecInfo,
          first,
          last,
          containsPictureData,
          data,
          timestamp: rtp.timestamp,
          sequenceNumber: rtp.sequenceNumber,
          ssrc: rtp.ssrc,
          payloadType: rtp.payloadType,
          frameHeaderLength,
          hostProcessingMs,
        };
      }
    }
    return {
      raw: true,
      streamPacketIndex: null,
      frameIndex: rtp.timestamp,
      flags: (rtp.marker ? VIDEO_FLAGS.EOF : 0) | (rtp.sequenceNumber === 0 ? VIDEO_FLAGS.SOF : 0),
      first: false,
      last: Boolean(rtp.marker),
      containsPictureData: true,
      data: payload,
      timestamp: rtp.timestamp,
      sequenceNumber: rtp.sequenceNumber,
      ssrc: rtp.ssrc,
      payloadType: rtp.payloadType,
      frameHeaderLength: 0,
    };
  }

  function parseAudioPacket(rtp, options = {}) {
    if (!rtp?.payload) return null;
    const payloadType = Number(rtp.payloadType);
    const opusPayloadType = Number.isFinite(Number(options.opusPayloadType)) ? Number(options.opusPayloadType) : AUDIO_PAYLOAD_TYPES.OPUS;
    const fecPayloadType = Number.isFinite(Number(options.fecPayloadType)) ? Number(options.fecPayloadType) : AUDIO_PAYLOAD_TYPES.FEC;
    const kind = payloadType === opusPayloadType ? 'opus' : payloadType === fecPayloadType ? 'fec' : 'unknown';
    return {
      kind,
      codec: kind === 'opus' || kind === 'fec' ? 'opus' : null,
      payloadType,
      sequenceNumber: rtp.sequenceNumber,
      timestamp: rtp.timestamp,
      ssrc: rtp.ssrc,
      marker: Boolean(rtp.marker),
      data: rtp.payload,
      fec: kind === 'fec',
      supported: kind === 'opus' || kind === 'fec',
    };
  }

  // One AudioWorklet module load per AudioContext (pipelines are recreated on reconnect, the context is reused).
  const workletModules = typeof WeakMap === 'function' ? new WeakMap() : null;
  const loadWorkletModule = (context, url) => {
    if (!workletModules) return context.audioWorklet.addModule(url);
    if (!workletModules.has(context)) workletModules.set(context, context.audioWorklet.addModule(url));
    return workletModules.get(context);
  };

  function createAudioPipeline(options = {}) {
    const callbacks = options.callbacks || options;
    const state = {
      state: 'waiting',
      packets: 0,
      opusPackets: 0,
      fecPackets: 0,
      unsupportedPackets: 0,
      bytes: 0,
      decodedFrames: 0,
      scheduledFrames: 0,
      droppedPackets: 0,
      latePackets: 0,
      duplicatePackets: 0,
      decodeErrors: 0,
      lastPacketAt: null,
      lastDecodedAt: null,
      lastOutputAt: null,
      lastError: null,
      sampleRate: Number(options.sampleRate) || 48000,
      numberOfChannels: Number(options.numberOfChannels || options.channels) || 2,
      clockRate: Number(options.clockRate) || 48000,
      packetDurationMs: Number(options.packetDurationMs) || 5,
      opusPayloadType: Number.isFinite(Number(options.opusPayloadType)) ? Number(options.opusPayloadType) : AUDIO_PAYLOAD_TYPES.OPUS,
      fecPayloadType: Number.isFinite(Number(options.fecPayloadType)) ? Number(options.fecPayloadType) : AUDIO_PAYLOAD_TYPES.FEC,
      jitterPackets: Math.max(1, Number(options.jitterPackets) || 3),
      jitterDelayMs: Math.max(4, Number(options.jitterDelayMs) || 18),
      contextState: 'unavailable',
    };
    let decoder = null;
    let audioContext = options.audioContext || null;
    let gainNode = null;
    let outputReady = false;
    let ownsAudioContext = !audioContext;
    let closed = false;
    let pendingResume = null;
    let pendingDrainTimer = null;
    let expectedSequence = null;
    let pending = new Map();
    let nextAudioTime = null;
    let lastRtpTimestamp = null;
    let timestampEpoch = 0;
    let timestampFallback = 0;
    // Jitter-buffered playout on the audio thread (audio-worklet.js); per-packet scheduling is the fallback.
    let workletNode = null;
    let workletPending = false;
    let workletFailed = false;
    const workletQueue = [];

    const AudioContextCtor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    const decoderSupported = typeof window !== 'undefined'
      && typeof window.AudioDecoder === 'function'
      && typeof window.EncodedAudioChunk === 'function'
      && (Boolean(audioContext) || typeof AudioContextCtor === 'function');

    // Notify only on a real change: decoded frames would otherwise report "playing" dozens of times a second.
    const setState = (next, extra = {}, force = false) => {
      if (!force && state.state === next && !Object.keys(extra).length) return;
      state.state = next;
      Object.assign(state, extra);
      callbacks.onState?.({ ...state });
    };

    const fail = (error, next = 'decode-error') => {
      state.lastError = text(error?.message || error);
      state.decodeErrors += 1;
      setState(next, {}, true);
      callbacks.onError?.(error instanceof Error ? error : new Error(state.lastError));
    };

    const createOutput = () => {
      if (!audioContext) {
        if (!decoderSupported || typeof AudioContextCtor !== 'function') return false;
        try {
          audioContext = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: state.sampleRate });
          ownsAudioContext = true;
        } catch (error) {
          state.contextState = 'unavailable';
          state.lastError = text(error?.message || error);
          setState('unsupported');
          callbacks.onState?.({ ...state });
          return false;
        }
      }
      if (!outputReady) {
        try {
          gainNode = typeof audioContext.createGain === 'function' ? audioContext.createGain() : null;
          if (gainNode) {
            gainNode.gain.value = Number.isFinite(Number(options.volume)) ? Number(options.volume) : 1;
            gainNode.connect(audioContext.destination);
          }
          outputReady = true;
        } catch (error) {
          state.contextState = 'unavailable';
          state.lastError = text(error?.message || error);
          setState('unsupported');
          callbacks.onState?.({ ...state });
          return false;
        }
      }
      state.contextState = audioContext.state || 'unknown';
      setupWorklet();
      return true;
    };

    const setupWorklet = () => {
      if (workletNode || workletPending || workletFailed) return;
      if (!options.workletUrl || !audioContext?.audioWorklet || typeof AudioWorkletNode !== 'function') { workletFailed = true; return; }
      workletPending = true;
      loadWorkletModule(audioContext, options.workletUrl).then(() => {
        workletPending = false;
        if (closed) return;
        workletNode = new AudioWorkletNode(audioContext, 'sunbridge-audio-player', {
          numberOfInputs: 0,
          outputChannelCount: [state.numberOfChannels],
          processorOptions: { channels: state.numberOfChannels, sampleRate: state.sampleRate },
        });
        workletNode.port.onmessage = (event) => {
          if (event.data?.type === 'stats') Object.assign(state, { bufferedMs: event.data.bufferedMs, targetBufferMs: event.data.targetMs, underruns: event.data.underruns });
        };
        workletNode.connect(gainNode || audioContext.destination);
        for (const planes of workletQueue.splice(0)) postPlanes(planes);
      }).catch((error) => {
        workletPending = false;
        workletFailed = true;
        state.lastError = text(error?.message || error);
        workletQueue.length = 0;
      });
    };

    const postPlanes = (planes) => {
      workletNode.port.postMessage({ channels: planes }, planes.map((plane) => plane.buffer));
    };

    const resume = () => {
      if (closed || !audioContext) return Promise.resolve(false);
      state.contextState = audioContext.state || state.contextState;
      if (state.contextState === 'running') {
        if (state.state === 'autoplay-blocked') setState(state.decodedFrames ? 'playing' : 'receiving');
        return Promise.resolve(true);
      }
      if (pendingResume) return pendingResume;
      if (typeof audioContext.resume !== 'function') {
        setState('autoplay-blocked');
        return Promise.resolve(false);
      }
      pendingResume = Promise.resolve()
        .then(() => audioContext.resume())
        .then(() => {
          state.contextState = audioContext.state || 'unknown';
          if (state.contextState === 'running') {
            if (state.state === 'autoplay-blocked') setState(state.decodedFrames ? 'playing' : 'receiving');
            return true;
          }
          setState('autoplay-blocked');
          return false;
        })
        .catch((error) => {
          state.contextState = audioContext.state || 'suspended';
          state.lastError = text(error?.message || error);
          setState('autoplay-blocked');
          callbacks.onAutoplayBlocked?.(error);
          return false;
        })
        .finally(() => { pendingResume = null; });
      return pendingResume;
    };

    const timestampInMicroseconds = (rtpTimestamp) => {
      const raw = Number(rtpTimestamp);
      if (!Number.isFinite(raw)) {
        timestampFallback += 1;
        return timestampFallback * Math.max(1, Math.round((state.packetDurationMs || 5) * 1000));
      }
      const current = raw >>> 0;
      if (lastRtpTimestamp != null && current < lastRtpTimestamp && lastRtpTimestamp - current > 0x80000000) timestampEpoch += 0x100000000;
      lastRtpTimestamp = current;
      return Math.max(0, Math.round(((timestampEpoch + current) * 1000000) / state.clockRate));
    };

    const sampleFormatInfo = (format) => {
      const normalized = String(format || 'f32-planar').toLowerCase();
      if (normalized.startsWith('s16')) return { type: Int16Array, scale: 1 / 32768, offset: 0 };
      if (normalized.startsWith('u8')) return { type: Uint8Array, scale: 1 / 128, offset: -128 };
      return { type: Float32Array, scale: 1, offset: 0 };
    };

    const copyAudioDataToBuffer = (audioData) => {
      if (!audioContext || !audioData || typeof audioContext.createBuffer !== 'function') return null;
      const sampleRate = Number(audioData.sampleRate) || state.sampleRate;
      const channels = Number(audioData.numberOfChannels) || state.numberOfChannels;
      const frames = Number(audioData.numberOfFrames) || Math.max(1, Math.round((Number(audioData.duration) || state.packetDurationMs * 1000) * sampleRate / 1000000));
      const buffer = audioContext.createBuffer(channels, frames, sampleRate);
      const format = String(audioData.format || 'f32-planar').toLowerCase();
      const planar = format.includes('planar');
      const { type: SampleType, scale, offset } = sampleFormatInfo(format);
      const copyPlane = (planeIndex, destination) => {
        const source = new SampleType(destination.length);
        audioData.copyTo(source, { planeIndex });
        for (let index = 0; index < destination.length; index += 1) destination[index] = (Number(source[index]) + offset) * scale;
      };
      if (planar) {
        for (let channel = 0; channel < channels; channel += 1) copyPlane(channel, buffer.getChannelData(channel));
      } else {
        const source = new SampleType(frames * channels);
        audioData.copyTo(source, { planeIndex: 0 });
        for (let channel = 0; channel < channels; channel += 1) {
          const destination = buffer.getChannelData(channel);
          for (let frame = 0; frame < frames; frame += 1) destination[frame] = (Number(source[frame * channels + channel]) + offset) * scale;
        }
      }
      return { buffer, frames, sampleRate };
    };

    // Decoded audio as one Float32Array per channel (for the worklet).
    const copyAudioDataToPlanes = (audioData) => {
      const channels = Number(audioData.numberOfChannels) || state.numberOfChannels;
      const frames = Number(audioData.numberOfFrames) || 0;
      const format = String(audioData.format || 'f32-planar').toLowerCase();
      const { type: SampleType, scale, offset } = sampleFormatInfo(format);
      const planes = Array.from({ length: channels }, () => new Float32Array(frames));
      if (format === 'f32-planar') {
        planes.forEach((plane, channel) => audioData.copyTo(plane, { planeIndex: channel }));
      } else if (format.includes('planar')) {
        planes.forEach((plane, channel) => {
          const source = new SampleType(frames);
          audioData.copyTo(source, { planeIndex: channel });
          for (let i = 0; i < frames; i += 1) plane[i] = (Number(source[i]) + offset) * scale;
        });
      } else {
        const source = new SampleType(frames * channels);
        audioData.copyTo(source, { planeIndex: 0 });
        for (let channel = 0; channel < channels; channel += 1) {
          const plane = planes[channel];
          for (let i = 0; i < frames; i += 1) plane[i] = (Number(source[i * channels + channel]) + offset) * scale;
        }
      }
      return { planes, frames, sampleRate: Number(audioData.sampleRate) || state.sampleRate };
    };

    const markPlayed = (frames, sampleRate, channels) => {
      state.decodedFrames += frames;
      state.scheduledFrames += frames;
      state.lastDecodedAt = new Date().toISOString();
      state.lastOutputAt = state.lastDecodedAt;
      state.sampleRate = sampleRate;
      state.numberOfChannels = channels || state.numberOfChannels;
      state.contextState = audioContext.state || 'unknown';
      if (state.contextState === 'running') setState('playing');
      else {
        setState('autoplay-blocked');
        void resume();
      }
      callbacks.onFrame?.({ decoded: true, frames, sampleRate, numberOfChannels: state.numberOfChannels });
    };

    const scheduleAudioData = (audioData) => {
      if (closed) { audioData.close?.(); return; }
      try {
        if (!createOutput()) { audioData.close?.(); return; }
        if (workletNode || workletPending) {
          const { planes, frames, sampleRate } = copyAudioDataToPlanes(audioData);
          audioData.close?.();
          if (workletNode) postPlanes(planes);
          else if (workletQueue.length < 200) workletQueue.push(planes);
          markPlayed(frames, sampleRate, planes.length);
          return;
        }
        const converted = copyAudioDataToBuffer(audioData);
        audioData.close?.();
        if (!converted) return;
        const now = Number(audioContext.currentTime) || 0;
        if (!Number.isFinite(nextAudioTime) || nextAudioTime < now - 0.08 || nextAudioTime > now + 1.2) nextAudioTime = now + 0.08;
        const startAt = Math.max(nextAudioTime, now + 0.012);
        const source = audioContext.createBufferSource();
        source.buffer = converted.buffer;
        source.connect(gainNode || audioContext.destination);
        source.onended = () => { try { source.disconnect(); } catch { /* already disconnected */ } };
        source.start(startAt);
        nextAudioTime = startAt + (converted.frames / converted.sampleRate);
        state.decodedFrames += converted.frames;
        state.scheduledFrames += converted.frames;
        state.lastDecodedAt = new Date().toISOString();
        state.lastOutputAt = state.lastDecodedAt;
        state.sampleRate = converted.sampleRate;
        state.numberOfChannels = converted.buffer.numberOfChannels || state.numberOfChannels;
        state.contextState = audioContext.state || 'unknown';
        if (state.contextState === 'running') setState('playing');
        else {
          setState('autoplay-blocked');
          void resume();
        }
        callbacks.onFrame?.({ decoded: true, frames: converted.frames, sampleRate: converted.sampleRate, numberOfChannels: state.numberOfChannels });
      } catch (error) {
        try { audioData.close?.(); } catch { /* already closed */ }
        fail(error);
      }
    };

    const processPacket = (packet) => {
      if (packet.kind === 'fec') {
        state.fecPackets += 1;
        return;
      }
      if (packet.kind !== 'opus') return;
      state.opusPackets += 1;
      if (!decoder || closed || state.state === 'unsupported') return;
      try {
        const chunk = new window.EncodedAudioChunk({
          type: 'key',
          timestamp: timestampInMicroseconds(packet.timestamp),
          duration: Math.max(1, Math.round(state.packetDurationMs * 1000)),
          data: packet.data,
        });
        decoder.decode(chunk);
      } catch (error) {
        fail(error);
      }
    };

    const sequenceDistance = (sequence, base) => (sequence - base + 0x10000) & 0xffff;
    const clearDrainTimer = () => {
      if (pendingDrainTimer != null) clearTimeout(pendingDrainTimer);
      pendingDrainTimer = null;
    };
    const drain = (force = false) => {
      if (closed || expectedSequence == null) return;
      while (pending.has(expectedSequence)) {
        const packet = pending.get(expectedSequence);
        pending.delete(expectedSequence);
        processPacket(packet);
        expectedSequence = (expectedSequence + 1) & 0xffff;
      }
      if (!pending.size) { clearDrainTimer(); return; }
      if (pending.has(expectedSequence)) return drain(force);
      if (force || pending.size >= state.jitterPackets) {
        const nextSequence = [...pending.keys()].sort((a, b) => sequenceDistance(a, expectedSequence) - sequenceDistance(b, expectedSequence))[0];
        const missing = sequenceDistance(nextSequence, expectedSequence);
        if (missing > 0 && missing < 0x8000) {
          state.droppedPackets += missing;
          expectedSequence = nextSequence;
        }
        return drain(false);
      }
      if (pendingDrainTimer == null) pendingDrainTimer = setTimeout(() => { pendingDrainTimer = null; drain(true); }, state.jitterDelayMs);
    };

    if (!decoderSupported) {
      setState('unsupported');
    } else if (!createOutput()) {
      setState('unsupported');
    } else {
      try {
        decoder = new window.AudioDecoder({ output: scheduleAudioData, error: (error) => fail(error) });
        decoder.configure({ codec: options.codec || 'opus', sampleRate: state.sampleRate, numberOfChannels: state.numberOfChannels });
        state.contextState = audioContext.state || 'unknown';
      } catch (error) {
        decoder = null;
        state.lastError = text(error?.message || error);
        setState('unsupported');
        callbacks.onState?.({ ...state });
      }
    }

    const ingest = (value) => {
      if (closed) return false;
      try {
        const envelope = value?.stream && value?.rtp ? value : parseEnvelope(value);
        if (envelope.stream !== 'audio') return false;
        const rtp = envelope.rtp || parseRtp(envelope.packet);
        const packet = parseAudioPacket(rtp, state);
        state.packets += 1;
        state.bytes += envelope.packetLength || envelope.packet?.length || 0;
        state.lastPacketAt = Date.now();
        if (!packet || !packet.supported) {
          state.unsupportedPackets += 1;
          if (state.state === 'waiting') setState('receiving');
          return true;
        }
        if (state.state === 'waiting') setState('receiving');
        if (expectedSequence != null) {
          const distance = sequenceDistance(packet.sequenceNumber, expectedSequence);
          if (distance > 0x8000) { state.latePackets += 1; return true; }
          if (pending.has(packet.sequenceNumber)) { state.duplicatePackets += 1; return true; }
        } else {
          expectedSequence = packet.sequenceNumber;
        }
        pending.set(packet.sequenceNumber, packet);
        drain(false);
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    };

    const stop = () => {
      if (closed) return;
      closed = true;
      clearDrainTimer();
      pending.clear();
      try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* already closed */ }
      try { workletNode?.disconnect?.(); } catch { /* already disconnected */ }
      workletNode = null;
      workletQueue.length = 0;
      try { gainNode?.disconnect?.(); } catch { /* already disconnected */ }
      if (ownsAudioContext) {
        try { void audioContext?.close?.(); } catch { /* already closed */ }
      }
      setState('stopped');
    };

    return {
      get state() { return state.state; },
      get stats() { return { ...state, pendingPackets: pending.size }; },
      ingest,
      resume,
      stop,
      flush: async () => {
        drain(true);
        try { await decoder?.flush?.(); } catch (error) { fail(error); }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Reed-Solomon recovery compatible with nanors (as used by Sunshine):
  // GF(2^8) with polynomial 0x11d and a Cauchy parity matrix P[j][i] = INV[(ps + i) ^ j].
  // ---------------------------------------------------------------------------
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
  })();
  const gfMul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);
  const gfInv = (a) => (a ? GF_EXP[255 - GF_LOG[a]] : 0);

  // dst ^= src * factor
  function gfAxpy(dst, src, factor) {
    if (!factor) return;
    if (factor === 1) {
      for (let i = 0; i < dst.length; i += 1) dst[i] ^= src[i];
      return;
    }
    const logFactor = GF_LOG[factor];
    for (let i = 0; i < dst.length; i += 1) {
      const value = src[i];
      if (value) dst[i] ^= GF_EXP[GF_LOG[value] + logFactor];
    }
  }

  // Recover missing data shards in place. data: Array(ds) of Uint8Array|undefined,
  // parity: Map(parityIndex -> Uint8Array). All shards have the same length.
  function recoverShards(data, parity, dataShards, parityShards, length) {
    const missing = [];
    for (let i = 0; i < dataShards; i += 1) if (!data[i]) missing.push(i);
    if (!missing.length) return true;
    const rows = [...parity.keys()].filter((j) => j < parityShards).slice(0, missing.length);
    if (rows.length < missing.length) return false;
    const n = missing.length;
    const coefficient = (j, i) => gfInv((parityShards + i) ^ j);
    // b_r = parity_r ^ sum(P[r][i] * d_i) over present data shards
    const rhs = rows.map((j) => {
      const acc = Uint8Array.from(parity.get(j).subarray(0, length));
      for (let i = 0; i < dataShards; i += 1) if (data[i]) gfAxpy(acc, data[i].subarray(0, length), coefficient(j, i));
      return acc;
    });
    // Invert the n x n system A[r][c] = P[rows[r]][missing[c]] with Gauss-Jordan elimination.
    const a = rows.map((j) => missing.map((i) => coefficient(j, i)));
    const inv = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => (r === c ? 1 : 0)));
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      while (pivot < n && !a[pivot][col]) pivot += 1;
      if (pivot === n) return false;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [inv[col], inv[pivot]] = [inv[pivot], inv[col]];
      const scale = gfInv(a[col][col]);
      for (let c = 0; c < n; c += 1) { a[col][c] = gfMul(a[col][c], scale); inv[col][c] = gfMul(inv[col][c], scale); }
      for (let r = 0; r < n; r += 1) {
        if (r === col || !a[r][col]) continue;
        const factor = a[r][col];
        for (let c = 0; c < n; c += 1) { a[r][c] ^= gfMul(factor, a[col][c]); inv[r][c] ^= gfMul(factor, inv[col][c]); }
      }
    }
    missing.forEach((index, r) => {
      const out = new Uint8Array(length);
      for (let c = 0; c < n; c += 1) gfAxpy(out, rhs[c], inv[r][c]);
      data[index] = out;
    });
    return true;
  }

  // Reassembles Sunshine video frames from FEC-protected packets (GameStream frame assembly,
  // RtpVideoQueue): frames are split into up to 4 FEC blocks, each with dataShards data packets
  // followed by parity packets. Frames are emitted in order; a frame that can't be completed is
  // reported as lost so the decoder can wait for (and request) the next keyframe.
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function createFrameAssembler({ onFrame, onLoss, maxPendingFrames = 4 } = {}) {
    const frames = new Map();
    let lastEmitted = null;
    const stats = { recoveredShards: 0, lostFrames: 0, parityPackets: 0 };
    const newer = (a, b) => ((a - b) | 0) > 0;

    const emit = (frameIndex, frame) => {
      const parts = [];
      for (let block = 0; block <= frame.lastBlock; block += 1) {
        const entry = frame.blocks.get(block);
        for (let i = 0; i < entry.dataShards; i += 1) parts.push(entry.data[i]);
      }
      let bytes = concatBytes(parts);
      let frameType = null;
      let hostProcessingMs = null;
      if (bytes[0] === 0x01 && bytes.length >= 8) {
        // 8-byte short frame header: type, latency(2, 1/10 ms; 0 = unknown), frameType, lastPayloadLen(LE16), reserved(2)
        hostProcessingMs = readU16LE(bytes, 1) / 10 || null;
        frameType = bytes[3];
        const lastPayloadLength = readU16LE(bytes, 4);
        const shardLength = parts[parts.length - 1].length;
        if (lastPayloadLength > 0 && lastPayloadLength <= shardLength) bytes = bytes.subarray(0, bytes.length - shardLength + lastPayloadLength);
        bytes = bytes.subarray(8);
      } else if (bytes[0] === 0x81 && bytes.length >= 44) {
        bytes = bytes.subarray(44);
      }
      lastEmitted = frameIndex;
      onFrame?.({ frameIndex, bytes, timestamp: frame.timestamp, frameType, hostProcessingMs, assemblyMs: now() - frame.firstAt });
    };

    const dropOlderThan = (frameIndex) => {
      for (const index of [...frames.keys()]) {
        if (newer(frameIndex, index)) {
          frames.delete(index);
          stats.lostFrames += 1;
          onLoss?.(index);
        }
      }
    };

    const blockComplete = (entry) => {
      if (entry.done) return true;
      if (entry.present === entry.dataShards) { entry.done = true; return true; }
      if (entry.present + entry.parity.size < entry.dataShards) return false;
      const length = Math.min(...[...entry.data.filter(Boolean), ...entry.parity.values()].map((shard) => shard.length));
      const before = entry.present;
      if (!recoverShards(entry.data, entry.parity, entry.dataShards, entry.parityShards, length)) return false;
      stats.recoveredShards += entry.dataShards - before;
      entry.done = true;
      return true;
    };

    return {
      stats,
      push(packet) {
        const { frameIndex, blockIndex, lastBlock, fecIndex, dataShards } = packet;
        if (lastEmitted != null && !newer(frameIndex, lastEmitted)) return;
        let frame = frames.get(frameIndex);
        if (!frame) {
          frame = { blocks: new Map(), lastBlock, timestamp: packet.timestamp, firstAt: now() };
          frames.set(frameIndex, frame);
        }
        let entry = frame.blocks.get(blockIndex);
        if (!entry) {
          const parityShards = Math.max(0, Math.ceil((dataShards * packet.fecPercentage) / 100));
          entry = { dataShards, parityShards, data: new Array(dataShards), parity: new Map(), present: 0, done: false };
          frame.blocks.set(blockIndex, entry);
        }
        if (entry.done) return;
        if (fecIndex < dataShards) {
          if (entry.data[fecIndex]) return;
          entry.data[fecIndex] = packet.shard;
          entry.present += 1;
        } else {
          stats.parityPackets += 1;
          entry.parityShards = Math.max(entry.parityShards, fecIndex - dataShards + 1);
          entry.parity.set(fecIndex - dataShards, packet.shard);
        }
        if (!blockComplete(entry)) {
          // Give up on frames that have fallen too far behind the newest one.
          dropOlderThan((frameIndex - maxPendingFrames) >>> 0);
          return;
        }
        for (let block = 0; block <= frame.lastBlock; block += 1) {
          const other = frame.blocks.get(block);
          if (!other || !blockComplete(other)) return;
        }
        frames.delete(frameIndex);
        dropOlderThan(frameIndex);
        emit(frameIndex, frame);
      },
      reset() { frames.clear(); lastEmitted = null; },
    };
  }

  const FRAME_HEADER_BYTES = 12;

  function createVideoPipeline(canvas, options = {}) {
    const target = canvas || null;
    const callbacks = options.callbacks || options;
    const state = {
      state: 'waiting-keyframe',
      packets: 0,
      bytes: 0,
      frames: 0,
      decodedFrames: 0,
      droppedFrames: 0,
      decodeErrors: 0,
      lastFrameAt: null,
      lastError: null,
      codecFamily: String(options.videoCodec || 'h264').toLowerCase(),
      codec: options.codec || ({ hevc: 'hev1.1.6.L120.B0', av1: 'av01.0.08M.08' }[String(options.videoCodec || '').toLowerCase()] || 'avc1.42E01E'),
      format: 'annexb',
      clockRate: Number(options.clockRate) || 90000,
      frameRate: Number(options.fps) || 60,
      // Running sums so a caller can average over any window by diffing two snapshots.
      hostProcessingSum: 0, hostProcessingCount: 0,
      assemblySum: 0, assemblyCount: 0,
      decodeSum: 0, decodeCount: 0,
      decodeQueue: 0,
      backlogResets: 0,
      renderedFrames: 0,
      skippedFrames: 0,
    };
    // A decoder that cannot keep up would otherwise queue frames forever and the picture drifts seconds behind.
    // Past ~0.5 s of queued frames: drop the backlog, wait for the next keyframe (the app requests an IDR,
    // which Sunshine answers within a frame or two). Not while the decoder is still warming up after (re)configuration.
    const MAX_DECODE_QUEUE = Number(options.maxDecodeQueue) || Math.max(15, Math.round(state.frameRate / 2));
    let warmedUp = false;
    const decoderSupported = typeof window !== 'undefined'
      && typeof window.VideoDecoder === 'function'
      && typeof window.EncodedVideoChunk === 'function'
      && target
      && typeof target.getContext === 'function';
    let decoder = null;
    let context = null;
    let current = null;
    let closed = false;
    let timestampFallback = 0;
    let decoderDescription = null;
    let lastRtpTimestamp = null;
    let timestampEpoch = 0;
    const frameDuration = Math.max(1, Math.round(1000000 / state.frameRate));
    // Notify only on a real change: decoded frames would otherwise report "playing" dozens of times a second.
    const setState = (next, extra = {}, force = false) => {
      if (!force && state.state === next && !Object.keys(extra).length) return;
      state.state = next;
      Object.assign(state, extra);
      callbacks.onState?.({ ...state });
    };
    const fail = (error, next = 'decode-error') => {
      state.lastError = text(error?.message || error);
      state.decodeErrors += 1;
      setState(next);
      callbacks.onError?.(error instanceof Error ? error : new Error(state.lastError));
    };
    // Present at most one frame per display refresh. The first frame in a refresh is drawn at once (no added
    // latency); later ones only replace a pending frame that is drawn on the next refresh, and superseded
    // frames are closed immediately so the decoder's small output pool never stalls.
    let pendingFrame = null;
    let drewThisRefresh = false;
    let refreshScheduled = false;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
    const onRefresh = () => {
      refreshScheduled = false;
      drewThisRefresh = false;
      if (!pendingFrame) return;
      const frame = pendingFrame;
      pendingFrame = null;
      drawNow(frame);
    };
    const scheduleRefresh = () => {
      if (refreshScheduled || closed) return;
      refreshScheduled = true;
      raf(onRefresh);
    };
    const drawNow = (frame) => {
      if (!closed) {
        makeCanvas(frame);
        state.renderedFrames += 1;
        drewThisRefresh = true;
        scheduleRefresh();
      }
      frame.close();
    };
    const present = (frame) => {
      if (!drewThisRefresh) { drawNow(frame); return; }
      if (pendingFrame) { pendingFrame.close(); state.skippedFrames += 1; }
      pendingFrame = frame;
      scheduleRefresh();
    };
    const makeCanvas = (frame) => {
      if (!target || !context) return;
      const width = frame.displayWidth || frame.codedWidth || target.width || 1;
      const height = frame.displayHeight || frame.codedHeight || target.height || 1;
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
      try { context.drawImage(frame, 0, 0, width, height); } catch (error) { fail(error); }
    };
    const updateDecoderFormat = (info) => {
      if (state.codecFamily !== 'h264') {
        // HEVC (Annex B) and AV1 (OBUs) decode in-band: no description, codec string from the bitstream.
        if (info?.codec) state.codec = info.codec;
        state.format = state.codecFamily === 'av1' ? 'obu' : 'annexb';
        return;
      }
      if (!info?.description) return;
      decoderDescription = info.description;
      state.codec = info.codec || state.codec;
      state.format = 'avc';
    };
    // Keyframe and parameter sets for the negotiated codec; Sunshine's frame header type 2 = IDR as well.
    const codecInfo = (frame, frameType) => {
      if (state.codecFamily === 'hevc') { const info = hevcInfo(frame); return { ...info, keyframe: info.keyframe || frameType === 2 }; }
      if (state.codecFamily === 'av1') { const info = av1Info(frame); return { ...info, keyframe: info.keyframe || frameType === 2 }; }
      const info = h264Info(frame);
      return { ...info, keyframe: info.keyframe || frameType === 2, paramKey: info.description };
    };
    // SPS/PPS the decoder was configured with; a keyframe with different ones (live resolution change)
    // reconfigures the decoder in place.
    let configuredDescription = null;
    const sameBytes = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index]);
    const configureDecoder = (info) => {
      if (!decoder) return;
      if (decoder.state === 'configured') {
        if (!info?.keyframe || !info.paramKey || sameBytes(info.paramKey, configuredDescription)) return;
      } else if (decoder.state !== 'unconfigured') {
        return;
      }
      updateDecoderFormat(info);
      configuredDescription = info?.paramKey || decoderDescription;
      try {
        // "no-preference" still uses the GPU decoder when there is one; "prefer-hardware" makes configure
        // fail outright on machines without hardware H.264 decoding (VMs, some Linux setups, remote desktops).
        const config = { codec: state.codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' };
        if (decoderDescription) config.description = decoderDescription;
        decoder.configure(config);
      } catch (error) {
        fail(error);
      }
    };
    const timestampInMicroseconds = (rtpTimestamp) => {
      const raw = Number(rtpTimestamp);
      if (!Number.isFinite(raw)) {
        timestampFallback += 1;
        return timestampFallback * frameDuration;
      }
      const current = raw >>> 0;
      if (lastRtpTimestamp != null && current < lastRtpTimestamp && lastRtpTimestamp - current > 0x80000000) timestampEpoch += 0x100000000;
      lastRtpTimestamp = current;
      return Math.max(0, Math.round(((timestampEpoch + current) * 1000000) / state.clockRate));
    };
    let needKeyframe = true;
    // decode() submit time by chunk timestamp, to measure decoder latency in output().
    const submittedAt = new Map();
    const noteFrameTiming = (timing) => {
      if (timing?.hostProcessingMs) { state.hostProcessingSum += timing.hostProcessingMs; state.hostProcessingCount += 1; }
      if (Number.isFinite(timing?.assemblyMs)) { state.assemblySum += timing.assemblyMs; state.assemblyCount += 1; }
    };
    const decodeFrame = (frame, timestamp, timing, frameType = null) => {
      noteFrameTiming(timing);
      const info = { ...codecInfo(frame, frameType), timestamp };
      state.frames += 1;
      updateDecoderFormat(info);
      if (info.keyframe) needKeyframe = false;
      if (needKeyframe) {
        state.droppedFrames += 1;
        callbacks.onFrame?.({ keyframe: false, decoded: false, waitingKeyframe: true, info });
        return;
      }
      if (!decoder || closed) return;
      if (warmedUp && decoder.state === 'configured' && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
        warmedUp = false;
        try { decoder.reset(); } catch { /* reconfigured below on the next keyframe */ }
        submittedAt.clear();
        state.backlogResets += 1;
        state.droppedFrames += 1;
        needKeyframe = !info.keyframe;
        if (needKeyframe) {
          setState('waiting-keyframe');
          callbacks.onFrame?.({ keyframe: false, decoded: false, waitingKeyframe: true, info });
          return;
        }
      }
      configureDecoder(info);
      if (!decoder || decoder.state !== 'configured') return;
      try {
        const timestamp = timestampInMicroseconds(info.timestamp);
        const data = decoderDescription ? toAvcSample(frame, info.nals) : frame;
        const chunk = new window.EncodedVideoChunk({ type: info.keyframe ? 'key' : 'delta', timestamp, duration: frameDuration, data });
        submittedAt.set(timestamp, now());
        decoder.decode(chunk);
        state.decodeQueue = decoder.decodeQueueSize;
        callbacks.onFrame?.({ keyframe: info.keyframe, decoded: false, waitingKeyframe: false, info });
      } catch (error) {
        fail(error);
      }
    };

    const finalizeFrame = () => {
      if (!current || !current.parts.length) return;
      const frame = concatBytes(current.parts);
      const { timestamp, hostProcessingMs, firstAt } = current;
      current = null;
      decodeFrame(frame, timestamp, { hostProcessingMs, assemblyMs: now() - firstAt });
    };
    const assembler = createFrameAssembler({
      onFrame: ({ bytes, timestamp, hostProcessingMs, assemblyMs, frameType }) => decodeFrame(bytes, timestamp, { hostProcessingMs, assemblyMs }, frameType),
      onLoss: () => {
        // A missing frame breaks the reference chain: hold P-frames until the next keyframe.
        needKeyframe = true;
        state.droppedFrames += 1;
        if (state.state !== 'unsupported') setState('waiting-keyframe');
        callbacks.onFrame?.({ keyframe: false, decoded: false, waitingKeyframe: true, lost: true, info: null });
      },
    });

    if (!decoderSupported) {
      setState('unsupported');
    } else {
      try {
        context = target.getContext('2d', { alpha: false, desynchronized: true });
        decoder = createDecoder();
      } catch (error) {
        decoder = null;
        fail(error, 'unsupported');
      }
    }

    function createDecoder() {
      return new window.VideoDecoder({
          output(frame) {
            if (closed) { frame.close(); return; }
            const submitted = submittedAt.get(frame.timestamp);
            if (submitted !== undefined) {
              submittedAt.delete(frame.timestamp);
              state.decodeSum += now() - submitted;
              state.decodeCount += 1;
            }
            warmedUp = true;
            state.decodedFrames += 1;
            state.lastFrameAt = Date.now();
            state.decodeQueue = decoder?.decodeQueueSize ?? 0;
            present(frame);
            setState('playing');
            callbacks.onFrame?.({ keyframe: false, decoded: true, waitingKeyframe: false, info: null });
          },
          error(error) {
            fail(error);
            // WebCodecs closes the decoder after an error; start over from the next keyframe.
            if (closed) return;
            try {
              decoder = createDecoder();
              needKeyframe = true;
              setState('waiting-keyframe');
              callbacks.onFrame?.({ keyframe: false, decoded: false, waitingKeyframe: true, info: null });
            } catch { /* keep the error state */ }
          },
        });
    }

    // Whole frame from the bridge: 12-byte header (frame index, RTP timestamp, frame type, host processing
    // in 0.1 ms) + the codec payload; envelope.flags = frames lost right before this one.
    const ingestFrame = (envelope) => {
      const bytes = envelope.packet;
      if (!bytes || bytes.length < FRAME_HEADER_BYTES) return false;
      state.packets += 1;
      state.bytes += bytes.length;
      if (envelope.flags > 0) {
        state.lostFrames = (state.lostFrames || 0) + envelope.flags;
        state.droppedFrames += envelope.flags;
        needKeyframe = true;
        if (state.state !== 'unsupported') setState('waiting-keyframe');
        callbacks.onFrame?.({ keyframe: false, decoded: false, waitingKeyframe: true, lost: true, info: null });
      }
      const frameType = bytes[8];
      const hostProcessingMs = readU16BE(bytes, 10) / 10 || null;
      decodeFrame(bytes.subarray(FRAME_HEADER_BYTES), readU32BE(bytes, 4), { hostProcessingMs, assemblyMs: null }, frameType);
      return true;
    };

    const ingest = (value) => {
      if (closed || state.state === 'unsupported') return false;
      try {
        const envelope = value?.stream ? value : parseEnvelope(value);
        if (envelope.stream === 'video-frame') return ingestFrame(envelope);
        if (envelope.stream !== 'video') return false;
        const packet = envelope.rtp ? parseVideoPacket(envelope.rtp) : null;
        if (!packet) return false;
        state.packets += 1;
        state.bytes += envelope.packetLength || envelope.packet?.length || 0;
        if (!packet.raw && packet.dataShards > 0) {
          assembler.push(packet);
          state.recoveredShards = assembler.stats.recoveredShards;
          state.lostFrames = assembler.stats.lostFrames;
          return true;
        }
        const boundary = packet.frameIndex;
        if (current && (current.frameIndex !== boundary || (!packet.raw && packet.first))) {
          if (!current.last) state.droppedFrames += 1;
          finalizeFrame();
        }
        if (!current) {
          current = { frameIndex: boundary, last: false, parts: [], lastStreamPacketIndex: null, timestamp: packet.timestamp, firstAt: now(), hostProcessingMs: null };
        }
        if (packet.hostProcessingMs) current.hostProcessingMs = packet.hostProcessingMs;
        if (!packet.raw && current.lastStreamPacketIndex != null && packet.streamPacketIndex != null) {
          const expected = (current.lastStreamPacketIndex + 1) & 0x00ffffff;
          if (packet.streamPacketIndex !== expected) {
            state.droppedFrames += 1;
            current = { frameIndex: boundary, last: false, parts: [], lastStreamPacketIndex: null, timestamp: packet.timestamp, firstAt: now(), hostProcessingMs: null };
          }
        }
        current.frameIndex = boundary;
        current.timestamp = packet.timestamp;
        current.lastStreamPacketIndex = packet.streamPacketIndex;
        if (packet.containsPictureData && packet.data?.length) current.parts.push(packet.data);
        current.last = packet.last;
        if (packet.last) finalizeFrame();
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    };
    const stop = () => {
      if (closed) return;
      closed = true;
      current = null;
      if (pendingFrame) { pendingFrame.close(); pendingFrame = null; }
      try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* already closed */ }
      setState('stopped');
    };
    return {
      get state() { return state.state; },
      get stats() { return { ...state }; },
      ingest,
      stop,
      flush() { finalizeFrame(); },
    };
  }

  const api = { MAGIC, VERSION, STREAM_IDS, VIDEO_FLAGS, AUDIO_PAYLOAD_TYPES, FRAME_HEADER_BYTES, recoverShards, createFrameAssembler, parseRtp, parseEnvelope, forEachEnvelope, hevcInfo, hevcCodecString, av1Info, av1CodecString, parseVideoPacket, parseAudioPacket, createVideoPipeline, createAudioPipeline, h264Info, avcCodecString, buildAvcDecoderConfigurationRecord, toAvcSample };
  if (typeof window !== 'undefined') window.SunbridgeMedia = api;
  if (typeof globalThis !== 'undefined') globalThis.SunbridgeMedia = api;
})();

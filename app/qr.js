// Minimal QR code encoder (byte mode, error correction level M, versions 1-40, automatic mask), used to
// show the two-step verification setup link to an authenticator app. Follows ISO/IEC 18004 the same way
// Project Nayuki's reference implementation does. window.SunbridgeQr.svg(text) returns an <svg> element.
(function () {
  'use strict';
  // Level M tables, indexed by version.
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_BITS_M = 0; // level M is 00 in the format information

  const rawModules = (version) => {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const align = Math.floor(version / 7) + 2;
      result -= (25 * align - 10) * align - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  };
  const dataCodewords = (version) => Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

  // GF(256) Reed-Solomon with polynomial 0x11D.
  const gfMultiply = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  };
  const rsDivisor = (degree) => {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
      for (let j = 0; j < result.length; j += 1) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  };
  const rsRemainder = (data, divisor) => {
    const result = divisor.map(() => 0);
    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      divisor.forEach((coefficient, index) => { result[index] ^= gfMultiply(coefficient, factor); });
    }
    return result;
  };

  const alignmentPositions = (version) => {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
  };

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let version = 1;
    for (; version <= 40; version += 1) {
      const countBits = version < 10 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
    }
    if (version > 40) throw new Error('Text too long for a QR code');

    // Data bits: byte mode indicator, length, payload, terminator, padding.
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((byte) => push(byte, 8));
    const capacity = dataCodewords(version) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));

    // Split into blocks, add error correction, interleave.
    const blockCount = BLOCKS[version];
    const eccLength = ECC_PER_BLOCK[version];
    const shortBlocks = blockCount - (Math.floor(rawModules(version) / 8) % blockCount);
    const shortLength = Math.floor(rawModules(version) / 8 / blockCount);
    const divisor = rsDivisor(eccLength);
    const blocks = [];
    for (let i = 0, offset = 0; i < blockCount; i += 1) {
      const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
      const chunk = data.slice(offset, offset + length);
      offset += length;
      const ecc = rsRemainder(chunk, divisor);
      if (i < shortBlocks) chunk.push(0);
      blocks.push(chunk.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i += 1) {
      blocks.forEach((block, index) => { if (i !== shortLength - eccLength || index >= shortBlocks) codewords.push(block[i]); });
    }

    // Function patterns.
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };
    for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, distance !== 2 && distance !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const positions = alignmentPositions(version);
    positions.forEach((ay, i) => positions.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = (mask) => {
      const value = (FORMAT_BITS_M << 3) | mask;
      let remainder = value;
      for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
      const format = ((value << 10) | remainder) ^ 0x5412;
      const bit = (i) => ((format >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0); // reserve the format areas
    if (version >= 7) {
      let remainder = version;
      for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
      const value = (version << 12) | remainder;
      for (let i = 0; i < 18; i += 1) {
        const dark = ((value >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3); const b = Math.floor(i / 3);
        set(a, b, dark); set(b, a, dark);
      }
    }

    // Data in the zigzag order.
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (!reserved[y][x] && index < codewords.length * 8) {
            modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
            index += 1;
          }
        }
      }
    }

    const maskFns = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (mask) => {
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!reserved[y][x] && maskFns[mask](x, y)) modules[y][x] = !modules[y][x];
    };
    const penalty = () => {
      let score = 0;
      const line = (get) => {
        for (let a = 0; a < size; a += 1) {
          let run = 1;
          for (let b = 1; b <= size; b += 1) {
            if (b < size && get(a, b) === get(a, b - 1)) { run += 1; continue; }
            if (run >= 5) score += run - 2;
            run = 1;
          }
          for (let b = 0; b + 10 < size + 1; b += 1) {
            const window = Array.from({ length: 11 }, (_, k) => (b + k < size ? get(a, b + k) : false)).map(Number).join('');
            if (b + 11 <= size && (window === '10111010000' || window === '00001011101')) score += 40;
          }
        }
      };
      line((a, b) => modules[a][b]);
      line((a, b) => modules[b][a]);
      for (let y = 0; y + 1 < size; y += 1) for (let x = 0; x + 1 < size; x += 1) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
      }
      const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
      score += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
      return score;
    };
    let best = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      applyMask(mask); drawFormat(mask);
      const score = penalty();
      if (score < bestScore) { best = mask; bestScore = score; }
      applyMask(mask);
    }
    applyMask(best); drawFormat(best);
    return modules;
  }

  function svg(text, { border = 4 } = {}) {
    const modules = encode(text);
    const size = modules.length + border * 2;
    let path = '';
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + border},${y + border}h1v1h-1z`; }));
    const ns = 'http://www.w3.org/2000/svg';
    const element = document.createElementNS(ns, 'svg');
    element.setAttribute('viewBox', `0 0 ${size} ${size}`);
    element.setAttribute('shape-rendering', 'crispEdges');
    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('width', '100%'); background.setAttribute('height', '100%'); background.setAttribute('fill', '#ffffff');
    const shape = document.createElementNS(ns, 'path');
    shape.setAttribute('d', path); shape.setAttribute('fill', '#000000');
    element.append(background, shape);
    return element;
  }

  const api = { encode, svg };
  if (typeof window !== 'undefined') window.SunbridgeQr = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

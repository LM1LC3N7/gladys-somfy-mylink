// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark-to-teal gradient, a
// window with a roller shutter half down, the square MyLink bridge beside it
// with its one-way radio waves, and the three RTS buttons (up, my, down) under
// it. Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [14, 22, 38];
const BLUE = [24, 110, 128];
const WHITE = [255, 255, 255];
const GREEN = [120, 220, 140];
const AMBER = [255, 196, 84];

/** Distance to the border of a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance to a segment. */
function segment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function pixel(x, y) {
  let color = mix(DARK, BLUE, (x / WIDTH) * 0.55 + (y / HEIGHT) * 0.45);
  // The window and its frame.
  const window = roundedBox(x, y, 330, 240, 170, 150, 8);
  if (window < 0) {
    color = mix(color, AMBER, 0.2);
  }
  color = mix(color, WHITE, smooth(4, Math.abs(window)) * 0.6);
  // The roller box, and the shutter half down with its slats.
  color = mix(color, WHITE, smooth(9, segment(x, y, 150, 92, 510, 92)));
  if (x >= 166 && x <= 494 && y >= 100 && y <= 240) {
    const slat = 0.5 + 0.5 * Math.cos(((y - 100) / 14) * Math.PI * 2);
    color = mix(color, WHITE, 0.62 + 0.18 * slat);
  }
  color = mix(color, WHITE, smooth(5, segment(x, y, 166, 244, 494, 244)));
  // The bridge: a rounded square with a light, and waves going out only.
  const bridge = roundedBox(x, y, 650, 240, 40, 40, 10);
  color = mix(color, WHITE, smooth(1, bridge) * 0.9);
  color = mix(color, GREEN, smooth(7, Math.hypot(x - 650, y - 262)));
  const hub = Math.hypot(x - 650, y - 240);
  for (const radius of [66, 88]) {
    const ring = Math.abs(hub - radius);
    if (x < 615 && Math.abs(y - 240) < 50) {
      color = mix(color, WHITE, smooth(3, ring) * 0.7);
    }
  }
  // The three RTS buttons: up, my (amber), down.
  for (const [cx, tint] of [
    [300, WHITE],
    [400, AMBER],
    [500, WHITE],
  ]) {
    const button = Math.hypot(x - cx, y - 462);
    color = mix(color, tint, smooth(26, button) * 0.9);
    color = mix(color, DARK, smooth(2, Math.abs(button - 26)) * 0.4);
  }
  // Arrows on up and down.
  color = mix(color, DARK, smooth(4, segment(x, y, 288, 470, 300, 452)) * 0.8);
  color = mix(color, DARK, smooth(4, segment(x, y, 312, 470, 300, 452)) * 0.8);
  color = mix(color, DARK, smooth(4, segment(x, y, 488, 454, 500, 472)) * 0.8);
  color = mix(color, DARK, smooth(4, segment(x, y, 512, 454, 500, 472)) * 0.8);
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);

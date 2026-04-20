#!/usr/bin/env node
'use strict';
/**
 * generate-icons.js
 * Creates a 512×512 PNG icon for KuaDashboard using pure Node.js (no deps).
 *
 * The icon is a dark rounded-rect background (#1e1e1e) with a teal "K" glyph.
 * electron-builder auto-converts the PNG to .ico (Windows) and .icns (macOS).
 *
 * Usage:  node scripts/generate-icons.js
 * Output: assets/icon.png
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const OUT  = path.join(__dirname, '..', 'assets', 'icon.png');

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

/** Simple anti-aliased circle check */
function inRoundedRect(x, y, w, h, r) {
  if (x >= r && x <= w - r) return 1;
  if (y >= r && y <= h - r) return 1;
  // corners
  let cx, cy;
  if (x < r && y < r)           { cx = r;     cy = r; }
  else if (x > w - r && y < r)  { cx = w - r; cy = r; }
  else if (x < r && y > h - r)  { cx = r;     cy = h - r; }
  else if (x > w - r && y > h - r) { cx = w - r; cy = h - r; }
  else return 1;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= r - 0.5) return 1;
  if (dist >= r + 0.5) return 0;
  return r + 0.5 - dist; // AA edge
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// ── Draw ──────────────────────────────────────────────────────────────────────

const pixels = Buffer.alloc(SIZE * SIZE * 4);

// Background color
const BG = { r: 30, g: 30, b: 30 };
// Icon accent color (teal)
const FG = { r: 56, g: 189, b: 248 };
// K letter dimensions
const margin = Math.round(SIZE * 0.12);
const radius = Math.round(SIZE * 0.12);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;
    const rrA = inRoundedRect(x, y, SIZE, SIZE, radius);

    if (rrA <= 0) {
      // transparent
      pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 0;
      continue;
    }

    // Normalized coords inside the icon area
    const nx = (x - margin) / (SIZE - 2 * margin);
    const ny = (y - margin) / (SIZE - 2 * margin);

    let isFG = false;

    // Draw "K" glyph
    // Vertical bar of K (left side)
    const barW = 0.18;
    if (nx >= 0.1 && nx <= 0.1 + barW && ny >= 0.1 && ny <= 0.9) {
      isFG = true;
    }

    // Upper diagonal of K
    const diagStart = 0.1 + barW;
    const kMidY = 0.5;
    if (nx >= diagStart && nx <= 0.85 && ny >= 0.1 && ny <= kMidY) {
      // Line from (diagStart, kMidY) to (0.85, 0.1)
      const t = (nx - diagStart) / (0.85 - diagStart);
      const lineY = kMidY - t * (kMidY - 0.1);
      if (Math.abs(ny - lineY) < barW * 0.55) isFG = true;
    }

    // Lower diagonal of K
    if (nx >= diagStart && nx <= 0.85 && ny >= kMidY && ny <= 0.9) {
      const t = (nx - diagStart) / (0.85 - diagStart);
      const lineY = kMidY + t * (0.9 - kMidY);
      if (Math.abs(ny - lineY) < barW * 0.55) isFG = true;
    }

    const col = isFG ? FG : BG;
    const a = clamp(rrA * 255);
    pixels[idx]     = col.r;
    pixels[idx + 1] = col.g;
    pixels[idx + 2] = col.b;
    pixels[idx + 3] = a;
  }
}

// ── Encode PNG ────────────────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);  // width
ihdr.writeUInt32BE(SIZE, 4);  // height
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type (RGBA)
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// IDAT – raw image data with filter byte per row
const rawRows = [];
for (let y = 0; y < SIZE; y++) {
  rawRows.push(Buffer.from([0])); // filter: none
  rawRows.push(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4));
}
const rawData = Buffer.concat(rawRows);
const compressed = zlib.deflateSync(rawData, { level: 9 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// ── Write ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`Icon generated: ${OUT} (${png.length} bytes, ${SIZE}×${SIZE})`);

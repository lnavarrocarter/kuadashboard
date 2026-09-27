'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeRdpBitmap } = require('./rdpBitmap');

test('serializes decompressed RDP pixel arrays as base64 32-bit bitmaps', () => {
  const pixels = new Uint8ClampedArray([0, 0, 255, 255, 0, 255, 0, 255]);
  const result = serializeRdpBitmap({
    destLeft: 2,
    destTop: 3,
    width: 2,
    height: 1,
    bitsPerPixel: 24,
    data: pixels,
  });

  assert.equal(result.bpp, 32);
  assert.deepEqual([...Buffer.from(result.data, 'base64')], [...pixels]);
  assert.deepEqual([result.x, result.y, result.w, result.h], [2, 3, 2, 1]);
});

test('keeps the source bit depth for uncompressed 24-bit bitmaps', () => {
  const result = serializeRdpBitmap({
    destLeft: 0,
    destTop: 0,
    destRight: 0,
    destBottom: 0,
    bitsPerPixel: 24,
    data: Buffer.from([1, 2, 3]),
  });

  assert.equal(result.bpp, 24);
  assert.equal(result.data, Buffer.from([1, 2, 3]).toString('base64'));
});
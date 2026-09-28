'use strict';

function serializeRdpBitmap(bitmap) {
  const width = bitmap.width || (bitmap.destRight - bitmap.destLeft + 1);
  const height = bitmap.height || (bitmap.destBottom - bitmap.destTop + 1);
  const pixels = Buffer.from(bitmap.data);
  const bytesPerPixel = pixels.length === width * height * 4 ? 4 : bitmap.bitsPerPixel / 8;

  return {
    x: bitmap.destLeft,
    y: bitmap.destTop,
    w: width,
    h: height,
    bpp: bytesPerPixel * 8,
    data: pixels.toString('base64'),
  };
}

module.exports = { serializeRdpBitmap };
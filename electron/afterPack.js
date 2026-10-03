'use strict';
/**
 * electron/afterPack.js
 * electron-builder afterPack hook: onnxruntime-node (local ML, lib/ml) ships
 * native binaries for every platform and architecture (~300 MB). Keep only
 * the ones of the build being packed. They live in app.asar.unpacked
 * (asarUnpack in package.json), so they can be removed from disk here.
 */

const fs = require('node:fs');
const path = require('node:path');

const ARCHS = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // win32 | darwin | linux
  const arch = ARCHS[context.arch] || 'x64';
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const binDir = path.join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  if (!fs.existsSync(binDir)) return;
  for (const os of fs.readdirSync(binDir)) {
    const osDir = path.join(binDir, os);
    if (os !== platform) {
      fs.rmSync(osDir, { recursive: true, force: true });
      continue;
    }
    // A universal macOS build needs both architectures.
    if (arch === 'universal') continue;
    for (const cpu of fs.readdirSync(osDir)) {
      if (cpu !== arch) fs.rmSync(path.join(osDir, cpu), { recursive: true, force: true });
    }
  }
};

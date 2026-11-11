'use strict';
const fs = require('node:fs');
const path = require('node:path');

// These optional accelerators use NAN and do not compile against current V8.
// ssh2 and bunyan both retain their supported JavaScript fallback. Keep the
// modules in the local cache so a later npm install can restore them normally.
exports.default = async ({ appDir }) => {
  for (const name of ['cpu-features', 'dtrace-provider']) {
    const source = path.join(appDir, 'node_modules', name);
    if (!fs.existsSync(source)) continue;
    const cache = path.join(appDir, 'node_modules', '.cache', 'kua-optional-native');
    fs.mkdirSync(cache, { recursive: true });
    const target = path.join(cache, name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(source, target);
  }
  return true; // Continue the normal rebuild, including better-sqlite3.
};

'use strict';
const fs = require('node:fs');
const path = require('node:path');

function assertNoPackagedVercelSecret(projectDir) {
  const file = path.join(projectDir, 'config', 'runtime.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?VERCEL_OAUTH_CLIENT_SECRET\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[1].replace(/^(['"])(.*)\1$/, '$2');
    if (value) throw new Error('Packaging refused: config/runtime.env contains VERCEL_OAUTH_CLIENT_SECRET. Use the hosted Vercel exchange.');
  }
}
if (require.main === module) assertNoPackagedVercelSecret(path.join(__dirname, '..'));
module.exports = { assertNoPackagedVercelSecret };

'use strict';

const { spawnSync } = require('node:child_process');

const probeSource = `
  const Database = require('better-sqlite3');
  const database = new Database(':memory:');
  database.close();
`;

function probe() {
  return spawnSync(process.execPath, ['-e', probeSource], { encoding: 'utf8' });
}

let result = probe();
if (result.status === 0) process.exit(0);

console.log(`[native] Rebuilding better-sqlite3 for Node ${process.versions.node}...`);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rebuild = spawnSync(npmCommand, ['rebuild', 'better-sqlite3'], { stdio: 'inherit' });
if (rebuild.status !== 0) process.exit(rebuild.status ?? 1);

result = probe();
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || '[native] better-sqlite3 failed to load after rebuild.\n');
  process.exit(result.status ?? 1);
}

console.log('[native] better-sqlite3 is ready for Node.');
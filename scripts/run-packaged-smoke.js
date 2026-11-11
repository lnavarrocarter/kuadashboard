'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const output = path.join(root, 'dist-electron');
const candidates = process.platform === 'win32'
  ? [path.join(output, 'win-unpacked', 'KuaDashboard.exe')]
  : process.platform === 'darwin'
    ? fs.readdirSync(output).filter(name => name.startsWith('mac')).map(name => path.join(output, name, 'KuaDashboard.app/Contents/MacOS/KuaDashboard'))
    : ['kuadashboard', 'KuaDashboard'].map(name => path.join(output, 'linux-unpacked', name));
const executable = candidates.find(file => fs.existsSync(file));
if (!executable) throw new Error('Packaged executable was not found');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-smoke-result-'));
const resultFile = path.join(temporary, 'result.json');
const env = { ...process.env, KUA_PACKAGED_SMOKE_RESULT: resultFile };
delete env.ELECTRON_RUN_AS_NODE;
const args = ['--kua-smoke-test', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', '--ozone-platform=headless'] : [])];
try {
  const result = spawnSync(executable, args, { env, encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0 || !fs.existsSync(resultFile)) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw result.error || new Error(`Packaged smoke test failed: ${result.status}`);
  }
  const evidence = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (!evidence.sqlite || evidence.updater !== 'metadata-check-passed') throw new Error('Missing packaged smoke evidence');
  console.log(JSON.stringify(evidence));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

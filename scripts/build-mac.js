'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const packageJson = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-electron');
const MANIFEST = path.join(DIST, 'latest-mac.yml');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readArchitecture(filePath) {
  const result = spawnSync('file', ['-b', filePath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Unable to inspect ${filePath}`);
  return result.stdout.trim();
}

function verifyBundle(appDirectory, expectedArchitecture) {
  const executable = path.join(appDirectory, 'Contents', 'MacOS', 'KuaDashboard');
  const sqlite = path.join(
    appDirectory, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules',
    'better-sqlite3', 'build', 'Release', 'better_sqlite3.node',
  );
  for (const filePath of [executable, sqlite]) {
    const architecture = readArchitecture(filePath);
    if (!architecture.includes(expectedArchitecture)) {
      throw new Error(`${filePath} is not ${expectedArchitecture}: ${architecture}`);
    }
  }
  console.log(`[mac-build] Verified ${expectedArchitecture}: ${appDirectory}`);
}

function verifyArchive(archivePath, expectedArchitecture) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kuadashboard-mac-'));
  try {
    const result = spawnSync('ditto', ['-x', '-k', archivePath, temporaryDirectory], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Unable to extract ${archivePath}`);
    verifyBundle(path.join(temporaryDirectory, 'KuaDashboard.app'), expectedArchitecture);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function mergeManifests(x64Manifest, arm64Manifest) {
  const files = [...(x64Manifest.files || []), ...(arm64Manifest.files || [])];
  return {
    version: x64Manifest.version,
    files: files.filter((file, index) => files.findIndex(candidate => candidate.url === file.url) === index),
    path: x64Manifest.path,
    sha512: x64Manifest.sha512,
    releaseDate: arm64Manifest.releaseDate || x64Manifest.releaseDate,
  };
}

function build() {
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:frontend']);

  run('npx', ['electron-builder', '--mac', '--x64', '--publish', 'never']);
  verifyBundle(path.join(DIST, 'mac', 'KuaDashboard.app'), 'x86_64');
  const x64Manifest = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));

  run('npx', ['electron-builder', '--mac', '--arm64', '--publish', 'never']);
  verifyBundle(path.join(DIST, 'mac-arm64', 'KuaDashboard.app'), 'arm64');
  const arm64Manifest = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));

  const artifactPrefix = `${packageJson.build.productName}-${packageJson.version}`;
  verifyArchive(path.join(DIST, `${artifactPrefix}-mac.zip`), 'x86_64');
  verifyArchive(path.join(DIST, `${artifactPrefix}-arm64-mac.zip`), 'arm64');

  fs.writeFileSync(MANIFEST, yaml.dump(mergeManifests(x64Manifest, arm64Manifest), { lineWidth: -1 }));
  console.log('[mac-build] Wrote combined latest-mac.yml');
}

if (require.main === module) build();

module.exports = { mergeManifests, verifyArchive, verifyBundle };
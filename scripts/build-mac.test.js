'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeManifests } = require('./build-mac');

test('merges x64 and arm64 update files while keeping x64 as the default path', () => {
  const merged = mergeManifests(
    {
      version: '1.11.3', files: [{ url: 'KuaDashboard-1.11.3-mac.zip', sha512: 'x64' }],
      path: 'KuaDashboard-1.11.3-mac.zip', sha512: 'x64', releaseDate: '2026-08-11T10:00:00Z',
    },
    {
      version: '1.11.3', files: [{ url: 'KuaDashboard-1.11.3-arm64-mac.zip', sha512: 'arm64' }],
      path: 'KuaDashboard-1.11.3-arm64-mac.zip', sha512: 'arm64', releaseDate: '2026-08-11T10:01:00Z',
    },
  );
  assert.deepEqual(merged.files.map(file => file.url), [
    'KuaDashboard-1.11.3-mac.zip', 'KuaDashboard-1.11.3-arm64-mac.zip',
  ]);
  assert.equal(merged.path, 'KuaDashboard-1.11.3-mac.zip');
  assert.equal(merged.sha512, 'x64');
  assert.equal(merged.releaseDate, '2026-08-11T10:01:00Z');
});
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginRegistry, normalizePluginManifest } = require('./pluginRegistry');
const { KuaExtensionRegistry } = require('../kua/extensionRegistry');

const manifest = (overrides = {}) => ({
  manifestVersion: 1,
  id: 'demo.ci',
  name: 'Demo CI',
  description: 'Reads builds.',
  version: '1.0.0',
  contractVersion: 1,
  category: 'ci-cd',
  capabilities: { discovery: false, enrichment: false, relationshipEvidence: false, telemetry: false, historicalSearch: true, findings: false },
  resourceTypes: [],
  credentialFields: [{ name: 'token', secret: true }],
  reads: ['Builds'],
  cost: { level: 'free', summary: 'Read-only.' },
  ...overrides,
});

const adapterOf = id => ({
  manifest: {
    manifestVersion: 1, id, version: '1.0.0', contractVersion: 1,
    source: { kind: 'builtin', publisher: 'KUA', name: id },
    capabilities: { discovery: false, enrichment: false, relationshipEvidence: false, telemetry: false, historicalSearch: true, findings: false },
    transport: { kind: 'internal', runtime: 'node' }, scopes: ['application'], permissions: ['demo.read'],
  },
  queryEvidence: async () => [],
});

function memoryFiles() {
  const files = new Map();
  return {
    files,
    fileSystem: {
      readFileSync: file => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
      mkdirSync() {},
      writeFileSync: (file, data) => files.set(file, data),
    },
  };
}

test('a valid manifest is normalized; unknown fields, versions, capabilities and cost are refused', () => {
  assert.equal(normalizePluginManifest(manifest()).id, 'demo.ci');
  const invalid = [
    manifest({ extra: true }),
    manifest({ manifestVersion: 2 }),
    manifest({ id: 'Bad Id' }),
    manifest({ version: 'one' }),
    manifest({ capabilities: { discovery: true } }),
    manifest({ capabilities: { ...manifest().capabilities, magic: true } }),
    manifest({ cost: { summary: 'x' } }),
    manifest({ credentialFields: [{ name: 'token' }] }),
    manifest({ reads: 'builds' }),
    null,
  ];
  for (const candidate of invalid) assert.throws(() => normalizePluginManifest(candidate), /Plugin|Unsupported/);
});

test('the registry refuses duplicates and an adapter that is not the plugin', () => {
  assert.throws(() => createPluginRegistry({ plugins: [{ manifest: manifest() }, { manifest: manifest() }] }), { code: 'DUPLICATE_PLUGIN' });
  assert.throws(() => createPluginRegistry({ plugins: [{ manifest: manifest(), adapter: adapterOf('other.ci') }] }), { code: 'INVALID_PLUGIN_MANIFEST' });
});

test('plugins start off, turn on and off, and the choice survives a restart', async () => {
  const { fileSystem } = memoryFiles();
  const plugins = [{ manifest: manifest(), adapter: adapterOf('demo.ci'), status: async () => ({ state: 'connected', detail: 'ana' }) }];
  const first = createPluginRegistry({ dataDir: '/data', plugins, fileSystem });
  assert.equal(first.isActive('demo.ci'), false);
  assert.deepEqual((await first.list())[0].status, null, 'the status of a plugin that is off is not read');
  assert.equal((await first.setActive('demo.ci', true)).active, true);
  assert.deepEqual((await first.list())[0].status, { state: 'connected', detail: 'ana' });
  assert.equal(createPluginRegistry({ dataDir: '/data', plugins, fileSystem }).isActive('demo.ci'), true);
  await first.setActive('demo.ci', false);
  assert.equal(createPluginRegistry({ dataDir: '/data', plugins, fileSystem }).isActive('demo.ci'), false);
  await assert.rejects(async () => first.setActive('nope', true), { code: 'PLUGIN_NOT_FOUND' });
  await assert.rejects(async () => first.setActive('demo.ci', 'yes'), { code: 'INVALID_PLUGIN_STATE' });
});

test('what existed before the registry is kept on the first run only', async () => {
  const { fileSystem } = memoryFiles();
  const plugins = [{ manifest: manifest(), defaultActive: () => true }];
  assert.equal(createPluginRegistry({ dataDir: '/data', plugins, fileSystem }).isActive('demo.ci'), true);
  const second = createPluginRegistry({ dataDir: '/data', plugins: [{ manifest: manifest(), defaultActive: () => false }], fileSystem });
  assert.equal(second.isActive('demo.ci'), true, 'the migrated choice is stored and not decided again');
  const broken = createPluginRegistry({ plugins: [{ manifest: manifest(), defaultActive: () => { throw new Error('boom'); } }] });
  assert.equal(broken.isActive('demo.ci'), false);
});

test('a plugin that is off mounts nothing: no routes, no evidence source', async () => {
  const registry = createPluginRegistry({ plugins: [{ manifest: manifest(), adapter: adapterOf('demo.ci') }] });
  const extensions = new KuaExtensionRegistry({ dynamicAdapters: registry.adapters });
  const answers = [];
  const response = { status: code => ({ json: body => answers.push({ code, body }) }) };
  registry.guard('demo.ci')({}, response, () => answers.push('next'));
  assert.equal(answers[0].code, 404);
  assert.equal(answers[0].body.code, 'PLUGIN_DISABLED');
  assert.deepEqual(extensions.listSources(), []);
  assert.deepEqual((await extensions.queryEvidence({ applicationId: 'app' })).sources, []);

  await registry.setActive('demo.ci', true);
  registry.guard('demo.ci')({}, response, () => answers.push('next'));
  assert.equal(answers[1], 'next');
  assert.deepEqual(extensions.listSources().map(source => source.id), ['demo.ci']);
  assert.deepEqual((await extensions.queryEvidence({ applicationId: 'app' })).sources, [{ id: 'demo.ci', state: 'available' }]);
});

test('a first-run default may be a promise: on while pending if the plugin says so, then what it resolves', async () => {
  const { fileSystem, files } = memoryFiles();
  let resolve;
  const plugins = [{ manifest: manifest(), defaultActive: () => new Promise(done => { resolve = done; }), activeWhilePending: true }];
  const registry = createPluginRegistry({ dataDir: '/data', plugins, fileSystem });
  assert.equal(registry.isActive('demo.ci'), true, 'what worked before keeps working during startup');
  resolve(false);
  await registry.ready();
  assert.equal(registry.isActive('demo.ci'), false);
  assert.equal(JSON.parse(files.get('/data/plugins.json')).active['demo.ci'], false);

  const offWhilePending = createPluginRegistry({ plugins: [{ manifest: manifest(), defaultActive: () => new Promise(() => {}) }] });
  assert.equal(offWhilePending.isActive('demo.ci'), false);

  const failing = createPluginRegistry({ plugins: [{ manifest: manifest(), defaultActive: async () => { throw new Error('no store'); }, activeWhilePending: true }] });
  await failing.ready();
  assert.equal(failing.isActive('demo.ci'), true, 'a failed check keeps the pending state');
});

test('a choice made while the first-run default is pending wins', async () => {
  let resolve;
  const registry = createPluginRegistry({ plugins: [{ manifest: manifest(), defaultActive: () => new Promise(done => { resolve = done; }) }] });
  await registry.setActive('demo.ci', false);
  resolve(true);
  await registry.ready();
  assert.equal(registry.isActive('demo.ci'), false);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createVectorCache, createSemantic, clusterSignatures, suggestCategories, CATEGORY_PROTOTYPES } = require('./semantic');
const { createLocalModel } = require('./localModel');
const { createLogCache } = require('../awsLogCache');

const DIMS = 4096;
/** Deterministic bag-of-words embedding: texts sharing words are close. No download. */
function bagOfWords(text) {
  const vector = new Float32Array(DIMS);
  for (const word of String(text).toLowerCase().match(/[a-z]{3,}/g) || []) {
    let h = 0;
    for (const char of word) h = (h * 31 + char.charCodeAt(0)) >>> 0;
    vector[h % DIMS] += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
}

function fakeModel({ ready = true } = {}) {
  const embedded = [];
  return {
    MODEL_ID: 'fake/bow',
    embedded,
    isReady: () => ready,
    status: () => ({ state: ready ? 'ready' : 'idle' }),
    async embed(texts) { embedded.push(...texts); return texts.map(bagOfWords); },
  };
}

const sig = (signature, occurrences, category = 'other_error', extra = {}) => ({ signature, occurrences, category, level: 'error', ...extra });

test('clusters merge signatures that say the same thing and keep the rest apart', () => {
  const signatures = [
    sig('database connection refused while connecting to orders database', 10, 'database'),
    sig('connection refused while connecting to orders database replica', 4, 'connection'),
    sig('payment card declined by bank', 3),
    sig('rate limit exceeded on messages api', 7, 'throttling'),
  ];
  const clusters = clusterSignatures(signatures, signatures.map(s => bagOfWords(s.signature)));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].occurrences, 14);
  assert.deepEqual(clusters[0].signatures.map(s => s.occurrences), [10, 4]);
  assert.ok(clusters[0].minScore >= 0.6);
});

test('suggestions only cover uncategorized signatures with a clear best category', () => {
  const prototypes = Object.fromEntries(Object.entries(CATEGORY_PROTOTYPES).map(([category, text]) => [category, bagOfWords(text)]));
  const signatures = [
    sig('upstream rate limit exceeded too many requests', 5),
    sig('access denied not authorized for bucket', 2, 'other_warning'),
    sig('timed out but already categorized', 9, 'timeout'),
    sig('tarjeta rechazada por el banco', 1),
  ];
  const suggestions = suggestCategories(signatures, signatures.map(s => bagOfWords(s.signature)), prototypes);
  assert.deepEqual(suggestions.map(s => [s.signature.split(' ')[0], s.category]), [['upstream', 'throttling'], ['access', 'access_denied']]);
  assert.ok(suggestions.every(s => s.score >= 0.4));
});

test('the vector cache embeds each text once and survives a new cache instance', async () => {
  const db = new Database(':memory:');
  const model = fakeModel();
  const cache = createVectorCache({ database: () => db, model });
  const first = await cache.vectors(['alpha error', 'beta error', 'alpha error'])
  assert.equal(model.embedded.length, 2);
  assert.deepEqual([...first[0]], [...first[2]]);
  const again = await createVectorCache({ database: () => db, model }).vectors(['beta error', 'gamma'])
  assert.deepEqual(model.embedded, ['alpha error', 'beta error', 'gamma']);
  assert.ok(Math.abs(again[0].reduce((sum, value) => sum + value * value, 0) - 1) < 1e-5);
});

test('semantic search ranks signatures across groups and analyze waits for a ready model', async () => {
  const db = new Database(':memory:');
  const model = fakeModel();
  const semantic = createSemantic({ vectorCache: createVectorCache({ database: () => db, model }), model });
  const results = await semantic.search('database connection refused', [
    { logGroup: '/a', signatures: [sig('connection refused to database host', 3), sig('user not found', 8)] },
    { logGroup: '/b', signatures: [sig('database connection refused on replica', 2, 'database', { sample: 'database connection refused on replica 10.0.0.1' })] },
  ]);
  assert.deepEqual(results.map(r => r.logGroup).sort(), ['/a', '/b']);
  assert.ok(results[0].score >= results[1].score);
  assert.ok(!results.some(r => r.signature === 'user not found'), 'unrelated signatures fall below the minimum score');

  const idle = createSemantic({ vectorCache: createVectorCache({ database: () => db, model: fakeModel({ ready: false }) }), model: fakeModel({ ready: false }) });
  assert.equal(await idle.analyze([sig('x', 1)]), null);
});

test('the local model is opt-in, persists the choice and reports download progress', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-ml-'));
  const calls = [];
  const loader = async () => ({
    env: {},
    pipeline: async (task, id, options) => {
      calls.push([task, id, options.dtype]);
      options.progress_callback({ status: 'progress', file: 'model.onnx', loaded: 50, total: 100 });
      options.progress_callback({ status: 'done', file: 'model.onnx', loaded: 100, total: 100 });
      return async texts => ({ dims: [texts.length, 2], data: Float32Array.from(texts.flatMap(() => [0.6, 0.8])) });
    },
  });
  try {
    const model = createLocalModel({ dataDir, loader });
    assert.equal(model.status().state, 'disabled');
    await assert.rejects(model.embed(['x']), error => error.code === 'ML_DISABLED');
    assert.equal(calls.length, 0, 'nothing is downloaded while disabled');

    model.enable();
    const vectors = await model.embed(['a', 'b']);
    assert.deepEqual(vectors.map(v => [...v].map(n => Math.round(n * 10) / 10)), [[0.6, 0.8], [0.6, 0.8]]);
    assert.deepEqual(calls, [['feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', 'q8']]);
    assert.equal(model.status().state, 'ready');
    assert.equal(model.isReady(), true);

    // A new process remembers that ML is enabled, and loads on first use.
    const restarted = createLocalModel({ dataDir, loader });
    assert.equal(restarted.status().state, 'idle');
    restarted.disable();
    assert.equal(createLocalModel({ dataDir, loader }).status().enabled, false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('log intelligence adds clusters and suggestions when ML is ready, and search spans cached groups', async () => {
  const NOW = Date.UTC(2026, 9, 3, 12);
  const scope = { profileId: 'p1', region: 'us-east-1', logGroup: '/aws/lambda/orders' };
  const model = fakeModel();
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW, ml: model });
  cache.enable(scope);
  await cache.ingest({ ...scope, events: [
    { eventId: '1', timestamp: NOW - 3000, message: 'ERROR database connection refused while connecting to orders database' },
    { eventId: '2', timestamp: NOW - 2000, message: 'ERROR connection refused while connecting to orders database replica' },
    { eventId: '3', timestamp: NOW - 1000, message: 'ERROR upstream rate limit exceeded too many requests' },
  ] });
  const intel = await cache.intelligenceFor(scope);
  assert.equal(intel.ml.state, 'ready');
  assert.ok(Array.isArray(intel.ml.clusters));
  assert.ok(Array.isArray(intel.ml.suggestions));

  const results = await cache.searchSignatures({ profileId: 'p1', region: 'us-east-1', query: 'database connection refused' });
  assert.ok(results.length >= 1);
  assert.equal(results[0].logGroup, '/aws/lambda/orders');
  assert.match(results[0].signature, /connection refused/);

  const off = createLogCache({ dataDir: ':memory:', now: () => NOW, ml: fakeModel({ ready: false }) });
  off.enable(scope);
  await off.ingest({ ...scope, events: [{ eventId: '1', timestamp: NOW - 1000, message: 'ERROR x' }] });
  assert.deepEqual((await off.intelligenceFor(scope)).ml, { state: 'idle' });
  assert.equal((await createLogCache({ dataDir: ':memory:', now: () => NOW }).intelligenceFor(scope)), null);
});

test('embedding text keeps what the error says and drops log plumbing', () => {
  const { embeddingText } = require('./semantic');
  assert.equal(
    embeddingText('<timestamp> ERROR [main] glue.ProcessLauncher (Logging.scala:logError(<n>)): Original failureReason: ServerSelectionTimeoutError: <n>.<n>.<n>.<n>:<n>: No route to host'),
    'Original failure Reason: Server Selection Timeout Error: No route to host',
  );
  // Container runtime JSON with an escaped, colored NestJS line inside, cut like a stored sample.
  const container = '{"time":"2026-10-02T17:17:28.929Z","stream":"stdout","_p":"F","log":"\u001b[32m[Nest] 20  - \u001b[39m10/02/2026, 5:17:28 PM \u001b[32m    LOG\u001b[39m \u001b[38;5;3m[SmtpServices:matchString] \u001b[39mBuscando patrón en el email';
  assert.equal(embeddingText(container), 'Buscando patrón en el email');
  assert.equal(
    embeddingText('{"caller":"internal/base_exporter.go:116","msg":"Exporting failed. Rejecting data.","error":"Permanent error: AccessDeniedException: User is not authorized"}'),
    'Exporting failed. Rejecting data.. Permanent error: Access Denied Exception: User is not authorized',
  );
  assert.equal(embeddingText('E1002 16:19:46.927938 1 reflector.go:158 Failed to watch *v1.VolumeSnapshotClass'), 'Failed to watch v .Volume Snapshot Class');
});

test('centroid clusters do not chain different errors through an intermediate one', () => {
  // a ~ b and b ~ c pairwise, but a and c are different: single link would merge all three.
  const v = (x, y) => normalizeTest([x, y]);
  function normalizeTest(values) { const n = Math.hypot(...values); return Float32Array.from(values.map(value => value / n)); }
  const signatures = [sig('a', 10), sig('b', 5), sig('c', 4)];
  const angle = degrees => v(Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180));
  const vectors = [angle(0), angle(45), angle(90)]; // cos(a,b)=cos(b,c)=0.71, cos(a,c)=0
  const clusters = clusterSignatures(signatures, vectors, { threshold: 0.65 });
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].signatures.map(s => s.signature), ['a', 'b']);
  assert.equal(clusters[0].size, 2);
});

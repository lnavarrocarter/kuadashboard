'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, activeProviders, normalizeProviderCatalog, providerAlternation, providerIds } = require('./providers');
const { BUILTIN_PROVIDERS } = require('./kua/applicationContract');
const { TASK_PROVIDERS } = require('./backgroundTaskRegistry');
const { APM_PROVIDERS } = require('./apm/database');

const entry = (overrides = {}) => ({ id: 'demo', label: 'Demo', plugin: null, view: true, cloudApi: false, advisor: false, observability: false, scopes: true, ...overrides });

test('the shipped catalog keeps the providers KUA had before the registry', () => {
  assert.deepEqual([...providerIds()].sort(), ['aws', 'gcp', 'generic', 'kubernetes', 'vercel']);
  assert.deepEqual(providerIds('cloudApi'), ['aws', 'gcp', 'vercel']);
  assert.deepEqual(providerIds('advisor'), ['kubernetes', 'aws', 'gcp', 'vercel']);
  assert.deepEqual(providerIds('observability'), ['aws', 'gcp', 'vercel', 'generic']);
  assert.deepEqual(providerIds('scopes'), ['kubernetes', 'aws', 'gcp', 'vercel']);
  assert.equal(providerAlternation('cloudApi'), 'aws|gcp|vercel');
  assert.throws(() => providerIds('unknown'), /Unknown provider flag/);
});

test('the lists that used to be enums read from the catalog', () => {
  assert.deepEqual([...BUILTIN_PROVIDERS], [...providerIds()]);
  assert.deepEqual([...APM_PROVIDERS], [...providerIds()]);
  for (const id of providerIds('view')) assert.ok(TASK_PROVIDERS.has(id), id);
  assert.ok(!TASK_PROVIDERS.has('generic'));
});

test('an invalid catalog is refused', () => {
  const catalog = providers => ({ version: 1, providers });
  assert.throws(() => normalizeProviderCatalog({ version: 2, providers: [] }), /version 1/);
  assert.throws(() => normalizeProviderCatalog(catalog([entry(), entry()])), /Duplicate provider/);
  assert.throws(() => normalizeProviderCatalog(catalog([entry({ id: 'Bad id' })])), /Invalid provider id/);
  assert.throws(() => normalizeProviderCatalog(catalog([entry({ label: ' ' })])), /needs a label/);
  assert.throws(() => normalizeProviderCatalog(catalog([entry({ cloudApi: 'yes' })])), /cloudApi as true or false/);
  assert.throws(() => normalizeProviderCatalog(catalog([entry({ plugin: 'Bad plugin' })])), /invalid plugin/);
  assert.ok(Object.isFrozen(normalizeProviderCatalog(catalog([entry()]))[0]));
});

test('a provider of a plugin follows the plugin, and one whose plugin is not registered stays on', () => {
  const catalog = normalizeProviderCatalog({ version: 1, providers: [entry({ id: 'aws' }), entry({ plugin: 'demo.plugin' }), entry({ id: 'later', plugin: 'later.plugin' })] });
  const registry = on => ({ manifests: () => [{ id: 'demo.plugin' }], isActive: id => id === 'demo.plugin' && on });
  const states = on => Object.fromEntries(activeProviders(registry(on), catalog).map(provider => [provider.id, provider.active]));
  assert.deepEqual(states(false), { aws: true, demo: false, later: true });
  assert.deepEqual(states(true), { aws: true, demo: true, later: true });
  assert.ok(activeProviders(null, PROVIDERS).every(provider => provider.active));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPluginsRouter } = require('./plugins');
const { createPluginRegistry } = require('../lib/plugins/pluginRegistry');
const { PROVIDERS, activeProviders } = require('../lib/providers');

const manifest = {
  manifestVersion: 1, id: 'demo.ci', name: 'Demo CI', description: 'Reads builds.', version: '1.0.0', contractVersion: 1, category: 'ci-cd',
  capabilities: { discovery: false, enrichment: false, relationshipEvidence: false, telemetry: false, historicalSearch: true, findings: false },
  resourceTypes: [], credentialFields: [], reads: ['Builds'], cost: { level: 'free', summary: 'Read-only.' },
};

test('/api/plugins lists plugins and turns them on and off, with an audit entry', async () => {
  const audit = [];
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', createPluginsRouter({ registry: createPluginRegistry({ plugins: [{ manifest }] }), auditLog: { log: entry => audit.push(entry) } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, () => resolve(instance)); });
  const request = async (path, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    const listed = await request('/api/plugins');
    assert.equal(listed.body.plugins[0].manifest.id, 'demo.ci');
    assert.equal(listed.body.plugins[0].active, false);
    assert.equal((await request('/api/plugins/demo.ci', { method: 'PUT', body: { active: true } })).body.active, true);
    assert.equal(audit[0].action, 'Plugin turned on');
    assert.equal((await request('/api/plugins/demo.ci', { method: 'PUT', body: { active: 'yes' } })).status, 400);
    assert.equal((await request('/api/plugins/missing', { method: 'PUT', body: { active: true } })).status, 404);
  } finally { server.close(); }
});

test('/api/plugins/providers lists the catalog with the providers of a plugin that is off as inactive', async () => {
  const registry = createPluginRegistry({ plugins: [{ manifest }] });
  const catalog = [
    { id: 'aws', label: 'AWS', plugin: null, view: true, cloudApi: true, advisor: true, observability: true, scopes: true },
    { id: 'demo', label: 'Demo', plugin: 'demo.ci', view: true, cloudApi: false, advisor: false, observability: false, scopes: true },
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', createPluginsRouter({ registry, providers: () => activeProviders(registry, catalog) }));
  const server = await new Promise(resolve => { const instance = app.listen(0, () => resolve(instance)); });
  const read = async () => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/plugins/providers`)).json()).providers;
  try {
    assert.deepEqual((await read()).map(provider => [provider.id, provider.active]), [['aws', true], ['demo', false]]);
    await registry.setActive('demo.ci', true);
    assert.equal((await read()).find(provider => provider.id === 'demo').active, true);
  } finally { server.close(); }
});

test('/api/plugins/providers serves the shipped catalog by default', async () => {
  const app = express();
  app.use('/api/plugins', createPluginsRouter({ registry: createPluginRegistry({ plugins: [] }) }));
  const server = await new Promise(resolve => { const instance = app.listen(0, () => resolve(instance)); });
  try {
    const { providers } = await (await fetch(`http://127.0.0.1:${server.address().port}/api/plugins/providers`)).json();
    assert.deepEqual(providers.map(provider => provider.id), PROVIDERS.map(provider => provider.id));
    assert.ok(providers.every(provider => provider.active));
  } finally { server.close(); }
});

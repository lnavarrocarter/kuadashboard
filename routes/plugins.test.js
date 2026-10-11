'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPluginsRouter } = require('./plugins');
const { createPluginRegistry } = require('../lib/plugins/pluginRegistry');

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

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildKuaAppBundle,
  validateKuaAppBundle,
} = require('./kuaAppBundle');

function fixture() {
  return buildKuaAppBundle({
    application: {
      id: 'application-1', provider: 'aws', profileId: 'local:secret-profile', region: 'us-east-1',
      name: 'Orders', environment: 'production', team: 'Platform', pollingEnabled: true,
      thresholds: { apiKey: 'must-not-export' },
    },
    project: {
      id: 'project-1', profileId: 'local:secret-profile', name: 'Orders architecture',
      description: 'Architecture', automaticEdgeThreshold: 0.9,
    },
    graph: {
      revision: 2,
      document: {
        projectId: 'project-1',
        scopes: [{ id: 'scope-1', profileId: 'local:secret-profile', region: 'us-east-1' }],
        nodes: [{ id: 'node-1', name: 'API', arn: 'arn:aws:lambda:us-east-1:123:function:orders', secret: 'nope', evidence: [{ type: 'log_reference', sample: 'Authorization: secret-token' }] }],
        edges: [],
      },
    },
    snapshots: [{
      id: 'snapshot-1', version: 1, name: 'Initial', sourceRevision: 1,
      document: { projectId: 'project-1', nodes: [{ id: 'node-1', name: 'API' }] },
    }],
    changes: [{
      id: 'change-1', revision: 1, type: 'node.upsert', author: 'local:secret-profile',
      previousState: { token: 'nope' }, newState: { payload: 'nope' },
    }],
    resources: [{
      id: 'resource-1', profileId: 'local:secret-profile', provider: 'aws',
      nativeIdentifier: 'arn:aws:lambda:us-east-1:123:function:orders', resourceType: 'lambda',
      displayName: 'Orders API', identityKey: 'aws/arn:orders',
    }],
    relationships: [{
      id: 'relationship-1', sourceResourceId: 'resource-1', targetResourceId: 'resource-2',
      relationType: 'invokes', evidence: [{ type: 'template', sourceId: 'stack-1', values: ['raw-payload'] }],
    }],
    syncStatus: { lastError: 'credential failed', divergentResourceCount: 1 },
  }, { now: () => Date.parse('2026-08-27T00:00:00.000Z') });
}

test('buildKuaAppBundle creates a portable sanitized bundle', () => {
  const bundle = fixture();
  assert.equal(bundle.kind, 'KUAAppBundle');
  assert.equal(bundle.version, 1);
  assert.equal(bundle.application.sourceId, 'application-1');
  assert.equal(bundle.application.profileId, undefined);
  assert.equal(bundle.application.thresholds, undefined);
  assert.equal(bundle.architecture.graph.document.scopes[0].profileId, undefined);
  assert.equal(bundle.architecture.graph.document.nodes[0].secret, undefined);
  assert.equal(bundle.architecture.graph.document.nodes[0].evidence[0].sample, undefined);
  assert.equal(bundle.architecture.changes[0].previousState, undefined);
  assert.equal(bundle.registry.resources[0].profileId, undefined);
  assert.equal(bundle.registry.relationships[0].evidence[0].values, undefined);
  assert.equal(bundle.registry.syncStatus.lastError, undefined);
});

test('validateKuaAppBundle rejects unsafe or unsupported bundle envelopes', () => {
  const bundle = fixture();
  assert.doesNotThrow(() => validateKuaAppBundle(bundle));
  assert.throws(() => validateKuaAppBundle({ ...bundle, version: 99 }), /Unsupported KUAAppBundle version/);
  assert.throws(() => validateKuaAppBundle({ ...bundle, mode: 'raw' }), /Only sanitized/);
  assert.throws(() => validateKuaAppBundle({
    ...bundle,
    application: { ...bundle.application, provider: 'unsupported' },
  }), /Unsupported application provider/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApplicationRegistryService, resourceOwnProvider } = require('./applicationRegistryService');

function fixture(now = Date.UTC(2026, 7, 4, 12)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-registry-'));
  const database = new ApmDatabase({ filePath: path.join(directory, 'apm.sqlite3'), now: () => now });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  return {
    database,
    architectureDatabase,
    registry: new ApplicationRegistryService({ database, architectureDatabase }),
    close() {
      database.close();
      architectureDatabase.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('resourceOwnProvider derives identity from the resource type, not the parent application provider', () => {
  assert.equal(resourceOwnProvider({ type: 'kubernetes', provider: 'aws' }), 'kubernetes');
  assert.equal(resourceOwnProvider({ type: 'kubernetes', provider: 'gcp' }), 'kubernetes');
  assert.equal(resourceOwnProvider({ type: 'gcp-cloud-run', provider: 'generic' }), 'gcp');
  assert.equal(resourceOwnProvider({ type: 'gcp-function', provider: 'generic' }), 'gcp');
  assert.equal(resourceOwnProvider({ type: 'vercel-project', provider: 'generic' }), 'vercel');
  assert.equal(resourceOwnProvider({ type: 'lambda', provider: 'aws' }), 'aws');
});

test('reconcile() applies at most one Architecture revision even when it both projects a missing APM resource and stamps registry ids', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const revisionBeforeReconcile = subject.architectureDatabase.getGraph(project.id).revision;

    // A resource with no matching graph node yet forces reconcile() to both add a node (missingNodes)
    // and stamp its registryResourceId in the same call, previously two separate saveGraph calls.
    subject.database.addResource(application.id, {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:checkout',
      arn: 'arn:aws:lambda:us-east-1:123:function:checkout', name: 'checkout', associationSource: 'manual',
    });

    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    const graph = subject.architectureDatabase.getGraph(project.id);
    assert.equal(graph.revision, revisionBeforeReconcile + 1, 'reconcile() must apply exactly one revision, not one per internal mutation');
    assert.equal(graph.document.nodes.length, 1);
    assert.ok(graph.document.nodes[0].registryResourceId, 'the projected node must already carry its registry id after a single revision');
    assert.equal(result.resources.length, 1);
    assert.equal(result.syncStatus.lastError, null);
    assert.ok(result.syncStatus.lastSuccessAt);
  } finally {
    subject.close();
  }
});

test('reconcile() records a sync failure diagnostic without swallowing the underlying error', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    subject.database.addResource(application.id, {
      type: 'lambda', key: 'arn:aws:lambda:us-east-1:123:function:checkout',
      arn: 'arn:aws:lambda:us-east-1:123:function:checkout', name: 'checkout', associationSource: 'manual',
    });
    const originalSaveGraph = subject.architectureDatabase.saveGraph.bind(subject.architectureDatabase);
    subject.architectureDatabase.saveGraph = () => { throw new Error('boom'); };

    try {
      assert.throws(() => subject.registry.reconcile(subject.database.getApplication(application.id)), /boom/);
    } finally {
      subject.architectureDatabase.saveGraph = originalSaveGraph;
    }

    const status = subject.database.getRegistrySyncStatus(application.id);
    assert.equal(status.lastError, 'boom');
    assert.ok(status.lastErrorAt);
  } finally {
    subject.close();
  }
});

test('reconcile() never counts an Architecture-only resource type (S3, SNS, DynamoDB...) as divergent, since APM cannot observe it', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({
      profileId: 'local:dev', region: 'us-east-1', name: 'orders',
    });
    const project = subject.architectureDatabase.createProject({ profileId: 'local:dev', name: 'orders-architecture' });
    subject.database.updateArchitectureProjectLink(application.id, project.id);
    const graph = subject.architectureDatabase.getGraph(project.id);
    // apm_resources has no 's3'/'sns'/'dynamodb'/... resource_type support (CHECK constraint), so a
    // resource discovered ONLY by Architecture in one of these types can never gain a second source.
    subject.architectureDatabase.saveGraph(project.id, {
      ...graph.document,
      nodes: [{
        id: 'node-bucket', name: 'orders-bucket', provider: 'aws', accountId: '123456789012', region: 'us-east-1',
        resourceType: 's3', kind: 'AWS::S3::Bucket', nativeId: 'arn:aws:s3:::orders-bucket', arn: 'arn:aws:s3:::orders-bucket',
      }],
    }, { expectedRevision: graph.revision });

    const result = subject.registry.reconcile(subject.database.getApplication(application.id));

    assert.equal(result.resources.length, 1);
    assert.deepEqual(result.resources[0].sources, ['architecture_node']);
    assert.equal(result.syncStatus.divergentResourceCount, 0, 'a structurally single-source resource type must never be reported as divergent');
  } finally {
    subject.close();
  }
});

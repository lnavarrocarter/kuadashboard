'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { normalizeScope } = require('./applicationContract');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { resourceSignalStates } = require('./resourceSignalState');

const NOW = Date.UTC(2026, 9, 8, 12);

function fixture() {
  let clock = NOW;
  const database = new ApmDatabase({ filePath: ':memory:', now: () => clock });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const registry = new ApplicationRegistryService({ database, architectureDatabase });
  return {
    database, registry,
    at: time => { clock = time; },
    close() { database.close(); architectureDatabase.close(); },
  };
}

const lambda = name => ({ provider: 'aws', type: 'lambda', key: `arn:aws:lambda:us-east-1:111111111111:function:${name}`, arn: `arn:aws:lambda:us-east-1:111111111111:function:${name}`, name });
const states = (subject, application) => {
  const current = subject.database.getApplication(application.id);
  const resources = subject.database.listRegistryResources(application.id);
  const result = resourceSignalStates({ database: subject.database, application: current, resources, now: NOW });
  return Object.fromEntries(resources.map(resource => [resource.displayName, result.get(resource.id).state]));
};

test('a legacy application reports collected, missing, stale, disabled and unsupported signals per resource (#152)', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ provider: 'aws', profileId: 'local:prod', region: 'us-east-1', name: 'Orders', pollingEnabled: true });
    const current = () => subject.database.getApplication(application.id);
    const fresh = subject.registry.attachResource(current(), lambda('fresh')).resource;
    const old = subject.registry.attachResource(current(), lambda('old')).resource;
    subject.registry.attachResource(current(), lambda('waiting'));
    const off = subject.registry.attachResource(current(), lambda('off')).resource;
    subject.database.updateResource(off.id, { enabled: false });
    // A plugin provider KUA cannot collect, only seen in the registry.
    subject.database.upsertRegistryResource({ id: 'kua-resource:zabbix', identityKey: 'zabbix-host', provider: 'zabbix', scopeId: 'monitoring', location: '', nativeIdentifier: 'host-1', resourceType: 'host', displayName: 'host-1', lineage: [] });
    subject.database.addRegistryMembership({ applicationId: application.id, resourceId: 'kua-resource:zabbix', sourceKind: 'architecture_node', sourceReference: 'p:n' });

    subject.at(NOW - 10 * 60 * 1000);
    subject.database.upsertMetricBucket({ resourceId: fresh.id, bucketStart: NOW - 10 * 60 * 1000, metricName: 'Invocations', count: 1, source: 'cloudwatch' });
    subject.at(NOW - 26 * 60 * 60 * 1000);
    subject.database.upsertMetricBucket({ resourceId: old.id, bucketStart: NOW - 26 * 60 * 60 * 1000, metricName: 'Invocations', count: 1, source: 'cloudwatch' });

    assert.deepEqual(states(subject, application), {
      fresh: 'current', old: 'stale', waiting: 'no_data', off: 'disabled', 'host-1': 'unsupported',
    });

    // A failed last collection is an error, not an empty result.
    const run = subject.database.startCollectionRun({ applicationId: application.id, profileId: 'local:prod', region: 'us-east-1', trigger: 'scheduled' });
    subject.database.finishCollectionRun(run, { status: 'failed', errorCode: 'AccessDenied' });
    assert.equal(states(subject, application).fresh, 'error');
    subject.database.setApplicationPollingEnabled(application.id, false);
    assert.equal(states(subject, application).fresh, 'disabled');
  } finally { subject.close(); }
});

test('a resource of an application without provider has no connection until its scope is bound and verified', () => {
  const subject = fixture();
  try {
    const application = subject.database.createApplication({ name: 'Checkout' });
    const scope = normalizeScope({ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' });
    subject.database.addApplicationScope(application.id, scope);
    subject.registry.attachResource(subject.database.getApplication(application.id), { ...lambda('api'), scopeId: '111111111111', location: 'us-east-1' });
    assert.equal(states(subject, application).api, 'no_connection');

    subject.database.setScopeBinding(application.id, scope.key, { profileId: 'local:prod', status: 'verified' });
    // Collection of an application without provider starts off.
    assert.equal(states(subject, application).api, 'disabled');
  } finally { subject.close(); }
});

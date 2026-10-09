'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { ApmScheduler } = require('../apm/scheduler');
const { markGone, markPresent, readPresence } = require('../apm/resourcePresence');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { resourceSignalStates } = require('./resourceSignalState');
const { createResourceObserver, nameStem } = require('./resourceObserver');

const CONTEXT = 'arn:aws:eks:us-east-1:111111111111:cluster/dev';
const GONE_AT = Date.UTC(2026, 9, 8, 8, 20);

function fixture({ workloads = [], failing = false } = {}) {
  const database = new ApmDatabase({ filePath: ':memory:', now: () => GONE_AT });
  const architectureDatabase = new ArchitectureDatabase({ filePath: ':memory:' });
  const registry = new ApplicationRegistryService({ database, architectureDatabase });
  const calls = [];
  const kubeLister = {
    async listWorkloads(input) {
      calls.push(input);
      if (failing) throw new Error('The session of the cluster expired');
      return workloads;
    },
  };
  const application = database.createApplication({ name: 'Desarrollo' });
  const deployment = name => database.attachResource(application.id, {
    provider: 'kubernetes', type: 'kubernetes', kind: 'Deployment', key: `${CONTEXT}/backend360/Deployment/${name}`,
    kubeContext: CONTEXT, namespace: 'backend360', name, associationSource: 'architecture',
  }).resource;
  return {
    database, registry, calls, application, deployment,
    observer: createResourceObserver({ database, registry, kubeLister, now: () => GONE_AT }),
    current: () => database.getApplication(application.id),
    close() { database.close(); architectureDatabase.close(); },
  };
}

test('name stems drop a release version or a generated hash', () => {
  assert.equal(nameStem('attencion-3.9.1'), 'attencion');
  assert.equal(nameStem('planificador-libros-1.0.6'), 'planificador-libros');
  assert.equal(nameStem('cotizador-libros-7fcb4b5f48-82cpr'), 'cotizador-libros');
  assert.equal(nameStem('cobranza-ia'), 'cobranza-ia');
});

test('a released workload that no longer exists is gone, and its successor is suggested with evidence (#236)', async () => {
  const subject = fixture({
    workloads: [
      { name: 'attencion-3.9.2', labels: { app: 'attencion' }, createdAt: new Date(GONE_AT - 3600000).toISOString() },
      { name: 'attencion-3.9.3-rc1', labels: {}, createdAt: '2025-01-01T00:00:00.000Z' },
      { name: 'attencion-canary', labels: {}, createdAt: '2025-01-01T00:00:00.000Z' },
      { name: 'email-3.9.2', labels: { app: 'email' }, createdAt: new Date(GONE_AT).toISOString() },
      { name: 'cobranza-ia', labels: { app: 'cobranza-ia' } },
    ],
  });
  try {
    const old = subject.deployment('attencion-3.9.1');
    subject.deployment('cobranza-ia');
    markPresent(subject.database, old.id, { labels: { app: 'attencion', 'pod-template-hash': 'x' }, now: GONE_AT - 86400000 });
    assert.deepEqual(readPresence(subject.database, old.id).labels, { app: 'attencion' }, 'only identity labels are kept');
    markGone(subject.database, old.id, { now: GONE_AT });
    markGone(subject.database, old.id, { now: GONE_AT + 60000 });
    assert.equal(readPresence(subject.database, old.id).goneSince, new Date(GONE_AT).toISOString(), 'the first time it was missing is kept');

    subject.registry.reconcile(subject.current());
    const states = resourceSignalStates({ database: subject.database, application: subject.current(), resources: subject.database.listRegistryResources(subject.application.id), now: GONE_AT });
    assert.ok([...states.values()].some(state => state.state === 'gone' && state.goneSince === new Date(GONE_AT).toISOString()));

    const { resources } = await subject.observer.gone(subject.current());
    assert.equal(resources.length, 1);
    assert.equal(resources[0].name, 'attencion-3.9.1');
    assert.deepEqual(resources[0].successors.map(item => [item.name, item.confidence]), [['attencion-3.9.2', 'high'], ['attencion-3.9.3-rc1', 'medium']]);
    assert.deepEqual(resources[0].successors[0].evidence.map(item => item.type), ['same_label', 'same_name_stem', 'created_around_removal']);
    assert.deepEqual(subject.calls[0], { kubeContext: CONTEXT, namespace: 'backend360', kind: 'deployment' });
  } finally { subject.close(); }
});

test('replacing attaches the successor and detaches the missing resource; ignoring hides it (#236)', async () => {
  const subject = fixture({ workloads: [{ name: 'attencion-3.9.2', labels: { app: 'attencion' } }] });
  try {
    const old = subject.deployment('attencion-3.9.1');
    const other = subject.deployment('email-3.9.1');
    markGone(subject.database, old.id, { now: GONE_AT });
    markGone(subject.database, other.id, { now: GONE_AT });

    await assert.rejects(subject.observer.replace(subject.current(), old.id, 'attencion-9.9.9'), error => error.code === 'SUCCESSOR_NOT_FOUND');
    await assert.rejects(subject.observer.replace(subject.current(), old.id, 'attencion-3.9.2', { expectedRevision: 0 }), error => error.code === 'REVISION_CONFLICT');
    const result = await subject.observer.replace(subject.current(), old.id, 'attencion-3.9.2');
    assert.deepEqual([result.replaced, result.by], ['attencion-3.9.1', 'attencion-3.9.2']);
    const names = subject.database.listResources(subject.application.id).map(resource => resource.name).sort();
    assert.deepEqual(names, ['attencion-3.9.2', 'email-3.9.1']);
    assert.equal(subject.database.listResources(subject.application.id).find(resource => resource.name === 'attencion-3.9.2').key, `${CONTEXT}/backend360/Deployment/attencion-3.9.2`);
    assert.equal(subject.database.listRegistryDetachmentKeys(subject.application.id).length, 1, 'the missing resource stays out of the application');

    subject.observer.ignore(subject.current(), other.id);
    assert.deepEqual((await subject.observer.gone(subject.current())).resources, []);
    assert.throws(() => subject.observer.ignore(subject.current(), 'missing'), error => error.code === 'RESOURCE_NOT_FOUND');
  } finally { subject.close(); }
});

test('a cluster that cannot be read still lists what is missing, with the reason', async () => {
  const subject = fixture({ failing: true });
  try {
    markGone(subject.database, subject.deployment('sms-3.9.1').id, { now: GONE_AT });
    const [item] = (await subject.observer.gone(subject.current())).resources;
    assert.deepEqual([item.name, item.successors, item.error], ['sms-3.9.1', [], 'The session of the cluster expired']);
  } finally { subject.close(); }
});

test('a missing resource does not make the collection partial; seeing it again clears it', async () => {
  const subject = fixture();
  try {
    const old = subject.deployment('attencion-3.9.1');
    const present = subject.deployment('cobranza-ia');
    let missing = true;
    const kubeCollector = { collect: async ({ resource }) => (resource.id === old.id && missing ? { status: 'gone', requests: 0 } : { status: 'completed', requests: 0, labels: { app: resource.name } }) };
    const scheduler = new ApmScheduler({ database: subject.database, awsCollector: {}, kubeCollector });
    const { run } = await scheduler.collectApplicationNow(subject.current());
    assert.equal(run.status, 'completed');
    assert.ok(readPresence(subject.database, old.id).goneSince);
    assert.deepEqual(readPresence(subject.database, present.id).labels, { app: 'cobranza-ia' });
    missing = false;
    await scheduler.collectApplicationNow(subject.current());
    assert.equal(readPresence(subject.database, old.id).goneSince, null);
  } finally { subject.close(); }
});

test('pods are observed through their workload, never projected as members of their own', () => {
  const { apmProjectionFromNode } = require('./applicationRegistryService');
  assert.equal(apmProjectionFromNode({}, { id: 'p', name: 'api-7cf9f79d8-zr6jz', provider: 'kubernetes', kind: 'Pod', resourceType: 'pod', kubeContext: CONTEXT, namespace: 'app', discoveryKey: `${CONTEXT}/app/Pod/api-7cf9f79d8-zr6jz` }), null);
  assert.equal(apmProjectionFromNode({}, { id: 'd', name: 'api', provider: 'kubernetes', kind: 'Deployment', resourceType: 'deployment', kubeContext: CONTEXT, namespace: 'app', discoveryKey: `${CONTEXT}/app/Deployment/api` }).type, 'kubernetes');
});

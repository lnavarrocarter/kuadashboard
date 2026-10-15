'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createKubernetesResourceCatalog, backingVolume } = require('./kubernetes');

const CONTEXT = 'arn:aws:eks:us-east-1:111111111111:cluster/dev';

// Fake API clients: each method answers { body: { items } } like @kubernetes/client-node 0.x.
function catalog(responses) {
  const calls = [];
  const Api = name => function FakeApi() {
    return new Proxy({}, {
      get: (_target, method) => async (...args) => {
        calls.push([name, method, ...args]);
        const answer = responses[method];
        if (answer instanceof Error) throw answer;
        return { body: { items: answer || [] } };
      },
    });
  };
  const subject = createKubernetesResourceCatalog({
    configBuilder: () => ({ kubeConfig: { makeApiClient: ApiClass => new ApiClass() } }),
    apis: { apps: Api('apps'), batch: Api('batch'), core: Api('core'), networking: Api('networking') },
  });
  return { subject, calls };
}

test('lists CronJobs, Jobs, PVCs and PVs with the volume behind each PV (#282)', async () => {
  const { subject } = catalog({
    listCronJobForAllNamespaces: [{ metadata: { name: 'billing', namespace: 'jobs' }, spec: { schedule: '0 * * * *' }, status: { lastSuccessfulTime: '2026-10-15T03:00:00Z' } }],
    listJobForAllNamespaces: [{ metadata: { name: 'billing-29000', namespace: 'jobs', ownerReferences: [{ name: 'billing' }] }, status: { succeeded: 1 } }],
    listPersistentVolumeClaimForAllNamespaces: [{ metadata: { name: 'data-postgres-0', namespace: 'db' }, spec: { storageClassName: 'gp3', volumeName: 'pvc-1' }, status: { phase: 'Bound', capacity: { storage: '20Gi' } } }],
    listPersistentVolume: [{ metadata: { name: 'pvc-1' }, spec: { capacity: { storage: '20Gi' }, claimRef: { namespace: 'db', name: 'data-postgres-0' }, csi: { driver: 'ebs.csi.aws.com', volumeHandle: 'vol-0abc123' } }, status: { phase: 'Bound' } }],
  });
  const result = await subject.list({ context: CONTEXT, types: ['cronjob', 'job', 'pvc', 'pv'] });
  const byType = Object.fromEntries(result.items.map(item => [item.type, item]));
  assert.equal(byType.cronjob.details.schedule, '0 * * * *');
  assert.equal(byType.cronjob.details.lastSuccessfulTime, '2026-10-15T03:00:00.000Z');
  assert.equal(byType.job.details.owner, 'billing');
  assert.equal(byType.pvc.details.volumeName, 'pvc-1');
  assert.deepEqual(byType.pv.details.backingVolume, { provider: 'aws', type: 'ebs-volume', volumeId: 'vol-0abc123', driver: 'ebs.csi.aws.com' });
  assert.equal(byType.pv.details.claim, 'db/data-postgres-0');
  assert.deepEqual(byType.pv.attach, { provider: 'kubernetes', type: 'kubernetes', kind: 'PersistentVolume', key: `${CONTEXT}//PersistentVolume/pvc-1`, name: 'pvc-1', kubeContext: CONTEXT });
  assert.equal(byType.cronjob.attach.namespace, 'jobs');
});

test('a namespace narrows namespaced kinds; nodes give their EC2 instance; a forbidden kind is reported (#282)', async () => {
  const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
  const { subject, calls } = catalog({
    listNamespacedDeployment: [{ metadata: { name: 'api', namespace: 'web' }, spec: { replicas: 2 }, status: { readyReplicas: 2 } }],
    listNode: [{ metadata: { name: 'ip-10-0-0-1', labels: { 'node.kubernetes.io/instance-type': 'm5.large' } }, spec: { providerID: 'aws:///us-east-1a/i-0abc' } }],
    listNamespacedService: forbidden,
  });
  const result = await subject.list({ context: CONTEXT, namespace: 'web', types: ['deployment', 'node', 'service'] });
  assert.ok(calls.some(([, method, namespace]) => method === 'listNamespacedDeployment' && namespace === 'web'));
  assert.deepEqual(result.items.map(item => [item.type, item.name]), [['deployment', 'api'], ['node', 'ip-10-0-0-1']]);
  assert.equal(result.items[1].details.instanceId, 'i-0abc');
  assert.deepEqual(result.failures, [{ type: 'service', code: 'access_denied' }]);
  await assert.rejects(subject.list({ types: ['pv'] }), error => error.code === 'INVALID');
});

test('backingVolume recognises EBS, GCP persistent disks and other drivers (#282)', () => {
  assert.equal(backingVolume({ spec: { awsElasticBlockStore: { volumeID: 'aws://us-east-1a/vol-0123' } } }).volumeId, 'vol-0123');
  assert.deepEqual(backingVolume({ spec: { csi: { driver: 'pd.csi.storage.gke.io', volumeHandle: 'projects/p/zones/us-central1-a/disks/pvc-9' } } }),
    { provider: 'gcp', type: 'gcp-disk', name: 'projects/p/zones/us-central1-a/disks/pvc-9', driver: 'pd.csi.storage.gke.io' });
  assert.equal(backingVolume({ spec: { csi: { driver: 'efs.csi.aws.com', volumeHandle: 'fs-1' } } }).provider, null);
  assert.equal(backingVolume({ spec: {} }), null);
});

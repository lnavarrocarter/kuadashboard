'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HIGH_COST_THRESHOLD_USD, mapCloudRunService, mapVm, mapSqlInstance, parseMachineType, parseSqlTier,
  estimate, estimateOverviewCosts, assertDeleteConfirmed, validateCreate,
} = require('./gcpResources');

// ── Mapping ──────────────────────────────────────────────────────────────────

test('maps Cloud Run services with container, scaling and revision state', () => {
  const row = mapCloudRunService({
    name: 'projects/p/locations/us-central1/services/api',
    uri: 'https://api-xyz.a.run.app',
    reconciling: false,
    terminalCondition: { state: 'CONDITION_SUCCEEDED' },
    ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
    latestReadyRevision: 'projects/p/locations/us-central1/services/api/revisions/api-00002',
    latestCreatedRevision: 'projects/p/locations/us-central1/services/api/revisions/api-00003',
    updateTime: { seconds: 1767225600 },
    template: {
      scaling: { minInstanceCount: 1, maxInstanceCount: 5 },
      serviceAccount: 'run@p.iam.gserviceaccount.com',
      containers: [{ image: 'gcr.io/p/api:1', resources: { limits: { cpu: '2', memory: '1Gi' } }, ports: [{ containerPort: 8080 }] }],
    },
  });
  assert.equal(row.name, 'api');
  assert.equal(row.region, 'us-central1');
  assert.equal(row.status, 'ready');
  assert.equal(row.cpu, '2');
  assert.equal(row.memory, '1Gi');
  assert.equal(row.ingress, 'internal_only');
  assert.equal(row.latestRevision, 'api-00002');
  assert.equal(row.revisionPending, true);
  assert.equal(row.minInstances, 1);
  assert.equal(row.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('Cloud Run status reflects failed and reconciling services', () => {
  assert.equal(mapCloudRunService({ name: 'a/b/c/r/d/s', terminalCondition: { state: 'CONDITION_FAILED' } }).status, 'failed');
  assert.equal(mapCloudRunService({ name: 'a/b/c/r/d/s', reconciling: true }).status, 'reconciling');
});

test('maps VMs with network, disks, provisioning model and protection', () => {
  const row = mapVm({
    name: 'web-1', zone: 'projects/p/zones/us-central1-a', status: 'RUNNING',
    machineType: 'projects/p/zones/us-central1-a/machineTypes/e2-standard-2', cpuPlatform: 'Intel Broadwell',
    networkInterfaces: [{ networkIP: '10.0.0.2', network: 'global/networks/default', subnetwork: 'regions/us-central1/subnetworks/default', accessConfigs: [{ natIP: '34.1.2.3' }] }],
    disks: [{ boot: true, diskSizeGb: '20', autoDelete: true }, { diskSizeGb: '100', autoDelete: false }],
    scheduling: { provisioningModel: 'SPOT' },
    deletionProtection: true,
    serviceAccounts: [{ email: 'sa@p.iam.gserviceaccount.com' }],
    labels: { env: 'prod' },
  });
  assert.equal(row.zone, 'us-central1-a');
  assert.equal(row.machineType, 'e2-standard-2');
  assert.equal(row.externalIp, '34.1.2.3');
  assert.equal(row.network, 'default');
  assert.equal(row.diskCount, 2);
  assert.equal(row.diskSizeGb, 120);
  assert.equal(row.keptDiskCount, 1);
  assert.equal(row.provisioningModel, 'SPOT');
  assert.equal(row.deletionProtection, true);
});

test('maps Cloud SQL and derives STOPPED from the activation policy', () => {
  const base = {
    name: 'db', databaseVersion: 'POSTGRES_16', region: 'us-central1', state: 'RUNNABLE',
    ipAddresses: [{ type: 'PRIMARY', ipAddress: '34.9.9.9' }, { type: 'PRIVATE', ipAddress: '10.1.0.3' }],
    settings: { tier: 'db-custom-2-7680', availabilityType: 'REGIONAL', dataDiskSizeGb: '50', dataDiskType: 'PD_SSD', backupConfiguration: { enabled: true }, deletionProtectionEnabled: true, activationPolicy: 'ALWAYS' },
  };
  const running = mapSqlInstance(base);
  assert.equal(running.status, 'RUNNING');
  assert.equal(running.publicIp, '34.9.9.9');
  assert.equal(running.privateIp, '10.1.0.3');
  assert.equal(running.storageGb, 50);
  assert.equal(running.backupEnabled, true);
  assert.equal(running.deletionProtection, true);
  assert.equal(mapSqlInstance({ ...base, settings: { ...base.settings, activationPolicy: 'NEVER' } }).status, 'STOPPED');
  assert.equal(mapSqlInstance({ ...base, state: 'MAINTENANCE' }).status, 'MAINTENANCE');
});

// ── Cost estimates ───────────────────────────────────────────────────────────

test('parses machine types and SQL tiers', () => {
  assert.deepEqual(parseMachineType('e2-standard-4'), { family: 'e2', vcpus: 4, memGb: 16 });
  assert.deepEqual(parseMachineType('n2-highcpu-8'), { family: 'n2', vcpus: 8, memGb: 8 });
  assert.deepEqual(parseMachineType('n2-custom-2-4096'), { family: 'n2', vcpus: 2, memGb: 4 });
  assert.deepEqual(parseMachineType('e2-micro'), { shared: true });
  assert.deepEqual(parseSqlTier('db-custom-2-7680'), { vcpus: 2, memGb: 7.5 });
  assert.deepEqual(parseSqlTier('db-f1-micro'), { shared: true });
});

test('VM estimate adds compute, disk and external IP; Spot is cheaper and warned', () => {
  const onDemand = estimate('vm', { machineType: 'e2-standard-2', diskSizeGb: 20, diskType: 'pd-balanced', externalIp: true });
  assert.equal(onDemand.known, true);
  assert.equal(onDemand.items.length, 3);
  assert.ok(onDemand.monthlyUsd > 45 && onDemand.monthlyUsd < 60, `got ${onDemand.monthlyUsd}`);
  const spot = estimate('vm', { machineType: 'e2-standard-2', diskSizeGb: 20, externalIp: true, spot: true });
  assert.ok(spot.monthlyUsd < onDemand.monthlyUsd);
  assert.ok(spot.warnings.some(w => /Spot/.test(w)));
});

test('SQL estimate doubles with high availability', () => {
  const zonal = estimate('sql', { tier: 'db-custom-2-7680', storageGb: 50, availabilityType: 'ZONAL' });
  const regional = estimate('sql', { tier: 'db-custom-2-7680', storageGb: 50, availabilityType: 'REGIONAL' });
  assert.ok(Math.abs(regional.monthlyUsd - zonal.monthlyUsd * 2) < 0.05, `${regional.monthlyUsd} vs 2×${zonal.monthlyUsd}`);
  assert.ok(regional.warnings.some(w => /doubles/.test(w)));
});

test('Cloud Run estimate is zero when scaling to zero and billed 24/7 with min instances', () => {
  assert.equal(estimate('cloudrun', { minInstances: 0 }).monthlyUsd, 0);
  const warm = estimate('cloudrun', { cpu: '1', memory: '512Mi', minInstances: 2 });
  assert.ok(warm.monthlyUsd > 15 && warm.monthlyUsd < 25, `got ${warm.monthlyUsd}`);
  assert.ok(warm.warnings.some(w => /24\/7/.test(w)));
});

test('overview cost estimate aggregates managed resources and keeps unknown prices visible', () => {
  const result = estimateOverviewCosts({
    cloudrun: [{ cpu: '1', memory: '512Mi', minInstances: 2 }],
    vms: [{ machineType: 'e2-small', diskSizeGb: 20, diskType: 'pd-balanced', externalIp: false, provisioningModel: 'SPOT' }],
    sql: [{ tier: 'db-f1-micro', storageGb: 10, storageType: 'PD_SSD', availabilityType: 'ZONAL' }],
  });
  assert.equal(result.source, 'resource-baseline-estimate');
  assert.equal(result.modeledResources, 3);
  assert.equal(result.unknownResources, 0);
  assert.ok(result.monthlyBaseline > 0);
  assert.deepEqual(result.byService.map(item => item.id), ['cloudrun', 'vms', 'sql']);

  const partial = estimateOverviewCosts({ vms: [{ machineType: 'a3-megagpu-8g', diskSizeGb: 10 }] });
  assert.equal(partial.modeledResources, 0);
  assert.equal(partial.unknownResources, 1);
  assert.equal(partial.monthlyBaseline, null);
});

test('flags high-cost estimates and unknown machine types', () => {
  assert.equal(estimate('vm', { machineType: 'n2-standard-16' }).highCost, true);
  assert.equal(estimate('vm', { machineType: 'e2-micro' }).highCost, false);
  const unknown = estimate('vm', { machineType: 'a3-megagpu-8g' });
  assert.equal(unknown.known, false);
  assert.throws(() => estimate('bucket', {}), /Unknown resource kind/);
});

// ── Delete confirmation ──────────────────────────────────────────────────────

test('delete requires the exact resource name typed back', () => {
  assert.throws(() => assertDeleteConfirmed('prod-db', {}), /Type the resource name "prod-db"/);
  assert.throws(() => assertDeleteConfirmed('prod-db', { confirmName: 'prod' }), e => e.code === 400);
  assert.doesNotThrow(() => assertDeleteConfirmed('prod-db', { confirmName: 'prod-db' }));
});

// ── Create validation ────────────────────────────────────────────────────────

const VM = { name: 'web-1', zone: 'us-central1-a', machineType: 'e2-small', diskSizeGb: 10 };

test('create requires typed name and cost acknowledgement', () => {
  assert.throws(() => validateCreate('vm', VM), /confirm the creation/);
  assert.throws(() => validateCreate('vm', { ...VM, confirmName: 'web-1' }), /acknowledge that this resource generates costs/);
  const { spec, estimate: cost } = validateCreate('vm', { ...VM, confirmName: 'web-1', acknowledgeCost: true });
  assert.equal(spec.imageFamily, 'debian-12');
  assert.equal(spec.externalIp, true);
  assert.equal(cost.known, true);
});

test('high-cost creates need a second acknowledgement', () => {
  const big = { ...VM, machineType: 'n2-standard-16', confirmName: 'web-1', acknowledgeCost: true };
  assert.ok(estimate('vm', big).monthlyUsd >= HIGH_COST_THRESHOLD_USD);
  assert.throws(() => validateCreate('vm', big), /high-cost acknowledgement/);
  assert.doesNotThrow(() => validateCreate('vm', { ...big, acknowledgeHighCost: true }));
});

test('create rejects invalid names, zones and specs', () => {
  const ok = { confirmName: 'x', acknowledgeCost: true };
  assert.throws(() => validateCreate('vm', { ...VM, name: 'Web_1', ...ok }), /Invalid vm name/);
  assert.throws(() => validateCreate('vm', { ...VM, zone: 'us-central1', confirmName: 'web-1', acknowledgeCost: true }), /zone/);
  assert.throws(() => validateCreate('vm', { ...VM, diskSizeGb: 5, confirmName: 'web-1', acknowledgeCost: true }), /Disk size/);
  assert.throws(() => validateCreate('cloudrun', { name: 'api', region: 'us-central1', image: 'not an image', confirmName: 'api', acknowledgeCost: true }), /container image/);
  assert.throws(() => validateCreate('cloudrun', { name: 'api', region: 'us-central1', image: 'gcr.io/p/api:1', minInstances: 3, maxInstances: 2, confirmName: 'api', acknowledgeCost: true }), /Max instances/);
  assert.throws(() => validateCreate('sql', { name: 'db', region: 'us-central1', databaseVersion: 'POSTGRES_16', tier: 'db-f1-micro', rootPassword: 'short', confirmName: 'db', acknowledgeCost: true }), /root password/);
});

test('SQL create defaults to backups on and deletion protection on', () => {
  const { spec } = validateCreate('sql', {
    name: 'db', region: 'us-central1', databaseVersion: 'POSTGRES_16', tier: 'db-f1-micro',
    rootPassword: 'a-long-enough-password', confirmName: 'db', acknowledgeCost: true,
  });
  assert.equal(spec.backupEnabled, true);
  assert.equal(spec.deletionProtection, true);
  assert.equal(spec.availabilityType, 'ZONAL');
});

test('Cloud Run create keeps the service private unless explicitly public', () => {
  const body = { name: 'api', region: 'us-central1', image: 'us-docker.pkg.dev/cloudrun/container/hello', confirmName: 'api', acknowledgeCost: true };
  assert.equal(validateCreate('cloudrun', body).spec.allowUnauthenticated, false);
  assert.equal(validateCreate('cloudrun', { ...body, allowUnauthenticated: 'true' }).spec.allowUnauthenticated, false);
  assert.equal(validateCreate('cloudrun', { ...body, allowUnauthenticated: true }).spec.allowUnauthenticated, true);
});

// ── Presets ──────────────────────────────────────────────────────────────────

test('presets list real zones per region and price each machine/tier from the same table', () => {
  const { createPresets } = require('./gcpResources');
  const p = createPresets();
  const east = p.locations.find(l => l.region === 'us-east1');
  assert.deepEqual(east.zones, ['us-east1-b', 'us-east1-c', 'us-east1-d']);   // no "-a" in us-east1
  const micro = p.vm.find(x => x.value === 'e2-micro');
  assert.equal(micro.monthlyUsd, estimate('vm', { machineType: 'e2-micro', diskSizeGb: 0, externalIp: false }).items[0].monthlyUsd);
  assert.ok(p.vm.every(x => typeof x.monthlyUsd === 'number' && x.specs && x.label));
  assert.ok(p.sql.every(x => typeof x.monthlyUsd === 'number'));
  // Every preset must pass create validation (no preset the backend would reject)
  for (const vm of p.vm) {
    assert.doesNotThrow(() => validateCreate('vm', { name: 'x1', zone: 'us-central1-a', machineType: vm.value, confirmName: 'x1', acknowledgeCost: true, acknowledgeHighCost: true }));
  }
  for (const tier of p.sql) {
    assert.doesNotThrow(() => validateCreate('sql', { name: 'db', region: 'us-central1', databaseVersion: p.sqlVersions[0], tier: tier.value, rootPassword: 'a-long-enough-password', confirmName: 'db', acknowledgeCost: true, acknowledgeHighCost: true }));
  }
});

// ── Compute zone operations ──────────────────────────────────────────────────

test('waitForZoneOperation polls ZoneOperations.wait until DONE (no .promise())', async () => {
  const { waitForZoneOperation } = require('./gcpResources');
  const statuses = ['RUNNING', 'DONE'];
  const calls = [];
  const zoneOps = { wait: async req => { calls.push(req); return [{ name: 'op-1', status: statuses.shift() }]; } };
  // Shape returned by @google-cloud/compute v4: an LROperation without a usable promise()
  const operation = { latestResponse: { name: 'op-1', status: 'PENDING' }, promise: () => { throw new Error('operation.promise is not a function'); } };
  const done = await waitForZoneOperation(zoneOps, { project: 'p', zone: 'us-central1-a', operation });
  assert.equal(done.status, 'DONE');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { project: 'p', zone: 'us-central1-a', operation: 'op-1' });
});

test('waitForZoneOperation accepts the numeric DONE enum and already-finished operations', async () => {
  const { waitForZoneOperation } = require('./gcpResources');
  const zoneOps = { wait: async () => { throw new Error('should not be called'); } };
  await waitForZoneOperation(zoneOps, { project: 'p', zone: 'z', operation: { name: 'op', status: 2104194 } });
});

test('waitForZoneOperation surfaces operation errors and times out', async () => {
  const { waitForZoneOperation } = require('./gcpResources');
  const failing = { wait: async () => [{ name: 'op', status: 'DONE', error: { errors: [{ code: 'QUOTA_EXCEEDED', message: 'Quota CPUS exceeded' }] } }] };
  await assert.rejects(
    waitForZoneOperation(failing, { project: 'p', zone: 'z', operation: { name: 'op', status: 'RUNNING' } }),
    err => err.code === 400 && /Quota CPUS exceeded/.test(err.message));

  let t = 0;
  const slow = { wait: async () => { t += 1000; return [{ name: 'op', status: 'RUNNING' }]; } };
  await assert.rejects(
    waitForZoneOperation(slow, { project: 'p', zone: 'z', operation: { name: 'op', status: 'RUNNING' }, timeoutMs: 2500, now: () => t }),
    err => err.code === 504);
});

// ── Labels ───────────────────────────────────────────────────────────────────

test('validateLabels returns the full map with system labels preserved and a diff', () => {
  const { validateLabels } = require('./gcpResources');
  const res = validateLabels(
    { env: 'prod', team: 'core', empty: '' },
    { env: 'dev', old: 'x', 'goog-ops-agent-policy': 'v2', 'run.googleapis.com/ingress': 'all' },
  );
  assert.deepEqual(res.labels, { 'goog-ops-agent-policy': 'v2', 'run.googleapis.com/ingress': 'all', env: 'prod', team: 'core', empty: '' });
  assert.deepEqual(res.diff, { added: { team: 'core', empty: '' }, changed: { env: { from: 'dev', to: 'prod' } }, removed: ['old'] });
});

test('validateLabels enforces GCP rules and protects system labels', () => {
  const { validateLabels } = require('./gcpResources');
  assert.throws(() => validateLabels({ Env: 'prod' }), /Invalid key "Env"/);
  assert.throws(() => validateLabels({ '1env': 'x' }), /Invalid key/);
  assert.throws(() => validateLabels({ env: 'Prod Value' }), /Invalid value for "env"/);
  assert.throws(() => validateLabels({ env: 'x'.repeat(64) }), /Invalid value/);
  assert.throws(() => validateLabels({ 'goog-x': '1' }), /system label/);
  assert.throws(() => validateLabels(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 'v']))), /At most 64/);
  assert.throws(() => validateLabels(['env']), /must be an object/);
});

test('hasLabelChanges detects no-op updates', () => {
  const { validateLabels, hasLabelChanges } = require('./gcpResources');
  assert.equal(hasLabelChanges(validateLabels({ env: 'prod' }, { env: 'prod', 'goog-x': '1' }).diff), false);
  assert.equal(hasLabelChanges(validateLabels({}, { env: 'prod' }).diff), true);
});

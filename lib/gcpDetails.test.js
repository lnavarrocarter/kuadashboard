'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapVmDetail, mapCloudRunDetail, mapSqlDetail } = require('./gcpDetails');

test('VM detail: machine, scheduling, security, disks and hidden sensitive metadata', () => {
  const d = mapVmDetail({
    name: 'web', id: 123n, zone: 'projects/p/zones/us-central1-a', status: 'RUNNING',
    machineType: 'zones/us-central1-a/machineTypes/e2-micro', cpuPlatform: 'Intel Broadwell',
    lastStartTimestamp: '2026-09-27T21:03:12.979-07:00',
    scheduling: { provisioningModel: 'SPOT', automaticRestart: false, onHostMaintenance: 'TERMINATE', instanceTerminationAction: 'STOP' },
    shieldedInstanceConfig: { enableSecureBoot: false, enableVtpm: true, enableIntegrityMonitoring: true },
    serviceAccounts: [{ email: 'sa@p.iam.gserviceaccount.com', scopes: ['https://www.googleapis.com/auth/cloud-platform'] }],
    networkInterfaces: [{ name: 'nic0', network: 'global/networks/default', subnetwork: 'regions/r/subnetworks/default', networkIP: '10.0.0.2', accessConfigs: [{ natIP: '34.1.2.3', networkTier: 'PREMIUM' }] }],
    disks: [{ boot: true, source: 'zones/z/disks/web', deviceName: 'persistent-disk-0', mode: 'READ_WRITE', interface: 'SCSI', diskSizeGb: '20', autoDelete: true, licenses: ['projects/rocky-linux-cloud/global/licenses/rocky-linux-9'] }],
    metadata: { items: [{ key: 'ssh-keys', value: 'user:ssh-ed25519 AAAA secret' }, { key: 'startup-script', value: 'curl evil' }, { key: 'enable-oslogin', value: 'TRUE' }] },
    labels: { env: 'prod' }, tags: { items: ['http-server'] },
  }, { web: { type: 'zones/z/diskTypes/pd-balanced', sourceImage: 'projects/rocky/global/images/rocky-linux-9-v1', sizeGb: '20' } });

  assert.equal(d.instanceId, '123');
  assert.equal(d.machine.os, 'rocky linux 9');
  assert.deepEqual(d.scheduling, { provisioningModel: 'SPOT', automaticRestart: false, onHostMaintenance: 'TERMINATE', terminationAction: 'STOP', maxRunDurationSeconds: null });
  assert.equal(d.security.vtpm, true);
  assert.equal(d.security.osLogin, 'TRUE');
  assert.deepEqual(d.security.serviceAccounts[0].scopes, ['cloud-platform (acceso completo)']);
  assert.equal(d.networks[0].externalIp, '34.1.2.3');
  assert.deepEqual(d.disks[0], { name: 'web', deviceName: 'persistent-disk-0', boot: true, kind: 'PERSISTENT', type: 'pd-balanced', mode: 'READ_WRITE', interface: 'SCSI', sizeGb: 20, autoDelete: true, sourceImage: 'rocky-linux-9-v1', encryption: 'Google-managed', os: 'rocky linux 9' });
  const meta = Object.fromEntries(d.metadata.map(m => [m.key, m]));
  assert.equal(meta['ssh-keys'].value, null);
  assert.equal(meta['ssh-keys'].sensitive, true);
  assert.equal(meta['startup-script'].value, null);
  assert.equal(meta['enable-oslogin'].value, 'TRUE');
  assert.ok(!JSON.stringify(d).includes('curl evil'));
  assert.ok(!JSON.stringify(d).includes('AAAA secret'));
});

test('Cloud Run detail: container, scaling, traffic per revision, public flag and secrets by reference', () => {
  const d = mapCloudRunDetail({
    name: 'projects/p/locations/us-central1/services/api', uri: 'https://api.run.app', reconciling: false,
    ingress: 'INGRESS_TRAFFIC_ALL', latestReadyRevision: 'projects/p/locations/r/services/api/revisions/api-2',
    template: {
      scaling: { minInstanceCount: 1, maxInstanceCount: 5 }, maxInstanceRequestConcurrency: 80, timeout: { seconds: 300 },
      executionEnvironment: 'EXECUTION_ENVIRONMENT_UNSPECIFIED', serviceAccount: 'run@p.iam.gserviceaccount.com',
      vpcAccess: { connector: 'projects/p/locations/r/connectors/c1', egress: 'VPC_EGRESS_PRIVATE_RANGES_ONLY' },
      containers: [{
        image: 'gcr.io/p/api:1', ports: [{ containerPort: 8080 }],
        resources: { limits: { cpu: '1', memory: '512Mi' }, cpuIdle: true, startupCpuBoost: true },
        startupProbe: { tcpSocket: { port: 8080 }, periodSeconds: 240, failureThreshold: 1 },
        env: [{ name: 'MODE', value: 'prod' }, { name: 'TOKEN', valueSource: { secretKeyRef: { secret: 'projects/p/secrets/token', version: '3' } } }],
      }],
      volumes: [{ name: 'sql', cloudSqlInstance: { instances: ['p:r:db'] } }],
    },
    trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
  }, [{ name: 'x/revisions/api-2', reconciling: false, containers: [{ image: 'gcr.io/p/api:1' }] }, { name: 'x/revisions/api-1', reconciling: false }], { region: 'us-central1', publicAccess: true });

  assert.equal(d.publicAccess, true);
  assert.equal(d.ingress, 'all');
  assert.equal(d.scaling.timeoutSeconds, 300);
  assert.equal(d.scaling.executionEnvironment, null);
  assert.deepEqual(d.container.startupProbe, { kind: 'TCP 8080', periodSeconds: 240, failureThreshold: 1, initialDelaySeconds: null });
  assert.deepEqual(d.networking, { vpcConnector: 'c1', vpcEgress: 'private_ranges_only', directVpc: [] });
  assert.deepEqual(d.envVars, [{ name: 'MODE', value: 'prod' }, { name: 'TOKEN', secret: 'token:3' }]);
  assert.deepEqual(d.cloudSqlInstances, ['p:r:db']);
  assert.deepEqual(d.revisions.map(r => [r.name, r.traffic]), [['api-2', 100], ['api-1', null]]);
});

test('Cloud SQL detail: derived status, storage, backups, maintenance and network', () => {
  const d = mapSqlDetail({
    name: 'db', databaseVersion: 'POSTGRES_16', region: 'us-central1', gceZone: 'us-central1-c', state: 'RUNNABLE',
    ipAddresses: [{ type: 'PRIMARY', ipAddress: '35.1.1.1' }, { type: 'PRIVATE', ipAddress: '10.1.0.3' }],
    serverCaCert: { expirationTime: '2036-01-01T00:00:00Z' },
    settings: {
      activationPolicy: 'NEVER', tier: 'db-custom-2-7680', edition: 'ENTERPRISE', availabilityType: 'REGIONAL',
      dataDiskType: 'PD_SSD', dataDiskSizeGb: '50', storageAutoResize: true,
      backupConfiguration: { enabled: true, startTime: '03:00', pointInTimeRecoveryEnabled: true, backupRetentionSettings: { retainedBackups: 7 }, transactionLogRetentionDays: 7 },
      maintenanceWindow: { day: 7, hour: 4, updateTrack: 'stable' },
      ipConfiguration: { ipv4Enabled: true, sslMode: 'ENCRYPTED_ONLY', authorizedNetworks: [{ name: 'office', value: '1.2.3.4/32' }] },
      deletionProtectionEnabled: true, userLabels: { env: 'prod' },
      databaseFlags: [{ name: 'max_connections', value: '200' }],
    },
  });
  assert.equal(d.status, 'STOPPED');
  assert.equal(d.storage.sizeGb, 50);
  assert.equal(d.backups.pointInTimeRecovery, true);
  assert.deepEqual(d.maintenance, { day: 'Domingo', hour: 4, track: 'stable' });
  assert.deepEqual(d.network.authorizedNetworks, [{ name: 'office', cidr: '1.2.3.4/32' }]);
  assert.equal(d.network.privateIp, '10.1.0.3');
  assert.equal(d.security.deletionProtection, true);
  assert.deepEqual(d.labels, { env: 'prod' });
  assert.equal(mapSqlDetail({ name: 'x', state: 'RUNNABLE', settings: { activationPolicy: 'ALWAYS' } }).status, 'RUNNING');
});

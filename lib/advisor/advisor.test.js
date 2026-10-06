'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { check, buildReport, isFloatingImage } = require('./core');
const { adviseKubernetes, selectorMatches } = require('./kubernetes');
const { adviseAws, parseCredentialReport, openSensitivePorts, collectAws } = require('./aws');
const { adviseGcp } = require('./gcp');
const { adviseProduct } = require('./product');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ok = value => ({ ok: true, value });
const byId = (report, id) => report.findings.find(f => f.id === id);

// ── core ──────────────────────────────────────────────────────────────────────

test('buildReport keeps findings, counts passed checks and sorts by severity', () => {
  const report = buildReport([
    check({ id: 'a', category: 'security', severity: 'low' }, [{ name: 'x' }]),
    check({ id: 'b', category: 'infrastructure', severity: 'high' }, [{ name: 'y' }, { name: 'z' }]),
    check({ id: 'c', category: 'security', severity: 'medium' }, []),
  ], { now: NOW });
  assert.deepEqual(report.findings.map(f => f.id), ['b', 'a']);
  assert.equal(report.summary.security.passed, 1);
  assert.equal(report.summary.security.findings, 1);
  assert.equal(report.summary.infrastructure.high, 1);
  assert.equal(report.findings[0].count, 2);
});

test('check truncates long resource lists but keeps the real count', () => {
  const result = check({ id: 'a', category: 'security', severity: 'low' }, Array.from({ length: 25 }, (_, i) => ({ name: `r${i}` })));
  assert.equal(result.count, 25);
  assert.equal(result.resources.length, 10);
  assert.equal(result.truncated, true);
});

test('isFloatingImage flags untagged and :latest images, not pinned ones', () => {
  assert.equal(isFloatingImage('nginx'), true);
  assert.equal(isFloatingImage('nginx:latest'), true);
  assert.equal(isFloatingImage('registry:5000/team/api'), true);
  assert.equal(isFloatingImage('registry:5000/team/api:1.4.2'), false);
  assert.equal(isFloatingImage('nginx@sha256:abc'), false);
});

// ── Kubernetes ────────────────────────────────────────────────────────────────

function deployment(name, { namespace = 'shop', replicas = 2, labels = { app: name }, spec = {} } = {}) {
  return {
    metadata: { name, namespace, labels },
    spec: {
      replicas,
      template: {
        metadata: { labels: { app: name } },
        spec: {
          containers: [{
            name: 'main', image: `${name}:1.0.0`,
            resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { memory: '256Mi' } },
            readinessProbe: {}, livenessProbe: {},
            securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false },
          }],
          serviceAccountName: 'api',
          topologySpreadConstraints: [{}],
          ...spec,
        },
      },
    },
  };
}

function nodes(count, version = 'v1.30.2') {
  return Array.from({ length: count }, (_, i) => ({ metadata: { name: `n${i}` }, status: { nodeInfo: { kubeletVersion: version } } }));
}

test('a well configured workload passes every Kubernetes check', () => {
  const report = adviseKubernetes({
    sources: {
      deployments: ok([deployment('api')]), statefulsets: ok([]), daemonsets: ok([]), pods: ok([]),
      nodes: ok(nodes(3)), networkPolicies: ok([{ metadata: { namespace: 'shop' } }]),
      pdbs: ok([{ metadata: { namespace: 'shop' }, spec: { selector: { matchLabels: { app: 'api' } } } }]), hpas: ok([]),
    },
    usage: { cpu: { percent: 50 }, memory: { percent: 60 } },
    now: NOW,
  });
  assert.deepEqual(report.findings.map(f => f.id), []);
  assert.ok(report.summary.security.passed >= 5);
});

test('Kubernetes advisor flags insecure, fragile and floating workloads', () => {
  const risky = deployment('legacy', {
    replicas: 1,
    labels: {},
    spec: {
      hostNetwork: true,
      serviceAccountName: undefined,
      topologySpreadConstraints: undefined,
      volumes: [{ name: 'docker', hostPath: { path: '/var/run/docker.sock' } }],
      containers: [{
        name: 'app', image: 'legacy:latest',
        securityContext: { privileged: true },
        env: [{ name: 'DB_PASSWORD', value: 'hunter2' }, { name: 'API_TOKEN', valueFrom: { secretKeyRef: {} } }],
      }],
    },
  });
  const report = adviseKubernetes({
    sources: {
      deployments: ok([risky]), statefulsets: ok([]), daemonsets: ok([]),
      pods: ok([{ metadata: { name: 'bare', namespace: 'default' }, spec: { containers: [{ name: 'c', image: 'busybox' }] }, status: { containerStatuses: [{ restartCount: 12 }] } }]),
      nodes: ok(nodes(1)), networkPolicies: ok([]), pdbs: ok([]), hpas: ok([]),
    },
    now: NOW,
  });
  for (const id of ['k8s.privileged', 'k8s.host_namespaces', 'k8s.plain_secret_env', 'k8s.host_path', 'k8s.run_as_root',
    'k8s.single_replica', 'k8s.bare_pods', 'k8s.latest_tag', 'k8s.no_readiness', 'k8s.no_requests', 'k8s.no_network_policy',
    'k8s.crash_loops', 'k8s.single_node', 'k8s.default_namespace', 'k8s.missing_labels']) {
    assert.ok(byId(report, id), `expected ${id}`);
  }
  assert.equal(byId(report, 'k8s.plain_secret_env').resources[0].detail, 'DB_PASSWORD');
  assert.equal(report.findings[0].severity, 'high');
});

test('kube-* namespaces are skipped and HPAs with minReplicas > 1 cover single-replica specs', () => {
  const report = adviseKubernetes({
    sources: {
      deployments: ok([
        deployment('coredns', { namespace: 'kube-system', spec: { containers: [{ name: 'c', image: 'coredns', securityContext: { privileged: true } }] } }),
        deployment('web', { replicas: 1 }),
      ]),
      statefulsets: ok([]), daemonsets: ok([]), pods: ok([]), nodes: ok(nodes(3)),
      hpas: ok([{ metadata: { namespace: 'shop' }, spec: { minReplicas: 2, scaleTargetRef: { kind: 'Deployment', name: 'web' } } }]),
    },
    now: NOW,
  });
  assert.equal(byId(report, 'k8s.privileged'), undefined);
  assert.equal(byId(report, 'k8s.single_replica'), undefined);
});

test('a failed source is reported and its checks skipped', () => {
  const report = adviseKubernetes({
    sources: { pods: ok([]), deployments: ok([]), statefulsets: ok([]), daemonsets: ok([]), networkPolicies: { ok: false, error: { statusCode: 403, message: 'forbidden' } } },
    now: NOW,
  });
  assert.equal(report.unavailable[0].source, 'networkPolicies');
  assert.equal(report.unavailable[0].status, 403);
  assert.equal(report.summary.security.checks, 7);
});

test('Kubernetes advisor flags saturation, kubelet skew and idle clusters', () => {
  const skewed = [...nodes(2, 'v1.29.1'), ...nodes(1, 'v1.30.0')];
  const hot = adviseKubernetes({ sources: { nodes: ok(skewed) }, usage: { cpu: { percent: 91 }, memory: { percent: 40 } }, now: NOW });
  assert.equal(byId(hot, 'k8s.cluster_saturation').resources[0].name, 'CPU');
  assert.equal(byId(hot, 'k8s.kubelet_skew').count, 2);
  const idle = adviseKubernetes({ sources: { nodes: ok(nodes(4)) }, usage: { cpu: { percent: 8 }, memory: { percent: 12 } }, now: NOW });
  assert.ok(byId(idle, 'k8s.cluster_overprovisioned'));
});

test('selectorMatches supports matchLabels and matchExpressions', () => {
  assert.equal(selectorMatches({ matchLabels: { app: 'a' } }, { app: 'a', tier: 'web' }), true);
  assert.equal(selectorMatches({ matchExpressions: [{ key: 'tier', operator: 'In', values: ['web'] }] }, { tier: 'web' }), true);
  assert.equal(selectorMatches({ matchExpressions: [{ key: 'tier', operator: 'NotIn', values: ['web'] }] }, { tier: 'web' }), false);
  assert.equal(selectorMatches({}, { app: 'a' }), false);
});

// ── AWS ───────────────────────────────────────────────────────────────────────

const REPORT_CSV = [
  'user,arn,user_creation_time,password_enabled,password_last_used,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_2_active,access_key_2_last_rotated,access_key_2_last_used_date',
  '<root_account>,arn:aws:iam::1:root,2020-01-01T00:00:00+00:00,not_supported,2026-09-30T00:00:00+00:00,false,true,2021-01-01T00:00:00+00:00,2026-09-01T00:00:00+00:00,false,N/A,N/A',
  'ana,arn:aws:iam::1:user/ana,2024-01-01T00:00:00+00:00,true,2026-09-30T00:00:00+00:00,false,true,2025-01-01T00:00:00+00:00,2026-09-30T00:00:00+00:00,false,N/A,N/A',
  'ci,arn:aws:iam::1:user/ci,2024-01-01T00:00:00+00:00,false,N/A,true,true,2026-03-01T00:00:00+00:00,N/A,false,N/A,N/A',
].join('\n');

test('parseCredentialReport turns the CSV into rows', () => {
  const rows = parseCredentialReport(REPORT_CSV);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].user, 'ana');
  assert.equal(rows[1].mfa_active, 'false');
});

test('openSensitivePorts finds admin and database ports open to the internet', () => {
  assert.deepEqual(openSensitivePorts({ IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] }), ['SSH 22']);
  assert.deepEqual(openSensitivePorts({ IpPermissions: [{ IpProtocol: '-1', Ipv6Ranges: [{ CidrIpv6: '::/0' }] }] }), ['all ports']);
  assert.deepEqual(openSensitivePorts({ IpPermissions: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] }), []);
  assert.deepEqual(openSensitivePorts({ IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '10.0.0.0/8' }] }] }), []);
});

test('AWS advisor turns collected data into findings', () => {
  const report = adviseAws({
    data: {
      credentials: parseCredentialReport(REPORT_CSV),
      cloudtrail: [{ name: 'main', multiRegion: false, validation: false, logging: true }],
      ec2: {
        securityGroups: [{ GroupName: 'web', GroupId: 'sg-1', IpPermissions: [{ IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] }],
        instances: [{ InstanceId: 'i-1', InstanceType: 't2.micro', PublicIpAddress: '1.2.3.4', MetadataOptions: { HttpTokens: 'optional' }, Tags: [{ Key: 'Name', Value: 'bastion' }] }],
        volumes: [{ VolumeId: 'vol-1', Size: 20, VolumeType: 'gp3' }],
        addresses: [{ PublicIp: '5.6.7.8' }, { PublicIp: '9.9.9.9', AssociationId: 'a' }],
        ebsEncryptionByDefault: false,
      },
      rds: [
        { DBInstanceIdentifier: 'db', Engine: 'postgres', PubliclyAccessible: true, StorageEncrypted: false, BackupRetentionPeriod: 0, MultiAZ: false, DeletionProtection: false },
        { DBInstanceIdentifier: 'aurora-1', DBClusterIdentifier: 'aurora', StorageEncrypted: true, DeletionProtection: true },
      ],
      lambda: [
        { FunctionName: 'old', Runtime: 'nodejs16.x', Architectures: ['x86_64'], Environment: { Variables: { DB_PASSWORD: 'x', SECRET_ARN: 'arn' } } },
        { FunctionName: 'img', PackageType: 'Image', TracingConfig: { Mode: 'Active' } },
      ],
      eks: [{ name: 'prod', resourcesVpcConfig: { endpointPublicAccess: true, publicAccessCidrs: ['0.0.0.0/0'] }, logging: { clusterLogging: [{ enabled: false, types: ['api'] }] } }],
    },
    region: 'us-east-1',
    now: NOW,
  });
  for (const id of ['aws.root_mfa', 'aws.root_access_keys', 'aws.user_no_mfa', 'aws.old_access_keys', 'aws.unused_credentials',
    'aws.trail_single_region', 'aws.trail_validation', 'aws.open_admin_ports', 'aws.imdsv1', 'aws.ebs_default_encryption',
    'aws.previous_generation', 'aws.public_instances', 'aws.orphan_volumes', 'aws.idle_elastic_ips',
    'aws.rds_public', 'aws.rds_unencrypted', 'aws.rds_no_backup', 'aws.rds_single_az', 'aws.rds_deletion_protection',
    'aws.lambda_deprecated_runtime', 'aws.lambda_plain_secrets', 'aws.lambda_x86', 'aws.lambda_no_tracing',
    'aws.eks_public_endpoint', 'aws.eks_secrets_encryption', 'aws.eks_control_plane_logs']) {
    assert.ok(byId(report, id), `expected ${id}`);
  }
  assert.equal(byId(report, 'aws.no_cloudtrail'), undefined);
  assert.equal(byId(report, 'aws.idle_elastic_ips').count, 1);
  // Aurora instances: backups and Multi-AZ are judged on the cluster.
  assert.equal(byId(report, 'aws.rds_single_az').count, 1);
  assert.equal(byId(report, 'aws.lambda_plain_secrets').resources[0].detail, 'DB_PASSWORD');
  assert.equal(byId(report, 'aws.unused_credentials').resources[0].name, 'ci');
});

test('AWS advisor reports no CloudTrail when no trail is logging', () => {
  const report = adviseAws({ data: { cloudtrail: [{ name: 'off', logging: false }] }, now: NOW });
  assert.ok(byId(report, 'aws.no_cloudtrail'));
});

test('collectAws settles each source and builds an access request on denials', async () => {
  const denied = Object.assign(new Error('User: arn:aws:iam::1:user/x is not authorized to perform: rds:DescribeDBInstances'), { name: 'AccessDeniedException' });
  const sdk = pkg => new Proxy({}, {
    get: (_, name) => {
      if (String(name).endsWith('Client')) {
        return class { send(command) { return command.run(); } };
      }
      return class {
        constructor() {
          this.run = async () => {
            if (pkg === 'client-rds') throw denied;
            if (name === 'GenerateCredentialReportCommand') return { State: 'COMPLETE' };
            if (name === 'GetCredentialReportCommand') return { Content: Buffer.from(REPORT_CSV) };
            return {};
          };
        }
      };
    },
  });
  const { data, unavailable } = await collectAws({ region: 'us-east-1' }, { sdk });
  assert.equal(data.credentials.length, 3);
  assert.deepEqual(data.lambda, []);
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].source, 'rds');
  assert.equal(unavailable[0].kind, 'denied');
  assert.deepEqual(unavailable[0].access.actions, ['rds:DescribeDBInstances']);
});

// ── GCP ───────────────────────────────────────────────────────────────────────

test('GCP advisor checks Cloud Run, VMs, SQL, buckets, GKE and functions', () => {
  const report = adviseGcp({
    rows: new Map([
      ['cloudrun', [{ name: 'api', region: 'us-central1', image: 'gcr.io/p/api:latest', ingress: 'all', serviceAccount: null, maxInstances: null }]],
      ['vms', [{ name: 'vm-1', zone: 'us-central1-a', externalIp: '1.1.1.1', serviceAccount: '123-compute@developer.gserviceaccount.com', keptDiskCount: 1 }]],
      ['sql', [{ name: 'db', publicIp: '2.2.2.2', backupEnabled: false, deletionProtection: false, availabilityType: 'ZONAL' }]],
      ['storage', [{ name: 'b', iamConfiguration: { uniformBucketLevelAccess: { enabled: false } } }]],
      ['gke', [{ name: 'c', location: 'us-central1-a', legacyAbac: { enabled: true } }]],
      ['functions', [{ name: 'projects/p/locations/l/functions/f', buildConfig: { runtime: 'nodejs16' }, serviceConfig: { serviceAccountEmail: 'f@p.iam.gserviceaccount.com' } }]],
    ]),
    projectId: 'p',
    now: NOW,
  });
  for (const id of ['gcp.default_service_account', 'gcp.cloudrun_public_ingress', 'gcp.cloudrun_unbounded', 'gcp.latest_tag',
    'gcp.vm_public_ip', 'gcp.vm_kept_disks', 'gcp.sql_public_ip', 'gcp.sql_no_backup', 'gcp.sql_zonal', 'gcp.sql_deletion_protection',
    'gcp.bucket_uniform_access', 'gcp.bucket_public_prevention', 'gcp.bucket_no_versioning',
    'gcp.gke_legacy_abac', 'gcp.gke_public_nodes', 'gcp.gke_no_workload_identity', 'gcp.gke_no_authorized_networks',
    'gcp.gke_no_release_channel', 'gcp.gke_zonal', 'gcp.function_deprecated_runtime']) {
    assert.ok(byId(report, id), `expected ${id}`);
  }
  assert.equal(byId(report, 'gcp.default_service_account').count, 2);
  assert.equal(byId(report, 'gcp.function_deprecated_runtime').resources[0].name, 'f');
});

test('GCP advisor skips collectors that failed', () => {
  const report = adviseGcp({ rows: new Map([['sql', []]]), unavailable: ['sql', 'pubsub'], now: NOW });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.unavailable, [{ source: 'sql' }]);
});

// ── Product (KUApps) ──────────────────────────────────────────────────────────

const APP = {
  id: 'app-1', name: 'checkout', provider: 'aws', environment: 'production', team: 'payments', pollingEnabled: true,
  architectureProjectIds: ['p1'], thresholds: { errorRatePercent: 1, durationMs: 400, readyPodsPercent: 100, restartDelta: 1 },
};

test('product advisor passes a well-run application', () => {
  const report = adviseProduct({
    application: APP,
    overview: {
      resources: [{ type: 'lambda', count: 2, enabled: 2 }],
      metrics: [{ metricName: 'invocations_observed', quality: 'full' }],
      health: { signals: [] },
      latestRun: { status: 'completed', finishedAt: new Date(NOW - 3600000).toISOString() },
    },
    siblings: [APP, { ...APP, id: 'app-2', environment: 'staging' }],
    now: NOW,
  });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.categories, ['product']);
});

test('product advisor flags a confirmed dependency whose target fails in its logs (#172)', () => {
  const overview = {
    resources: [{ type: 'lambda', count: 2, enabled: 2 }],
    metrics: [{ metricName: 'invocations_observed', quality: 'full' }],
    health: { signals: [] },
    latestRun: { status: 'completed', finishedAt: new Date(NOW - 3600000).toISOString() },
  };
  const report = adviseProduct({
    application: { ...APP, thresholds: { ...APP.thresholds, errorRatePercent: 2 } },
    overview,
    siblings: [APP, { ...APP, id: 'app-2', environment: 'staging' }],
    dependencies: [
      { source: 'checkout-api', target: 'orders-db', targetErrorRatePercent: 4.17 },
      { source: 'checkout-api', target: 'audit-queue', targetErrorRatePercent: 0.5 },
    ],
    now: NOW,
  });
  const finding = byId(report, 'product.fragile_dependency');
  assert.ok(finding);
  assert.deepEqual(finding.resources.map(item => [item.name, item.detail]), [['checkout-api → orders-db', '4.17% errors (logs, 24h)']]);
  assert.equal(byId(adviseProduct({ application: APP, overview, siblings: [APP], now: NOW }), 'product.fragile_dependency'), undefined);
});

test('product advisor flags missing objectives, owner, staging and telemetry', () => {
  const report = adviseProduct({
    application: { ...APP, team: '', architectureProjectIds: [], thresholds: { errorRatePercent: 5, durationMs: 1000, readyPodsPercent: 100, restartDelta: 1 } },
    overview: {
      resources: [{ type: 'lambda', count: 1, enabled: 1 }],
      metrics: [],
      health: { signals: [{ metric: 'errorRatePercent', value: 7.456, threshold: 5, comparison: 'maximum' }] },
      latestRun: { status: 'failed', finishedAt: new Date(NOW - 3600000).toISOString(), errorMessage: 'AccessDenied' },
    },
    siblings: [],
    now: NOW,
  });
  for (const id of ['product.slo_breached', 'product.no_telemetry', 'product.stale_telemetry', 'product.default_slos',
    'product.no_owner', 'product.no_staging', 'product.no_architecture']) {
    assert.ok(byId(report, id), `expected ${id}`);
  }
  assert.equal(byId(report, 'product.slo_breached').resources[0].detail, '7.46 vs ≤ 5');
});

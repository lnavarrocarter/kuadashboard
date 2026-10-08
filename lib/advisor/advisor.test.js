'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { check, buildReport, isFloatingImage } = require('./core');
const { adviseKubernetes, selectorMatches } = require('./kubernetes');
const { adviseAws, collectIam, parseCredentialReport, openSensitivePorts, collectAws, collectS3Advisor, estimateS3AdvisorCost, DEPRECATED_RUNTIMES_REVIEWED_AT: AWS_RUNTIMES_REVIEWED_AT } = require('./aws');
const { adviseGcp, DEPRECATED_RUNTIMES_REVIEWED_AT: GCP_RUNTIMES_REVIEWED_AT } = require('./gcp');
const { adviseVercel } = require('./vercel');
const { adviseProduct, summarizeErrorBudget, summarizeTechnicalFindings, crossRecommendations } = require('./product');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ok = value => ({ ok: true, value });
const byId = (report, id) => report.findings.find(f => f.id === id);
const awsHas = (data, id) => !!byId(adviseAws({ data, now: NOW }), id);

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

test('AWS and GCP deprecated runtime catalogs are reviewed within six months', () => {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  for (const [provider, reviewedAt] of [['AWS', AWS_RUNTIMES_REVIEWED_AT], ['GCP', GCP_RUNTIMES_REVIEWED_AT]]) {
    assert.ok(Number.isFinite(Date.parse(reviewedAt)), `${provider} runtime review date is invalid`);
    assert.ok(Date.parse(reviewedAt) >= cutoff.getTime(), `${provider} deprecated runtime catalog is older than six months`);
  }
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
  assert.equal(report.summary.security.checks, 8);
});

test('Kubernetes Advisor flags cluster-admin bindings and ignores other roles', () => {
  const report = adviseKubernetes({ sources: {
    clusterRoleBindings: ok([{ metadata: { name: 'admins' }, roleRef: { kind: 'ClusterRole', name: 'cluster-admin' }, subjects: [{ kind: 'Group', name: 'developers' }] }]),
    roleBindings: ok([{ metadata: { name: 'reader' }, roleRef: { kind: 'ClusterRole', name: 'view' } }]),
  }, now: NOW });
  assert.equal(byId(report, 'k8s.cluster_admin_binding').count, 1);
  const clean = adviseKubernetes({ sources: { clusterRoleBindings: ok([]), roleBindings: ok([]) }, now: NOW });
  assert.equal(byId(clean, 'k8s.cluster_admin_binding'), undefined);
});

test('Kubernetes Advisor flags namespaces missing all Pod Security Admission labels', () => {
  const report = adviseKubernetes({ sources: { namespaces: ok([
    { metadata: { name: 'payments', labels: {} } },
    { metadata: { name: 'catalog', labels: { 'pod-security.kubernetes.io/enforce': 'restricted' } } },
    { metadata: { name: 'kube-system', labels: {} } },
  ]) }, now: NOW });
  assert.deepEqual(byId(report, 'k8s.no_pod_security_admission').resources.map(resource => resource.name), ['payments']);
  const clean = adviseKubernetes({ sources: { namespaces: ok([{ metadata: { name: 'payments', labels: { 'pod-security.kubernetes.io/audit': 'baseline' } } }]) }, now: NOW });
  assert.equal(byId(clean, 'k8s.no_pod_security_admission'), undefined);
});

test('Kubernetes Advisor flags a Secret referenced by more than ten distinct pods', () => {
  const pod = index => ({
    metadata: { name: `pod-${index}`, namespace: 'payments' },
    spec: { volumes: [{ secret: { secretName: 'shared' } }, { projected: { sources: [{ secret: { name: 'shared' } }] } }] },
  });
  const report = adviseKubernetes({ sources: { pods: ok(Array.from({ length: 11 }, (_, index) => pod(index))) }, now: NOW });
  assert.deepEqual(byId(report, 'k8s.secret_many_pods').resources.map(resource => resource.name), ['shared']);
  const belowThreshold = adviseKubernetes({ sources: { pods: ok(Array.from({ length: 10 }, (_, index) => pod(index))) }, now: NOW });
  assert.equal(byId(belowThreshold, 'k8s.secret_many_pods'), undefined);
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

test('S3 account and bucket block-public-access rules distinguish complete settings', () => {
  const block = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
  assert.equal(awsHas({ s3: { accountPublicAccessBlock: block } }, 'aws.s3_account_public_access'), false);
  assert.equal(awsHas({ s3: { accountPublicAccessBlock: { ...block, BlockPublicPolicy: false } } }, 'aws.s3_account_public_access'), true);
  assert.equal(awsHas({ s3: { buckets: [{ name: 'private', publicAccessBlock: block }] } }, 'aws.s3_bucket_public_access'), false);
  assert.equal(awsHas({ s3: { buckets: [{ name: 'public', publicAccessBlock: { ...block, BlockPublicAcls: false } }] } }, 'aws.s3_bucket_public_access'), true);
});

test('S3 encryption rule accepts AWS default encryption and flags an unprotected bucket', () => {
  assert.equal(awsHas({ s3: { buckets: [{ name: 'default-encrypted', encryption: { defaultEncryption: true } }] } }, 'aws.s3_encryption'), false);
  assert.equal(awsHas({ s3: { buckets: [{ name: 'unencrypted' }] } }, 'aws.s3_encryption'), true);
});

test('S3 versioning rule only flags buckets without enabled versioning', () => {
  assert.equal(awsHas({ s3: { buckets: [{ name: 'versioned', versioning: { Status: 'Enabled' } }] } }, 'aws.s3_versioning'), false);
  assert.equal(awsHas({ s3: { buckets: [{ name: 'suspended', versioning: { Status: 'Suspended' } }] } }, 'aws.s3_versioning'), true);
});

test('S3 server-access-logging rule flags buckets without a destination', () => {
  assert.equal(awsHas({ s3: { buckets: [{ name: 'logged', logging: { LoggingEnabled: { TargetBucket: 'logs' } } }] } }, 'aws.s3_logging'), false);
  assert.equal(awsHas({ s3: { buckets: [{ name: 'unlogged', logging: {} }] } }, 'aws.s3_logging'), true);
});

test('S3 Advisor omits checks whose reads failed and estimates the preflight cost', () => {
  const report = adviseAws({
    data: { s3: {
      accountPublicAccessBlockAvailable: false,
      bucketInventoryComplete: true,
      buckets: [{ name: 'private-bucket', checks: { publicAccessBlock: true } }],
    } },
    unavailable: [{ source: 's3-account-public-access', kind: 'access-denied' }],
    now: NOW,
  });
  assert.deepEqual(report.findings.map(finding => finding.id), ['aws.s3_bucket_public_access']);
  assert.deepEqual(report.unavailable.map(source => source.source), ['s3-account-public-access']);
  assert.equal(report.summary.security.checks, 1);
  assert.deepEqual(estimateS3AdvisorCost(5), { requestCount: 27, estimatedUsd: 0.0000108 });
  assert.equal(estimateS3AdvisorCost(1001).requestCount, 5008);
});

test('S3 collector stops after inventory mismatch before detailed reads', async () => {
  const calls = [];
  const sdk = pkg => new Proxy({}, {
    get: (_, name) => {
      if (String(name).endsWith('Client')) return class { async send(command) { calls.push(`${pkg}:${command.commandName}`); return { Buckets: [{ Name: 'bucket-a' }] }; } };
      return class { constructor(input) { this.commandName = name; this.input = input; } };
    },
  });
  const result = await collectS3Advisor({ region: 'us-east-1' }, { sdk, accountId: '123456789012', expectedBucketCount: 2, now: NOW });
  assert.equal(result.inventoryChanged, true);
  assert.equal(result.bucketCount, 1);
  assert.deepEqual(calls, ['client-s3:ListBucketsCommand']);
});

test('S3 collector checks all controls and keeps denied reads explicitly partial', async () => {
  const calls = [];
  const sdk = pkg => new Proxy({}, {
    get: (_, name) => {
      if (String(name).endsWith('Client')) return class {
        constructor(config) { this.config = config; }
        async send(command) {
          calls.push(`${pkg}:${command.commandName}`);
          if (command.commandName === 'ListBucketsCommand') return { Buckets: [{ Name: 'bucket-a', BucketRegion: 'us-west-2' }] };
          if (command.commandName === 'GetPublicAccessBlockCommand' && pkg === 'client-s3-control') return { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
          if (command.commandName === 'GetBucketPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: { BlockPublicAcls: false } };
          if (command.commandName === 'GetBucketEncryptionCommand') return { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] };
          if (command.commandName === 'GetBucketVersioningCommand') return { Status: 'Suspended' };
          if (command.commandName === 'GetBucketLoggingCommand') throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
          throw new Error(`Unexpected command ${command.commandName}`);
        }
      };
      return class { constructor(input) { this.commandName = name; this.input = input; } };
    },
  });
  const result = await collectS3Advisor({ region: 'us-east-1' }, { sdk, accountId: '123456789012', expectedBucketCount: 1, now: NOW });
  assert.deepEqual(result.report.findings.map(finding => finding.id), ['aws.s3_bucket_public_access', 'aws.s3_versioning']);
  assert.equal(result.report.unavailable[0].source, 's3.logging.bucket-a');
  assert.equal(result.report.unavailable[0].access.failedAction, null);
  assert.equal(result.requestCount, 7);
  for (const command of ['GetBucketPublicAccessBlockCommand', 'GetBucketEncryptionCommand', 'GetBucketVersioningCommand', 'GetBucketLoggingCommand']) {
    assert.ok(calls.includes(`client-s3:${command}`));
  }
});

test('IAM wildcard policy rule requires an allowed wildcard action and resource', () => {
  assert.equal(awsHas({ iam: { policies: [{ name: 'admin', document: { Statement: { Effect: 'Allow', Action: '*', Resource: '*' } } }] } }, 'aws.iam_wildcard_policy'), true);
  assert.equal(awsHas({ iam: { policies: [{ name: 'scoped', document: { Statement: { Effect: 'Allow', Action: 's3:GetObject', Resource: '*' } } }] } }, 'aws.iam_wildcard_policy'), false);
  assert.equal(awsHas({ iam: { policies: [{ name: 'denied', document: { Statement: { Effect: 'Deny', Action: '*', Resource: '*' } } }] } }, 'aws.iam_wildcard_policy'), false);
});

test('IAM unused-role rule ignores recently used and service-linked roles', () => {
  assert.equal(awsHas({ iam: { roles: [{ RoleName: 'active', RoleLastUsed: { LastUsedDate: new Date(NOW - 10 * 86400000).toISOString() } }] } }, 'aws.iam_unused_role'), false);
  assert.equal(awsHas({ iam: { roles: [{ RoleName: 'old', RoleLastUsed: { LastUsedDate: new Date(NOW - 100 * 86400000).toISOString() } }] } }, 'aws.iam_unused_role'), true);
  assert.equal(awsHas({ iam: { roles: [{ RoleName: 'service', Path: '/aws-service-role/' }] } }, 'aws.iam_unused_role'), false);
});

test('IAM password-policy rule flags missing or weak policy only', () => {
  const strong = { MinimumPasswordLength: 14, RequireUppercaseCharacters: true, RequireLowercaseCharacters: true, RequireNumbers: true, RequireSymbols: true, MaxPasswordAge: 90 };
  assert.equal(awsHas({ iam: { passwordPolicy: strong } }, 'aws.iam_weak_password_policy'), false);
  assert.equal(awsHas({ iam: { passwordPolicy: { ...strong, MinimumPasswordLength: 8 } } }, 'aws.iam_weak_password_policy'), true);
  assert.equal(awsHas({ iam: { passwordPolicy: null } }, 'aws.iam_weak_password_policy'), true);
});

test('SQS encryption rule accepts managed or KMS encryption', () => {
  assert.equal(awsHas({ sqs: [{ QueueName: 'managed', SqsManagedSseEnabled: true }] }, 'aws.sqs_unencrypted'), false);
  assert.equal(awsHas({ sqs: [{ QueueName: 'not-managed', SqsManagedSseEnabled: 'false' }] }, 'aws.sqs_unencrypted'), true);
  assert.equal(awsHas({ sqs: [{ QueueName: 'kms', KmsMasterKeyId: 'alias/key' }] }, 'aws.sqs_unencrypted'), false);
  assert.equal(awsHas({ sqs: [{ QueueName: 'plain' }] }, 'aws.sqs_unencrypted'), true);
});

test('SNS encryption rule flags topics without a KMS key', () => {
  assert.equal(awsHas({ sns: [{ TopicArn: 'arn:aws:sns:us-east-1:1:private', KmsMasterKeyId: 'alias/key' }] }, 'aws.sns_unencrypted'), false);
  assert.equal(awsHas({ sns: [{ TopicArn: 'arn:aws:sns:us-east-1:1:plain' }] }, 'aws.sns_unencrypted'), true);
});

test('DynamoDB PITR rule requires point-in-time recovery to be enabled', () => {
  assert.equal(awsHas({ dynamodb: [{ TableName: 'recoverable', ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' } } }] }, 'aws.dynamodb_no_pitr'), false);
  assert.equal(awsHas({ dynamodb: [{ TableName: 'unprotected', ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'DISABLED' } } }] }, 'aws.dynamodb_no_pitr'), true);
});

test('CloudFront TLS rule accepts TLS 1.2 minimums and flags older protocols', () => {
  assert.equal(awsHas({ cloudfront: [{ Id: 'modern', ViewerCertificate: { MinimumProtocolVersion: 'TLSv1.2_2021' } }] }, 'aws.cloudfront_weak_tls'), false);
  assert.equal(awsHas({ cloudfront: [{ Id: 'legacy', ViewerCertificate: { MinimumProtocolVersion: 'TLSv1' } }] }, 'aws.cloudfront_weak_tls'), true);
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

test('collectAws marks sources that reach a page limit as partial', async () => {
  const sdk = pkg => new Proxy({}, {
    get: (_, name) => {
      if (String(name).endsWith('Client')) return class { send(command) { return command.run(); } };
      return class {
        constructor() {
          this.run = async () => {
            if (pkg === 'client-cloudfront') return { DistributionList: { Items: [], IsTruncated: true, NextMarker: 'more' } };
            if (name === 'GenerateCredentialReportCommand') return { State: 'COMPLETE' };
            if (name === 'GetCredentialReportCommand') return { Content: Buffer.from(REPORT_CSV) };
            return {};
          };
        }
      };
    },
  });
  const { data, unavailable } = await collectAws({ region: 'us-east-1' }, { sdk });
  assert.equal(data.cloudfront.truncated, true);
  assert.ok(unavailable.some(source => source.source === 'cloudfront' && source.kind === 'partial'));
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

test('Vercel advisor checks deployment protection and preview credential names only', () => {
  const exposed = adviseVercel({
    projects: [{ id: 'p1', name: 'checkout' }],
    envs: new Map([['p1', [
      { key: 'DATABASE_PASSWORD', target: ['preview'], value: 'must-not-leave-memory' },
      { key: 'PUBLIC_ORIGIN', target: ['preview'], value: 'https://preview.example.test' },
      { key: 'API_TOKEN', target: ['production'] },
    ]]]), now: NOW,
  });
  assert.ok(byId(exposed, 'vercel.preview_unprotected'));
  assert.deepEqual(byId(exposed, 'vercel.preview_credentials').resources.map(({ name, detail }) => ({ name, detail })), [
    { name: 'checkout', detail: 'DATABASE_PASSWORD' },
  ]);
  assert.doesNotMatch(JSON.stringify(exposed), /must-not-leave-memory/);

  const protectedProject = adviseVercel({
    projects: [{ id: 'p1', passwordProtection: { deploymentType: 'preview' } }],
    envs: new Map([['p1', [{ key: 'DATABASE_PASSWORD', target: ['production'] }]]]), now: NOW,
  });
  assert.equal(byId(protectedProject, 'vercel.preview_unprotected'), undefined);
  assert.equal(byId(protectedProject, 'vercel.preview_credentials'), undefined);

  const productionOnly = adviseVercel({
    projects: [{ id: 'p2', passwordProtection: { deploymentType: 'production', password: 'configured' } }],
    now: NOW,
  });
  assert.ok(byId(productionOnly, 'vercel.preview_unprotected'));
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

test('product advisor calculates 24-hour error-budget consumption and burn rate', () => {
  const budget = summarizeErrorBudget({
    metrics: [
      { metricName: 'invocations_observed', sum: 1000 },
      { metricName: 'errors_observed', sum: 20 },
    ],
    thresholds: { errorRatePercent: 5 },
    logHealth: { errorRatePercent: 10 },
    from: NOW - 24 * 60 * 60 * 1000,
    to: NOW,
  });

  assert.deepEqual(budget.objectives.map(({ source, errorRatePercent, burnRate, consumedPercent, remainingPercent }) => ({
    source, errorRatePercent, burnRate, consumedPercent, remainingPercent,
  })), [
    { source: 'apm', errorRatePercent: 2, burnRate: 0.4, consumedPercent: 40, remainingPercent: 60 },
    { source: 'logs', errorRatePercent: 10, burnRate: 2, consumedPercent: 200, remainingPercent: 0 },
  ]);
});

test('technical posture includes only unique resources registered to the application scope', () => {
  const technical = summarizeTechnicalFindings([{
    provider: 'aws', scopeId: '111111111111', location: 'us-east-1', capturedAt: new Date(NOW).toISOString(),
    report: { findings: [{ id: 'aws.public_ip', category: 'security', severity: 'high', resources: [
      { kind: 'EC2', name: 'web', detail: 'public address' },
      { kind: 'EC2', name: 'unregistered' },
      { kind: 'Account', name: 'root' },
    ] }] },
  }], [
    { id: 'member-1', provider: 'aws', scopeId: '111111111111', location: 'us-east-1', resourceType: 'ec2', displayName: 'web' },
    { id: 'other-scope', provider: 'aws', scopeId: '222222222222', location: 'us-east-1', resourceType: 'ec2', displayName: 'web' },
  ]);

  assert.equal(technical.analyzedAt, new Date(NOW).toISOString());
  assert.deepEqual(technical.findings[0].resources.map(resource => resource.id), ['member-1']);
  assert.equal(technical.findings[0].count, 1);
  assert.deepEqual(crossRecommendations(
    { objectives: [{ source: 'logs', burnRate: 2 }] }, technical,
  ).map(item => item.id), ['error_budget_burning', 'registered_technical_risk', 'error_budget_and_technical_risk']);
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

test('product advisor evaluates cached log health per AWS or Kubernetes resource', () => {
  const report = adviseProduct({
    application: APP,
    resourceLogs: [
      {
        resourceId: 'lambda-1', resourceName: 'checkout-api', errorThreshold: 2,
        last24h: { events: 100, errors: 8 },
        recurringErrors: [{ signature: 'timeout', occurrences: 12 }], severeKeywords: { timeout: 3 },
      },
      {
        resourceId: 'deployment-1', resourceName: 'orders-worker', errorThreshold: 2,
        last24h: { events: 20, errors: 0 }, recurringErrors: [], severeKeywords: { connection: 2 },
      },
    ],
    uncachedLogResources: [{ id: 'pod-1', name: 'checkout-7d4', kind: 'Pod' }],
    unavailableLogScopeResources: [{ id: 'pod-2', name: 'payments-worker', kind: 'Deployment' }],
    now: NOW,
  });

  assert.deepEqual(byId(report, 'product.resource_log_rate_high').resources.map(resource => resource.name), ['checkout-api']);
  assert.deepEqual(byId(report, 'product.resource_recurring_log_errors').resources.map(resource => resource.name), ['checkout-api', 'orders-worker']);
  assert.deepEqual(byId(report, 'product.resource_logs_uncached').resources.map(resource => resource.name), ['checkout-7d4']);
  assert.deepEqual(byId(report, 'product.resource_logs_scope_unavailable').resources.map(resource => resource.name), ['payments-worker']);
});

test('product advisor flags missing objectives, owner, staging and telemetry', () => {
  const report = adviseProduct({
    application: { ...APP, team: '', architectureProjectIds: [], thresholds: { errorRatePercent: 5, durationMs: 1000, readyPodsPercent: 100, restartDelta: 1, recurringSignatureGrowthPercent: 100 } },
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

test('collectIam pages IAM with Marker and reads RoleLastUsed with GetRole', async () => {
  const day = 86400000;
  const calls = [];
  const command = name => class { constructor(input) { this.name = name; this.input = input; } };
  const responses = {
    ListPolicies: () => ({ Policies: [] }),
    ListRoles: input => (input.Marker
      ? { Roles: [{ RoleName: 'new-unused', Path: '/', CreateDate: new Date(NOW - 5 * day) }], IsTruncated: false }
      : { Roles: [{ RoleName: 'old-unused', Path: '/', CreateDate: new Date(NOW - 400 * day) }, { RoleName: 'linked', Path: '/aws-service-role/x/' }], IsTruncated: true, Marker: 'page-2' }),
    GetRole: input => ({ Role: { RoleName: input.RoleName, RoleLastUsed: input.RoleName === 'active' ? { LastUsedDate: new Date(NOW - day) } : {} } }),
    GetAccountPasswordPolicy: () => ({ PasswordPolicy: null }),
  };
  const sdk = () => ({
    IAMClient: class { send(cmd) { calls.push(cmd); return Promise.resolve(responses[cmd.name](cmd.input)); } },
    ...Object.fromEntries(['ListPolicies', 'GetPolicyVersion', 'ListRoles', 'GetRole', 'GetAccountPasswordPolicy'].map(name => [`${name}Command`, command(name)])),
  });
  const iam = await collectIam(sdk, {});
  // Second page of roles read through Marker; the service-linked role is never read with GetRole.
  assert.equal(calls.filter(c => c.name === 'ListRoles').length, 2);
  assert.deepEqual(calls.filter(c => c.name === 'GetRole').map(c => c.input.RoleName), ['old-unused', 'new-unused']);
  assert.ok(iam.roles.every(role => role.lastUsedKnown));
  const report = adviseAws({ data: { iam }, now: NOW });
  // A role never used is reported only once it is older than the unused window.
  assert.deepEqual(byId(report, 'aws.iam_unused_role').resources.map(r => r.name), ['old-unused']);
});

test('Kubernetes Advisor ignores the bootstrap and managed cluster-admin bindings', () => {
  const binding = (name, subjects, namespace) => ({ metadata: { name, ...(namespace ? { namespace } : {}) }, roleRef: { kind: 'ClusterRole', name: 'cluster-admin' }, subjects });
  const report = adviseKubernetes({
    sources: {
      clusterRoleBindings: ok([
        binding('cluster-admin', [{ kind: 'Group', name: 'system:masters' }]),
        binding('eks:addon-cluster-admin', [{ kind: 'User', name: 'eks:addon-manager' }]),
        binding('ci-admin', [{ kind: 'ServiceAccount', name: 'ci', namespace: 'tools' }, { kind: 'Group', name: 'system:masters' }]),
      ]),
      roleBindings: ok([binding('kube-proxy-admin', [{ kind: 'ServiceAccount', name: 'kube-proxy', namespace: 'kube-system' }], 'kube-system')]),
    },
    now: NOW,
  });
  const finding = byId(report, 'k8s.cluster_admin_binding');
  assert.equal(finding.count, 1);
  assert.deepEqual(finding.resources[0], { kind: 'ClusterRoleBinding', name: 'ci-admin', detail: 'ServiceAccount:ci' });
});

test('Kubernetes Advisor counts the workloads that use a Secret, not their replicas', () => {
  const replica = index => ({
    metadata: { name: `api-7d9f8b6c5-${index}`, namespace: 'payments', ownerReferences: [{ kind: 'ReplicaSet', name: 'api-7d9f8b6c5', controller: true }] },
    spec: { containers: [{ name: 'api', envFrom: [{ secretRef: { name: 'shared' } }] }] },
  });
  const report = adviseKubernetes({ sources: { pods: ok(Array.from({ length: 30 }, (_, index) => replica(index))) }, now: NOW });
  assert.equal(byId(report, 'k8s.secret_many_pods'), undefined);
});

test('Vercel preview credentials are reported only on unprotected previews and never twice', () => {
  const envs = new Map([['p1', [
    { key: 'PREVIEW_DB_PASSWORD', target: ['preview'] },
    { key: 'SHARED_API_TOKEN', target: ['production', 'preview'] },
  ]]]);
  const open = adviseVercel({ projects: [{ id: 'p1', name: 'shop' }], envs, now: NOW });
  assert.deepEqual(byId(open, 'vercel.preview_credentials').resources.map(r => r.detail), ['PREVIEW_DB_PASSWORD']);
  assert.deepEqual(byId(open, 'vercel.secret_shared_with_preview').resources.map(r => r.detail), ['SHARED_API_TOKEN']);
  // Vercel Authentication on previews: preview-only credentials are the recommended setup.
  const sso = adviseVercel({ projects: [{ id: 'p1', name: 'shop', ssoProtection: { deploymentType: 'preview' }, passwordProtection: { deploymentType: 'production' } }], envs, now: NOW });
  assert.equal(byId(sso, 'vercel.preview_credentials'), undefined);
  assert.equal(byId(sso, 'vercel.preview_unprotected'), undefined);
});

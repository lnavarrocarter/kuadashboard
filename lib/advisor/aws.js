'use strict';
/**
 * lib/advisor/aws.js
 * Good-practice checks for the AWS Overview. Uses control-plane APIs that AWS
 * does not bill (IAM, CloudTrail Describe/GetTrailStatus, EC2/RDS/EKS
 * Describe, Lambda List): no Cost Explorer, no CloudWatch metrics, no S3
 * requests. Every source settles on its own with a timeout, so a missing
 * permission only removes its checks and is reported as unavailable.
 *
 * collect*() do the I/O; adviseAws() is pure and turns the collected data
 * into a report (lib/advisor/core.js).
 */

const { check, buildReport, SECRET_NAME_RE } = require('./core');
const { classifyAwsError, buildAccessRequest } = require('../awsAccess');

const SOURCE_TIMEOUT_MS = 15000;
const MAX_PAGES = 10;
const DETAIL_LIMIT = 20;
const KEY_MAX_AGE_DAYS = 90;
const UNUSED_DAYS = 90;
const DAY_MS = 86400000;

const DOCS = {
  rootMfa: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/enable-virt-mfa-for-root.html',
  rootKeys: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user_manage_delete-key.html',
  userMfa: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable.html',
  keyRotation: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html#rotating_access_keys_console',
  unused: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_finding-unused.html',
  cloudtrail: 'https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-create-and-update-a-trail.html',
  trailValidation: 'https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html',
  securityGroups: 'https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html',
  imds: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-existing-instances.html',
  ebsEncryption: 'https://docs.aws.amazon.com/ebs/latest/userguide/encryption-by-default.html',
  rdsPublic: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html#USER_VPC.Hiding',
  rdsEncryption: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html',
  rdsBackup: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html',
  rdsMultiAz: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html',
  rdsDeletion: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html#USER_DeletionProtection',
  lambdaRuntimes: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html#runtimes-deprecated',
  lambdaSecrets: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html',
  lambdaTracing: 'https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html',
  graviton: 'https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html',
  instanceTypes: 'https://docs.aws.amazon.com/ec2/latest/instancetypes/instance-types.html#previous-gen-instances',
  publicInstances: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html',
  orphanVolumes: 'https://docs.aws.amazon.com/ebs/latest/userguide/ebs-deleting-volume.html',
  elasticIps: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html#using-instance-addressing-eips-releasing',
  eksEndpoint: 'https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html',
  eksSecrets: 'https://docs.aws.amazon.com/eks/latest/userguide/enable-kms.html',
  eksLogging: 'https://docs.aws.amazon.com/eks/latest/userguide/control-plane-logs.html',
};

const RULES = {
  rootMfa: { id: 'aws.root_mfa', category: 'security', severity: 'high', docs: DOCS.rootMfa },
  rootKeys: { id: 'aws.root_access_keys', category: 'security', severity: 'high', docs: DOCS.rootKeys },
  openPorts: { id: 'aws.open_admin_ports', category: 'security', severity: 'high', docs: DOCS.securityGroups },
  rdsPublic: { id: 'aws.rds_public', category: 'security', severity: 'high', docs: DOCS.rdsPublic },
  rdsUnencrypted: { id: 'aws.rds_unencrypted', category: 'security', severity: 'high', docs: DOCS.rdsEncryption },
  noTrail: { id: 'aws.no_cloudtrail', category: 'security', severity: 'high', docs: DOCS.cloudtrail },
  userMfa: { id: 'aws.user_no_mfa', category: 'security', severity: 'medium', docs: DOCS.userMfa },
  oldKeys: { id: 'aws.old_access_keys', category: 'security', severity: 'medium', docs: DOCS.keyRotation },
  imdsv1: { id: 'aws.imdsv1', category: 'security', severity: 'medium', docs: DOCS.imds },
  ebsDefault: { id: 'aws.ebs_default_encryption', category: 'security', severity: 'medium', docs: DOCS.ebsEncryption },
  lambdaSecrets: { id: 'aws.lambda_plain_secrets', category: 'security', severity: 'medium', docs: DOCS.lambdaSecrets },
  eksPublic: { id: 'aws.eks_public_endpoint', category: 'security', severity: 'medium', docs: DOCS.eksEndpoint },
  eksSecrets: { id: 'aws.eks_secrets_encryption', category: 'security', severity: 'medium', docs: DOCS.eksSecrets },
  singleRegionTrail: { id: 'aws.trail_single_region', category: 'security', severity: 'medium', docs: DOCS.cloudtrail },
  unusedCredentials: { id: 'aws.unused_credentials', category: 'security', severity: 'low', docs: DOCS.unused },
  trailValidation: { id: 'aws.trail_validation', category: 'security', severity: 'low', docs: DOCS.trailValidation },
  rdsNoBackup: { id: 'aws.rds_no_backup', category: 'infrastructure', severity: 'high', docs: DOCS.rdsBackup },
  rdsDeletion: { id: 'aws.rds_deletion_protection', category: 'infrastructure', severity: 'low', docs: DOCS.rdsDeletion },
  previousGen: { id: 'aws.previous_generation', category: 'infrastructure', severity: 'low', docs: DOCS.instanceTypes },
  orphanVolumes: { id: 'aws.orphan_volumes', category: 'infrastructure', severity: 'low', docs: DOCS.orphanVolumes },
  idleEips: { id: 'aws.idle_elastic_ips', category: 'infrastructure', severity: 'low', docs: DOCS.elasticIps },
  lambdaX86: { id: 'aws.lambda_x86', category: 'infrastructure', severity: 'low', docs: DOCS.graviton },
  rdsSingleAz: { id: 'aws.rds_single_az', category: 'architecture', severity: 'medium', docs: DOCS.rdsMultiAz },
  publicInstances: { id: 'aws.public_instances', category: 'architecture', severity: 'low', docs: DOCS.publicInstances },
  deprecatedRuntime: { id: 'aws.lambda_deprecated_runtime', category: 'development', severity: 'high', docs: DOCS.lambdaRuntimes },
  eksLogging: { id: 'aws.eks_control_plane_logs', category: 'development', severity: 'low', docs: DOCS.eksLogging },
  lambdaTracing: { id: 'aws.lambda_no_tracing', category: 'development', severity: 'low', docs: DOCS.lambdaTracing },
};

// Lambda runtimes past their deprecation date (AWS schedule as of 2026).
const DEPRECATED_RUNTIMES = new Set([
  'nodejs', 'nodejs4.3', 'nodejs4.3-edge', 'nodejs6.10', 'nodejs8.10', 'nodejs10.x', 'nodejs12.x', 'nodejs14.x', 'nodejs16.x', 'nodejs18.x',
  'python2.7', 'python3.6', 'python3.7', 'python3.8', 'python3.9',
  'ruby2.5', 'ruby2.7', 'ruby3.2',
  'java8', 'go1.x', 'provided',
  'dotnetcore1.0', 'dotnetcore2.0', 'dotnetcore2.1', 'dotnetcore3.1', 'dotnet5.0', 'dotnet6', 'dotnet7',
]);

// Ports that should never be open to the whole internet.
const SENSITIVE_PORTS = { 22: 'SSH', 3389: 'RDP', 3306: 'MySQL', 5432: 'PostgreSQL', 1433: 'SQL Server', 1521: 'Oracle', 27017: 'MongoDB', 6379: 'Redis', 9200: 'Elasticsearch', 11211: 'Memcached', 2375: 'Docker' };
const PREVIOUS_GEN_RE = /^(t1|t2|m1|m2|m3|m4|c1|c3|c4|r3|r4|i2|d2|g2|g3|p2|x1|x1e|cc2|cr1|hs1)\./;

// ── Collection ────────────────────────────────────────────────────────────────

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

function withTimeout(promise, ms = SOURCE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`No response after ${Math.round(ms / 1000)}s`), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function paginate(client, Command, input, { items, tokenIn = 'NextToken', tokenOut = 'NextToken' }) {
  const all = [];
  let token;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.send(new Command({ ...input, ...(token ? { [tokenIn]: token } : {}) }));
    all.push(...(response[items] || []));
    token = response[tokenOut];
    if (!token) break;
  }
  return all;
}

/** Parses the IAM credential report CSV into objects keyed by header. */
function parseCredentialReport(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  const headers = (lines.shift() || '').split(',');
  return lines.filter(Boolean).map(line => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function collectCredentialReport(sdk, cfg, { pollMs = 1500, attempts = 6 } = {}) {
  const { IAMClient, GenerateCredentialReportCommand, GetCredentialReportCommand } = sdk('client-iam');
  const client = new IAMClient({ ...cfg, region: 'us-east-1' });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await client.send(new GenerateCredentialReportCommand({}));
    if (state.State === 'COMPLETE') break;
    await wait(pollMs);
  }
  const report = await client.send(new GetCredentialReportCommand({}));
  const content = report.Content instanceof Uint8Array ? Buffer.from(report.Content).toString('utf8') : String(report.Content || '');
  return parseCredentialReport(content);
}

async function collectTrails(sdk, cfg) {
  const { CloudTrailClient, DescribeTrailsCommand, GetTrailStatusCommand } = sdk('client-cloudtrail');
  const client = new CloudTrailClient(cfg);
  const { trailList = [] } = await client.send(new DescribeTrailsCommand({ includeShadowTrails: true }));
  return Promise.all(trailList.slice(0, DETAIL_LIMIT).map(async trail => {
    let logging = null;
    try {
      const status = await client.send(new GetTrailStatusCommand({ Name: trail.TrailARN || trail.Name }));
      logging = !!status.IsLogging;
    } catch { /* status unknown: shadow trail from another region without permission */ }
    return { name: trail.Name, multiRegion: !!trail.IsMultiRegionTrail, validation: !!trail.LogFileValidationEnabled, logging };
  }));
}

async function collectEc2(sdk, cfg) {
  const { EC2Client, DescribeSecurityGroupsCommand, DescribeInstancesCommand, DescribeVolumesCommand, DescribeAddressesCommand, GetEbsEncryptionByDefaultCommand } = sdk('client-ec2');
  const client = new EC2Client(cfg);
  const [securityGroups, reservations, volumes, addresses, ebs] = await Promise.all([
    paginate(client, DescribeSecurityGroupsCommand, {}, { items: 'SecurityGroups' }),
    paginate(client, DescribeInstancesCommand, {}, { items: 'Reservations' }),
    paginate(client, DescribeVolumesCommand, { Filters: [{ Name: 'status', Values: ['available'] }] }, { items: 'Volumes' }),
    client.send(new DescribeAddressesCommand({})).then(r => r.Addresses || []),
    client.send(new GetEbsEncryptionByDefaultCommand({})).then(r => r.EbsEncryptionByDefault, () => null),
  ]);
  const instances = reservations.flatMap(r => r.Instances || []).filter(i => i.State?.Name !== 'terminated');
  return { securityGroups, instances, volumes, addresses, ebsEncryptionByDefault: ebs };
}

async function collectRds(sdk, cfg) {
  const { RDSClient, DescribeDBInstancesCommand } = sdk('client-rds');
  return paginate(new RDSClient(cfg), DescribeDBInstancesCommand, {}, { items: 'DBInstances', tokenIn: 'Marker', tokenOut: 'Marker' });
}

async function collectLambda(sdk, cfg) {
  const { LambdaClient, ListFunctionsCommand } = sdk('client-lambda');
  return paginate(new LambdaClient(cfg), ListFunctionsCommand, {}, { items: 'Functions', tokenIn: 'Marker', tokenOut: 'NextMarker' });
}

async function collectEks(sdk, cfg) {
  const { EKSClient, ListClustersCommand, DescribeClusterCommand } = sdk('client-eks');
  const client = new EKSClient(cfg);
  const names = await paginate(client, ListClustersCommand, {}, { items: 'clusters', tokenIn: 'nextToken', tokenOut: 'nextToken' });
  return Promise.all(names.slice(0, DETAIL_LIMIT).map(name =>
    client.send(new DescribeClusterCommand({ name })).then(r => r.cluster)));
}

const SOURCES = {
  credentials: collectCredentialReport,
  cloudtrail: collectTrails,
  ec2: collectEc2,
  rds: collectRds,
  lambda: collectLambda,
  eks: collectEks,
};

// IAM actions each source needs, for the access request shown when one is denied.
const SOURCE_ACTIONS = {
  credentials: ['iam:GenerateCredentialReport', 'iam:GetCredentialReport'],
  cloudtrail: ['cloudtrail:DescribeTrails', 'cloudtrail:GetTrailStatus'],
  ec2: ['ec2:DescribeSecurityGroups', 'ec2:DescribeInstances', 'ec2:DescribeVolumes', 'ec2:DescribeAddresses', 'ec2:GetEbsEncryptionByDefault'],
  rds: ['rds:DescribeDBInstances'],
  lambda: ['lambda:ListFunctions'],
  eks: ['eks:ListClusters', 'eks:DescribeCluster'],
};

/** Runs every collector; returns { data: { source: value }, unavailable: [...] }. */
async function collectAws(cfg, { sdk = defaultSdk } = {}) {
  const entries = Object.entries(SOURCES);
  const settled = await Promise.allSettled(entries.map(([, collect]) => withTimeout(collect(sdk, cfg))));
  const data = {};
  const unavailable = [];
  settled.forEach((result, index) => {
    const [name] = entries[index];
    if (result.status === 'fulfilled') { data[name] = result.value; return; }
    const error = classifyAwsError(result.reason);
    const access = buildAccessRequest({ error, route: name, catalog: SOURCE_ACTIONS });
    unavailable.push({ source: name, kind: error.kind, error: error.message, ...(error.action ? { action: error.action } : {}), ...(access ? { access } : {}) });
  });
  return { data, unavailable };
}

// ── Rules (pure) ──────────────────────────────────────────────────────────────

const tagName = tags => (tags || []).find(tag => tag.Key === 'Name')?.Value;
const daysSince = (value, now) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor((now - time) / DAY_MS) : null;
};

function openSensitivePorts(group) {
  const hits = new Set();
  for (const perm of group.IpPermissions || []) {
    const world = (perm.IpRanges || []).some(r => r.CidrIp === '0.0.0.0/0') || (perm.Ipv6Ranges || []).some(r => r.CidrIpv6 === '::/0');
    if (!world) continue;
    if (perm.IpProtocol === '-1') { hits.add('all ports'); continue; }
    const from = perm.FromPort ?? 0;
    const to = perm.ToPort ?? 65535;
    for (const [port, label] of Object.entries(SENSITIVE_PORTS)) {
      if (Number(port) >= from && Number(port) <= to) hits.add(`${label} ${port}`);
    }
  }
  return [...hits];
}

function credentialRules(rows, now) {
  const results = [];
  const root = rows.find(row => row.user === '<root_account>');
  const users = rows.filter(row => row.user !== '<root_account>');
  if (root) {
    results.push(check(RULES.rootMfa, root.mfa_active === 'false' ? [{ kind: 'Account', name: 'root' }] : []));
    const rootKeys = root.access_key_1_active === 'true' || root.access_key_2_active === 'true';
    results.push(check(RULES.rootKeys, rootKeys ? [{ kind: 'Account', name: 'root' }] : []));
  }
  results.push(check(RULES.userMfa, users
    .filter(row => row.password_enabled === 'true' && row.mfa_active === 'false')
    .map(row => ({ kind: 'IAM user', name: row.user }))));
  results.push(check(RULES.oldKeys, users.flatMap(row => [1, 2]
    .filter(n => row[`access_key_${n}_active`] === 'true')
    .map(n => ({ n, age: daysSince(row[`access_key_${n}_last_rotated`], now) }))
    .filter(key => key.age != null && key.age > KEY_MAX_AGE_DAYS)
    .map(key => ({ kind: 'Access key', name: row.user, detail: `key ${key.n} · ${key.age} days` }))), { days: KEY_MAX_AGE_DAYS }));
  results.push(check(RULES.unusedCredentials, users.flatMap(row => {
    const unused = [];
    if (row.password_enabled === 'true') {
      const used = daysSince(row.password_last_used, now);
      const created = daysSince(row.user_creation_time, now);
      if ((used ?? created) > UNUSED_DAYS) unused.push(`console ${used == null ? 'never used' : `${used} days`}`);
    }
    for (const n of [1, 2]) {
      if (row[`access_key_${n}_active`] !== 'true') continue;
      const used = daysSince(row[`access_key_${n}_last_used_date`], now);
      const rotated = daysSince(row[`access_key_${n}_last_rotated`], now);
      if ((used ?? rotated) > UNUSED_DAYS) unused.push(`key ${n} ${used == null ? 'never used' : `${used} days`}`);
    }
    return unused.length ? [{ kind: 'IAM user', name: row.user, detail: unused.join(' · ') }] : [];
  }), { days: UNUSED_DAYS }));
  return results;
}

function trailRules(trails) {
  const logging = trails.filter(trail => trail.logging !== false);
  return [
    check(RULES.noTrail, logging.length ? [] : [{ kind: 'Account', name: 'CloudTrail' }]),
    check(RULES.singleRegionTrail, logging.length && !logging.some(trail => trail.multiRegion) ? logging.map(trail => ({ kind: 'Trail', name: trail.name })) : []),
    check(RULES.trailValidation, logging.filter(trail => !trail.validation).map(trail => ({ kind: 'Trail', name: trail.name }))),
  ];
}

function ec2Rules({ securityGroups = [], instances = [], volumes = [], addresses = [], ebsEncryptionByDefault = null }) {
  const instanceRef = (instance, detail) => ({ kind: 'EC2', name: tagName(instance.Tags) || instance.InstanceId, ...(detail ? { detail } : {}) });
  const results = [
    check(RULES.openPorts, securityGroups
      .map(group => ({ group, ports: openSensitivePorts(group) }))
      .filter(({ ports }) => ports.length)
      .map(({ group, ports }) => ({ kind: 'Security group', name: `${group.GroupName} (${group.GroupId})`, detail: ports.join(', ') }))),
    check(RULES.imdsv1, instances
      .filter(instance => instance.MetadataOptions?.HttpTokens !== 'required' && instance.MetadataOptions?.HttpEndpoint !== 'disabled')
      .map(instance => instanceRef(instance))),
    check(RULES.previousGen, instances
      .filter(instance => PREVIOUS_GEN_RE.test(instance.InstanceType || ''))
      .map(instance => instanceRef(instance, instance.InstanceType))),
    check(RULES.publicInstances, instances
      .filter(instance => instance.PublicIpAddress)
      .map(instance => instanceRef(instance, instance.PublicIpAddress))),
    check(RULES.orphanVolumes, volumes.map(volume => ({ kind: 'EBS', name: tagName(volume.Tags) || volume.VolumeId, detail: `${volume.Size} GiB ${volume.VolumeType || ''}`.trim() }))),
    check(RULES.idleEips, addresses
      .filter(address => !address.AssociationId)
      .map(address => ({ kind: 'Elastic IP', name: address.PublicIp, ...(address.AllocationId ? { detail: address.AllocationId } : {}) }))),
  ];
  if (ebsEncryptionByDefault !== null) {
    results.push(check(RULES.ebsDefault, ebsEncryptionByDefault ? [] : [{ kind: 'Region', name: 'EBS encryption by default' }]));
  }
  return results;
}

function rdsRules(instances) {
  const dbRef = (db, detail) => ({ kind: 'RDS', name: db.DBInstanceIdentifier, ...(detail ? { detail } : {}) });
  const standalone = instances.filter(db => !db.DBClusterIdentifier);
  return [
    check(RULES.rdsPublic, instances.filter(db => db.PubliclyAccessible).map(db => dbRef(db, db.Engine))),
    check(RULES.rdsUnencrypted, instances.filter(db => !db.StorageEncrypted).map(db => dbRef(db, db.Engine))),
    // Aurora backups and Multi-AZ live on the cluster, not on its instances.
    check(RULES.rdsNoBackup, standalone.filter(db => !db.BackupRetentionPeriod).map(db => dbRef(db, db.Engine))),
    check(RULES.rdsSingleAz, standalone.filter(db => !db.MultiAZ).map(db => dbRef(db, db.DBInstanceClass))),
    check(RULES.rdsDeletion, instances.filter(db => !db.DeletionProtection).map(db => dbRef(db))),
  ];
}

function lambdaRules(functions) {
  const fnRef = (fn, detail) => ({ kind: 'Lambda', name: fn.FunctionName, ...(detail ? { detail } : {}) });
  // Container-image functions have no Runtime/Architectures choice to flag.
  const zipFunctions = functions.filter(fn => fn.PackageType !== 'Image');
  return [
    check(RULES.deprecatedRuntime, zipFunctions.filter(fn => DEPRECATED_RUNTIMES.has(fn.Runtime)).map(fn => fnRef(fn, fn.Runtime))),
    check(RULES.lambdaSecrets, functions
      .map(fn => {
        const names = Object.keys(fn.Environment?.Variables || {}).filter(name => SECRET_NAME_RE.test(name) && !/_(ARN|NAME|ID|PARAM|PATH)$/i.test(name));
        return names.length ? fnRef(fn, names.join(', ')) : null;
      })),
    check(RULES.lambdaX86, zipFunctions
      .filter(fn => !(fn.Architectures || ['x86_64']).includes('arm64'))
      .map(fn => fnRef(fn, fn.Runtime))),
    check(RULES.lambdaTracing, functions.filter(fn => fn.TracingConfig?.Mode !== 'Active').map(fn => fnRef(fn))),
  ];
}

function eksRules(clusters) {
  const ref = (cluster, detail) => ({ kind: 'EKS', name: cluster.name, ...(detail ? { detail } : {}) });
  return [
    check(RULES.eksPublic, clusters
      .filter(cluster => cluster.resourcesVpcConfig?.endpointPublicAccess && (cluster.resourcesVpcConfig.publicAccessCidrs || ['0.0.0.0/0']).includes('0.0.0.0/0'))
      .map(cluster => ref(cluster))),
    check(RULES.eksSecrets, clusters
      .filter(cluster => !(cluster.encryptionConfig || []).some(config => (config.resources || []).includes('secrets')))
      .map(cluster => ref(cluster))),
    check(RULES.eksLogging, clusters
      .filter(cluster => !(cluster.logging?.clusterLogging || []).some(entry => entry.enabled && (entry.types || []).length))
      .map(cluster => ref(cluster))),
  ];
}

/** Pure: collected data → report. */
function adviseAws({ data = {}, unavailable = [], region = null, now = Date.now() } = {}) {
  const results = [];
  if (data.credentials) results.push(...credentialRules(data.credentials, now));
  if (data.cloudtrail) results.push(...trailRules(data.cloudtrail));
  if (data.ec2) results.push(...ec2Rules(data.ec2));
  if (data.rds) results.push(...rdsRules(data.rds));
  if (data.lambda) results.push(...lambdaRules(data.lambda));
  if (data.eks) results.push(...eksRules(data.eks));
  return buildReport(results, { unavailable, scope: { provider: 'aws', region }, now });
}

async function buildAwsAdvisor(cfg, { sdk = defaultSdk, now = Date.now() } = {}) {
  const { data, unavailable } = await collectAws(cfg, { sdk });
  return adviseAws({ data, unavailable, region: cfg.region || null, now });
}

module.exports = {
  RULES,
  SOURCE_ACTIONS,
  DEPRECATED_RUNTIMES,
  parseCredentialReport,
  openSensitivePorts,
  collectAws,
  adviseAws,
  buildAwsAdvisor,
};

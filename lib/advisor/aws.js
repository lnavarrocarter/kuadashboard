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
const S3_API_REQUEST_COST_PER_1000 = 0.0004;
const S3_REQUESTS_PER_BUCKET_ESTIMATE = 5;
const S3_FIXED_REQUEST_ESTIMATE = 2;

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
  s3AccountBlockPublicAccess: { id: 'aws.s3_account_public_access', category: 'security', severity: 'high', docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html' },
  s3BucketBlockPublicAccess: { id: 'aws.s3_bucket_public_access', category: 'security', severity: 'high', docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html' },
  s3Encryption: { id: 'aws.s3_encryption', category: 'security', severity: 'medium', docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html' },
  s3Versioning: { id: 'aws.s3_versioning', category: 'infrastructure', severity: 'low', docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html' },
  s3Logging: { id: 'aws.s3_logging', category: 'security', severity: 'low', docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerLogs.html' },
  wildcardIamPolicy: { id: 'aws.iam_wildcard_policy', category: 'security', severity: 'high', docs: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html' },
  unusedIamRole: { id: 'aws.iam_unused_role', category: 'security', severity: 'low', docs: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_manage_delete.html' },
  weakPasswordPolicy: { id: 'aws.iam_weak_password_policy', category: 'security', severity: 'medium', docs: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_account-policy.html' },
  sqsUnencrypted: { id: 'aws.sqs_unencrypted', category: 'security', severity: 'medium', docs: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html' },
  snsUnencrypted: { id: 'aws.sns_unencrypted', category: 'security', severity: 'medium', docs: 'https://docs.aws.amazon.com/sns/latest/dg/sns-server-side-encryption.html' },
  dynamodbNoPitr: { id: 'aws.dynamodb_no_pitr', category: 'infrastructure', severity: 'medium', docs: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html' },
  cloudfrontWeakTls: { id: 'aws.cloudfront_weak_tls', category: 'security', severity: 'medium', docs: 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/secure-connections-supported-viewer-protocols-ciphers.html' },
};

// Lambda runtimes past their deprecation date (AWS schedule as of 2026).
const DEPRECATED_RUNTIMES = new Set([
  'nodejs', 'nodejs4.3', 'nodejs4.3-edge', 'nodejs6.10', 'nodejs8.10', 'nodejs10.x', 'nodejs12.x', 'nodejs14.x', 'nodejs16.x', 'nodejs18.x',
  'python2.7', 'python3.6', 'python3.7', 'python3.8', 'python3.9',
  'ruby2.5', 'ruby2.7', 'ruby3.2',
  'java8', 'go1.x', 'provided',
  'dotnetcore1.0', 'dotnetcore2.0', 'dotnetcore2.1', 'dotnetcore3.1', 'dotnet5.0', 'dotnet6', 'dotnet7',
]);
const DEPRECATED_RUNTIMES_REVIEWED_AT = '2026-10-07';

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
  return markTruncated(all, !!token);
}

function markTruncated(value, truncated) {
  Object.defineProperty(value, 'truncated', { value: !!truncated, configurable: true });
  return value;
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
  const details = await Promise.all(trailList.slice(0, DETAIL_LIMIT).map(async trail => {
    let logging = null;
    try {
      const status = await client.send(new GetTrailStatusCommand({ Name: trail.TrailARN || trail.Name }));
      logging = !!status.IsLogging;
    } catch { /* status unknown: shadow trail from another region without permission */ }
    return { name: trail.Name, multiRegion: !!trail.IsMultiRegionTrail, validation: !!trail.LogFileValidationEnabled, logging };
  }));
  return markTruncated(details, trailList.length > DETAIL_LIMIT);
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
  return {
    securityGroups,
    instances,
    volumes,
    addresses,
    ebsEncryptionByDefault: ebs,
    truncated: [securityGroups, reservations, volumes].some(value => value.truncated),
  };
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
  const clusters = await Promise.all(names.slice(0, DETAIL_LIMIT).map(name =>
    client.send(new DescribeClusterCommand({ name })).then(r => r.cluster)));
  return markTruncated(clusters, names.truncated || names.length > DETAIL_LIMIT);
}

async function collectIam(sdk, cfg) {
  const { IAMClient, ListPoliciesCommand, GetPolicyVersionCommand, ListRolesCommand, GetAccountPasswordPolicyCommand } = sdk('client-iam');
  const client = new IAMClient({ ...cfg, region: 'us-east-1' });
  const [policies, roles, passwordPolicy] = await Promise.all([
    paginate(client, ListPoliciesCommand, { Scope: 'Local' }, { items: 'Policies' }),
    paginate(client, ListRolesCommand, {}, { items: 'Roles' }),
    client.send(new GetAccountPasswordPolicyCommand({})).then(response => response.PasswordPolicy, error => {
      if (error.name === 'NoSuchEntityException' || error.name === 'NoSuchEntity') return null;
      throw error;
    }),
  ]);
  const policyDetails = await Promise.all(policies.slice(0, DETAIL_LIMIT).map(async policy => {
    const version = await client.send(new GetPolicyVersionCommand({ PolicyArn: policy.Arn, VersionId: policy.DefaultVersionId }));
    return { name: policy.PolicyName, document: version.PolicyVersion?.Document };
  }));
  return {
    policies: policyDetails,
    roles,
    passwordPolicy,
    policiesTruncated: policies.length > DETAIL_LIMIT,
    truncated: policies.truncated || roles.truncated || policies.length > DETAIL_LIMIT,
  };
}

async function collectSqs(sdk, cfg) {
  const { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } = sdk('client-sqs');
  const client = new SQSClient(cfg);
  const urls = await paginate(client, ListQueuesCommand, {}, { items: 'QueueUrls', tokenIn: 'NextToken', tokenOut: 'NextToken' });
  const queues = await Promise.all(urls.slice(0, DETAIL_LIMIT).map(async QueueUrl => {
    const response = await client.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['SqsManagedSseEnabled', 'KmsMasterKeyId'] }));
    return { QueueName: QueueUrl.split('/').pop(), ...response.Attributes };
  }));
  return markTruncated(queues, urls.truncated || urls.length > DETAIL_LIMIT);
}

async function collectSns(sdk, cfg) {
  const { SNSClient, ListTopicsCommand, GetTopicAttributesCommand } = sdk('client-sns');
  const client = new SNSClient(cfg);
  const topics = await paginate(client, ListTopicsCommand, {}, { items: 'Topics', tokenIn: 'NextToken', tokenOut: 'NextToken' });
  const details = await Promise.all(topics.slice(0, DETAIL_LIMIT).map(async topic => {
    const response = await client.send(new GetTopicAttributesCommand({ TopicArn: topic.TopicArn }));
    return { TopicArn: topic.TopicArn, ...response.Attributes };
  }));
  return markTruncated(details, topics.truncated || topics.length > DETAIL_LIMIT);
}

async function collectDynamoDb(sdk, cfg) {
  const { DynamoDBClient, ListTablesCommand, DescribeContinuousBackupsCommand } = sdk('client-dynamodb');
  const client = new DynamoDBClient(cfg);
  const names = await paginate(client, ListTablesCommand, {}, { items: 'TableNames', tokenIn: 'ExclusiveStartTableName', tokenOut: 'LastEvaluatedTableName' });
  const tables = await Promise.all(names.slice(0, DETAIL_LIMIT).map(async TableName => ({
    TableName,
    ...(await client.send(new DescribeContinuousBackupsCommand({ TableName }))),
  })));
  return markTruncated(tables, names.truncated || names.length > DETAIL_LIMIT);
}

async function collectCloudFront(sdk, cfg) {
  const { CloudFrontClient, ListDistributionsCommand } = sdk('client-cloudfront');
  const client = new CloudFrontClient(cfg);
  const distributions = [];
  let Marker;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.send(new ListDistributionsCommand({ ...(Marker ? { Marker } : {}) }));
    const list = response.DistributionList || {};
    distributions.push(...(list.Items || []));
    if (!list.IsTruncated || !list.NextMarker) break;
    Marker = list.NextMarker;
  }
  return markTruncated(distributions, !!Marker);
}

async function collectS3Advisor(cfg, { sdk = defaultSdk, accountId = null, expectedBucketCount, now = Date.now() } = {}) {
  const { S3Client, ListBucketsCommand, GetBucketLocationCommand, GetBucketPublicAccessBlockCommand,
    GetBucketEncryptionCommand, GetBucketVersioningCommand, GetBucketLoggingCommand } = sdk('client-s3');
  const inventoryClient = new S3Client({ ...cfg, region: 'us-east-1' });
  const buckets = [];
  let continuationToken;
  let inventoryTruncated = false;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await inventoryClient.send(new ListBucketsCommand({ ContinuationToken: continuationToken }));
    buckets.push(...(page.Buckets || []));
    continuationToken = page.ContinuationToken || page.NextContinuationToken;
    if (!continuationToken) break;
    if (pageNumber === MAX_PAGES - 1) inventoryTruncated = true;
  }
  const bucketCount = buckets.length;
  const estimate = estimateS3AdvisorCost(bucketCount);
  if (bucketCount !== expectedBucketCount || inventoryTruncated) {
    return { inventoryChanged: true, bucketCount, ...estimate };
  }

  const unavailable = [];
  const accessCatalog = { 'GET /overview/advisor/s3': [
    's3:ListAllMyBuckets', 's3:GetBucketLocation', 's3:GetBucketPublicAccessBlock',
    's3:GetEncryptionConfiguration', 's3:GetBucketVersioning', 's3:GetBucketLogging',
    's3control:GetPublicAccessBlock',
  ] };
  const recordUnavailable = (source, error) => {
    const classified = classifyAwsError(error);
    const access = buildAccessRequest({ error: classified, route: 'GET /overview/advisor/s3', catalog: accessCatalog, account: accountId, region: 'global' });
    unavailable.push({ source, kind: classified.kind, error: classified.message, ...(classified.action ? { action: classified.action } : {}), ...(access ? { access } : {}) });
  };
  const readConfig = async (source, operation, missingCodes = []) => {
    try { return { available: true, value: await operation() }; }
    catch (error) {
      if (missingCodes.includes(error.name || error.Code)) return { available: true, value: {} };
      recordUnavailable(source, error);
      return { available: false, value: undefined };
    }
  };

  let accountBlock = { available: false, value: undefined };
  if (accountId) {
    const { S3ControlClient, GetPublicAccessBlockCommand } = sdk('client-s3-control');
    const controlClient = new S3ControlClient({ ...cfg, region: 'us-east-1' });
    accountBlock = await readConfig('s3.accountPublicAccessBlock', () =>
      controlClient.send(new GetPublicAccessBlockCommand({ AccountId: accountId })), ['NoSuchPublicAccessBlockConfiguration']);
  } else {
    unavailable.push({ source: 's3.accountPublicAccessBlock', kind: 'unavailable', error: 'AWS account ID could not be resolved' });
  }

  const inspectedBuckets = new Array(bucketCount);
  let nextIndex = 0;
  const inspectBucket = async bucket => {
    const name = bucket.Name;
    let region = bucket.BucketRegion || '';
    if (!region) {
      const location = await readConfig(`s3.location.${name}`, () => inventoryClient.send(new GetBucketLocationCommand({ Bucket: name })));
      region = location.value?.LocationConstraint || cfg.region || 'us-east-1';
    }
    const client = region === 'us-east-1' ? inventoryClient : new S3Client({ ...cfg, region });
    const result = { name, checks: {} };
    const reads = [
      ['publicAccessBlock', GetBucketPublicAccessBlockCommand, 'PublicAccessBlockConfiguration', ['NoSuchPublicAccessBlockConfiguration']],
      ['encryption', GetBucketEncryptionCommand, null, ['ServerSideEncryptionConfigurationNotFoundError', 'NoSuchEncryptionConfiguration']],
      ['versioning', GetBucketVersioningCommand, null, []],
      ['logging', GetBucketLoggingCommand, null, []],
    ];
    await Promise.all(reads.map(async ([key, Command, field, missingCodes]) => {
      const response = await readConfig(`s3.${key}.${name}`, () => client.send(new Command({ Bucket: name })), missingCodes);
      result.checks[key] = response.available;
      if (response.available) result[key] = field ? response.value[field] || {} : response.value;
    }));
    return result;
  };
  const workers = Array.from({ length: Math.min(8, bucketCount) }, async () => {
    while (nextIndex < bucketCount) {
      const index = nextIndex++;
      inspectedBuckets[index] = await inspectBucket(buckets[index]);
    }
  });
  await Promise.all(workers);
  const report = adviseAws({ data: { s3: {
    accountPublicAccessBlock: accountBlock.value?.PublicAccessBlockConfiguration || {},
    accountPublicAccessBlockAvailable: accountBlock.available,
    bucketInventoryComplete: true,
    buckets: inspectedBuckets,
  } }, unavailable, region: 'global', now });
  return { report, bucketCount, ...estimate, generatedAt: report.generatedAt };
}

const SOURCES = {
  credentials: collectCredentialReport,
  cloudtrail: collectTrails,
  ec2: collectEc2,
  rds: collectRds,
  lambda: collectLambda,
  eks: collectEks,
  iam: collectIam,
  sqs: collectSqs,
  sns: collectSns,
  dynamodb: collectDynamoDb,
  cloudfront: collectCloudFront,
};

// IAM actions each source needs, for the access request shown when one is denied.
const SOURCE_ACTIONS = {
  credentials: ['iam:GenerateCredentialReport', 'iam:GetCredentialReport'],
  cloudtrail: ['cloudtrail:DescribeTrails', 'cloudtrail:GetTrailStatus'],
  ec2: ['ec2:DescribeSecurityGroups', 'ec2:DescribeInstances', 'ec2:DescribeVolumes', 'ec2:DescribeAddresses', 'ec2:GetEbsEncryptionByDefault'],
  rds: ['rds:DescribeDBInstances'],
  lambda: ['lambda:ListFunctions'],
  eks: ['eks:ListClusters', 'eks:DescribeCluster'],
  iam: ['iam:ListPolicies', 'iam:GetPolicyVersion', 'iam:ListRoles', 'iam:GetAccountPasswordPolicy'],
  sqs: ['sqs:ListQueues', 'sqs:GetQueueAttributes'],
  sns: ['sns:ListTopics', 'sns:GetTopicAttributes'],
  dynamodb: ['dynamodb:ListTables', 'dynamodb:DescribeContinuousBackups'],
  cloudfront: ['cloudfront:ListDistributions'],
};

/** Runs every collector; returns { data: { source: value }, unavailable: [...] }. */
async function collectAws(cfg, { sdk = defaultSdk } = {}) {
  const entries = Object.entries(SOURCES);
  const settled = await Promise.allSettled(entries.map(([, collect]) => withTimeout(collect(sdk, cfg))));
  const data = {};
  const unavailable = [];
  settled.forEach((result, index) => {
    const [name] = entries[index];
    if (result.status === 'fulfilled') {
      data[name] = result.value;
      if (result.value?.truncated) unavailable.push({ source: name, kind: 'partial', error: 'Collection reached its configured page or detail limit' });
      return;
    }
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

function wildcardPolicy(policy) {
  let document = policy.document ?? policy.PolicyVersion?.Document ?? policy.Document;
  if (typeof document === 'string') {
    try { document = JSON.parse(decodeURIComponent(document)); } catch { return false; }
  }
  const statements = Array.isArray(document?.Statement) ? document.Statement : [document?.Statement].filter(Boolean);
  return statements.some(statement => {
    if (String(statement.Effect || '').toLowerCase() !== 'allow') return false;
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
    return actions.includes('*') && resources.includes('*');
  });
}

function iamRules({ policies = [], roles = [], passwordPolicy } = {}, now) {
  const results = [
    check(RULES.wildcardIamPolicy, policies.filter(wildcardPolicy)
      .map(policy => ({ kind: 'IAM policy', name: policy.name || policy.PolicyName || 'inline policy', detail: policy.scope || '' }))),
    check(RULES.unusedIamRole, roles
      .filter(role => !String(role.Path || '').startsWith('/aws-service-role/'))
      .filter(role => {
        const usedAt = Date.parse(role.RoleLastUsed?.LastUsedDate || role.lastUsedAt || '');
        return !Number.isFinite(usedAt) || now - usedAt > UNUSED_DAYS * DAY_MS;
      })
      .map(role => ({ kind: 'IAM role', name: role.RoleName || role.name, detail: role.RoleLastUsed?.LastUsedDate || role.lastUsedAt ? `${UNUSED_DAYS}+ days` : 'never used' })), { days: UNUSED_DAYS }),
  ];
  if (passwordPolicy !== undefined) {
    const missing = !passwordPolicy;
    const policy = passwordPolicy || {};
    const weak = missing || Number(policy.MinimumPasswordLength || 0) < 14
      || !policy.RequireUppercaseCharacters || !policy.RequireLowercaseCharacters
      || !policy.RequireNumbers || !policy.RequireSymbols
      || (policy.MaxPasswordAge > 0 && policy.MaxPasswordAge > UNUSED_DAYS);
    results.push(check(RULES.weakPasswordPolicy, weak ? [{ kind: 'Account', name: 'IAM password policy', detail: missing ? 'not configured' : 'does not meet baseline' }] : []));
  }
  return results;
}

function s3Rules({ accountPublicAccessBlock, accountPublicAccessBlockAvailable = true, bucketInventoryComplete = false, buckets = [] } = {}) {
  const blockComplete = block => block && ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every(key => block[key] === true);
  const encrypted = bucket => bucket.encryption?.defaultEncryption === true
    || (bucket.encryption?.Rules || []).some(rule => ['AES256', 'aws:kms', 'aws:kms:dsse'].includes(rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm));
  const results = [];
  if (accountPublicAccessBlockAvailable) {
    results.push(check(RULES.s3AccountBlockPublicAccess, blockComplete(accountPublicAccessBlock) ? [] : [{ kind: 'Account', name: 'S3 Block Public Access' }]));
  }
  const checks = [
    ['publicAccessBlock', RULES.s3BucketBlockPublicAccess, bucket => !blockComplete(bucket.publicAccessBlock)],
    ['encryption', RULES.s3Encryption, bucket => !encrypted(bucket)],
    ['versioning', RULES.s3Versioning, bucket => bucket.versioning?.Status !== 'Enabled'],
    ['logging', RULES.s3Logging, bucket => !bucket.logging?.LoggingEnabled],
  ];
  for (const [key, rule, isFinding] of checks) {
    const evaluated = buckets.filter(bucket => !bucket.checks || bucket.checks[key] === true);
    if (evaluated.length || (bucketInventoryComplete && buckets.length === 0)) {
      results.push(check(rule, evaluated.filter(isFinding).map(bucket => ({ kind: 'S3 bucket', name: bucket.name }))));
    }
  }
  return results;
}

function estimateS3AdvisorCost(bucketCount) {
  const count = Math.max(0, Math.floor(Number(bucketCount) || 0));
  const listRequests = Math.max(1, Math.ceil(count / 1000));
  const requestCount = S3_FIXED_REQUEST_ESTIMATE + listRequests - 1 + S3_REQUESTS_PER_BUCKET_ESTIMATE * count;
  return { requestCount, estimatedUsd: Number((requestCount * S3_API_REQUEST_COST_PER_1000 / 1000).toFixed(8)) };
}

function serviceRules({ sqs = [], sns = [], dynamodb = [], cloudfront = [] } = {}) {
  const enabled = value => value === true || String(value || '').toLowerCase() === 'true';
  return [
    check(RULES.sqsUnencrypted, sqs.filter(queue => !enabled(queue.SqsManagedSseEnabled) && !queue.KmsMasterKeyId)
      .map(queue => ({ kind: 'SQS queue', name: queue.name || queue.QueueName }))),
    check(RULES.snsUnencrypted, sns.filter(topic => !topic.KmsMasterKeyId)
      .map(topic => ({ kind: 'SNS topic', name: topic.name || topic.TopicArn?.split(':').pop() }))),
    check(RULES.dynamodbNoPitr, dynamodb.filter(table => table.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus !== 'ENABLED')
      .map(table => ({ kind: 'DynamoDB table', name: table.TableName }))),
    check(RULES.cloudfrontWeakTls, cloudfront.filter(distribution => !/^TLSv1\.2/.test(distribution.ViewerCertificate?.MinimumProtocolVersion || ''))
      .map(distribution => ({ kind: 'CloudFront distribution', name: distribution.Id, detail: distribution.ViewerCertificate?.MinimumProtocolVersion || 'unknown' }))),
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
  if (data.iam) results.push(...iamRules(data.iam, now));
  if (data.s3) results.push(...s3Rules(data.s3));
  if (data.sqs) results.push(...serviceRules({ sqs: data.sqs }));
  if (data.sns) results.push(...serviceRules({ sns: data.sns }));
  if (data.dynamodb) results.push(...serviceRules({ dynamodb: data.dynamodb }));
  if (data.cloudfront) results.push(...serviceRules({ cloudfront: data.cloudfront }));
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
  DEPRECATED_RUNTIMES_REVIEWED_AT,
  estimateS3AdvisorCost,
  parseCredentialReport,
  openSensitivePorts,
  collectAws,
  collectS3Advisor,
  adviseAws,
  buildAwsAdvisor,
};

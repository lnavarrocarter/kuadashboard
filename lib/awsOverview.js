'use strict';

// AWS environment overview: who the active profile is, where it points, and
// which services have resources. Every service is counted on its own with a
// timeout, so a missing permission or a slow API only affects its own card.

const SERVICE_TIMEOUT_MS = 12000;
const MAX_PAGES = 10;

/** Loads an AWS SDK v3 client lazily, like routes/aws.js does. */
function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

/** Follows a paginated list API up to MAX_PAGES; returns the items and whether it stopped early. */
async function paginate(client, Command, input, { items, tokenIn, tokenOut }) {
  const all = [];
  let token;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.send(new Command({ ...input, ...(token ? { [tokenIn]: token } : {}) }));
    all.push(...(response[items] || []));
    token = response[tokenOut];
    if (!token) return { items: all, truncated: false };
  }
  return { items: all, truncated: true };
}

/**
 * Service catalog. `tab` is the AwsView tab the card opens; `scope` tells
 * whether the count is for the profile's region or the whole account.
 */
const SERVICES = [
  {
    id: 'ec2', tab: 'ec2', label: 'EC2', scope: 'regional',
    async count(sdk, cfg) {
      const { EC2Client, DescribeInstancesCommand } = sdk('client-ec2');
      const { items, truncated } = await paginate(new EC2Client(cfg), DescribeInstancesCommand, {}, { items: 'Reservations', tokenIn: 'NextToken', tokenOut: 'NextToken' });
      const instances = items.flatMap(r => r.Instances || []).filter(i => i.State?.Name !== 'terminated');
      const running = instances.filter(i => i.State?.Name === 'running').length;
      return { count: instances.length, truncated, detail: { running, stopped: instances.filter(i => i.State?.Name === 'stopped').length } };
    },
  },
  {
    id: 'lambda', tab: 'lambda', label: 'Lambda', scope: 'regional',
    // One call for the regional total instead of paging ListFunctions 50 at a time.
    async count(sdk, cfg) {
      const { LambdaClient, GetAccountSettingsCommand } = sdk('client-lambda');
      const response = await new LambdaClient(cfg).send(new GetAccountSettingsCommand({}));
      return { count: response.AccountUsage?.FunctionCount ?? 0, truncated: false };
    },
  },
  {
    id: 'ecs', tab: 'ecs', label: 'ECS', scope: 'regional',
    async count(sdk, cfg) {
      const { ECSClient, ListClustersCommand, ListServicesCommand } = sdk('client-ecs');
      const client = new ECSClient(cfg);
      const { items: clusters, truncated } = await paginate(client, ListClustersCommand, {}, { items: 'clusterArns', tokenIn: 'nextToken', tokenOut: 'nextToken' });
      const pages = await Promise.all(clusters.slice(0, 20).map(cluster =>
        paginate(client, ListServicesCommand, { cluster }, { items: 'serviceArns', tokenIn: 'nextToken', tokenOut: 'nextToken' })));
      const services = pages.reduce((sum, page) => sum + page.items.length, 0);
      return { count: clusters.length, truncated: truncated || clusters.length > 20, detail: { services } };
    },
  },
  {
    id: 'eks', tab: 'eks', label: 'EKS', scope: 'regional',
    async count(sdk, cfg) {
      const { EKSClient, ListClustersCommand } = sdk('client-eks');
      const { items, truncated } = await paginate(new EKSClient(cfg), ListClustersCommand, {}, { items: 'clusters', tokenIn: 'nextToken', tokenOut: 'nextToken' });
      return { count: items.length, truncated };
    },
  },
  {
    id: 'ecr', tab: 'ecr', label: 'ECR', scope: 'regional',
    async count(sdk, cfg) {
      const { ECRClient, DescribeRepositoriesCommand } = sdk('client-ecr');
      const { items, truncated } = await paginate(new ECRClient(cfg), DescribeRepositoriesCommand, {}, { items: 'repositories', tokenIn: 'nextToken', tokenOut: 'nextToken' });
      return { count: items.length, truncated };
    },
  },
  {
    id: 'vpc', tab: 'vpc', label: 'VPC', scope: 'regional',
    async count(sdk, cfg) {
      const { EC2Client, DescribeVpcsCommand } = sdk('client-ec2');
      const { items, truncated } = await paginate(new EC2Client(cfg), DescribeVpcsCommand, {}, { items: 'Vpcs', tokenIn: 'NextToken', tokenOut: 'NextToken' });
      return { count: items.length, truncated, detail: { custom: items.filter(v => !v.IsDefault).length } };
    },
  },
  {
    id: 'apigw', tab: 'apigw', label: 'API Gateway', scope: 'regional',
    async count(sdk, cfg) {
      const { APIGatewayClient, GetRestApisCommand } = sdk('client-api-gateway');
      const { ApiGatewayV2Client, GetApisCommand } = sdk('client-apigatewayv2');
      const [rest, http] = await Promise.all([
        paginate(new APIGatewayClient(cfg), GetRestApisCommand, {}, { items: 'items', tokenIn: 'position', tokenOut: 'position' }),
        paginate(new ApiGatewayV2Client(cfg), GetApisCommand, {}, { items: 'Items', tokenIn: 'NextToken', tokenOut: 'NextToken' }),
      ]);
      return { count: rest.items.length + http.items.length, truncated: rest.truncated || http.truncated, detail: { rest: rest.items.length, http: http.items.length } };
    },
  },
  {
    id: 's3', tab: 's3', label: 'S3', scope: 'global',
    async count(sdk, cfg) {
      const { S3Client, ListBucketsCommand } = sdk('client-s3');
      const response = await new S3Client(cfg).send(new ListBucketsCommand({}));
      return { count: (response.Buckets || []).length, truncated: false };
    },
  },
  {
    id: 'dynamodb', tab: 'dynamodb', label: 'DynamoDB', scope: 'regional',
    async count(sdk, cfg) {
      const { DynamoDBClient, ListTablesCommand } = sdk('client-dynamodb');
      const { items, truncated } = await paginate(new DynamoDBClient(cfg), ListTablesCommand, {}, { items: 'TableNames', tokenIn: 'ExclusiveStartTableName', tokenOut: 'LastEvaluatedTableName' });
      return { count: items.length, truncated };
    },
  },
  {
    id: 'rds', tab: 'rds', label: 'RDS', scope: 'regional',
    async count(sdk, cfg) {
      const { RDSClient, DescribeDBInstancesCommand } = sdk('client-rds');
      const { items, truncated } = await paginate(new RDSClient(cfg), DescribeDBInstancesCommand, {}, { items: 'DBInstances', tokenIn: 'Marker', tokenOut: 'Marker' });
      return { count: items.length, truncated, detail: { available: items.filter(db => db.DBInstanceStatus === 'available').length } };
    },
  },
  {
    id: 'eventbridge', tab: 'eventbridge', label: 'EventBridge', scope: 'regional',
    async count(sdk, cfg) {
      const { EventBridgeClient, ListRulesCommand } = sdk('client-eventbridge');
      const { items, truncated } = await paginate(new EventBridgeClient(cfg), ListRulesCommand, {}, { items: 'Rules', tokenIn: 'NextToken', tokenOut: 'NextToken' });
      return { count: items.length, truncated, detail: { enabled: items.filter(rule => rule.State === 'ENABLED').length } };
    },
  },
  {
    id: 'stepfn', tab: 'stepfn', label: 'Step Functions', scope: 'regional',
    async count(sdk, cfg) {
      const { SFNClient, ListStateMachinesCommand } = sdk('client-sfn');
      const { items, truncated } = await paginate(new SFNClient(cfg), ListStateMachinesCommand, {}, { items: 'stateMachines', tokenIn: 'nextToken', tokenOut: 'nextToken' });
      return { count: items.length, truncated };
    },
  },
  {
    id: 'cloudfront', tab: 'cloudfront', label: 'CloudFront', scope: 'global',
    async count(sdk, cfg) {
      const { CloudFrontClient, ListDistributionsCommand } = sdk('client-cloudfront');
      const response = await new CloudFrontClient(cfg).send(new ListDistributionsCommand({}));
      const list = response.DistributionList || {};
      return { count: list.Quantity ?? (list.Items || []).length, truncated: !!list.IsTruncated };
    },
  },
  {
    id: 'route53', tab: 'route53', label: 'Route 53', scope: 'global',
    async count(sdk, cfg) {
      const { Route53Client, ListHostedZonesCommand } = sdk('client-route-53');
      const { items, truncated } = await paginate(new Route53Client(cfg), ListHostedZonesCommand, {}, { items: 'HostedZones', tokenIn: 'Marker', tokenOut: 'NextMarker' });
      return { count: items.length, truncated };
    },
  },
  {
    id: 'cognito', tab: 'cognito', label: 'Cognito', scope: 'regional',
    async count(sdk, cfg) {
      const { CognitoIdentityProviderClient, ListUserPoolsCommand } = sdk('client-cognito-identity-provider');
      const { items, truncated } = await paginate(new CognitoIdentityProviderClient(cfg), ListUserPoolsCommand, { MaxResults: 60 }, { items: 'UserPools', tokenIn: 'NextToken', tokenOut: 'NextToken' });
      return { count: items.length, truncated };
    },
  },
  {
    id: 'secrets', tab: 'secrets', label: 'Secrets Manager', scope: 'regional',
    async count(sdk, cfg) {
      const { SecretsManagerClient, ListSecretsCommand } = sdk('client-secrets-manager');
      const { items, truncated } = await paginate(new SecretsManagerClient(cfg), ListSecretsCommand, {}, { items: 'SecretList', tokenIn: 'NextToken', tokenOut: 'NextToken' });
      return { count: items.length, truncated };
    },
  },
];

const DENIED_NAMES = new Set([
  'AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation', 'UnauthorizedException',
  'AuthorizationError', 'AuthorizationErrorException', 'NotAuthorized',
]);

/**
 * Classifies an AWS SDK error: 'denied' (IAM permission), 'expired'
 * (session credentials), 'timeout' or 'error'. For denied errors the IAM
 * action is read from the message when AWS includes it.
 */
function classifyAwsError(err = {}) {
  const name = err.name || err.Code || '';
  const message = err.message || String(err);
  const status = err.$metadata?.httpStatusCode;
  if (name === 'TimeoutError') return { kind: 'timeout', message };
  if (/ExpiredToken|RequestExpired/.test(name) || /security token.*expired/i.test(message)) return { kind: 'expired', message };
  const denied = DENIED_NAMES.has(name) || /is not authorized to perform|not authorized to perform|AccessDenied/i.test(message) || status === 403;
  if (!denied) return { kind: 'error', message };
  const action = message.match(/perform:\s*([a-z0-9-]+:[A-Za-z0-9*]+)/i)?.[1] || null;
  const resource = message.match(/on resource:\s*(\S+?)(?:\s|$|\.? because)/)?.[1] || null;
  return { kind: 'denied', message, action, resource };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`No response after ${Math.round(ms / 1000)}s`), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Parses a caller ARN (arn:aws:sts::123:assumed-role/Role/session,
 * arn:aws:iam::123:user/path/name, arn:aws:iam::123:root).
 */
function parseCallerArn(arn = '') {
  const match = String(arn).match(/^arn:([^:]+):(iam|sts)::(\d*):(.+)$/);
  if (!match) return { type: 'unknown', name: arn || null, partition: null };
  const [, partition, , , resource] = match;
  if (resource === 'root') return { type: 'root', name: 'root', partition };
  const [kind, ...rest] = resource.split('/');
  if (kind === 'assumed-role') {
    const [role, session] = rest;
    const sso = /^AWSReservedSSO_(.+?)_[0-9a-f]+$/.exec(role || '');
    return { type: sso ? 'sso' : 'role', name: sso ? sso[1] : role, role, session: session || null, partition };
  }
  if (kind === 'user') return { type: 'user', name: rest.at(-1), partition };
  if (kind === 'federated-user') return { type: 'federated', name: rest.at(-1), partition };
  return { type: kind, name: rest.at(-1) || kind, partition };
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Runs every service count in parallel, each with its own timeout and error. */
async function countServices(cfg, { sdk = defaultSdk, services = SERVICES, timeoutMs = SERVICE_TIMEOUT_MS } = {}) {
  return Promise.all(services.map(async service => {
    const base = { id: service.id, tab: service.tab, label: service.label, scope: service.scope };
    const result = await settle(withTimeout(service.count(sdk, cfg), timeoutMs));
    if (result.ok) return { ...base, status: result.value.count > 0 ? 'active' : 'empty', ...result.value };
    return { ...base, status: 'unavailable', count: null, error: classifyAwsError(result.error) };
  }));
}

async function callerIdentity(cfg, { sdk = defaultSdk, timeoutMs = SERVICE_TIMEOUT_MS } = {}) {
  const { STSClient, GetCallerIdentityCommand } = sdk('client-sts');
  const response = await withTimeout(new STSClient(cfg).send(new GetCallerIdentityCommand({})), timeoutMs);
  return { account: response.Account, arn: response.Arn, userId: response.UserId, ...parseCallerArn(response.Arn) };
}

async function accountAlias(cfg, { sdk = defaultSdk, timeoutMs = SERVICE_TIMEOUT_MS } = {}) {
  const { IAMClient, ListAccountAliasesCommand } = sdk('client-iam');
  const response = await withTimeout(new IAMClient({ ...cfg, region: 'us-east-1' }).send(new ListAccountAliasesCommand({})), timeoutMs);
  return response.AccountAliases?.[0] || null;
}

async function enabledRegions(cfg, { sdk = defaultSdk, timeoutMs = SERVICE_TIMEOUT_MS } = {}) {
  const { EC2Client, DescribeRegionsCommand } = sdk('client-ec2');
  const response = await withTimeout(new EC2Client(cfg).send(new DescribeRegionsCommand({ AllRegions: false })), timeoutMs);
  return (response.Regions || []).map(r => r.RegionName).filter(Boolean).sort();
}

/**
 * Builds the overview. Identity is required (without it the profile does not
 * work at all); alias, regions and each service degrade independently.
 */
async function buildAwsOverview(cfg, { profile = {}, sdk = defaultSdk, services = SERVICES, timeoutMs = SERVICE_TIMEOUT_MS, now = Date.now() } = {}) {
  const options = { sdk, timeoutMs };
  const [identity, alias, regions, serviceResults] = await Promise.all([
    callerIdentity(cfg, options),
    settle(accountAlias(cfg, options)),
    settle(enabledRegions(cfg, options)),
    countServices(cfg, { ...options, services }),
  ]);
  const order = { active: 0, empty: 1, unavailable: 2 };
  serviceResults.sort((a, b) => order[a.status] - order[b.status] || (b.count || 0) - (a.count || 0) || a.label.localeCompare(b.label));
  return {
    generatedAt: new Date(now).toISOString(),
    profile: { id: profile.id || null, name: profile.name || null },
    identity: { ...identity, alias: alias.ok ? alias.value : null },
    region: cfg.region || null,
    regions: regions.ok ? { available: true, items: regions.value } : { available: false, error: classifyAwsError(regions.error) },
    summary: {
      active: serviceResults.filter(s => s.status === 'active').length,
      empty: serviceResults.filter(s => s.status === 'empty').length,
      unavailable: serviceResults.filter(s => s.status === 'unavailable').length,
      total: serviceResults.length,
    },
    services: serviceResults,
  };
}

module.exports = {
  SERVICES,
  paginate,
  classifyAwsError,
  parseCallerArn,
  countServices,
  buildAwsOverview,
};

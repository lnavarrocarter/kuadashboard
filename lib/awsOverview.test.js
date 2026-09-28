'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SERVICES, paginate, classifyAwsError, parseCallerArn, countServices, buildAwsOverview,
} = require('./awsOverview');

// Fake SDK: every Client class sends through `handler(commandName, input)`.
function fakeSdk(handler) {
  return () => new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (name.endsWith('Client')) {
        return class { send(command) { return handler(command.name, command.input); } };
      }
      return class { constructor(input) { this.name = name; this.input = input; } };
    },
  });
}

const denied = (action, resource = '*') => Object.assign(
  new Error(`User: arn:aws:iam::123456789012:user/dev is not authorized to perform: ${action} on resource: ${resource} because no identity-based policy allows the ${action} action`),
  { name: 'AccessDeniedException', $metadata: { httpStatusCode: 400 } },
);

test('parseCallerArn recognizes users, roles, SSO roles and root', () => {
  assert.deepEqual(parseCallerArn('arn:aws:iam::123456789012:user/team/dev'), { type: 'user', name: 'dev', partition: 'aws' });
  assert.deepEqual(parseCallerArn('arn:aws:sts::123456789012:assumed-role/Deployer/ci-run'), {
    type: 'role', name: 'Deployer', role: 'Deployer', session: 'ci-run', partition: 'aws',
  });
  assert.deepEqual(parseCallerArn('arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_AdministratorAccess_0a1b2c3d4e5f6789/nacho@example.com'), {
    type: 'sso', name: 'AdministratorAccess', role: 'AWSReservedSSO_AdministratorAccess_0a1b2c3d4e5f6789', session: 'nacho@example.com', partition: 'aws',
  });
  assert.deepEqual(parseCallerArn('arn:aws:iam::123456789012:root'), { type: 'root', name: 'root', partition: 'aws' });
  assert.equal(parseCallerArn('nonsense').type, 'unknown');
});

test('classifyAwsError extracts the IAM action from access denied messages', () => {
  const result = classifyAwsError(denied('lambda:ListFunctions', 'arn:aws:lambda:us-east-1:123456789012:function:*'));
  assert.equal(result.kind, 'denied');
  assert.equal(result.action, 'lambda:ListFunctions');
  assert.equal(result.resource, 'arn:aws:lambda:us-east-1:123456789012:function:*');
});

test('classifyAwsError recognizes EC2 style and message-only denials', () => {
  const ec2 = Object.assign(new Error('You are not authorized to perform this operation.'), { name: 'UnauthorizedOperation' });
  assert.deepEqual(classifyAwsError(ec2), { kind: 'denied', message: ec2.message, action: null, resource: null });
  const s3 = Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  assert.equal(classifyAwsError(s3).kind, 'denied');
});

test('classifyAwsError separates expired sessions, timeouts and other errors', () => {
  assert.equal(classifyAwsError(Object.assign(new Error('x'), { name: 'ExpiredTokenException' })).kind, 'expired');
  assert.equal(classifyAwsError(Object.assign(new Error('x'), { name: 'TimeoutError' })).kind, 'timeout');
  assert.equal(classifyAwsError(Object.assign(new Error('boom'), { name: 'ThrottlingException' })).kind, 'error');
});

test('paginate follows tokens and stops at the page cap', async () => {
  let calls = 0;
  const client = { send: async command => { calls += 1; return { Items: [calls], Next: calls < 3 ? `t${calls}` : undefined, seen: command.input }; } };
  class Command { constructor(input) { this.input = input; } }
  const result = await paginate(client, Command, {}, { items: 'Items', tokenIn: 'Token', tokenOut: 'Next' });
  assert.deepEqual(result, { items: [1, 2, 3], truncated: false });

  const endless = { send: async () => ({ Items: [1], Next: 'more' }) };
  const capped = await paginate(endless, Command, {}, { items: 'Items', tokenIn: 'Token', tokenOut: 'Next' });
  assert.equal(capped.items.length, 10);
  assert.equal(capped.truncated, true);
});

test('countServices marks active, empty and unavailable services independently', async () => {
  const sdk = fakeSdk(async name => {
    if (name === 'DescribeInstancesCommand') {
      return { Reservations: [{ Instances: [{ State: { Name: 'running' } }, { State: { Name: 'stopped' } }, { State: { Name: 'terminated' } }] }] };
    }
    if (name === 'GetAccountSettingsCommand') return { AccountUsage: { FunctionCount: 0 } };
    if (name === 'ListClustersCommand') throw denied('eks:ListClusters');
    throw new Error(`unexpected ${name}`);
  });
  const services = SERVICES.filter(s => ['ec2', 'lambda', 'eks'].includes(s.id));
  const results = await countServices({ region: 'us-east-1' }, { sdk, services });
  const byId = Object.fromEntries(results.map(r => [r.id, r]));

  assert.equal(byId.ec2.status, 'active');
  assert.equal(byId.ec2.count, 2);
  assert.deepEqual(byId.ec2.detail, { running: 1, stopped: 1 });
  assert.equal(byId.lambda.status, 'empty');
  assert.equal(byId.lambda.count, 0);
  assert.equal(byId.eks.status, 'unavailable');
  assert.equal(byId.eks.error.kind, 'denied');
  assert.equal(byId.eks.error.action, 'eks:ListClusters');
  assert.equal(byId.eks.tab, 'eks');
});

test('countServices times out slow services without blocking the rest', async () => {
  const sdk = fakeSdk(name => (name === 'GetAccountSettingsCommand' ? new Promise(() => {}) : Promise.resolve({ Reservations: [] })));
  const services = SERVICES.filter(s => ['ec2', 'lambda'].includes(s.id));
  const results = await countServices({}, { sdk, services, timeoutMs: 30 });
  const lambda = results.find(r => r.id === 'lambda');
  assert.equal(lambda.status, 'unavailable');
  assert.equal(lambda.error.kind, 'timeout');
  assert.equal(results.find(r => r.id === 'ec2').status, 'empty');
});

test('buildAwsOverview combines identity, alias, regions and sorted services', async () => {
  const sdk = fakeSdk(async name => {
    switch (name) {
      case 'GetCallerIdentityCommand': return { Account: '123456789012', Arn: 'arn:aws:sts::123456789012:assumed-role/Deployer/ci', UserId: 'AROA:ci' };
      case 'ListAccountAliasesCommand': throw denied('iam:ListAccountAliases');
      case 'DescribeRegionsCommand': return { Regions: [{ RegionName: 'us-west-2' }, { RegionName: 'us-east-1' }] };
      case 'DescribeInstancesCommand': return { Reservations: [{ Instances: [{ State: { Name: 'running' } }] }] };
      case 'GetAccountSettingsCommand': return { AccountUsage: { FunctionCount: 3 } };
      case 'ListTablesCommand': return { TableNames: [] };
      default: throw new Error(`unexpected ${name}`);
    }
  });
  const services = SERVICES.filter(s => ['ec2', 'lambda', 'dynamodb'].includes(s.id));
  const overview = await buildAwsOverview({ region: 'us-east-1' }, { sdk, services, profile: { id: 'local:dev' }, now: Date.parse('2026-09-28T12:00:00Z') });

  assert.equal(overview.identity.account, '123456789012');
  assert.equal(overview.identity.type, 'role');
  assert.equal(overview.identity.name, 'Deployer');
  assert.equal(overview.identity.alias, null);
  assert.equal(overview.region, 'us-east-1');
  assert.deepEqual(overview.regions, { available: true, items: ['us-east-1', 'us-west-2'] });
  assert.deepEqual(overview.summary, { active: 2, empty: 1, unavailable: 0, total: 3 });
  assert.deepEqual(overview.services.map(s => s.id), ['lambda', 'ec2', 'dynamodb']);
  assert.equal(overview.profile.id, 'local:dev');
});

test('buildAwsOverview fails when the caller identity cannot be read', async () => {
  const sdk = fakeSdk(async name => {
    if (name === 'GetCallerIdentityCommand') throw Object.assign(new Error('The security token included in the request is invalid.'), { name: 'InvalidClientTokenId' });
    return {};
  });
  await assert.rejects(buildAwsOverview({}, { sdk, services: [] }), /security token/);
});

test('every catalog service opens an existing AWS tab and declares its scope', () => {
  const tabs = new Set(['ec2', 'lambda', 'ecs', 'eks', 'ecr', 'vpc', 'apigw', 's3', 'dynamodb', 'rds', 'eventbridge', 'stepfn', 'cloudfront', 'route53', 'cognito', 'secrets']);
  for (const service of SERVICES) {
    assert.ok(tabs.has(service.tab), service.id);
    assert.ok(['regional', 'global'].includes(service.scope), service.id);
  }
  assert.equal(new Set(SERVICES.map(s => s.id)).size, SERVICES.length);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAwsResourceCatalog, typeOfArn } = require('./aws');

const ACCOUNT = '111111111111';

// Fake AWS: answers each command by its name; a function answer gets the command input.
function catalog(responses, { now } = {}) {
  const calls = [];
  const clientFactory = service => ({
    async send(command) {
      const name = command.constructor.name;
      calls.push(`${service}:${name}`);
      const answer = responses[name];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(command.input) : (answer || {});
    },
  });
  return {
    calls,
    subject: createAwsResourceCatalog({
      configResolver: async () => ({}),
      clientFactory,
      ...(now ? { now } : {}),
    }),
  };
}

const base = { GetCallerIdentityCommand: { Account: ACCOUNT } };

test('lists resources by type with the identity the registry accepts (#281)', async () => {
  const { subject } = catalog({
    ...base,
    ListBucketsCommand: { Buckets: [{ Name: 'invoices', BucketRegion: 'us-east-2' }] },
    ListTablesCommand: { TableNames: ['orders'] },
    DescribeInstancesCommand: { Reservations: [{ Instances: [{ InstanceId: 'i-1', Tags: [{ Key: 'Name', Value: 'worker' }], State: { Name: 'running' } }] }] },
    DescribeVolumesCommand: { Volumes: [{ VolumeId: 'vol-1', Size: 20, Attachments: [{ InstanceId: 'i-1' }] }] },
  });
  const result = await subject.list({ profileId: 'local:dev', region: 'us-east-1', types: ['s3', 'dynamodb', 'ec2', 'ebs-volume'] });
  assert.equal(result.account, ACCOUNT);
  const byType = Object.fromEntries(result.items.map(item => [item.type, item]));
  assert.deepEqual(byType.s3.attach, { provider: 'aws', type: 's3', key: 'arn:aws:s3:::invoices', arn: 'arn:aws:s3:::invoices', name: 'invoices', location: 'us-east-2' });
  assert.deepEqual(byType.dynamodb.attach, {
    provider: 'aws', type: 'dynamodb', key: `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/orders`, arn: `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/orders`,
    name: 'orders', scopeId: ACCOUNT, location: 'us-east-1',
  });
  assert.equal(byType.ec2.name, 'worker');
  assert.equal(byType.ec2.arn, `arn:aws:ec2:us-east-1:${ACCOUNT}:instance/i-1`);
  assert.deepEqual(byType['ebs-volume'].details.attachedTo, ['i-1']);
});

test('search filters by name, ARN or details, and an unreadable type does not hide the others (#281)', async () => {
  const denied = Object.assign(new Error('User is not authorized to perform: glue:ListJobs'), { name: 'AccessDeniedException' });
  const { subject } = catalog({
    ...base,
    ListQueuesCommand: { QueueUrls: [`https://sqs.us-east-1.amazonaws.com/${ACCOUNT}/orders.fifo`, `https://sqs.us-east-1.amazonaws.com/${ACCOUNT}/emails`] },
    ListJobsCommand: denied,
  });
  const result = await subject.list({ profileId: 'local:dev', region: 'us-east-1', types: ['sqs', 'glue'], search: 'ORDERS' });
  assert.deepEqual(result.items.map(item => item.name), ['orders.fifo']);
  assert.equal(result.items[0].details.fifo, true);
  assert.deepEqual(result.failures, [{ type: 'glue', code: 'access_denied' }]);
});

test('an ARN resolves to its resource, in the region of the ARN, or says it was not found (#281)', async () => {
  const { subject, calls } = catalog({
    ...base,
    ListJobsCommand: { JobNames: ['nightly-etl'] },
    ListCrawlersCommand: { CrawlerNames: [] },
    ListWorkflowsCommand: { Workflows: [] },
  });
  const arn = `arn:aws:glue:eu-west-1:${ACCOUNT}:job/nightly-etl`;
  const found = await subject.list({ profileId: 'local:dev', arn });
  assert.equal(found.found, true);
  assert.equal(found.region, 'eu-west-1');
  assert.deepEqual(found.items.map(item => [item.type, item.details.kind]), [['glue', 'job']]);
  assert.ok(calls.every(call => /^(sts|glue):/.test(call)), 'only the service of the ARN is read');

  const missing = await subject.list({ profileId: 'local:dev', arn: `arn:aws:glue:eu-west-1:${ACCOUNT}:job/gone` });
  assert.equal(missing.found, false);
  assert.deepEqual(missing.items, []);
  await assert.rejects(subject.list({ profileId: 'local:dev', arn: `arn:aws:kms:us-east-1:${ACCOUNT}:key/1` }), error => error.code === 'UNSUPPORTED_ARN');
});

test('pages continue the same snapshot once, for five minutes (#281)', async () => {
  let clock = Date.UTC(2026, 9, 15);
  let reads = 0;
  const { subject } = catalog({
    ...base,
    ListTopicsCommand: () => { reads += 1; return { Topics: ['a', 'b', 'c'].map(name => ({ TopicArn: `arn:aws:sns:us-east-1:${ACCOUNT}:${name}` })) }; },
  }, { now: () => clock });
  const first = await subject.list({ profileId: 'local:dev', region: 'us-east-1', types: ['sns'], limit: 2 });
  assert.deepEqual([first.total, first.items.length, !!first.nextCursor], [3, 2, true]);
  const second = await subject.list({ profileId: 'local:dev', cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.name), ['c']);
  assert.equal(second.nextCursor, null);
  assert.equal(reads, 1, 'the second page does not read AWS again');
  await assert.rejects(subject.list({ profileId: 'local:dev', cursor: first.nextCursor }), error => error.code === 'CURSOR_EXPIRED');

  const third = await subject.list({ profileId: 'local:dev', region: 'us-east-1', types: ['sns'], limit: 1 });
  clock += 5 * 60 * 1000 + 1;
  await assert.rejects(subject.list({ profileId: 'local:dev', cursor: third.nextCursor }), error => error.code === 'CURSOR_EXPIRED');
  await assert.rejects(subject.list({ profileId: 'local:prod', region: 'us-east-1', types: ['nope'] }), error => error.code === 'INVALID');
});

test('ECS lists clusters and their services; global types keep their own location (#281)', async () => {
  const { subject } = catalog({
    ...base,
    ListClustersCommand: { clusterArns: [`arn:aws:ecs:us-east-1:${ACCOUNT}:cluster/prod`] },
    ListServicesCommand: input => ({ serviceArns: [`arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/api`], cluster: input.cluster }),
    ListHostedZonesCommand: { HostedZones: [{ Id: '/hostedzone/Z123', Name: 'example.com.', Config: { PrivateZone: false } }] },
  });
  const result = await subject.list({ profileId: 'local:dev', region: 'us-east-1', types: ['ecs', 'route53'] });
  assert.deepEqual(result.items.filter(item => item.type === 'ecs').map(item => [item.name, item.details.kind]), [['prod', 'cluster'], ['api', 'service']]);
  const zone = result.items.find(item => item.type === 'route53');
  assert.deepEqual(zone.attach, { provider: 'aws', type: 'route53', key: 'arn:aws:route53:::hostedzone/Z123', arn: 'arn:aws:route53:::hostedzone/Z123', name: 'example.com' });
});

test('typeOfArn knows every catalog type (#281)', () => {
  assert.equal(typeOfArn(`arn:aws:ec2:us-east-1:${ACCOUNT}:volume/vol-1`), 'ebs-volume');
  assert.equal(typeOfArn(`arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:targetgroup/api/1`), 'targetgroup');
  assert.equal(typeOfArn(`arn:aws:states:us-east-1:${ACCOUNT}:stateMachine:orders`), 'stepfunctions');
  assert.equal(typeOfArn('arn:aws:apigateway:us-east-1::/restapis/abc'), 'apigateway');
  assert.equal(typeOfArn(`arn:aws:events:us-east-1:${ACCOUNT}:rule/nightly`), 'eventbridge');
  assert.equal(typeOfArn('not-an-arn'), null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LB_ARN_RE, isOldTlsPolicy, describeAction, listLoadBalancers, describeLoadBalancer,
} = require('./awsLoadBalancers');

const ACCOUNT = '123456789012';
const lbArn = (kind, name) => `arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:loadbalancer/${kind}/${name}/0123456789abcdef`;
const tgArn = name => `arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:targetgroup/${name}/0123456789abcdef`;
const listenerArn = (lb, port) => `arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:listener/app/${lb}/0123456789abcdef/${port}`;

/** Fake SDK: each command class records its input; `handlers[name](input)` answers it. */
function fakeSdk(handlers) {
  const calls = [];
  const command = name => class { constructor(input) { this.name = name; this.input = input; } };
  const client = class { send(cmd) { calls.push({ name: cmd.name, input: cmd.input }); return Promise.resolve().then(() => handlers[cmd.name](cmd.input)); } };
  const names = ['DescribeLoadBalancers', 'DescribeListeners', 'DescribeTargetGroups', 'DescribeTargetHealth', 'DescribeRules', 'DescribeLoadBalancerAttributes', 'DescribeTags'];
  const v2 = { ElasticLoadBalancingV2Client: client, ...Object.fromEntries(names.map(name => [`${name}Command`, command(name)])) };
  const classicNames = ['DescribeLoadBalancers', 'DescribeInstanceHealth', 'DescribeLoadBalancerAttributes', 'DescribeTags'];
  const classic = { ElasticLoadBalancingClient: client, ...Object.fromEntries(classicNames.map(name => [`${name}Command`, command(`classic.${name}`)])) };
  return { sdk: pkg => (pkg === 'client-elastic-load-balancing-v2' ? v2 : classic), calls };
}

const healthy = id => ({ Target: { Id: id, Port: 80 }, TargetHealth: { State: 'healthy' } });
const unhealthy = id => ({ Target: { Id: id, Port: 80 }, TargetHealth: { State: 'unhealthy', Reason: 'Target.FailedHealthChecks', Description: 'Health checks failed' } });

function account() {
  return {
    DescribeLoadBalancers: () => ({
      LoadBalancers: [
        { LoadBalancerArn: lbArn('app', 'web'), LoadBalancerName: 'web', Type: 'application', Scheme: 'internet-facing', DNSName: 'web-1.us-east-1.elb.amazonaws.com', State: { Code: 'active' }, VpcId: 'vpc-1', AvailabilityZones: [{ ZoneName: 'us-east-1a' }, { ZoneName: 'us-east-1b' }], SecurityGroups: ['sg-1'] },
        { LoadBalancerArn: lbArn('net', 'db'), LoadBalancerName: 'db', Type: 'network', Scheme: 'internal', DNSName: 'db.elb.amazonaws.com', State: { Code: 'active' } },
      ],
    }),
    DescribeTargetGroups: input => (input.Marker
      ? { TargetGroups: [{ TargetGroupArn: tgArn('orphan'), TargetGroupName: 'orphan', LoadBalancerArns: [] }] }
      : {
        TargetGroups: [
          { TargetGroupArn: tgArn('api'), TargetGroupName: 'api', Protocol: 'HTTP', Port: 80, TargetType: 'ip', HealthCheckProtocol: 'HTTP', HealthCheckPath: '/health', LoadBalancerArns: [lbArn('app', 'web')] },
          { TargetGroupArn: tgArn('pg'), TargetGroupName: 'pg', Protocol: 'TCP', Port: 5432, TargetType: 'instance', LoadBalancerArns: [lbArn('net', 'db')] },
        ],
        NextMarker: 'page-2',
      }),
    DescribeListeners: input => (input.LoadBalancerArn === lbArn('app', 'web')
      ? {
        Listeners: [
          { ListenerArn: listenerArn('web', 443), Port: 443, Protocol: 'HTTPS', SslPolicy: 'ELBSecurityPolicy-2016-08', Certificates: [{ CertificateArn: 'c' }], DefaultActions: [{ Type: 'forward', TargetGroupArn: tgArn('api') }] },
          { ListenerArn: listenerArn('web', 80), Port: 80, Protocol: 'HTTP', DefaultActions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '404' } }] },
        ],
      }
      : { Listeners: [{ ListenerArn: 'l-db', Port: 5432, Protocol: 'TCP', DefaultActions: [{ Type: 'forward', TargetGroupArn: tgArn('pg') }] }] }),
    DescribeTargetHealth: input => ({
      TargetHealthDescriptions: input.TargetGroupArn === tgArn('api') ? [healthy('10.0.0.1'), unhealthy('10.0.0.2')] : [unhealthy('i-1')],
    }),
    'classic.DescribeLoadBalancers': () => ({
      LoadBalancerDescriptions: [{ LoadBalancerName: 'legacy', Scheme: 'internet-facing', DNSName: 'legacy.elb.amazonaws.com', ListenerDescriptions: [{ Listener: { Protocol: 'HTTP', LoadBalancerPort: 80, InstanceProtocol: 'HTTP', InstancePort: 8080 } }], Instances: [{ InstanceId: 'i-9' }] }],
    }),
    'classic.DescribeInstanceHealth': () => ({ InstanceStates: [{ InstanceId: 'i-9', State: 'InService' }] }),
  };
}

test('lists ELBv2 and Classic load balancers with listeners, target groups and health', async () => {
  const { sdk, calls } = fakeSdk(account());
  const { loadBalancers, truncated, unavailable } = await listLoadBalancers({ region: 'us-east-1' }, { sdk });

  assert.equal(truncated, false);
  assert.deepEqual(unavailable, []);
  assert.deepEqual(loadBalancers.map(lb => [lb.name, lb.health.status]), [['db', 'critical'], ['web', 'warning'], ['legacy', 'ok']]);

  const web = loadBalancers.find(lb => lb.name === 'web');
  assert.equal(web.public, true);
  assert.deepEqual(web.zones, ['us-east-1a', 'us-east-1b']);
  assert.deepEqual(web.listeners.map(l => [l.port, l.protocol, l.defaultAction.type]), [[80, 'HTTP', 'fixed-response'], [443, 'HTTPS', 'forward']]);
  assert.deepEqual(web.targetGroups[0].targets, { total: 2, healthy: 1, unhealthy: 1, other: 0 });
  assert.equal(web.targetGroups[0].healthCheck, 'HTTP /health');
  assert.deepEqual(web.targetGroups[0].unhealthyTargets[0], { id: '10.0.0.2', port: 80, state: 'unhealthy', reason: 'Target.FailedHealthChecks', description: 'Health checks failed' });
  assert.deepEqual(web.health.reasons.map(r => r.key).sort(), ['lbHttpNotRedirected', 'lbOldTls', 'lbUnhealthyTargets']);

  const db = loadBalancers.find(lb => lb.name === 'db');
  assert.equal(db.public, false);
  assert.deepEqual(db.health.reasons, [{ level: 'critical', key: 'lbNoHealthyTargets', params: { group: 'pg' } }]);

  const legacy = loadBalancers.find(lb => lb.name === 'legacy');
  assert.equal(legacy.type, 'classic');
  assert.equal(legacy.id, 'classic:legacy');
  assert.deepEqual(legacy.listeners[0].defaultAction, { type: 'forward', instance: 'HTTP:8080' });

  // The orphan target group (second page, no load balancer) is never asked for its health.
  assert.equal(calls.filter(c => c.name === 'DescribeTargetHealth').length, 2);
  assert.equal(calls.filter(c => c.name === 'DescribeTargetGroups').length, 2);
});

test('a load balancer that redirects HTTP to HTTPS and uses a current TLS policy is healthy', async () => {
  const handlers = account();
  handlers.DescribeListeners = input => (input.LoadBalancerArn === lbArn('app', 'web')
    ? {
      Listeners: [
        { ListenerArn: listenerArn('web', 443), Port: 443, Protocol: 'HTTPS', SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06', DefaultActions: [{ Type: 'forward', TargetGroupArn: tgArn('api') }] },
        { ListenerArn: listenerArn('web', 80), Port: 80, Protocol: 'HTTP', DefaultActions: [{ Type: 'redirect', RedirectConfig: { Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' } }] },
      ],
    }
    : { Listeners: [] });
  handlers.DescribeTargetHealth = () => ({ TargetHealthDescriptions: [healthy('10.0.0.1')] });
  const { sdk } = fakeSdk(handlers);
  const { loadBalancers } = await listLoadBalancers({}, { sdk });
  const web = loadBalancers.find(lb => lb.name === 'web');
  assert.deepEqual(web.health, { status: 'ok', reasons: [] });
  assert.deepEqual(web.listeners[0].defaultAction, { type: 'redirect', redirect: 'HTTPS:443', status: 'HTTP_301', toHttps: true });
});

test('a failing source is reported as unavailable without hiding the other', async () => {
  const handlers = account();
  handlers['classic.DescribeLoadBalancers'] = () => {
    throw Object.assign(new Error('User is not authorized to perform: elasticloadbalancing:DescribeLoadBalancers'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  };
  const { sdk } = fakeSdk(handlers);
  const { loadBalancers, unavailable } = await listLoadBalancers({}, { sdk });
  assert.deepEqual(loadBalancers.map(lb => lb.name).sort(), ['db', 'web']);
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].source, 'classic');
  assert.ok(unavailable[0].error);
});

test('when every source fails, the error is thrown', async () => {
  const boom = () => { throw new Error('network down'); };
  const { sdk } = fakeSdk({ DescribeLoadBalancers: boom, DescribeTargetGroups: boom, 'classic.DescribeLoadBalancers': boom });
  await assert.rejects(listLoadBalancers({}, { sdk }), /network down/);
});

test('describeLoadBalancer returns rules, attributes and tags; validates its input', async () => {
  const handlers = {
    ...account(),
    DescribeRules: input => ({
      Rules: input.ListenerArn === listenerArn('web', 443)
        ? [
          { Priority: 'default', IsDefault: true, Actions: [{ Type: 'forward', TargetGroupArn: tgArn('api') }] },
          { Priority: '20', Conditions: [{ Field: 'path-pattern', PathPatternConfig: { Values: ['/admin/*'] } }], Actions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '403' } }] },
          { Priority: '10', Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['api.example.com'] } }], Actions: [{ Type: 'authenticate-oidc', Order: 1 }, { Type: 'forward', Order: 2, ForwardConfig: { TargetGroups: [{ TargetGroupArn: tgArn('api') }] } }] },
        ]
        : [],
    }),
    DescribeLoadBalancerAttributes: () => ({ Attributes: [
      { Key: 'deletion_protection.enabled', Value: 'false' },
      { Key: 'access_logs.s3.enabled', Value: 'true' },
      { Key: 'access_logs.s3.bucket', Value: 'alb-logs' },
      { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'false' },
      { Key: 'idle_timeout.timeout_seconds', Value: '60' },
    ] }),
    DescribeTags: () => ({ TagDescriptions: [{ Tags: [{ Key: 'env', Value: 'prod' }] }] }),
  };
  const { sdk } = fakeSdk(handlers);
  const detail = await describeLoadBalancer({}, { arn: lbArn('app', 'web') }, { sdk });
  const https = detail.listeners.find(l => l.port === 443);
  assert.deepEqual(https.rules.map(r => [r.priority, r.conditions[0].values[0], r.action.type]), [['10', 'api.example.com', 'forward'], ['20', '/admin/*', 'fixed-response']]);
  assert.deepEqual(https.rules[0].action.targetGroups, ['api']);
  assert.deepEqual(detail.attributes, { deletionProtection: false, accessLogs: 'alb-logs', dropInvalidHeaders: false, idleTimeoutSeconds: 60, crossZone: null });
  assert.deepEqual(detail.tags, [{ key: 'env', value: 'prod' }]);

  await assert.rejects(describeLoadBalancer({}, { arn: 'arn:aws:s3:::bucket' }, { sdk }), error => error.$metadata.httpStatusCode === 400);
  await assert.rejects(describeLoadBalancer({}, { name: 'bad name!' }, { sdk }), /Invalid load balancer name/);
});

test('helpers: ARN validation, TLS policies and action descriptions', () => {
  assert.ok(LB_ARN_RE.test(lbArn('app', 'web')));
  assert.ok(LB_ARN_RE.test(lbArn('net', 'db')));
  assert.ok(!LB_ARN_RE.test(`${lbArn('app', 'web')}/extra`));
  assert.equal(isOldTlsPolicy('ELBSecurityPolicy-2016-08'), true);
  assert.equal(isOldTlsPolicy('ELBSecurityPolicy-TLS-1-1-2017-01'), true);
  assert.equal(isOldTlsPolicy('ELBSecurityPolicy-TLS13-1-0-2021-06'), true);
  assert.equal(isOldTlsPolicy('ELBSecurityPolicy-TLS13-1-2-2021-06'), false);
  assert.equal(isOldTlsPolicy(null), false);
  assert.deepEqual(describeAction({ Type: 'forward', ForwardConfig: { TargetGroups: [{ TargetGroupArn: tgArn('a') }, { TargetGroupArn: tgArn('b') }] } }), { type: 'forward', targetGroups: ['a', 'b'] });
});

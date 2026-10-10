'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeLbPath, cidrContains, defaultRoute } = require('./awsLbPath');

const LB = {
  LoadBalancerArn: 'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/web/abc',
  LoadBalancerName: 'web', Type: 'application', Scheme: 'internet-facing', VpcId: 'vpc-1',
  SecurityGroups: ['sg-lb'],
  AvailabilityZones: [{ ZoneName: 'us-east-1a', SubnetId: 'subnet-pub-a' }, { ZoneName: 'us-east-1b', SubnetId: 'subnet-pub-b' }],
};
const SUBNETS = [
  { SubnetId: 'subnet-pub-a', CidrBlock: '10.0.0.0/24', AvailabilityZone: 'us-east-1a' },
  { SubnetId: 'subnet-pub-b', CidrBlock: '10.0.1.0/24', AvailabilityZone: 'us-east-1b' },
  { SubnetId: 'subnet-app-a', CidrBlock: '10.0.10.0/24', AvailabilityZone: 'us-east-1a' },
];
const ROUTES = [
  { RouteTableId: 'rtb-main', Associations: [{ Main: true }], Routes: [{ DestinationCidrBlock: '10.0.0.0/16', GatewayId: 'local' }, { DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: 'nat-1' }] },
  { RouteTableId: 'rtb-public', Associations: [{ SubnetId: 'subnet-pub-a' }, { SubnetId: 'subnet-pub-b' }], Routes: [{ DestinationCidrBlock: '0.0.0.0/0', GatewayId: 'igw-1' }] },
];
const LB_SG = { GroupId: 'sg-lb', IpPermissions: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }], IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] };
const instance = (id, groupId) => ({ InstanceId: id, SubnetId: 'subnet-app-a', PrivateIpAddress: '10.0.10.5', State: { Name: 'running' }, SecurityGroups: [{ GroupId: groupId }] });
const group = (overrides = {}) => ({ TargetGroupArn: 'tg-1', TargetGroupName: 'api', TargetType: 'instance', Protocol: 'HTTP', Port: 8080, HealthCheckPort: 'traffic-port', HealthCheckPath: '/health', ...overrides });
const health = (id, state = 'unhealthy', reason = 'Target.Timeout') => ({ Target: { Id: id, Port: 8080 }, TargetHealth: { State: state, Reason: reason } });

function run({ appSg, groupOverrides, lb = LB }) {
  return analyzeLbPath({
    loadBalancer: lb,
    targetGroups: [{ group: group(groupOverrides), health: [health('i-1')] }],
    instances: [instance('i-1', 'sg-app')],
    subnets: SUBNETS, routeTables: ROUTES,
    securityGroups: [LB_SG, { GroupId: 'sg-app', ...appSg }],
  });
}

test('the target port allowed from the load balancer security group', () => {
  const result = run({ appSg: { IpPermissions: [{ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, UserIdGroupPairs: [{ GroupId: 'sg-lb' }] }] } });
  const [target] = result.groups[0].targets;
  assert.equal(target.traffic.verdict, 'allowed');
  assert.deepEqual(target.traffic.rule, { groupId: 'sg-app', via: 'group', source: 'sg-lb' });
  assert.equal(target.healthCheck.verdict, 'allowed');
  assert.equal(target.subnet.routeTableId, 'rtb-main');
  assert.deepEqual(target.subnet.defaultRoute, { kind: 'nat', target: 'nat-1' });
  assert.deepEqual(result.loadBalancer.subnets.map(subnet => subnet.defaultRoute.kind), ['internet', 'internet']);
  assert.deepEqual(result.findings, []);
});

test('a Target.Timeout explained: no rule lets the load balancer reach the port', () => {
  const result = run({ appSg: { IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] } });
  const [target] = result.groups[0].targets;
  assert.equal(target.traffic.verdict, 'blocked');
  assert.equal(target.reason, 'Target.Timeout');
  assert.deepEqual(result.findings.map(finding => finding.key), ['targetPortBlocked']);
});

test('a CIDR rule counts only when it contains every subnet of the load balancer', () => {
  const vpc = run({ appSg: { IpPermissions: [{ IpProtocol: 'tcp', FromPort: 8000, ToPort: 9000, IpRanges: [{ CidrIp: '10.0.0.0/16' }] }] } });
  assert.equal(vpc.groups[0].targets[0].traffic.verdict, 'allowed');
  const oneZone = run({ appSg: { IpPermissions: [{ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, IpRanges: [{ CidrIp: '10.0.0.0/24' }] }] } });
  assert.equal(oneZone.groups[0].targets[0].traffic.verdict, 'blocked');
});

test('a health check on another port is checked on its own', () => {
  const result = run({
    appSg: { IpPermissions: [{ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, UserIdGroupPairs: [{ GroupId: 'sg-lb' }] }] },
    groupOverrides: { HealthCheckPort: '9090' },
  });
  const [target] = result.groups[0].targets;
  assert.equal(target.traffic.verdict, 'allowed');
  assert.equal(target.healthCheckPort, 9090);
  assert.equal(target.healthCheck.verdict, 'blocked');
  assert.deepEqual(result.findings.map(finding => finding.key), ['healthPortBlocked']);
});

test('an internet-facing load balancer in a subnet without an internet route is flagged', () => {
  const lb = { ...LB, AvailabilityZones: [{ ZoneName: 'us-east-1a', SubnetId: 'subnet-app-a' }] };
  const result = run({ lb, appSg: { IpPermissions: [] } });
  assert.equal(result.findings[0].key, 'publicLbPrivateSubnet');
});

test('without load balancer security groups (NLB) nothing is guessed', () => {
  const result = run({ lb: { ...LB, Type: 'network', SecurityGroups: [] }, appSg: { IpPermissions: [] } });
  assert.equal(result.groups[0].targets[0].traffic.verdict, 'unknown');
  assert.ok(result.notes.includes('noLbSecurityGroups'));
  assert.ok(result.notes.includes('nacl'));
});

test('address helpers', () => {
  assert.equal(cidrContains('10.0.0.0/16', '10.0.10.0/24'), true);
  assert.equal(cidrContains('10.0.0.0/24', '10.0.1.0/24'), false);
  assert.equal(cidrContains('0.0.0.0/0', '192.168.1.7'), true);
  assert.deepEqual(defaultRoute({ Routes: [{ DestinationCidrBlock: '0.0.0.0/0', GatewayId: 'igw-9', State: 'blackhole' }] }), { kind: 'none', target: null });
});

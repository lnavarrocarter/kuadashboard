'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAwsExposureChains } = require('./awsExposureChains');

const lb = {
  id: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/abc',
  arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/abc',
  name: 'web', dnsName: 'web-123.us-east-1.elb.amazonaws.com', hostedZoneId: 'ZLB',
  scheme: 'internet-facing', state: 'active',
  targetGroups: [{ arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/api/abc', name: 'api', targetType: 'instance', targets: { total: 1, healthy: 1 }, targetRefs: [{ id: 'i-12345678', port: 8080, state: 'healthy' }] }],
};

test('joins Route53 alias through CloudFront origin, listener and EC2 backend', () => {
  const result = buildAwsExposureChains({
    hostedZones: [{ id: 'ZPUBLIC', name: 'example.com.', records: [
      { name: 'app.example.com.', type: 'A', alias: { dnsName: 'd111.cloudfront.net.', zoneId: 'ZCF' } },
    ] }],
    distributions: [{ Id: 'D111', DomainName: 'd111.cloudfront.net', Enabled: true,
      Origins: { Items: [{ Id: 'origin1', DomainName: lb.dnsName }] },
      DefaultCacheBehavior: { TargetOriginId: 'origin1' } }],
    loadBalancers: [lb],
    lbDetails: new Map([[lb.arn, { listeners: [{ port: 443, protocol: 'HTTPS', defaultAction: { type: 'forward', targetGroups: ['api'] }, rules: [] }] }]]),
    instances: [{ id: 'i-12345678', name: 'backend', privateIp: '10.0.0.5' }],
  });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].hops.map(hop => hop.type), ['route53', 'cloudfront', 'origin', 'load_balancer', 'listener', 'target_group', 'ec2_instance']);
  assert.equal(result.entries[0].hops.at(-1).name, 'backend');
});

test('preserves unresolved DNS targets and skips private zones', () => {
  const result = buildAwsExposureChains({ hostedZones: [
    { id: 'private', private: true, records: [{ name: 'secret.internal', type: 'A', records: ['10.0.0.1'] }] },
    { id: 'public', name: 'example.com', records: [{ name: 'api.example.com', type: 'CNAME', records: ['api.example.net.'] }] },
  ] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].hops.at(-1).type, 'external_domain');
  assert.equal(result.totals.privateZonesSkipped, 1);
});

test('detects Route53 alias cycles and marks incomplete inventories partial', () => {
  const result = buildAwsExposureChains({
    hostedZones: [{ id: 'public', records: [
      { name: 'a.example.com', type: 'CNAME', records: ['b.example.com'] },
      { name: 'b.example.com', type: 'CNAME', records: ['a.example.com'] },
    ] }], unavailable: [{ source: 'cloudfront', reason: 'read_failed' }],
  });
  assert.ok(result.entries.some(entry => entry.hops.some(hop => hop.reason === 'dns_alias_cycle')));
  assert.equal(result.partial, true);
});

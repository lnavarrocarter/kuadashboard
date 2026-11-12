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
    distributions: [{ Id: 'D111', DomainName: 'd111.cloudfront.net', Enabled: true, WebACLId: 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/edge/acl-1',
      Origins: { Items: [{ Id: 'origin1', DomainName: lb.dnsName }] },
      DefaultCacheBehavior: { TargetOriginId: 'origin1' } }],
    loadBalancers: [lb],
    lbDetails: new Map([[lb.arn, { listeners: [{ port: 443, protocol: 'HTTPS', defaultAction: { type: 'forward', targetGroups: ['api'] }, rules: [] }] }]]),
    instances: [{ id: 'i-12345678', name: 'backend', privateIp: '10.0.0.5' }],
  });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].hops.map(hop => hop.type), ['route53', 'cloudfront', 'origin', 'load_balancer', 'listener', 'target_group', 'ec2_instance']);
  assert.equal(result.entries[0].hops.at(-1).name, 'backend');
  assert.deepEqual(result.entries[0].findings.map(finding => finding.id), ['aws.public_endpoint_cloudfront_bypass']);
});

test('finds public HTTP, weak TLS, and unhealthy target paths with evidence keys', () => {
  const unhealthy = {
    ...lb,
    targetGroups: [{ ...lb.targetGroups[0], targets: { total: 2, healthy: 0, unhealthy: 2 }, targetRefs: [] }],
  };
  const result = buildAwsExposureChains({
    hostedZones: [{ id: 'ZPUBLIC', name: 'example.com', records: [
      { name: 'app.example.com', type: 'A', alias: { dnsName: lb.dnsName, zoneId: 'ZLB' } },
    ] }],
    loadBalancers: [unhealthy],
    lbDetails: new Map([[unhealthy.arn, { listeners: [{
      port: 80, protocol: 'HTTP', oldTls: true, defaultAction: { type: 'forward', toHttps: false, targetGroups: ['api'] }, rules: [],
    }] }]]),
  });
  assert.deepEqual(result.entries[0].findings.map(finding => finding.id), [
    'aws.public_endpoint_http', 'aws.public_endpoint_weak_tls', 'aws.public_endpoint_no_healthy_targets',
  ]);
  assert.ok(result.entries[0].findings.every(finding => finding.key && finding.whyKey));
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

test('joins Route53 names to separately discovered API Gateway and S3 endpoints', () => {
  const result = buildAwsExposureChains({
    hostedZones: [{ id: 'public', records: [
      { name: 'api.example.com', type: 'CNAME', records: ['abc.execute-api.us-east-1.amazonaws.com'] },
      { name: 'site.example.com', type: 'CNAME', records: ['site.s3-website-us-east-1.amazonaws.com'] },
    ] }],
    additionalEntries: [
      { id: 'api-1', hostname: 'abc.execute-api.us-east-1.amazonaws.com', source: 'api_gateway', public: true },
      { id: 'bucket-site', hostname: 'site.s3-website-us-east-1.amazonaws.com', source: 's3_public_bucket', public: true },
    ],
  });
  const api = result.entries.find(item => item.hostname === 'api.example.com');
  const site = result.entries.find(item => item.hostname === 'site.example.com');
  assert.equal(api.hops.at(-1).type, 'api_gateway');
  assert.equal(api.hops.at(-1).id, 'api-1');
  assert.equal(site.hops.at(-1).type, 's3_public_bucket');
  assert.equal(site.hops.at(-1).id, 'bucket-site');
});

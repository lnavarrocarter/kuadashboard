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

const danglingZone = target => [{ id: 'ZPUBLIC', name: 'example.com', records: [
  { name: 'old.example.com', type: 'A', alias: { dnsName: target, zoneId: 'Z35SXDOTRQ7X7K' } },
] }];
const completeInventory = { region: 'us-east-1', complete: { elbv2: true, classic: true } };

test('reports a DNS record to a deleted load balancer as dangling (high) when its region was read completely', () => {
  const result = buildAwsExposureChains({
    hostedZones: danglingZone('dualstack.gone-999.us-east-1.elb.amazonaws.com.'),
    loadBalancers: [lb],
    loadBalancerInventory: completeInventory,
  });
  const hop = result.entries[0].hops.at(-1);
  assert.equal(hop.type, 'load_balancer');
  assert.equal(hop.reason, 'load_balancer_not_found');
  assert.deepEqual(result.entries[0].findings, [{
    id: 'aws.public_endpoint_dangling_dns', severity: 'high',
    key: 'publicEndpoints.finding.danglingDns', whyKey: 'publicEndpoints.why.danglingDns',
    resource: 'old.example.com',
  }]);
});

test('reports a CNAME to a deleted Network Load Balancer using only ELBv2 evidence', () => {
  const result = buildAwsExposureChains({
    hostedZones: [{ id: 'ZPUBLIC', name: 'example.com', records: [
      { name: 'tcp.example.com', type: 'CNAME', records: ['gone-abc.elb.eu-west-1.amazonaws.com'] },
    ] }],
    loadBalancerInventory: { region: 'eu-west-1', complete: { elbv2: true, classic: false } },
  });
  assert.deepEqual(result.entries[0].findings.map(finding => finding.id), ['aws.public_endpoint_dangling_dns']);
});

test('does not report dangling DNS without complete evidence for the load balancer region', () => {
  const cases = [
    [null, 'load_balancer_region_not_inventoried'],
    [{ ...completeInventory, region: 'eu-west-1' }, 'load_balancer_region_not_inventoried'],
    [{ region: 'us-east-1', complete: { elbv2: true, classic: false } }, 'load_balancer_inventory_partial'],
    [{ region: 'us-east-1', complete: { elbv2: false, classic: true } }, 'load_balancer_inventory_partial'],
  ];
  for (const [loadBalancerInventory, reason] of cases) {
    const result = buildAwsExposureChains({ hostedZones: danglingZone('gone-999.us-east-1.elb.amazonaws.com'), loadBalancerInventory });
    assert.equal(result.entries[0].hops.at(-1).reason, reason);
    assert.equal(result.entries[0].hops.at(-1).dangling, undefined);
    assert.deepEqual(result.entries[0].findings, []);
  }
});

test('matches dualstack aliases to their load balancer instead of reporting them dangling', () => {
  const result = buildAwsExposureChains({
    hostedZones: danglingZone(`dualstack.${lb.dnsName}.`),
    loadBalancers: [{ ...lb, hostedZoneId: 'Z35SXDOTRQ7X7K' }],
    loadBalancerInventory: completeInventory,
  });
  assert.equal(result.entries[0].hops[1].type, 'load_balancer');
  assert.equal(result.entries[0].hops[1].name, 'web');
  assert.ok(!result.entries[0].findings.some(finding => finding.id === 'aws.public_endpoint_dangling_dns'));
});

test('a load balancer with the name but another hosted zone is not reported dangling', () => {
  const result = buildAwsExposureChains({
    hostedZones: danglingZone(lb.dnsName),
    loadBalancers: [lb],
    loadBalancerInventory: completeInventory,
  });
  assert.ok(!result.entries[0].findings.some(finding => finding.id === 'aws.public_endpoint_dangling_dns'));
});

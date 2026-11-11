'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listRoute53ZonesAndRecords, normalizeRecord, readAwsPublicEndpoints, readWafAssociations } = require('./awsPublicEndpoints');
const { findingsForChain } = require('./awsExposureChains');

test('normalizes Route53 aliases and resource record values', () => {
  assert.deepEqual(normalizeRecord({ Name: 'www.example.com.', Type: 'A', AliasTarget: { DNSName: 'd1.cloudfront.net.', HostedZoneId: 'ZCF' } }), {
    name: 'www.example.com.', type: 'A', setIdentifier: null, ttl: null,
    alias: { dnsName: 'd1.cloudfront.net.', zoneId: 'ZCF' }, records: [],
  });
});

test('reads public hosted zones and paginates their records while omitting private zones', async () => {
  class ListHostedZonesCommand { constructor(input) { this.input = input; } }
  class ListResourceRecordSetsCommand { constructor(input) { this.input = input; } }
  class Route53Client {
    async send(command) {
      if (command instanceof ListHostedZonesCommand) return { HostedZones: [
        { Id: '/hostedzone/ZPUB', Name: 'example.com.' },
        { Id: '/hostedzone/ZPRIV', Name: 'internal.', Config: { PrivateZone: true } },
      ] };
      if (command.input.StartRecordName) return { ResourceRecordSets: [{ Name: 'www.example.com.', Type: 'A', ResourceRecords: [{ Value: '192.0.2.1' }] }] };
      return { ResourceRecordSets: [{ Name: 'example.com.', Type: 'NS', ResourceRecords: [{ Value: 'ns.example.net.' }] }], IsTruncated: true, NextRecordName: 'www.example.com.', NextRecordType: 'A' };
    }
  }
  const result = await listRoute53ZonesAndRecords({}, { sdk: () => ({ Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand }) });
  assert.equal(result.hostedZones.length, 1);
  assert.deepEqual(result.hostedZones[0].records.map(record => record.type), ['NS', 'A']);
  assert.equal(result.truncated, false);
});

test('returns a partial endpoint inventory if one AWS source fails', async () => {
  const result = await readAwsPublicEndpoints({ region: 'us-east-1' }, {
    sdk: () => { throw new Error('should not load SDK when sources are replaced'); },
    loadBalancerReader: async () => ({ loadBalancers: [], unavailable: [], truncated: false }),
    loadBalancerDetailsReader: async () => null,
  });
  assert.equal(result.partial, true);
  assert.ok(result.unavailable.some(source => source.source === 'route53'));
  assert.ok(result.unavailable.some(source => source.source === 'cloudfront'));
  assert.equal(result.region, 'us-east-1');
});

test('reads WAF associations and keeps denied reads unknown instead of reporting missing protection', async () => {
  class GetWebACLForResourceCommand { constructor(input) { this.input = input; } }
  class WAFV2Client {
    async send(command) {
      if (command.input.ResourceArn.endsWith('/protected')) return { WebACL: { Name: 'edge', Id: 'acl-1', ARN: 'arn:aws:wafv2:us-east-1:123456789012:regional/webacl/edge/acl-1' } };
      if (command.input.ResourceArn.endsWith('/unprotected')) return { WebACL: undefined };
      throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    }
  }
  let requests = 0;
  const result = await readWafAssociations({ region: 'us-east-1' }, [
    { kind: 'load_balancer', resourceArn: 'arn:resource/protected' },
    { kind: 'api_gateway_stage', resourceArn: 'arn:resource/unprotected' },
    { kind: 'api_gateway_stage', resourceArn: 'arn:resource/denied' },
    { kind: 'unsupported', resourceArn: null },
  ], { sdk: () => ({ WAFV2Client, GetWebACLForResourceCommand }), beforeRequest: () => { requests += 1; } });
  assert.equal(requests, 3);
  assert.equal(result.byArn.get('arn:resource/protected').status, 'protected');
  assert.deepEqual(result.byArn.get('arn:resource/protected').webAcl, { name: 'edge', id: 'acl-1', arn: 'arn:aws:wafv2:us-east-1:123456789012:regional/webacl/edge/acl-1' });
  assert.equal(result.byArn.get('arn:resource/unprotected').status, 'unprotected');
  assert.equal(result.byArn.has('arn:resource/denied'), false);
  assert.deepEqual(result.unavailable, [{ source: 'waf-association:api_gateway_stage', resource: 'arn:resource/denied', reason: 'access_denied' }]);
});

test('only confirmed missing WAF associations create endpoint findings', () => {
  const unprotected = findingsForChain([{ type: 'load_balancer', id: 'lb-1', name: 'public-api', public: true, waf: { status: 'unprotected' } }]);
  const unknown = findingsForChain([{ type: 'load_balancer', id: 'lb-1', public: true, waf: { status: 'unknown' } }]);
  const protectedCloudFront = findingsForChain([{ type: 'cloudfront', webAclId: 'arn:acl' }]);
  const unprotectedCloudFront = findingsForChain([{ type: 'cloudfront', id: 'D123', name: 'd123.cloudfront.net', status: 'enabled' }]);
  const disabledCloudFront = findingsForChain([{ type: 'cloudfront', id: 'D123', status: 'disabled' }]);
  const unprotectedRestApi = findingsForChain([{ type: 'api_gateway', protocol: 'REST', apiId: 'api123', waf: { status: 'unprotected' } }]);
  assert.ok(unprotected.some(finding => finding.id === 'aws.public_endpoint_no_waf'));
  assert.ok(!unknown.some(finding => finding.id === 'aws.public_endpoint_no_waf'));
  assert.ok(!protectedCloudFront.some(finding => finding.id === 'aws.public_endpoint_no_waf'));
  assert.ok(unprotectedCloudFront.some(finding => finding.id === 'aws.public_endpoint_no_waf'));
  assert.ok(!disabledCloudFront.some(finding => finding.id === 'aws.public_endpoint_no_waf'));
  assert.ok(unprotectedRestApi.some(finding => finding.id === 'aws.public_endpoint_no_waf'));
});

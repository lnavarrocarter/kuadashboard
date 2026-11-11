'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listRoute53ZonesAndRecords, normalizeRecord, readAwsPublicEndpoints } = require('./awsPublicEndpoints');

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

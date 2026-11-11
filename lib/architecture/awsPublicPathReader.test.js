'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAwsPublicPathReader } = require('./awsPublicPathReader');

function commands(names) {
  return Object.fromEntries(names.map(name => [name, class { constructor(input) { this.input = input; } }]));
}

test('joins public Route53 aliases and CNAMEs through CloudFront origins to load balancers', async () => {
  const route53Commands = commands(['ListHostedZonesCommand', 'ListResourceRecordSetsCommand']);
  const cloudFrontCommands = commands(['ListDistributionsCommand']);
  class Route53Client {
    async send(command) {
      if (command instanceof route53Commands.ListHostedZonesCommand) return { HostedZones: [
        { Id: '/hostedzone/ZPUBLIC', Name: 'example.com.' },
        { Id: '/hostedzone/ZPRIVATE', Name: 'internal.', Config: { PrivateZone: true } },
      ] };
      return { ResourceRecordSets: [
        { Name: 'app.example.com.', Type: 'A', AliasTarget: { DNSName: 'd111.cloudfront.net.', HostedZoneId: 'ZCF' } },
        { Name: 'direct.example.com.', Type: 'CNAME', ResourceRecords: [{ Value: 'web-123.us-east-1.elb.amazonaws.com.' }] },
      ] };
    }
  }
  class CloudFrontClient {
    async send() { return { DistributionList: { IsTruncated: false, Items: [{
      Id: 'D111', DomainName: 'd111.cloudfront.net', Enabled: true,
      Aliases: { Items: ['www.example.com'] },
      Origins: { Items: [{ Id: 'origin-web', DomainName: 'web-123.us-east-1.elb.amazonaws.com' }] },
    }] } }; }
  }
  const lbArn = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/abcdef0123456789';
  const reader = createAwsPublicPathReader({
    route53Factory: () => new Route53Client(), cloudFrontFactory: () => new CloudFrontClient(),
    route53Commands, cloudFrontCommands,
  });
  const result = await reader.analyze({
    accountId: '123456789012', loadBalancers: [{ arn: lbArn, name: 'web', dnsName: 'web-123.us-east-1.elb.amazonaws.com', hostedZoneId: 'ZLB' }],
  });

  assert.deepEqual(result.resources.map(item => item.type).sort(), ['cloudfront', 'route53-record', 'route53-record']);
  assert.deepEqual(result.relationships.map(item => [item.evidence[0].type, item.sourceKey, item.targetKey]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['cloudfront_origin', 'arn:aws:cloudfront::123456789012:distribution/D111', lbArn],
    ['route53_record', 'AWS::Route53::RecordSet:123456789012:ZPUBLIC:app.example.com:A:', 'arn:aws:cloudfront::123456789012:distribution/D111'],
    ['route53_record', 'AWS::Route53::RecordSet:123456789012:ZPUBLIC:direct.example.com:CNAME:', lbArn],
  ]);
  assert.ok(!JSON.stringify(result).includes('profileId'));
});

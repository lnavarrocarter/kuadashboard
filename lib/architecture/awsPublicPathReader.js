'use strict';

const { lazyModule } = require('../lazyModule');

const route53Sdk = lazyModule('@aws-sdk/client-route-53');
const cloudFrontSdk = lazyModule('@aws-sdk/client-cloudfront');
const MAX_PAGES = 20;
const cleanDns = value => String(value || '').trim().toLowerCase().replace(/\.$/, '');

function makeCloudFrontArn(accountId, distributionId) {
  return accountId && distributionId ? `arn:aws:cloudfront::${accountId}:distribution/${distributionId}` : null;
}

function createAwsPublicPathReader({
  route53Factory = config => new route53Sdk.Route53Client(config),
  cloudFrontFactory = config => new cloudFrontSdk.CloudFrontClient(config),
  route53Commands = route53Sdk,
  cloudFrontCommands = cloudFrontSdk,
} = {}) {
  async function analyze({ config = {}, accountId = '', loadBalancers = [], beforeRequest = () => {} } = {}) {
    const resources = [];
    const relationships = [];
    const failures = [];
    let truncated = false;
    const byIdentity = new Map();
    const addResource = resource => {
      if (!byIdentity.has(resource.identity)) {
        byIdentity.set(resource.identity, resource);
        resources.push(resource);
      }
      return byIdentity.get(resource.identity);
    };
    const addRelationship = (source, target, evidence, confidence = 0.98) => {
      if (!source || !target || source === target) return;
      relationships.push({ sourceKey: source, targetKey: target, relationType: 'routes_to', confidence, evidence: [evidence] });
    };

    const lbByDns = new Map();
    for (const lb of loadBalancers) {
      if (!lb.arn || !lb.dnsName) continue;
      const key = cleanDns(lb.dnsName);
      lbByDns.set(key, { lb, identity: lb.arn });
    }

    const distributions = [];
    try {
      const client = cloudFrontFactory({ ...config, region: 'us-east-1' });
      let marker;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        beforeRequest({ operation: 'ListDistributions' });
        const response = await client.send(new cloudFrontCommands.ListDistributionsCommand(marker ? { Marker: marker } : {}));
        const list = response.DistributionList || {};
        distributions.push(...(list.Items || []));
        marker = list.IsTruncated ? list.NextMarker : null;
        if (!marker) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }
    } catch (error) {
      if (error.statusCode === 429) throw error;
      failures.push({ source: 'cloudfront-public-paths', code: error.name || 'CLOUDFRONT_INVENTORY_FAILED' });
    }

    const distributionsByDns = new Map();
    for (const distribution of distributions) {
      const arn = makeCloudFrontArn(accountId, distribution.Id);
      if (!arn) continue;
      const identity = arn;
      const resource = addResource({
        type: 'cloudfront', key: identity, identity, arn, name: distribution.Id,
        kind: 'AWS::CloudFront::Distribution', stackName: '', logicalId: '', sourceType: 'inventory',
        details: { domainName: distribution.DomainName || '', enabled: Boolean(distribution.Enabled), aliases: distribution.Aliases?.Items || [] },
      });
      for (const hostname of [distribution.DomainName, ...(distribution.Aliases?.Items || [])]) {
        const key = cleanDns(hostname);
        if (key) distributionsByDns.set(key, resource);
      }
      const origins = distribution.Origins?.Items || [];
      for (const origin of origins) {
        const target = lbByDns.get(cleanDns(origin.DomainName));
        if (!target) continue;
        addRelationship(identity, target.identity, {
          type: 'cloudfront_origin', originId: origin.Id || '', domainName: origin.DomainName || '',
          distributionId: distribution.Id,
        });
      }
    }

    try {
      const client = route53Factory({ ...config, region: 'us-east-1' });
      const zones = [];
      let marker;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        beforeRequest({ operation: 'ListHostedZones' });
        const response = await client.send(new route53Commands.ListHostedZonesCommand(marker ? { Marker: marker } : {}));
        zones.push(...(response.HostedZones || []));
        marker = response.IsTruncated ? response.NextMarker : null;
        if (!marker) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }
      for (const zone of zones.filter(item => !item.Config?.PrivateZone)) {
        let next = null;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const input = { HostedZoneId: zone.Id, ...(next || {}) };
          beforeRequest({ operation: 'ListResourceRecordSets' });
          const response = await client.send(new route53Commands.ListResourceRecordSetsCommand(input));
          for (const record of response.ResourceRecordSets || []) {
            if (!['A', 'AAAA', 'CNAME'].includes(record.Type)) continue;
            const name = cleanDns(record.Name);
            const zoneId = String(zone.Id || '').split('/').pop();
            const setIdentifier = record.SetIdentifier || '';
            const identity = `AWS::Route53::RecordSet:${accountId}:${zoneId}:${name}:${record.Type}:${setIdentifier}`;
            const dnsResource = addResource({
              type: 'route53-record', key: identity, identity, arn: null, name: record.Name || name,
              service: zone.Name || '', kind: 'AWS::Route53::RecordSet', stackName: '', logicalId: '', sourceType: 'inventory',
              details: { hostedZoneId: zoneId, recordType: record.Type, setIdentifier: setIdentifier || null },
            });
            const targets = record.AliasTarget?.DNSName
              ? [{ dnsName: record.AliasTarget.DNSName, hostedZoneId: record.AliasTarget.HostedZoneId || null }]
              : (record.ResourceRecords || []).map(item => ({ dnsName: item.Value, hostedZoneId: null }));
            for (const target of targets) {
              const hostname = cleanDns(target.dnsName);
              const distribution = distributionsByDns.get(hostname);
              if (distribution) addRelationship(dnsResource.identity, distribution.identity, {
                type: 'route53_record', recordType: record.Type, recordName: record.Name || name,
                target: target.dnsName, aliasHostedZoneId: target.hostedZoneId,
              });
              const loadBalancer = lbByDns.get(hostname);
              if (loadBalancer && (!target.hostedZoneId || !loadBalancer.lb.hostedZoneId || target.hostedZoneId === loadBalancer.lb.hostedZoneId)) {
                addRelationship(dnsResource.identity, loadBalancer.identity, {
                  type: 'route53_record', recordType: record.Type, recordName: record.Name || name,
                  target: target.dnsName, aliasHostedZoneId: target.hostedZoneId,
                });
              }
            }
          }
          next = response.IsTruncated ? {
            StartRecordName: response.NextRecordName,
            StartRecordType: response.NextRecordType,
            ...(response.NextRecordIdentifier ? { StartRecordIdentifier: response.NextRecordIdentifier } : {}),
          } : null;
          if (!next) break;
          if (page === MAX_PAGES - 1) truncated = true;
        }
      }
    } catch (error) {
      if (error.statusCode === 429) throw error;
      failures.push({ source: 'route53-public-paths', code: error.name || 'ROUTE53_INVENTORY_FAILED' });
    }

    return { resources, relationships, failures, truncated };
  }

  return { analyze };
}

module.exports = { createAwsPublicPathReader, makeCloudFrontArn };

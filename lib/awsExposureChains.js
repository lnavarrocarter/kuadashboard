'use strict';

const net = require('node:net');

const dnsName = value => String(value || '').trim().toLowerCase().replace(/\.$/, '');
const cloudFrontZone = 'Z2FDTNDATAQYW2';

const lbDnsKey = host => dnsName(host).replace(/^dualstack\./, '');

// ELB DNS names carry their region. ALB and Classic share one pattern, NLB uses
// `<name>.elb.<region>.amazonaws.com`, so it only needs the ELBv2 inventory.
function elbHost(host) {
  const key = lbDnsKey(host);
  const network = /^[a-z0-9-]+\.elb\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazonaws\.com(?:\.cn)?$/.exec(key);
  if (network) return { region: network[1], sources: ['elbv2'] };
  const application = /^(?:internal-)?[a-z0-9-]+\.([a-z]{2}(?:-[a-z]+)+-\d)\.elb\.amazonaws\.com(?:\.cn)?$/.exec(key);
  if (application) return { region: application[1], sources: ['elbv2', 'classic'] };
  return null;
}

// A missing ELB is reported as dangling only when the inventory for its region
// and every ELB API that could own that name was read completely.
function missingLoadBalancer(host, inventory) {
  const elb = elbHost(host);
  if (!elb) return null;
  const base = { type: 'load_balancer', name: host, region: elb.region, status: 'unresolved' };
  if (!inventory || !inventory.region || inventory.region !== elb.region) return { ...base, reason: 'load_balancer_region_not_inventoried' };
  if (!elb.sources.every(source => inventory.complete?.[source] === true)) return { ...base, reason: 'load_balancer_inventory_partial' };
  return { ...base, reason: 'load_balancer_not_found', dangling: true };
}

function isApiGatewayHost(host) {
  return /^[a-z0-9-]+\.execute-api(?:\.[a-z0-9-]+)?\.amazonaws\.com$/i.test(host);
}

function s3WebsiteBucket(host) {
  const match = /^(.+?)\.s3-website(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.exec(host);
  return match?.[1] || null;
}

function targetOf(value, zoneId, indexes) {
  const host = dnsName(value);
  if (!host) return { type: 'unresolved', name: '', status: 'unresolved', reason: 'empty_target' };
  const distribution = indexes.distributions.get(host);
  if (distribution) return { type: 'cloudfront', name: host, id: distribution.Id, distribution, status: distribution.Enabled ? 'enabled' : 'disabled' };

  const publicEndpoint = indexes.publicEndpoints.get(host);
  if (publicEndpoint) return { type: publicEndpoint.source, name: host, id: publicEndpoint.id, status: publicEndpoint.public === false ? 'private' : 'resolved', entry: publicEndpoint };

  const loadBalancers = indexes.loadBalancers.get(lbDnsKey(host)) || [];
  const exactLb = loadBalancers.filter(lb => !zoneId || !lb.hostedZoneId || lb.hostedZoneId === zoneId);
  if (exactLb.length === 1) return { type: 'load_balancer', name: host, loadBalancer: exactLb[0], status: exactLb[0].state || 'unknown' };
  if (exactLb.length > 1) return { type: 'unresolved', name: host, status: 'unresolved', reason: 'ambiguous_load_balancer' };
  if (!loadBalancers.length) {
    const missing = missingLoadBalancer(host, indexes.loadBalancerInventory);
    if (missing) return missing;
  }

  if (isApiGatewayHost(host)) return { type: 'api_gateway', name: host, status: 'unresolved', reason: 'api_gateway_identity_unavailable' };
  const bucket = s3WebsiteBucket(host);
  if (bucket) return { type: 's3_website', name: host, bucket, status: 'unresolved', reason: 'bucket_identity_unavailable' };
  if (net.isIP(host)) return { type: 'external_ip', name: host, status: 'unresolved', reason: 'resource_identity_unavailable' };
  return { type: 'external_domain', name: host, status: 'unresolved', reason: 'target_not_in_selected_inventory' };
}

function recordTargets(record) {
  if (record.alias?.dnsName) return [{ name: record.alias.dnsName, zoneId: record.alias.zoneId || null }];
  return (record.records || []).map(value => ({ name: value, zoneId: null }));
}

function recordKey(record) {
  return `${dnsName(record.name)}|${record.type}`;
}

function instanceById(instances, id) {
  return instances.get(id) || null;
}

function backendHops(targetGroup, context) {
  const targetRefs = targetGroup.targetRefs || [];
  const service = context.servicesByTargetGroup.get(targetGroup.arn) || null;
  const hops = [];
  if (service) hops.push({ type: 'ecs_service', id: service.arn, name: service.name, cluster: service.cluster || null, status: 'resolved' });

  for (const target of targetRefs) {
    if (targetGroup.targetType === 'lambda' || String(target.id).startsWith('arn:aws:lambda:')) {
      const name = String(target.id).split(':').pop();
      hops.push({ type: 'lambda', id: target.id, name, status: 'resolved', health: target.state || null });
    } else if (targetGroup.targetType === 'instance' || /^i-[0-9a-f]+$/i.test(target.id)) {
      const instance = instanceById(context.instancesById, target.id);
      hops.push(instance
        ? { type: 'ec2_instance', id: instance.id, name: instance.name || instance.id, privateIp: instance.privateIp || null, status: 'resolved', health: target.state || null }
        : { type: 'ec2_instance', id: target.id, name: target.id, status: 'unresolved', reason: 'instance_not_in_selected_region', health: target.state || null });
    } else if (net.isIP(target.id)) {
      hops.push(service
        ? { type: 'ecs_target', id: target.id, serviceArn: service.arn, serviceName: service.name, port: target.port || null, status: 'resolved', health: target.state || null }
        : { type: 'external_ip', id: target.id, port: target.port || null, status: 'unresolved', reason: 'no_matching_ecs_service', health: target.state || null });
    } else {
      hops.push({ type: 'external_target', id: target.id, port: target.port || null, status: 'unresolved', reason: 'unsupported_target_type', health: target.state || null });
    }
  }

  if (!targetRefs.length && !service) {
    hops.push({ type: 'backend', status: 'unresolved', reason: 'target_details_unavailable' });
  }
  return hops;
}

function targetGroupBranches(loadBalancer, detail, context) {
  const groupsByName = new Map((loadBalancer.targetGroups || []).map(group => [group.name, group]));
  const branches = [];
  for (const listener of detail?.listeners || []) {
    const routes = [
      { conditions: [], action: listener.defaultAction },
      ...(listener.rules || []).map(rule => ({ conditions: rule.conditions || [], action: rule.action })),
    ];
    for (const route of routes) {
      if (route.action?.type !== 'forward') continue;
      for (const groupName of route.action.targetGroups || []) {
        const group = groupsByName.get(groupName);
        if (!group) {
          branches.push([{ type: 'listener', port: listener.port, protocol: listener.protocol, redirectToHttps: listener.defaultAction?.toHttps === true, oldTls: listener.oldTls === true, conditions: route.conditions, status: 'resolved' },
            { type: 'target_group', name: groupName, status: 'unresolved', reason: 'target_group_not_in_inventory' }]);
          continue;
        }
        branches.push([
          { type: 'listener', port: listener.port, protocol: listener.protocol, redirectToHttps: listener.defaultAction?.toHttps === true, oldTls: listener.oldTls === true, conditions: route.conditions, status: 'resolved' },
          { type: 'target_group', id: group.arn || group.name, name: group.name, targetType: group.targetType, health: group.targets, status: group.targets?.total && !group.targets.healthy ? 'unhealthy' : 'resolved' },
          ...backendHops(group, context),
        ]);
      }
    }
  }

  if (!branches.length) {
    for (const group of loadBalancer.targetGroups || []) {
      branches.push([
        { type: 'target_group', id: group.arn || group.name, name: group.name, targetType: group.targetType, health: group.targets, status: group.targets?.total && !group.targets.healthy ? 'unhealthy' : 'resolved' },
        ...backendHops(group, context),
      ]);
    }
  }
  if (!branches.length) branches.push([{ type: 'backend', status: 'unresolved', reason: 'no_forwarding_target' }]);
  return branches;
}

function cloudFrontBranches(target, context) {
  const distribution = target.distribution;
  const origins = new Map((distribution.Origins?.Items || []).map(origin => [origin.Id, origin]));
  const behaviors = [
    { path: '*', originId: distribution.DefaultCacheBehavior?.TargetOriginId },
    ...(distribution.CacheBehaviors?.Items || []).map(behavior => ({ path: behavior.PathPattern, originId: behavior.TargetOriginId })),
  ];
  return behaviors.flatMap(behavior => {
    const origin = origins.get(behavior.originId);
    const next = origin ? targetOf(origin.DomainName, null, context.indexes) : { type: 'unresolved', status: 'unresolved', reason: 'origin_not_in_distribution' };
    const cloudFrontHop = { type: 'cloudfront', id: distribution.Id, name: distribution.DomainName, status: distribution.Enabled ? 'enabled' : 'disabled', path: behavior.path, originId: behavior.originId || null, webAclId: distribution.WebACLId || null };
    if (next.type === 'load_balancer' && next.loadBalancer) {
      return targetGroupBranches(next.loadBalancer, context.lbDetails.get(next.loadBalancer.arn || next.loadBalancer.id), context).map(branch => [
        cloudFrontHop,
        { type: 'origin', name: next.name, status: 'resolved' },
        { type: 'load_balancer', id: next.loadBalancer.arn || next.loadBalancer.id, name: next.loadBalancer.name, dnsName: next.loadBalancer.dnsName, scheme: next.loadBalancer.scheme, public: next.loadBalancer.scheme === 'internet-facing', status: next.loadBalancer.state || 'unknown', waf: next.loadBalancer.waf || { status: 'unknown' } },
        ...branch,
      ]);
    }
    return [[cloudFrontHop, { type: 'origin', name: origin?.DomainName || '', status: origin ? 'resolved' : 'unresolved' }, next]];
  });
}

function findingsForChain(hops) {
  const findings = [];
  const dangling = hops.find((hop, index) => hop.dangling && hops[index - 1]?.type === 'route53');
  if (dangling) findings.push({
    id: 'aws.public_endpoint_dangling_dns', severity: 'high',
    key: 'publicEndpoints.finding.danglingDns', whyKey: 'publicEndpoints.why.danglingDns',
    resource: hops[hops.indexOf(dangling) - 1].name,
  });
  const cloudfront = hops.some(hop => hop.type === 'cloudfront');
  const publicLoadBalancer = hops.find(hop => hop.type === 'load_balancer' && hop.public);
  if (cloudfront && publicLoadBalancer) findings.push({
    id: 'aws.public_endpoint_cloudfront_bypass', severity: 'high',
    key: 'publicEndpoints.finding.cloudfrontBypass', whyKey: 'publicEndpoints.why.cloudfrontBypass',
    resource: publicLoadBalancer.id || publicLoadBalancer.name,
  });
  const unprotectedWafHop = hops.find(hop =>
    (hop.type === 'cloudfront' && hop.status === 'enabled' && !hop.webAclId)
    || (hop.type === 'load_balancer' && hop.public && hop.waf?.status === 'unprotected')
    || (hop.type === 'api_gateway' && hop.protocol === 'REST' && hop.waf?.status === 'unprotected'));
  if (unprotectedWafHop) findings.push({
    id: 'aws.public_endpoint_no_waf', severity: 'medium',
    key: 'publicEndpoints.finding.noWaf', whyKey: 'publicEndpoints.why.noWaf',
    resource: unprotectedWafHop.name || unprotectedWafHop.id || unprotectedWafHop.apiId || unprotectedWafHop.webAclId,
  });
  for (const listener of hops.filter(hop => hop.type === 'listener')) {
    if (listener.protocol === 'HTTP' && !listener.redirectToHttps) findings.push({
      id: 'aws.public_endpoint_http', severity: 'medium',
      key: 'publicEndpoints.finding.http', whyKey: 'publicEndpoints.why.http', resource: listener.port,
    });
    if (listener.oldTls) findings.push({
      id: 'aws.public_endpoint_weak_tls', severity: 'medium',
      key: 'publicEndpoints.finding.weakTls', whyKey: 'publicEndpoints.why.weakTls', resource: listener.port,
    });
  }
  for (const group of hops.filter(hop => hop.type === 'target_group' && hop.health)) {
    if (group.health.healthy === 0) findings.push({
      id: 'aws.public_endpoint_no_healthy_targets', severity: 'high',
      key: 'publicEndpoints.finding.noHealthyTargets', whyKey: 'publicEndpoints.why.noHealthyTargets', resource: group.name,
    });
    else if (group.health.unhealthy > 0) findings.push({
      id: 'aws.public_endpoint_unhealthy_targets', severity: 'medium',
      key: 'publicEndpoints.finding.unhealthyTargets', whyKey: 'publicEndpoints.why.unhealthyTargets', resource: group.name,
    });
  }
  return findings;
}

function buildAwsExposureChains({ hostedZones = [], distributions = [], loadBalancers = [], lbDetails = new Map(), services = [], instances = [], additionalEntries = [], unavailable = [], truncated = false, loadBalancerInventory = null } = {}) {
  const publicZones = hostedZones.filter(zone => !zone.private);
  const distributionsByDns = new Map();
  for (const distribution of distributions) {
    const key = dnsName(distribution.DomainName);
    if (key) distributionsByDns.set(key, distribution);
  }
  const loadBalancersByDns = new Map();
  for (const lb of loadBalancers) {
    const key = lbDnsKey(lb.dnsName);
    if (key) loadBalancersByDns.set(key, [...(loadBalancersByDns.get(key) || []), lb]);
  }
  const servicesByTargetGroup = new Map();
  for (const service of services) for (const targetGroupArn of service.targetGroupArns || []) {
    servicesByTargetGroup.set(targetGroupArn, service);
  }
  const context = {
    indexes: { distributions: distributionsByDns, loadBalancers: loadBalancersByDns, loadBalancerInventory,
      publicEndpoints: new Map(additionalEntries.map(item => [dnsName(item.hostname), item]).filter(([host]) => host)) },
    servicesByTargetGroup,
    instancesById: new Map(instances.map(instance => [instance.id, instance])),
    lbDetails: lbDetails instanceof Map ? lbDetails : new Map(Object.entries(lbDetails)),
  };
  const chains = [];

  for (const zone of publicZones) {
    const records = zone.records || [];
    const recordsByName = new Map();
    for (const record of records) {
      const key = recordKey(record);
      recordsByName.set(key, [...(recordsByName.get(key) || []), record]);
    }

    for (const record of records) {
      if (!['A', 'AAAA', 'CNAME'].includes(record.type)) continue;
      const endpoint = dnsName(record.name);
      const entryId = `${zone.id}:${endpoint}:${record.type}:${record.setIdentifier || ''}`;
      const targets = recordTargets(record);
      const visit = (targetValue, targetZoneId, hops, visited, depth = 0) => {
        if (depth > 12) {
          chains.push({ id: `${entryId}:${chains.length}`, hostname: endpoint, recordType: record.type, setIdentifier: record.setIdentifier || null, zone: { id: zone.id, name: zone.name }, hops: [...hops, { type: 'unresolved', name: dnsName(targetValue), status: 'unresolved', reason: 'dns_alias_depth_exceeded' }] });
          return;
        }
        const host = dnsName(targetValue);
        const recursiveRecords = recordsByName.get(`${host}|CNAME`) || [];
        const recordTargetsHere = [...(recordsByName.get(`${host}|A`) || []), ...(recordsByName.get(`${host}|AAAA`) || [])];
        const nextRecords = recursiveRecords.length ? recursiveRecords : recordTargetsHere;
        const visitKey = `${host}|${targetZoneId || ''}`;
        if (nextRecords.length && !visited.has(visitKey)) {
          const nextVisited = new Set(visited).add(visitKey);
          for (const nextRecord of nextRecords) for (const nextTarget of recordTargets(nextRecord)) {
            visit(nextTarget.name, nextTarget.zoneId, [...hops, { type: 'route53_record', name: host, recordType: nextRecord.type, status: 'resolved' }], nextVisited, depth + 1);
          }
          return;
        }
        if (nextRecords.length && visited.has(visitKey)) {
          chains.push({ id: `${entryId}:${chains.length}`, hostname: endpoint, recordType: record.type, setIdentifier: record.setIdentifier || null, zone: { id: zone.id, name: zone.name }, hops: [...hops, { type: 'route53_record', name: host, recordType: 'CNAME', status: 'unresolved', reason: 'dns_alias_cycle' }] });
          return;
        }

        const target = targetOf(host, targetZoneId, context.indexes);
        const baseHops = [...hops];
        if (target.type === 'cloudfront') {
          for (const branch of cloudFrontBranches(target, context)) chains.push({ id: `${entryId}:${chains.length}`, hostname: endpoint, recordType: record.type, setIdentifier: record.setIdentifier || null, zone: { id: zone.id, name: zone.name }, hops: [...baseHops, { type: 'route53', name: endpoint, target: host, recordType: record.type, status: 'resolved' }, ...branch] });
          return;
        }
        if (target.type === 'load_balancer' && target.loadBalancer) {
          const lb = target.loadBalancer;
          const lbHop = { type: 'load_balancer', id: lb.arn || lb.id, name: lb.name, dnsName: lb.dnsName, scheme: lb.scheme, public: lb.scheme === 'internet-facing', status: lb.state || 'unknown', waf: lb.waf || { status: 'unknown' } };
          const branches = targetGroupBranches(lb, context.lbDetails.get(lb.arn || lb.id), context);
          for (const branch of branches) chains.push({ id: `${entryId}:${chains.length}`, hostname: endpoint, recordType: record.type, setIdentifier: record.setIdentifier || null, zone: { id: zone.id, name: zone.name }, hops: [...baseHops, { type: 'route53', name: endpoint, target: host, recordType: record.type, status: 'resolved' }, lbHop, ...branch] });
          return;
        }
        chains.push({ id: `${entryId}:${chains.length}`, hostname: endpoint, recordType: record.type, setIdentifier: record.setIdentifier || null, zone: { id: zone.id, name: zone.name }, hops: [...baseHops, { type: 'route53', name: endpoint, target: host, recordType: record.type, status: 'resolved' }, target] });
      };

      if (!targets.length) {
        chains.push({ id: entryId, hostname: endpoint, recordType: record.type, setIdentifier: record.setIdentifier || null, zone: { id: zone.id, name: zone.name }, hops: [{ type: 'route53', name: endpoint, target: null, recordType: record.type, status: 'unresolved' }, { type: 'unresolved', name: endpoint, status: 'unresolved', reason: 'record_has_no_target' }] });
      } else {
        for (const target of targets) visit(target.name, target.zoneId, [], new Set([`${endpoint}|`]), 0);
      }
    }
  }

  return {
    entries: [...chains, ...additionalEntries].map(entry => ({ ...entry, findings: findingsForChain(entry.hops || []) })),
    unavailable: unavailable.map(item => ({ source: item.source, reason: item.reason || 'unavailable' })),
    partial: Boolean(truncated || unavailable.length),
    totals: { publicZones: publicZones.length, entries: chains.length + additionalEntries.length, privateZonesSkipped: hostedZones.length - publicZones.length },
  };
}

module.exports = { buildAwsExposureChains, dnsName, elbHost, findingsForChain, missingLoadBalancer, isApiGatewayHost, recordTargets, s3WebsiteBucket, targetOf };

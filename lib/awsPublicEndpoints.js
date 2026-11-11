'use strict';

const { mapWithConcurrency, settle } = require('./awsActivity');
const { listLoadBalancers, describeLoadBalancer } = require('./awsLoadBalancers');
const { buildAwsExposureChains } = require('./awsExposureChains');
const { readAwsPublicEntrypoints } = require('./awsPublicEntrypoints');

const MAX_PAGES = 20;
const MAX_REQUESTS = 500;

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

function createRequestBudget(limit = MAX_REQUESTS) {
  let requests = 0;
  return {
    beforeRequest() {
      if (requests >= limit) throw Object.assign(new Error('AWS endpoint inventory request limit reached'), { statusCode: 429 });
      requests += 1;
    },
    get requests() { return requests; },
  };
}

function normalizeRecord(record) {
  return {
    name: record.Name || '',
    type: record.Type || '',
    setIdentifier: record.SetIdentifier || null,
    ttl: record.TTL ?? null,
    alias: record.AliasTarget ? { dnsName: record.AliasTarget.DNSName || '', zoneId: record.AliasTarget.HostedZoneId || null } : null,
    records: (record.ResourceRecords || []).map(item => item.Value).filter(Boolean),
  };
}

async function listRoute53ZonesAndRecords(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand } = sdk('client-route-53');
  const client = new Route53Client({ ...cfg, region: 'us-east-1' });
  const zones = [];
  const unavailable = [];
  let marker;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    beforeRequest({ source: 'route53-zones' });
    const response = await client.send(new ListHostedZonesCommand(marker ? { Marker: marker } : {}));
    zones.push(...(response.HostedZones || []));
    marker = response.IsTruncated ? response.NextMarker : null;
    if (!marker) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const publicZones = zones.filter(zone => !zone.Config?.PrivateZone);
  const inventories = await mapWithConcurrency(publicZones, 4, async zone => settle((async () => {
    const records = [];
    let next = null;
    let pages = 0;
    do {
      const input = { HostedZoneId: zone.Id };
      if (next) Object.assign(input, next);
      beforeRequest({ source: 'route53-records', zone: zone.Name });
      const response = await client.send(new ListResourceRecordSetsCommand(input));
      records.push(...(response.ResourceRecordSets || []).map(normalizeRecord));
      next = response.IsTruncated ? {
        StartRecordName: response.NextRecordName,
        StartRecordType: response.NextRecordType,
        ...(response.NextRecordIdentifier ? { StartRecordIdentifier: response.NextRecordIdentifier } : {}),
      } : null;
      pages += 1;
      if (pages >= MAX_PAGES && next) {
        truncated = true;
        break;
      }
    } while (next);
    return { id: String(zone.Id || '').split('/').pop(), name: zone.Name || '', private: false, records };
  })())).then(results => results.map((result, index) => {
    if (result.ok) return result.value;
    unavailable.push({ source: `route53-records:${publicZones[index]?.Name || 'unknown'}`, reason: result.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
    return null;
  }).filter(Boolean));

  return { hostedZones: inventories, unavailable, truncated };
}

async function listCloudFrontDistributions(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const { CloudFrontClient, ListDistributionsCommand } = sdk('client-cloudfront');
  const client = new CloudFrontClient({ ...cfg, region: 'us-east-1' });
  const distributions = [];
  let marker;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    beforeRequest({ source: 'cloudfront' });
    const response = await client.send(new ListDistributionsCommand(marker ? { Marker: marker } : {}));
    const pageResult = response.DistributionList || {};
    distributions.push(...(pageResult.Items || []));
    marker = pageResult.IsTruncated ? pageResult.NextMarker : null;
    if (!marker) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { distributions, truncated };
}

async function listEcsLoadBalancerServices(cfg, targetGroupArns, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  if (!targetGroupArns.length) return [];
  const { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand } = sdk('client-ecs');
  const client = new ECSClient(cfg);
  const services = [];
  const clusterArns = [];
  let clusterToken;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    beforeRequest({ source: 'ecs-clusters' });
    const response = await client.send(new ListClustersCommand({ maxResults: 100, ...(clusterToken ? { nextToken: clusterToken } : {}) }));
    clusterArns.push(...(response.clusterArns || []));
    clusterToken = response.nextToken;
    if (!clusterToken) break;
  }

  for (const cluster of clusterArns) {
    let serviceToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      beforeRequest({ source: 'ecs-services', cluster });
      const response = await client.send(new ListServicesCommand({ cluster, maxResults: 100, ...(serviceToken ? { nextToken: serviceToken } : {}) }));
      const serviceArns = response.serviceArns || [];
      for (let offset = 0; offset < serviceArns.length; offset += 10) {
        beforeRequest({ source: 'ecs-service-details', cluster });
        const detail = await client.send(new DescribeServicesCommand({ cluster, services: serviceArns.slice(offset, offset + 10) }));
        for (const service of detail.services || []) {
          const targetGroupArns = [...new Set((service.loadBalancers || []).map(item => item.targetGroupArn).filter(Boolean))];
          services.push({
            arn: service.serviceArn,
            name: service.serviceName,
            cluster,
            targetGroupArns,
          });
        }
      }
      serviceToken = response.nextToken;
      if (!serviceToken) break;
    }
  }
  const wanted = new Set(targetGroupArns);
  return services.filter(service => service.targetGroupArns.some(arn => wanted.has(arn)));
}

async function describeEc2Targets(cfg, ids, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  if (!ids.length) return [];
  const { EC2Client, DescribeInstancesCommand } = sdk('client-ec2');
  const client = new EC2Client(cfg);
  const instances = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    beforeRequest({ source: 'ec2-targets' });
    const response = await client.send(new DescribeInstancesCommand({ InstanceIds: ids.slice(offset, offset + 100) }));
    for (const reservation of response.Reservations || []) for (const instance of reservation.Instances || []) {
      instances.push({
        id: instance.InstanceId,
        name: instance.Tags?.find(tag => tag.Key === 'Name')?.Value || null,
        state: instance.State?.Name || 'unknown',
        privateIp: instance.PrivateIpAddress || null,
      });
    }
  }
  return instances;
}

async function readAwsPublicEndpoints(cfg, { sdk = defaultSdk, requestLimit = MAX_REQUESTS, loadBalancerReader = listLoadBalancers, loadBalancerDetailsReader = describeLoadBalancer } = {}) {
  const budget = createRequestBudget(requestLimit);
  const unavailable = [];
  let truncated = false;
  const [dnsResult, cloudFrontResult, lbResult] = await Promise.all([
    settle(listRoute53ZonesAndRecords(cfg, { sdk, beforeRequest: budget.beforeRequest })),
    settle(listCloudFrontDistributions(cfg, { sdk, beforeRequest: budget.beforeRequest })),
    settle(loadBalancerReader(cfg, { sdk, beforeRequest: budget.beforeRequest, includeTargetDetails: true })),
  ]);

  if (!dnsResult.ok) unavailable.push({ source: 'route53', reason: dnsResult.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  if (!cloudFrontResult.ok) unavailable.push({ source: 'cloudfront', reason: cloudFrontResult.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  if (!lbResult.ok) unavailable.push({ source: 'load-balancers', reason: lbResult.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  const dns = dnsResult.ok ? dnsResult.value : { hostedZones: [], unavailable: [], truncated: false };
  const cloudFront = cloudFrontResult.ok ? cloudFrontResult.value : { distributions: [], truncated: false };
  const lbInventory = lbResult.ok ? lbResult.value : { loadBalancers: [], unavailable: [], truncated: false };
  unavailable.push(...dns.unavailable, ...(lbInventory.unavailable || []));
  truncated ||= dns.truncated || cloudFront.truncated || lbInventory.truncated;

  const loadBalancers = lbInventory.loadBalancers || [];
  const details = new Map();
  const detailResults = await mapWithConcurrency(loadBalancers, 4, async lb => settle((async () => {
    if (!lb.arn) return [lb.id, null];
    budget.beforeRequest({ source: 'load-balancer-rules' });
    return [lb.arn, await loadBalancerDetailsReader(cfg, { arn: lb.arn }, { sdk })];
  })()));
  for (let index = 0; index < detailResults.length; index += 1) {
    const result = detailResults[index];
    if (result.ok) details.set(result.value[0], result.value[1]);
    else unavailable.push({ source: `load-balancer-rules:${loadBalancers[index]?.name || 'unknown'}`, reason: result.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  }

  const targetGroups = loadBalancers.flatMap(lb => lb.targetGroups || []);
  const targetGroupArns = [...new Set(targetGroups.map(group => group.arn).filter(Boolean))];
  const targetIds = [...new Set(targetGroups.filter(group => group.targetType === 'instance')
    .flatMap(group => group.targetRefs || []).map(target => target.id)
    .filter(id => /^i-[0-9a-f]+$/i.test(id || '')))];
  const [ecsResult, instancesResult] = await Promise.all([
    settle(listEcsLoadBalancerServices(cfg, targetGroupArns, { sdk, beforeRequest: budget.beforeRequest })),
    settle(describeEc2Targets(cfg, targetIds, { sdk, beforeRequest: budget.beforeRequest })),
  ]);
  if (!ecsResult.ok && targetGroupArns.length) unavailable.push({ source: 'ecs-load-balancer-services', reason: ecsResult.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  if (!instancesResult.ok && targetIds.length) unavailable.push({ source: 'ec2-load-balancer-targets', reason: instancesResult.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });

  const publicEntrypointsResult = await settle(readAwsPublicEntrypoints(cfg, { sdk, beforeRequest: budget.beforeRequest }));
  const publicEntrypoints = publicEntrypointsResult.ok ? publicEntrypointsResult.value : { entries: [], unavailable: [], truncated: false };
  if (!publicEntrypointsResult.ok) unavailable.push({ source: 'public-entrypoints', reason: publicEntrypointsResult.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  unavailable.push(...publicEntrypoints.unavailable);
  truncated ||= publicEntrypoints.truncated;

  const result = buildAwsExposureChains({
    hostedZones: dns.hostedZones,
    distributions: cloudFront.distributions,
    loadBalancers,
    lbDetails: details,
    services: ecsResult.ok ? ecsResult.value : [],
    instances: instancesResult.ok ? instancesResult.value : [],
    additionalEntries: publicEntrypoints.entries,
    unavailable,
    truncated,
  });
  return { ...result, region: cfg.region || null, requests: budget.requests };
}

module.exports = {
  MAX_PAGES,
  MAX_REQUESTS,
  createRequestBudget,
  describeEc2Targets,
  listCloudFrontDistributions,
  listEcsLoadBalancerServices,
  listRoute53ZonesAndRecords,
  normalizeRecord,
  readAwsPublicEndpoints,
};

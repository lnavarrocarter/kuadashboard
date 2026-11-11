'use strict';

const { mapWithConcurrency, settle } = require('./awsActivity');
const { openSensitivePorts } = require('./advisor/aws');

const MAX_PAGES = 20;

function defaultSdk(pkg) { return require(`@aws-sdk/${pkg}`); }
function notFound(error) { return ['ResourceNotFoundException', 'NotFoundException', 'NoSuchWebsiteConfiguration', 'NoSuchBucketPolicy'].includes(error?.name); }
function entry(id, hostname, kind, hops, extra = {}) { return { id, hostname, source: kind, hops, ...extra }; }
function endpointHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return String(url || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase(); }
}

function awsPartition(region = '') {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  if (region.startsWith('us-iso-')) return 'aws-iso';
  if (region.startsWith('us-isob-')) return 'aws-iso-b';
  if (region.startsWith('us-isof-')) return 'aws-iso-f';
  if (region.startsWith('eu-isoe-')) return 'aws-iso-e';
  return 'aws';
}

function apiGatewayStageArn(region, apiId, stage) {
  if (!region || !apiId || !stage) return null;
  return `arn:${awsPartition(region)}:apigateway:${region}::/restapis/${apiId}/stages/${stage}`;
}

async function readApiGateway(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const entries = []; const unavailable = []; let truncated = false;
  const privateRestApiIds = new Set();
  const v1 = sdk('client-api-gateway'); const v2 = sdk('client-apigatewayv2');
  const collectV1 = async () => {
    const client = new v1.APIGatewayClient(cfg); const apis = []; let position;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      beforeRequest({ source: 'api-gateway-rest' });
      const response = await client.send(new v1.GetRestApisCommand({ limit: 500, ...(position ? { position } : {}) }));
      apis.push(...(response.items || [])); position = response.position;
      if (!position) break; if (page === MAX_PAGES - 1) truncated = true;
    }
    const details = await mapWithConcurrency(apis, 4, async api => settle((async () => {
      beforeRequest({ source: 'api-gateway-rest-detail' });
      const [stages, config] = await Promise.all([
        client.send(new v1.GetStagesCommand({ restApiId: api.id })),
        client.send(new v1.GetRestApiCommand({ restApiId: api.id })),
      ]);
      return {
        api,
        stages: stages.item || [],
        disabled: Boolean(config.disableExecuteApiEndpoint),
        private: (config.endpointConfiguration?.types || []).includes('PRIVATE'),
      };
    })()));
    for (const result of details) {
      if (!result.ok) { unavailable.push({ source: 'api-gateway-rest-detail', reason: 'read_failed' }); continue; }
      const { api, stages, disabled, private: isPrivate } = result.value;
      if (isPrivate) { privateRestApiIds.add(api.id); continue; }
      for (const stage of stages) {
        const hostname = `${api.id}.execute-api.${cfg.region}.amazonaws.com`;
        entries.push(entry(`apigateway:rest:${api.id}:${stage.stageName}`, hostname, 'api_gateway', [
          { type: 'api_gateway', apiId: api.id, name: api.name, protocol: 'REST', endpoint: hostname, stage: stage.stageName, resourceArn: apiGatewayStageArn(cfg.region, api.id, stage.stageName), endpointEnabled: !disabled, status: 'resolved' },
          { type: 'api_gateway_stage', name: stage.stageName, status: 'resolved' },
        ], { endpointEnabled: !disabled }));
      }
    }
    try {
      beforeRequest({ source: 'api-gateway-domains' });
      const domains = await client.send(new v1.GetDomainNamesCommand({ limit: 500 }));
      for (const domain of domains.items || []) {
        if ((domain.endpointConfiguration?.types || []).includes('PRIVATE')) continue;
        let position;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          beforeRequest({ source: 'api-gateway-domain-mappings' });
          const mappings = await client.send(new v1.GetBasePathMappingsCommand({ domainName: domain.domainName, ...(position ? { position } : {}) }));
          for (const mapping of mappings.items || []) {
            if (privateRestApiIds.has(mapping.restApiId)) continue;
            entries.push(entry(`apigateway:custom:${domain.domainName}:${mapping.restApiId}:${mapping.stage || ''}`, domain.domainName, 'api_gateway_custom_domain', [
              { type: 'api_gateway_custom_domain', name: domain.domainName, protocol: domain.endpointConfiguration?.types?.[0] || null, status: 'resolved' },
              { type: 'api_gateway', apiId: mapping.restApiId, protocol: 'REST', stage: mapping.stage || null, resourceArn: apiGatewayStageArn(cfg.region, mapping.restApiId, mapping.stage), basePath: mapping.basePath || '', status: 'resolved' },
            ]));
          }
          position = mappings.position; if (!position) break; if (page === MAX_PAGES - 1) truncated = true;
        }
      }
    } catch { unavailable.push({ source: 'api-gateway-domains', reason: 'read_failed' }); }
  };
  const collectV2 = async () => {
    const client = new v2.ApiGatewayV2Client(cfg); const apis = []; let nextToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      beforeRequest({ source: 'api-gateway-v2' });
      const response = await client.send(new v2.GetApisCommand({ ...(nextToken ? { NextToken: nextToken } : {}) }));
      apis.push(...(response.Items || [])); nextToken = response.NextToken;
      if (!nextToken) break; if (page === MAX_PAGES - 1) truncated = true;
    }
    const details = await mapWithConcurrency(apis, 4, async api => settle((async () => {
      beforeRequest({ source: 'api-gateway-v2-stages' });
      const result = await client.send(new v2.GetStagesCommand({ ApiId: api.ApiId }));
      return { api, stages: result.Items || [] };
    })()));
    for (const result of details) {
      if (!result.ok) { unavailable.push({ source: 'api-gateway-v2-stages', reason: 'read_failed' }); continue; }
      for (const stage of result.value.stages) {
        const api = result.value.api; const host = endpointHost(api.ApiEndpoint);
        entries.push(entry(`apigateway:v2:${api.ApiId}:${stage.StageName}`, host, 'api_gateway', [
          { type: 'api_gateway', apiId: api.ApiId, name: api.Name || api.ApiId, protocol: api.ProtocolType || 'HTTP', endpoint: api.ApiEndpoint, stage: stage.StageName, endpointEnabled: api.DisableExecuteApiEndpoint !== true, status: 'resolved' },
          { type: 'api_gateway_stage', name: stage.StageName, status: 'resolved' },
        ], { endpointEnabled: api.DisableExecuteApiEndpoint !== true }));
      }
    }
    try {
      beforeRequest({ source: 'api-gateway-v2-domains' });
      const domains = await client.send(new v2.GetDomainNamesCommand({}));
      for (const domain of domains.Items || []) {
        beforeRequest({ source: 'api-gateway-v2-mappings' });
        const mappings = await client.send(new v2.GetApiMappingsCommand({ DomainName: domain.DomainName }));
        for (const mapping of mappings.Items || []) entries.push(entry(`apigateway:custom:${domain.DomainName}:${mapping.ApiId}:${mapping.Stage || ''}`, domain.DomainName, 'api_gateway_custom_domain', [
          { type: 'api_gateway_custom_domain', name: domain.DomainName, status: 'resolved' },
          { type: 'api_gateway', apiId: mapping.ApiId, stage: mapping.Stage || null, apiMappingKey: mapping.ApiMappingKey || '', status: 'resolved' },
        ]));
      }
    } catch { unavailable.push({ source: 'api-gateway-v2-domains', reason: 'read_failed' }); }
  };
  const results = await Promise.all([settle(collectV1()), settle(collectV2())]);
  results.forEach((result, index) => { if (!result.ok) unavailable.push({ source: index ? 'api-gateway-v2' : 'api-gateway-rest', reason: result.error?.statusCode === 429 ? 'request_limit' : 'read_failed' }); });
  return { entries, unavailable, truncated };
}

async function readLambdaUrls(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const entries = []; const unavailable = []; let truncated = false;
  const { LambdaClient, ListFunctionsCommand, GetFunctionUrlConfigCommand } = sdk('client-lambda');
  const client = new LambdaClient(cfg); const functions = []; let Marker;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    beforeRequest({ source: 'lambda-functions' });
    const result = await client.send(new ListFunctionsCommand({ ...(Marker ? { Marker } : {}), MaxItems: 10000 }));
    functions.push(...(result.Functions || [])); Marker = result.NextMarker;
    if (!Marker) break; if (page === MAX_PAGES - 1) truncated = true;
  }
  const urls = await mapWithConcurrency(functions, 6, async fn => settle((async () => {
    beforeRequest({ source: 'lambda-function-url' });
    return { fn, config: await client.send(new GetFunctionUrlConfigCommand({ FunctionName: fn.FunctionArn || fn.FunctionName })) };
  })()));
  for (const result of urls) {
    if (!result.ok) {
      if (!notFound(result.error)) unavailable.push({ source: 'lambda-function-url', reason: result.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
      continue;
    }
    const { fn, config } = result.value; const publicAccess = config.AuthType === 'NONE'; const hostname = endpointHost(config.FunctionUrl);
    entries.push(entry(`lambda-url:${fn.FunctionArn || fn.FunctionName}`, hostname, 'lambda_url', [
      { type: 'lambda_url', id: fn.FunctionArn || fn.FunctionName, name: fn.FunctionName, url: config.FunctionUrl, authType: config.AuthType, public: publicAccess, status: 'resolved' },
      { type: 'lambda', id: fn.FunctionArn, name: fn.FunctionName, status: 'resolved' },
    ], { public: publicAccess, risk: publicAccess ? 'unauthenticated' : null }));
  }
  return { entries, unavailable, truncated };
}

async function readEc2PublicIps(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const entries = []; const unavailable = [];
  const { EC2Client, DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeAddressesCommand } = sdk('client-ec2');
  const client = new EC2Client(cfg); const instances = []; let NextToken; let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    beforeRequest({ source: 'ec2-public-instances' });
    const response = await client.send(new DescribeInstancesCommand({ ...(NextToken ? { NextToken } : {}) }));
    for (const reservation of response.Reservations || []) instances.push(...(reservation.Instances || []));
    NextToken = response.NextToken; if (!NextToken) break; if (page === MAX_PAGES - 1) truncated = true;
  }
  const groupIds = [...new Set(instances.flatMap(instance => instance.SecurityGroups || []).map(group => group.GroupId).filter(Boolean))];
  const groupMap = new Map();
  if (groupIds.length) {
    try {
      beforeRequest({ source: 'ec2-public-security-groups' });
      const result = await client.send(new DescribeSecurityGroupsCommand({ GroupIds: groupIds }));
      for (const group of result.SecurityGroups || []) groupMap.set(group.GroupId, openSensitivePorts(group));
    } catch { unavailable.push({ source: 'ec2-public-security-groups', reason: 'read_failed' }); }
  }
  for (const instance of instances.filter(item => item.PublicIpAddress)) {
    const hostname = instance.PublicDnsName || instance.PublicIpAddress;
    const openPorts = (instance.SecurityGroups || []).flatMap(group => groupMap.get(group.GroupId) || []);
    entries.push(entry(`ec2-public:${instance.InstanceId}`, hostname, 'ec2_public_ip', [
      { type: 'ec2_public_ip', id: instance.InstanceId, address: instance.PublicIpAddress, name: instance.Tags?.find(tag => tag.Key === 'Name')?.Value || instance.InstanceId, status: instance.State?.Name || 'unknown', securityGroups: (instance.SecurityGroups || []).map(group => group.GroupId), openSensitivePorts: [...new Set(openPorts)] },
    ], { publicIp: instance.PublicIpAddress, openSensitivePorts: [...new Set(openPorts)] }));
  }
  try {
    beforeRequest({ source: 'ec2-elastic-ips' });
    const addresses = await client.send(new DescribeAddressesCommand({}));
    for (const address of addresses.Addresses || []) {
      if (instances.some(instance => instance.PublicIpAddress === address.PublicIp)) continue;
      entries.push(entry(`eip:${address.AllocationId || address.PublicIp}`, address.PublicIp, 'elastic_ip', [
        { type: 'elastic_ip', id: address.AllocationId || null, address: address.PublicIp, associationId: address.AssociationId || null, instanceId: address.InstanceId || null, status: address.AssociationId ? 'associated_outside_inventory' : 'unassociated' },
      ], { publicIp: address.PublicIp }));
    }
  } catch { unavailable.push({ source: 'ec2-elastic-ips', reason: 'read_failed' }); }
  return { entries, unavailable, truncated };
}

async function readS3PublicBuckets(cfg, { sdk = defaultSdk, beforeRequest = () => {} } = {}) {
  const entries = []; const unavailable = [];
  const { S3Client, ListBucketsCommand, GetBucketWebsiteCommand, GetBucketPolicyStatusCommand, GetBucketAclCommand, GetBucketLocationCommand } = sdk('client-s3');
  const client = new S3Client({ ...cfg, region: 'us-east-1' });
  beforeRequest({ source: 's3-public-buckets' });
  const result = await client.send(new ListBucketsCommand({}));
  const buckets = await mapWithConcurrency(result.Buckets || [], 5, async bucket => settle((async () => {
    const name = bucket.Name;
    beforeRequest({ source: 's3-bucket-location' });
    const regionResult = await settle(client.send(new GetBucketLocationCommand({ Bucket: name })));
    beforeRequest({ source: 's3-bucket-website' });
    const websiteResult = await settle(client.send(new GetBucketWebsiteCommand({ Bucket: name })));
    beforeRequest({ source: 's3-bucket-policy-status' });
    const policyResult = await settle(client.send(new GetBucketPolicyStatusCommand({ Bucket: name })));
    beforeRequest({ source: 's3-bucket-acl' });
    const aclResult = await settle(client.send(new GetBucketAclCommand({ Bucket: name })));
    return { bucket, region: regionResult.ok ? (regionResult.value.LocationConstraint || 'us-east-1') : null,
      website: websiteResult.ok ? websiteResult.value : null,
      isPublic: policyResult.ok ? policyResult.value.PolicyStatus?.IsPublic === true : false,
      policyKnown: policyResult.ok,
      aclPublic: aclResult.ok && (aclResult.value.Grants || []).some(grant => /AllUsers|AuthenticatedUsers/.test(grant.Grantee?.URI || '')) };
  })()));
  for (const item of buckets) {
    if (!item.ok) { if (!notFound(item.error)) unavailable.push({ source: 's3-bucket-exposure', reason: 'read_failed' }); continue; }
    const { bucket, region, website, isPublic, aclPublic } = item.value;
    const websiteEndpoint = website?.WebsiteEndpoint || (website && region ? `${bucket.Name}.s3-website-${region}.amazonaws.com` : null);
    if (!websiteEndpoint && !isPublic && !aclPublic) continue;
    const host = websiteEndpoint || `${bucket.Name}.s3.amazonaws.com`;
    entries.push(entry(`s3-public:${bucket.Name}`, host, 's3_public_bucket', [
      { type: 's3_bucket', name: bucket.Name, region, website: Boolean(website), websiteIndex: website?.IndexDocument?.Suffix || null, websiteError: website?.ErrorDocument?.Key || null, policyPublic: isPublic, aclPublic, status: 'resolved' },
    ], { bucket: bucket.Name, website: Boolean(website), public: Boolean(isPublic || aclPublic) }));
  }
  return { entries, unavailable, truncated: false };
}

async function readAwsPublicEntrypoints(cfg, options = {}) {
  const sources = await Promise.all([
    settle(readApiGateway(cfg, options)), settle(readLambdaUrls(cfg, options)),
    settle(readEc2PublicIps(cfg, options)), settle(readS3PublicBuckets(cfg, options)),
  ]);
  const entries = []; const unavailable = []; let truncated = false;
  sources.forEach((source, index) => {
    if (source.ok) { entries.push(...source.value.entries); unavailable.push(...source.value.unavailable); truncated ||= source.value.truncated; }
    else unavailable.push({ source: ['api-gateway', 'lambda-urls', 'ec2-public-ips', 's3-public-buckets'][index], reason: source.error?.statusCode === 429 ? 'request_limit' : 'read_failed' });
  });
  return { entries, unavailable, truncated };
}

module.exports = { apiGatewayStageArn, readApiGateway, readAwsPublicEntrypoints, readEc2PublicIps, readLambdaUrls, readS3PublicBuckets };

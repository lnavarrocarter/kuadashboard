'use strict';
/**
 * routes/aws.js
 * Amazon Web Services integration endpoints.
 *
 * Base path: /api/cloud/aws
 *
 * Authentication model:
 *   All AWS requests require a `X-Profile-Id` header referencing a credential profile.
 *   Two types of profiles are supported:
 *     - Stored profile: ID referencing a profile in the credentialStore (e.g. "uuid-v4")
 *     - Local profile:  Prefix "local:" + profile name from ~/.aws/credentials (e.g. "local:default")
 *
 * Endpoints:
 *   GET  /local-profiles                    → list profile names from ~/.aws/credentials
 *   GET  /regions                           → list all available AWS regions
 *   GET  /eks                               → list EKS clusters
 *   GET  /ecs                               → list ECS clusters + services
 *   POST /ecs/:cluster/:service/start       → scale ECS service to desiredCount 1
 *   POST /ecs/:cluster/:service/stop        → scale ECS service to desiredCount 0
 *   GET  /ec2                               → list EC2 instances
 *   POST /ec2/:id/start                     → start EC2 instance
 *   POST /ec2/:id/stop                      → stop EC2 instance
 *   GET  /lambda                            → list Lambda functions
 *   POST /lambda/:name/invoke               → invoke a Lambda function (sync)
 *   GET  /apigateway                        → list REST + HTTP API Gateway APIs
 *   GET  /logs/lambda/:name                 → CloudWatch logs for a Lambda function
 *   GET  /logs/ecs/:cluster/:service        → CloudWatch logs for an ECS service
 *
 * NOTE: AWS SDK v3 packages are lazy-required. Install them with:
 *   npm install @aws-sdk/client-ec2 @aws-sdk/client-eks @aws-sdk/client-ecs \
 *               @aws-sdk/client-lambda @aws-sdk/client-api-gateway \
 *               @aws-sdk/client-apigatewayv2 @aws-sdk/client-cloudwatch-logs \
 *               @aws-sdk/credential-providers
 */

const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { getStore } = require('../lib/credentialStore');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleErr(res, err) {
  console.error('[aws]', err.message);
  const status = err.$metadata?.httpStatusCode || 500;
  res.status(status).json({ error: err.message });
}

/**
 * Parse ~/.aws/credentials and return an array of profile objects.
 * Each entry: { name, region }  (keys are NOT exposed)
 */
function readLocalAwsProfiles() {
  const credFile = path.join(os.homedir(), '.aws', 'credentials');
  const cfgFile  = path.join(os.homedir(), '.aws', 'config');
  const profiles = {};

  // Parse credentials file
  if (fs.existsSync(credFile)) {
    const lines = fs.readFileSync(credFile, 'utf8').split('\n');
    let current = null;
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(/^\[([^\]]+)\]$/);
      if (m) { current = m[1]; profiles[current] = profiles[current] || {}; continue; }
      if (!current) continue;
      const kv = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (kv) profiles[current][kv[1].toLowerCase()] = kv[2].trim();
    }
  }

  // Parse config file for region overrides (profile names prefixed with "profile ")
  if (fs.existsSync(cfgFile)) {
    const lines = fs.readFileSync(cfgFile, 'utf8').split('\n');
    let current = null;
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(/^\[(?:profile\s+)?([^\]]+)\]$/);
      if (m) { current = m[1]; profiles[current] = profiles[current] || {}; continue; }
      if (!current) continue;
      const kv = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (kv && kv[1].toLowerCase() === 'region') {
        if (!profiles[current].region) profiles[current].region = kv[2].trim();
      }
    }
  }

  return Object.entries(profiles)
    .filter(([, data]) => data.aws_access_key_id || data.aws_secret_access_key)
    .map(([name, data]) => ({ name, region: data.region || 'us-east-1' }));
}

/**
 * Build AWS credentials config from a profile identifier.
 * - "local:<name>"  → use named profile from ~/.aws/credentials via fromIni
 * - "<uuid>"        → look up stored profile in credentialStore
 */
async function resolveAwsConfig(profileId) {
  if (profileId.startsWith('local:')) {
    const profileName = profileId.slice(6);
    const { fromIni } = require('@aws-sdk/credential-providers');
    const credFile    = path.join(os.homedir(), '.aws', 'credentials');
    const profiles    = readLocalAwsProfiles();
    const prof        = profiles.find(p => p.name === profileName);
    if (!prof) throw Object.assign(new Error(`Local AWS profile not found: ${profileName}`), { $metadata: { httpStatusCode: 404 } });
    return {
      credentials: fromIni({ profile: profileName, filepath: credFile }),
      region: prof.region,
    };
  }

  // Stored profile
  const store = getStore();
  const keys  = await store.getRawKeys(profileId);
  if (!keys) throw Object.assign(new Error('Credential profile not found'), { $metadata: { httpStatusCode: 404 } });

  const accessKeyId     = keys['AWS_ACCESS_KEY_ID'];
  const secretAccessKey = keys['AWS_SECRET_ACCESS_KEY'];
  if (!accessKeyId || !secretAccessKey)
    throw Object.assign(
      new Error('Profile is missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY'),
      { $metadata: { httpStatusCode: 400 } }
    );

  return {
    credentials: { accessKeyId, secretAccessKey },
    region: keys['AWS_DEFAULT_REGION'] || 'us-east-1',
  };
}

// ─── GET /local-profiles ──────────────────────────────────────────────────────

router.get('/local-profiles', (_req, res) => {
  try {
    const profiles = readLocalAwsProfiles();
    res.json(profiles);
  } catch (err) { handleErr(res, err); }
});

/** Read X-Profile-Id header or return 400 */
function requireProfileId(req, res) {
  const id = req.headers['x-profile-id'];
  if (!id) { res.status(400).json({ error: 'X-Profile-Id header is required' }); return null; }
  return id;
}

// ─── GET /regions ─────────────────────────────────────────────────────────────

router.get('/regions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, DescribeRegionsCommand } = require('@aws-sdk/client-ec2');
    const client = new EC2Client(cfg);
    const resp   = await client.send(new DescribeRegionsCommand({ AllRegions: false }));
    res.json((resp.Regions || []).map(r => ({
      name:     r.RegionName,
      endpoint: r.Endpoint,
      status:   r.OptInStatus,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /eks ─────────────────────────────────────────────────────────────────

router.get('/eks', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EKSClient, ListClustersCommand, DescribeClusterCommand } = require('@aws-sdk/client-eks');
    const client = new EKSClient(cfg);
    const list   = await client.send(new ListClustersCommand({}));
    const details = await Promise.all(
      (list.clusters || []).map(name =>
        client.send(new DescribeClusterCommand({ name })).then(r => r.cluster)
      )
    );
    res.json(details.map(c => ({
      name:     c.name,
      status:   c.status,
      version:  c.version,
      region:   cfg.region,
      endpoint: c.endpoint,
      roleArn:  c.roleArn,
      createdAt: c.createdAt,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ecs ─────────────────────────────────────────────────────────────────

router.get('/ecs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      ECSClient,
      ListClustersCommand,
      ListServicesCommand,
      DescribeServicesCommand,
    } = require('@aws-sdk/client-ecs');
    const client   = new ECSClient(cfg);
    const clusters = await client.send(new ListClustersCommand({}));

    const result = [];
    for (const clusterArn of (clusters.clusterArns || [])) {
      const clusterName = clusterArn.split('/').pop();
      const svcList = await client.send(new ListServicesCommand({ cluster: clusterArn }));
      if (!svcList.serviceArns?.length) continue;

      const desc = await client.send(new DescribeServicesCommand({
        cluster: clusterArn,
        services: svcList.serviceArns,
        include: ['TAGS'],
      }));

      for (const svc of (desc.services || [])) {
        result.push({
          cluster:      clusterName,
          name:         svc.serviceName,
          status:       svc.status,
          desired:      svc.desiredCount,
          running:      svc.runningCount,
          pending:      svc.pendingCount,
          taskDef:      svc.taskDefinition?.split('/').pop(),
          createdAt:    svc.createdAt,
          tags:         svc.tags || [],
          logGroupName: svc.deploymentConfiguration?.maximumPercent != null
            ? null : null, // fetched via config
        });
      }
    }
    res.json(result);
  } catch (err) { handleErr(res, err); }
});

// ─── POST /ecs/:cluster/:service/start ────────────────────────────────────────

router.post('/ecs/:cluster/:service/start', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { ECSClient, UpdateServiceCommand } = require('@aws-sdk/client-ecs');
    const client = new ECSClient(cfg);
    await client.send(new UpdateServiceCommand({
      cluster:      req.params.cluster,
      service:      req.params.service,
      desiredCount: 1,
    }));
    res.json({ success: true, cluster: req.params.cluster, service: req.params.service, desiredCount: 1 });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /ecs/:cluster/:service/stop ─────────────────────────────────────────

router.post('/ecs/:cluster/:service/stop', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { ECSClient, UpdateServiceCommand } = require('@aws-sdk/client-ecs');
    const client = new ECSClient(cfg);
    await client.send(new UpdateServiceCommand({
      cluster:      req.params.cluster,
      service:      req.params.service,
      desiredCount: 0,
    }));
    res.json({ success: true, cluster: req.params.cluster, service: req.params.service, desiredCount: 0 });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ec2 ─────────────────────────────────────────────────────────────────

router.get('/ec2', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
    const client = new EC2Client(cfg);
    const resp   = await client.send(new DescribeInstancesCommand({}));
    const instances = [];
    for (const reservation of (resp.Reservations || [])) {
      for (const i of (reservation.Instances || [])) {
        const nameTag = i.Tags?.find(t => t.Key === 'Name')?.Value || i.InstanceId;
        instances.push({
          id:           i.InstanceId,
          name:         nameTag,
          type:         i.InstanceType,
          state:        i.State?.Name,
          publicIp:     i.PublicIpAddress || null,
          privateIp:    i.PrivateIpAddress || null,
          az:           i.Placement?.AvailabilityZone,
          launchTime:   i.LaunchTime,
          tags:         i.Tags || [],
        });
      }
    }
    res.json(instances);
  } catch (err) { handleErr(res, err); }
});

// ─── POST /ec2/:id/start ──────────────────────────────────────────────────────

router.post('/ec2/:id/start', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, StartInstancesCommand } = require('@aws-sdk/client-ec2');
    const client = new EC2Client(cfg);
    await client.send(new StartInstancesCommand({ InstanceIds: [req.params.id] }));
    res.json({ success: true, instanceId: req.params.id, action: 'start' });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /ec2/:id/stop ───────────────────────────────────────────────────────

router.post('/ec2/:id/stop', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, StopInstancesCommand } = require('@aws-sdk/client-ec2');
    const client = new EC2Client(cfg);
    await client.send(new StopInstancesCommand({ InstanceIds: [req.params.id] }));
    res.json({ success: true, instanceId: req.params.id, action: 'stop' });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lambda ──────────────────────────────────────────────────────────────

router.get('/lambda', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LambdaClient, ListFunctionsCommand } = require('@aws-sdk/client-lambda');
    const client = new LambdaClient(cfg);
    const all = [];
    let marker;
    do {
      const resp = await client.send(new ListFunctionsCommand({ MaxItems: 50, Marker: marker }));
      all.push(...(resp.Functions || []));
      marker = resp.NextMarker;
    } while (marker);
    res.json(all.map(f => ({
      name:         f.FunctionName,
      runtime:      f.Runtime,
      handler:      f.Handler,
      memory:       f.MemorySize,
      timeout:      f.Timeout,
      lastModified: f.LastModified,
      description:  f.Description,
      state:        f.State,
      arn:          f.FunctionArn,
      logGroup:     `/aws/lambda/${f.FunctionName}`,
      tags:         [],
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── POST /lambda/:name/invoke ────────────────────────────────────────────────

router.post('/lambda/:name/invoke', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
    const client  = new LambdaClient(cfg);
    const payload = req.body != null ? req.body : {};
    const resp    = await client.send(new InvokeCommand({
      FunctionName:   req.params.name,
      InvocationType: 'RequestResponse',
      Payload:        Buffer.from(JSON.stringify(payload)),
    }));
    const result = resp.Payload ? JSON.parse(Buffer.from(resp.Payload).toString()) : null;
    res.json({
      statusCode:    resp.StatusCode,
      functionError: resp.FunctionError || null,
      payload:       result,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /apigateway ──────────────────────────────────────────────────────────
// Lists REST APIs (API Gateway v1) and HTTP/WebSocket APIs (API Gateway v2).

router.get('/apigateway', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { APIGatewayClient, GetRestApisCommand }      = require('@aws-sdk/client-api-gateway');
    const { ApiGatewayV2Client, GetApisCommand }        = require('@aws-sdk/client-apigatewayv2');

    const [restResult, httpResult] = await Promise.allSettled([
      new APIGatewayClient(cfg).send(new GetRestApisCommand({ limit: 50 })),
      new ApiGatewayV2Client(cfg).send(new GetApisCommand({})),
    ]);

    const result = [];
    if (restResult.status === 'fulfilled') {
      for (const api of (restResult.value.items || [])) {
        result.push({
          id:          api.id,
          name:        api.name,
          type:        'REST',
          endpoint:    `https://${api.id}.execute-api.${cfg.region}.amazonaws.com`,
          createdDate: api.createdDate,
          description: api.description || '',
        });
      }
    }
    if (httpResult.status === 'fulfilled') {
      for (const api of (httpResult.value.Items || [])) {
        result.push({
          id:          api.ApiId,
          name:        api.Name,
          type:        api.ProtocolType || 'HTTP',
          endpoint:    api.ApiEndpoint,
          createdDate: api.CreatedDate,
          description: api.Description || '',
        });
      }
    }
    res.json(result);
  } catch (err) { handleErr(res, err); }
});

// ─── GET /logs/lambda/:name ───────────────────────────────────────────────────

router.get('/logs/lambda/:name', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const client       = new CloudWatchLogsClient(cfg);
    const logGroupName = `/aws/lambda/${req.params.name}`;
    const limit        = Math.min(parseInt(req.query.limit) || 200, 500);
    const minutes      = Math.min(parseInt(req.query.minutes) || 60, 1440);
    const startTime    = Date.now() - minutes * 60 * 1000;

    const resp = await client.send(new FilterLogEventsCommand({ logGroupName, limit, startTime }));
    res.json({
      logGroupName,
      events: (resp.events || []).map(e => ({
        timestamp:     e.timestamp,
        message:       e.message,
        logStreamName: e.logStreamName,
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /logs/ecs/:cluster/:service ─────────────────────────────────────────

router.get('/logs/ecs/:cluster/:service', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      CloudWatchLogsClient,
      DescribeLogGroupsCommand,
      FilterLogEventsCommand,
    } = require('@aws-sdk/client-cloudwatch-logs');
    const client  = new CloudWatchLogsClient(cfg);
    const cluster = req.params.cluster;
    const service = req.params.service;
    const limit   = Math.min(parseInt(req.query.limit) || 200, 500);
    const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
    const startTime = Date.now() - minutes * 60 * 1000;

    // Try common ECS log group naming conventions
    const candidates = [
      `/ecs/${service}`,
      `/ecs/${cluster}/${service}`,
      `/aws/ecs/${service}`,
      `/aws/ecs/containerinsights/${cluster}/performance`,
    ];

    let logGroupName = null;
    for (const prefix of candidates) {
      try {
        const desc = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit: 1 }));
        if (desc.logGroups?.length) { logGroupName = desc.logGroups[0].logGroupName; break; }
      } catch { /* try next */ }
    }

    if (!logGroupName) {
      return res.json({ logGroupName: null, events: [], message: 'No matching CloudWatch log group found.' });
    }

    const resp = await client.send(new FilterLogEventsCommand({ logGroupName, limit, startTime }));
    res.json({
      logGroupName,
      events: (resp.events || []).map(e => ({
        timestamp:     e.timestamp,
        message:       e.message,
        logStreamName: e.logStreamName,
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /s3 ──────────────────────────────────────────────────────────────────

router.get('/s3', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { S3Client, ListBucketsCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({ ...cfg, region: 'us-east-1' });
    const resp   = await client.send(new ListBucketsCommand({}));
    const buckets = await Promise.all((resp.Buckets || []).map(async b => {
      let region = 'us-east-1';
      try {
        const loc = await client.send(new GetBucketLocationCommand({ Bucket: b.Name }));
        region = loc.LocationConstraint || 'us-east-1';
      } catch { /* ignore per-bucket errors */ }
      return { name: b.Name, creationDate: b.CreationDate, region };
    }));
    res.json(buckets);
  } catch (err) { handleErr(res, err); }
});

// ─── GET /s3/:bucket/config ───────────────────────────────────────────────────

router.get('/s3/:bucket/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      S3Client, GetBucketVersioningCommand, GetBucketTaggingCommand,
      GetBucketEncryptionCommand, GetBucketAclCommand, GetBucketPolicyStatusCommand,
      GetBucketLocationCommand,
    } = require('@aws-sdk/client-s3');
    const client = new S3Client(cfg);
    const bucket = req.params.bucket;
    const [versioning, tags, encryption, acl, policyStatus, location] = await Promise.allSettled([
      client.send(new GetBucketVersioningCommand({ Bucket: bucket })),
      client.send(new GetBucketTaggingCommand({ Bucket: bucket })),
      client.send(new GetBucketEncryptionCommand({ Bucket: bucket })),
      client.send(new GetBucketAclCommand({ Bucket: bucket })),
      client.send(new GetBucketPolicyStatusCommand({ Bucket: bucket })),
      client.send(new GetBucketLocationCommand({ Bucket: bucket })),
    ]);
    res.json({
      bucket,
      region:      location.status   === 'fulfilled' ? (location.value.LocationConstraint || 'us-east-1') : null,
      versioning:  versioning.status === 'fulfilled' ? (versioning.value.Status || 'Disabled') : null,
      tags:        tags.status       === 'fulfilled' ? (tags.value.TagSet || []) : [],
      encryption:  encryption.status === 'fulfilled' ? encryption.value.ServerSideEncryptionConfiguration : null,
      acl:         acl.status        === 'fulfilled' ? (acl.value.Grants || []) : [],
      isPublic:    policyStatus.status === 'fulfilled' ? (policyStatus.value.PolicyStatus?.IsPublic ?? null) : null,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ecr ─────────────────────────────────────────────────────────────────

router.get('/ecr', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { ECRClient, DescribeRepositoriesCommand } = require('@aws-sdk/client-ecr');
    const client = new ECRClient(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new DescribeRepositoriesCommand({ nextToken }));
      all.push(...(resp.repositories || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json(all.map(r => ({
      name:               r.repositoryName,
      uri:                r.repositoryUri,
      arn:                r.repositoryArn,
      createdAt:          r.createdAt,
      imageTagMutability: r.imageTagMutability,
      scanOnPush:         r.imageScanningConfiguration?.scanOnPush ?? false,
      tags:               [],
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ecr/config ──────────────────────────────────────────────────────────

router.get('/ecr/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo query param required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { ECRClient, DescribeRepositoriesCommand, ListImagesCommand, GetLifecyclePolicyCommand } = require('@aws-sdk/client-ecr');
    const client = new ECRClient(cfg);
    const [detail, images, lifecycle] = await Promise.allSettled([
      client.send(new DescribeRepositoriesCommand({ repositoryNames: [repo] })),
      client.send(new ListImagesCommand({ repositoryName: repo, maxResults: 20 })),
      client.send(new GetLifecyclePolicyCommand({ repositoryName: repo })),
    ]);
    res.json({
      repository: detail.status    === 'fulfilled' ? (detail.value.repositories?.[0] ?? null) : null,
      images:     images.status    === 'fulfilled' ? (images.value.imageIds ?? []) : [],
      lifecycle:  lifecycle.status === 'fulfilled' ? lifecycle.value.lifecyclePolicyText : null,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /vpc ─────────────────────────────────────────────────────────────────

router.get('/vpc', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand } = require('@aws-sdk/client-ec2');
    const client = new EC2Client(cfg);
    const [vpcsResp, subnetsResp] = await Promise.all([
      client.send(new DescribeVpcsCommand({})),
      client.send(new DescribeSubnetsCommand({})),
    ]);
    const subnetsByVpc = {};
    for (const s of (subnetsResp.Subnets || [])) {
      (subnetsByVpc[s.VpcId] = subnetsByVpc[s.VpcId] || []).push({
        id: s.SubnetId, cidr: s.CidrBlock, az: s.AvailabilityZone,
        state: s.State, public: s.MapPublicIpOnLaunch,
      });
    }
    res.json((vpcsResp.Vpcs || []).map(v => ({
      id:      v.VpcId,
      name:    v.Tags?.find(t => t.Key === 'Name')?.Value || v.VpcId,
      cidr:    v.CidrBlock,
      state:   v.State,
      default: v.IsDefault,
      tenancy: v.InstanceTenancy,
      subnets: subnetsByVpc[v.VpcId] || [],
      tags:    v.Tags || [],
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /vpc/:id/config ──────────────────────────────────────────────────────

router.get('/vpc/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand,
      DescribeInternetGatewaysCommand, DescribeRouteTablesCommand,
      DescribeSecurityGroupsCommand, DescribeNatGatewaysCommand,
    } = require('@aws-sdk/client-ec2');
    const client  = new EC2Client(cfg);
    const vpcId   = req.params.id;
    const filters = [{ Name: 'vpc-id', Values: [vpcId] }];
    const [vpc, subnets, igws, rts, sgs, nats] = await Promise.allSettled([
      client.send(new DescribeVpcsCommand({ VpcIds: [vpcId] })),
      client.send(new DescribeSubnetsCommand({ Filters: filters })),
      client.send(new DescribeInternetGatewaysCommand({ Filters: [{ Name: 'attachment.vpc-id', Values: [vpcId] }] })),
      client.send(new DescribeRouteTablesCommand({ Filters: filters })),
      client.send(new DescribeSecurityGroupsCommand({ Filters: filters })),
      client.send(new DescribeNatGatewaysCommand({ Filter: filters })),
    ]);
    res.json({
      vpc:              vpc.status     === 'fulfilled' ? (vpc.value.Vpcs?.[0] ?? null) : null,
      subnets:          subnets.status === 'fulfilled' ? (subnets.value.Subnets ?? []) : [],
      internetGateways: igws.status    === 'fulfilled' ? (igws.value.InternetGateways ?? []) : [],
      routeTables:      rts.status     === 'fulfilled' ? (rts.value.RouteTables ?? []) : [],
      securityGroups:   sgs.status     === 'fulfilled' ? (sgs.value.SecurityGroups ?? []) : [],
      natGateways:      nats.status    === 'fulfilled' ? (nats.value.NatGateways ?? []) : [],
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /eventbridge ─────────────────────────────────────────────────────────

router.get('/eventbridge', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EventBridgeClient, ListEventBusesCommand, ListRulesCommand } = require('@aws-sdk/client-eventbridge');
    const client = new EventBridgeClient(cfg);
    const busesResp = await client.send(new ListEventBusesCommand({ Limit: 50 }));
    const result = [];
    for (const bus of (busesResp.EventBuses || [])) {
      try {
        const rulesResp = await client.send(new ListRulesCommand({ EventBusName: bus.Name, Limit: 50 }));
        for (const rule of (rulesResp.Rules || [])) {
          result.push({
            busName:      bus.Name,
            name:         rule.Name,
            state:        rule.State,
            description:  rule.Description || '',
            scheduleExpr: rule.ScheduleExpression || null,
            eventPattern: rule.EventPattern ? (() => { try { return JSON.parse(rule.EventPattern); } catch { return rule.EventPattern; } })() : null,
            arn:          rule.Arn,
          });
        }
      } catch { /* ignore per-bus errors */ }
    }
    res.json(result);
  } catch (err) { handleErr(res, err); }
});

// ─── GET /eventbridge/config ──────────────────────────────────────────────────

router.get('/eventbridge/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { bus, rule } = req.query;
  if (!bus || !rule) return res.status(400).json({ error: 'bus and rule query params required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EventBridgeClient, DescribeRuleCommand, ListTargetsByRuleCommand } = require('@aws-sdk/client-eventbridge');
    const client = new EventBridgeClient(cfg);
    const [desc, targets] = await Promise.all([
      client.send(new DescribeRuleCommand({ EventBusName: bus, Name: rule })),
      client.send(new ListTargetsByRuleCommand({ EventBusName: bus, Rule: rule })),
    ]);
    res.json({ rule: desc, targets: targets.Targets || [] });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /logs/eventbridge ────────────────────────────────────────────────────
// Returns CloudWatch metrics (MatchedEvents, TriggeredRules, FailedInvocations,
// ThrottledRules) + log events if a CloudWatch Logs target is configured.

router.get('/logs/eventbridge', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { bus, rule } = req.query;
  if (!bus || !rule) return res.status(400).json({ error: 'bus and rule query params required' });
  try {
    const cfg     = await resolveAwsConfig(profileId);
    const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440 * 7);
    const now     = new Date();
    const startTime = new Date(Date.now() - minutes * 60 * 1000);

    const {
      CloudWatchClient,
      GetMetricStatisticsCommand,
    } = require('@aws-sdk/client-cloudwatch');
    const {
      CloudWatchLogsClient,
      FilterLogEventsCommand,
      DescribeLogGroupsCommand,
    } = require('@aws-sdk/client-cloudwatch-logs');
    const {
      EventBridgeClient,
      ListTargetsByRuleCommand,
    } = require('@aws-sdk/client-eventbridge');

    const cwClient  = new CloudWatchClient(cfg);
    const cwlClient = new CloudWatchLogsClient(cfg);
    const ebClient  = new EventBridgeClient(cfg);

    // 1. Fetch CW metrics for this rule
    const metricNames = ['MatchedEvents', 'TriggeredRules', 'FailedInvocations', 'ThrottledRules'];
    const period = minutes <= 60 ? 60 : minutes <= 360 ? 300 : minutes <= 1440 ? 900 : 3600;
    const dimensions = [
      { Name: 'RuleName', Value: rule },
      { Name: 'EventBusName', Value: bus },
    ];

    const metricResults = await Promise.allSettled(
      metricNames.map(MetricName =>
        cwClient.send(new GetMetricStatisticsCommand({
          Namespace:  'AWS/Events',
          MetricName,
          Dimensions: dimensions,
          StartTime:  startTime,
          EndTime:    now,
          Period:     period,
          Statistics: ['Sum'],
        }))
      )
    );

    const metrics = {};
    metricNames.forEach((name, i) => {
      const r = metricResults[i];
      if (r.status === 'fulfilled') {
        const pts = (r.value.Datapoints || []).sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
        metrics[name] = pts.map(p => ({ t: p.Timestamp, v: p.Sum ?? 0 }));
      } else {
        metrics[name] = [];
      }
    });

    // Compute totals
    const totals = {};
    for (const [k, pts] of Object.entries(metrics)) {
      totals[k] = pts.reduce((s, p) => s + p.v, 0);
    }

    // 2. Find CW Logs targets for this rule
    let logGroupName = null;
    let logEvents    = [];
    try {
      const targetsResp = await ebClient.send(new ListTargetsByRuleCommand({ EventBusName: bus, Rule: rule }));
      const targets     = targetsResp.Targets || [];
      // A CloudWatch Logs target ARN looks like: arn:aws:logs:<region>:<acct>:log-group:<name>
      const cwLogsTarget = targets.find(t => t.Arn && t.Arn.includes(':logs:'));
      if (cwLogsTarget) {
        // Extract log group name from ARN: arn:aws:logs:r:a:log-group:/group/name
        const arnParts = cwLogsTarget.Arn.split(':log-group:');
        logGroupName   = arnParts[1] || null;
      }
    } catch { /* ignore */ }

    // 3. If no direct CW Logs target, try to discover a bus-level log group
    if (!logGroupName) {
      const busSlug = bus === 'default' ? 'default' : bus.replace(/[^a-zA-Z0-9_/-]/g, '-');
      const candidates = [
        `/aws/events/${busSlug}`,
        `/aws/events/`,
        `/eventbridge/${busSlug}`,
      ];
      for (const prefix of candidates) {
        try {
          const desc = await cwlClient.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit: 1 }));
          if (desc.logGroups?.length) { logGroupName = desc.logGroups[0].logGroupName; break; }
        } catch { /* try next */ }
      }
    }

    // 4. Fetch log events if we found a log group
    if (logGroupName) {
      try {
        const filterPattern = rule.length <= 200 ? `"${rule}"` : '';
        const logsResp = await cwlClient.send(new FilterLogEventsCommand({
          logGroupName,
          startTime: startTime.getTime(),
          limit:     200,
          filterPattern: filterPattern || undefined,
        }));
        logEvents = (logsResp.events || []).map(e => ({
          timestamp:     e.timestamp,
          message:       e.message,
          logStreamName: e.logStreamName,
        }));
      } catch { logEvents = []; }
    }

    res.json({ metrics, totals, logGroupName, logEvents, period });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /stepfunctions ───────────────────────────────────────────────────────

router.get('/stepfunctions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SFNClient, ListStateMachinesCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListStateMachinesCommand({ maxResults: 100, nextToken }));
      all.push(...(resp.stateMachines || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json(all.map(sm => ({
      name:         sm.name,
      arn:          sm.stateMachineArn,
      type:         sm.type,
      creationDate: sm.creationDate,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /stepfunctions/config ────────────────────────────────────────────────

router.get('/stepfunctions/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn } = req.query;
  if (!arn) return res.status(400).json({ error: 'arn query param required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SFNClient, DescribeStateMachineCommand, ListExecutionsCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const [detail, executions] = await Promise.allSettled([
      client.send(new DescribeStateMachineCommand({ stateMachineArn: arn })),
      client.send(new ListExecutionsCommand({ stateMachineArn: arn, maxResults: 10 })),
    ]);
    res.json({
      stateMachine:     detail.status     === 'fulfilled' ? detail.value : null,
      recentExecutions: executions.status === 'fulfilled' ? (executions.value.executions ?? []) : [],
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ec2/:id/config ──────────────────────────────────────────────────────

router.get('/ec2/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
    const client = new EC2Client(cfg);
    const resp   = await client.send(new DescribeInstancesCommand({ InstanceIds: [req.params.id] }));
    res.json(resp.Reservations?.[0]?.Instances?.[0] ?? null);
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ecs/:cluster/:service/config ────────────────────────────────────────

router.get('/ecs/:cluster/:service/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand } = require('@aws-sdk/client-ecs');
    const client  = new ECSClient(cfg);
    const svcResp = await client.send(new DescribeServicesCommand({
      cluster: req.params.cluster, services: [req.params.service],
    }));
    const svc = svcResp.services?.[0] ?? null;
    let taskDef = null;
    if (svc?.taskDefinition) {
      try {
        const td = await client.send(new DescribeTaskDefinitionCommand({ taskDefinition: svc.taskDefinition }));
        taskDef = td.taskDefinition ?? null;
      } catch { /* ignore */ }
    }
    res.json({ service: svc, taskDefinition: taskDef });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /eks/:name/config ────────────────────────────────────────────────────

router.get('/eks/:name/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EKSClient, DescribeClusterCommand, ListNodegroupsCommand } = require('@aws-sdk/client-eks');
    const client = new EKSClient(cfg);
    const [cluster, nodegroups] = await Promise.allSettled([
      client.send(new DescribeClusterCommand({ name: req.params.name })),
      client.send(new ListNodegroupsCommand({ clusterName: req.params.name })),
    ]);
    res.json({
      cluster:    cluster.status    === 'fulfilled' ? (cluster.value.cluster ?? null) : null,
      nodegroups: nodegroups.status === 'fulfilled' ? (nodegroups.value.nodegroups ?? []) : [],
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lambda/:name/config ─────────────────────────────────────────────────

router.get('/lambda/:name/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LambdaClient, GetFunctionConfigurationCommand, ListAliasesCommand } = require('@aws-sdk/client-lambda');
    const client = new LambdaClient(cfg);
    const [fn, aliases] = await Promise.allSettled([
      client.send(new GetFunctionConfigurationCommand({ FunctionName: req.params.name })),
      client.send(new ListAliasesCommand({ FunctionName: req.params.name })),
    ]);
    res.json({
      configuration: fn.status      === 'fulfilled' ? fn.value : null,
      aliases:       aliases.status === 'fulfilled' ? (aliases.value.Aliases ?? []) : [],
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /apigateway/:id/config ───────────────────────────────────────────────

router.get('/apigateway/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const apiType = req.query.type || 'REST';
  try {
    const cfg = await resolveAwsConfig(profileId);
    if (apiType === 'REST') {
      const { APIGatewayClient, GetRestApiCommand, GetStagesCommand, GetResourcesCommand } = require('@aws-sdk/client-api-gateway');
      const client = new APIGatewayClient(cfg);
      const [api, stages, resources] = await Promise.allSettled([
        client.send(new GetRestApiCommand({ restApiId: req.params.id })),
        client.send(new GetStagesCommand({ restApiId: req.params.id })),
        client.send(new GetResourcesCommand({ restApiId: req.params.id })),
      ]);
      res.json({
        api:       api.status       === 'fulfilled' ? api.value : null,
        stages:    stages.status    === 'fulfilled' ? (stages.value.item ?? []) : [],
        resources: resources.status === 'fulfilled' ? (resources.value.items ?? []) : [],
      });
    } else {
      const { ApiGatewayV2Client, GetApiCommand, GetStagesCommand } = require('@aws-sdk/client-apigatewayv2');
      const client = new ApiGatewayV2Client(cfg);
      const [api, stages] = await Promise.allSettled([
        client.send(new GetApiCommand({ ApiId: req.params.id })),
        client.send(new GetStagesCommand({ ApiId: req.params.id })),
      ]);
      res.json({
        api:    api.status    === 'fulfilled' ? api.value : null,
        stages: stages.status === 'fulfilled' ? (stages.value.Items ?? []) : [],
      });
    }
  } catch (err) { handleErr(res, err); }
});

// ─── PUT /tags ────────────────────────────────────────────────────────────────
// Generic tag editor. Body: { arn, service, tags: [{Key,Value}], removedKeys: [] }

router.put('/tags', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn, service, tags = [], removedKeys = [] } = req.body || {};
  if (!arn) return res.status(400).json({ error: 'arn is required' });
  try {
    const cfg = await resolveAwsConfig(profileId);

    if (service === 'ec2') {
      const { EC2Client, CreateTagsCommand, DeleteTagsCommand } = require('@aws-sdk/client-ec2');
      const client = new EC2Client(cfg);
      const resourceId = arn; // EC2 uses instance IDs not ARNs for tagging
      if (tags.length)
        await client.send(new CreateTagsCommand({ Resources: [resourceId], Tags: tags }));
      if (removedKeys.length)
        await client.send(new DeleteTagsCommand({ Resources: [resourceId], Tags: removedKeys.map(k => ({ Key: k })) }));
    } else if (service === 'lambda') {
      const { LambdaClient, TagResourceCommand, UntagResourceCommand } = require('@aws-sdk/client-lambda');
      const client = new LambdaClient(cfg);
      if (tags.length)
        await client.send(new TagResourceCommand({ Resource: arn, Tags: Object.fromEntries(tags.map(t => [t.Key, t.Value])) }));
      if (removedKeys.length)
        await client.send(new UntagResourceCommand({ Resource: arn, TagKeys: removedKeys }));
    } else if (service === 'ecs') {
      const { ECSClient, TagResourceCommand, UntagResourceCommand } = require('@aws-sdk/client-ecs');
      const client = new ECSClient(cfg);
      if (tags.length)
        await client.send(new TagResourceCommand({ resourceArn: arn, tags: tags.map(t => ({ key: t.Key, value: t.Value })) }));
      if (removedKeys.length)
        await client.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: removedKeys }));
    } else if (service === 'eks') {
      const { EKSClient, TagResourceCommand, UntagResourceCommand } = require('@aws-sdk/client-eks');
      const client = new EKSClient(cfg);
      if (tags.length)
        await client.send(new TagResourceCommand({ resourceArn: arn, tags: Object.fromEntries(tags.map(t => [t.Key, t.Value])) }));
      if (removedKeys.length)
        await client.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: removedKeys }));
    } else if (service === 'ecr') {
      const { ECRClient, TagResourceCommand, UntagResourceCommand } = require('@aws-sdk/client-ecr');
      const client = new ECRClient(cfg);
      if (tags.length)
        await client.send(new TagResourceCommand({ resourceArn: arn, tags: tags.map(t => ({ Key: t.Key, Value: t.Value })) }));
      if (removedKeys.length)
        await client.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: removedKeys }));
    } else if (service === 's3') {
      const { S3Client, PutBucketTaggingCommand, GetBucketTaggingCommand, DeleteBucketTaggingCommand } = require('@aws-sdk/client-s3');
      const client = new S3Client(cfg);
      const bucket = arn; // S3 uses bucket name
      let existingTags = [];
      try {
        const resp = await client.send(new GetBucketTaggingCommand({ Bucket: bucket }));
        existingTags = resp.TagSet || [];
      } catch { /* no tags yet */ }
      const filtered = existingTags.filter(t => !removedKeys.includes(t.Key));
      const merged   = [...filtered.filter(t => !tags.find(n => n.Key === t.Key)), ...tags];
      if (merged.length)
        await client.send(new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet: merged } }));
      else
        await client.send(new DeleteBucketTaggingCommand({ Bucket: bucket }));
    } else if (service === 'vpc') {
      const { EC2Client, CreateTagsCommand, DeleteTagsCommand } = require('@aws-sdk/client-ec2');
      const client = new EC2Client(cfg);
      if (tags.length)
        await client.send(new CreateTagsCommand({ Resources: [arn], Tags: tags }));
      if (removedKeys.length)
        await client.send(new DeleteTagsCommand({ Resources: [arn], Tags: removedKeys.map(k => ({ Key: k })) }));
    } else if (service === 'eventbridge') {
      const { EventBridgeClient, TagResourceCommand, UntagResourceCommand } = require('@aws-sdk/client-eventbridge');
      const client = new EventBridgeClient(cfg);
      if (tags.length)
        await client.send(new TagResourceCommand({ ResourceARN: arn, Tags: tags.map(t => ({ Key: t.Key, Value: t.Value })) }));
      if (removedKeys.length)
        await client.send(new UntagResourceCommand({ ResourceARN: arn, TagKeys: removedKeys }));
    } else if (service === 'stepfn') {
      const { SFNClient, TagResourceCommand, UntagResourceCommand } = require('@aws-sdk/client-sfn');
      const client = new SFNClient(cfg);
      if (tags.length)
        await client.send(new TagResourceCommand({ resourceArn: arn, tags: tags.map(t => ({ key: t.Key, value: t.Value })) }));
      if (removedKeys.length)
        await client.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: removedKeys }));
    } else {
      return res.status(400).json({ error: `Tagging not supported for service: ${service}` });
    }

    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /tags ────────────────────────────────────────────────────────────────
// Fetch current tags for a resource. Query: service, arn

router.get('/tags', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn, service } = req.query;
  if (!arn || !service) return res.status(400).json({ error: 'arn and service query params required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    let tags = [];

    if (service === 'ec2' || service === 'vpc') {
      const { EC2Client, DescribeTagsCommand } = require('@aws-sdk/client-ec2');
      const client = new EC2Client(cfg);
      const resp = await client.send(new DescribeTagsCommand({ Filters: [{ Name: 'resource-id', Values: [arn] }] }));
      tags = (resp.Tags || []).map(t => ({ Key: t.Key, Value: t.Value }));
    } else if (service === 'lambda') {
      const { LambdaClient, ListTagsCommand } = require('@aws-sdk/client-lambda');
      const client = new LambdaClient(cfg);
      const resp = await client.send(new ListTagsCommand({ Resource: arn }));
      tags = Object.entries(resp.Tags || {}).map(([Key, Value]) => ({ Key, Value }));
    } else if (service === 'ecs') {
      const { ECSClient, ListTagsForResourceCommand } = require('@aws-sdk/client-ecs');
      const client = new ECSClient(cfg);
      const resp = await client.send(new ListTagsForResourceCommand({ resourceArn: arn }));
      tags = (resp.tags || []).map(t => ({ Key: t.key, Value: t.value }));
    } else if (service === 'eks') {
      const { EKSClient, ListTagsForResourceCommand } = require('@aws-sdk/client-eks');
      const client = new EKSClient(cfg);
      const resp = await client.send(new ListTagsForResourceCommand({ resourceArn: arn }));
      tags = Object.entries(resp.tags || {}).map(([Key, Value]) => ({ Key, Value }));
    } else if (service === 'ecr') {
      const { ECRClient, ListTagsForResourceCommand } = require('@aws-sdk/client-ecr');
      const client = new ECRClient(cfg);
      const resp = await client.send(new ListTagsForResourceCommand({ resourceArn: arn }));
      tags = (resp.tags || []).map(t => ({ Key: t.Key, Value: t.Value }));
    } else if (service === 's3') {
      const { S3Client, GetBucketTaggingCommand } = require('@aws-sdk/client-s3');
      const client = new S3Client(cfg);
      try {
        const resp = await client.send(new GetBucketTaggingCommand({ Bucket: arn }));
        tags = resp.TagSet || [];
      } catch { tags = []; }
    } else if (service === 'eventbridge') {
      const { EventBridgeClient, ListTagsForResourceCommand } = require('@aws-sdk/client-eventbridge');
      const client = new EventBridgeClient(cfg);
      const resp = await client.send(new ListTagsForResourceCommand({ ResourceARN: arn }));
      tags = (resp.Tags || []).map(t => ({ Key: t.Key, Value: t.Value }));
    } else if (service === 'stepfn') {
      const { SFNClient, ListTagsForResourceCommand } = require('@aws-sdk/client-sfn');
      const client = new SFNClient(cfg);
      const resp = await client.send(new ListTagsForResourceCommand({ resourceArn: arn }));
      tags = (resp.tags || []).map(t => ({ Key: t.key, Value: t.value }));
    }

    res.json({ tags });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /lambda/:name/logging ───────────────────────────────────────────────
// Enable or update CloudWatch logging for a Lambda function.
// Body: { logFormat?: 'Text'|'JSON', retentionDays?: number }

router.post('/lambda/:name/logging', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LambdaClient, UpdateFunctionConfigurationCommand, GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
    const { CloudWatchLogsClient, CreateLogGroupCommand, PutRetentionPolicyCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const name       = req.params.name;
    const logFormat  = req.body?.logFormat || 'Text';
    const retention  = parseInt(req.body?.retentionDays) || 30;
    const logGroup   = `/aws/lambda/${name}`;

    const lambdaClient = new LambdaClient(cfg);
    const logsClient   = new CloudWatchLogsClient(cfg);

    // Get current function config to preserve role
    const fnConfig = await lambdaClient.send(new GetFunctionConfigurationCommand({ FunctionName: name }));

    // Ensure log group exists
    try { await logsClient.send(new CreateLogGroupCommand({ logGroupName: logGroup })); } catch { /* already exists */ }
    // Set retention
    await logsClient.send(new PutRetentionPolicyCommand({ logGroupName: logGroup, retentionInDays: retention }));

    // Update function logging config
    await lambdaClient.send(new UpdateFunctionConfigurationCommand({
      FunctionName:  name,
      LoggingConfig: { LogFormat: logFormat, LogGroup: logGroup },
    }));

    res.json({ success: true, logGroup, logFormat, retentionDays: retention });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /ecs/:cluster/:service/logging ──────────────────────────────────────
// Enable CloudWatch logging on the ECS task definition (creates/updates log group).
// This registers a new task definition revision with awslogs driver.
// Body: { retentionDays?: number, logPrefix?: string }

router.post('/ecs/:cluster/:service/logging', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand,
      RegisterTaskDefinitionCommand, UpdateServiceCommand,
    } = require('@aws-sdk/client-ecs');
    const { CloudWatchLogsClient, CreateLogGroupCommand, PutRetentionPolicyCommand } = require('@aws-sdk/client-cloudwatch-logs');

    const cluster   = req.params.cluster;
    const service   = req.params.service;
    const retention = parseInt(req.body?.retentionDays) || 30;
    const logPrefix = req.body?.logPrefix || service;

    const ecsClient  = new ECSClient(cfg);
    const logsClient = new CloudWatchLogsClient(cfg);

    const svcResp = await ecsClient.send(new DescribeServicesCommand({ cluster, services: [service] }));
    const svc = svcResp.services?.[0];
    if (!svc) return res.status(404).json({ error: 'ECS service not found' });

    const tdResp = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: svc.taskDefinition }));
    const td = tdResp.taskDefinition;

    const logGroup = `/ecs/${cluster}/${logPrefix}`;
    try { await logsClient.send(new CreateLogGroupCommand({ logGroupName: logGroup })); } catch { /* already exists */ }
    await logsClient.send(new PutRetentionPolicyCommand({ logGroupName: logGroup, retentionInDays: retention }));

    // Update each container definition to use awslogs
    const containers = (td.containerDefinitions || []).map(c => ({
      ...c,
      logConfiguration: {
        logDriver: 'awslogs',
        options: {
          'awslogs-group':  logGroup,
          'awslogs-region': cfg.region,
          'awslogs-stream-prefix': c.name,
        },
      },
    }));

    // Register new task definition revision
    const { family, taskRoleArn, executionRoleArn, networkMode, volumes,
            placementConstraints, requiresCompatibilities, cpu, memory,
            inferenceAccelerators, ipcMode, pidMode, ephemeralStorage } = td;
    const newTd = await ecsClient.send(new RegisterTaskDefinitionCommand({
      family, taskRoleArn, executionRoleArn, networkMode, volumes,
      placementConstraints, requiresCompatibilities, cpu, memory,
      inferenceAccelerators, ipcMode, pidMode, ephemeralStorage,
      containerDefinitions: containers,
    }));

    const newTdArn = newTd.taskDefinition?.taskDefinitionArn;

    // Update service to use new task definition
    await ecsClient.send(new UpdateServiceCommand({ cluster, service, taskDefinition: newTdArn }));

    res.json({ success: true, logGroup, retentionDays: retention, newTaskDefinition: newTdArn });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /apigateway/:id/integrations ──────────────────────────────────────────

router.get('/apigateway/:id/integrations', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg  = await resolveAwsConfig(profileId);
    const type = (req.query.type || 'REST').toUpperCase();
    const id   = req.params.id;

    if (type === 'REST') {
      const {
        APIGatewayClient, GetResourcesCommand, GetIntegrationCommand,
      } = require('@aws-sdk/client-api-gateway');
      const client = new APIGatewayClient(cfg);
      const resources = [];
      let position;
      do {
        const resp = await client.send(new GetResourcesCommand({ restApiId: id, limit: 500, position }));
        resources.push(...(resp.items || []));
        position = resp.position;
      } while (position);

      const integrations = [];
      for (const r of resources) {
        for (const method of Object.keys(r.resourceMethods || {})) {
          if (method === 'OPTIONS') continue;
          try {
            const integ = await client.send(new GetIntegrationCommand({
              restApiId: id, resourceId: r.id, httpMethod: method,
            }));
            let lambdaName = null;
            if (integ.uri) {
              const m = integ.uri.match(/functions\/arn:aws:lambda:[^:]+:\d+:function:([^/]+)/);
              if (m) lambdaName = m[1];
            }
            integrations.push({
              path: r.path, method, type: integ.type,
              uri: integ.uri, lambdaName,
              passthroughBehavior: integ.passthroughBehavior,
              timeoutMs: integ.timeoutInMillis,
            });
          } catch { /* method without integration */ }
        }
      }
      return res.json({ type: 'REST', integrations });
    }

    // HTTP / WebSocket APIs (ApiGatewayV2)
    const {
      ApiGatewayV2Client, GetRoutesCommand, GetIntegrationsCommand,
    } = require('@aws-sdk/client-apigatewayv2');
    const v2 = new ApiGatewayV2Client(cfg);
    const [routesResp, integsResp] = await Promise.all([
      v2.send(new GetRoutesCommand({ ApiId: id })),
      v2.send(new GetIntegrationsCommand({ ApiId: id })),
    ]);
    const integMap = {};
    for (const ig of (integsResp.Items || [])) {
      integMap[ig.IntegrationId] = ig;
    }
    const integrations = (routesResp.Items || []).map(route => {
      const ig = integMap[route.Target?.replace('integrations/', '')] || {};
      let lambdaName = null;
      if (ig.IntegrationUri) {
        const m = ig.IntegrationUri.match(/functions\/arn:aws:lambda:[^:]+:\d+:function:([^/]+)/);
        if (m) lambdaName = m[1];
      }
      return {
        routeKey: route.RouteKey, type: ig.IntegrationType,
        uri: ig.IntegrationUri, lambdaName,
        payloadFormatVersion: ig.PayloadFormatVersion,
        timeoutMs: ig.TimeoutInMillis,
      };
    });
    res.json({ type, integrations });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /eks/:name/add-kubeconfig ────────────────────────────────────────────

router.post('/eks/:name/add-kubeconfig', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EKSClient, DescribeClusterCommand } = require('@aws-sdk/client-eks');
    const client = new EKSClient(cfg);
    const resp = await client.send(new DescribeClusterCommand({ name: req.params.name }));
    const cluster = resp.cluster;

    const fs   = require('fs');
    const path = require('path');
    const yaml = require('js-yaml');
    const kubeDir  = path.join(require('os').homedir(), '.kube');
    const kubePath = path.join(kubeDir, 'config');
    if (!fs.existsSync(kubeDir)) fs.mkdirSync(kubeDir, { recursive: true });

    let kubeconfig = { apiVersion: 'v1', kind: 'Config', clusters: [], contexts: [], users: [], 'current-context': '' };
    if (fs.existsSync(kubePath)) {
      try { kubeconfig = yaml.load(fs.readFileSync(kubePath, 'utf8')) || kubeconfig; } catch { /* bad file */ }
    }

    const contextName = `aws-${cluster.name}`;
    const clusterEntry = {
      name: contextName,
      cluster: { server: cluster.endpoint, 'certificate-authority-data': cluster.certificateAuthority?.data },
    };
    const userEntry = {
      name: contextName,
      user: { exec: {
        apiVersion: 'client.authentication.k8s.io/v1beta1',
        command: 'aws',
        args: ['eks', 'get-token', '--cluster-name', cluster.name, '--region', cfg.region || 'us-east-1'],
      }},
    };
    const contextEntry = { name: contextName, context: { cluster: contextName, user: contextName } };

    // Upsert
    kubeconfig.clusters  = (kubeconfig.clusters  || []).filter(c => c.name !== contextName);
    kubeconfig.users     = (kubeconfig.users     || []).filter(u => u.name !== contextName);
    kubeconfig.contexts  = (kubeconfig.contexts  || []).filter(c => c.name !== contextName);
    kubeconfig.clusters.push(clusterEntry);
    kubeconfig.users.push(userEntry);
    kubeconfig.contexts.push(contextEntry);

    fs.writeFileSync(kubePath, yaml.dump(kubeconfig, { lineWidth: -1 }), 'utf8');
    res.json({ success: true, context: contextName, message: `Context "${contextName}" added to ~/.kube/config` });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /s3/:bucket/browse ────────────────────────────────────────────────────

router.get('/s3/:bucket/browse', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const client = new S3Client(cfg);
    const prefix = req.query.prefix || '';
    const params = {
      Bucket: req.params.bucket, Prefix: prefix, Delimiter: '/',
      MaxKeys: 300,
    };
    if (req.query.continuationToken) params.ContinuationToken = req.query.continuationToken;
    const resp = await client.send(new ListObjectsV2Command(params));

    const folders = (resp.CommonPrefixes || []).map(p => p.Prefix);
    const files = (resp.Contents || [])
      .filter(o => o.Key !== prefix)
      .map(o => ({
        key: o.Key,
        name: o.Key.split('/').filter(Boolean).pop(),
        size: o.Size,
        lastModified: o.LastModified,
        storageClass: o.StorageClass,
      }));

    res.json({
      prefix, folders, files, region: cfg.region,
      nextContinuationToken: resp.NextContinuationToken || null,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /s3/:bucket/object ────────────────────────────────────────────────────

router.get('/s3/:bucket/object', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client(cfg);
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'key is required' });

    const head = await client.send(new HeadObjectCommand({ Bucket: req.params.bucket, Key: key }));
    const meta = {
      key,
      contentType: head.ContentType || '',
      size: head.ContentLength || 0,
      lastModified: head.LastModified,
      etag: head.ETag,
      versionId: head.VersionId || null,
      storageClass: head.StorageClass || 'STANDARD',
      serverSideEncryption: head.ServerSideEncryption || null,
      cacheControl: head.CacheControl || null,
      contentEncoding: head.ContentEncoding || null,
      contentDisposition: head.ContentDisposition || null,
      contentLanguage: head.ContentLanguage || null,
      metadata: head.Metadata || {},
      partsCount: head.PartsCount || null,
      acceptRanges: head.AcceptRanges || null,
    };

    const contentType = meta.contentType;
    const size = meta.size;

    // Image preview (base64) – up to 10 MB
    const isImage = contentType.startsWith('image/');
    if (isImage && size <= 10 * 1024 * 1024) {
      const resp = await client.send(new GetObjectCommand({ Bucket: req.params.bucket, Key: key }));
      const chunks = [];
      for await (const chunk of resp.Body) chunks.push(chunk);
      const base64 = Buffer.concat(chunks).toString('base64');
      return res.json({ binary: false, image: true, base64, ...meta });
    }

    // PDF preview (base64) – up to 10 MB
    const isPdf = contentType === 'application/pdf';
    if (isPdf && size <= 10 * 1024 * 1024) {
      const resp = await client.send(new GetObjectCommand({ Bucket: req.params.bucket, Key: key }));
      const chunks = [];
      for await (const chunk of resp.Body) chunks.push(chunk);
      const base64 = Buffer.concat(chunks).toString('base64');
      return res.json({ binary: false, pdf: true, base64, ...meta });
    }

    // Text / CSV preview – up to 2 MB
    const textTypes = ['text/', 'application/json', 'application/xml', 'application/javascript',
      'application/x-yaml', 'application/yaml', 'application/x-sh'];
    const isCsv = contentType === 'text/csv' || key.toLowerCase().endsWith('.csv');
    const isText = textTypes.some(t => contentType.includes(t)) || isCsv || size === 0;

    if (!isText || size > 2 * 1024 * 1024) {
      return res.json({ binary: true, ...meta });
    }

    const resp = await client.send(new GetObjectCommand({ Bucket: req.params.bucket, Key: key }));
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf-8');
    res.json({ binary: false, csv: isCsv, body, ...meta });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /s3/:bucket/download ──────────────────────────────────────────────────

router.get('/s3/:bucket/download', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client(cfg);
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'key is required' });

    const resp = await client.send(new GetObjectCommand({ Bucket: req.params.bucket, Key: key }));
    const filename = key.split('/').filter(Boolean).pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (resp.ContentType) res.setHeader('Content-Type', resp.ContentType);
    if (resp.ContentLength) res.setHeader('Content-Length', resp.ContentLength);
    resp.Body.pipe(res);
  } catch (err) { handleErr(res, err); }
});

module.exports = router;


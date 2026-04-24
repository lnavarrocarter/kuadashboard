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
 *   GET  /bedrock                           → list Bedrock foundation models
 *   GET  /lex                               → list Amazon Lex V2 bots
 *   GET  /cloudformation/stacks             → list CloudFormation stacks
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
          // 'windows' cuando Platform === 'windows', undefined/null = Linux
          platform:     i.Platform?.toLowerCase() || 'linux',
          tags:         i.Tags || [],
        });
      }
    }
    res.json(instances);
  } catch (err) { handleErr(res, err); }
});

// ─── GET /ec2/:id/details ─────────────────────────────────────────────────────
// Returns full instance details: detalles, networking, storage, security + CW metrics

router.get('/ec2/:id/details', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const instanceId = req.params.id;

    const {
      EC2Client,
      DescribeInstancesCommand,
      DescribeVolumesCommand,
      DescribeSecurityGroupsCommand,
      DescribeInstanceStatusCommand,
    } = require('@aws-sdk/client-ec2');

    const {
      CloudWatchClient,
      GetMetricStatisticsCommand,
    } = require('@aws-sdk/client-cloudwatch');

    const ec2 = new EC2Client(cfg);
    const cw  = new CloudWatchClient(cfg);

    // ── Fetch in parallel: instance data, volumes, instance status ────────────
    const [instResp, volResp, statusResp] = await Promise.all([
      ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] })),
      ec2.send(new DescribeVolumesCommand({
        Filters: [{ Name: 'attachment.instance-id', Values: [instanceId] }],
      })),
      ec2.send(new DescribeInstanceStatusCommand({
        InstanceIds: [instanceId],
        IncludeAllInstances: true,
      })),
    ]);

    const raw = instResp.Reservations?.[0]?.Instances?.[0];
    if (!raw) return res.status(404).json({ error: 'Instance not found' });

    // Fetch security group rules for all SGs attached to this instance
    const sgIds = (raw.SecurityGroups || []).map(g => g.GroupId);
    let sgDetails = [];
    if (sgIds.length) {
      const sgResp = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: sgIds }));
      sgDetails = (sgResp.SecurityGroups || []).map(g => ({
        id:          g.GroupId,
        name:        g.GroupName,
        description: g.Description,
        vpcId:       g.VpcId,
        inbound:     (g.IpPermissions || []).map(r => ({
          protocol: r.IpProtocol === '-1' ? 'All' : r.IpProtocol?.toUpperCase(),
          fromPort: r.FromPort,
          toPort:   r.ToPort,
          sources:  [
            ...(r.IpRanges || []).map(x => ({ cidr: x.CidrIp, desc: x.Description })),
            ...(r.Ipv6Ranges || []).map(x => ({ cidr: x.CidrIpv6, desc: x.Description })),
            ...(r.UserIdGroupPairs || []).map(x => ({ sg: x.GroupId, desc: x.Description })),
          ],
        })),
        outbound:    (g.IpPermissionsEgress || []).map(r => ({
          protocol: r.IpProtocol === '-1' ? 'All' : r.IpProtocol?.toUpperCase(),
          fromPort: r.FromPort,
          toPort:   r.ToPort,
          sources:  [
            ...(r.IpRanges || []).map(x => ({ cidr: x.CidrIp, desc: x.Description })),
            ...(r.Ipv6Ranges || []).map(x => ({ cidr: x.CidrIpv6, desc: x.Description })),
            ...(r.UserIdGroupPairs || []).map(x => ({ sg: x.GroupId, desc: x.Description })),
          ],
        })),
      }));
    }

    // ── CloudWatch metrics (last 3 hours, 5-min periods) ──────────────────────
    const now   = new Date();
    const start = new Date(now - 3 * 60 * 60 * 1000);
    const dims  = [{ Name: 'InstanceId', Value: instanceId }];

    const metricDefs = [
      { name: 'CPUUtilization',  unit: 'Percent',          stat: 'Average' },
      { name: 'NetworkIn',       unit: 'Bytes',            stat: 'Sum'     },
      { name: 'NetworkOut',      unit: 'Bytes',            stat: 'Sum'     },
      { name: 'DiskReadBytes',   unit: 'Bytes',            stat: 'Sum'     },
      { name: 'DiskWriteBytes',  unit: 'Bytes',            stat: 'Sum'     },
      { name: 'StatusCheckFailed', unit: 'Count',          stat: 'Maximum' },
    ];

    let metrics = {};
    try {
      const metricResults = await Promise.all(
        metricDefs.map(m => cw.send(new GetMetricStatisticsCommand({
          Namespace:  'AWS/EC2',
          MetricName: m.name,
          Dimensions: dims,
          StartTime:  start,
          EndTime:    now,
          Period:     300,
          Statistics: [m.stat],
          Unit:       m.unit,
        })))
      );
      metricDefs.forEach((m, idx) => {
        const points = (metricResults[idx].Datapoints || [])
          .sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp))
          .map(p => ({ t: p.Timestamp, v: p[m.stat] ?? 0 }));
        metrics[m.name] = points;
      });
    } catch (_) { /* metrics optional — ignore if CW not available */ }

    // ── Build response ─────────────────────────────────────────────────────────
    const instStatus = statusResp.InstanceStatuses?.[0];
    const niList = (raw.NetworkInterfaces || []).map(ni => ({
      id:          ni.NetworkInterfaceId,
      subnetId:    ni.SubnetId,
      vpcId:       ni.VpcId,
      privateIp:   ni.PrivateIpAddress,
      publicIp:    ni.Association?.PublicIp || null,
      publicDns:   ni.Association?.PublicDnsName || null,
      privateDns:  ni.PrivateDnsName,
      macAddress:  ni.MacAddress,
      description: ni.Description,
      status:      ni.Status,
      sourceDest:  ni.SourceDestCheck,
      groups:      (ni.Groups || []).map(g => ({ id: g.GroupId, name: g.GroupName })),
    }));

    res.json({
      // ── Detalles generales ──────────────────────────────────────────────
      details: {
        id:               raw.InstanceId,
        name:             raw.Tags?.find(t => t.Key === 'Name')?.Value || raw.InstanceId,
        type:             raw.InstanceType,
        state:            raw.State?.Name,
        stateReason:      raw.StateTransitionReason || null,
        platform:         raw.Platform?.toLowerCase() || 'linux',
        architecture:     raw.Architecture,
        hypervisor:       raw.Hypervisor,
        virtualizationType: raw.VirtualizationType,
        ami:              raw.ImageId,
        keyPair:          raw.KeyName || null,
        iamProfile:       raw.IamInstanceProfile?.Arn || null,
        publicIp:         raw.PublicIpAddress || null,
        privateIp:        raw.PrivateIpAddress || null,
        publicDns:        raw.PublicDnsName || null,
        privateDns:       raw.PrivateDnsName || null,
        az:               raw.Placement?.AvailabilityZone,
        region:           raw.Placement?.AvailabilityZone?.slice(0, -1),
        tenancy:          raw.Placement?.Tenancy,
        launchTime:       raw.LaunchTime,
        ebsOptimized:     raw.EbsOptimized,
        enaSupport:       raw.EnaSupport,
        rootDeviceName:   raw.RootDeviceName,
        rootDeviceType:   raw.RootDeviceType,
        monitoring:       raw.Monitoring?.State,
        capacityReserv:   raw.CapacityReservationSpecification?.CapacityReservationPreference || null,
        tags:             raw.Tags || [],
        // System status checks
        systemStatus:     instStatus?.SystemStatus?.Status || 'unknown',
        instanceStatus:   instStatus?.InstanceStatus?.Status || 'unknown',
      },
      // ── Networking ──────────────────────────────────────────────────────
      networking: {
        vpcId:        raw.VpcId || null,
        subnetId:     raw.SubnetId || null,
        sourceDestCheck: raw.SourceDestCheck,
        interfaces:   niList,
      },
      // ── Storage ─────────────────────────────────────────────────────────
      storage: {
        rootDevice:   raw.RootDeviceName,
        volumes: (volResp.Volumes || []).map(v => ({
          id:         v.VolumeId,
          size:       v.Size,
          type:       v.VolumeType,
          state:      v.State,
          encrypted:  v.Encrypted,
          iops:       v.Iops || null,
          throughput: v.Throughput || null,
          az:         v.AvailabilityZone,
          device:     v.Attachments?.[0]?.Device,
          deleteOnTermination: v.Attachments?.[0]?.DeleteOnTermination,
          snapshotId: v.SnapshotId || null,
          kmsKeyId:   v.KmsKeyId || null,
          multiAttach: v.MultiAttachEnabled,
          createTime: v.CreateTime,
        })),
      },
      // ── Security ────────────────────────────────────────────────────────
      security: {
        securityGroups: sgDetails,
        iamProfile:     raw.IamInstanceProfile?.Arn || null,
        metadataOptions: {
          httpTokens:        raw.MetadataOptions?.HttpTokens,
          httpEndpoint:      raw.MetadataOptions?.HttpEndpoint,
          httpPutHopLimit:   raw.MetadataOptions?.HttpPutResponseHopLimit,
          instanceMetadataTags: raw.MetadataOptions?.InstanceMetadataTags,
        },
      },
      // ── Monitoring ──────────────────────────────────────────────────────
      monitoring: {
        cwEnabled: raw.Monitoring?.State === 'enabled',
        metrics,
      },
    });
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

// ─── POST /s3 ─────────────────────────────────────────────────────────────────
// Body: { name: string, region?: string, blockPublicAccess?: boolean }

router.post('/s3', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { name, region = 'us-east-1', blockPublicAccess = true } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!/^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/.test(name)) {
    return res.status(400).json({ error: 'Bucket name must be 3-63 lowercase alphanumeric chars, dots or hyphens' });
  }
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      S3Client, CreateBucketCommand,
      PutPublicAccessBlockCommand, GetBucketLocationCommand,
    } = require('@aws-sdk/client-s3');
    const client = new S3Client({ ...cfg, region: region === 'us-east-1' ? 'us-east-1' : region });
    const createParams = { Bucket: name };
    if (region !== 'us-east-1') {
      createParams.CreateBucketConfiguration = { LocationConstraint: region };
    }
    await client.send(new CreateBucketCommand(createParams));
    if (blockPublicAccess) {
      await client.send(new PutPublicAccessBlockCommand({
        Bucket: name,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true, IgnorePublicAcls: true,
          BlockPublicPolicy: true, RestrictPublicBuckets: true,
        },
      }));
    }
    const loc = await client.send(new GetBucketLocationCommand({ Bucket: name })).catch(() => null);
    res.json({
      name,
      region: loc?.LocationConstraint || 'us-east-1',
      created: true,
      blockPublicAccess,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /s3/:bucket/test ─────────────────────────────────────────────────────

router.get('/s3/:bucket/test', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { S3Client, HeadBucketCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({ ...cfg, region: 'us-east-1' });
    const bucket = req.params.bucket;
    const start  = Date.now();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const latencyMs = Date.now() - start;
    let region = 'us-east-1';
    try {
      const loc = await client.send(new GetBucketLocationCommand({ Bucket: bucket }));
      region = loc.LocationConstraint || 'us-east-1';
    } catch { /* ignore */ }
    res.json({ accessible: true, bucket, region, latencyMs });
  } catch (err) {
    const status = err.$metadata?.httpStatusCode;
    if (status === 403) {
      res.json({ accessible: false, bucket, reason: 'Access denied (403)', status });
    } else if (status === 404) {
      res.json({ accessible: false, bucket, reason: 'Bucket not found (404)', status });
    } else {
      res.json({ accessible: false, bucket, reason: err.message, status: status || 0 });
    }
  }
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

// ─── GET /ecr/:repo/images ────────────────────────────────────────────────────
// Returns full image details (tags, digest, pushed date, size) for a repo

router.get('/ecr/:repo/images', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { ECRClient, DescribeImagesCommand } = require('@aws-sdk/client-ecr');
    const client = new ECRClient(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new DescribeImagesCommand({
        repositoryName: req.params.repo,
        nextToken,
        filter: { tagStatus: 'ANY' },
      }));
      all.push(...(resp.imageDetails || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    // Sort newest first
    all.sort((a, b) => (b.imagePushedAt || 0) - (a.imagePushedAt || 0));
    res.json(all.map(img => ({
      digest:      img.imageDigest,
      tags:        img.imageTags || [],
      pushedAt:    img.imagePushedAt || null,
      sizeBytes:   img.imageSizeInBytes || null,
      scanStatus:  img.imageScanStatus?.status || null,
      scanFindings: img.imageScanFindingsSummary?.findingSeverityCounts || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── POST /k8s/apply ──────────────────────────────────────────────────────────
// Applies a Kubernetes manifest string via `kubectl apply -f -`
// Body: { manifest: string, context?: string }

router.post('/k8s/apply', async (req, res) => {
  const { manifest, context } = req.body || {};
  if (!manifest || typeof manifest !== 'string' || manifest.trim().length < 10) {
    return res.status(400).json({ error: 'manifest string is required' });
  }
  const { execFile } = require('child_process');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  // Write manifest to temp file (avoids stdin escaping issues on Windows)
  const tmpFile = path.join(os.tmpdir(), `kua-manifest-${Date.now()}.yaml`);
  try {
    await fs.promises.writeFile(tmpFile, manifest, 'utf8');
    const args = ['apply', '-f', tmpFile];
    if (context) args.push('--context', context);
    const result = await new Promise((resolve) => {
      execFile('kubectl', args, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ success: !err || err.code === 0, stdout: stdout || '', stderr: stderr || '', code: err?.code ?? 0 });
      });
    });
    res.json(result);
  } catch (err) {
    res.json({ success: false, stdout: '', stderr: err.message, code: -1 });
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
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

// ─── GET /lambda/:name/details ────────────────────────────────────────────────
// Returns: config, aliases, versions (last 10), resource policy, CW metrics

router.get('/lambda/:name/details', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const name = req.params.name;

    const {
      LambdaClient,
      GetFunctionCommand,
      ListAliasesCommand,
      ListVersionsByFunctionCommand,
      GetPolicyCommand,
      GetFunctionConcurrencyCommand,
    } = require('@aws-sdk/client-lambda');

    const {
      CloudWatchClient,
      GetMetricStatisticsCommand,
    } = require('@aws-sdk/client-cloudwatch');

    const lambda = new LambdaClient(cfg);
    const cw     = new CloudWatchClient(cfg);

    // Parallel: fn details, aliases, versions, policy, concurrency
    const [fnRes, aliasRes, verRes, policyRes, concRes] = await Promise.allSettled([
      lambda.send(new GetFunctionCommand({ FunctionName: name })),
      lambda.send(new ListAliasesCommand({ FunctionName: name })),
      lambda.send(new ListVersionsByFunctionCommand({ FunctionName: name, MaxItems: 15 })),
      lambda.send(new GetPolicyCommand({ FunctionName: name })),
      lambda.send(new GetFunctionConcurrencyCommand({ FunctionName: name })),
    ]);

    const fn = fnRes.status === 'fulfilled' ? fnRes.value : null;
    const cfg2 = fn?.Configuration;

    // CW metrics — last 3 hours, 5-min periods
    const now   = new Date();
    const start = new Date(now - 3 * 60 * 60 * 1000);
    const dims  = [{ Name: 'FunctionName', Value: name }];
    const metricDefs = [
      { name: 'Invocations',          stat: 'Sum'     },
      { name: 'Errors',               stat: 'Sum'     },
      { name: 'Duration',             stat: 'Average' },
      { name: 'Throttles',            stat: 'Sum'     },
      { name: 'ConcurrentExecutions', stat: 'Maximum' },
    ];
    let metrics = {};
    try {
      const mResults = await Promise.all(
        metricDefs.map(m => cw.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda', MetricName: m.name,
          Dimensions: dims, StartTime: start, EndTime: now,
          Period: 300, Statistics: [m.stat],
        })))
      );
      metricDefs.forEach((m, i) => {
        metrics[m.name] = (mResults[i].Datapoints || [])
          .sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp))
          .map(p => ({ t: p.Timestamp, v: p[m.stat] ?? 0 }));
      });
    } catch (_) {}

    // Parse resource-based policy
    let policy = null;
    if (policyRes.status === 'fulfilled') {
      try { policy = JSON.parse(policyRes.value.Policy); } catch (_) {}
    }

    res.json({
      basic: {
        name:              cfg2?.FunctionName,
        arn:               cfg2?.FunctionArn,
        description:       cfg2?.Description || null,
        runtime:           cfg2?.Runtime,
        handler:           cfg2?.Handler,
        memory:            cfg2?.MemorySize,
        timeout:           cfg2?.Timeout,
        codeSize:          cfg2?.CodeSize,
        packageType:       cfg2?.PackageType,   // Zip | Image
        imageUri:          fn?.Code?.ImageUri || null,
        architecture:      (cfg2?.Architectures || ['x86_64'])[0],
        state:             cfg2?.State,
        stateReason:       cfg2?.StateReason || null,
        lastModified:      cfg2?.LastModified,
        codeHash:          cfg2?.CodeSha256,
        version:           cfg2?.Version,
        logGroup:          cfg2?.LoggingConfig?.LogGroup || `/aws/lambda/${name}`,
        logFormat:         cfg2?.LoggingConfig?.LogFormat || null,
        ephemeralStorage:  cfg2?.EphemeralStorage?.Size || 512,
        snapStart:         cfg2?.SnapStart?.ApplyOn || null,
        tags:              fn?.Tags || {},
      },
      config: {
        envVars:   Object.entries(cfg2?.Environment?.Variables || {}).map(([k, v]) => ({ k, v })),
        layers:    (cfg2?.Layers || []).map(l => ({ arn: l.Arn, codeSize: l.CodeSize })),
        vpc: cfg2?.VpcConfig?.VpcId ? {
          vpcId:            cfg2.VpcConfig.VpcId,
          subnetIds:        cfg2.VpcConfig.SubnetIds || [],
          securityGroupIds: cfg2.VpcConfig.SecurityGroupIds || [],
        } : null,
        tracing:          cfg2?.TracingConfig?.Mode,
        dlq:              cfg2?.DeadLetterConfig?.TargetArn || null,
        reservedConcurrency: concRes.status === 'fulfilled'
          ? concRes.value.ReservedConcurrentExecutions ?? null
          : null,
        fileSystem: (cfg2?.FileSystemConfigs || []).map(f => ({
          arn: f.Arn, localMountPath: f.LocalMountPath,
        })),
        kmsKeyArn:        cfg2?.KMSKeyArn || null,
      },
      aliases: aliasRes.status === 'fulfilled'
        ? (aliasRes.value.Aliases || []).map(a => ({
            name:        a.Name,
            arn:         a.AliasArn,
            version:     a.FunctionVersion,
            description: a.Description || null,
            routing:     a.RoutingConfig?.AdditionalVersionWeights
              ? Object.entries(a.RoutingConfig.AdditionalVersionWeights).map(([v, w]) => ({ version: v, weight: w }))
              : [],
          }))
        : [],
      versions: verRes.status === 'fulfilled'
        ? (verRes.value.Versions || []).slice(-10).reverse().map(v => ({
            version:     v.Version,
            description: v.Description || null,
            state:       v.State,
            lastModified: v.LastModified,
            codeSize:    v.CodeSize,
          }))
        : [],
      policy:  policy,
      metrics,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lambda/:name/code ───────────────────────────────────────────────────
// Downloads the deployment ZIP, extracts it in-memory, returns file tree + content

router.get('/lambda/:name/code', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const name = req.params.name;
    const { LambdaClient, GetFunctionCommand } = require('@aws-sdk/client-lambda');
    const lambda = new LambdaClient(cfg);
    const fnData = await lambda.send(new GetFunctionCommand({ FunctionName: name }));

    const pkgType = fnData.Configuration?.PackageType;

    // Container images: no ZIP to extract
    if (pkgType === 'Image') {
      return res.json({
        type:     'image',
        imageUri: fnData.Code?.ImageUri || null,
        files:    [],
      });
    }

    const codeUrl = fnData.Code?.Location;
    if (!codeUrl) return res.status(404).json({ error: 'Code location not available' });

    // Download the ZIP buffer
    const zipBuffer = await new Promise((resolve, reject) => {
      const proto = codeUrl.startsWith('https') ? require('https') : require('http');
      proto.get(codeUrl, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end',  () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });

    const AdmZip = require('adm-zip');
    const zip    = new AdmZip(zipBuffer);
    const TEXT_EXT = new Set([
      '.js','.mjs','.cjs','.ts','.py','.rb','.go','.java','.cs','.php','.sh',
      '.yaml','.yml','.json','.toml','.env','.txt','.md','.html','.css','.xml',
      '.sql','.graphql','.tf','.hcl','.cfg','.ini','.conf','.properties','.gradle',
      '.rs','.cpp','.c','.h','.hpp','.kt','.swift','.scala','.r','.lua','.pl',
    ]);
    const MAX_FILE_SIZE = 256 * 1024; // 256 KB per file

    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const files = entries.map(e => {
      const ext = require('path').extname(e.entryName).toLowerCase();
      const isText = TEXT_EXT.has(ext);
      let content = null;
      if (isText && e.header.size <= MAX_FILE_SIZE) {
        try { content = e.getData().toString('utf-8'); } catch (_) {}
      }
      return {
        path:    e.entryName,
        size:    e.header.size,
        isText,
        content,
      };
    }).sort((a, b) => a.path.localeCompare(b.path));

    res.json({ type: 'zip', files });
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AWS GLUE ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /glue/jobs  → list Glue ETL jobs
router.get('/glue/jobs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, GetJobsCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new GetJobsCommand({}));
    res.json((resp.Jobs || []).map(j => ({
      name:        j.Name,
      description: j.Description || '',
      role:        j.Role,
      glueVersion: j.GlueVersion,
      maxCapacity: j.MaxCapacity,
      workerType:  j.WorkerType,
      numWorkers:  j.NumberOfWorkers,
      createdOn:   j.CreatedOn,
      lastModified: j.LastModifiedOn,
      command:     j.Command?.Name,
      scriptLocation: j.Command?.ScriptLocation,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /glue/databases  → list Glue Data Catalog databases
router.get('/glue/databases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, GetDatabasesCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new GetDatabasesCommand({}));
    res.json((resp.DatabaseList || []).map(d => ({
      name:        d.Name,
      description: d.Description || '',
      locationUri: d.LocationUri,
      createTime:  d.CreateTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// POST /glue/jobs/:name/run  → trigger a Glue job run
router.post('/glue/jobs/:name/run', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, StartJobRunCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new StartJobRunCommand({
      JobName: req.params.name,
      Arguments: req.body?.arguments || {},
    }));
    res.json({ jobRunId: resp.JobRunId });
  } catch (err) { handleErr(res, err); }
});

// GET /glue/jobs/:name/runs  → list recent job runs
router.get('/glue/jobs/:name/runs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, GetJobRunsCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new GetJobRunsCommand({ JobName: req.params.name, MaxResults: 20 }));
    res.json((resp.JobRuns || []).map(r => ({
      id:           r.Id,
      status:       r.JobRunState,
      startedOn:    r.StartedOn,
      completedOn:  r.CompletedOn,
      errorMessage: r.ErrorMessage || null,
      executionTime: r.ExecutionTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /glue/jobs/:name/config  → full job config (connections, script, args, CW logs)
router.get('/glue/jobs/:name/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, GetJobCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new GetJobCommand({ JobName: req.params.name }));
    const j = resp.Job;
    res.json({
      name:              j.Name,
      description:       j.Description || '',
      role:              j.Role,
      glueVersion:       j.GlueVersion,
      maxCapacity:       j.MaxCapacity,
      workerType:        j.WorkerType,
      numberOfWorkers:   j.NumberOfWorkers,
      maxRetries:        j.MaxRetries,
      timeout:           j.Timeout,
      createdOn:         j.CreatedOn,
      lastModifiedOn:    j.LastModifiedOn,
      command:           j.Command,
      defaultArguments:  j.DefaultArguments || {},
      nonOverridableArguments: j.NonOverridableArguments || {},
      connections:       j.Connections?.Connections || [],
      executionProperty: j.ExecutionProperty,
      notificationProperty: j.NotificationProperty,
      codeGenConfigurationNodes: j.CodeGenConfigurationNodes,
      securityConfiguration: j.SecurityConfiguration || null,
      logUri:            j.LogUri || null,
      cloudWatchLogGroup: `/aws-glue/jobs/${j.Name}`,
    });
  } catch (err) { handleErr(res, err); }
});

// GET /glue/connections  → list Glue Data Catalog connections
router.get('/glue/connections', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, GetConnectionsCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new GetConnectionsCommand({}));
    res.json((resp.ConnectionList || []).map(c => ({
      name:            c.Name,
      description:     c.Description || '',
      connectionType:  c.ConnectionType,
      status:          c.ConnectionProperties?.['JDBC_ENFORCE_SSL'] ? 'SSL' : 'PLAIN',
      lastUpdated:     c.LastUpdatedTime,
      physicalConnectionRequirements: {
        subnetId:          c.PhysicalConnectionRequirements?.SubnetId || null,
        availabilityZone:  c.PhysicalConnectionRequirements?.AvailabilityZone || null,
        securityGroups:    c.PhysicalConnectionRequirements?.SecurityGroupIdList || [],
      },
      // Expose host/port but NOT credentials
      connectionUrl:  c.ConnectionProperties?.['JDBC_CONNECTION_URL'] || c.ConnectionProperties?.['CONNECTION_URL'] || null,
      host:           c.ConnectionProperties?.['HOST'] || null,
      port:           c.ConnectionProperties?.['PORT'] || null,
      kafkaBrokers:   c.ConnectionProperties?.['KAFKA_BOOTSTRAP_SERVERS'] || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /glue/logs/:name  → CloudWatch logs for a Glue job
router.get('/glue/logs/:name', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const minutes = parseInt(req.query.minutes || '60', 10);
    const runId   = req.query.runId || null;
    const client  = new CloudWatchLogsClient(cfg);
    const logGroupName = `/aws-glue/jobs/${req.params.name}`;
    const params = {
      logGroupName,
      startTime: Date.now() - minutes * 60 * 1000,
      limit: 500,
      ...(runId ? { logStreamNames: [`${req.params.name}/${runId}`] } : {}),
    };
    const resp = await client.send(new FilterLogEventsCommand(params));
    res.json({
      logGroup: logGroupName,
      events: (resp.events || []).map(e => ({ timestamp: e.timestamp, message: e.message })),
    });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON DOCUMENTDB ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /docdb  → list DocumentDB clusters
router.get('/docdb', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DocDBClient, DescribeDBClustersCommand } = require('@aws-sdk/client-docdb');
    const client = new DocDBClient(cfg);
    const resp = await client.send(new DescribeDBClustersCommand({
      Filters: [{ Name: 'engine', Values: ['docdb'] }],
    }));
    res.json((resp.DBClusters || []).map(c => ({
      id:               c.DBClusterIdentifier,
      status:           c.Status,
      engine:           c.Engine,
      engineVersion:    c.EngineVersion,
      endpoint:         c.Endpoint,
      readerEndpoint:   c.ReaderEndpoint,
      port:             c.Port,
      masterUsername:   c.MasterUsername,
      multiAZ:          c.MultiAZ,
      storageEncrypted: c.StorageEncrypted,
      clusterCreateTime: c.ClusterCreateTime,
      members:          (c.DBClusterMembers || []).map(m => ({
        id:     m.DBInstanceIdentifier,
        writer: m.IsClusterWriter,
      })),
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /docdb/:id/config  → full cluster details + instances
router.get('/docdb/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DocDBClient, DescribeDBClustersCommand, DescribeDBInstancesCommand } = require('@aws-sdk/client-docdb');
    const client = new DocDBClient(cfg);
    const [clusterResp, instResp] = await Promise.all([
      client.send(new DescribeDBClustersCommand({ DBClusterIdentifier: req.params.id })),
      client.send(new DescribeDBInstancesCommand({ Filters: [{ Name: 'db-cluster-id', Values: [req.params.id] }] })),
    ]);
    const c = clusterResp.DBClusters?.[0];
    if (!c) return res.status(404).json({ error: 'Cluster not found' });
    res.json({
      id:                    c.DBClusterIdentifier,
      status:                c.Status,
      engine:                c.Engine,
      engineVersion:         c.EngineVersion,
      endpoint:              c.Endpoint,
      readerEndpoint:        c.ReaderEndpoint,
      port:                  c.Port,
      masterUsername:        c.MasterUsername,
      multiAZ:               c.MultiAZ,
      storageEncrypted:      c.StorageEncrypted,
      kmsKeyId:              c.KmsKeyId,
      availabilityZones:     c.AvailabilityZones,
      vpcSecurityGroups:     (c.VpcSecurityGroups || []).map(sg => ({ id: sg.VpcSecurityGroupId, status: sg.Status })),
      subnetGroup:           c.DBSubnetGroup,
      parameterGroup:        c.DBClusterParameterGroup,
      backupRetentionPeriod: c.BackupRetentionPeriod,
      preferredBackupWindow: c.PreferredBackupWindow,
      preferredMaintenanceWindow: c.PreferredMaintenanceWindow,
      deletionProtection:    c.DeletionProtection,
      clusterCreateTime:     c.ClusterCreateTime,
      earliestRestorableTime: c.EarliestRestorableTime,
      latestRestorableTime:  c.LatestRestorableTime,
      members:               (c.DBClusterMembers || []).map(m => ({ id: m.DBInstanceIdentifier, writer: m.IsClusterWriter })),
      instances:             (instResp.DBInstances || []).map(i => ({
        id:            i.DBInstanceIdentifier,
        class:         i.DBInstanceClass,
        status:        i.DBInstanceStatus,
        az:            i.AvailabilityZone,
        writer:        (c.DBClusterMembers || []).find(m => m.DBInstanceIdentifier === i.DBInstanceIdentifier)?.IsClusterWriter ?? false,
        promotionTier: i.PromotionTier,
        endpoint:      i.Endpoint?.Address,
        port:          i.Endpoint?.Port,
        engineVersion: i.EngineVersion,
        publiclyAccessible: i.PubliclyAccessible,
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// POST /docdb/:id/reset-password  → reset master user password
router.post('/docdb/:id/reset-password', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DocDBClient, ModifyDBClusterCommand } = require('@aws-sdk/client-docdb');
    const client = new DocDBClient(cfg);
    await client.send(new ModifyDBClusterCommand({
      DBClusterIdentifier: req.params.id,
      MasterUserPassword:  newPassword,
      ApplyImmediately:    true,
    }));
    res.json({ ok: true, message: `Password reset initiated for cluster ${req.params.id}. Changes apply immediately.` });
  } catch (err) { handleErr(res, err); }
});

// POST /docdb  → create a new DocumentDB cluster
router.post('/docdb', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { clusterId, masterUsername, masterPassword, engineVersion, instanceClass, subnetGroupName, vpcSecurityGroupIds, storageEncrypted, deletionProtection, backupRetentionPeriod } = req.body || {};
  if (!clusterId || !masterUsername || !masterPassword) return res.status(400).json({ error: 'clusterId, masterUsername and masterPassword are required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DocDBClient, CreateDBClusterCommand, CreateDBInstanceCommand } = require('@aws-sdk/client-docdb');
    const client = new DocDBClient(cfg);
    const params = {
      DBClusterIdentifier:  clusterId,
      Engine:               'docdb',
      MasterUsername:       masterUsername,
      MasterUserPassword:   masterPassword,
      StorageEncrypted:     storageEncrypted ?? false,
      DeletionProtection:   deletionProtection ?? false,
      BackupRetentionPeriod: backupRetentionPeriod ?? 1,
    };
    if (engineVersion)        params.EngineVersion        = engineVersion;
    if (subnetGroupName)      params.DBSubnetGroupName    = subnetGroupName;
    if (vpcSecurityGroupIds?.length) params.VpcSecurityGroupIds = vpcSecurityGroupIds;
    const clusterResp = await client.send(new CreateDBClusterCommand(params));
    // Optionally create the first instance if instanceClass provided
    let instance = null;
    if (instanceClass) {
      try {
        const instResp = await client.send(new CreateDBInstanceCommand({
          DBInstanceIdentifier: `${clusterId}-instance-1`,
          DBClusterIdentifier:  clusterId,
          Engine:               'docdb',
          DBInstanceClass:      instanceClass,
        }));
        instance = instResp.DBInstance?.DBInstanceIdentifier;
      } catch (_) { /* instance creation error is non-fatal */ }
    }
    res.json({
      ok:        true,
      clusterId: clusterResp.DBCluster?.DBClusterIdentifier,
      status:    clusterResp.DBCluster?.Status,
      instance,
    });
  } catch (err) { handleErr(res, err); }
});

// GET /docdb/:id/connection-strings  → generate Compass/mongosh connection strings
// Returns only metadata needed to build the URI client-side; user supplies the password.
router.get('/docdb/:id/connection-strings', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DocDBClient, DescribeDBClustersCommand } = require('@aws-sdk/client-docdb');
    const client = new DocDBClient(cfg);
    const resp = await client.send(new DescribeDBClustersCommand({
      DBClusterIdentifier: req.params.id,
    }));
    const c = resp.DBClusters?.[0];
    if (!c) return res.status(404).json({ error: 'Cluster not found' });

    const endpoint = c.Endpoint;
    const port     = c.Port || 27017;
    const user     = c.MasterUsername;
    const region   = cfg.region;

    // DocumentDB requires TLS + Amazon CA bundle
    const tlsCAUrl = 'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem';

    res.json({
      clusterId:     c.DBClusterIdentifier,
      endpoint,
      port,
      masterUsername: user,
      region,
      tlsEnabled:    true,
      tlsCAUrl,
      // Templates — user fills in <PASSWORD>
      mongoshTemplate:  `mongosh "mongodb://${user}:<PASSWORD>@${endpoint}:${port}/?tls=true&tlsCAFile=global-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"`,
      compassUri:       `mongodb://${user}:<PASSWORD>@${endpoint}:${port}/?tls=true&tlsCAFile=global-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`,
      tlsDownloadNote:  `Download CA: curl -O ${tlsCAUrl}`,
      notes: [
        'Replace <PASSWORD> with the master user password.',
        'Download and reference global-bundle.pem for TLS: ' + tlsCAUrl,
        'MongoDB Compass: paste the URI in the connection string field, then set TLS/SSL > CA File to global-bundle.pem.',
      ],
    });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON DYNAMODB ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /dynamodb  → list DynamoDB tables
router.get('/dynamodb', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, ListTablesCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient(cfg);
    const list = await client.send(new ListTablesCommand({}));
    const details = await Promise.all(
      (list.TableNames || []).map(name =>
        client.send(new DescribeTableCommand({ TableName: name })).then(r => r.Table)
      )
    );
    res.json(details.map(t => ({
      name:             t.TableName,
      status:           t.TableStatus,
      itemCount:        t.ItemCount,
      sizeBytes:        t.TableSizeBytes,
      billingMode:      t.BillingModeSummary?.BillingMode || 'PROVISIONED',
      readCapacity:     t.ProvisionedThroughput?.ReadCapacityUnits,
      writeCapacity:    t.ProvisionedThroughput?.WriteCapacityUnits,
      creationDateTime: t.CreationDateTime,
      keySchema:        (t.KeySchema || []).map(k => ({ name: k.AttributeName, type: k.KeyType })),
      globalIndexes:    (t.GlobalSecondaryIndexes || []).length,
      localIndexes:     (t.LocalSecondaryIndexes || []).length,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /dynamodb/:table/config  → describe a specific table
router.get('/dynamodb/:table/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient(cfg);
    const resp = await client.send(new DescribeTableCommand({ TableName: req.params.table }));
    res.json(resp.Table);
  } catch (err) { handleErr(res, err); }
});

// POST /dynamodb/:table/scan  → scan table data (paginated)
router.post('/dynamodb/:table/scan', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { limit = 50, exclusiveStartKey } = req.body || {};
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
    const { unmarshall } = require('@aws-sdk/util-dynamodb');
    const client = new DynamoDBClient(cfg);
    const params = { TableName: req.params.table, Limit: Math.min(limit, 200) };
    if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;
    const resp = await client.send(new ScanCommand(params));
    res.json({
      items:                (resp.Items || []).map(i => unmarshall(i)),
      count:                resp.Count,
      scannedCount:         resp.ScannedCount,
      lastEvaluatedKey:     resp.LastEvaluatedKey || null,
    });
  } catch (err) { handleErr(res, err); }
});

// POST /dynamodb/:table/query  → query table by partition key
router.post('/dynamodb/:table/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { keyName, keyValue, keyType = 'S', indexName, limit = 50, exclusiveStartKey } = req.body || {};
    if (!keyName || keyValue === undefined)
      return res.status(400).json({ error: 'keyName and keyValue are required' });
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
    const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
    const client = new DynamoDBClient(cfg);
    const params = {
      TableName:                 req.params.table,
      KeyConditionExpression:    '#pk = :pkval',
      ExpressionAttributeNames:  { '#pk': keyName },
      ExpressionAttributeValues: marshall({ ':pkval': keyValue }),
      Limit:                     Math.min(limit, 200),
    };
    if (indexName)         params.IndexName          = indexName;
    if (exclusiveStartKey) params.ExclusiveStartKey  = exclusiveStartKey;
    const resp = await client.send(new QueryCommand(params));
    res.json({
      items:            (resp.Items || []).map(i => unmarshall(i)),
      count:            resp.Count,
      scannedCount:     resp.ScannedCount,
      lastEvaluatedKey: resp.LastEvaluatedKey || null,
    });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON ATHENA ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /athena/workgroups  → list Athena workgroups
router.get('/athena/workgroups', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, ListWorkGroupsCommand, GetWorkGroupCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const list = await client.send(new ListWorkGroupsCommand({}));
    const details = await Promise.all(
      (list.WorkGroups || []).map(wg =>
        client.send(new GetWorkGroupCommand({ WorkGroup: wg.Name })).then(r => r.WorkGroup)
      )
    );
    res.json(details.map(wg => ({
      name:           wg.Name,
      description:    wg.Description || '',
      state:          wg.State,
      creationTime:   wg.CreationTime,
      outputLocation: wg.Configuration?.ResultConfiguration?.OutputLocation,
      bytesScanned:   wg.Statistics?.TotalBytesScanned,
      queriesRun:     wg.Statistics?.TotalQueryCount,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /athena/databases  → list named query databases
router.get('/athena/databases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, ListDataCatalogsCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const resp = await client.send(new ListDataCatalogsCommand({}));
    res.json((resp.DataCatalogsSummary || []).map(c => ({
      name:        c.CatalogName,
      type:        c.Type,
      description: c.Description || '',
    })));
  } catch (err) { handleErr(res, err); }
});

// POST /athena/query  → start a query execution
router.post('/athena/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { query, workgroup, outputLocation } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query is required' });
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, StartQueryExecutionCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const resp = await client.send(new StartQueryExecutionCommand({
      QueryString: query,
      WorkGroup: workgroup || 'primary',
      ResultConfiguration: outputLocation ? { OutputLocation: outputLocation } : undefined,
    }));
    res.json({ queryExecutionId: resp.QueryExecutionId });
  } catch (err) { handleErr(res, err); }
});

// GET /athena/query/:id  → get query execution status + results
router.get('/athena/query/:id', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, GetQueryExecutionCommand, GetQueryResultsCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const exec = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: req.params.id }));
    const status = exec.QueryExecution?.Status?.State;
    let results = null;
    if (status === 'SUCCEEDED') {
      const r = await client.send(new GetQueryResultsCommand({ QueryExecutionId: req.params.id, MaxResults: 100 }));
      results = r.ResultSet;
    }
    res.json({ execution: exec.QueryExecution, results });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON CLOUDFRONT ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /cloudfront  → list CloudFront distributions
router.get('/cloudfront', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFrontClient, ListDistributionsCommand } = require('@aws-sdk/client-cloudfront');
    const client = new CloudFrontClient({ ...cfg, region: 'us-east-1' }); // CloudFront is global
    const resp = await client.send(new ListDistributionsCommand({}));
    const items = resp.DistributionList?.Items || [];
    res.json(items.map(d => ({
      id:             d.Id,
      domainName:     d.DomainName,
      status:         d.Status,
      enabled:        d.Enabled,
      priceClass:     d.PriceClass,
      comment:        d.Comment || '',
      aliases:        d.Aliases?.Items || [],
      origins:        (d.Origins?.Items || []).map(o => ({ id: o.Id, domain: o.DomainName })),
      httpVersion:    d.HttpVersion,
      isIPV6Enabled:  d.IsIPV6Enabled,
      lastModified:   d.LastModifiedTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// POST /cloudfront/:id/invalidate  → create a cache invalidation
router.post('/cloudfront/:id/invalidate', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { paths = ['/*'] } = req.body || {};
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
    const client = new CloudFrontClient({ ...cfg, region: 'us-east-1' });
    const resp = await client.send(new CreateInvalidationCommand({
      DistributionId: req.params.id,
      InvalidationBatch: {
        Paths: { Quantity: paths.length, Items: paths },
        CallerReference: `kuadashboard-${Date.now()}`,
      },
    }));
    res.json({ invalidationId: resp.Invalidation?.Id, status: resp.Invalidation?.Status });
  } catch (err) { handleErr(res, err); }
});

// GET /cloudfront/:id/config  → get full distribution config
router.get('/cloudfront/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');
    const client = new CloudFrontClient({ ...cfg, region: 'us-east-1' });
    const resp = await client.send(new GetDistributionCommand({ Id: req.params.id }));
    const dist = resp.Distribution;
    res.json({
      id:           dist.Id,
      arn:          dist.ARN,
      status:       dist.Status,
      domainName:   dist.DomainName,
      lastModified: dist.LastModifiedTime,
      config:       dist.DistributionConfig,
    });
  } catch (err) { handleErr(res, err); }
});

// GET /cloudfront/:id/stats  → CloudWatch metrics for the distribution (last 7 days)
router.get('/cloudfront/:id/stats', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
    const cw = new CloudWatchClient({ ...cfg, region: 'us-east-1' });
    const now = new Date();
    const start = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const dims = [
      { Name: 'DistributionId', Value: req.params.id },
      { Name: 'Region', Value: 'Global' },
    ];
    const period = 86400;
    const [reqData, bytesData, err4xx, err5xx] = await Promise.all([
      cw.send(new GetMetricStatisticsCommand({ Namespace: 'AWS/CloudFront', MetricName: 'Requests',         Dimensions: dims, StartTime: start, EndTime: now, Period: period, Statistics: ['Sum'] })),
      cw.send(new GetMetricStatisticsCommand({ Namespace: 'AWS/CloudFront', MetricName: 'BytesDownloaded',  Dimensions: dims, StartTime: start, EndTime: now, Period: period, Statistics: ['Sum'] })),
      cw.send(new GetMetricStatisticsCommand({ Namespace: 'AWS/CloudFront', MetricName: '4xxErrorRate',     Dimensions: dims, StartTime: start, EndTime: now, Period: period, Statistics: ['Average'] })),
      cw.send(new GetMetricStatisticsCommand({ Namespace: 'AWS/CloudFront', MetricName: '5xxErrorRate',     Dimensions: dims, StartTime: start, EndTime: now, Period: period, Statistics: ['Average'] })),
    ]);
    const sort = dp => [...dp].sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
    res.json({
      requests:       sort(reqData.Datapoints).map(dp => ({ date: dp.Timestamp, value: dp.Sum })),
      bytesDownloaded:sort(bytesData.Datapoints).map(dp => ({ date: dp.Timestamp, value: dp.Sum })),
      errorRate4xx:   sort(err4xx.Datapoints).map(dp => ({ date: dp.Timestamp, value: dp.Average })),
      errorRate5xx:   sort(err5xx.Datapoints).map(dp => ({ date: dp.Timestamp, value: dp.Average })),
    });
  } catch (err) { handleErr(res, err); }
});

// POST /cloudfront  → create a distribution from an S3 bucket
router.post('/cloudfront', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { bucketName, region, comment = '', priceClass = 'PriceClass_100', aliases = [] } = req.body || {};
    if (!bucketName || !region) return res.status(400).json({ error: 'bucketName and region are required' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFrontClient, CreateDistributionCommand } = require('@aws-sdk/client-cloudfront');
    const client = new CloudFrontClient({ ...cfg, region: 'us-east-1' });
    const originDomain = `${bucketName}.s3.${region}.amazonaws.com`;
    const distributionConfig = {
      CallerReference: `kuadashboard-${Date.now()}`,
      Comment: comment,
      Enabled: true,
      PriceClass: priceClass,
      DefaultCacheBehavior: {
        TargetOriginId: bucketName,
        ViewerProtocolPolicy: 'redirect-to-https',
        AllowedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // CachingOptimized managed policy
        Compress: true,
      },
      Origins: {
        Quantity: 1,
        Items: [{
          Id: bucketName,
          DomainName: originDomain,
          S3OriginConfig: { OriginAccessIdentity: '' },
        }],
      },
      ...(aliases.length > 0 && {
        Aliases: { Quantity: aliases.length, Items: aliases },
      }),
    };
    const resp = await client.send(new CreateDistributionCommand({ DistributionConfig: distributionConfig }));
    const dist = resp.Distribution;
    res.json({ id: dist.Id, domainName: dist.DomainName, status: dist.Status, arn: dist.ARN });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON ROUTE 53 ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /route53/zones  → list hosted zones
router.get('/route53/zones', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { Route53Client, ListHostedZonesCommand } = require('@aws-sdk/client-route-53');
    const client = new Route53Client({ ...cfg, region: 'us-east-1' });
    const resp = await client.send(new ListHostedZonesCommand({}));
    res.json((resp.HostedZones || []).map(z => ({
      id:              z.Id.split('/').pop(),
      name:            z.Name,
      recordCount:     z.ResourceRecordSetCount,
      private:         z.Config?.PrivateZone,
      comment:         z.Config?.Comment || '',
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /route53/zones/:id/records  → list records in a hosted zone
router.get('/route53/zones/:id/records', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { Route53Client, ListResourceRecordSetsCommand } = require('@aws-sdk/client-route-53');
    const client = new Route53Client({ ...cfg, region: 'us-east-1' });
    const resp = await client.send(new ListResourceRecordSetsCommand({ HostedZoneId: req.params.id }));
    res.json((resp.ResourceRecordSets || []).map(r => ({
      name:    r.Name,
      type:    r.Type,
      ttl:     r.TTL,
      records: (r.ResourceRecords || []).map(rr => rr.Value),
      alias:   r.AliasTarget ? { dnsName: r.AliasTarget.DNSName, zoneId: r.AliasTarget.HostedZoneId } : null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON COGNITO ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /cognito/userpools  → list Cognito user pools
router.get('/cognito/userpools', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, ListUserPoolsCommand, DescribeUserPoolCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const list = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }));
    const details = await Promise.all(
      (list.UserPools || []).map(p =>
        client.send(new DescribeUserPoolCommand({ UserPoolId: p.Id })).then(r => r.UserPool)
      )
    );
    res.json(details.map(p => ({
      id:             p.Id,
      name:           p.Name,
      status:         p.Status,
      userCount:      p.EstimatedNumberOfUsers,
      creationDate:   p.CreationDate,
      lastModified:   p.LastModifiedDate,
      mfaConfig:      p.MfaConfiguration,
      emailVerification: p.AutoVerifiedAttributes?.includes('email'),
      phoneVerification: p.AutoVerifiedAttributes?.includes('phone_number'),
      domain:         p.Domain || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /cognito/userpools/:id/config  → full user pool configuration
router.get('/cognito/userpools/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, DescribeUserPoolCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const resp = await client.send(new DescribeUserPoolCommand({ UserPoolId: req.params.id }));
    res.json(resp.UserPool);
  } catch (err) { handleErr(res, err); }
});

// GET /cognito/userpools/:id/users  → list users with pagination + all attributes
router.get('/cognito/userpools/:id/users', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const params = {
      UserPoolId:       req.params.id,
      Limit:            parseInt(req.query.limit || '60', 10),
      Filter:           req.query.filter || undefined,
      PaginationToken:  req.query.paginationToken || undefined,
    };
    const resp = await client.send(new ListUsersCommand(params));
    const attrMap = (attrs) => {
      const m = {};
      for (const a of (attrs || [])) m[a.Name] = a.Value;
      return m;
    };
    res.json({
      users: (resp.Users || []).map(u => ({
        username:      u.Username,
        status:        u.UserStatus,
        enabled:       u.Enabled,
        created:       u.UserCreateDate,
        modified:      u.UserLastModifiedDate,
        attributes:    attrMap(u.Attributes),
        email:         attrMap(u.Attributes)['email'] || null,
        emailVerified: attrMap(u.Attributes)['email_verified'] === 'true',
        phone:         attrMap(u.Attributes)['phone_number'] || null,
        mfaEnabled:    (u.MFAOptions || []).length > 0,
        mfaOptions:    u.MFAOptions || [],
      })),
      paginationToken: resp.PaginationToken || null,
    });
  } catch (err) { handleErr(res, err); }
});

// GET /cognito/userpools/:id/users/:username  → get single user detail + MFA
router.get('/cognito/userpools/:id/users/:username', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const resp = await client.send(new AdminGetUserCommand({
      UserPoolId: req.params.id,
      Username:   req.params.username,
    }));
    const attrMap = {};
    for (const a of (resp.UserAttributes || [])) attrMap[a.Name] = a.Value;
    res.json({
      username:       resp.Username,
      status:         resp.UserStatus,
      enabled:        resp.Enabled,
      created:        resp.UserCreateDate,
      modified:       resp.UserLastModifiedDate,
      attributes:     attrMap,
      mfaOptions:     resp.MFAOptions || [],
      preferredMfa:   resp.PreferredMfaSetting || null,
      mfaSettingList: resp.UserMFASettingList || [],
    });
  } catch (err) { handleErr(res, err); }
});

// POST /cognito/userpools/:id/users  → create user (AdminCreateUser)
router.post('/cognito/userpools/:id/users', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { username, email, phone, temporaryPassword, messageAction, suppressMessage } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username is required' });
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const userAttributes = [];
    if (email)  userAttributes.push({ Name: 'email',  Value: email });
    if (phone)  userAttributes.push({ Name: 'phone_number', Value: phone });
    const params = {
      UserPoolId:       req.params.id,
      Username:         username,
      UserAttributes:   userAttributes,
      DesiredDeliveryMediums: email ? ['EMAIL'] : [],
    };
    if (temporaryPassword) params.TemporaryPassword = temporaryPassword;
    if (messageAction === 'SUPPRESS' || suppressMessage) params.MessageAction = 'SUPPRESS';
    const resp = await client.send(new AdminCreateUserCommand(params));
    res.status(201).json({ username: resp.User?.Username, status: resp.User?.UserStatus });
  } catch (err) { handleErr(res, err); }
});

// POST /cognito/userpools/:id/users/:username/reset-password  → AdminResetUserPassword
router.post('/cognito/userpools/:id/users/:username/reset-password', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminResetUserPasswordCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminResetUserPasswordCommand({
      UserPoolId: req.params.id,
      Username:   req.params.username,
    }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// POST /cognito/userpools/:id/users/:username/set-password  → AdminSetUserPassword
router.post('/cognito/userpools/:id/users/:username/set-password', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { password, permanent = true } = req.body || {};
    if (!password) return res.status(400).json({ error: 'password is required' });
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminSetUserPasswordCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminSetUserPasswordCommand({
      UserPoolId: req.params.id,
      Username:   req.params.username,
      Password:   password,
      Permanent:  permanent,
    }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// POST /cognito/userpools/:id/users/:username/enable  → AdminEnableUser
router.post('/cognito/userpools/:id/users/:username/enable', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminEnableUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminEnableUserCommand({ UserPoolId: req.params.id, Username: req.params.username }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// POST /cognito/userpools/:id/users/:username/disable  → AdminDisableUser
router.post('/cognito/userpools/:id/users/:username/disable', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminDisableUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminDisableUserCommand({ UserPoolId: req.params.id, Username: req.params.username }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// DELETE /cognito/userpools/:id/users/:username  → AdminDeleteUser
router.delete('/cognito/userpools/:id/users/:username', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminDeleteUserCommand({ UserPoolId: req.params.id, Username: req.params.username }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// GET /cognito/userpools/:id/clients  → list app clients
router.get('/cognito/userpools/:id/clients', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, ListUserPoolClientsCommand, DescribeUserPoolClientCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const list = await client.send(new ListUserPoolClientsCommand({ UserPoolId: req.params.id }));
    // Fetch full details for each client
    const details = await Promise.all(
      (list.UserPoolClients || []).map(c =>
        client.send(new DescribeUserPoolClientCommand({ UserPoolId: req.params.id, ClientId: c.ClientId }))
          .then(r => r.UserPoolClient)
          .catch(() => c) // fallback to basic info on error
      )
    );
    res.json(details.map(c => ({
      clientId:             c.ClientId,
      clientName:           c.ClientName,
      userPoolId:           c.UserPoolId,
      lastModifiedDate:     c.LastModifiedDate,
      creationDate:         c.CreationDate,
      refreshTokenValidity: c.RefreshTokenValidity,
      accessTokenValidity:  c.AccessTokenValidity,
      idTokenValidity:      c.IdTokenValidity,
      explicitAuthFlows:    c.ExplicitAuthFlows || [],
      supportedIdentityProviders: c.SupportedIdentityProviders || [],
      callbackURLs:         c.CallbackURLs || [],
      logoutURLs:           c.LogoutURLs || [],
      allowedOAuthFlows:    c.AllowedOAuthFlows || [],
      allowedOAuthScopes:   c.AllowedOAuthScopes || [],
      allowedOAuthFlowsUserPoolClient: c.AllowedOAuthFlowsUserPoolClient,
      preventUserExistenceErrors: c.PreventUserExistenceErrors,
      enableTokenRevocation: c.EnableTokenRevocation,
      hasSecret:            !!c.ClientSecret, // never expose the actual secret
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /cognito/userpools/:id/identity-providers  → list federated IdPs
router.get('/cognito/userpools/:id/identity-providers', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, ListIdentityProvidersCommand, DescribeIdentityProviderCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const list = await client.send(new ListIdentityProvidersCommand({ UserPoolId: req.params.id }));
    const details = await Promise.all(
      (list.Providers || []).map(p =>
        client.send(new DescribeIdentityProviderCommand({ UserPoolId: req.params.id, ProviderName: p.ProviderName }))
          .then(r => r.IdentityProvider)
          .catch(() => p)
      )
    );
    res.json(details.map(p => ({
      providerName:      p.ProviderName,
      providerType:      p.ProviderType,
      status:            p.ProviderDetails?.status || 'active',
      creationDate:      p.CreationDate,
      lastModifiedDate:  p.LastModifiedDate,
      // Expose safe metadata only (not secrets)
      metadataURL:       p.ProviderDetails?.MetadataURL || null,
      issuer:            p.ProviderDetails?.oidc_issuer || p.ProviderDetails?.IDPSignout || null,
      attributeMapping:  p.AttributeMapping || {},
      idpIdentifiers:    p.IdpIdentifiers || [],
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /cognito/userpools/:id/groups  → list all groups in a user pool
router.get('/cognito/userpools/:id/groups', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, ListGroupsCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListGroupsCommand({ UserPoolId: req.params.id, Limit: 60, NextToken: nextToken }));
      all.push(...(resp.Groups || []));
      nextToken = resp.NextToken;
    } while (nextToken);
    res.json(all.map(g => ({
      name:         g.GroupName,
      description:  g.Description || '',
      precedence:   g.Precedence ?? null,
      roleArn:      g.RoleArn || null,
      lastModified: g.LastModifiedDate || null,
      createdDate:  g.CreationDate || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AWS SECRETS MANAGER ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /secrets  → list secrets (names and metadata only — no values)
router.get('/secrets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SecretsManagerClient, ListSecretsCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient(cfg);
    const resp = await client.send(new ListSecretsCommand({ MaxResults: 100 }));
    res.json((resp.SecretList || []).map(s => ({
      name:            s.Name,
      arn:             s.ARN,
      description:     s.Description || '',
      lastChanged:     s.LastChangedDate,
      lastAccessed:    s.LastAccessedDate,
      rotationEnabled: s.RotationEnabled || false,
      tags:            s.Tags || [],
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /secrets/:name/config  → get secret metadata (no value)
router.get('/secrets/:name/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SecretsManagerClient, DescribeSecretCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient(cfg);
    const resp = await client.send(new DescribeSecretCommand({ SecretId: req.params.name }));
    res.json({
      name:             resp.Name,
      arn:              resp.ARN,
      description:      resp.Description || '',
      kmsKeyId:         resp.KmsKeyId || null,
      rotationEnabled:  resp.RotationEnabled || false,
      rotationLambdaArn: resp.RotationLambdaARN || null,
      lastRotatedDate:  resp.LastRotatedDate,
      lastChangedDate:  resp.LastChangedDate,
      tags:             resp.Tags || [],
      versionIds:       Object.keys(resp.VersionIdsToStages || {}),
    });
  } catch (err) { handleErr(res, err); }
});

// GET /secrets/:name/preview-keys  → fetch secret and return key names + masked values (no full values exposed)
router.get('/secrets/:name/preview-keys', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient(cfg);
    const resp = await client.send(new GetSecretValueCommand({ SecretId: req.params.name }));
    let keys = [];
    if (resp.SecretString) {
      try {
        const parsed = JSON.parse(resp.SecretString);
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [k, v] of Object.entries(parsed)) {
            const sanitized = k.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
            if (sanitized) keys.push({ original: k, sanitized, preview: typeof v === 'string' ? v.slice(0, 4) + '***' : '[non-string]' });
          }
        } else {
          keys.push({ original: 'SECRET_VALUE', sanitized: 'SECRET_VALUE', preview: resp.SecretString.slice(0, 4) + '***' });
        }
      } catch {
        keys.push({ original: 'SECRET_VALUE', sanitized: 'SECRET_VALUE', preview: resp.SecretString.slice(0, 4) + '***' });
      }
    }
    res.json({ keys, secretName: req.params.name });
  } catch (err) { handleErr(res, err); }
});

// POST /secrets/:name/import-selected  → import only chosen keys into Env Manager profile
router.post('/secrets/:name/import-selected', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { selectedKeys, targetProfileId, targetProfileName } = req.body || {};
  if (!selectedKeys?.length) return res.status(400).json({ error: 'No keys selected' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient(cfg);
    const resp = await client.send(new GetSecretValueCommand({ SecretId: req.params.name }));
    let allParsed = {};
    if (resp.SecretString) {
      try { allParsed = JSON.parse(resp.SecretString); } catch { allParsed = { SECRET_VALUE: resp.SecretString }; }
    }
    const keys = {};
    for (const sel of selectedKeys) {
      const raw = allParsed[sel.original];
      if (raw !== undefined && typeof raw === 'string') keys[sel.sanitized] = raw;
    }
    if (!Object.keys(keys).length) return res.status(400).json({ error: 'No importable string values in selection' });
    const store = getStore();
    const secretName = req.params.name.split('/').pop();
    if (targetProfileId) {
      const existing = await store.getProfile(targetProfileId);
      if (!existing) return res.status(404).json({ error: 'Target profile not found' });
      await store.updateProfile(targetProfileId, { keys });
      res.json({ merged: true, profileId: targetProfileId, keysImported: Object.keys(keys).length });
    } else {
      const name = targetProfileName || `Secret: ${secretName}`;
      const profile = await store.createProfile({ name, provider: 'generic', category: 'Secrets Manager', keys });
      res.json({ created: true, profileId: profile.id, keysImported: Object.keys(keys).length });
    }
  } catch (err) { handleErr(res, err); }
});

// POST /secrets/:name/import-to-profile  → retrieve secret value and import into an Env Manager profile
router.post('/secrets/:name/import-to-profile', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { targetProfileId, targetProfileName } = req.body || {};
    const cfg = await resolveAwsConfig(profileId);
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient(cfg);
    const resp = await client.send(new GetSecretValueCommand({ SecretId: req.params.name }));

    // Parse secret — supports JSON key/value or plain string
    let keys = {};
    if (resp.SecretString) {
      try {
        const parsed = JSON.parse(resp.SecretString);
        if (typeof parsed === 'object' && parsed !== null) {
          // Sanitize key names
          for (const [k, v] of Object.entries(parsed)) {
            const sanitized = k.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
            if (sanitized && typeof v === 'string') keys[sanitized] = v;
          }
        } else {
          keys['SECRET_VALUE'] = resp.SecretString;
        }
      } catch {
        keys['SECRET_VALUE'] = resp.SecretString;
      }
    }

    if (!Object.keys(keys).length)
      return res.status(400).json({ error: 'Secret has no importable string values' });

    const store = getStore();
    const secretName = req.params.name.split('/').pop();

    if (targetProfileId) {
      // Merge into existing profile
      const existing = await store.getProfile(targetProfileId);
      if (!existing) return res.status(404).json({ error: 'Target profile not found' });
      await store.updateProfile(targetProfileId, { keys });
      res.json({ merged: true, profileId: targetProfileId, keysImported: Object.keys(keys).length });
    } else {
      // Create new generic profile from the secret
      const name = targetProfileName || `Secret: ${secretName}`;
      const profile = await store.createProfile({ name, provider: 'generic', category: 'Secrets Manager', keys });
      res.json({ created: true, profileId: profile.id, keysImported: Object.keys(keys).length });
    }
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── AMAZON DATA PIPELINE ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /datapipeline  → list Data Pipeline pipelines
router.get('/datapipeline', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DataPipelineClient, ListPipelinesCommand, DescribePipelinesCommand } = require('@aws-sdk/client-data-pipeline');
    const client = new DataPipelineClient(cfg);
    const list = await client.send(new ListPipelinesCommand({}));
    const ids = (list.pipelineIdList || []).map(p => p.id);
    if (!ids.length) return res.json([]);
    const desc = await client.send(new DescribePipelinesCommand({ pipelineIds: ids }));
    res.json((desc.pipelineDescriptionList || []).map(p => {
      const fields = {};
      for (const f of (p.fields || [])) fields[f.key] = f.stringValue || f.refValue;
      return {
        id:          p.pipelineId,
        name:        p.name,
        description: p.description || '',
        state:       fields['@pipelineState'] || 'UNKNOWN',
        createdBy:   fields['@createdBy'],
        creationTime: fields['@creationTime'],
        latestRunTime: fields['@latestRunTime'],
        nextRunTime:  fields['@nextRunTime'],
      };
    }));
  } catch (err) { handleErr(res, err); }
});

// POST /datapipeline/:id/activate  → activate a pipeline
router.post('/datapipeline/:id/activate', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DataPipelineClient, ActivatePipelineCommand } = require('@aws-sdk/client-data-pipeline');
    const client = new DataPipelineClient(cfg);
    await client.send(new ActivatePipelineCommand({ pipelineId: req.params.id }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// POST /datapipeline/:id/deactivate  → deactivate a pipeline
router.post('/datapipeline/:id/deactivate', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { DataPipelineClient, DeactivatePipelineCommand } = require('@aws-sdk/client-data-pipeline');
    const client = new DataPipelineClient(cfg);
    await client.send(new DeactivatePipelineCommand({ pipelineId: req.params.id, cancelActive: req.body?.cancelActive ?? true }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /bedrock ────────────────────────────────────────────────────────────

router.get('/bedrock', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
    const client = new BedrockClient(cfg);
    const resp = await client.send(new ListFoundationModelsCommand({}));
    res.json((resp.modelSummaries || []).map(m => ({
      modelId:         m.modelId,
      modelName:       m.modelName,
      providerName:    m.providerName,
      inputModalities: m.inputModalities || [],
      outputModalities:m.outputModalities || [],
      responseStreamingSupported: !!m.responseStreamingSupported,
      customizationsSupported: m.customizationsSupported || [],
      inferenceTypesSupported: m.inferenceTypesSupported || [],
      lifecycleStatus: m.modelLifecycle?.status || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lex ────────────────────────────────────────────────────────────────

router.get('/lex', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LexModelsV2Client, ListBotsCommand } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListBotsCommand({ maxResults: 50, nextToken }));
      all.push(...(resp.botSummaries || []));
      nextToken = resp.nextToken;
    } while (nextToken);

    res.json(all.map(b => ({
      id:           b.botId,
      name:         b.botName,
      status:       b.botStatus,
      description:  b.description || '',
      latestVersion:b.latestBotVersion || null,
      createdDate:  b.creationDateTime || null,
      updatedDate:  b.lastUpdatedDateTime || null,
      idleSessionTtlInSeconds: b.idleSessionTTLInSeconds ?? null,
      roleArn:      b.botRoleArn || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /cloudformation/stacks ──────────────────────────────────────────────

router.get('/cloudformation/stacks', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, ListStacksCommand } = require('@aws-sdk/client-cloudformation');
    const client = new CloudFormationClient(cfg);
    const statuses = [
      'CREATE_IN_PROGRESS', 'CREATE_COMPLETE', 'CREATE_FAILED',
      'ROLLBACK_IN_PROGRESS', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED',
      'DELETE_IN_PROGRESS', 'DELETE_FAILED',
      'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_COMPLETE',
      'UPDATE_FAILED', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED',
      'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE',
      'REVIEW_IN_PROGRESS',
      'IMPORT_IN_PROGRESS', 'IMPORT_COMPLETE', 'IMPORT_ROLLBACK_IN_PROGRESS', 'IMPORT_ROLLBACK_FAILED', 'IMPORT_ROLLBACK_COMPLETE',
    ];

    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListStacksCommand({ StackStatusFilter: statuses, NextToken: nextToken }));
      all.push(...(resp.StackSummaries || []));
      nextToken = resp.NextToken;
    } while (nextToken);

    const agentCoreOnly = String(req.query.agentCoreOnly || 'false').toLowerCase() === 'true';
    const mapped = all.map(s => {
      const name = s.StackName || '';
      const isAgentCore = /agent\s*core|agentcore/i.test(name);
      return {
        id:           s.StackId,
        name,
        status:       s.StackStatus,
        statusReason: s.StackStatusReason || null,
        createdTime:  s.CreationTime || null,
        updatedTime:  s.LastUpdatedTime || null,
        templateDescription: s.TemplateDescription || null,
        isAgentCore,
      };
    });

    res.json(agentCoreOnly ? mapped.filter(s => s.isAgentCore) : mapped);
  } catch (err) { handleErr(res, err); }
});

module.exports = router;


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
 *
 * NOTE: AWS SDK v3 packages are lazy-required. Install them with:
 *   npm install @aws-sdk/client-ec2 @aws-sdk/client-eks @aws-sdk/client-ecs @aws-sdk/credential-providers
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

module.exports = router;

Warning: truncated output (original token count: 83859)
Total output lines: 6935

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
 *   GET  /overview                          → account, identity, region and resources per service
 *   GET  /overview/insights                 → costs (cached 12h), Lambda activity, services outside KUA
 *   GET  /cloudwatch/log-scans               → background scans (≤ 5 days) into the local log cache
 *   POST /cloudwatch/log-scans               → start a scan; /:id/pause|resume|cancel, DELETE /:id
 *   GET  /overview/advisor                  → good-practice checks (security, infra, architecture, development)
 *   GET  /cloudwatch/dashboards             → CloudWatch dashboards with console links
 *   GET  /cloudwatch/dashboards/:name       → dashboard definition and widget summary
 *   GET  /cloudwatch/dashboards/:name/widgets/:index/metrics       → series of a metric widget
 *   GET  /cloudwatch/dashboards/:name/widgets/:index/alarms        → states of an alarm widget
 *   GET  /cloudwatch/dashboards/:name/widgets/:index/logs/estimate → bytes a log widget would scan
 *   POST /cloudwatch/dashboards/:name/widgets/:index/logs/query    → start a log widget's Logs Insights query
 *   GET  /cloudwatch/logs-query/:queryId                           → Logs Insights query status and results
 *   GET  /account                           → account ID and region of the profile (STS, free; cached 1 h)
 *   GET  /eks                               → list EKS clusters
 *   GET  /elb                               → load balancers (ALB/NLB/GWLB/Classic) with listeners and target health
 *   GET  /public-endpoints                  → public Route53 → CloudFront/load balancer/backend chains
 *   GET  /elb/detail?arn=|name=             → listener rules, attributes and tags of one load balancer
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
 *   GET  /rds                               → list RDS instances
 *   GET  /logs/lambda/:name                 → CloudWatch logs for a Lambda function
 *   POST /lambda/activity                   → 24h invocations/errors and log group state per function
 *   POST /stepfunctions/activity            → 24h executions and logging settings per state machine
 *   GET  /sqs                               → SQS queues with attributes, DLQ and redrive
 *   POST /sqs/activity                      → 24h sent/received/deleted per queue
 *   GET  /sqs/:name/metrics                 → hourly 24h metrics of one queue
 *   GET  /sns                               → SNS topics, subscriptions and delivery status logging
 *   POST /sns/activity                      → 24h published/delivered/failed and log groups per topic
 *   GET  /sns/:name/metrics                 → hourly 24h metrics of one topic
 *   GET  /ses                               → SES account, identities and configuration sets
 *   GET  /ses/metrics                       → hourly account sending metrics (?hours=24|168|720), health
 *   GET  /sqs/:name/details                 → queue config, policy, tags, Lambda consumers, SNS producers
 *   GET  /sns/:name/details                 → topic policies, tags, subscriptions with filters and DLQs
 *   GET  /sns/:name/logs                    → delivery status log events (success/failure)
 *   GET  /ses/suppression                   → account suppression list
 *   GET  /ses/configuration-sets/:name/metrics → event metrics from a CloudWatch event destination
 *   GET  /metrics/history                   → stored metric history (no AWS calls)
 *   GET  /logs/ecs/:cluster/:service        → CloudWatch logs for an ECS service
 *
 * NOTE: AWS SDK v3 packages are lazy-required. Install them with:
 *   npm install @aws-sdk/client-ec2 @aws-sdk/client-eks @aws-sdk/client-ecs \
 *               @aws-sdk/client-lambda @aws-sdk/client-api-gateway \
 *               @aws-sdk/client-apigatewayv2 @aws-sdk/client-cloudwatch-logs \
 *               @aws-sdk/credential-providers
 */

const express      = require('express');
function lexLogGroupName(value) {
  const raw = String(value || '');
  const marker = ':log-group:';
  const markerIndex = raw.indexOf(marker);
  const name = markerIndex >= 0 ? raw.slice(markerIndex + marker.length).replace(/:\*$/, '') : raw;
  return name.startsWith('/') ? name : null;
}

function requestedLexBotVersion(value) {
  const version = String(value || 'DRAFT');
  return /^(?:DRAFT|[0-9]+)$/.test(version) ? version : null;
}

async function lexConversationLogGroups(client, commands, botId, aliasId, { logClient, DescribeLogGroupsCommand } = {}) {
  const groups = new Map();
  const add = (arn, alias = {}) => {
    const name = lexLogGroupName(arn);
    if (!name) return;
    const current = groups.get(name) || { name, aliasId: null, aliasName: null, botVersion: null };
    groups.set(name, {
      ...current,
      aliasId: alias.aliasId || current.aliasId,
      aliasName: alias.aliasName || current.aliasName,
      botVersion: alias.botVersion || current.botVersion,
    });
  };

  const aliases = [];
  if (aliasId && aliasId !== 'TSTALIASID') {
    aliases.push({ botAliasId: aliasId });
  } else {
    let nextToken;
    do {
      const response = await client.send(new commands.ListBotAliasesCommand({ botId, maxResults: 100, nextToken }));
      aliases.push(...(response.botAliasSummaries || []));
      nextToken = response.nextToken;
    } while (nextToken);
  }

  await Promise.all(aliases.map(async alias => {
    try {
      const detail = await client.send(new commands.DescribeBotAliasCommand({ botId, botAliasId: alias.botAliasId }));
      const settings = detail.conversationLogSettings?.textLogSettings || [];
      settings.forEach(setting => add(setting.destination?.cloudWatch?.logGroupArn, {
        aliasId: alias.botAliasId,
        aliasName: detail.botAliasName || alias.botAliasName,
        botVersion: detail.botVersion || alias.botVersion,
      }));
    } catch (_) { /* an unavailable alias should not hide other aliases */ }
  }));

  if (!groups.size && logClient && DescribeLogGroupsCommand) {
    let nextToken;
    let pages = 0;
    do {
      const response = await logClient.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: '/aws/lex/', nextToken }));
      for (const group of response.logGroups || []) {
        if (group.logGroupName?.includes(botId)) add(group.logGroupName);
      }
      nextToken = response.nextToken;
      pages += 1;
    } while (nextToken && pages < 10);
  }
  return [...groups.values()];
}

async function collectLexLogEvents(client, FilterLogEventsCommand, groups, { startTime, limit, filterPattern } = {}) {
  const results = await Promise.all(groups.map(async group => {
    const events = [];
    let nextToken;
    let previousToken;
    do {
      const response = await client.send(new FilterLogEventsCommand({
        logGroupName: group.name,
        startTime,
        endTime: Date.now(),
        limit: Math.min(limit, 10000),
        nextToken,
        ...(filterPattern ? { filterPattern } : {}),
      }));
      for (const event of response.events || []) {
        let parsed = null;
        try { parsed = JSON.parse(event.message); } catch (_) {}
        events.push({
          timestamp: event.timestamp,
          stream: event.logStreamName,
          logGroup: group.name,
          aliasId: group.aliasId || null,
          aliasName: group.aliasName || null,
          botVersion: group.botVersion || null,
          message: event.message,
          parsed,
        });
      }
      previousToken = nextToken;
      nextToken = response.nextToken;
    } while (nextToken && nextToken !== previousToken && events.length < limit);
    return events;
  }));
  return results.flat().sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, limit);
}

const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const crypto       = require('crypto');
const { getStore } = require('../lib/credentialStore');
const auditLog     = require('../lib/auditLog');
const { getApmDatabase } = require('../lib/apm/database');
const { captureLambdaCloudWatchMetrics, captureLambdaLogEvents } = require('../lib/apm/opportunisticCapture');
const { readLocalAwsProfiles, resolveAwsConfig } = require('../lib/awsProfileResolver');
const { finalizeAdvisor, scopeKeys, getPostureStore } = require('../lib/advisor/posture');
const { teamScopeOf } = require('../lib/advisor/teamAcceptances');
const {
  GROUP_DIMENSIONS,
  METRIC_DEFINITIONS,
  aggregateMetricResults,
  buildMetricQueries,
} = require('../lib/eksObservability');
const { describeNodegroups, getEksDetails, summarizeClusters } = require('../lib/eksInfrastructure');
const { buildAwsOverview } = require('../lib/awsOverview');
const { validLambdaFunctions, validStateMachines, lambdaActivity, stepFunctionsActivity } = require('../lib/awsActivity');
const {
  QUEUE_NAME_RE, TOPIC_NAME_RE, QUEUE_URL_RE, TOPIC_ARN_RE, SET_NAME_RE, validHours, seriesTotals, latestRates,
  listSqsQueues, validQueueNames, sqsActivity, sqsQueueSeries, sqsQueueDetails,
  listSnsTopics, validTopics, snsActivity, snsTopicSeries, snsTopicDetails, snsDeliveryLogs,
  sesOverview, sesSeries, sesSuppression, sesConfigurationSetMetrics,
} = require('../lib/awsMessaging');
const { sesHealth } = require('../lib/awsMessagingCatalog');
const { listLoadBalancers, describeLoadBalancer } = require('../lib/awsLoadBalancers');
const { getMetricHistory } = require('../lib/metricHistory');
const { getCloudHistory } = require('../lib/cloudHistory');
const { classifyAwsError, buildAccessRequest } = require('../lib/awsAccess');
const { countExecutions } = require('../lib/awsStepFnCounts');
const { loadLambdaTags, tagsFor } = require('../lib/awsLambdaTags');
const { buildAwsInsights, createCostCache } = require('../lib/awsInsights');
const { buildAwsAdvisor, collectS3Advisor } = require('../lib/advisor/aws');
const { dashboardConsoleUrl, summarizeDashboard } = require('../lib/cloudwatchDashboards');
const {
  dashboardRangeSeconds, fetchMetricWidget, fetchAlarmWidget, splitLogQuery, logGroupIdentifier, logGroupName,
  estimateLogScan, normalizeQueryResults,
} = require('../lib/cloudwatchDashboardData');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleErr(res, err) {
  console.error('[aws]', err.message);
  let status  = err.$metadata?.httpStatusCode || 500;
  let message = err.message;
  // Temporary credentials (STS / IAM Identity Center) expire after a few hours —
  // surface a clear, actionable message instead of the raw SDK error.
  if (/ExpiredToken|expired/i.test(err.name || '') || /security token.*expired/i.test(message)) {
    status  = 401;
    message = 'AWS session credentials have expired. Refresh them (e.g. "aws sso login" or re-copy from IAM Identity Center) and update the profile.';
  } else if (/UnrecognizedClientException|InvalidClientTokenId/.test(err.name || '')) {
    message = `${message} — if you are using temporary credentials (key starts with "ASIA"), make sure the profile also includes AWS_SESSION_TOKEN.`;
  } else {
    // Permission errors carry the IAM actions to request (see lib/awsAccess.js).
    const classified = classifyAwsError(err);
    if (classified.kind === 'denied') {
      const req = res.req;
      const route = req?.route?.path ? `${req.method} ${req.route.path}` : null;
      const account = classified.principal?.match(/^arn:[^:]+:(?:iam|sts)::(\d+):/)?.[1] || null;
      return res.status(403).json({ error: message, code: 'AccessDenied', access: buildAccessRequest({ error: classified, route, account }) });
    }
  }
  res.status(status).json({ error: message });
}

function cloudHistory() {
  try { return getCloudHistory(); } catch (err) { console.warn('[cloud-history]', err.message); return null; }
}

// The AWS account of a profile (STS GetCallerIdentity, free), for decisions a KUA team shares
// on that account (lib/advisor/teamAcceptances.js). Cached an hour; unknown when STS fails.
const accountIds = new Map();
async function awsAccountId(profileId, cfg) {
  const cached = accountIds.get(profileId);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.id;
  try {
    const { callerIdentity } = require('../lib/awsOverview');
    const id = (await callerIdentity(cfg)).account || null;
    accountIds.set(profileId, { id, at: Date.now() });
    return id;
  } catch { return cached?.id || null; }
}

// Advisor acceptances and history; without them the report is still answered (gated).
function postureStore() {
  try { return getPostureStore(); } catch (err) { console.warn('[advisor] posture:', err.message); return null; }
}

function awsRegionFromArn(arn) {
  const match = String(arn || '').match(/^arn:[^:]+:[^:]+:([^:]*):/);
  return match?.[1] || '';
}

function readCloudSnapshot({ profileId, region = '', resourceKey, kind, allowExpired = false }) {
  const history = cloudHistory();
  return history?.readLatest({ provider: 'aws', profileId, region, resourceKey, kind, allowExpired }) || null;
}

function readCloudRange({ profileId, region = '', resourceKey, kind, from, to, limit = 500 }) {
  const history = cloudHistory();
  return history?.readRange({ provider: 'aws', profileId, region, resourceKey, kind, from, to, limit }) || [];
}

function writeCloudSnapshot({ profileId, region = '', resourceKey, kind, payload, metadata = {}, ttlMs }) {
  const history = cloudHistory();
  if (!history) return null;
  try {
    return history.putSnapshot({ provider: 'aws', profileId, region, resourceKey, kind, payload, metadata, ttlMs });
  } catch (err) {
    console.warn('[cloud-history] write:', err.message);
    return null;
  }
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

function isLoopbackAddress(remote = '') {
  return remote === '127.0.0.1' ||
         remote === '::1' ||
         remote === '::ffff:127.0.0.1';
}

function requireLocalRequest(req, res, next) {
  const remote = req.socket?.remoteAddress || '';
  if (!isLoopbackAddress(remote)) {
    return res.status(403).json({
      error: 'This endpoint is only available from localhost for security reasons.',
    });
  }
  next();
}

// Local workstation profile discovery and browser SSO bootstrap should not be
// accessible from non-local network clients.
router.use('/local-profiles', requireLocalRequest);
router.use('/sso', requireLocalRequest);

// ─── IAM Identity Center (SSO) device-authorization login ────────────────────
//
// Implements the same browser-based flow the AWS CLI uses for "aws sso login":
//   GET  /sso/local-profiles → SSO profiles detected in ~/.aws/config
//   POST /sso/start          → register OIDC client + start device authorization;
//                              returns the verification URL to open in a browser
//   POST /sso/poll           → poll until the user approves in the browser
//   GET  /sso/accounts       → accounts + roles visible to the authorized session
//   POST /sso/credentials    → exchange the SSO token for role credentials
//                              (access key / secret / session token / expiration)
//
// Pending login sessions live in memory only and die with the device code (~10 min).

const ssoLoginSessions = new Map(); // sessionId → { region, clientId, clientSecret, deviceCode, accessToken, expiresAt }

function gcSsoSessions() {
  for (const [id, s] of ssoLoginSessions) if (Date.now() > s.expiresAt) ssoLoginSessions.delete(id);
}

/** Parse ~/.aws/config into raw sections: { "profile x": {...}, "sso-session y": {...} } */
function parseAwsConfigSections() {
  const cfgFile  = path.join(os.homedir(), '.aws', 'config');
  const sections = {};
  if (!fs.existsSync(cfgFile)) return sections;
  let current = null;
  for (const raw of fs.readFileSync(cfgFile, 'utf8').split('\n')) {
    const line = raw.trim();
    const m = line.match(/^\[([^\]]+)\]$/);
    if (m) { current = m[1]; sections[current] = sections[current] || {}; continue; }
    if (!current) continue;
    const kv = line.match(/^([\w.]+)\s*=\s*(.+)$/);
    if (kv) sections[current][kv[1].toLowerCase()] = kv[2].trim();
  }
  return sections;
}

router.get('/sso/local-profiles', (_req, res) => {
  try {
    const sections = parseAwsConfigSections();
    const out = [];
    for (const [section, data] of Object.entries(sections)) {
      if (section.startsWith('sso-session ')) continue;
      const name = section.replace(/^profile\s+/, '');
      // Modern profiles reference an [sso-session] block; legacy ones inline sso_start_url
      const sess      = data.sso_session ? (sections[`sso-session ${data.sso_session}`] || {}) : {};
      const startUrl  = data.sso_start_url || sess.sso_start_url;
      const ssoRegion = data.sso_region    || sess.sso_region;
      if (!startUrl) continue;
      out.push({
        name,
        startUrl,
        ssoRegion: ssoRegion || 'us-east-1',
        accountId: data.sso_account_id || '',
        roleName:  data.sso_role_name  || '',
        region:    data.region || 'us-east-1',
      });
    }
    res.json(out);
  } catch (err) { handleErr(res, err); }
});

router.post('/sso/start', async (req, res) => {
  try {
    const { startUrl, ssoRegion } = req.body || {};
    if (!startUrl) return res.status(400).json({ error: 'startUrl is required' });
    const region = ssoRegion || 'us-east-1';
    const { SSOOIDCClient, RegisterClientCommand, StartDeviceAuthorizationCommand } =
      require('@aws-sdk/client-sso-oidc');
    const oidc = new SSOOIDCClient({ region });
    const reg  = await oidc.send(new RegisterClientCommand({
      clientName: 'kuadashboard', clientType: 'public',
    }));
    const auth = await oidc.send(new StartDeviceAuthorizationCommand({
      clientId: reg.clientId, clientSecret: reg.clientSecret, startUrl,
    }));
    gcSsoSessions();
    const sessionId = crypto.randomUUID();
    ssoLoginSessions.set(sessionId, {
      region,
      clientId:     reg.clientId,
      clientSecret: reg.clientSecret,
      deviceCode:   auth.deviceCode,
      expiresAt:    Date.now() + (auth.expiresIn || 600) * 1000,
    });
    auditLog.log({
      category: 'aws', action: 'SSO device authorization started', resource: startUrl,
    });
    res.json({
      sessionId,
      verificationUri:         auth.verificationUri,
      verificationUriComplete: auth.verificationUriComplete,
      userCode:                auth.userCode,
      expiresIn:               auth.expiresIn,
      interval:                auth.interval || 5,
    });
  } catch (err) { handleErr(res, err); }
});

router.post('/sso/poll', async (req, res) => {
  try {
    const sess = ssoLoginSessions.get(req.body?.sessionId);
    if (!sess) return res.status(404).json({ error: 'SSO login session not found or expired — start again' });
    if (sess.accessToken) return res.json({ status: 'authorized' });
    const { SSOOIDCClient, CreateTokenCommand } = require('@aws-sdk/client-sso-oidc');
    const oidc = new SSOOIDCClient({ region: sess.region });
    try {
      const tok = await oidc.send(new CreateTokenCommand({
        clientId:     sess.clientId,
        clientSecret: sess.clientSecret,
        grantType:    'urn:ietf:params:oauth:grant-type:device_code',
        deviceCode:   sess.deviceCode,
      }));
      sess.accessToken = tok.accessToken;
      return res.json({ status: 'authorized' });
    } catch (e) {
      if (e.name === 'AuthorizationPendingException' || e.name === 'SlowDownException')
        return res.json({ status: 'pending' });
      if (e.name === 'ExpiredTokenException')  { ssoLoginSessions.delete(req.body.sessionId); return res.json({ status: 'expired' }); }
      if (e.name === 'AccessDeniedException')  { ssoLoginSessions.delete(req.body.sessionId); return res.json({ status: 'denied' }); }
      throw e;
    }
  } catch (err) { handleErr(res, err); }
});

router.get('/sso/accounts', async (req, res) => {
  try {
    const sess = ssoLoginSessions.get(req.query.sessionId);
    if (!sess?.accessToken) return res.status(400).json({ error: 'SSO session not authorized yet' });
    const { SSOClient, ListAccountsCommand, ListAccountRolesCommand } = require('@aws-sdk/client-sso');
    const sso = new SSOClient({ region: sess.region });
    const accounts = [];
    let nextToken;
    do {
      const page = await sso.send(new ListAccountsCommand({ accessToken: sess.accessToken, nextToken }));
      accounts.push(...(page.accountList || []));
      nextToken = page.nextToken;
    } while (nextToken);
    const out = [];
    for (const acc of accounts) {
      const roles = [];
      let roleToken;
      do {
        const page = await sso.send(new ListAccountRolesCommand({
          accessToken: sess.accessToken, accountId: acc.accountId, nextToken: roleToken,
        }));
        roles.push(...(page.roleList || []).map(r => r.roleName));
        roleToken = page.nextToken;
      } while (roleToken);
      out.push({ accountId: acc.accountId, accountName: acc.accountName, email: acc.emailAddress, roles });
    }
    res.json(out);
  } catch (err) { handleErr(res, err); }
});

router.post('/sso/credentials', async (req, res) => {
  try {
    const { sessionId, accountId, roleName } = req.body || {};
    const sess = ssoLoginSessions.get(sessionId);
    if (!sess?.accessToken) return res.status(400).json({ error: 'SSO session not authorized yet' });
    if (!accountId || !roleName) return res.status(400).json({ error: 'accountId and roleName are required' });
    const { SSOClient, GetRoleCredentialsCommand } = require('@aws-sdk/client-sso');
    const sso = new SSOClient({ region: sess.region });
    const out = await sso.send(new GetRoleCredentialsCommand({
      accessToken: sess.accessToken, accountId, roleName,
    }));
    const c = out.roleCredentials || {};
    auditLog.log({
      category: 'aws', action: 'SSO role credentials issued', resource: `${accountId}/${roleName}`,
    });
    res.json({
      accessKeyId:     c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      sessionToken:    c.sessionToken,
      expiration:      c.expiration,   // epoch milliseconds
    });
  } catch (err) { handleErr(res, err); }
});

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

// ─── GET /overview ────────────────────────────────────────────────────────────
// Environment summary for the active profile. Only the caller identity is
// required; alias, regions and every service count degrade on their own.

router.get('/overview', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    res.json(await buildAwsOverview(cfg, { profile: { id: profileId } }));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /overview/insights ───────────────────────────────────────────────────
// Costs, Lambda activity and services outside KUA. Cost Explorer bills every
// request, so costs are cached per profile (12h by default, ?costCacheHours=
// overrides it); ?refreshCosts=1 forces it.

const costCache = createCostCache();

router.get('/overview/insights', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    // ?costCacheHours= comes from Options (1–168 h); anything else keeps the 12h default.
    const hours = Number(req.query.costCacheHours);
    const costTtlMs = Number.isFinite(hours) && hours >= 1 && hours <= 168 ? hours * 3600 * 1000 : undefined;
    res.json(await buildAwsInsights(cfg, { cache: costCache, cacheKey: profileId, refreshCosts: req.query.refreshCosts === '1', costTtlMs }));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /overview/advisor ────────────────────────────────────────────────────
// Good-practice checks from free control-plane APIs (IAM credential report,
// CloudTrail, EC2/RDS/EKS Describe, Lambda List). Cached 15 min per profile
// and region to keep the overview fast; ?refresh=1 forces a new scan.

const ADVISOR_TTL_MS = 15 * 60 * 1000;
const advisorCache = new Map();
const S3_ADVISOR_TTL_MS = 15 * 60 * 1000;
const s3AdvisorCache = new Map();

function s3AdvisorResponse(profileId, cached, fresh = false) {
  const teamScope = teamScopeOf('aws', { accountId: cached.accountId });
  const posture = { scopes: scopeKeys('aws', { profileId, region: 'global', teamScope }), store: postureStore() };
  return { ...cached.result, report: finalizeAdvisor(cached.report, { ...posture, fresh }) };
}

router.get('/overview/advisor', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const key = `${profileId}|${cfg.region || ''}`;
    // Acceptances apply on every answer (also cached ones); history records fresh scans only.
    const teamScope = teamScopeOf('aws', { accountId: await awsAccountId(profileId, cfg) });
    const posture = { scopes: scopeKeys('aws', { profileId, region: cfg.region || '', teamScope }), store: postureStore() };
    const cached = advisorCache.get(key);
    if (cached && req.query.refresh !== '1' && Date.now() - cached.at < ADVISOR_TTL_MS) {
      return res.json({ ...finalizeAdvisor(cached.report, { ...posture, fresh: false }), fromCache: true });
    }
    const report = await buildAwsAdvisor(cfg);
    advisorCache.set(key, { at: Date.now(), report });
    res.json({ ...finalizeAdvisor(report, posture), fromCache: false });
  } catch (err) { handleErr(res, err); }
});

router.get('/overview/advisor/s3', (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const cached = s3AdvisorCache.get(profileId);
  if (!cached || Date.now() - cached.at >= S3_ADVISOR_TTL_MS) return res.json({ report: null, cached: false });
  res.json({ ...s3AdvisorResponse(profileId, cached), cached: true });
});

router.post('/overview/advisor/s3', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const expectedBucketCount = Number(req.body?.expectedBucketCount);
  if (req.body?.confirmed !== true || !Number.isInteger(expectedBucketCount) || expectedBucketCount < 0) {
    return res.status(400).json({ error: 'Explicit confirmation and a valid expectedBucketCount are required' });
  }
  const cached = s3AdvisorCache.get(profileId);
  if (cached && !req.body?.refresh && Date.now() - cached.at < S3_ADVISOR_TTL_MS) {
    return res.json({ ...s3AdvisorResponse(profileId, cached), cached: true });
  }
  try {
    const cfg = await resolveAwsConfig(profileId);
    const accountId = await awsAccountId(profileId, cfg);
    const collection = await collectS3Advisor(cfg, { accountId, expectedBucketCount });
    if (collection.inventoryChanged) {
      return res.status(409).json({ error: 'S3 bucket inventory changed or could not be read completely; review the updated estimate before scanning', ...collection });
    }
    const { report, ...result } = collection;
    if (s3AdvisorCache.size >= 500) s3AdvisorCache.delete(s3AdvisorCache.keys().next().value);
    const entry = { at: Date.now(), accountId, report, result };
    s3AdvisorCache.set(profileId, entry);
    res.json(s3AdvisorResponse(profileId, entry, true));
  } catch (err) { handleErr(res, err); }
});

// ─── CloudWatch dashboards ────────────────────────────────────────────────────

router.get('/cloudwatch/dashboards', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, ListDashboardsCommand } = require('@aws-sdk/client-cloudwatch');
    const client = new CloudWatchClient(cfg);
    const dashboards = [];
    let token;
    do {
      const resp = await client.send(new ListDashboardsCommand({ NextToken: token }));
      dashboards.push(...(resp.DashboardEntries || []));
      token = resp.NextToken;
    } while (token);
    res.json(dashboards.map(d => ({
      name: d.DashboardName,
      arn: d.DashboardArn,
      lastModified: d.LastModified,
      size: d.Size,
      consoleUrl: dashboardConsoleUrl(cfg.region, d.DashboardName),
    })));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/dashboards/:name', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetDashboardCommand } = require('@aws-sdk/client-cloudwatch');
    const resp = await new CloudWatchClient(cfg).send(new GetDashboardCommand({ DashboardName: req.params.name }));
    let body = null;
    try { body = JSON.parse(resp.DashboardBody || '{}'); } catch { /* keep the raw text */ }
    res.json({
      name: resp.DashboardName,
      arn: resp.DashboardArn,
      consoleUrl: dashboardConsoleUrl(cfg.region, resp.DashboardName),
      body,
      rawBody: body ? null : resp.DashboardBody,
      region: cfg.region,
      defaultRangeSeconds: dashboardRangeSeconds(body || {}),
      summary: summarizeDashboard(resp.DashboardBody, { defaultRegion: cfg.region }),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── Dashboard widget data ───────────────────────────────────────────────────
// The client names a dashboard and a widget index; queries are always built
// from the definition stored in AWS. Definitions are cached briefly because a
// dashboard loads all its widgets at once.

const DASHBOARD_CACHE_MS = 60 * 1000;
const dashboardBodies = new Map();
const MAX_RANGE_MS = 455 * 86400 * 1000; // CloudWatch keeps metrics for 15 months
const REGION_RE = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

async function dashboardWidget(profileId, cfg, name, index) {
  const key = `${profileId}\u0000${name}`;
  let entry = dashboardBodies.get(key);
  if (!entry || Date.now() - entry.at > DASHBOARD_CACHE_MS) {
    const { CloudWatchClient, GetDashboardCommand } = require('@aws-sdk/client-cloudwatch');
    const resp = await new CloudWatchClient(cfg).send(new GetDashboardCommand({ DashboardName: name }));
    entry = { at: Date.now(), body: JSON.parse(resp.DashboardBody || '{}') };
    dashboardBodies.set(key, entry);
  }
  const widget = (entry.body.widgets || [])[Number(index)];
  if (!widget) throw Object.assign(new Error(`Widget ${index} not found in dashboard ${name}`), { $metadata: { httpStatusCode: 404 } });
  return widget;
}

function timeRange(source) {
  const now = Date.now();
  const end = Number(source.end) || now;
  const start = Number(source.start) || end - 3 * 3600 * 1000;
  if (!(end > start) || end - start > MAX_RANGE_MS || end > now + 3600 * 1000) {
    throw Object.assign(new Error('Invalid time range'), { $metadata: { httpStatusCode: 400 } });
  }
  return { start, end };
}

const widgetRegion = (widget, cfg) => widget.properties?.region || cfg.region;

router.get('/cloudwatch/dashboards/:name/widgets/:index/metrics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const widget = await dashboardWidget(profileId, cfg, req.params.name, req.params.index);
    const { start, end } = timeRange(req.query);
    const { CloudWatchClient, GetMetricDataCommand, DescribeAlarmsCommand } = require('@aws-sdk/client-cloudwatch');
    const client = new CloudWatchClient({ ...cfg, region: widgetRegion(widget, cfg) });
    res.json(await fetchMetricWidget(widget, { client, commands: { GetMetricDataCommand, DescribeAlarmsCommand }, start, end }));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/dashboards/:name/widgets/:index/alarms', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const widget = await dashboardWidget(profileId, cfg, req.params.name, req.params.index);
    const { CloudWatchClient, DescribeAlarmsCommand } = require('@aws-sdk/client-cloudwatch');
    const client = new CloudWatchClient({ ...cfg, region: widgetRegion(widget, cfg) });
    res.json(await fetchAlarmWidget(widget, { client, commands: { DescribeAlarmsCommand } }));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/dashboards/:name/widgets/:index/logs/estimate', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const widget = await dashboardWidget(profileId, cfg, req.params.name, req.params.index);
    const { start, end } = timeRange(req.query);
    const { logGroups } = splitLogQuery(widget.properties?.query);
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const client = new CloudWatchLogsClient({ ...cfg, region: widgetRegion(widget, cfg) });
    // SOURCE may be an ARN; DescribeLogGroups only takes the name. Groups of other
    // accounts are not found here, which leaves the estimate unknown.
    const groups = await Promise.all(logGroups.map(async source => {
      const name = logGroupName(source);
      const resp = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: name, limit: 5 }));
      const group = (resp.logGroups || []).find(g => g.logGroupName === name);
      return group
        ? { name, found: true, storedBytes: group.storedBytes, retentionInDays: group.retentionInDays, creationTime: group.creationTime }
        : { name, found: false };
    }));
    res.json(estimateLogScan(groups, (end - start) / 1000));
  } catch (err) { handleErr(res, err); }
});

router.post('/cloudwatch/dashboards/:name/widgets/:index/logs/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const widget = await dashboardWidget(profileId, cfg, req.params.name, req.params.index);
    const { start, end } = timeRange(req.body || {});
    const { logGroups, queryString } = splitLogQuery(widget.properties?.query);
    if (!logGroups.length || !queryString) return res.status(400).json({ error: 'The widget has no Logs Insights query' });
    const region = widgetRegion(widget, cfg);
    const { CloudWatchLogsClient, StartQueryCommand } = require('@aws-sdk/client-cloudwatch-logs');
    // logGroupIdentifiers accepts names and ARNs (also cross-account), unlike logGroupNames.
    const resp = await new CloudWatchLogsClient({ ...cfg, region }).send(new StartQueryCommand({
      logGroupIdentifiers: logGroups.map(logGroupIdentifier), queryString, startTime: Math.floor(start / 1000), endTime: Math.ceil(end / 1000),
    }));
    res.json({ queryId: resp.queryId, region });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/logs-query/:queryId', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const region = String(req.query.region || cfg.region);
    if (!REGION_RE.test(region)) return res.status(400).json({ error: 'Invalid region' });
    const { CloudWatchLogsClient, GetQueryResultsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const resp = await new CloudWatchLogsClient({ ...cfg, region }).send(new GetQueryResultsCommand({ queryId: req.params.queryId }));
    const results = normalizeQueryResults(resp);
    // Optional: a finished query over one cached log group also feeds that group's cache
    // (rows need @timestamp, @logStream and @message; duplicates are skipped).
    let storedInCache = 0;
    const group = String(req.query.group || '');
    if (group && results.status === 'Complete' && region === cfg.region && /^[\w\-./#]{1,512}$/.test(group)) {
      try {
        const { getLogCache } = require('../lib/awsLogCache');
        const { insightsRowsToEvents } = require('../lib/awsLogFetch');
        const cache = getLogCache();
        if (cache.isCached(profileId, region, group)) storedInCache = await cache.ingest({ profileId, region, logGroup: group, events: insightsRowsToEvents(results.rows) });
      } catch (cacheErr) { console.warn('[log-cache]', cacheErr.message); }
    }
    res.json({ ...results, storedInCache });
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
    const { EC2Client } = require('@aws-sdk/client-ec2');
    const infra = await summarizeClusters({ eks: client, ec2: new EC2Client(cfg) }, details.map(c => c.name));
    res.json(details.map(c => ({
      name:     c.name,
      arn:      c.arn,
      status:   c.status,
      version:  c.version,
      region:   cfg.region,
      endpoint: c.endpoint,
      roleArn:  c.roleArn,
      createdAt: c.createdAt,
      tags:     c.tags || {},
      nodegroups:    infra.get(c.name)?.nodegroups ?? null,
      instanceCount: infra.get(c.name)?.instanceCount ?? null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /eks/:name/observability ────────────────────────────────────────────
// Container Insights metrics grouped by their native Kubernetes dimensions.

router.get('/eks/:name/observability', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const clusterName = req.params.name;
    const groupBy = String(req.query.groupBy || 'namespace').toLowerCase();
    if (!GROUP_DIMENSIONS[groupBy]) {
      return res.status(400).json({
        error: `groupBy must be one of: ${Object.keys(GROUP_DIMENSIONS).join(', ')}`,
      });
    }

    const requestedHours = Number.parseInt(req.query.hours, 10) || 3;
    const hours = [1, 3, 6, 12, 24, 72].includes(requestedHours) ? requestedHours : 3;
    const period = hours <= 3 ? 60 : hours <= 24 ? 300 : 900;
    const now = new Date();
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const { EKSClient, DescribeClusterCommand } = require('@aws-sdk/client-eks');
    const {
      CloudWatchClient,
      GetMetricDataCommand,
      ListMetricsCommand,
    } = require('@aws-sdk/client-cloudwatch');

    const eks = new EKSClient(cfg);
    const cloudWatch = new CloudWatchClient(cfg);
    const [clusterResult, nodegroupResult] = await Promise.allSettled([
      eks.send(new DescribeClusterCommand({ name: clusterName })),
      describeNodegroups(eks, clusterName),
    ]);
    if (clusterResult.status === 'rejected') throw clusterResult.reason;

    const nodegroups = nodegroupResult.status === 'fulfilled' ? nodegroupResult.value : [];

    const catalog = [];
    let nextToken;
    let pages = 0;
    do {
      const page = await cloudWatch.send(new ListMetricsCommand({
        Namespace: 'ContainerInsights',
        Dimensions: [{ Name: 'ClusterName', Value: clusterName }],
        NextToken: nextToken,
      }));
      catalog.push(...(page.Metrics || []));
      nextToken = page.NextToken;
      pages += 1;
    } while (nextToken && pages < 4);

    const availableGroupings = Object.entries(GROUP_DIMENSIONS)
      .filter(([candidate, dimension]) => catalog.some(metric =>
        METRIC_DEFINITIONS[metric.MetricName]?.groups.includes(candidate) &&
        metric.Dimensions?.some(item => item.Name === dimension)
      ))
      .map(([candidate]) => candidate);
    const descriptors = buildMetricQueries(catalog, groupBy, period);
    let metricDataResults = [];
    if (descriptors.length) {
      const metricData = await cloudWatch.send(new GetMetricDataCommand({
        MetricDataQueries: descriptors.map(descriptor => descriptor.query),
        StartTime: start,
        EndTime: now,
        ScanBy: 'TimestampAscending',
      }));
      metricDataResults = metricData.MetricDataResults || [];
    }
    const aggregated = aggregateMetricResults(descriptors, metricDataResults);
    const cluster = clusterResult.value.cluster;

    res.json({
      cluster: {
        name: cluster.name,
        arn: cluster.arn,
        region: cfg.region,
        version: cluster.version,
        status: cluster.status,
        tags: cluster.tags || {},
      },
      source: 'CloudWatch Container Insights',
      containerInsightsAvailable: catalog.length > 0,
      availableGroupings,
      groupBy,
      hours,
      period,
      partial: Boolean(nextToken) || descriptors.length >= 450,
      nodegroups,
      ...aggregated,
    });
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
    auditLog.log({
      category: 'aws', action: 'ECS service started',
      resource: `${req.params.cluster}/${req.params.service}`,
      context: profileId,
    });
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
    auditLog.log({
      category: 'aws', action: 'ECS service stopped',
      resource: `${req.params.cluster}/${req.params.service}`,
      level: 'warning', context: profileId,
    });
    res.json({ success: true, cluster: req.params.cluster, service: req.params.service, desiredCount: 0 });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /account ─────────────────────────────────────────────────────────────
// Destination shown before write operations (EC2/ECS start and stop).

router.get('/account', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    res.json({ account: await awsAccountId(profileId, cfg), region: cfg.region || null });
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

// ─── GET /ebs ─────────────────────────────────────────────────────────────────
// EBS volumes of the profile's region (lib/awsEbs.js): attachment, the Kubernetes claim that created
// them and their list-price monthly cost. DescribeVolumes only, at no cost.

router.get('/ebs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EC2Client, DescribeVolumesCommand } = require('@aws-sdk/client-ec2');
    res.json(await require('../lib/awsEbs').listVolumes(new EC2Client(cfg), { DescribeVolumesCommand }));
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
      …53859 tokens truncated…────

router.post('/lex/:botId/chat', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const { text, aliasId = 'TSTALIASID', localeId = 'es_MX', sessionId } = req.body || {};
  if (!text || typeof text !== 'string' || text.length > 1024) {
    return res.status(400).json({ error: 'text is required and must be <= 1024 chars' });
  }
  const sid = (sessionId || `kua-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LexRuntimeV2Client, RecognizeTextCommand } = require('@aws-sdk/client-lex-runtime-v2');
    const client = new LexRuntimeV2Client(cfg);
    const resp = await client.send(new RecognizeTextCommand({
      botId, botAliasId: aliasId, localeId, sessionId: sid, text,
    }));
    const slots = {};
    for (const [k, v] of Object.entries(resp.sessionState?.intent?.slots || {})) {
      slots[k] = v?.value?.interpretedValue ?? null;
    }
    res.json({
      sessionId:     sid,
      inputTranscript: text,
      intent:        resp.sessionState?.intent?.name || null,
      intentState:   resp.sessionState?.intent?.state || null,
      confidence:    resp.interpretations?.[0]?.nluConfidence?.score ?? null,
      slots,
      messages:      (resp.messages || []).map(m => ({ type: m.contentType, content: m.content })),
      interpretations: (resp.interpretations || []).slice(0, 5).map(i => ({
        intent:     i.intent?.name,
        confidence: i.nluConfidence?.score,
      })),
      dialogAction:  resp.sessionState?.dialogAction?.type || null,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lex/:botId/missed-utterances ────────────────────────────────────────

router.get('/lex/:botId/missed-utterances', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const limit  = Math.min(parseInt(req.query.limit) || 200, 1000);
  const aliasId = String(req.query.aliasId || '');
  const localeId = String(req.query.localeId || '');
  const force = req.query.force === '1';
  const resourceKey = `${botId}:${aliasId || 'all'}:${localeId || 'all'}:${hours}:${limit}`;
  let cfg;
  try {
    cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey, kind: 'lex-missed-utterances' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { LexModelsV2Client, ListBotAliasesCommand, DescribeBotAliasCommand } = require('@aws-sdk/client-lex-models-v2');
    const cw = new CloudWatchLogsClient(cfg);
    const startTime = Date.now() - hours * 3600000;
    const lex = new LexModelsV2Client(cfg);
    const groups = await lexConversationLogGroups(lex, {
      ListBotAliasesCommand, DescribeBotAliasCommand,
    }, botId, aliasId, { logClient: cw, DescribeLogGroupsCommand });
    const currentEvents = (await collectLexLogEvents(cw, FilterLogEventsCommand, groups, {
      startTime, limit, filterPattern: '{ $.missedUtterance IS TRUE }',
    })).filter(event => !localeId || !event.parsed?.localeId || event.parsed.localeId === localeId);
    const historicEvents = readCloudRange({
      profileId, region: cfg.region, resourceKey: botId, kind: 'lex-log-event',
      from: startTime, to: Date.now() + 1, limit: 5000,
    }).map(row => row.payload).filter(event => {
      if (aliasId && event?.aliasId && event.aliasId !== aliasId) return false;
      if (localeId && event?.parsed?.localeId && event.parsed.localeId !== localeId) return false;
      return event?.parsed?.missedUtterance === true || event?.parsed?.missedUtterance === 'true';
    });
    for (const event of currentEvents) {
      writeCloudSnapshot({
        profileId, region: cfg.region, resourceKey: botId, kind: 'lex-log-event',
        payload: event, capturedAt: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : Date.now(),
        ttlMs: cacheTtlMs(req), metadata: { botId, aliasId: event.aliasId || null, missedUtterance: true },
      });
    }
    const seen = new Set();
    const events = [...historicEvents, ...currentEvents].filter(event => {
      const id = `${event?.timestamp || ''}|${event?.stream || ''}|${event?.message || ''}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, limit);
    const groupNames = [...new Set([
      ...groups.map(group => group.name),
      ...events.map(event => event.logGroup).filter(Boolean),
    ])];
    const payload = {
      configured: groupNames.length > 0 || events.length > 0,
      logGroupName: groupNames.join(', '),
      groups: groupNames,
      aliases: groups.filter(group => group.aliasId).map(group => ({ aliasId: group.aliasId, aliasName: group.aliasName, botVersion: group.botVersion, logGroup: group.name })),
      utterances: events.map(event => ({
        timestamp: event.timestamp,
        text: event.parsed?.inputTranscript || event.parsed?.inputText || String(event.message || '').slice(0, 120),
        sessionId: event.parsed?.sessionId || null,
        localeId: event.parsed?.localeId || null,
        missedUtterance: event.parsed?.missedUtterance ?? true,
      })),
    };
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req), metadata: { botId, aliasId: aliasId || null, localeId: localeId || null } });
    res.json(payload);
  } catch (err) {
    const cached = readCloudSnapshot({ profileId, region: cfg?.region || '', resourceKey, kind: 'lex-missed-utterances', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── POST /lex/:botId/build ───────────────────────────────────────────────────

router.post('/lex/:botId/build', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const { localeId } = req.body || {};
  if (!localeId) return res.status(400).json({ error: 'localeId is required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LexModelsV2Client, BuildBotLocaleCommand, DescribeBotLocaleCommand } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);
    await client.send(new BuildBotLocaleCommand({ botId, botVersion: 'DRAFT', localeId }));

    // Poll status up to 30 seconds
    let status = 'Building';
    let failureReasons = [];
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const d = await client.send(new DescribeBotLocaleCommand({ botId, botVersion: 'DRAFT', localeId }));
      status = d.botLocaleStatus;
      failureReasons = d.failureReasons || [];
      if (status === 'Built' || status === 'Failed' || status === 'NotBuilt') break;
    }
    res.json({ localeId, status, failureReasons });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lex/:botId/metrics ──────────────────────────────────────────────────

router.get('/lex/:botId/metrics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const requestedBotName = String(req.query.botName || '');
  const aliasId = String(req.query.aliasId || '');
  const aliasName = String(req.query.aliasName || '');
  const localeId = String(req.query.localeId || '');
  const force = req.query.force === '1';
  let cfg;
  let resolvedBotName = requestedBotName;
  try {
    cfg = await resolveAwsConfig(profileId);
    let botName = requestedBotName;
    if (!botName) {
      const { LexModelsV2Client, ListBotsCommand } = require('@aws-sdk/client-lex-models-v2');
      const client = new LexModelsV2Client(cfg);
      let nextToken;
      do {
        const response = await client.send(new ListBotsCommand({ maxResults: 50, nextToken }));
        const bot = (response.botSummaries || []).find(item => item.botId === botId);
        if (bot) { botName = bot.botName || ''; break; }
        nextToken = response.nextToken;
      } while (nextToken && !botName);
    }
    resolvedBotName = botName;
    const resourceKey = `${botId}:${botName || 'unknown'}:${aliasId || 'all'}:${localeId || 'all'}:${hours}`;
    const snapshotKey = { profileId, region: cfg.region, resourceKey, kind: 'lex-metrics' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const cw = new CloudWatchClient(cfg);
    const endTime = new Date();
    const startTime = new Date(Date.now() - hours * 3600000);
    const period = hours <= 6 ? 300 : hours <= 48 ? 3600 : 86400;

    const dims = [{ Name: 'BotName', Value: botName || botId }];
    if (aliasName) dims.push({ Name: 'BotAlias', Value: aliasName });
    if (localeId) dims.push({ Name: 'LocaleId', Value: localeId });
    const metricNames = ['RuntimeRequestCount', 'RuntimeSuccessfulRequestLatency', 'MissedUtteranceCount', 'RuntimePollyErrors'];
    const queries = metricNames.map((m, i) => ({
      Id: `m${i}`, Label: m,
      MetricStat: { Metric: { Namespace: 'AWS/Lex', MetricName: m, Dimensions: dims }, Period: period, Stat: m.includes('Latency') ? 'Average' : 'Sum' },
    }));

    const resp = await cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: startTime, EndTime: endTime }));
    const out = {};
    for (const r of (resp.MetricDataResults || [])) {
      out[r.Label] = r.Timestamps.map((t, i) => ({ t: new Date(t).toISOString(), v: r.Values[i] }))
        .sort((a, b) => a.t.localeCompare(b.t));
    }
    const payload = { period, hours, botName: botName || botId, aliasId: aliasId || null, localeId: localeId || null, metrics: out };
    const history = metricHistory();
    if (history) {
      const from = startTime.getTime();
      const to = endTime.getTime();
      for (const [metric, points] of Object.entries(out)) {
        try {
          history.write({ provider: 'aws', profileId, region: cfg.region, resourceId: `AWS::Lex::Bot:${botId}`, metric, periodS: period }, {
            from, to, points: points.map(point => ({ t: new Date(point.t).getTime(), v: point.v })),
          });
        } catch (historyError) { console.warn('[metric-history] Lex:', historyError.message); }
      }
    }
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req), metadata: { botId, botName: botName || botId, aliasId: aliasId || null, localeId: localeId || null } });
    res.json(payload);
  } catch (err) {
    const requestedResourceKey = `${botId}:${resolvedBotName || 'unknown'}:${aliasId || 'all'}:${localeId || 'all'}:${hours}`;
    const cached = readCloudSnapshot({ profileId, region: cfg?.region || '', resourceKey: requestedResourceKey, kind: 'lex-metrics', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
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

// ─── CloudWatch Logs: inventory, local cache and S3 backup ───────────────────
// Describe/Filter calls only (no Logs Insights per-GB scans). The local cache
// keeps chosen groups for up to 7 days, less when their volume would not fit
// the budget (lib/awsLogCache.js).

const LOG_GROUP_NAME_RE = /^[\w\-./#]{1,512}$/;

function requireLogGroup(value, res) {
  const name = String(value || '');
  if (!LOG_GROUP_NAME_RE.test(name)) { res.status(400).json({ error: 'Invalid log group name' }); return null; }
  return name;
}

function logCache() {
  return require('../lib/awsLogCache').getLogCache();
}

router.get('/cloudwatch/log-groups', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { listLogGroups } = require('../lib/awsLogGroups');
    const { groups, truncated } = await listLogGroups(new CloudWatchLogsClient(cfg), { DescribeLogGroupsCommand });
    const cached = new Map(logCache().summary({ profileId, region: cfg.region }).groups.map(g => [g.logGroup, g]));
    res.json({
      region: cfg.region,
      truncated,
      groups: groups.map(group => ({ ...group, cache: cached.get(group.name) || null })),
    });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/log-groups/streams', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, DescribeLogStreamsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { listLogStreams } = require('../lib/awsLogGroups');
    res.json(await listLogStreams(new CloudWatchLogsClient(cfg), { DescribeLogStreamsCommand }, group));
  } catch (err) { handleErr(res, err); }
});

// source=cache reads the local cache only; source=live calls FilterLogEvents and,
// when the group is cached, stores what it read.
router.get('/cloudwatch/log-groups/events', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const minutes = Math.min(Math.max(parseInt(req.query.minutes, 10) || 60, 1), 7 * 1440);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000);
    // An explicit window (from/to, e.g. a zoomed chart bar) wins over "last N minutes".
    const endTime = Math.min(Number(req.query.to) || Date.now(), Date.now());
    const startTime = Number(req.query.from) && Number(req.query.from) < endTime ? Number(req.query.from) : endTime - minutes * 60 * 1000;
    const filter = String(req.query.filter || '').slice(0, 512);
    const stream = String(req.query.stream || '').slice(0, 512);
    const cache = logCache();
    if (req.query.source === 'cache') {
      const cachedGroup = cache.describeGroup(profileId, cfg.region, group);
      return res.json({
        source: 'cache',
        events: await cache.query({ profileId, region: cfg.region, logGroup: group, from: startTime, to: endTime, pattern: filter, stream, limit }),
        coverage: cachedGroup && { oldest: cachedGroup.oldest, newest: cachedGroup.newest, syncedUntil: cachedGroup.syncedUntil, lastSyncAt: cachedGroup.lastSyncAt, backfillPending: cachedGroup.backfillPending },
      });
    }
    const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { fetchNewest } = require('../lib/awsLogFetch');
    const client = new CloudWatchLogsClient(cfg);
    let events;
    let nextToken;
    try {
      // Newest events of the range, like the cache (FilterLogEvents alone returns the oldest).
      const result = await fetchNewest({
        client, FilterLogEventsCommand, logGroupName: group, startTime, endTime, limit,
        filterPattern: filter || undefined, logStreamNames: stream ? [stream] : undefined,
      });
      events = result.events;
      nextToken = result.more;
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') return res.json({ source: 'live', status: 'missing', events: [] });
      throw err;
    }
    let storedInCache = 0;
    // Every search of a cached group feeds it (deduplicated); filtered searches add what they found.
    if (cache.isCached(profileId, cfg.region, group)) {
      try { storedInCache = await cache.ingest({ profileId, region: cfg.region, logGroup: group, events }); } catch (cacheErr) { console.warn('[log-cache]', cacheErr.message); }
    }
    res.json({
      source: 'live',
      more: !!nextToken,
      storedInCache,
      events: events.sort((a, b) => b.timestamp - a.timestamp).map(e => ({ timestamp: e.timestamp, message: e.message, logStreamName: e.logStreamName })),
    });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/log-cache', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    await logCache().ready();
    res.json({ region: cfg.region, ...logCache().summary({ profileId, region: cfg.region }) });
  } catch (err) { handleErr(res, err); }
});

// Adds a group to the cache and runs its first sync.
router.post('/cloudwatch/log-cache', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.body?.group, res);
  if (!group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const client = new CloudWatchLogsClient(cfg);
    const described = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: group, limit: 5 }));
    const info = (described.logGroups || []).find(g => g.logGroupName === group);
    if (!info) return res.status(404).json({ error: 'Log group not found' });
    const cache = logCache();
    const historyHours = req.body?.historyHours;
    cache.enable({
      profileId, region: cfg.region, logGroup: group, storedBytes: info.storedBytes ?? null, retentionInDays: info.retentionInDays ?? null, creationTime: info.creationTime ?? null,
      ...(historyHours === undefined ? {} : { historyMs: historyHours === null ? null : Math.max(0, Number(historyHours) || 0) * 3600000 }),
    });
    res.json(await cache.syncGroup({ profileId, region: cfg.region, logGroup: group, client, FilterLogEventsCommand }));
  } catch (err) { handleErr(res, err); }
});

// Syncs one cached group (body.group) or every cached group of the profile and region.
router.post('/cloudwatch/log-cache/sync', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const client = new CloudWatchLogsClient(cfg);
    const cache = logCache();
    let groups = cache.summary({ profileId, region: cfg.region }).groups.map(g => g.logGroup);
    if (req.body?.group) {
      const group = requireLogGroup(req.body.group, res);
      if (!group) return;
      groups = groups.filter(g => g === group);
      if (!groups.length) return res.status(404).json({ error: 'Log group is not cached' });
    }
    // backfillPages lets the user fill history now (each page ≤ 1 MB / 10,000 events).
    const maxPages = Math.min(Math.max(parseInt(req.body?.backfillPages, 10) || 10, 1), 50);
    const results = [];
    for (const logGroup of groups) {
      try {
        results.push({ logGroup, ...(await cache.syncGroup({ profileId, region: cfg.region, logGroup, client, FilterLogEventsCommand, maxPages })) });
      } catch (err) {
        if (classifyAwsError(err).kind === 'denied') throw err;
        results.push({ logGroup, status: 'error', error: err.message });
      }
    }
    res.json({ results, ...cache.summary({ profileId, region: cfg.region }) });
  } catch (err) { handleErr(res, err); }
});

router.delete('/cloudwatch/log-cache', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    logCache().disable({ profileId, region: cfg.region, logGroup: group });
    res.json({ ok: true, ...logCache().summary({ profileId, region: cfg.region }) });
  } catch (err) { handleErr(res, err); }
});

// How far back a cached group is filled: historyHours null = whole window, 0 = only new events.
router.patch('/cloudwatch/log-cache', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.body?.group, res);
  if (!group) return;
  const body = req.body || {};
  const hours = body.historyHours;
  if ('historyHours' in body && hours !== null && !(Number(hours) >= 0)) return res.status(400).json({ error: 'historyHours must be null or a number of hours' });
  if (!('historyHours' in body) && !('refreshMinutes' in body)) return res.status(400).json({ error: 'historyHours or refreshMinutes is required' });
  try {
    const { checkRefreshMinutes } = require('../lib/plans');
    // Validated first: a plan error must not leave a half-applied change.
    const refreshMinutes = 'refreshMinutes' in body ? checkRefreshMinutes(body.refreshMinutes) : undefined;
    const cfg = await resolveAwsConfig(profileId);
    const cache = logCache();
    if (!cache.isCached(profileId, cfg.region, group)) return res.status(404).json({ error: 'Log group is not cached' });
    const scope = { profileId, region: cfg.region, logGroup: group };
    let result = cache.describeGroup(profileId, cfg.region, group);
    if ('historyHours' in body) result = cache.setHistory({ ...scope, historyMs: hours === null ? null : Number(hours) * 3600000 });
    if (refreshMinutes !== undefined) result = cache.setRefresh({ ...scope, minutes: refreshMinutes });
    res.json(result);
  } catch (err) {
    if (err.code === 'PLAN_REQUIRED' || err.statusCode === 400) return res.status(err.statusCode).json({ error: err.message, code: err.code, required: err.required });
    handleErr(res, err);
  }
});

// ─── Background log scans ─────────────────────────────────────────────────────
// Read up to 5 days of a log group into the local cache while the user keeps
// working (lib/awsLogScans.js). FilterLogEvents has no per-request charge;
// the download counts as AWS data transfer out (first 100 GB/month free).

// One runner for every provider of the shared cache (Kubernetes scans too).
function logScans() {
  return require('../lib/logScanRunner').getLogScanRunner();
}

function scanDays(value) {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 5) : null;
}

router.get('/cloudwatch/log-scans', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const runner = logScans();
    res.json({ region: cfg.region, maxDays: 5, scans: runner.list({ profileId, region: cfg.region }), active: runner.activeCount(), usage: logCache().usage() });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudwatch/log-scans/estimate', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  const days = scanDays(req.query.days);
  if (!days) return res.status(400).json({ error: 'days must be between 1 hour and 5 days' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { estimateScan, describeLogGroup } = require('../lib/awsLogScans');
    const info = await describeLogGroup(new CloudWatchLogsClient(cfg), DescribeLogGroupsCommand, group);
    if (!info) return res.status(404).json({ error: 'Log group not found' });
    res.json({
      group,
      cached: logCache().isCached(profileId, cfg.region, group),
      ...estimateScan({ group: { storedBytes: info.storedBytes, retentionInDays: info.retentionInDays, creationTime: info.creationTime }, days, usage: logCache().usage() }),
    });
  } catch (err) { handleErr(res, err); }
});

// Starts a scan of the last `days` (≤ 5); caches the group first when needed.
router.post('/cloudwatch/log-scans', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.body?.group, res);
  if (!group) return;
  const days = scanDays(req.body?.days);
  if (!days) return res.status(400).json({ error: 'days must be between 1 hour and 5 days' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    // FilterLogEvents is sent by the background runner (lib/awsLogScans.js) for this scan.
    const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { estimateScan, describeLogGroup } = require('../lib/awsLogScans');
    const info = await describeLogGroup(new CloudWatchLogsClient(cfg), DescribeLogGroupsCommand, group);
    if (!info) return res.status(404).json({ error: 'Log group not found' });
    const cache = logCache();
    await cache.ready();
    if (!cache.isCached(profileId, cfg.region, group)) {
      cache.enable({ profileId, region: cfg.region, logGroup: group, storedBytes: info.storedBytes ?? null, retentionInDays: info.retentionInDays ?? null, creationTime: info.creationTime ?? null });
    }
    const estimate = estimateScan({ group: { storedBytes: info.storedBytes, retentionInDays: info.retentionInDays, creationTime: info.creationTime }, days, usage: cache.usage() });
    const scan = logScans().start({ profileId, region: cfg.region, logGroup: group, from: estimate.from, to: estimate.to });
    res.status(201).json({ scan, estimate, group: cache.describeGroup(profileId, cfg.region, group) });
  } catch (err) { handleErr(res, err); }
});

function scopedScan(req, res, profileId) {
  const scan = logScans().get(Number(req.params.id));
  if (!scan || scan.profileId !== profileId) {
    res.status(404).json({ error: 'Scan not found' });
    return null;
  }
  return scan;
}

router.post('/cloudwatch/log-scans/:id/:action', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const actions = { pause: 'pause', resume: 'resume', cancel: 'cancel' };
  const action = actions[req.params.action];
  if (!action) return res.status(400).json({ error: 'Unknown action' });
  try {
    const scan = scopedScan(req, res, profileId);
    if (!scan) return;
    res.json(logScans()[action](scan.id));
  } catch (err) { handleErr(res, err); }
});

router.delete('/cloudwatch/log-scans/:id', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const scan = scopedScan(req, res, profileId);
    if (!scan) return;
    logScans().remove(scan.id);
    res.status(204).end();
  } catch (err) { handleErr(res, err); }
});

// Events per time bin (seconds to days, adapted to the range) and level, from the cache.
router.get('/cloudwatch/log-intelligence/histogram', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  const category = String(req.query.category || '');
  const level = String(req.query.level || '');
  if (category && !/^[a-z_]{2,40}$/.test(category)) return res.status(400).json({ error: 'Invalid category' });
  if (level && !['error', 'warn', 'info'].includes(level)) return res.status(400).json({ error: 'Invalid level' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const cache = logCache();
    if (!cache.isCached(profileId, cfg.region, group)) return res.status(404).json({ error: 'Log group is not cached' });
    const to = Number(req.query.to) || Date.now();
    const from = Number(req.query.from) || to - 24 * 3600000;
    if (!(from < to) || to - from > 8 * 24 * 3600000) return res.status(400).json({ error: 'Invalid range' });
    res.json(await cache.histogram({
      profileId, region: cfg.region, logGroup: group, from, to, binMs: Number(req.query.binMs) || undefined,
      category, level, pattern: String(req.query.pattern || '').slice(0, 512),
    }));
  } catch (err) { handleErr(res, err); }
});

// Log intelligence of a cached group: aggregated, sanitized signals (rates,
// recurring signatures, failure keywords, references). Local only, no AWS call.
router.get('/cloudwatch/log-intelligence', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const intelligence = await logCache().intelligenceFor({ profileId, region: cfg.region, logGroup: group });
    if (!intelligence) return res.status(404).json({ error: 'Log group is not cached' });
    const { linkedApmResources } = require('../lib/logIntelligenceEvidence');
    res.json({ ...intelligence, apm: linkedApmResources({ database: getApmDatabase(), profileId, region: cfg.region, logGroup: group }) });
  } catch (err) { handleErr(res, err); }
});

// Recurring errors of the cached groups ranked by meaning with the local model
// (?q=, optional ?group=). Local only, no AWS call; 409 when local ML is off.
router.get('/cloudwatch/log-intelligence/search', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'q is required' });
  const group = req.query.group ? requireLogGroup(req.query.group, res) : null;
  if (req.query.group && !group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const results = await logCache().searchSignatures({ profileId, region: cfg.region, query: query.slice(0, 500), logGroup: group, limit: Math.min(Number(req.query.limit) || 20, 50) });
    res.json({ query, region: cfg.region, results });
  } catch (err) {
    if (err.code === 'ML_DISABLED') return res.status(409).json({ error: 'Local ML is disabled. Enable it in KUA (Intelligence → Local ML).', code: 'ML_DISABLED' });
    handleErr(res, err);
  }
});

// Cached events of a category, level or signature (decrypted locally, no AWS call).
router.get('/cloudwatch/log-intelligence/events', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  const category = String(req.query.category || '');
  const level = String(req.query.level || '');
  if (category && !/^[a-z_]{2,40}$/.test(category)) return res.status(400).json({ error: 'Invalid category' });
  if (level && !['error', 'warn', 'info'].includes(level)) return res.status(400).json({ error: 'Invalid level' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const cache = logCache();
    if (!cache.isCached(profileId, cfg.region, group)) return res.status(404).json({ error: 'Log group is not cached' });
    const minutes = Math.min(Math.max(parseInt(req.query.minutes, 10) || 7 * 1440, 1), 7 * 1440);
    const to = Number(req.query.to) || null;
    const from = Number(req.query.from) || (to || Date.now()) - minutes * 60000;
    res.json(await cache.filterEvents({
      profileId, region: cfg.region, logGroup: group, from, to,
      category, level, signature: String(req.query.signature || '').slice(0, 200), pattern: String(req.query.pattern || '').slice(0, 512), limit: req.query.limit,
    }));
  } catch (err) { handleErr(res, err); }
});

// Backup view: which groups have a copy in S3 (subscription to Firehose/Kinesis or
// export tasks) and which other services write logs straight to S3.
router.get('/cloudwatch/log-backup', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      CloudWatchLogsClient, DescribeLogGroupsCommand, DescribeExportTasksCommand, DescribeSubscriptionFiltersCommand,
    } = require('@aws-sdk/client-cloudwatch-logs');
    const { CloudTrailClient, DescribeTrailsCommand } = require('@aws-sdk/client-cloudtrail');
    const { EC2Client, DescribeFlowLogsCommand } = require('@aws-sdk/client-ec2');
    const { listLogGroups, listExportTasks, listSubscriptions, buildBackupCoverage, listS3LogSources } = require('../lib/awsLogGroups');
    const client = new CloudWatchLogsClient(cfg);
    const { groups, truncated } = await listLogGroups(client, { DescribeLogGroupsCommand });
    const errors = [];
    let exportTasks = [];
    try { exportTasks = await listExportTasks(client, { DescribeExportTasksCommand }); } catch (err) { errors.push({ source: 'exports', error: err.message, name: err.name }); }
    // One call per group: capped so large accounts stay responsive.
    const subscriptionGroups = groups.slice(0, 300).map(g => g.name);
    const subscriptions = await listSubscriptions(client, { DescribeSubscriptionFiltersCommand }, subscriptionGroups);
    const sdk = pkg => ({
      'client-cloudtrail': { CloudTrailClient, DescribeTrailsCommand },
      'client-ec2': { EC2Client, DescribeFlowLogsCommand },
    })[pkg];
    const s3 = await listS3LogSources(cfg, { sdk });
    res.json({
      region: cfg.region,
      truncated,
      subscriptionsChecked: subscriptionGroups.length,
      coverage: buildBackupCoverage(groups, { exportTasks, subscriptions }),
      exportTasks,
      s3Sources: s3.sources,
      errors: [...errors, ...s3.errors],
    });
  } catch (err) { handleErr(res, err); }
});

// Reads an archived log object (gzip is decompressed; up to 2 MB of text).
router.get('/cloudwatch/log-archive/object', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const bucket = String(req.query.bucket || '');
  const key = String(req.query.key || '');
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket) || !key) return res.status(400).json({ error: 'bucket and key are required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { decodeArchive, MAX_ARCHIVE_BYTES } = require('../lib/awsLogGroups');
    const response = await new S3Client(cfg).send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${MAX_ARCHIVE_BYTES - 1}` }));
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const total = Number(String(response.ContentRange || '').split('/')[1]) || buffer.length;
    const decoded = await decodeArchive(buffer, key);
    res.json({ bucket, key, size: total, partial: total > buffer.length, lastModified: response.LastModified || null, ...decoded });
  } catch (err) { handleErr(res, err); }
});

// ─── Logs queries (Logs Insights syntax) ─────────────────────────────────────
// source=cache: over the local cache. source=live: over up to 10 pages of
// FilterLogEvents (no per-GB charge). Both run the shared engine in
// frontend/src/shared/logsQuery.mjs. /insights runs the real Logs Insights
// (billed per GB scanned; the UI shows /insights/estimate first).

const logsQueryEngine = () => import('../frontend/src/shared/logsQuery.mjs');
const LIVE_QUERY_PAGES = 10;

function queryRange(body = {}) {
  const minutes = Math.min(Math.max(parseInt(body.minutes, 10) || 60, 1), 7 * 1440);
  const end = Date.now();
  return { minutes, start: end - minutes * 60 * 1000, end };
}

router.post('/cloudwatch/log-groups/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.body?.group, res);
  if (!group) return;
  let engine;
  try {
    engine = await logsQueryEngine();
    const query = String(req.body?.query || '').slice(0, 10000);
    const check = engine.validateQuery(query);
    if (!check.ok) return res.status(400).json({ error: check.error.message, queryError: check.error });
    const cfg = await resolveAwsConfig(profileId);
    const { start, end } = queryRange(req.body);
    const cache = logCache();
    let events;
    let coverage;
    let storedInCache = 0;
    if (req.body?.source === 'cache') {
      const scanned = await cache.scan({ profileId, region: cfg.region, logGroup: group, from: start, to: end });
      events = scanned.events;
      coverage = { truncated: scanned.truncated, from: events.length ? events[events.length - 1].timestamp : null, to: events.length ? events[0].timestamp : null };
    } else {
      const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
      const { fetchNewest } = require('../lib/awsLogFetch');
      const client = new CloudWatchLogsClient(cfg);
      let sample;
      try {
        // The newest events of the range (same set the cache would use), up to the page budget.
        sample = await fetchNewest({ client, FilterLogEventsCommand, logGroupName: group, startTime: start, endTime: end, limit: 50000, maxPages: LIVE_QUERY_PAGES });
      } catch (err) {
        if (err.name === 'ResourceNotFoundException') return res.status(404).json({ error: 'Log group not found' });
        throw err;
      }
      events = sample.events;
      coverage = { truncated: sample.more, from: sample.more ? sample.from : start, to: end };
      if (cache.isCached(profileId, cfg.region, group)) {
        try { storedInCache = await cache.ingest({ profileId, region: cfg.region, logGroup: group, events }); } catch (cacheErr) { console.warn('[log-cache]', cacheErr.message); }
      }
    }
    const result = engine.runQuery(query, events, { logGroup: group });
    res.json({ source: req.body?.source === 'cache' ? 'cache' : 'live', ...result, storedInCache, coverage: { events: events.length, ...coverage } });
  } catch (err) {
    // runQuery can still fail at run time (e.g. an aggregate outside stats).
    if (engine && err instanceof engine.QueryError) {
      return res.status(400).json({ error: err.message, queryError: { code: err.code, params: err.params, message: err.message } });
    }
    handleErr(res, err);
  }
});

router.get('/cloudwatch/log-groups/insights/estimate', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { minutes } = queryRange(req.query);
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const described = await new CloudWatchLogsClient(cfg).send(new DescribeLogGroupsCommand({ logGroupNamePrefix: group, limit: 5 }));
    const info = (described.logGroups || []).find(g => g.logGroupName === group);
    res.json(estimateLogScan([{ name: group, found: !!info, storedBytes: info?.storedBytes, retentionInDays: info?.retentionInDays, creationTime: info?.creationTime }], minutes * 60));
  } catch (err) { handleErr(res, err); }
});

router.post('/cloudwatch/log-groups/insights', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.body?.group, res);
  if (!group) return;
  const queryString = String(req.body?.query || '').trim().slice(0, 10000);
  if (!queryString) return res.status(400).json({ error: 'query is required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { start, end } = queryRange(req.body);
    const { CloudWatchLogsClient, StartQueryCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const resp = await new CloudWatchLogsClient(cfg).send(new StartQueryCommand({
      logGroupNames: [group], queryString, startTime: Math.floor(start / 1000), endTime: Math.ceil(end / 1000), limit: 10000,
    }));
    res.json({ queryId: resp.queryId, region: cfg.region });
  } catch (err) { handleErr(res, err); }
});

// Total events per bin of any log group (cached or not) from AWS/Logs IncomingLogEvents.
// GetMetricData: about USD 0.00001 per call; windows read recently come from the local history.
router.get('/cloudwatch/log-groups/volume', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const group = requireLogGroup(req.query.group, res);
  if (!group) return;
  try {
    const to = Math.min(Number(req.query.to) || Date.now(), Date.now());
    const from = Number(req.query.from) || to - 24 * 3600000;
    if (!(from < to) || to - from > 31 * 24 * 3600000) return res.status(400).json({ error: 'Invalid range' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const { logGroupVolume } = require('../lib/awsLogVolume');
    const { pickBinMs } = require('../lib/awsLogCache');
    res.json(await logGroupVolume({
      client: new CloudWatchClient(cfg), GetMetricDataCommand, history: metricHistory(),
      profileId, region: cfg.region, logGroup: group, from, to, binMs: pickBinMs(to - from), ttlMs: cacheTtlMs(req),
    }));
  } catch (err) { handleErr(res, err); }
});

// ─── CloudFormation (read-only) ───────────────────────────────────────────────
// Stacks, resources, events (with the root cause of the last failure), template
// and on-demand drift detection. CloudFormation read APIs have no charge.

function requireStackRef(value, res) {
  const { STACK_REF_RE } = require('../lib/awsCloudFormation');
  const ref = String(value || '');
  if (!STACK_REF_RE.test(ref)) { res.status(400).json({ error: 'Invalid stack name or ARN' }); return null; }
  return ref;
}

router.get('/cloudformation/stack-list', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
    const { listStacks } = require('../lib/awsCloudFormation');
    res.json({ region: cfg.region, ...(await listStacks(new CloudFormationClient(cfg), { DescribeStacksCommand })) });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/stack', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand } = require('@aws-sdk/client-cloudformation');
    const { stackDetail } = require('../lib/awsCloudFormation');
    res.json(await stackDetail(new CloudFormationClient(cfg), { DescribeStacksCommand, ListStackResourcesCommand }, stack));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/stack/events', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStackEventsCommand } = require('@aws-sdk/client-cloudformation');
    const { stackEvents } = require('../lib/awsCloudFormation');
    const name = String(req.query.name || stack.split('/')[1] || stack);
    res.json(await stackEvents(new CloudFormationClient(cfg), { DescribeStackEventsCommand }, stack, { stackName: name }));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/stack/template', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, GetTemplateCommand } = require('@aws-sdk/client-cloudformation');
    const { stackTemplate } = require('../lib/awsCloudFormation');
    res.json(await stackTemplate(new CloudFormationClient(cfg), { GetTemplateCommand }, stack));
  } catch (err) { handleErr(res, err); }
});

// Starts drift detection (read-only for the stack; no charge).
router.post('/cloudformation/stack/drift', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.body?.stack, res);
  if (!stack) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DetectStackDriftCommand } = require('@aws-sdk/client-cloudformation');
    const { startDriftDetection } = require('../lib/awsCloudFormation');
    res.json(await startDriftDetection(new CloudFormationClient(cfg), { DetectStackDriftCommand }, stack));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/stack/drift', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  const detectionId = String(req.query.detectionId || '');
  if (!/^[0-9a-f-]{36}$/.test(detectionId)) return res.status(400).json({ error: 'Invalid detection id' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStackDriftDetectionStatusCommand, DescribeStackResourceDriftsCommand } = require('@aws-sdk/client-cloudformation');
    const { driftResult } = require('../lib/awsCloudFormation');
    res.json(await driftResult(new CloudFormationClient(cfg), { DescribeStackDriftDetectionStatusCommand, DescribeStackResourceDriftsCommand }, stack, detectionId));
  } catch (err) { handleErr(res, err); }
});

// ─── CloudFormation: exports, change sets and audited operations ─────────────
// Every mutation has a preview first and is re-checked here, not trusted from the UI:
// destructive actions require typing the stack name, and everything is audit-logged.

const CHANGE_SET_RE = /^(?:[A-Za-z][A-Za-z0-9-]{0,127}|arn:aws[a-z-]*:cloudformation:[a-z0-9-]+:\d{12}:changeSet\/[A-Za-z][A-Za-z0-9-]{0,127}\/[0-9a-f-]{36})$/;

function cfnAudit({ action, stack, profileId, level = 'info', details = {} }) {
  auditLog.log({ category: 'aws', action, resource: stack, level, context: profileId, details: { kind: 'cloudformation', stack, ...details } });
}

function requireChangeSet(value, res) {
  const ref = String(value || '');
  if (!CHANGE_SET_RE.test(ref)) { res.status(400).json({ error: 'Invalid change set' }); return null; }
  return ref;
}

// The typed confirmation must be the stack name (not its ARN).
function confirmed(body, stackName) {
  return String(body?.confirm || '') === stackName;
}

router.get('/cloudformation/exports', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, ListExportsCommand, ListImportsCommand } = require('@aws-sdk/client-cloudformation');
    const { listExports } = require('../lib/awsCloudFormation');
    res.json(await listExports(new CloudFormationClient(cfg), { ListExportsCommand, ListImportsCommand }));
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/stack/change-sets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, ListChangeSetsCommand } = require('@aws-sdk/client-cloudformation');
    const { listChangeSets } = require('../lib/awsCloudFormation');
    res.json({ changeSets: await listChangeSets(new CloudFormationClient(cfg), { ListChangeSetsCommand }, stack) });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/change-set', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  const changeSet = requireChangeSet(req.query.changeSet, res);
  if (!changeSet) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeChangeSetCommand } = require('@aws-sdk/client-cloudformation');
    const { describeChangeSet } = require('../lib/awsCloudFormation');
    res.json(await describeChangeSet(new CloudFormationClient(cfg), { DescribeChangeSetCommand }, stack, changeSet));
  } catch (err) { handleErr(res, err); }
});

// Preview of a parameter update (creates a change set; nothing changes until it is executed).
router.post('/cloudformation/stack/parameter-change-set', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.body?.stack, res);
  if (!stack) return;
  const parameters = req.body?.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || !Object.keys(parameters).length) return res.status(400).json({ error: 'parameters must be an object with at least one value' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStacksCommand, CreateChangeSetCommand } = require('@aws-sdk/client-cloudformation');
    const { createParameterChangeSet } = require('../lib/awsCloudFormation');
    const result = await createParameterChangeSet(new CloudFormationClient(cfg), { DescribeStacksCommand, CreateChangeSetCommand }, stack, parameters);
    cfnAudit({ action: 'CloudFormation change set created (preview)', stack: String(result.stackId).split('/')[1] || stack, profileId, details: { changeSet: result.changeSetName, parameters: Object.keys(parameters) } });
    res.json(result);
  } catch (err) { handleErr(res, err); }
});

router.post('/cloudformation/change-set/execute', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.body?.stack, res);
  if (!stack) return;
  const changeSet = requireChangeSet(req.body?.changeSet, res);
  if (!changeSet) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeChangeSetCommand, ExecuteChangeSetCommand, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
    const { describeChangeSet, executeChangeSet } = require('../lib/awsCloudFormation');
    const client = new CloudFormationClient(cfg);
    // Re-read the preview server-side: the decision never depends on what the UI sent.
    const preview = await describeChangeSet(client, { DescribeChangeSetCommand }, stack, changeSet);
    if (preview.status !== 'CREATE_COMPLETE' || preview.executionStatus !== 'AVAILABLE') {
      return res.status(409).json({ error: `The change set cannot be executed (${preview.status} / ${preview.executionStatus})` });
    }
    const described = await client.send(new DescribeStacksCommand({ StackName: stack }));
    const stackName = described.Stacks?.[0]?.StackName || stack;
    if (preview.risk.level !== 'low' && !confirmed(req.body, stackName)) {
      return res.status(400).json({ error: 'This change set removes or replaces resources: type the stack name to confirm', code: 'ConfirmationRequired', risk: preview.risk });
    }
    await executeChangeSet(client, { ExecuteChangeSetCommand }, stack, changeSet);
    cfnAudit({
      action: 'CloudFormation change set executed', stack: stackName, profileId, level: preview.risk.level === 'high' ? 'warning' : 'info',
      details: { changeSet: preview.name, risk: preview.risk, reason: String(req.body?.reason || '').slice(0, 500) },
    });
    res.json({ executed: true, risk: preview.risk });
  } catch (err) { handleErr(res, err); }
});

router.delete('/cloudformation/change-set', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  const changeSet = requireChangeSet(req.query.changeSet, res);
  if (!changeSet) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DeleteChangeSetCommand } = require('@aws-sdk/client-cloudformation');
    const { deleteChangeSet } = require('../lib/awsCloudFormation');
    await deleteChangeSet(new CloudFormationClient(cfg), { DeleteChangeSetCommand }, stack, changeSet);
    cfnAudit({ action: 'CloudFormation change set deleted', stack: String(stack).split('/')[1] || stack, profileId, details: { changeSet } });
    res.json({ deleted: true });
  } catch (err) { handleErr(res, err); }
});

// Turning protection OFF needs the typed stack name; turning it on does not.
router.post('/cloudformation/stack/termination-protection', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.body?.stack, res);
  if (!stack) return;
  const enabled = req.body?.enabled === true;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, UpdateTerminationProtectionCommand, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
    const { setTerminationProtection } = require('../lib/awsCloudFormation');
    const client = new CloudFormationClient(cfg);
    const described = await client.send(new DescribeStacksCommand({ StackName: stack }));
    const stackName = described.Stacks?.[0]?.StackName || stack;
    if (!enabled && !confirmed(req.body, stackName)) return res.status(400).json({ error: 'Type the stack name to turn termination protection off', code: 'ConfirmationRequired' });
    const result = await setTerminationProtection(client, { UpdateTerminationProtectionCommand }, stack, enabled);
    cfnAudit({ action: `CloudFormation termination protection ${enabled ? 'enabled' : 'disabled'}`, stack: stackName, profileId, level: enabled ? 'info' : 'warning' });
    res.json(result);
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudformation/stack/delete-preview', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.query.stack, res);
  if (!stack) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand, GetTemplateCommand, ListImportsCommand } = require('@aws-sdk/client-cloudformation');
    const { deletePreview } = require('../lib/awsCloudFormation');
    res.json(await deletePreview(new CloudFormationClient(cfg), { DescribeStacksCommand, ListStackResourcesCommand, GetTemplateCommand, ListImportsCommand }, stack));
  } catch (err) { handleErr(res, err); }
});

// Guarded delete: recomputes the preview, refuses with blockers, requires the typed name and a reason.
router.post('/cloudformation/stack/delete', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const stack = requireStackRef(req.body?.stack, res);
  if (!stack) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A reason is required to delete a stack' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand, GetTemplateCommand, ListImportsCommand, DeleteStackCommand } = require('@aws-sdk/client-cloudformation');
    const { deletePreview, deleteStack } = require('../lib/awsCloudFormation');
    const client = new CloudFormationClient(cfg);
    const preview = await deletePreview(client, { DescribeStacksCommand, ListStackResourcesCommand, GetTemplateCommand, ListImportsCommand }, stack);
    if (preview.blockers.length) return res.status(409).json({ error: `The stack cannot be deleted: ${preview.blockers.join(', ')}`, code: 'DeleteBlocked', blockers: preview.blockers });
    if (!confirmed(req.body, preview.stack.name)) return res.status(400).json({ error: 'Type the stack name to confirm the deletion', code: 'ConfirmationRequired' });
    await deleteStack(client, { DeleteStackCommand }, preview.stack.id);
    cfnAudit({
      action: 'CloudFormation stack deletion requested', stack: preview.stack.name, profileId, level: 'warning',
      details: { reason: reason.slice(0, 500), summary: preview.summary, risk: preview.risk },
    });
    res.json({ deleting: true, summary: preview.summary });
  } catch (err) { handleErr(res, err); }
});

// Operation history of a stack, from the local audit log.
router.get('/cloudformation/stack/history', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const name = String(req.query.name || '');
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(name)) return res.status(400).json({ error: 'Invalid stack name' });
  try {
    const entries = auditLog.getLogs({ category: 'aws', search: name, limit: 500 })
      .filter(entry => entry.details?.kind === 'cloudformation' && entry.details?.stack === name);
    res.json({ entries });
  } catch (err) { handleErr(res, err); }
});

module.exports = router;


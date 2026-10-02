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
 *   GET  /overview/advisor                  → good-practice checks (security, infra, architecture, development)
 *   GET  /cloudwatch/dashboards             → CloudWatch dashboards with console links
 *   GET  /cloudwatch/dashboards/:name       → dashboard definition and widget summary
 *   GET  /cloudwatch/dashboards/:name/widgets/:index/metrics       → series of a metric widget
 *   GET  /cloudwatch/dashboards/:name/widgets/:index/alarms        → states of an alarm widget
 *   GET  /cloudwatch/dashboards/:name/widgets/:index/logs/estimate → bytes a log widget would scan
 *   POST /cloudwatch/dashboards/:name/widgets/:index/logs/query    → start a log widget's Logs Insights query
 *   GET  /cloudwatch/logs-query/:queryId                           → Logs Insights query status and results
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
const { getMetricHistory } = require('../lib/metricHistory');
const { getCloudHistory } = require('../lib/cloudHistory');
const { classifyAwsError, buildAccessRequest } = require('../lib/awsAccess');
const { buildAwsInsights, createCostCache } = require('../lib/awsInsights');
const { buildAwsAdvisor } = require('../lib/advisor/aws');
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

router.get('/overview/advisor', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const key = `${profileId}|${cfg.region || ''}`;
    const cached = advisorCache.get(key);
    if (cached && req.query.refresh !== '1' && Date.now() - cached.at < ADVISOR_TTL_MS) {
      return res.json({ ...cached.report, fromCache: true });
    }
    const report = await buildAwsAdvisor(cfg);
    advisorCache.set(key, { at: Date.now(), report });
    res.json(report);
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
      logGroup:     f.LoggingConfig?.LogGroup || `/aws/lambda/${f.FunctionName}`,
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
    auditLog.log({
      category: 'aws', action: 'Lambda function invoked',
      resource: req.params.name, context: profileId,
    });
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
    const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { LambdaClient, GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
    const client       = new CloudWatchLogsClient(cfg);
    const limit        = Math.min(parseInt(req.query.limit) || 200, 500);
    const minutes      = Math.min(parseInt(req.query.minutes) || 60, 1440);
    const startTime    = Date.now() - minutes * 60 * 1000;

    // Functions may log to a custom group (LoggingConfig); fall back to the default name
    // if the configuration cannot be read.
    let logGroupName = `/aws/lambda/${req.params.name}`;
    try {
      const conf = await new LambdaClient(cfg).send(new GetFunctionConfigurationCommand({ FunctionName: req.params.name }));
      logGroupName = conf.LoggingConfig?.LogGroup || logGroupName;
    } catch { /* keep the default log group */ }

    let resp;
    try {
      resp = await client.send(new FilterLogEventsCommand({ logGroupName, limit, startTime }));
    } catch (err) {
      // Typed "no log group" answer instead of an error the UI has to parse.
      if (err.name === 'ResourceNotFoundException') return res.json({ logGroupName, logGroupStatus: 'missing', events: [] });
      throw err;
    }
    try {
      captureLambdaLogEvents({
        database: getApmDatabase(),
        profileId,
        region: cfg.region,
        functionName: req.params.name,
        logGroupName,
        events: resp.events || [],
      });
    } catch (captureError) {
      console.warn('[apm] Opportunistic Lambda capture failed:', captureError.message);
    }
    res.json({
      logGroupName,
      logGroupStatus: 'ok',
      events: (resp.events || []).map(e => ({
        timestamp:     e.timestamp,
        message:       e.message,
        logStreamName: e.logStreamName,
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /lambda/activity ───────────────────────────────────────────────────
// The client sends the functions it already listed (name + log group); the
// server validates them and reads metrics and log groups in bulk.

router.post('/lambda/activity', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const functions = validLambdaFunctions(req.body?.functions);
    if (!functions) return res.status(400).json({ error: 'Invalid function list' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const sdk = pkg => ({
      'client-cloudwatch': { CloudWatchClient, GetMetricDataCommand },
      'client-cloudwatch-logs': { CloudWatchLogsClient, DescribeLogGroupsCommand },
    })[pkg];
    res.json(await lambdaActivity(cfg, functions, { sdk }));
  } catch (err) { handleErr(res, err); }
});

// ─── POST /stepfunctions/activity ────────────────────────────────────────────

router.post('/stepfunctions/activity', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const machines = validStateMachines(req.body?.stateMachines);
    if (!machines) return res.status(400).json({ error: 'Invalid state machine list' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const { SFNClient, DescribeStateMachineCommand } = require('@aws-sdk/client-sfn');
    const sdk = pkg => ({
      'client-cloudwatch': { CloudWatchClient, GetMetricDataCommand },
      'client-sfn': { SFNClient, DescribeStateMachineCommand },
    })[pkg];
    res.json(await stepFunctionsActivity(cfg, machines, { sdk }));
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
    const args = ['apply', '-f', tmpFile, '--validate=false'];
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

// ─── SQS ──────────────────────────────────────────────────────────────────────
// SQS bills every API call as a request (first 1M/month free, then USD 0.40
// per million): listing N queues costs N+1 requests, a detail costs 2.
// Metric reads keep hourly points in the local metric history, so a detail
// only requests the metrics that were not read in the last `cacheMin` minutes.

// Shared history (APM database); a broken history never breaks the view.
function metricHistory() {
  try { return getMetricHistory(); } catch (err) { console.warn('[metric-history]', err.message); return null; }
}

function cacheTtlMs(req) {
  const minutes = Number(req.query.cacheMin || 15);
  return (minutes >= 1 && minutes <= 1440 ? minutes : 15) * 60 * 1000;
}

router.get('/sqs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
    const sdk = () => ({ SQSClient, ListQueuesCommand, GetQueueAttributesCommand });
    res.json(await listSqsQueues(cfg, { sdk }));
  } catch (err) { handleErr(res, err); }
});

router.post('/sqs/activity', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const queues = validQueueNames(req.body?.queues);
    if (!queues) return res.status(400).json({ error: 'Invalid queue list' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const sdk = () => ({ CloudWatchClient, GetMetricDataCommand });
    res.json(await sqsActivity(cfg, queues, { sdk, history: metricHistory(), profileId, region: cfg.region }));
  } catch (err) { handleErr(res, err); }
});

router.get('/sqs/:name/metrics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const hours = validHours(req.query.hours);
    if (!QUEUE_NAME_RE.test(req.params.name) || !hours) return res.status(400).json({ error: 'Invalid queue name or range' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const sdk = () => ({ CloudWatchClient, GetMetricDataCommand });
    res.json(await sqsQueueSeries(cfg, req.params.name, { sdk, hours, history: metricHistory(), ttlMs: cacheTtlMs(req), profileId, region: cfg.region }));
  } catch (err) { handleErr(res, err); }
});

router.get('/sqs/:name/details', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const url = String(req.query.url || '');
    if (!QUEUE_NAME_RE.test(req.params.name) || !QUEUE_URL_RE.test(url) || !url.endsWith(`/${req.params.name}`)) return res.status(400).json({ error: 'Invalid queue' });
    const cfg = await resolveAwsConfig(profileId);
    const { SQSClient, GetQueueAttributesCommand, ListQueueTagsCommand } = require('@aws-sdk/client-sqs');
    const { LambdaClient, ListEventSourceMappingsCommand } = require('@aws-sdk/client-lambda');
    const { SNSClient, ListSubscriptionsCommand } = require('@aws-sdk/client-sns');
    const sdk = pkg => ({
      'client-sqs': { SQSClient, GetQueueAttributesCommand, ListQueueTagsCommand },
      'client-lambda': { LambdaClient, ListEventSourceMappingsCommand },
      'client-sns': { SNSClient, ListSubscriptionsCommand },
    })[pkg];
    res.json(await sqsQueueDetails(cfg, url, { sdk }));
  } catch (err) { handleErr(res, err); }
});

// ─── SNS ──────────────────────────────────────────────────────────────────────

router.get('/sns', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SNSClient, ListTopicsCommand, ListSubscriptionsCommand, GetTopicAttributesCommand } = require('@aws-sdk/client-sns');
    const sdk = () => ({ SNSClient, ListTopicsCommand, ListSubscriptionsCommand, GetTopicAttributesCommand });
    res.json(await listSnsTopics(cfg, { sdk }));
  } catch (err) { handleErr(res, err); }
});

router.post('/sns/activity', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const topics = validTopics(req.body?.topics);
    if (!topics) return res.status(400).json({ error: 'Invalid topic list' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const sdk = pkg => ({
      'client-cloudwatch': { CloudWatchClient, GetMetricDataCommand },
      'client-cloudwatch-logs': { CloudWatchLogsClient, DescribeLogGroupsCommand },
    })[pkg];
    res.json(await snsActivity(cfg, topics, { sdk, history: metricHistory(), profileId, region: cfg.region }));
  } catch (err) { handleErr(res, err); }
});

router.get('/sns/:name/metrics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const hours = validHours(req.query.hours);
    if (!TOPIC_NAME_RE.test(req.params.name) || !hours) return res.status(400).json({ error: 'Invalid topic name or range' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const sdk = () => ({ CloudWatchClient, GetMetricDataCommand });
    res.json(await snsTopicSeries(cfg, req.params.name, { sdk, hours, history: metricHistory(), ttlMs: cacheTtlMs(req), profileId, region: cfg.region }));
  } catch (err) { handleErr(res, err); }
});

router.get('/sns/:name/details', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const arn = String(req.query.arn || '');
    if (!TOPIC_ARN_RE.test(arn) || !arn.endsWith(`:${req.params.name}`)) return res.status(400).json({ error: 'Invalid topic' });
    const cfg = await resolveAwsConfig(profileId);
    const {
      SNSClient, GetTopicAttributesCommand, ListSubscriptionsByTopicCommand, GetSubscriptionAttributesCommand, ListTagsForResourceCommand,
    } = require('@aws-sdk/client-sns');
    const sdk = () => ({ SNSClient, GetTopicAttributesCommand, ListSubscriptionsByTopicCommand, GetSubscriptionAttributesCommand, ListTagsForResourceCommand });
    res.json(await snsTopicDetails(cfg, arn, { sdk }));
  } catch (err) { handleErr(res, err); }
});

// Delivery status logs (FilterLogEvents: no per-GB charge, unlike Logs Insights).
router.get('/sns/:name/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const arn = String(req.query.arn || '');
    const hours = validHours(req.query.hours);
    const status = req.query.status === 'failure' ? 'failure' : 'all';
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    if (!TOPIC_ARN_RE.test(arn) || !arn.endsWith(`:${req.params.name}`) || !hours) return res.status(400).json({ error: 'Invalid topic or range' });
    const force = req.query.force === '1';
    const arnRegion = awsRegionFromArn(arn);
    let cfg;
    try { cfg = await resolveAwsConfig(profileId); } catch (err) {
      const cached = readCloudSnapshot({ profileId, region: arnRegion, resourceKey: `${arn}:${status}:${hours}:${limit}`, kind: 'sns-delivery', allowExpired: true });
      if (cached) return res.json(cached.payload);
      throw err;
    }
    const snapshotKey = { profileId, region: cfg.region, resourceKey: `${arn}:${status}:${hours}:${limit}`, kind: 'sns-delivery' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const sdk = () => ({ CloudWatchLogsClient, FilterLogEventsCommand });
    const data = await snsDeliveryLogs(cfg, arn, { sdk, hours, status, limit });
    const now = Date.now();
    const eventKind = 'sns-delivery-event';
    for (const event of data.events || []) {
      writeCloudSnapshot({
        profileId, region: cfg.region, resourceKey: arn, kind: eventKind,
        payload: event, capturedAt: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : now,
        ttlMs: cacheTtlMs(req), metadata: { topicArn: arn },
      });
    }
    const historic = readCloudRange({
      profileId, region: cfg.region, resourceKey: arn, kind: eventKind,
      from: now - hours * 3600000, to: now + 1, limit: 5000,
    }).map(row => row.payload).filter(event => status !== 'failure' || event?.status !== 'SUCCESS');
    const seen = new Set();
    const events = [...historic, ...(data.events || [])]
      .filter(event => {
        const id = `${event?.timestamp || ''}|${event?.kind || ''}|${event?.messageId || ''}|${event?.destination || ''}|${event?.statusCode || ''}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, limit);
    const payload = {
      ...data,
      events,
      counts: { success: events.filter(e => e.status === 'SUCCESS').length, failure: events.filter(e => e.status !== 'SUCCESS').length },
    };
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req), metadata: { topicArn: arn } });
    res.json(payload);
  } catch (err) {
    const arn = String(req.query.arn || '');
    const cached = readCloudSnapshot({ profileId, region: awsRegionFromArn(arn), resourceKey: `${arn}:${status}:${hours}:${limit}`, kind: 'sns-delivery', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── SES (v2) ─────────────────────────────────────────────────────────────────

router.get('/ses', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const {
      SESv2Client, GetAccountCommand, ListEmailIdentitiesCommand, GetEmailIdentityCommand,
      ListConfigurationSetsCommand, GetConfigurationSetEventDestinationsCommand,
    } = require('@aws-sdk/client-sesv2');
    const sdk = () => ({
      SESv2Client, GetAccountCommand, ListEmailIdentitiesCommand, GetEmailIdentityCommand,
      ListConfigurationSetsCommand, GetConfigurationSetEventDestinationsCommand,
    });
    res.json(await sesOverview(cfg, { sdk }));
  } catch (err) { handleErr(res, err); }
});

// Account-level sending metrics with history, plus health with the latest rates.
router.get('/ses/metrics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const hours = validHours(req.query.hours);
    if (!hours) return res.status(400).json({ error: 'Invalid range' });
    const cfg = await resolveAwsConfig(profileId);
    const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const { SESv2Client, GetAccountCommand } = require('@aws-sdk/client-sesv2');
    const sdk = () => ({ CloudWatchClient, GetMetricDataCommand });
    const [data, account] = await Promise.all([
      sesSeries(cfg, { sdk, hours, history: metricHistory(), ttlMs: cacheTtlMs(req), profileId }),
      new SESv2Client(cfg).send(new GetAccountCommand({})).catch(() => null),
    ]);
    const rates = latestRates(data.series);
    const accountRow = account ? {
      sendingEnabled: account.SendingEnabled !== false,
      productionAccess: !!account.ProductionAccessEnabled,
      enforcementStatus: account.EnforcementStatus || null,
      max24HourSend: account.SendQuota?.Max24HourSend ?? null,
      sentLast24Hours: account.SendQuota?.SentLast24Hours ?? null,
    } : null;
    res.json({ ...data, totals: seriesTotals(data.series), rates, health: sesHealth(accountRow, rates) });
  } catch (err) { handleErr(res, err); }
});

router.get('/ses/suppression', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SESv2Client, ListSuppressedDestinationsCommand } = require('@aws-sdk/client-sesv2');
    const sdk = () => ({ SESv2Client, ListSuppressedDestinationsCommand });
    res.json(await sesSuppression(cfg, { sdk }));
  } catch (err) { handleErr(res, err); }
});

// ?estimate=1 only counts the metrics (ListMetrics) so the UI can show the cost first.
router.get('/ses/configuration-sets/:name/metrics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const hours = validHours(req.query.hours);
    if (!SET_NAME_RE.test(req.params.name) || !hours) return res.status(400).json({ error: 'Invalid configuration set or range' });
    const cfg = await resolveAwsConfig(profileId);
    const { SESv2Client, GetConfigurationSetEventDestinationsCommand } = require('@aws-sdk/client-sesv2');
    const { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand } = require('@aws-sdk/client-cloudwatch');
    const sdk = pkg => ({
      'client-sesv2': { SESv2Client, GetConfigurationSetEventDestinationsCommand },
      'client-cloudwatch': { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand },
    })[pkg];
    res.json(await sesConfigurationSetMetrics(cfg, req.params.name, {
      sdk, hours, estimate: req.query.estimate === '1', history: metricHistory(), ttlMs: cacheTtlMs(req), profileId,
    }));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /metrics/history ─────────────────────────────────────────────────────
// Reads stored metric history only (no AWS calls, no cost). Meant for views and,
// later, KUA Applications: ?identity=AWS::SQS::Queue:orders&metrics=sent,received&hours=168

router.get('/metrics/history', (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const identity = String(req.query.identity || '');
    const metrics = String(req.query.metrics || '').split(',').filter(Boolean);
    const hours = Number(req.query.hours || 24);
    if (!/^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+:[^\s]{1,300}$/.test(identity) || !metrics.length || metrics.length > 50 || !(hours >= 1 && hours <= 24 * 400)) {
      return res.status(400).json({ error: 'identity, metrics (1–50) and hours are required' });
    }
    const history = metricHistory();
    if (!history) return res.status(503).json({ error: 'Metric history is not available' });
    const region = String(req.query.region || '');
    const to = Math.floor(Date.now() / 3600000) * 3600000 + 3600000;
    const from = to - hours * 3600000;
    const series = {};
    const coverage = {};
    for (const metric of metrics) {
      const item = { provider: 'aws', profileId, region, resourceId: identity, metric, periodS: 3600 };
      series[metric] = history.read(item, { from, to });
      coverage[metric] = history.coverage(item);
    }
    res.json({ identity, windowHours: hours, series, coverage });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /stepfunctions ───────────────────────────────────────────────────────

router.get('/stepfunctions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const force = req.query.force === '1';
  try {
    const cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey: 'catalog', kind: 'stepfunctions-catalog' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { SFNClient, ListStateMachinesCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListStateMachinesCommand({ maxResults: 1000, nextToken }));
      all.push(...(resp.stateMachines || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    const payload = all.map(sm => ({
      name:         sm.name,
      arn:          sm.stateMachineArn,
      type:         sm.type,
      creationDate: sm.creationDate,
    }));
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req) });
    res.json(payload);
  } catch (err) {
    const cfg = await resolveAwsConfig(profileId).catch(() => null);
    const cached = cfg && readCloudSnapshot({ profileId, region: cfg.region, resourceKey: 'catalog', kind: 'stepfunctions-catalog', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── GET /stepfunctions/config ────────────────────────────────────────────────

router.get('/stepfunctions/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn } = req.query;
  if (!arn) return res.status(400).json({ error: 'arn query param required' });
  const force = req.query.force === '1';
  try {
    const cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey: arn, kind: 'stepfunctions-config' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { SFNClient, DescribeStateMachineCommand, ListExecutionsCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const [detail, executions] = await Promise.allSettled([
      client.send(new DescribeStateMachineCommand({ stateMachineArn: arn })),
      client.send(new ListExecutionsCommand({ stateMachineArn: arn, maxResults: 10 })),
    ]);
    const payload = {
      stateMachine:     detail.status     === 'fulfilled' ? detail.value : null,
      recentExecutions: executions.status === 'fulfilled' ? (executions.value.executions ?? []) : [],
    };
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req) });
    res.json(payload);
  } catch (err) {
    const cfg = await resolveAwsConfig(profileId).catch(() => null);
    const cached = cfg && readCloudSnapshot({ profileId, region: cfg.region, resourceKey: arn, kind: 'stepfunctions-config', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── GET /stepfunctions/execution/events ─────────────────────────────────────

router.get('/stepfunctions/execution/events', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { executionArn } = req.query;
  if (!executionArn) return res.status(400).json({ error: 'executionArn query param required' });
  const force = req.query.force === '1';
  try {
    const cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey: executionArn, kind: 'stepfunctions-execution-events' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { SFNClient, GetExecutionHistoryCommand, DescribeStateMachineForExecutionCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const definition = client.send(new DescribeStateMachineForExecutionCommand({ executionArn }))
      .then(detail => detail.definition || null)
      .catch(() => null);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new GetExecutionHistoryCommand({
        executionArn, maxResults: 1000, includeExecutionData: true, nextToken,
      }));
      all.push(...(resp.events || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    const payload = { events: all, definition: await definition };
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req) });
    res.json(payload);
  } catch (err) {
    const cfg = await resolveAwsConfig(profileId).catch(() => null);
    const cached = cfg && readCloudSnapshot({ profileId, region: cfg.region, resourceKey: executionArn, kind: 'stepfunctions-execution-events', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── GET /stepfunctions/executions/count ─────────────────────────────────────

router.get('/stepfunctions/executions/count', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn } = req.query;
  if (!arn) return res.status(400).json({ error: 'arn query param required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SFNClient, ListExecutionsCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const [runningRes, failedRes, timedOutRes] = await Promise.allSettled([
      client.send(new ListExecutionsCommand({ stateMachineArn: arn, statusFilter: 'RUNNING',   maxResults: 1000 })),
      client.send(new ListExecutionsCommand({ stateMachineArn: arn, statusFilter: 'FAILED',    maxResults: 100  })),
      client.send(new ListExecutionsCommand({ stateMachineArn: arn, statusFilter: 'TIMED_OUT', maxResults: 100  })),
    ]);
    res.json({
      running:   runningRes.status  === 'fulfilled' ? (runningRes.value.executions?.length  || 0) : 0,
      failed:    failedRes.status   === 'fulfilled' ? (failedRes.value.executions?.length   || 0) : 0,
      timedOut:  timedOutRes.status === 'fulfilled' ? (timedOutRes.value.executions?.length || 0) : 0,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /stepfunctions/versions ─────────────────────────────────────────────

router.get('/stepfunctions/versions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn } = req.query;
  if (!arn) return res.status(400).json({ error: 'arn query param required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SFNClient, ListStateMachineVersionsCommand, DescribeStateMachineCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListStateMachineVersionsCommand({ stateMachineArn: arn, maxResults: 100, nextToken }));
      all.push(...(resp.stateMachineVersions || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json({ versions: all });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /stepfunctions/versions/definition ───────────────────────────────────

router.get('/stepfunctions/versions/definition', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { arn } = req.query;
  if (!arn) return res.status(400).json({ error: 'arn query param required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { SFNClient, DescribeStateMachineCommand } = require('@aws-sdk/client-sfn');
    const client = new SFNClient(cfg);
    const resp = await client.send(new DescribeStateMachineCommand({ stateMachineArn: arn }));
    res.json({ definition: resp.definition ?? null, name: resp.name, stateMachineVersionArn: arn });
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

// ─── GET /eks/:name/details ───────────────────────────────────────────────────
// AWS infrastructure of the cluster: VPC, subnets, SGs, node groups, EC2 nodes, add-ons

router.get('/eks/:name/details', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { EKSClient } = require('@aws-sdk/client-eks');
    const { EC2Client } = require('@aws-sdk/client-ec2');
    const details = await getEksDetails({ eks: new EKSClient(cfg), ec2: new EC2Client(cfg) }, req.params.name);
    res.json({ region: cfg.region, ...details });
  } catch (err) { handleErr(res, err); }
});

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

    try {
      captureLambdaCloudWatchMetrics({
        database: getApmDatabase(),
        profileId,
        region: cfg.region,
        functionName: name,
        logGroupName: cfg2?.LoggingConfig?.LogGroup || `/aws/lambda/${name}`,
        metrics,
      });
    } catch (captureError) {
      console.warn('[apm] Opportunistic Lambda metrics capture failed:', captureError.message);
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
    auditLog.log({
      category: 'aws', action: 'EKS cluster added to kubeconfig',
      resource: req.params.name, details: { context: contextName },
      context: profileId,
    });
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

// GET /glue/databases/:db/tables  → list tables in a Glue database
router.get('/glue/databases/:db/tables', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { GlueClient, GetTablesCommand } = require('@aws-sdk/client-glue');
    const client = new GlueClient(cfg);
    const resp = await client.send(new GetTablesCommand({ DatabaseName: req.params.db, MaxResults: 100 }));
    res.json((resp.TableList || []).map(t => ({
      name:        t.Name,
      tableType:   t.TableType,
      location:    t.StorageDescriptor?.Location,
      inputFormat: t.StorageDescriptor?.InputFormat,
      columns:     (t.StorageDescriptor?.Columns || []).map(c => ({ name: c.Name, type: c.Type })),
      partitions:  (t.PartitionKeys || []).map(c => ({ name: c.Name, type: c.Type })),
      createTime:  t.CreateTime,
      updateTime:  t.UpdateTime,
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
// ─── AMAZON RDS ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /rds  → list RDS instances
router.get('/rds', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
    const client = new RDSClient(cfg);

    const instances = [];
    let marker;
    do {
      const resp = await client.send(new DescribeDBInstancesCommand({ Marker: marker }));
      instances.push(...(resp.DBInstances || []));
      marker = resp.Marker;
    } while (marker);

    res.json(instances.map(db => ({
      id:            db.DBInstanceIdentifier,
      arn:           db.DBInstanceArn,
      masterUsername: db.MasterUsername,
      dbName:        db.DBName || null,
      engine:        db.Engine,
      engineVersion: db.EngineVersion,
      class:         db.DBInstanceClass,
      status:        db.DBInstanceStatus,
      endpoint:      db.Endpoint?.Address || null,
      port:          db.Endpoint?.Port || null,
      az:            db.AvailabilityZone,
      multiAZ:       db.MultiAZ,
      public:        db.PubliclyAccessible,
      storageGb:     db.AllocatedStorage,
      createdAt:     db.InstanceCreateTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /rds/:id/config  → full instance details
router.get('/rds/:id/config', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { RDSClient, DescribeDBInstancesCommand, ListTagsForResourceCommand } = require('@aws-sdk/client-rds');
    const client = new RDSClient(cfg);
    const resp = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: req.params.id }));
    const db = resp.DBInstances?.[0];
    if (!db) return res.status(404).json({ error: 'RDS instance not found' });

    let tags = [];
    if (db.DBInstanceArn) {
      try {
        const tagsResp = await client.send(new ListTagsForResourceCommand({ ResourceName: db.DBInstanceArn }));
        tags = (tagsResp.TagList || []).map(t => ({ key: t.Key, value: t.Value }));
      } catch {
        tags = [];
      }
    }

    res.json({
      id:                 db.DBInstanceIdentifier,
      arn:                db.DBInstanceArn,
      engine:             db.Engine,
      engineVersion:      db.EngineVersion,
      status:             db.DBInstanceStatus,
      class:              db.DBInstanceClass,
      endpoint:           db.Endpoint?.Address || null,
      port:               db.Endpoint?.Port || null,
      dbName:             db.DBName || null,
      masterUsername:     db.MasterUsername || null,
      storageGb:          db.AllocatedStorage,
      storageType:        db.StorageType,
      multiAZ:            db.MultiAZ,
      public:             db.PubliclyAccessible,
      az:                 db.AvailabilityZone,
      backupRetention:    db.BackupRetentionPeriod,
      preferredBackupWindow: db.PreferredBackupWindow,
      preferredMaintenanceWindow: db.PreferredMaintenanceWindow,
      deletionProtection: db.DeletionProtection,
      kmsKeyId:           db.KmsKeyId || null,
      createdAt:          db.InstanceCreateTime,
      vpcSecurityGroups:  (db.VpcSecurityGroups || []).map(sg => ({ id: sg.VpcSecurityGroupId, status: sg.Status })),
      subnetGroup:        db.DBSubnetGroup?.DBSubnetGroupName || null,
      parameterGroups:    (db.DBParameterGroups || []).map(pg => ({ name: pg.DBParameterGroupName, status: pg.ParameterApplyStatus })),
      optionGroups:       (db.OptionGroupMemberships || []).map(og => ({ name: og.OptionGroupName, status: og.Status })),
      storageEncrypted:   !!db.StorageEncrypted,
      autoMinorVersionUpgrade: !!db.AutoMinorVersionUpgrade,
      iamDatabaseAuthenticationEnabled: !!db.IAMDatabaseAuthenticationEnabled,
      networkType:        db.NetworkType || null,
      caCertificateIdentifier: db.CACertificateIdentifier || null,
      maxAllocatedStorage: db.MaxAllocatedStorage ?? null,
      monitoringInterval: db.MonitoringInterval ?? null,
      monitoringRoleArn:  db.MonitoringRoleArn || null,
      performanceInsightsEnabled: !!db.PerformanceInsightsEnabled,
      performanceInsightsRetentionPeriod: db.PerformanceInsightsRetentionPeriod ?? null,
      enabledCloudwatchLogsExports: db.EnabledCloudwatchLogsExports || [],
      copyTagsToSnapshot: !!db.CopyTagsToSnapshot,
      latestRestorableTime: db.LatestRestorableTime || null,
      backupTarget:       db.BackupTarget || null,
      readReplicaSourceDBInstanceIdentifier: db.ReadReplicaSourceDBInstanceIdentifier || null,
      readReplicaDBInstanceIdentifiers: db.ReadReplicaDBInstanceIdentifiers || [],
      readReplicaDBClusterIdentifiers: db.ReadReplicaDBClusterIdentifiers || [],
      replicaMode:        db.ReplicaMode || null,
      tags,
    });
  } catch (err) { handleErr(res, err); }
});

// GET /rds/:id/connection-strings  → build connection templates by engine
router.get('/rds/:id/connection-strings', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
    const client = new RDSClient(cfg);
    const resp = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: req.params.id }));
    const db = resp.DBInstances?.[0];
    if (!db) return res.status(404).json({ error: 'RDS instance not found' });

    const engine = (db.Engine || '').toLowerCase();
    const host = db.Endpoint?.Address;
    const port = db.Endpoint?.Port;
    const user = db.MasterUsername || '<USER>';
    const dbName = db.DBName || '<DB_NAME>';
    if (!host || !port) return res.status(400).json({ error: 'RDS endpoint is not available yet' });

    const templates = {
      psql: null,
      mysql: null,
      sqlcmd: null,
      jdbc: null,
      notes: [
        'Reemplaza <PASSWORD> por la contraseña del usuario master.',
        'Asegura acceso de red (Security Group, NACL, ruta/VPN) antes de conectar.',
      ],
    };

    if (engine.startsWith('postgres')) {
      templates.psql = `psql "host=${host} port=${port} dbname=${dbName} user=${user} password=<PASSWORD> sslmode=require"`;
      templates.jdbc = `jdbc:postgresql://${host}:${port}/${dbName}?sslmode=require`;
    } else if (engine.includes('mysql') || engine.includes('mariadb')) {
      templates.mysql = `mysql -h ${host} -P ${port} -u ${user} -p${'<PASSWORD>'} ${dbName}`;
      templates.jdbc = `jdbc:mysql://${host}:${port}/${dbName}?sslMode=REQUIRED`;
    } else if (engine.startsWith('sqlserver')) {
      templates.sqlcmd = `sqlcmd -S ${host},${port} -U ${user} -P "<PASSWORD>" -d ${dbName} -N`;
      templates.jdbc = `jdbc:sqlserver://${host}:${port};databaseName=${dbName};encrypt=true;trustServerCertificate=false;`;
    } else {
      templates.jdbc = `jdbc:${engine}://${host}:${port}/${dbName}`;
      templates.notes.push(`Motor detectado: ${db.Engine}. Usa el cliente nativo correspondiente.`);
    }

    res.json({
      id: db.DBInstanceIdentifier,
      engine: db.Engine,
      host,
      port,
      masterUsername: user,
      dbName,
      templates,
    });
  } catch (err) { handleErr(res, err); }
});

// POST /rds/:id/reset-password  → reset master user password
router.post('/rds/:id/reset-password', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { RDSClient, ModifyDBInstanceCommand } = require('@aws-sdk/client-rds');
    const client = new RDSClient(cfg);
    await client.send(new ModifyDBInstanceCommand({
      DBInstanceIdentifier: req.params.id,
      MasterUserPassword: newPassword,
      ApplyImmediately: true,
    }));

    auditLog.log({
      category: 'aws',
      action: 'RDS password reset',
      resource: req.params.id,
      level: 'critical',
      context: profileId,
    });
    res.json({ ok: true, message: `Password reset initiated for RDS instance ${req.params.id}.` });
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
    auditLog.log({
      category: 'aws', action: 'DocumentDB password reset',
      resource: req.params.id, level: 'critical',
      context: profileId,
    });
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

// PUT /dynamodb/:table/item  → put (create or replace) an item
router.put('/dynamodb/:table/item', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { table } = req.params;
    const { item } = req.body || {};
    if (!item || typeof item !== 'object') return res.status(400).json({ error: 'item object is required' });
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
    const { marshall } = require('@aws-sdk/util-dynamodb');
    const client = new DynamoDBClient(cfg);
    await client.send(new PutItemCommand({ TableName: table, Item: marshall(item, { removeUndefinedValues: true }) }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// DELETE /dynamodb/:table/item  → delete an item by key
router.delete('/dynamodb/:table/item', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { table } = req.params;
    const { key } = req.body || {};
    if (!key || typeof key !== 'object') return res.status(400).json({ error: 'key object is required' });
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
    const { marshall } = require('@aws-sdk/util-dynamodb');
    const client = new DynamoDBClient(cfg);
    await client.send(new DeleteItemCommand({ TableName: table, Key: marshall(key, { removeUndefinedValues: true }) }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// POST /dynamodb  → create a new DynamoDB table
router.post('/dynamodb', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { tableName, partitionKey, partitionKeyType = 'S', sortKey, sortKeyType = 'S', billingMode = 'PAY_PER_REQUEST', readCapacity = 5, writeCapacity = 5 } = req.body || {};
    if (!tableName || !partitionKey) return res.status(400).json({ error: 'tableName and partitionKey are required' });
    const cfg = await resolveAwsConfig(profileId);
    const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
    const client = new DynamoDBClient(cfg);
    const attrDefs = [{ AttributeName: partitionKey, AttributeType: partitionKeyType }];
    const keySchema = [{ AttributeName: partitionKey, KeyType: 'HASH' }];
    if (sortKey) {
      attrDefs.push({ AttributeName: sortKey, AttributeType: sortKeyType });
      keySchema.push({ AttributeName: sortKey, KeyType: 'RANGE' });
    }
    const params = { TableName: tableName, AttributeDefinitions: attrDefs, KeySchema: keySchema, BillingMode: billingMode };
    if (billingMode === 'PROVISIONED') params.ProvisionedThroughput = { ReadCapacityUnits: Number(readCapacity), WriteCapacityUnits: Number(writeCapacity) };
    const resp = await client.send(new CreateTableCommand(params));
    res.json({ tableName: resp.TableDescription?.TableName, status: resp.TableDescription?.TableStatus });
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

// GET /athena/databases  → list named query databases / data catalogs
router.get('/athena/databases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, ListDataCatalogsCommand, ListDatabasesCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const resp = await client.send(new ListDataCatalogsCommand({}));
    const catalogs = (resp.DataCatalogsSummary || []);
    // For each catalog, also list its databases
    const withDbs = await Promise.all(catalogs.map(async c => {
      try {
        const dbResp = await client.send(new ListDatabasesCommand({ CatalogName: c.CatalogName, MaxResults: 50 }));
        const databases = (dbResp.DatabaseList || []).map(d => ({ name: d.Name, description: d.Description || '' }));
        return { name: c.CatalogName, type: c.Type, description: c.Description || '', databases };
      } catch { return { name: c.CatalogName, type: c.Type, description: c.Description || '', databases: [] }; }
    }));
    res.json(withDbs);
  } catch (err) { handleErr(res, err); }
});

// GET /athena/catalogs/:catalog/databases/:db/tables  → list tables in a database
router.get('/athena/catalogs/:catalog/databases/:db/tables', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, ListTableMetadataCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const resp = await client.send(new ListTableMetadataCommand({
      CatalogName: req.params.catalog,
      DatabaseName: req.params.db,
      MaxResults: 50,
    }));
    res.json((resp.TableMetadataList || []).map(t => ({
      name:        t.Name,
      tableType:   t.TableType,
      columns:     (t.Columns || []).map(c => ({ name: c.Name, type: c.Type })),
      partitions:  (t.PartitionKeys || []).map(c => ({ name: c.Name, type: c.Type })),
      createTime:  t.CreateTime,
      lastAccess:  t.LastAccessTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /athena/history  → list recent query executions (last 20)
router.get('/athena/history', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { workgroup = 'primary' } = req.query;
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, ListQueryExecutionsCommand, GetQueryExecutionCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const list = await client.send(new ListQueryExecutionsCommand({ WorkGroup: workgroup, MaxResults: 20 }));
    const ids = list.QueryExecutionIds || [];
    if (!ids.length) return res.json([]);
    const execs = await Promise.all(ids.map(id =>
      client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }))
        .then(r => r.QueryExecution).catch(() => null)
    ));
    res.json(execs.filter(Boolean).map(e => ({
      id:            e.QueryExecutionId,
      query:         e.Query,
      state:         e.Status?.State,
      submittedAt:   e.Status?.SubmissionDateTime,
      completedAt:   e.Status?.CompletionDateTime,
      bytesScanned:  e.Statistics?.DataScannedInBytes,
      execTimeMs:    e.Statistics?.TotalExecutionTimeInMillis,
      workgroup:     e.WorkGroup,
      database:      e.QueryExecutionContext?.Database,
      catalog:       e.QueryExecutionContext?.Catalog,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /athena/workgroups/:name  → get full workgroup configuration
router.get('/athena/workgroups/:name', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, GetWorkGroupCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const r = await client.send(new GetWorkGroupCommand({ WorkGroup: req.params.name }));
    const wg = r.WorkGroup;
    const conf = wg.Configuration || {};
    res.json({
      name:                       wg.Name,
      description:                wg.Description || '',
      state:                      wg.State,
      creationTime:               wg.CreationTime,
      outputLocation:             conf.ResultConfiguration?.OutputLocation || '',
      encryptionOption:           conf.ResultConfiguration?.EncryptionConfiguration?.EncryptionOption || '',
      kmsKey:                     conf.ResultConfiguration?.EncryptionConfiguration?.KmsKey || '',
      enforceWorkGroupConfig:     conf.EnforceWorkGroupConfiguration ?? false,
      publishCloudWatchMetrics:   conf.PublishCloudWatchMetricsEnabled ?? false,
      bytesScannedCutoff:         conf.BytesScannedCutoffPerQuery ?? null,
      requesterPays:              conf.RequesterPaysEnabled ?? false,
      selectedEngineVersion:      conf.EngineVersion?.SelectedEngineVersion || '',
      effectiveEngineVersion:     conf.EngineVersion?.EffectiveEngineVersion || '',
      executionRole:              conf.ExecutionRole || '',
      totalBytesScanned:          wg.Statistics?.TotalBytesScanned ?? 0,
      totalQueryCount:            wg.Statistics?.TotalQueryCount ?? 0,
    });
  } catch (err) { handleErr(res, err); }
});

// GET /athena/catalogs/:catalog  → get full data catalog configuration
router.get('/athena/catalogs/:catalog', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { AthenaClient, GetDataCatalogCommand, ListDatabasesCommand } = require('@aws-sdk/client-athena');
    const client = new AthenaClient(cfg);
    const r = await client.send(new GetDataCatalogCommand({ Name: req.params.catalog }));
    const cat = r.DataCatalog;
    // Also fetch database count
    let dbCount = 0;
    try {
      const dbs = await client.send(new ListDatabasesCommand({ CatalogName: req.params.catalog, MaxResults: 1 }));
      dbCount = dbs.DatabaseList?.length ?? 0;
    } catch { /* ignore */ }
    res.json({
      name:        cat.Name,
      type:        cat.Type,
      description: cat.Description || '',
      parameters:  cat.Parameters || {},
      dbCount,
    });
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
    const sets = [];
    let next = {};
    do {
      const resp = await client.send(new ListResourceRecordSetsCommand({ HostedZoneId: req.params.id, ...next }));
      sets.push(...(resp.ResourceRecordSets || []));
      next = resp.IsTruncated
        ? { StartRecordName: resp.NextRecordName, StartRecordType: resp.NextRecordType, StartRecordIdentifier: resp.NextRecordIdentifier }
        : null;
    } while (next);
    res.json(sets.map(r => ({
      name:          r.Name,
      type:          r.Type,
      ttl:           r.TTL,
      setIdentifier: r.SetIdentifier || null,
      records:       (r.ResourceRecords || []).map(rr => rr.Value),
      alias:         r.AliasTarget ? { dnsName: r.AliasTarget.DNSName, zoneId: r.AliasTarget.HostedZoneId } : null,
    })));
  } catch (err) { handleErr(res, err); }
});

// POST /route53/validate  → validate public resolution of a DNS record
router.post('/route53/validate', async (req, res) => {
  const { hostname, type, selector, checkTcp } = req.body || {};
  if (!hostname || !type) {
    return res.status(400).json({ error: 'Missing hostname or type' });
  }

  try {
    const DNSValidator = require('../lib/dnsValidator');
    const result = await DNSValidator.validate(hostname, type, { selector, checkTcp: checkTcp === true });
    res.json(result);
  } catch (err) {
    res.json({ status: 'ERROR', values: [], message: err.message });
  }
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
    const rawFilter = (req.query.filter || '').trim();
    const isAwsFilter = /^[A-Za-z_][\w:.-]*\s*(=|\^=|\$=|\*=|!=|<=|>=)\s*".*"$/.test(rawFilter);
    const params = {
      UserPoolId:       req.params.id,
      Limit:            parseInt(req.query.limit || '60', 10),
      PaginationToken:  req.query.paginationToken || undefined,
    };
    const attrMap = (attrs) => {
      const m = {};
      for (const a of (attrs || [])) m[a.Name] = a.Value;
      return m;
    };

    if (!rawFilter || isAwsFilter) {
      if (rawFilter) params.Filter = rawFilter;
      const resp = await client.send(new ListUsersCommand(params));
      return res.json({
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
          mfaEnabled:    (u.UserMFASettingList || []).length > 0 || !!u.PreferredMfaSetting || (u.MFAOptions || []).length > 0,
          mfaSettingList: u.UserMFASettingList || [],
          preferredMfa:  u.PreferredMfaSetting || null,
          mfaOptions:    u.MFAOptions || [],
        })),
        paginationToken: resp.PaginationToken || null,
      });
    }

    const term = rawFilter.toLowerCase();
    const limit = Math.max(1, parseInt(req.query.limit || '60', 10));
    const allUsers = [];
    let nextToken = req.query.paginationToken || undefined;
    do {
      const resp = await client.send(new ListUsersCommand({
        UserPoolId: req.params.id,
        Limit: 60,
        PaginationToken: nextToken,
      }));
      allUsers.push(...(resp.Users || []));
      nextToken = resp.PaginationToken || null;
    } while (nextToken);

    const matched = allUsers.filter(u => {
      const attrs = attrMap(u.Attributes);
      const haystack = [
        u.Username,
        attrs.email,
        attrs.phone_number,
        ...Object.values(attrs),
      ].filter(Boolean).map(v => String(v).toLowerCase());
      return haystack.some(value => value.includes(term));
    });

    return res.json({
      users: matched.slice(0, limit).map(u => ({
        username:      u.Username,
        status:        u.UserStatus,
        enabled:       u.Enabled,
        created:       u.UserCreateDate,
        modified:      u.UserLastModifiedDate,
        attributes:    attrMap(u.Attributes),
        email:         attrMap(u.Attributes)['email'] || null,
        emailVerified: attrMap(u.Attributes)['email_verified'] === 'true',
        phone:         attrMap(u.Attributes)['phone_number'] || null,
        mfaEnabled:    (u.UserMFASettingList || []).length > 0 || !!u.PreferredMfaSetting || (u.MFAOptions || []).length > 0,
        mfaSettingList: u.UserMFASettingList || [],
        preferredMfa:  u.PreferredMfaSetting || null,
        mfaOptions:    u.MFAOptions || [],
      })),
      paginationToken: null,
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

// GET /cognito/userpools/:id/users/:username/groups  → list groups for a user
router.get('/cognito/userpools/:id/users/:username/groups', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminListGroupsForUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    const resp = await client.send(new AdminListGroupsForUserCommand({
      UserPoolId: req.params.id,
      Username:   req.params.username,
    }));
    res.json((resp.Groups || []).map(g => ({
      name:         g.GroupName,
      description:  g.Description || '',
      precedence:   g.Precedence ?? null,
      roleArn:      g.RoleArn || null,
      lastModified: g.LastModifiedDate || null,
      createdDate:  g.CreationDate || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// PATCH /cognito/userpools/:id/users/:username  → update mutable user attributes
router.patch('/cognito/userpools/:id/users/:username', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { attributes } = req.body || {};
    if (!attributes || typeof attributes !== 'object') {
      return res.status(400).json({ error: 'attributes object is required' });
    }
    const userAttributes = [];
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      userAttributes.push({ Name: name, Value: String(value) });
    }
    if (!userAttributes.length) return res.status(400).json({ error: 'No attributes to update' });
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminUpdateUserAttributesCommand({
      UserPoolId:     req.params.id,
      Username:       req.params.username,
      UserAttributes: userAttributes,
    }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// POST /cognito/userpools/:id/users/:username/groups/:groupname  → add user to group
router.post('/cognito/userpools/:id/users/:username/groups/:groupname', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminAddUserToGroupCommand({
      UserPoolId: req.params.id,
      Username:   req.params.username,
      GroupName:  req.params.groupname,
    }));
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// DELETE /cognito/userpools/:id/users/:username/groups/:groupname  → remove user from group
router.delete('/cognito/userpools/:id/users/:username/groups/:groupname', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminRemoveUserFromGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);
    await client.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: req.params.id,
      Username:   req.params.username,
      GroupName:  req.params.groupname,
    }));
    res.json({ success: true });
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
    auditLog.log({
      category: 'aws', action: 'Cognito user created',
      resource: `${req.params.id}/${username}`, level: 'warning',
      context: profileId,
    });
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
    auditLog.log({
      category: 'aws', action: 'Cognito user password reset',
      resource: `${req.params.id}/${req.params.username}`, level: 'critical',
      context: profileId,
    });
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

// POST /cognito/userpools/:id/users/:username/mfa  → enable/disable MFA
router.post('/cognito/userpools/:id/users/:username/mfa', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { enabled, preferredMethod } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, AdminSetUserMFAPreferenceCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);

    let smsEnabled = false;
    let smsPreferred = false;
    let swEnabled = false;
    let swPreferred = false;

    if (enabled) {
      const method = preferredMethod === 'SOFTWARE_TOKEN_MFA' ? 'SOFTWARE_TOKEN_MFA' : 'SMS_MFA';
      if (method === 'SOFTWARE_TOKEN_MFA') {
        swEnabled = true;
        swPreferred = true;
      } else {
        smsEnabled = true;
        smsPreferred = true;
      }
    }

    await client.send(new AdminSetUserMFAPreferenceCommand({
      UserPoolId: req.params.id,
      Username: req.params.username,
      SMSMfaSettings: {
        Enabled: smsEnabled,
        PreferredMfa: smsPreferred,
      },
      SoftwareTokenMfaSettings: {
        Enabled: swEnabled,
        PreferredMfa: swPreferred,
      },
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

// POST /cognito/userpools/:id/groups  → create group in user pool
router.post('/cognito/userpools/:id/groups', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { groupName, description } = req.body || {};
    if (!groupName || !String(groupName).trim()) {
      return res.status(400).json({ error: 'groupName is required' });
    }

    const cfg = await resolveAwsConfig(profileId);
    const { CognitoIdentityProviderClient, CreateGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient(cfg);

    const resp = await client.send(new CreateGroupCommand({
      UserPoolId: req.params.id,
      GroupName: String(groupName).trim(),
      Description: description ? String(description).trim() : undefined,
    }));

    res.status(201).json({
      success: true,
      group: {
        name: resp.Group?.GroupName,
        description: resp.Group?.Description || '',
        precedence: resp.Group?.Precedence ?? null,
        roleArn: resp.Group?.RoleArn || null,
        lastModified: resp.Group?.LastModifiedDate || null,
        createdDate: resp.Group?.CreationDate || null,
      },
    });
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

// ─── GET /lex/:botId/intents ─────────────────────────────────────────────────

router.get('/lex/:botId/intents', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const botVersion = requestedLexBotVersion(req.query.botVersion);
  const localeFilter = String(req.query.localeId || '');
  if (!botVersion) return res.status(400).json({ error: 'botVersion must be DRAFT or a numeric version' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey: `${botId}:${botVersion}:${localeFilter || 'all'}`, kind: 'lex-intents' };
    if (req.query.force !== '1') {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const {
      LexModelsV2Client, ListBotLocalesCommand, ListIntentsCommand, ListSlotsCommand
    } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);

    const localesResp = await client.send(new ListBotLocalesCommand({ botId, botVersion }));
    const locales = (localesResp.botLocaleSummaries || []).filter(locale => !localeFilter || locale.localeId === localeFilter);

    const result = [];
    for (const locale of locales) {
      const localeId = locale.localeId;
      const intents = [];
      let nextToken;
      do {
        const resp = await client.send(new ListIntentsCommand({ botId, botVersion, localeId, maxResults: 50, nextToken }));
        intents.push(...(resp.intentSummaries || []));
        nextToken = resp.nextToken;
      } while (nextToken);

      const intentsWithSlots = await Promise.all(intents.map(async (intent) => {
        const slots = [];
        let sNext;
        do {
          const sr = await client.send(new ListSlotsCommand({ botId, botVersion, localeId, intentId: intent.intentId, maxResults: 50, nextToken: sNext }));
          slots.push(...(sr.slotSummaries || []));
          sNext = sr.nextToken;
        } while (sNext);
        return {
          id:               intent.intentId,
          name:             intent.intentName,
          description:      intent.description || '',
          sampleUtterances: (intent.sampleUtterances || []).map(u => u.utterance || u),
          slots: slots.map(s => ({
            id:          s.slotId,
            name:        s.slotName,
            typeName:    s.slotTypeName || '',
            required:    s.slotConstraint === 'Required',
            description: s.description || '',
          }))
        };
      }));

      result.push({
        localeId,
        localeName: locale.localeName || localeId,
        status:     locale.botLocaleStatus,
        intents:    intentsWithSlots
      });
    }
    writeCloudSnapshot({ ...snapshotKey, payload: result, ttlMs: cacheTtlMs(req), metadata: { botId, botVersion, localeId: localeFilter || null } });
    res.json(result);
  } catch (err) {
    const cfg = await resolveAwsConfig(profileId).catch(() => null);
    const cached = cfg && readCloudSnapshot({ profileId, region: cfg.region, resourceKey: `${botId}:${botVersion}:${localeFilter || 'all'}`, kind: 'lex-intents', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── GET /lex/:botId/logs ─────────────────────────────────────────────────────

router.get('/lex/:botId/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const aliasId = String(req.query.aliasId || '');
  const localeId = String(req.query.localeId || '');
  const force = req.query.force === '1';
  const resourceKey = `${botId}:${aliasId || 'all'}:${localeId || 'all'}:${hours}:${limit}`;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey, kind: 'lex-logs' };
    if (!force) {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const { LexModelsV2Client, ListBotAliasesCommand, DescribeBotAliasCommand } = require('@aws-sdk/client-lex-models-v2');
    const cw = new CloudWatchLogsClient(cfg);
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const lex = new LexModelsV2Client(cfg);
    const groups = await lexConversationLogGroups(lex, {
      ListBotAliasesCommand, DescribeBotAliasCommand,
    }, botId, aliasId, { logClient: cw, DescribeLogGroupsCommand });
    const currentEvents = (await collectLexLogEvents(cw, FilterLogEventsCommand, groups, { startTime, limit }))
      .filter(event => !localeId || !event.parsed?.localeId || event.parsed.localeId === localeId);
    const historicEvents = readCloudRange({
      profileId, region: cfg.region, resourceKey: botId, kind: 'lex-log-event',
      from: startTime, to: Date.now() + 1, limit: 5000,
    }).map(row => row.payload).filter(event => {
      if (aliasId && event?.aliasId && event.aliasId !== aliasId) return false;
      if (localeId && event?.parsed?.localeId && event.parsed.localeId !== localeId) return false;
      return true;
    });
    for (const event of currentEvents) {
      writeCloudSnapshot({
        profileId, region: cfg.region, resourceKey: botId, kind: 'lex-log-event',
        payload: event, capturedAt: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : Date.now(),
        ttlMs: cacheTtlMs(req), metadata: { botId, aliasId: event.aliasId || null },
      });
    }
    const seen = new Set();
    const events = [...historicEvents, ...currentEvents]
      .filter(event => {
        const id = `${event?.timestamp || ''}|${event?.stream || ''}|${event?.message || ''}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, limit);
    const groupNames = [...new Set([
      ...groups.map(group => group.name),
      ...historicEvents.map(event => event.logGroup).filter(Boolean),
    ])];
    const payload = {
      configured: groupNames.length > 0 || events.length > 0,
      groups: groupNames,
      aliases: groups.filter(group => group.aliasId).map(group => ({ aliasId: group.aliasId, aliasName: group.aliasName, botVersion: group.botVersion, logGroup: group.name })),
      events,
    };
    writeCloudSnapshot({ ...snapshotKey, payload, ttlMs: cacheTtlMs(req), metadata: { botId, aliasId: aliasId || null, localeId: localeId || null } });
    res.json(payload);
  } catch (err) {
    const cfg = await resolveAwsConfig(profileId).catch(() => null);
    const cached = cfg && readCloudSnapshot({ profileId, region: cfg.region, resourceKey, kind: 'lex-logs', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── GET /lex/:botId/testsets ─────────────────────────────────────────────────

router.get('/lex/:botId/testsets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LexModelsV2Client, ListTestSetsCommand } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);
    const resp = await client.send(new ListTestSetsCommand({ maxResults: 20 }));
    res.json((resp.testSets || []).map(t => ({
      id:          t.testSetId,
      name:        t.testSetName,
      description: t.description || '',
      numTurns:    t.numTurns || 0,
      modality:    t.modality || '',
      status:      t.status,
      lastUpdated: t.lastUpdatedDateTime || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lex/:botId/aliases ──────────────────────────────────────────────────

router.get('/lex/:botId/aliases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LexModelsV2Client, ListBotAliasesCommand, DescribeBotAliasCommand, DescribeBotCommand } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);

    // Get bot ARN and available versions
    let botArn = null, botName = null;
    try {
      const botDesc = await client.send(new DescribeBotCommand({ botId }));
      botArn  = botDesc.botArn  || null;
      botName = botDesc.botName || null;
    } catch (_) {}

    const all = [];
    let nextToken;
    do {
      const resp = await client.send(new ListBotAliasesCommand({ botId, maxResults: 20, nextToken }));
      all.push(...(resp.botAliasSummaries || []));
      nextToken = resp.nextToken;
    } while (nextToken);

    const detailed = await Promise.all(all.map(async (a) => {
      try {
        const d = await client.send(new DescribeBotAliasCommand({ botId, botAliasId: a.botAliasId }));
        const localeSettings = d.botAliasLocaleSettings || {};
        const lambdaArns = [];
        for (const [localeId, settings] of Object.entries(localeSettings)) {
          const arn = settings?.codeHookSpecification?.lambdaCodeHook?.lambdaARN;
          if (arn) lambdaArns.push({ localeId, arn });
        }
        const logsGroup = d.conversationLogSettings?.textLogSettings?.[0]?.destination?.cloudWatch?.logGroupArn || null;
        const aliasArn = d.botAliasArn || null;
        return {
          id:          a.botAliasId,
          name:        a.botAliasName,
          arn:         aliasArn,
          status:      a.botAliasStatus,
          botVersion:  d.botVersion || a.botVersion || 'DRAFT',
          description: d.description || a.description || '',
          lambdaArns,
          localeSettings: Object.entries(localeSettings).map(([localeId, s]) => ({
            localeId,
            enabled:   s?.enabled ?? true,
            lambdaArn: s?.codeHookSpecification?.lambdaCodeHook?.lambdaARN || null,
          })),
          logsGroup,
          textLogs:  (d.conversationLogSettings?.textLogSettings || []).length > 0,
          audioLogs: (d.conversationLogSettings?.audioLogSettings || []).length > 0,
          createdDate: d.creationDateTime || a.creationDateTime || null,
          updatedDate: d.lastUpdatedDateTime || a.lastUpdatedDateTime || null,
        };
      } catch (_) {
        return {
          id: a.botAliasId, name: a.botAliasName, arn: null,
          status: a.botAliasStatus, botVersion: a.botVersion || 'DRAFT',
          description: a.description || '', lambdaArns: [], localeSettings: [],
          logsGroup: null, textLogs: false, audioLogs: false,
          createdDate: a.creationDateTime || null, updatedDate: a.lastUpdatedDateTime || null,
        };
      }
    }));
    res.json({ botArn, botName, aliases: detailed });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /lex/:botId/aliases ─────────────────────────────────────────────────

router.post('/lex/:botId/aliases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const { name, description, botVersion } = req.body || {};
  if (!name || !botVersion) return res.status(400).json({ error: 'name and botVersion are required' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const { LexModelsV2Client, CreateBotAliasCommand } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);
    const result = await client.send(new CreateBotAliasCommand({
      botId,
      botAliasName: name,
      description:  description || undefined,
      botVersion,
    }));
    res.json({
      id:          result.botAliasId,
      name:        result.botAliasName,
      arn:         result.botAliasArn || null,
      status:      result.botAliasStatus,
      botVersion:  result.botVersion,
      description: result.description || '',
      createdDate: result.creationDateTime || null,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /lex/:botId/slot-types ───────────────────────────────────────────────

router.get('/lex/:botId/slot-types', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { botId } = req.params;
  const botVersion = requestedLexBotVersion(req.query.botVersion);
  const localeFilter = String(req.query.localeId || '');
  if (!botVersion) return res.status(400).json({ error: 'botVersion must be DRAFT or a numeric version' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const snapshotKey = { profileId, region: cfg.region, resourceKey: `${botId}:${botVersion}:${localeFilter || 'all'}`, kind: 'lex-slot-types' };
    if (req.query.force !== '1') {
      const cached = readCloudSnapshot(snapshotKey);
      if (cached) return res.json(cached.payload);
    }
    const { LexModelsV2Client, ListBotLocalesCommand, ListSlotTypesCommand, DescribeSlotTypeCommand } = require('@aws-sdk/client-lex-models-v2');
    const client = new LexModelsV2Client(cfg);

    const localesResp = await client.send(new ListBotLocalesCommand({ botId, botVersion }));
    const locales = (localesResp.botLocaleSummaries || []).filter(locale => !localeFilter || locale.localeId === localeFilter);
    const result = [];

    for (const locale of locales) {
      const localeId = locale.localeId;
      const types = [];
      let nextToken;
      do {
        const resp = await client.send(new ListSlotTypesCommand({ botId, botVersion, localeId, maxResults: 50, nextToken }));
        types.push(...(resp.slotTypeSummaries || []));
        nextToken = resp.nextToken;
      } while (nextToken);

      const detailed = await Promise.all(
        types.filter(t => !t.slotTypeName?.startsWith('AMAZON.')).map(async (t) => {
          try {
            const d = await client.send(new DescribeSlotTypeCommand({ botId, botVersion, localeId, slotTypeId: t.slotTypeId }));
            return {
              id:       t.slotTypeId,
              name:     t.slotTypeName,
              strategy: d.valueSelectionSetting?.resolutionStrategy || 'ORIGINAL_VALUE',
              values:   (d.slotTypeValues || []).map(v => ({
                value:    v.sampleValue?.value || '',
                synonyms: (v.synonyms || []).map(s => s.value),
              })),
            };
          } catch (_) {
            return { id: t.slotTypeId, name: t.slotTypeName, strategy: '', values: [] };
          }
        })
      );
      if (detailed.length) result.push({ localeId, localeName: locale.localeName || localeId, types: detailed });
    }
    writeCloudSnapshot({ ...snapshotKey, payload: result, ttlMs: cacheTtlMs(req), metadata: { botId, botVersion, localeId: localeFilter || null } });
    res.json(result);
  } catch (err) {
    const cfg = await resolveAwsConfig(profileId).catch(() => null);
    const cached = cfg && readCloudSnapshot({ profileId, region: cfg.region, resourceKey: `${botId}:${botVersion}:${localeFilter || 'all'}`, kind: 'lex-slot-types', allowExpired: true });
    if (cached) return res.json(cached.payload);
    handleErr(res, err);
  }
});

// ─── POST /lex/:botId/chat ────────────────────────────────────────────────────

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
  const hours = req.body?.historyHours;
  if (hours !== null && !(Number(hours) >= 0)) return res.status(400).json({ error: 'historyHours must be null or a number of hours' });
  try {
    const cfg = await resolveAwsConfig(profileId);
    const cache = logCache();
    if (!cache.isCached(profileId, cfg.region, group)) return res.status(404).json({ error: 'Log group is not cached' });
    res.json(cache.setHistory({ profileId, region: cfg.region, logGroup: group, historyMs: hours === null ? null : Number(hours) * 3600000 }));
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


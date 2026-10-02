'use strict';
/**
 * lib/logRecommendations.js
 * Deterministic recommendations from the log intelligence of a cached group:
 * how to fix what the logs show (by category), how to stop sensitive data
 * from reaching the logs, and logging practices. Every recommendation carries
 * its evidence (counts, window, signatures), a confidence and concrete
 * actions: filter the cached events, run a query, copy a snippet or open the
 * AWS documentation. Texts are i18n keys rendered by the frontend
 * (awsLogs.rec.<id>.title / .body); this module never calls an API.
 */

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const HIGH_RISK_SENSITIVE = ['password', 'token', 'api_key', 'secret', 'authorization', 'bearer', 'aws_key', 'jwt', 'card', 'rut', 'url_credentials'];
const MEDIUM_RISK_SENSITIVE = ['email', 'url_query'];

// CloudWatch Logs data protection managed identifiers for the types KUA detects.
const DATA_IDENTIFIERS = {
  email: 'EmailAddress',
  aws_key: 'AwsSecretKey',
  card: 'CreditCardNumber',
  ip_address: 'IpAddress',
};

const DOCS = {
  lambdaTimeout: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html',
  lambdaMemory: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html',
  retries: 'https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html',
  iam: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_access-denied.html',
  vpc: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html',
  coldStart: 'https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html',
  dataProtection: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data.html',
  lambdaLogging: 'https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-advanced.html',
  retention: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html#SettingLogRetention',
};

const SNIPPETS = {
  retriesNode: `import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// Adaptive retries: exponential backoff with jitter + client-side rate limiting
const client = new DynamoDBClient({ maxAttempts: 6, retryMode: 'adaptive' });`,
  retriesPython: `from botocore.config import Config
import boto3
config = Config(retries={"max_attempts": 6, "mode": "adaptive"})
client = boto3.client("dynamodb", config=config)`,
  sdkTimeoutNode: `import { NodeHttpHandler } from '@smithy/node-http-handler';
// Fail fast on slow dependencies, well below the function timeout
const client = new SQSClient({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 1000, requestTimeout: 3000 }),
});`,
  redactNode: `import pino from 'pino';
// Mask sensitive fields before they are written
const logger = pino({
  redact: {
    paths: ['password', 'token', '*.password', '*.token', 'headers.authorization', 'email', 'card'],
    censor: '[redacted]',
  },
});`,
  redactPython: `import logging, re

PATTERNS = [
    (re.compile(r"(password|token|secret|api[_-]?key)\\s*[:=]\\s*\\S+", re.I), r"\\1: [redacted]"),
    (re.compile(r"[\\w.%+-]+@[\\w.-]+\\.[a-z]{2,}", re.I), "[email]"),
    (re.compile(r"Bearer\\s+\\S+", re.I), "Bearer [redacted]"),
]

class RedactFilter(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        for pattern, replacement in PATTERNS:
            message = pattern.sub(replacement, message)
        record.msg, record.args = message, ()
        return True

logging.getLogger().addFilter(RedactFilter())`,
  jsonNode: `// Lambda: Configuration → Monitoring and operations tools → Log format: JSON
// Then log objects instead of concatenated strings:
console.log(JSON.stringify({ level: 'error', message: 'payment failed', orderId, errorType: err.name }));`,
};

function confidenceFromCount(count) {
  if (count >= 20) return 0.9;
  if (count >= 5) return 0.8;
  if (count >= 2) return 0.65;
  return 0.5;
}

function severityFromCount(count, { high = 50, medium = 5 } = {}) {
  if (count >= high) return 'high';
  if (count >= medium) return 'medium';
  return 'low';
}

/** IAM actions and resources named in access-denied messages. */
function deniedActions(signatures = []) {
  const actions = new Set();
  const resources = new Set();
  for (const s of signatures) {
    if (s.category !== 'access_denied') continue;
    const text = `${s.sample || ''} ${s.signature || ''}`;
    for (const match of text.matchAll(/perform:\s*([a-z0-9-]+:[A-Za-z0-9*]+)/g)) actions.add(match[1]);
    for (const match of text.matchAll(/on resource:?\s*"?(arn:[^\s"]+)/g)) resources.add(match[1]);
  }
  return { actions: [...actions], resources: [...resources] };
}

function topSignatures(signatures, category, limit = 3) {
  return (signatures || []).filter(s => s.category === category).slice(0, limit).map(s => ({ signature: s.signature, occurrences: s.occurrences, sample: s.sample }));
}

/**
 * @param intel   summary from lib/logIntelligence.js
 * @param context { logGroup, service, retentionInDays }
 * @param signals shared/logSignals.mjs (for category queries)
 */
function recommend(intel, { logGroup, service = null, retentionInDays = null } = {}, signals = null) {
  if (!intel) return [];
  const recs = [];
  const week = intel.categories7d || {};
  const day = intel.categories24h || {};
  const isLambda = service === 'lambda' || String(logGroup || '').startsWith('/aws/lambda/');
  const queryFor = category => (signals ? signals.categoryQuery(category) : null);
  const evidence = (category, extra = {}) => ({ count7d: week[category] || 0, count24h: day[category] || 0, signatures: topSignatures(intel.signatures, category), ...extra });
  const baseActions = category => [{ type: 'filter', category }, ...(queryFor(category) ? [{ type: 'query', query: queryFor(category) }] : [])];

  const fix = (category, { id = `fix_${category}`, params = {}, actions = [], severity, confidence } = {}) => {
    const count = week[category] || 0;
    if (!count) return;
    recs.push({
      id, kind: 'fix', category,
      severity: severity || severityFromCount(count),
      confidence: confidence ?? confidenceFromCount(count),
      params: { count, count24h: day[category] || 0, ...params },
      evidence: evidence(category),
      actions: [...baseActions(category), ...actions],
    });
  };

  // ── Fix what the logs show ──
  fix('timeout', {
    id: isLambda ? 'fix_timeout_lambda' : 'fix_timeout',
    actions: [{ type: 'snippet', language: 'javascript', code: SNIPPETS.sdkTimeoutNode }, ...(isLambda ? [{ type: 'link', url: DOCS.lambdaTimeout }] : [])],
  });
  fix('out_of_memory', { id: isLambda ? 'fix_out_of_memory_lambda' : 'fix_out_of_memory', severity: 'high', actions: isLambda ? [{ type: 'link', url: DOCS.lambdaMemory }] : [] });
  fix('throttling', {
    actions: [{ type: 'snippet', language: 'javascript', code: SNIPPETS.retriesNode }, { type: 'snippet', language: 'python', code: SNIPPETS.retriesPython }, { type: 'link', url: DOCS.retries }],
  });
  const denied = deniedActions(intel.signatures);
  fix('access_denied', {
    id: denied.actions.length ? 'fix_access_denied_actions' : 'fix_access_denied',
    severity: 'high',
    confidence: denied.actions.length ? 0.9 : undefined,
    params: { actions: denied.actions.join(', ') },
    actions: [
      ...(denied.actions.length ? [{
        type: 'snippet', language: 'json',
        code: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: denied.actions, Resource: denied.resources.length ? denied.resources : ['<resource-arn>'] }] }, null, 2),
      }] : []),
      { type: 'link', url: DOCS.iam },
    ],
  });
  fix('connection', { actions: isLambda ? [{ type: 'link', url: DOCS.vpc }] : [] });
  fix('crash', { severity: 'high' });
  fix('code_exception');
  fix('configuration', { severity: 'high' });
  fix('database');

  const clientErrors = (week.not_found || 0) + (week.validation || 0);
  if (clientErrors && clientErrors >= (intel.last7d?.errors || 0) * 0.3) {
    recs.push({
      id: 'practice_client_errors_level', kind: 'practice', category: week.validation >= (week.not_found || 0) ? 'validation' : 'not_found',
      severity: 'low', confidence: confidenceFromCount(clientErrors),
      params: { count: clientErrors },
      evidence: { count7d: clientErrors, signatures: [...topSignatures(intel.signatures, 'validation', 2), ...topSignatures(intel.signatures, 'not_found', 2)] },
      actions: baseActions(week.validation >= (week.not_found || 0) ? 'validation' : 'not_found'),
    });
  }

  if (isLambda && (week.cold_start || 0) >= 20) {
    const invocations = (week.cold_start || 0) + Math.round((week.platform || 0) / 3);
    const ratio = invocations ? Math.round(((week.cold_start || 0) / invocations) * 100) : null;
    recs.push({
      id: 'fix_cold_start', kind: 'fix', category: 'cold_start', severity: ratio != null && ratio >= 20 ? 'medium' : 'low', confidence: 0.6,
      params: { count: week.cold_start, ratio: ratio ?? '—' },
      evidence: evidence('cold_start'),
      actions: [...baseActions('cold_start'), { type: 'link', url: DOCS.coldStart }],
    });
  }

  // ── Sensitive data reaching the logs ──
  const sensitive = intel.sensitive7d || {};
  const types = Object.keys(sensitive).filter(type => sensitive[type] > 0);
  if (types.length) {
    const high = types.filter(type => HIGH_RISK_SENSITIVE.includes(type));
    const medium = types.filter(type => MEDIUM_RISK_SENSITIVE.includes(type));
    const identifiers = types.map(type => DATA_IDENTIFIERS[type]).filter(Boolean);
    const policy = {
      Name: 'kua-data-protection',
      Version: '2021-06-01',
      Statement: [
        { Sid: 'audit', DataIdentifier: identifiers.map(id => `arn:aws:dataprotection::aws:data-identifier/${id}`), Operation: { Audit: { FindingsDestination: {} } } },
        { Sid: 'redact', DataIdentifier: identifiers.map(id => `arn:aws:dataprotection::aws:data-identifier/${id}`), Operation: { Deidentify: { MaskConfig: {} } } },
      ],
    };
    recs.push({
      id: 'sanitize_at_source', kind: 'sanitize',
      severity: high.length ? 'high' : medium.length ? 'medium' : 'low',
      confidence: 0.85,
      params: { types: types.join(', '), count: types.reduce((sum, type) => sum + sensitive[type], 0) },
      evidence: { sensitive7d: sensitive, sensitive24h: intel.sensitive24h || {} },
      actions: [
        { type: 'snippet', language: 'javascript', code: SNIPPETS.redactNode },
        { type: 'snippet', language: 'python', code: SNIPPETS.redactPython },
      ],
    });
    if (identifiers.length) {
      recs.push({
        id: 'sanitize_data_protection_policy', kind: 'sanitize', severity: 'medium', confidence: 0.75,
        params: { identifiers: identifiers.join(', '), logGroup },
        evidence: { sensitive7d: sensitive },
        actions: [
          { type: 'snippet', language: 'json', code: JSON.stringify(policy, null, 2) },
          { type: 'snippet', language: 'shell', code: `aws logs put-data-protection-policy --log-group-identifier "${logGroup}" --policy-document file://kua-data-protection.json` },
          { type: 'link', url: DOCS.dataProtection },
        ],
      });
    }
  }

  // ── Logging practices ──
  const events7d = intel.last7d?.events || 0;
  if (events7d >= 500 && (intel.jsonEvents7d || 0) / events7d < 0.2 && (week.platform || 0) / events7d < 0.8) {
    recs.push({
      id: isLambda ? 'practice_structured_lambda' : 'practice_structured', kind: 'practice', severity: 'low', confidence: 0.7,
      params: { percent: Math.round(((intel.jsonEvents7d || 0) / events7d) * 100) },
      evidence: { count7d: events7d, jsonEvents7d: intel.jsonEvents7d || 0 },
      actions: [{ type: 'snippet', language: 'javascript', code: SNIPPETS.jsonNode }, ...(isLambda ? [{ type: 'link', url: DOCS.lambdaLogging }] : [])],
    });
  }
  if (events7d >= 200 && (week.debug || 0) / events7d >= 0.3) {
    recs.push({
      id: isLambda ? 'practice_debug_noise_lambda' : 'practice_debug_noise', kind: 'practice', severity: 'low', confidence: 0.75,
      params: { percent: Math.round(((week.debug || 0) / events7d) * 100) },
      evidence: evidence('debug'),
      actions: [...baseActions('debug'), ...(isLambda ? [{ type: 'link', url: DOCS.lambdaLogging }] : [])],
    });
  }
  if (retentionInDays == null && logGroup) {
    recs.push({
      id: 'cost_retention', kind: 'cost', severity: 'low', confidence: 0.9,
      params: { logGroup },
      evidence: { retentionInDays: null },
      actions: [
        { type: 'snippet', language: 'shell', code: `aws logs put-retention-policy --log-group-name "${logGroup}" --retention-in-days 30` },
        { type: 'link', url: DOCS.retention },
      ],
    });
  }

  return recs.sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (b.confidence - a.confidence));
}

module.exports = { recommend, deniedActions };

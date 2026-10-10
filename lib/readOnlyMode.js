'use strict';
/**
 * lib/readOnlyMode.js
 * Global read-only mode: while it is on, the backend refuses every change KUA
 * would make to cloud accounts and clusters, whatever the UI shows.
 *
 * Deny by default: inside the guarded areas (AWS, GCP, Vercel, Helm and the
 * Kubernetes resource routes) every request that is not GET is a write, except
 * the reads that travel as POST (queries, activity, logs) and the operations
 * that only touch this computer (sign-in, kubeconfig, local caches). A new write
 * endpoint is therefore refused until someone lists it as a read.
 *
 * Interactive terminals (kubectl exec, SSH, SSM, RDP, local shell) are refused
 * too: KUA cannot tell what will be typed in them. Log streams stay open.
 *
 * KUA_READ_ONLY=1 forces the mode on; it cannot then be turned off from the UI.
 * Otherwise the state is kept in ~/.kuadashboard/read-only.json.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// First path segments under /api that are KUA's own routes or this computer's
// configuration. Any other segment is a Kubernetes namespace or cluster resource.
const LOCAL_API_PREFIXES = new Set([
  'cloud', 'kua-apps', 'architecture', 'observability', 'advisor', 'audit', 'account', 'system',
  'local', 'kube-logs', 'helm', 'console', 'kubeconfig', 'contexts', 'backups', 'billing',
]);

// SQL that only reads: the first keyword reads and no statement keyword writes.
const SQL_READ_START = /^(select|with|show|describe|desc|explain|values)\b/;
const SQL_WRITE_WORD = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|replace|unload|vacuum|optimize|msck|call|export|load)\b/;

function stripSql(sql = '') {
  return String(sql)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .trim()
    .toLowerCase();
}

/** True for a single statement that only reads (SELECT, WITH … SELECT, SHOW, DESCRIBE, EXPLAIN). */
function isReadOnlySql(sql) {
  const text = stripSql(sql).replace(/;\s*$/, '');
  if (!text || text.includes(';')) return false;
  return SQL_READ_START.test(text) && !SQL_WRITE_WORD.test(text);
}

/**
 * Non-GET requests inside the guarded areas that do not change anything there.
 * [method, path pattern, optional predicate on the request body]
 */
const ALLOWED = [
  // AWS: sign-in and local profile, reads sent as POST, local log cache and scans
  ['POST', /^\/api\/cloud\/aws\/sso\/(start|poll|credentials)$/],
  ['POST', /^\/api\/cloud\/aws\/overview\/advisor\/s3$/],
  ['POST', /^\/api\/cloud\/aws\/cloudwatch\/dashboards\/[^/]+\/widgets\/[^/]+\/logs\/query$/],
  ['POST', /^\/api\/cloud\/aws\/(lambda|stepfunctions|sqs|sns)\/activity$/],
  ['POST', /^\/api\/cloud\/aws\/eks\/[^/]+\/add-kubeconfig$/],
  ['POST', /^\/api\/cloud\/aws\/dynamodb\/[^/]+\/(scan|query)$/],
  ['POST', /^\/api\/cloud\/aws\/athena\/query$/, body => isReadOnlySql(body?.query)],
  ['POST', /^\/api\/cloud\/aws\/route53\/validate$/],
  ['POST', /^\/api\/cloud\/aws\/secrets\/[^/]+\/(import-selected|import-to-profile)$/],
  [null,   /^\/api\/cloud\/aws\/cloudwatch\/log-cache(\/sync)?$/],
  [null,   /^\/api\/cloud\/aws\/cloudwatch\/log-scans(\/.*)?$/],
  ['POST', /^\/api\/cloud\/aws\/cloudwatch\/log-groups\/(query|insights)$/],
  ['POST', /^\/api\/cloud\/aws\/cloudformation\/stack\/drift$/],
  // GCP: gcloud sign-in and configurations, kubeconfig, reads sent as POST, local history
  ['POST', /^\/api\/cloud\/gcp\/(gcloud-login|gcloud-configs)$/],
  ['POST', /^\/api\/cloud\/gcp\/gke\/[^/]+\/[^/]+\/connect$/],
  ['POST', /^\/api\/cloud\/gcp\/secrets\/[^/]+\/import-selected$/],
  ['POST', /^\/api\/cloud\/gcp\/bigquery\/query$/, body => isReadOnlySql(body?.query)],
  // executeSql without a transaction is a read-only single use: DML is refused by Spanner.
  ['POST', /^\/api\/cloud\/gcp\/spanner\/instances\/[^/]+\/databases\/[^/]+\/query$/],
  ['POST', /^\/api\/cloud\/gcp\/logging\/query$/],
  [null,   /^\/api\/cloud\/gcp\/history\/polling(\/run)?$/],
  ['POST', /^\/api\/cloud\/gcp\/estimate\/[^/]+$/],
  // Vercel: OAuth sign-in
  ['POST', /^\/api\/cloud\/vercel\/oauth\/callback$/],
  // Helm: repositories are local configuration; installs and uninstalls are not
  [null,   /^\/api\/helm\/repos(\/[^/]+|\/update)?$/],
  // Kubernetes: port-forwards open a local tunnel and change nothing in the cluster
  ['POST', /^\/api\/[^/]+\/(services|pods)\/[^/]+\/portforward$/],
  ['DELETE', /^\/api\/portforward\/[^/]+$/],
];

const AREA_NAMES = { aws: 'AWS', gcp: 'GCP', vercel: 'Vercel', helm: 'Helm', kubernetes: 'Kubernetes' };

const TERMINAL_SOCKETS = new Set(['/ws/exec', '/ws/shell', '/ws/ec2-shell', '/ws/ec2-rdp', '/ws/aws-ssm', '/ws/gcp-ssh']);

// Deny by default for the cluster too: apply, nodes, port-forwards and every namespaced route.
function isKubernetesWrite(pathname) {
  const segment = pathname.match(/^\/api\/([^/]+)/)?.[1];
  return !!segment && !LOCAL_API_PREFIXES.has(segment);
}

/** The area a request changes, or null when it is not a guarded write. */
function guardedArea(method, pathname, body) {
  if (READ_METHODS.has(method)) return null;
  let area = null;
  const cloud = pathname.match(/^\/api\/cloud\/(aws|gcp|vercel)\//);
  if (cloud) area = cloud[1];
  else if (pathname.startsWith('/api/helm/')) area = 'helm';
  else if (pathname === '/api/console/sessions') area = 'console';
  else if (isKubernetesWrite(pathname)) area = 'kubernetes';
  if (!area) return null;
  const allowed = ALLOWED.some(([allowedMethod, pattern, predicate]) =>
    (!allowedMethod || allowedMethod === method) && pattern.test(pathname) && (!predicate || predicate(body)));
  return allowed ? null : area;
}

function createReadOnlyMode({ file = path.join(os.homedir(), '.kuadashboard', 'read-only.json'), env = process.env, audit = null } = {}) {
  const forced = env.KUA_READ_ONLY === '1' || env.KUA_READ_ONLY === 'true';
  let enabled = forced;
  if (!forced) {
    try { enabled = JSON.parse(fs.readFileSync(file, 'utf8')).enabled === true; } catch { enabled = false; }
  }

  function state() {
    return { enabled, forced };
  }

  function setEnabled(next) {
    if (forced) {
      const error = new Error('Read-only mode is forced by KUA_READ_ONLY and cannot be changed from KUA');
      error.status = 409;
      throw error;
    }
    enabled = !!next;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ enabled, changedAt: new Date().toISOString() }), { mode: 0o600 });
    audit?.log({ category: 'system', action: enabled ? 'readOnly.enabled' : 'readOnly.disabled', level: enabled ? 'info' : 'warning' });
    return state();
  }

  function refusal(area) {
    const error = area === 'console'
      ? 'Read-only mode is on: terminals stay closed because KUA cannot check what is typed in them.'
      : `Read-only mode is on: KUA does not change ${AREA_NAMES[area] || area} resources. Turn it off in the header to make this change.`;
    return { error, code: 'READ_ONLY', area };
  }

  // Express middleware: refuses guarded writes and records the refusal.
  function middleware(req, res, next) {
    if (!enabled) return next();
    const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
    const area = guardedArea(req.method, pathname, req.body);
    if (!area) return next();
    audit?.log({ category: 'system', action: 'readOnly.refused', resource: `${req.method} ${pathname}`, level: 'warning', details: { area } });
    return res.status(403).json(refusal(area));
  }

  /** True when a WebSocket upgrade may go on; refuses terminals while the mode is on. */
  function admitUpgrade(pathname, socket) {
    if (!enabled || !TERMINAL_SOCKETS.has(pathname)) return true;
    audit?.log({ category: 'system', action: 'readOnly.refused', resource: pathname, level: 'warning', details: { area: 'terminal' } });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return false;
  }

  return { state, setEnabled, middleware, admitUpgrade };
}

module.exports = { createReadOnlyMode, guardedArea, isReadOnlySql };

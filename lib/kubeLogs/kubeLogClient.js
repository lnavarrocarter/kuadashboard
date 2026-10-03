'use strict';
/**
 * lib/kubeLogs/kubeLogClient.js
 * Kubernetes pod logs behind the FilterLogEvents interface, so the log cache,
 * its sync and backfill, background scans, intelligence, anomalies, local ML,
 * recommendations, agent briefs and MCP work for Kubernetes unchanged.
 *
 * A "log group" is a workload: "<namespace>/<kind>/<name>" with kind in
 * deployments | statefulsets | daemonsets | pods. send(FilterLogEvents) reads
 * the logs of every container of the workload's pods (and of the previous
 * container instance when it restarted) through the API server with
 * timestamps, keeps the lines in [startTime, endTime) and pages one container
 * per response (nextToken). Each line gets a stable event id, so a line read
 * again in a later sync or scan is stored once.
 *
 * What the kubelet keeps is the limit: logs of deleted pods and rotated files
 * are gone, which is why caching them early matters.
 */

const crypto = require('node:crypto');

const KINDS = ['deployments', 'statefulsets', 'daemonsets', 'pods'];
const NAME = '[a-z0-9]([-a-z0-9.]*[a-z0-9])?';
const GROUP_RE = new RegExp(`^(${NAME})/(${KINDS.join('|')})/(${NAME})$`);
const LIMIT_BYTES = 10 * 1024 * 1024; // per container read

/** "<namespace>/<kind>/<name>" → { namespace, kind, name } or null. */
function parseWorkloadGroup(group) {
  const match = GROUP_RE.exec(String(group || ''));
  return match ? { namespace: match[1], kind: match[3], name: match[4] } : null;
}

const workloadGroup = ({ namespace, kind, name }) => `${namespace}/${kind}/${name}`;

function selectorToString(selector = {}) {
  const parts = Object.entries(selector.matchLabels || {}).map(([key, value]) => `${key}=${value}`);
  for (const expr of selector.matchExpressions || []) {
    const values = (expr.values || []).join(',');
    if (expr.operator === 'In') parts.push(`${expr.key} in (${values})`);
    else if (expr.operator === 'NotIn') parts.push(`${expr.key} notin (${values})`);
    else if (expr.operator === 'Exists') parts.push(expr.key);
    else if (expr.operator === 'DoesNotExist') parts.push(`!${expr.key}`);
  }
  return parts.join(',');
}

const body = result => result?.body ?? result;

/** Pods of a workload (any phase: logs of failed pods matter). */
async function workloadPods({ core, apps }, { namespace, kind, name }) {
  if (kind === 'pods') return [body(await core.readNamespacedPod(name, namespace))];
  const read = { deployments: 'readNamespacedDeployment', statefulsets: 'readNamespacedStatefulSet', daemonsets: 'readNamespacedDaemonSet' }[kind];
  const workload = body(await apps[read](name, namespace));
  const selector = selectorToString(workload.spec?.selector);
  if (!selector) return [];
  return body(await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector)).items || [];
}

/** Containers to read: current instance, plus the previous one when it restarted. */
function logUnits(pods) {
  const units = [];
  for (const pod of pods) {
    const statuses = new Map((pod.status?.containerStatuses || []).map(status => [status.name, status]));
    for (const container of [...(pod.spec?.initContainers || []), ...(pod.spec?.containers || [])]) {
      const status = statuses.get(container.name);
      if (status?.restartCount > 0) units.push({ pod: pod.metadata.name, container: container.name, previous: true });
      units.push({ pod: pod.metadata.name, container: container.name, previous: false });
    }
  }
  return units;
}

/**
 * Lines "2026-10-03T05:36:51.123456789Z message" → events in [from, to).
 * Ids hash pod, container, instance, raw timestamp, message and the
 * occurrence of that pair, so re-reading a line yields the same id.
 */
function parseLogText(text, unit, { from = -Infinity, to = Infinity } = {}) {
  const events = [];
  const seen = new Map();
  const stream = `${unit.pod}/${unit.container}${unit.previous ? ' (previous)' : ''}`;
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const space = line.indexOf(' ');
    if (space < 20) continue;
    const raw = line.slice(0, space);
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp) || timestamp < from || timestamp >= to) continue;
    const message = line.slice(space + 1).replace(/\r$/, '');
    const key = `${raw}\u0000${message}`;
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    const eventId = crypto.createHash('sha1').update(`${stream}\u0000${key}\u0000${occurrence}`).digest('hex').slice(0, 32);
    events.push({ eventId, timestamp, message, logStreamName: stream });
  }
  return events;
}

/**
 * FilterLogEvents-compatible client for one cluster.
 * @param clients { core, apps } Kubernetes API clients of that context
 */
function createKubeLogClient(clients, { now = () => Date.now(), limitBytes = LIMIT_BYTES } = {}) {
  const unitCache = new Map(); // logGroupName|startTime → units, while paging one request

  async function send(command) {
    const input = command?.input || command || {};
    const workload = parseWorkloadGroup(input.logGroupName);
    if (!workload) throw Object.assign(new Error(`Not a Kubernetes workload: ${input.logGroupName}`), { name: 'ResourceNotFoundException' });
    const startTime = Number(input.startTime) || now() - 3600000;
    const endTime = Number(input.endTime) || now() + 1;
    const key = `${input.logGroupName}|${startTime}|${endTime}`;
    let units = input.nextToken ? unitCache.get(key) : null;
    if (!units) {
      try {
        units = logUnits(await workloadPods(clients, workload));
      } catch (err) {
        if ((err.statusCode || err.response?.statusCode) === 404) throw Object.assign(new Error('Workload not found'), { name: 'ResourceNotFoundException' });
        throw err;
      }
      unitCache.set(key, units);
    }
    const index = Number(input.nextToken || 0);
    const unit = units[index];
    if (!unit) { unitCache.delete(key); return { events: [] }; }
    const sinceSeconds = Math.max(1, Math.ceil((now() - startTime) / 1000) + 1);
    let text = '';
    try {
      // readNamespacedPodLog(name, namespace, container, follow, insecureSkipTLSVerifyBackend, limitBytes, pretty, previous, sinceSeconds, tailLines, timestamps)
      text = body(await clients.core.readNamespacedPodLog(unit.pod, workload.namespace, unit.container, false, undefined, limitBytes, undefined, unit.previous, sinceSeconds, undefined, true));
    } catch (err) {
      // Containers not started yet, or without a previous instance: nothing to read.
      const status = err.statusCode || err.response?.statusCode;
      if (status !== 400 && status !== 404) throw err;
    }
    const events = parseLogText(typeof text === 'string' ? text : '', unit, { from: startTime, to: endTime });
    const next = index + 1 < units.length ? String(index + 1) : undefined;
    if (!next) unitCache.delete(key);
    return { events, nextToken: next };
  }

  return { send };
}

module.exports = { createKubeLogClient, parseWorkloadGroup, workloadGroup, parseLogText, logUnits, selectorToString, KINDS };

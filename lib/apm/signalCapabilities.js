'use strict';
/**
 * lib/apm/signalCapabilities.js
 * What KUA can observe for an APM resource, in one place: the collector (lib/apm/scheduler.js)
 * and the signal state (lib/kua/resourceSignalState.js) agree, so a type KUA never collects is
 * reported as unsupported instead of "no data yet".
 *
 *   metrics  KUA collects metrics on a schedule (Lambda from its logs, Kubernetes workloads,
 *            and the CloudWatch metrics of load balancers, EC2 and S3)
 *   logs     KUA can read its logs on demand (CloudWatch, Cloud Logging, Kubernetes, Vercel)
 */

const { metricPlan } = require('./awsMetricCollector');

const KUBERNETES_LOG_KINDS = new Set(['deployment', 'statefulset', 'daemonset', 'pod']);
// The Kubernetes kinds lib/apm/kubeCollector.js measures; ConfigMaps, Secrets and volumes stay in
// the graph as topology only, so they must not claim metrics.
const KUBERNETES_METRIC_KINDS = new Set(['deployment', 'statefulset', 'daemonset', 'service', 'pod', 'node', 'ingress']);
const LOG_TYPES = new Set(['lambda', 'ecs', 'eventbridge', 'gcp-cloud-run', 'gcp-function', 'vercel-project']);

function signalCapabilities(resource = {}) {
  if (resource.type === 'kubernetes') {
    const reachable = !!resource.kubeContext;
    const kind = String(resource.kind || '').toLowerCase();
    return { metrics: reachable && KUBERNETES_METRIC_KINDS.has(kind), logs: reachable && KUBERNETES_LOG_KINDS.has(kind) };
  }
  return {
    metrics: resource.type === 'lambda' || !!metricPlan(resource),
    logs: LOG_TYPES.has(resource.type),
  };
}

module.exports = { signalCapabilities, KUBERNETES_METRIC_KINDS };

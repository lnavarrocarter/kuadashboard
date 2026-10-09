'use strict';

function metricMap(metrics = []) {
  return new Map(metrics.map(metric => [metric.metricName, metric]));
}

function evaluateThresholds(metrics = [], thresholds = {}, logs = {}) {
  const byName = metricMap(metrics);
  const signals = [];
  let evaluated = 0;

  const invocations = Number(byName.get('invocations_observed')?.sum);
  const errors = Number(byName.get('errors_observed')?.sum);
  if (Number.isFinite(invocations) && invocations > 0 && thresholds.errorRatePercent != null) {
    evaluated += 1;
    const value = (Number.isFinite(errors) ? errors : 0) / invocations * 100;
    if (value > thresholds.errorRatePercent) {
      signals.push({ metric: 'errorRatePercent', value, threshold: thresholds.errorRatePercent, comparison: 'maximum' });
    }
  }

  const duration = Number(byName.get('duration_ms')?.average);
  if (Number.isFinite(duration) && thresholds.durationMs != null) {
    evaluated += 1;
    if (duration > thresholds.durationMs) {
      signals.push({ metric: 'durationMs', value: duration, threshold: thresholds.durationMs, comparison: 'maximum' });
    }
  }

  // RequestCount only counts requests for which the load balancer could choose a target, so it is
  // the denominator of the targets' 5xx errors only. Errors the load balancer generates itself
  // (503 without a healthy target, 502, 504) are mostly outside it: adding them gave rates over
  // 100 %. They are a separate signal, reported as a count (#239).
  const elbRequests = Number(byName.get('elb_request_count')?.sum);
  const targetErrors = Number(byName.get('elb_target_5xx_count')?.sum) || 0;
  const loadBalancerErrors = Number(byName.get('elb_5xx_count')?.sum) || 0;
  if (Number.isFinite(elbRequests) && elbRequests > 0 && thresholds.elb5xxRatePercent != null) {
    evaluated += 1;
    const value = (targetErrors * 100) / elbRequests;
    if (value > thresholds.elb5xxRatePercent) {
      signals.push({ metric: 'elb5xxRatePercent', value, threshold: thresholds.elb5xxRatePercent, comparison: 'maximum' });
    }
  }
  if (loadBalancerErrors > 0 && thresholds.elb5xxRatePercent != null) {
    evaluated += 1;
    signals.push({ metric: 'elbGenerated5xxCount', value: loadBalancerErrors, threshold: 0, comparison: 'count' });
  }

  const elbLatency = Number(byName.get('elb_target_response_time_p95_ms')?.average);
  if (Number.isFinite(elbLatency) && thresholds.elbLatencyP95Ms != null) {
    evaluated += 1;
    if (elbLatency > thresholds.elbLatencyP95Ms) {
      signals.push({ metric: 'elbLatencyP95Ms', value: elbLatency, threshold: thresholds.elbLatencyP95Ms, comparison: 'maximum' });
    }
  }

  const ready = Number(byName.get('pods_ready')?.sum);
  const pods = Number(byName.get('pods_total')?.sum);
  if (Number.isFinite(pods) && pods > 0 && thresholds.readyPodsPercent != null) {
    evaluated += 1;
    const value = (Number.isFinite(ready) ? ready : 0) / pods * 100;
    if (value < thresholds.readyPodsPercent) {
      signals.push({ metric: 'readyPodsPercent', value, threshold: thresholds.readyPodsPercent, comparison: 'minimum' });
    }
  }

  const restarts = Number(byName.get('restarts_delta')?.sum);
  if (Number.isFinite(restarts) && thresholds.restartDelta != null) {
    evaluated += 1;
    if (restarts >= thresholds.restartDelta) {
      signals.push({ metric: 'restartDelta', value: restarts, threshold: thresholds.restartDelta, comparison: 'maximum' });
    }
  }

  const logErrorRate = logs.errorRatePercent == null ? null : Number(logs.errorRatePercent);
  if (Number.isFinite(logErrorRate) && thresholds.errorRatePercent != null) {
    evaluated += 1;
    if (logErrorRate > thresholds.errorRatePercent) {
      signals.push({ metric: 'logErrorRatePercent', value: logErrorRate, threshold: thresholds.errorRatePercent, comparison: 'maximum' });
    }
  }

  for (const signature of logs.signatures || []) {
    const currentOccurrences = Number(signature.currentOccurrences);
    const previousOccurrences = Number(signature.previousOccurrences);
    if (!Number.isFinite(currentOccurrences) || currentOccurrences < 2 || !Number.isFinite(previousOccurrences) || previousOccurrences <= 0) continue;
    const value = ((currentOccurrences - previousOccurrences) / previousOccurrences) * 100;
    if (value < 0 || thresholds.recurringSignatureGrowthPercent == null) continue;
    evaluated += 1;
    if (value >= thresholds.recurringSignatureGrowthPercent) {
      signals.push({
        metric: 'recurringSignatureGrowthPercent', signature: signature.signature,
        value, threshold: thresholds.recurringSignatureGrowthPercent, comparison: 'maximum',
      });
    }
  }

  return {
    status: evaluated === 0 ? 'unknown' : signals.length ? 'degraded' : 'healthy',
    evaluated,
    signals,
  };
}

module.exports = { evaluateThresholds };
'use strict';

function metricMap(metrics = []) {
  return new Map(metrics.map(metric => [metric.metricName, metric]));
}

function evaluateThresholds(metrics = [], thresholds = {}) {
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

  return {
    status: evaluated === 0 ? 'unknown' : signals.length ? 'degraded' : 'healthy',
    evaluated,
    signals,
  };
}

module.exports = { evaluateThresholds };
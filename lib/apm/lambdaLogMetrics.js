'use strict';

const crypto = require('crypto');

const BUCKET_MS = 30 * 60 * 1000;
const REPORT_PATTERN = /^REPORT\s+RequestId:\s*(\S+)\s+Duration:\s*([\d.]+)\s*ms\s+Billed Duration:\s*(\d+)\s*ms\s+Memory Size:\s*(\d+)\s*MB\s+Max Memory Used:\s*(\d+)\s*MB(?:\s+Init Duration:\s*([\d.]+)\s*ms)?(?:\s+Status:\s*(\S+))?(?:\s+Error Type:\s*(\S+))?/i;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJsonReport(message) {
  if (!String(message || '').trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(message);
    if (parsed.type !== 'platform.report') return null;
    const record = parsed.record || {};
    const metrics = record.metrics || {};
    return {
      requestId: record.requestId || parsed.requestId || '',
      durationMs: finiteNumber(metrics.durationMs),
      billedDurationMs: finiteNumber(metrics.billedDurationMs),
      memorySizeMb: finiteNumber(metrics.memorySizeMB),
      maxMemoryUsedMb: finiteNumber(metrics.maxMemoryUsedMB),
      initDurationMs: finiteNumber(metrics.initDurationMs),
      status: String(record.status || '').toLowerCase(),
      errorType: String(record.errorType || ''),
    };
  } catch (_) {
    return null;
  }
}

function parseTextReport(message) {
  const match = String(message || '').trim().match(REPORT_PATTERN);
  if (!match) return null;
  return {
    requestId: match[1],
    durationMs: finiteNumber(match[2]),
    billedDurationMs: finiteNumber(match[3]),
    memorySizeMb: finiteNumber(match[4]),
    maxMemoryUsedMb: finiteNumber(match[5]),
    initDurationMs: finiteNumber(match[6]),
    status: String(match[7] || '').toLowerCase(),
    errorType: String(match[8] || ''),
  };
}

function parseLambdaReport(message) {
  return parseJsonReport(message) || parseTextReport(message);
}

function eventIdentity(event) {
  if (event.eventId) return String(event.eventId);
  return crypto.createHash('sha256')
    .update(`${event.timestamp || 0}\u0000${event.logStreamName || ''}\u0000${event.message || ''}`)
    .digest('hex');
}

function isTimeout(report) {
  return report.status === 'timeout' || /timeout|tasktimedout/i.test(report.errorType);
}

function isError(report) {
  return isTimeout(report) || report.status === 'error' || !!report.errorType;
}

function metricSample(metricName, unit, value) {
  return {
    metricName,
    unit,
    count: 1,
    sum: value,
    min: value,
    max: value,
    last: value,
  };
}

function mergeSample(bucket, sample) {
  const existing = bucket.metrics.get(sample.metricName);
  if (!existing) {
    bucket.metrics.set(sample.metricName, { ...sample });
    return;
  }
  existing.count += sample.count;
  existing.sum += sample.sum;
  existing.min = Math.min(existing.min, sample.min);
  existing.max = Math.max(existing.max, sample.max);
  existing.last = sample.last;
}

function samplesForReport(report) {
  const samples = [metricSample('invocations_observed', 'count', 1)];
  if (isError(report)) samples.push(metricSample('errors_observed', 'count', 1));
  if (isTimeout(report)) samples.push(metricSample('timeouts_observed', 'count', 1));
  if (report.durationMs != null) samples.push(metricSample('duration_ms', 'ms', report.durationMs));
  if (report.billedDurationMs != null) samples.push(metricSample('billed_duration_ms', 'ms', report.billedDurationMs));
  if (report.memorySizeMb != null) samples.push(metricSample('memory_configured_mb', 'MB', report.memorySizeMb));
  if (report.maxMemoryUsedMb != null) samples.push(metricSample('memory_used_mb', 'MB', report.maxMemoryUsedMb));
  if (report.initDurationMs != null) {
    samples.push(metricSample('cold_starts_observed', 'count', 1));
    samples.push(metricSample('init_duration_ms', 'ms', report.initDurationMs));
  }
  return samples;
}

function aggregateLambdaLogEvents(events, {
  bucketMs = BUCKET_MS,
  seenEventIds = [],
  seenRequestIds = [],
  quality = 'full',
} = {}) {
  const eventIds = new Set(seenEventIds);
  const requestIds = new Set(seenRequestIds);
  const buckets = new Map();
  let ignored = 0;

  for (const event of [...events].sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0))) {
    const eventId = eventIdentity(event);
    if (eventIds.has(eventId)) { ignored += 1; continue; }
    eventIds.add(eventId);

    const report = parseLambdaReport(event.message);
    if (!report) continue;
    if (report.requestId && requestIds.has(report.requestId)) { ignored += 1; continue; }
    if (report.requestId) requestIds.add(report.requestId);

    const timestamp = Number(event.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
    let bucket = buckets.get(bucketStart);
    if (!bucket) {
      bucket = { bucketStart, metrics: new Map() };
      buckets.set(bucketStart, bucket);
    }
    for (const sample of samplesForReport(report)) mergeSample(bucket, sample);
  }

  return {
    buckets: [...buckets.values()]
      .sort((left, right) => left.bucketStart - right.bucketStart)
      .flatMap(bucket => [...bucket.metrics.values()].map(metric => ({
        bucketStart: bucket.bucketStart,
        source: 'cloudwatch_logs',
        quality,
        ...metric,
      }))),
    boundaryEventIds: [...eventIds].slice(-500),
    requestIds: [...requestIds].slice(-500),
    ignored,
  };
}

module.exports = {
  BUCKET_MS,
  aggregateLambdaLogEvents,
  eventIdentity,
  parseLambdaReport,
};
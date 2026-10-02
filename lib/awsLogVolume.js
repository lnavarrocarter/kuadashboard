'use strict';
/**
 * lib/awsLogVolume.js
 * Total events per time bin of a log group from the CloudWatch metric
 * AWS/Logs IncomingLogEvents (Sum). Works for any group and any range the
 * metric keeps, cached or not, so the activity chart is not limited by the
 * size of the local cache (a 9 GB group may only fit an hour of events).
 *
 * Cost: GetMetricData bills USD 0.01 per 1,000 metrics requested, so one
 * series is about USD 0.00001 per call. Points are kept in the local metric
 * history (lib/metricHistory.js) and a window read in the last `ttlMs` is
 * served from there without calling AWS.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Metric period for a chart bin. CloudWatch keeps 1-minute points for 15
 * days, 5-minute points for 63 days and 1-hour points for 455 days.
 */
function volumePeriodSeconds(binMs, from, now = Date.now()) {
  let seconds = Math.max(60, Math.round(binMs / 60000) * 60);
  const age = now - from;
  if (age > 63 * DAY_MS) seconds = Math.max(seconds, 3600);
  else if (age > 15 * DAY_MS) seconds = Math.max(seconds, 300);
  return seconds;
}

function seriesItem({ profileId, region, logGroup, periodS }) {
  return { provider: 'aws', profileId, region, resourceId: `AWS::Logs::LogGroup:${logGroup}`, metric: 'IncomingLogEvents', periodS };
}

async function fetchPoints({ client, GetMetricDataCommand, logGroup, from, to, periodS }) {
  const points = [];
  let token;
  let calls = 0;
  do {
    const response = await client.send(new GetMetricDataCommand({
      StartTime: new Date(from), EndTime: new Date(to), ScanBy: 'TimestampAscending', NextToken: token,
      MetricDataQueries: [{
        Id: 'events', ReturnData: true,
        MetricStat: { Metric: { Namespace: 'AWS/Logs', MetricName: 'IncomingLogEvents', Dimensions: [{ Name: 'LogGroupName', Value: logGroup }] }, Period: periodS, Stat: 'Sum' },
      }],
    }));
    calls += 1;
    for (const result of response.MetricDataResults || []) {
      (result.Values || []).forEach((v, i) => points.push({ t: new Date(result.Timestamps[i]).getTime(), v }));
    }
    token = response.NextToken;
  } while (token && calls < 10);
  return { points, calls };
}

/**
 * @returns {{ from, to, binMs, buckets: [{ start, events }], total, requests, source }}
 *   `requests` is the number of GetMetricData calls made (0 when served from history).
 */
async function logGroupVolume({ client, GetMetricDataCommand, history = null, profileId, region, logGroup, from, to, binMs, ttlMs = 5 * 60 * 1000, now = Date.now() }) {
  const periodS = volumePeriodSeconds(binMs, from, now);
  const size = periodS * 1000;
  const start = Math.floor(from / size) * size;
  const end = Math.min(to, now);
  const item = seriesItem({ profileId, region, logGroup, periodS });
  let points;
  let requests = 0;
  const plan = history?.plan({ series: [item], from: start, to: end, ttlMs });
  if (plan && !plan.stale.length) {
    points = history.read(item, { from: start, to: end });
  } else {
    const fetchFrom = plan?.fetchFrom ?? start;
    const fetched = await fetchPoints({ client, GetMetricDataCommand, logGroup, from: fetchFrom, to: end, periodS });
    requests = fetched.calls;
    if (history) {
      history.write(item, { from: fetchFrom, to: end, points: fetched.points });
      points = history.read(item, { from: start, to: end });
    } else {
      points = fetched.points;
    }
  }
  const byStart = new Map(points.map(p => [Math.floor(p.t / size) * size, p.v]));
  const buckets = [];
  for (let t = start; t < end; t += size) buckets.push({ start: t, events: byStart.get(t) || 0 });
  return {
    from: start, to: end, binMs: size, buckets, source: 'metric', requests,
    total: buckets.reduce((sum, b) => sum + b.events, 0),
  };
}

module.exports = { logGroupVolume, volumePeriodSeconds };

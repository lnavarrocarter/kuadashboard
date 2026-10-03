'use strict';
/**
 * lib/awsLogScans.js
 * Background scans of cached CloudWatch log groups: read up to 5 days with
 * FilterLogEvents into the local cache while the user keeps working.
 *
 * - State lives in the cache database (log_cache_scans), so progress survives
 *   a restart: scans that were running when KUA closed come back paused.
 * - The range is read one hour at a time, newest hour first, so recent events
 *   are available in the cache first. The cursor only moves when an hour is
 *   complete; a resumed scan re-reads that hour and the cache dedupes it.
 * - At most `concurrency` scans run at once; the rest wait queued. Pages are
 *   spaced and throttling is retried with backoff to stay under the API quota.
 * - A scan stops (status "budget") when the cache reaches its size budget,
 *   instead of making the cache prune what it just read.
 *
 * FilterLogEvents has no per-request charge; data leaving AWS counts as data
 * transfer out (first 100 GB per month free).
 */

const { estimateDailyBytes, MAX_SCAN_MS } = require('./awsLogCache');
const { runWithUsageContext } = require('./usage/awsMeter');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SLICE_MS = HOUR_MS;
const PAGE_DELAY_MS = 200;
const MAX_RETRIES = 5;
const COMPACT_EVERY_SLICES = 6;
const RETRYABLE = new Set(['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailableException', 'RequestLimitExceeded', 'LimitExceededException']);
const FINISHED = new Set(['done', 'cancelled']);

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isExpired(err) {
  return /ExpiredToken|RequestExpired|CredentialsProviderError|TokenRefresh/i.test(`${err?.name} ${err?.message}`);
}

/**
 * What a scan of `days` would read, for the confirmation before starting.
 * `group` needs storedBytes / retentionInDays / creationTime (CloudWatch's view).
 */
function estimateScan({ group = {}, days, usage, now = Date.now() }) {
  const span = Math.min(Math.max(Number(days) || 1, 1 / 24), MAX_SCAN_MS / DAY_MS) * DAY_MS;
  let from = now - span;
  let limitedBy = null;
  if (group.retentionInDays && now - group.retentionInDays * DAY_MS > from) { from = now - group.retentionInDays * DAY_MS; limitedBy = 'retention'; }
  if (group.creationTime && group.creationTime > from) { from = group.creationTime; limitedBy = 'creation'; }
  const dailyBytes = estimateDailyBytes(group, now);
  const estimatedBytes = Math.round(dailyBytes * ((now - from) / DAY_MS));
  const freeBytes = Math.max(0, usage.budgetBytes - usage.bytes);
  return {
    from, to: now, days: Math.round(((now - from) / DAY_MS) * 100) / 100, limitedBy,
    dailyBytes: Math.round(dailyBytes), estimatedBytes,
    cacheBytes: usage.bytes, budgetBytes: usage.budgetBytes, freeBytes,
    // CloudWatch reports stored (compressed) bytes and the cache compresses
    // again, so this is a conservative check, not an exact prediction.
    fits: estimatedBytes <= freeBytes,
    maxDays: MAX_SCAN_MS / DAY_MS,
  };
}

/** CloudWatch's view of one log group (stored bytes, retention, creation), or null. */
async function describeLogGroup(client, DescribeLogGroupsCommand, logGroup) {
  const described = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: logGroup, limit: 5 }));
  return (described.logGroups || []).find(group => group.logGroupName === logGroup) || null;
}

const defaultSdk = () => require('@aws-sdk/client-cloudwatch-logs');

/**
 * @param cache      log cache (lib/awsLogCache.js)
 * @param configFor  async profileId → AWS SDK config (credentials are resolved per scan run)
 * @param clientFor  optional async (profileId, region) → client, instead of configFor
 */
function createScanRunner({
  cache, configFor, clientFor, FilterLogEventsCommand = null, sdk = defaultSdk, concurrency = 2, pageDelayMs = PAGE_DELAY_MS,
  sleep = defaultSleep, now = () => Date.now(), onChange = () => {},
}) {
  const Filter = () => FilterLogEventsCommand || sdk().FilterLogEventsCommand;
  const makeClient = clientFor || (async (profileId, region) => new (sdk().CloudWatchLogsClient)({ ...(await configFor(profileId)), region }));
  const controls = new Map();
  let active = 0;
  let initialized = false;

  // Scans that were running or queued when KUA closed resume only on request.
  function init() {
    if (initialized) return;
    initialized = true;
    for (const scan of cache.listScans({ statuses: ['running', 'queued'] })) {
      cache.updateScan(scan.id, { status: 'paused', error: 'Interrupted: KUA closed while scanning' });
    }
  }

  function changed(scan) {
    try { onChange(scan); } catch { /* listeners never break a scan */ }
    return scan;
  }

  function start({ profileId, region, logGroup, from, to }) {
    init();
    const scan = cache.createScan({ profileId, region, logGroup, from, to });
    pump();
    return changed(cache.getScan(scan.id));
  }

  function pause(id) {
    const scan = cache.getScan(id);
    if (scan?.status === 'queued') return changed(cache.updateScan(id, { status: 'paused' }));
    if (scan?.status === 'running') controls.get(id).stop = 'pause';
    return scan;
  }

  function resume(id) {
    const scan = cache.getScan(id);
    if (!scan || !['paused', 'error', 'budget'].includes(scan.status)) return scan;
    cache.updateScan(id, { status: 'queued', error: null, finishedAt: null });
    pump();
    return changed(cache.getScan(id));
  }

  function cancel(id) {
    const scan = cache.getScan(id);
    if (!scan || FINISHED.has(scan.status)) return scan;
    if (scan.status === 'running') { controls.get(id).stop = 'cancel'; return scan; }
    return changed(cache.updateScan(id, { status: 'cancelled', finishedAt: now() }));
  }

  function remove(id) {
    const scan = cache.getScan(id);
    if (scan?.status === 'running') throw Object.assign(new Error('Pause or cancel the scan before removing it'), { $metadata: { httpStatusCode: 409 } });
    return cache.deleteScan(id);
  }

  function pump() {
    while (active < concurrency) {
      const next = cache.listScans({ statuses: ['queued'] }).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)[0];
      if (!next) return;
      active += 1;
      // Marked running before the async work so the next pump does not pick it again.
      cache.updateScan(next.id, { status: 'running', startedAt: next.startedAt ?? now(), error: null });
      controls.set(next.id, { stop: null });
      run(next.id).finally(() => {
        controls.delete(next.id);
        active -= 1;
        pump();
      });
    }
  }

  async function send(client, input) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await client.send(new (Filter())(input));
      } catch (err) {
        const status = err?.$metadata?.httpStatusCode;
        if (attempt >= MAX_RETRIES || !(RETRYABLE.has(err?.name) || status === 429 || status >= 500)) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  // Scans resumed at startup have no request: attribute their downloads explicitly.
  function run(id) {
    const scan = cache.getScan(id);
    return runWithUsageContext({ profileId: scan?.profileId ?? null, feature: 'log-scans' }, () => runScan(id));
  }

  async function runScan(id) {
    let scan = cache.getScan(id);
    const scope = { profileId: scan.profileId, region: scan.region, logGroup: scan.logGroup };
    const totals = { pages: scan.pages, fetched: scan.fetched, inserted: scan.inserted };
    const stopWith = (status, fields = {}) => changed(cache.updateScan(id, { status, ...totals, ...fields }));
    try {
      await cache.ready();
      const client = await makeClient(scope.profileId, scope.region);
      let cursor = scan.cursor;
      let slices = 0;
      changed(scan);
      while (cursor > scan.from) {
        const sliceStart = Math.max(scan.from, cursor - SLICE_MS);
        let nextToken;
        do {
          const control = controls.get(id);
          if (control?.stop === 'pause') return stopWith('paused');
          if (control?.stop === 'cancel') return stopWith('cancelled', { finishedAt: now() });
          if (!cache.isCached(scope.profileId, scope.region, scope.logGroup)) return stopWith('cancelled', { error: 'Log group removed from the cache', finishedAt: now() });
          const { bytes, budgetBytes } = cache.usage();
          if (bytes >= budgetBytes) return stopWith('budget', { error: 'The local cache reached its size budget' });
          const response = await send(client, { logGroupName: scope.logGroup, startTime: sliceStart, endTime: cursor, nextToken });
          const events = response.events || [];
          totals.pages += 1;
          totals.fetched += events.length;
          totals.inserted += await cache.ingest({ ...scope, events });
          scan = changed(cache.updateScan(id, totals));
          nextToken = response.nextToken;
          if (nextToken) await sleep(pageDelayMs);
        } while (nextToken);
        cursor = sliceStart;
        scan = changed(cache.updateScan(id, { cursor }));
        slices += 1;
        if (slices % COMPACT_EVERY_SLICES === 0) await cache.compact();
      }
      await cache.maintain();
      return stopWith('done', { finishedAt: now() });
    } catch (err) {
      if (err?.name === 'ResourceNotFoundException') return stopWith('error', { error: 'Log group not found' });
      // Expired sessions are recoverable: refresh credentials and resume.
      if (isExpired(err)) return stopWith('paused', { error: `Credentials expired: ${err.message}` });
      return stopWith('error', { error: String(err?.message || err).slice(0, 500) });
    }
  }

  return {
    init,
    start,
    pause,
    resume,
    cancel,
    remove,
    list: scope => { init(); return cache.listScans(scope); },
    get: id => cache.getScan(id),
    activeCount: () => active,
  };
}

module.exports = { createScanRunner, estimateScan, describeLogGroup, SLICE_MS };

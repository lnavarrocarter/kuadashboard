'use strict';
/**
 * lib/awsLogFetch.js
 * Newest events of a range with FilterLogEvents. The API returns events in
 * ascending time from startTime, so asking for "the first N" of a busy range
 * returns its OLDEST events, which is not what a log viewer (or the cache,
 * which reads newest first) shows. This walks backwards from the end of the
 * range in growing segments (5 min, ×4 each step) until it has `limit` events
 * or reaches the start, so live results and cached results are the same set.
 */

const FIRST_SEGMENT_MS = 5 * 60 * 1000;
const MIN_SEGMENT_MS = 1000;
const SEGMENT_GROWTH = 4;
const SEGMENT_PAGES = 3; // a segment that needs more pages is retried shorter

/**
 * @returns {{ events, more, pages, from }} events newest first; `more` when
 *   older matching events exist in the range; `from` is the oldest time read.
 */
async function fetchNewest({ client, FilterLogEventsCommand, logGroupName, startTime, endTime = Date.now(), limit = 500, filterPattern, logStreamNames, maxPages = 20 }) {
  const collected = [];
  let pages = 0;
  let segmentEnd = endTime;
  let size = FIRST_SEGMENT_MS;
  let more = false;
  let reached = endTime;
  while (segmentEnd > startTime && collected.length < limit && pages < maxPages) {
    const segmentStart = Math.max(startTime, segmentEnd - size);
    const segment = [];
    let nextToken;
    let segmentPages = 0;
    do {
      const response = await client.send(new FilterLogEventsCommand({
        logGroupName, startTime: segmentStart, endTime: segmentEnd, nextToken,
        ...(filterPattern ? { filterPattern } : {}),
        ...(logStreamNames?.length ? { logStreamNames } : {}),
      }));
      segment.push(...(response.events || []));
      nextToken = response.nextToken;
      pages += 1;
      segmentPages += 1;
    } while (nextToken && segmentPages < SEGMENT_PAGES && pages < maxPages);
    if (nextToken && size > MIN_SEGMENT_MS && pages < maxPages) {
      // Too busy: what we read is the OLDEST part of the segment. Retry a shorter one.
      size = Math.max(MIN_SEGMENT_MS, Math.floor(size / SEGMENT_GROWTH));
      continue;
    }
    collected.push(...segment);
    reached = segmentStart;
    if (nextToken) { more = true; break; }
    segmentEnd = segmentStart;
    size *= SEGMENT_GROWTH;
  }
  if (segmentEnd > startTime && collected.length >= limit) more = true;
  const events = collected
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  if (collected.length > limit) more = true;
  return { events, more, pages, from: reached };
}

/**
 * Logs Insights rows → events, for rows that carry the raw event
 * (@timestamp as "YYYY-MM-DD HH:mm:ss.SSS" UTC, @logStream and @message).
 * Aggregated rows (stats) have none of these and are skipped.
 */
function insightsRowsToEvents(rows = []) {
  const events = [];
  for (const row of rows) {
    const message = row['@message'];
    const stream = row['@logStream'];
    const time = String(row['@timestamp'] || '');
    if (typeof message !== 'string' || !stream || !time) continue;
    const timestamp = /^\d+$/.test(time) ? Number(time) : Date.parse(`${time.replace(' ', 'T').replace(/Z$/, '')}Z`);
    if (Number.isFinite(timestamp)) events.push({ timestamp, logStreamName: stream, message });
  }
  return events;
}

module.exports = { fetchNewest, insightsRowsToEvents };

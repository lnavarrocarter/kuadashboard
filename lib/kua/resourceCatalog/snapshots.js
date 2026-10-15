'use strict';
/**
 * lib/kua/resourceCatalog/snapshots.js
 * Pages of a catalog answer (#281, #282): the first page reads the provider and keeps the result
 * for five minutes; `nextCursor` continues that same snapshot once, so paging never reads again
 * and never mixes two readings.
 */

const crypto = require('crypto');

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

function catalogError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function createSnapshotPager({ now = () => Date.now(), ttlMs = SNAPSHOT_TTL_MS } = {}) {
  const snapshots = new Map();

  function prune() {
    for (const [key, entry] of snapshots) if (entry.expiresAt <= now()) snapshots.delete(key);
  }

  /** The snapshot and offset of a cursor; a cursor is used once and belongs to one owner (profile or context). */
  function resume(cursor, owner) {
    prune();
    const entry = snapshots.get(String(cursor));
    snapshots.delete(String(cursor));
    if (!entry || entry.expiresAt <= now()) throw catalogError('This catalog cursor expired or was already used: search again', 410, 'CURSOR_EXPIRED');
    if (entry.owner !== owner) throw catalogError('This catalog cursor belongs to another profile or context', 400, 'CURSOR_MISMATCH');
    return entry;
  }

  /** One page of `snapshot.items` from `offset`, with a cursor to the next one. */
  function page(snapshot, { offset = 0, limit, owner }) {
    prune();
    const pageSize = Math.min(Math.max(Math.trunc(Number(limit) || DEFAULT_PAGE), 1), MAX_PAGE);
    const items = snapshot.items.slice(offset, offset + pageSize);
    const nextOffset = offset + items.length;
    let nextCursor = null;
    if (nextOffset < snapshot.items.length) {
      nextCursor = crypto.randomUUID();
      snapshots.set(nextCursor, { snapshot, offset: nextOffset, owner, expiresAt: now() + ttlMs });
    }
    const { items: all, ...rest } = snapshot;
    return { ...rest, total: all.length, page: { offset, limit: pageSize, returned: items.length }, nextCursor, items };
  }

  return { resume, page };
}

/** Keeps the items whose name, identifier, type or string details contain `search`. */
function matchesSearch(item, search) {
  const text = String(search || '').trim().toLowerCase();
  if (!text) return true;
  // Labels match as key=value (GCP labels): searching "app=orders" finds what carries that label.
  const labels = Object.entries(item.labels || {}).map(([key, value]) => `${key}=${value}`);
  return [item.name, item.arn, item.key, item.type, ...labels, ...Object.values(item.details || {}).filter(value => typeof value === 'string')]
    .some(value => String(value || '').toLowerCase().includes(text));
}

/** Runs `worker` over `values` with at most `limit` at once, keeping their order. */
async function mapLimited(values, limit, worker) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

module.exports = { createSnapshotPager, matchesSearch, mapLimited, catalogError, SNAPSHOT_TTL_MS };

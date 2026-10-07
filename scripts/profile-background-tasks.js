'use strict';

const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogCache } = require('../lib/awsLogCache');
const { createScanRunner } = require('../lib/awsLogScans');

const EVENT_COUNT = Math.max(100, Number(process.env.KUA_PROFILE_EVENTS) || 5000);
const ITERATIONS = Math.max(1, Number(process.env.KUA_PROFILE_ITERATIONS) || 10);
const PROFILE_ID = 'profile:synthetic';
const REGION = 'us-east-1';
const NOW = Date.now();

class FilterLogEventsCommand { constructor(input) { this.input = input; } }

function eventBatch(iteration, count) {
  return Array.from({ length: count }, (_, index) => ({
    eventId: `synthetic-${iteration}-${String(index).padStart(5, '0')}`,
    timestamp: NOW - index,
    logStreamName: `synthetic-stream-${index % 20}`,
    message: `INFO request completed event=${index} ${'x'.repeat(60)}`,
  }));
}

function memoryMb(bytes) { return Math.round(bytes / 1024 / 1024 * 100) / 100; }
function round(value) { return Math.round(value * 100) / 100; }

function distribution(runs, field) {
  const values = runs.map(run => run[field]).sort((left, right) => left - right);
  return {
    median: values[Math.floor(values.length / 2)],
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values[values.length - 1],
  };
}

function processMaxRssMb() {
  const maxRss = process.resourceUsage().maxRSS;
  return memoryMb(maxRss * 1024);
}

async function measure(cache, iteration, count) {
  const scope = { profileId: PROFILE_ID, region: REGION, logGroup: `/kua-profile/${iteration}` };
  cache.enable(scope);
  const events = eventBatch(iteration, count);
  const inputBytes = Buffer.byteLength(JSON.stringify(events));
  let delivered = false;
  const runner = createScanRunner({
    cache,
    clientFor: async () => ({
      send: async () => {
        if (delivered) return { events: [] };
        delivered = true;
        return { events };
      },
    }),
    FilterLogEventsCommand,
    pageDelayMs: 0,
    sleep: async () => {},
    now: () => NOW,
  });
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  await new Promise(resolve => setTimeout(resolve, 30));

  const cpuStart = process.cpuUsage();
  const memoryBefore = process.memoryUsage();
  const wallStart = performance.now();
  const started = runner.start({ ...scope, from: NOW - 60_000, to: NOW });
  let scan = runner.get(started.id);
  const deadline = Date.now() + 30000;
  while (!['done', 'error', 'budget', 'cancelled'].includes(scan.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1));
    scan = runner.get(started.id);
  }
  if (scan.status !== 'done') throw new Error(`synthetic scan did not finish: ${scan.status}`);
  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);
  const memoryAfter = process.memoryUsage();
  await new Promise(resolve => setTimeout(resolve, 30));
  delay.disable();

  return {
    events: count,
    inputBytes,
    inserted: scan.inserted,
    pages: scan.pages,
    wallMs: round(wallMs),
    cpuMs: round((cpu.user + cpu.system) / 1000),
    cpuPercentOfWall: round((cpu.user + cpu.system) / 10 / wallMs),
    rssBeforeMb: memoryMb(memoryBefore.rss),
    rssAfterMb: memoryMb(memoryAfter.rss),
    heapBeforeMb: memoryMb(memoryBefore.heapUsed),
    heapAfterMb: memoryMb(memoryAfter.heapUsed),
    eventLoopDelayP99Ms: round(delay.percentile(99) / 1e6),
    eventLoopDelayMaxMs: round(delay.max / 1e6),
  };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-background-profile-'));
  const cache = createLogCache({ dataDir, key: crypto.randomBytes(32), now: () => NOW });
  try {
    cache.enable({ profileId: PROFILE_ID, region: REGION, logGroup: '/kua-profile/warmup' });
    await cache.ingest({
      profileId: PROFILE_ID,
      region: REGION,
      logGroup: '/kua-profile/warmup',
      events: eventBatch('warmup', 100),
    });

    const rssBeforeRunsMb = memoryMb(process.memoryUsage().rss);
    const maxRssBeforeRunsMb = processMaxRssMb();
    const runs = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      runs.push(await measure(cache, iteration, EVENT_COUNT));
    }
    console.log(JSON.stringify({
      benchmark: 'real log-scan runner and cache ingest; synthetic FilterLogEvents page; no network or credentials',
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      iterations: ITERATIONS,
      eventCount: EVENT_COUNT,
      summary: {
        wallMs: distribution(runs, 'wallMs'),
        cpuMs: distribution(runs, 'cpuMs'),
        cpuPercentOfWall: distribution(runs, 'cpuPercentOfWall'),
        eventLoopDelayP99Ms: distribution(runs, 'eventLoopDelayP99Ms'),
        eventLoopDelayMaxMs: distribution(runs, 'eventLoopDelayMaxMs'),
      },
      processMemory: {
        rssBeforeRunsMb,
        rssAfterRunsMb: memoryMb(process.memoryUsage().rss),
        maxRssBeforeRunsMb,
        maxRssAfterRunsMb: processMaxRssMb(),
        note: 'RSS and heap are process-wide; they are not attributable to one task.',
      },
      runs,
    }, null, 2));
  } finally {
    cache.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
'use strict';

const { createProxmoxClient } = require('./client');
const { readProxmoxInventory } = require('./inventory');
const { readProxmoxTelemetry } = require('./telemetry');
const { getMetricHistory } = require('../metricHistory');

const INTERVAL_MS = 60 * 1000;

function createProxmoxTelemetryScheduler({
  listProfiles = () => require('../credentialStore').getStore().listProfiles(),
  resolveProfile = id => require('../../routes/proxmox').resolveProxmoxProfile(id),
  createClient = createProxmoxClient,
  readInventory = readProxmoxInventory,
  readTelemetry = readProxmoxTelemetry,
  metricHistory = getMetricHistory,
  providerActive = () => true,
  intervalMs = INTERVAL_MS,
  timers = { setInterval, clearInterval },
  logger = console,
} = {}) {
  let timer = null;
  let running = false;
  let task = null;
  let nextRunAt = null;

  async function tick() {
    if (running || !providerActive('proxmox')) return [];
    running = true;
    const results = [];
    try {
      const profiles = (await listProfiles()).filter(profile => profile.provider === 'proxmox');
      for (const profile of profiles) {
        try {
          const client = createClient(await resolveProfile(profile.id));
          const inventory = await readInventory(client);
          const telemetry = await readTelemetry(client, inventory, { history: metricHistory(), profileId: profile.id, timeframe: 'day' });
          results.push({ profileId: profile.id, entities: telemetry.entities.length });
        } catch (error) {
          // Do not log a credential profile or its values; the task history keeps only the code.
          logger.warn('[proxmox-telemetry] collection failed:', error.kind || error.code || 'unknown');
        }
      }
      return results;
    } finally { running = false; }
  }

  function start({ task: taskHandle = null } = {}) {
    if (timer) return;
    task = taskHandle;
    nextRunAt = Date.now() + intervalMs;
    timer = timers.setInterval(() => {
      nextRunAt = Date.now() + intervalMs;
      const run = task ? task.run(tick) : tick();
      run.catch(error => logger.warn('[proxmox-telemetry] scheduled run failed:', error.kind || error.code || 'unknown'));
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) timers.clearInterval(timer);
    timer = null;
    nextRunAt = null;
  }

  function pause() { stop(); }
  function resume() { start({ task }); }
  function health() { return { running: !!timer, intervalMs, nextRunAt }; }

  return { health, pause, resume, start, stop, tick };
}

module.exports = { INTERVAL_MS, createProxmoxTelemetryScheduler };

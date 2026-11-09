'use strict';
/**
 * routes/proxmox.js
 * /api/cloud/proxmox: Proxmox VE clusters, read-only (#195). Mounted behind the Proxmox plugin
 * guard (server.js), so while the plugin is off every route answers PLUGIN_DISABLED.
 *
 *   GET /inventory           X-Profile-Id → readProxmoxInventory(), 30 s cache, ?refresh=1 reads again
 *   GET /fingerprint?url=    the certificate the server presents (no credential is sent)
 *
 * Profile keys (Env Manager, provider "proxmox"): PROXMOX_URL, PROXMOX_TOKEN_ID,
 * PROXMOX_TOKEN_SECRET, and PROXMOX_TLS_FINGERPRINT or PROXMOX_CA_PEM. The secret never leaves
 * this module: not in answers, logs, scope ids or errors.
 */

const express = require('express');
const { getStore } = require('../lib/credentialStore');
const { createProxmoxClient, readServerCertificate } = require('../lib/proxmox/client');
const { readProxmoxInventory } = require('../lib/proxmox/inventory');
const { validateRecipeYaml, generateRecipePlan } = require('../lib/proxmox/recipes');
const { readProxmoxTelemetry } = require('../lib/proxmox/telemetry');

const CACHE_MS = 30 * 1000;
const MAX_RECIPE_BYTES = 256 * 1024;
const STATUS_BY_KIND = { invalid_profile: 400, not_found: 404, invalid_token: 401, forbidden: 403, tls: 502, unreachable: 502, node_down: 502, timeout: 504, invalid_response: 502 };

function recipeSource(req, res) {
  const source = req.body?.source;
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_RECIPE_BYTES) {
    res.status(400).json({ error: 'source must be a YAML string no larger than 256 KiB', code: 'invalid_recipe' });
    return null;
  }
  return source;
}

function recipeValidationContext(input = {}) {
  const safeList = value => Array.isArray(value) && value.length <= 200 && value.every(item => typeof item === 'string' && item.length <= 128)
    ? value
    : null;
  const storages = input.storages === undefined ? null : safeList(input.storages);
  const images = input.images === undefined ? null : safeList(input.images);
  if ((input.storages !== undefined && !storages) || (input.images !== undefined && !images)) {
    throw Object.assign(new Error('storages and images must be lists of at most 200 short strings'), { kind: 'invalid_recipe' });
  }
  return { storages, images };
}

async function resolveProxmoxProfile(profileId, store = getStore()) {
  if (!profileId) throw Object.assign(new Error('X-Profile-Id header is required'), { kind: 'invalid_profile' });
  const keys = await store.getRawKeys(profileId);
  if (!keys) throw Object.assign(new Error('Credential profile not found'), { kind: 'not_found' });
  if (!keys.PROXMOX_URL || !keys.PROXMOX_TOKEN_ID || !keys.PROXMOX_TOKEN_SECRET) {
    throw Object.assign(new Error('The profile needs PROXMOX_URL, PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET'), { kind: 'invalid_profile' });
  }
  return {
    url: keys.PROXMOX_URL,
    tokenId: keys.PROXMOX_TOKEN_ID,
    tokenSecret: keys.PROXMOX_TOKEN_SECRET,
    fingerprint: keys.PROXMOX_TLS_FINGERPRINT || null,
    ca: keys.PROXMOX_CA_PEM || null,
  };
}

function createProxmoxRouter({
  resolveProfile = resolveProxmoxProfile,
  createClient = createProxmoxClient,
  readInventory = readProxmoxInventory,
  readTelemetry = readProxmoxTelemetry,
  metricHistory = null,
  readCertificate = readServerCertificate,
  now = () => Date.now(),
} = {}) {
  const router = express.Router();
  const cache = new Map();

  const fail = (res, error) => res.status(STATUS_BY_KIND[error.kind] || 500).json({
    error: error.message || 'Proxmox request failed',
    ...(error.kind ? { code: error.kind } : {}),
    ...(error.fingerprint ? { fingerprint: error.fingerprint } : {}),
  });

  router.get('/inventory', async (req, res) => {
    const profileId = req.get('X-Profile-Id') || '';
    try {
      const cached = cache.get(profileId);
      if (cached && req.query.refresh !== '1' && now() - cached.at < CACHE_MS) return res.json({ ...cached.inventory, cached: true });
      const client = createClient(await resolveProfile(profileId));
      const inventory = { ...(await readInventory(client)), readAt: new Date(now()).toISOString() };
      // Nothing could be read at all (wrong token, TLS, host down): say why instead of empty tables.
      const sections = Object.values(inventory.sections);
      if (!inventory.cluster.available && sections.every(section => !section.available)) {
        const reason = inventory.cluster.reason || sections[0]?.reason || 'unreachable';
        const failed = sections.find(section => section.reason === reason) || {};
        // A certificate that changed carries the fingerprint the server presented, to pin it again.
        return fail(res, Object.assign(new Error(failed.error || 'Proxmox could not be read'), { kind: reason, fingerprint: failed.fingerprint }));
      }
      cache.set(profileId, { at: now(), inventory });
      res.json(inventory);
    } catch (error) { fail(res, error); }
  });

  router.get('/fingerprint', async (req, res) => {
    try { res.json(await readCertificate(String(req.query.url || ''))); } catch (error) { fail(res, error); }
  });

  // Local recipe analysis only. These endpoints never contact Proxmox or execute plan steps.
  router.post('/recipes/validate', (req, res) => {
    const source = recipeSource(req, res);
    if (source === null) return;
    try {
      res.json(validateRecipeYaml(source, recipeValidationContext(req.body?.context)));
    } catch (error) {
      res.status(400).json({ error: error.message, code: 'invalid_recipe' });
    }
  });

  router.post('/recipes/plan', (req, res) => {
    const source = recipeSource(req, res);
    if (source === null) return;
    const firstVmid = req.body?.firstVmid === undefined ? 9000 : req.body.firstVmid;
    if (!Number.isInteger(firstVmid) || firstVmid < 100 || firstVmid > 999999) {
      return res.status(400).json({ error: 'firstVmid must be an integer from 100 to 999999', code: 'invalid_recipe' });
    }
    try {
      const context = recipeValidationContext(req.body?.context);
      res.json(generateRecipePlan(source, { ...context, firstVmid, now }));
    } catch (error) {
      if (error.code === 'INVALID_RECIPE') return res.status(400).json({ error: error.message, code: error.code, validation: error.validation });
      res.status(400).json({ error: error.message, code: 'invalid_recipe' });
    }
  });

  router.get('/metrics', async (req, res) => {
    const profileId = req.get('X-Profile-Id') || '';
    const timeframe = String(req.query.timeframe || 'day');
    if (!['hour', 'day', 'week', 'month'].includes(timeframe)) return res.status(400).json({ error: 'Invalid RRD timeframe', code: 'invalid_profile' });
    try {
      const client = createClient(await resolveProfile(profileId));
      let inventory = cache.get(profileId)?.inventory;
      if (!inventory) {
        inventory = await readInventory(client);
        cache.set(profileId, { at: now(), inventory });
      }
      const history = metricHistory || require('../lib/metricHistory').getMetricHistory();
      res.json(await readTelemetry(client, inventory, { history, profileId, timeframe, now }));
    } catch (error) { fail(res, error); }
  });

  return router;
}

module.exports = { MAX_RECIPE_BYTES, STATUS_BY_KIND, createProxmoxRouter, recipeValidationContext, resolveProxmoxProfile };

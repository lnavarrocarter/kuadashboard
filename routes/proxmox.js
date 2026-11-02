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

const CACHE_MS = 30 * 1000;
const STATUS_BY_KIND = { invalid_profile: 400, not_found: 404, invalid_token: 401, forbidden: 403, tls: 502, unreachable: 502, node_down: 502, timeout: 504, invalid_response: 502 };

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

  return router;
}

module.exports = { STATUS_BY_KIND, createProxmoxRouter, resolveProxmoxProfile };

'use strict';
/**
 * routes/envManager.js
 * REST API for managing cloud credential profiles.
 *
 * Base path: /api/cloud/envs
 *
 * GET    /profiles              → list all profiles (metadata + masked keys)
 * POST   /profiles              → create profile
 * GET    /profiles/:id          → get profile (masked keys)
 * PUT    /profiles/:id          → update name and/or merge keys
 * DELETE /profiles/:id          → delete profile + all its keys
 * POST   /profiles/:id/export   → download as .env file
 *
 * Security: raw key values are NEVER returned by any endpoint. Only masked
 * representations are sent to the client. Raw values are consumed internally
 * by the GCP/AWS route adapters that call store.getRawKeys(id).
 */

const express = require('express');
const { getStore } = require('../lib/credentialStore');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleErr(res, err) {
  console.error('[envManager]', err.message);
  res.status(500).json({ error: err.message });
}

/** Validate that `provider` is one of the accepted values */
function validateProvider(provider) {
  return ['gcp', 'aws', 'generic'].includes(provider);
}

// ─── GET /profiles ────────────────────────────────────────────────────────────

router.get('/profiles', async (_req, res) => {
  try {
    const store    = getStore();
    const profiles = await store.listProfiles();
    res.json(profiles);
  } catch (err) { handleErr(res, err); }
});

// ─── POST /profiles ───────────────────────────────────────────────────────────

router.post('/profiles', async (req, res) => {
  try {
    const { name, provider, keys } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: '`name` is required' });
    if (!validateProvider(provider))
      return res.status(400).json({ error: '`provider` must be gcp | aws | generic' });

    // Sanitize key names: only allow alphanumeric + underscores
    const sanitizedKeys = {};
    for (const [k, v] of Object.entries(keys || {})) {
      if (!/^[A-Z0-9_]+$/i.test(k))
        return res.status(400).json({ error: `Invalid key name: ${k}` });
      if (typeof v !== 'string')
        return res.status(400).json({ error: `Key value must be a string: ${k}` });
      sanitizedKeys[k] = v;
    }

    const store   = getStore();
    const profile = await store.createProfile({ name: name.trim(), provider, keys: sanitizedKeys });
    res.status(201).json(profile);
  } catch (err) { handleErr(res, err); }
});

// ─── GET /profiles/:id ────────────────────────────────────────────────────────

router.get('/profiles/:id', async (req, res) => {
  try {
    const store   = getStore();
    const profile = await store.getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) { handleErr(res, err); }
});

// ─── PUT /profiles/:id ────────────────────────────────────────────────────────

router.put('/profiles/:id', async (req, res) => {
  try {
    const { name, keys } = req.body;

    const sanitizedKeys = {};
    for (const [k, v] of Object.entries(keys || {})) {
      if (!/^[A-Z0-9_]+$/i.test(k))
        return res.status(400).json({ error: `Invalid key name: ${k}` });
      if (typeof v !== 'string')
        return res.status(400).json({ error: `Key value must be a string: ${k}` });
      sanitizedKeys[k] = v;
    }

    const store   = getStore();
    const updated = await store.updateProfile(req.params.id, { name, keys: sanitizedKeys });
    if (!updated) return res.status(404).json({ error: 'Profile not found' });
    res.json(updated);
  } catch (err) { handleErr(res, err); }
});

// ─── DELETE /profiles/:id ─────────────────────────────────────────────────────

router.delete('/profiles/:id', async (req, res) => {
  try {
    const store  = getStore();
    const result = await store.deleteProfile(req.params.id);
    if (!result) return res.status(404).json({ error: 'Profile not found' });
    res.json({ success: true });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /profiles/:id/export ────────────────────────────────────────────────

router.post('/profiles/:id/export', async (req, res) => {
  try {
    const store  = getStore();
    const dotenv = await store.exportEnv(req.params.id);
    if (dotenv === null) return res.status(404).json({ error: 'Profile not found' });
    res
      .set('Content-Type', 'text/plain; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="kuadashboard-${req.params.id}.env"`)
      .send(dotenv);
  } catch (err) { handleErr(res, err); }
});

module.exports = router;

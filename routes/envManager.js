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
 * PUT    /profiles/:id          → update name / category / merge keys+meta
 * DELETE /profiles/:id          → delete profile + all its keys
 * POST   /profiles/:id/export   → download as .env file
 * POST   /import                → parse a .env file and create a profile
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
    const { name, provider, category, keys, meta } = req.body;
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

    // Sanitize meta: only allow valid key names, tags as string array
    const sanitizedMeta = {};
    for (const [k, v] of Object.entries(meta || {})) {
      if (!/^[A-Z0-9_]+$/i.test(k)) continue;
      sanitizedMeta[k] = { tags: Array.isArray(v?.tags) ? v.tags.map(String) : [] };
    }

    const store   = getStore();
    const profile = await store.createProfile({
      name: name.trim(), provider, category: (category || '').trim(), keys: sanitizedKeys, meta: sanitizedMeta,
    });
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
    const { name, category, keys, meta } = req.body;

    const sanitizedKeys = {};
    for (const [k, v] of Object.entries(keys || {})) {
      if (!/^[A-Z0-9_]+$/i.test(k))
        return res.status(400).json({ error: `Invalid key name: ${k}` });
      if (typeof v !== 'string')
        return res.status(400).json({ error: `Key value must be a string: ${k}` });
      sanitizedKeys[k] = v;
    }

    const sanitizedMeta = {};
    for (const [k, v] of Object.entries(meta || {})) {
      if (!/^[A-Z0-9_]+$/i.test(k)) continue;
      sanitizedMeta[k] = { tags: Array.isArray(v?.tags) ? v.tags.map(String) : [] };
    }

    const store   = getStore();
    const updated = await store.updateProfile(req.params.id, {
      name,
      category: category !== undefined ? (category || '').trim() : undefined,
      keys: sanitizedKeys,
      meta: sanitizedMeta,
    });
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

// ─── POST /import ─────────────────────────────────────────────────────────────
// Body: { content: string, name: string, category?: string, meta?: { KEY: { tags: string[] } } }
// Parses the .env content and creates a new profile with provider = 'generic'.

/**
 * Parse a .env file string into { key: value } pairs.
 * Supports:
 *   KEY=value
 *   KEY="quoted value"
 *   KEY='single quoted'
 *   # comment lines (ignored)
 *   Blank lines (ignored)
 */
function parseDotenv(content) {
  const result = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/i.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

router.post('/import', async (req, res) => {
  try {
    const { content, name, category, meta } = req.body;
    if (!content || typeof content !== 'string')
      return res.status(400).json({ error: '`content` (.env text) is required' });
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: '`name` is required' });

    const keys = parseDotenv(content);
    if (!Object.keys(keys).length)
      return res.status(400).json({ error: 'No valid KEY=value pairs found in the provided .env content' });

    const sanitizedMeta = {};
    for (const [k, v] of Object.entries(meta || {})) {
      if (!/^[A-Z0-9_]+$/i.test(k)) continue;
      sanitizedMeta[k] = { tags: Array.isArray(v?.tags) ? v.tags.map(String) : [] };
    }

    const store   = getStore();
    const profile = await store.createProfile({
      name:     name.trim(),
      provider: 'generic',
      category: (category || '').trim(),
      keys,
      meta: sanitizedMeta,
    });
    res.status(201).json(profile);
  } catch (err) { handleErr(res, err); }
});

module.exports = router;

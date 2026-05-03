'use strict';
/**
 * routes/vercel.js
 * Vercel integration endpoints.
 *
 * Base path: /api/cloud/vercel
 *
 * Authentication model:
 *   All requests require a `X-Profile-Id` header referencing a credential profile.
 *   Two types of profiles are supported:
 *     - Stored profile: ID referencing a profile in the credentialStore (e.g. "uuid-v4")
 *       Keys expected: VERCEL_API_TOKEN, optionally VERCEL_TEAM_ID
 *     - Local profile:  Prefix "local:" + raw token (e.g. "local:<token>")
 *
 * Endpoints:
 *   GET  /teams                                        → list teams the token belongs to
 *   GET  /projects                                     → list projects
 *   GET  /projects/:projectId/deployments              → list deployments for a project
 *   GET  /projects/:projectId/domains                  → list domains for a project
 *   GET  /projects/:projectId/env                      → list env vars (values masked)
 *   GET  /deployments/:deploymentId/functions          → list functions in a deployment
 *   GET  /deployments/:deploymentId/checks             → list deployment checks/status
 *   POST /deployments/:deploymentId/redeploy           → redeploy a deployment
 *   PATCH /deployments/:deploymentId/promote           → promote deployment to production
 *   PATCH /deployments/:deploymentId/cancel            → cancel an in-progress deployment
 *   GET  /deployments/:deploymentId/logs               → SSE stream of deployment build logs
 *
 * Vercel REST API base: https://api.vercel.com
 */

const express      = require('express');
const { getStore } = require('../lib/credentialStore');
const auditLog     = require('../lib/auditLog');

const router = express.Router();
const VERCEL_API = 'https://api.vercel.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleErr(res, err) {
  console.error('[vercel]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message });
}

/** Read X-Profile-Id header or return 400 */
function requireProfileId(req, res) {
  const id = req.headers['x-profile-id'];
  if (!id) { res.status(400).json({ error: 'X-Profile-Id header is required' }); return null; }
  return id;
}

/**
 * Resolve a Vercel API token and optional teamId from a profile identifier.
 * - "local:<token>"  → use the token directly
 * - "<uuid>"         → look up stored profile in credentialStore
 * Returns { token, teamId }
 */
async function resolveVercelAuth(profileId) {
  if (profileId.startsWith('local:')) {
    const token = profileId.slice(6);
    if (!token) throw Object.assign(new Error('Empty token in local profile'), { status: 400 });
    return { token, teamId: null };
  }

  const store = getStore();
  const keys  = await store.getRawKeys(profileId);
  if (!keys) throw Object.assign(new Error('Credential profile not found'), { status: 404 });

  const token = keys['VERCEL_API_TOKEN'];
  if (!token) throw Object.assign(new Error('Profile is missing VERCEL_API_TOKEN'), { status: 400 });

  return { token, teamId: keys['VERCEL_TEAM_ID'] || null };
}

/**
 * Make a fetch call to the Vercel API.
 * @param {string} path - API path (e.g. "/v9/projects")
 * @param {string} token - Bearer token
 * @param {object} [options] - fetch options override
 */
async function vercelFetch(path, token, options = {}) {
  const url = `${VERCEL_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg  = body?.error?.message || body?.message || res.statusText;
    throw Object.assign(new Error(`Vercel API error: ${msg}`), { status: res.status });
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

/** Append teamId query param if present */
function withTeam(qs, teamId) {
  if (!teamId) return qs;
  const sep = qs.includes('?') ? '&' : '?';
  return `${qs}${sep}teamId=${encodeURIComponent(teamId)}`;
}

// ─── GET /teams ───────────────────────────────────────────────────────────────

router.get('/teams', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token } = await resolveVercelAuth(profileId);
    const data = await vercelFetch('/v2/teams?limit=100', token);
    res.json((data.teams || []).map(t => ({
      id:        t.id,
      name:      t.name,
      slug:      t.slug,
      avatar:    t.avatar,
      createdAt: t.createdAt,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /projects ────────────────────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const qs = withTeam('/v9/projects?limit=100', teamId);
    const data = await vercelFetch(qs, token);
    res.json((data.projects || []).map(p => ({
      id:          p.id,
      name:        p.name,
      framework:   p.framework,
      nodeVersion: p.nodeVersion,
      updatedAt:   p.updatedAt,
      createdAt:   p.createdAt,
      latestDeployments: (p.latestDeployments || []).slice(0, 1).map(d => ({
        id:    d.id,
        state: d.readyState,
        url:   d.url,
      })),
      link: p.link
        ? { type: p.link.type, repo: p.link.repo || p.link.projectName }
        : null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /projects/:projectId/deployments ─────────────────────────────────────

router.get('/projects/:projectId/deployments', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { projectId } = req.params;
    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const target = req.query.target || '';  // 'production' | 'preview' | ''
    let qs = `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`;
    if (target) qs += `&target=${encodeURIComponent(target)}`;
    qs = withTeam(qs, teamId);

    const data = await vercelFetch(qs, token);
    res.json((data.deployments || []).map(d => ({
      id:         d.uid,
      name:       d.name,
      url:        d.url,
      state:      d.readyState,
      target:     d.target,
      createdAt:  d.createdAt,
      buildingAt: d.buildingAt,
      ready:      d.ready,
      creator:    d.creator ? { email: d.creator.email, username: d.creator.username } : null,
      meta:       d.meta || {},
      source:     d.source,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /projects/:projectId/domains ─────────────────────────────────────────

router.get('/projects/:projectId/domains', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { projectId } = req.params;
    const qs = withTeam(`/v9/projects/${encodeURIComponent(projectId)}/domains?limit=50`, teamId);
    const data = await vercelFetch(qs, token);
    res.json((data.domains || []).map(d => ({
      name:          d.name,
      apexName:      d.apexName,
      projectId:     d.projectId,
      redirect:      d.redirect,
      redirectStatus: d.redirectStatus,
      gitBranch:     d.gitBranch,
      verified:      d.verified,
      createdAt:     d.createdAt,
      updatedAt:     d.updatedAt,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /projects/:projectId/env ─────────────────────────────────────────────

router.get('/projects/:projectId/env', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { projectId } = req.params;
    const qs = withTeam(`/v9/projects/${encodeURIComponent(projectId)}/env`, teamId);
    const data = await vercelFetch(qs, token);
    // Return env vars with values masked — values are never exposed
    res.json((data.envs || []).map(e => ({
      id:         e.id,
      key:        e.key,
      target:     e.target,
      type:       e.type,
      gitBranch:  e.gitBranch,
      createdAt:  e.createdAt,
      updatedAt:  e.updatedAt,
      // value intentionally omitted — never expose secrets through this endpoint
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /deployments/:deploymentId/functions ─────────────────────────────────

router.get('/deployments/:deploymentId/functions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { deploymentId } = req.params;
    const qs = withTeam(`/v13/deployments/${encodeURIComponent(deploymentId)}/files`, teamId);
    const data = await vercelFetch(qs, token);

    // Filter to serverless/edge function files
    const files = Array.isArray(data) ? data : (data.files || []);
    const fns = files.filter(f =>
      f.type === 'lambda' || f.type === 'edge' ||
      (f.name && (f.name.includes('/api/') || f.name.endsWith('.js') || f.name.endsWith('.ts')))
    );
    res.json(fns.map(f => ({
      name:   f.name,
      type:   f.type,
      uid:    f.uid,
      mode:   f.mode,
      symlink: f.symlink,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /deployments/:deploymentId/checks ────────────────────────────────────

router.get('/deployments/:deploymentId/checks', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { deploymentId } = req.params;
    const qs = withTeam(`/v1/deployments/${encodeURIComponent(deploymentId)}/checks`, teamId);
    const data = await vercelFetch(qs, token);
    res.json(data.checks || []);
  } catch (err) { handleErr(res, err); }
});

// ─── POST /deployments/:deploymentId/redeploy ─────────────────────────────────

router.post('/deployments/:deploymentId/redeploy', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { deploymentId } = req.params;
    let qs = `/v13/deployments/${encodeURIComponent(deploymentId)}/redeploy`;
    qs = withTeam(qs, teamId);

    const data = await vercelFetch(qs, token, { method: 'POST', body: JSON.stringify({}) });

    auditLog.log({
      category: 'vercel',
      action:   'redeploy',
      resource: deploymentId,
      details:  { newDeploymentId: data.id || data.uid },
      level:    'info',
    });

    res.json({ id: data.id || data.uid, state: data.readyState, url: data.url });
  } catch (err) { handleErr(res, err); }
});

// ─── PATCH /deployments/:deploymentId/promote ─────────────────────────────────

router.patch('/deployments/:deploymentId/promote', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { deploymentId } = req.params;
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId is required in request body' });

    let qs = `/v12/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`;
    qs = withTeam(qs, teamId);

    await vercelFetch(qs, token, { method: 'POST', body: JSON.stringify({}) });

    auditLog.log({
      category: 'vercel',
      action:   'promote',
      resource: deploymentId,
      details:  { projectId },
      level:    'info',
    });

    res.json({ ok: true, deploymentId, projectId });
  } catch (err) { handleErr(res, err); }
});

// ─── PATCH /deployments/:deploymentId/cancel ──────────────────────────────────

router.patch('/deployments/:deploymentId/cancel', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { deploymentId } = req.params;
    let qs = `/v12/deployments/${encodeURIComponent(deploymentId)}/cancel`;
    qs = withTeam(qs, teamId);

    const data = await vercelFetch(qs, token, { method: 'PATCH', body: JSON.stringify({}) });

    auditLog.log({
      category: 'vercel',
      action:   'cancel',
      resource: deploymentId,
      details:  {},
      level:    'warning',
    });

    res.json({ ok: true, uid: data.uid, state: data.readyState });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /deployments/:deploymentId/logs (SSE proxy) ─────────────────────────

router.get('/deployments/:deploymentId/logs', async (req, res) => {
  // Accept profile id from header (normal API calls) or query param (EventSource / SSE)
  const profileId = req.headers['x-profile-id'] || req.query.profileId;
  if (!profileId) return res.status(400).json({ error: 'X-Profile-Id header or profileId query param is required' });
  try {
    const { token, teamId } = await resolveVercelAuth(profileId);
    const { deploymentId } = req.params;
    let qs = `/v2/deployments/${encodeURIComponent(deploymentId)}/events?direction=forward&follow=1`;
    qs = withTeam(qs, teamId);

    const upstream = await fetch(`${VERCEL_API}${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    });

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json({ error: body?.error?.message || upstream.statusText });
    }

    // Set SSE headers and proxy the stream
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const { Readable } = require('stream');
    const nodeStream = Readable.fromWeb
      ? Readable.fromWeb(upstream.body)
      : upstream.body; // Node 18+ native fetch has web ReadableStream

    nodeStream.on('data', chunk => {
      if (!res.writableEnded) res.write(chunk);
    });
    nodeStream.on('end', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });

    req.on('close', () => {
      try { nodeStream.destroy?.(); } catch (_) {}
    });
  } catch (err) { handleErr(res, err); }
});

module.exports = router;

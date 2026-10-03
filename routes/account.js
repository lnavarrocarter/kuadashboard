'use strict';
/**
 * routes/account.js
 * /api/account: link this KUA to a KUA account and manage its plan
 * (lib/account/account.js). The session token stays in the backend.
 *
 *   GET  /            status (user, plan, entitlements; never the token)
 *   POST /login       URL to open in the browser to sign in with Google
 *   GET  /callback    where the control plane returns the one-time code
 *   POST /refresh     read the plan again (after paying or in the portal)
 *   POST /logout
 *   POST /checkout    { plan: pro|team, interval: month|year } → URL
 *   POST /portal      billing portal URL
 *   GET  /backups     cloud backups of KUA Applications (Pro and Team)
 *   DELETE /backups/:id
 *   (creating and restoring a backup live in routes/kuaApps.js, next to the bundle export)
 */

const express = require('express');
const { getAccount } = require('../lib/account/account');

function createAccountRouter({ account = getAccount, port = () => process.env.PORT || 7190 } = {}) {
  const router = express.Router();

  const fail = (res, err) => res.status(err.statusCode || 500).json({ error: err.message, code: err.code });

  // Restores a session kept in the keychain when this KUA has no cached account yet.
  router.get('/', async (_req, res) => {
    try { res.json(await account().restore()); } catch { res.json(account().status()); }
  });

  router.post('/login', (_req, res) => {
    // KUA listens on the loopback address only (server.js), which is what the control plane accepts.
    const callbackUrl = `http://127.0.0.1:${port()}/api/account/callback`;
    res.json(account().startLogin({ callbackUrl }));
  });

  router.get('/callback', async (req, res) => {
    const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>KUA · ${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}main{max-width:420px;padding:24px;text-align:center}p{color:#94a3b8;line-height:1.5}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
    try {
      const status = await account().completeLogin({ code: String(req.query.code || ''), state: String(req.query.state || '') });
      const email = String(status.user?.email || '').replace(/[<>&"]/g, '');
      res.type('html').send(page('Signed in to KUA', `${email} is linked to this KUA. You can close this tab and return to KUA.`));
    } catch (err) {
      const message = String(err.message || 'Sign-in failed').replace(/[<>&"]/g, '');
      res.status(err.statusCode || 400).type('html').send(page('Sign-in did not complete', message));
    }
  });

  router.post('/refresh', async (_req, res) => {
    try { res.json(await account().refresh()); } catch (err) { fail(res, err); }
  });

  router.post('/logout', async (_req, res) => {
    try { res.json(await account().logout()); } catch (err) { fail(res, err); }
  });

  router.post('/checkout', async (req, res) => {
    const plan = String(req.body?.plan || '');
    const interval = String(req.body?.interval || 'month');
    if (!['pro', 'team'].includes(plan) || !['month', 'year'].includes(interval)) return res.status(400).json({ error: 'plan must be pro or team and interval month or year' });
    try { res.json(await account().checkout({ plan, interval })); } catch (err) { fail(res, err); }
  });

  router.post('/portal', async (_req, res) => {
    try { res.json(await account().portal()); } catch (err) { fail(res, err); }
  });

  router.get('/backups', async (_req, res) => {
    try { res.json(await account().backups.list()); } catch (err) { fail(res, err); }
  });

  router.delete('/backups/:id', async (req, res) => {
    try { await account().backups.remove(req.params.id); res.status(204).end(); } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = { createAccountRouter };

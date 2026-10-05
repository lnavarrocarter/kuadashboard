'use strict';
/**
 * routes/advisor.js
 * /api/advisor: what a team decided about Advisor findings and how the
 * posture evolves (lib/advisor/posture.js). The scopes come in the reports
 * themselves (report.posture), so the UI never builds them.
 *
 *   GET    /acceptances?scope=   accepted and silenced findings of a scope (expired ones flagged)
 *   POST   /acceptances          { scope, ruleId, resources?, kind, reason, expiresAt? }  (Pro)
 *   DELETE /acceptances/:id      revoke: the finding counts again
 *   GET    /history?scope=&days= one summary per analysis                                 (Pro)
 *   GET    /alerts?limit=        posture alerts, newest first, with the unread count     (Pro)
 *   POST   /alerts/read          { ids } or { all: true }                                 (Pro)
 *   GET    /schedules            scheduled analyses (lib/advisor/scheduler.js)
 *   PUT    /schedules            { scope, intervalHours }  every 6 h at most on Pro, 1 h on Team
 *   DELETE /schedules?scope=     stop analysing a scope on its own
 *   GET    /webhooks             Slack/Teams channels for alerts (URLs masked)
 *   POST   /webhooks             { name, kind: slack|teams, url, minSeverity, lang }      (Team)
 *   PATCH  /webhooks/:id         { name?, minSeverity?, lang?, enabled? }                 (Team)
 *   DELETE /webhooks/:id
 *   POST   /webhooks/:id/test    sends a test message now                                 (Team)
 */

const express = require('express');
const { getPlan, planError } = require('../lib/plans');

const SCOPE_RE = /^(aws|gcp|kubernetes|product):.+/;

function validScope(value) {
  const scope = String(value || '');
  if (!SCOPE_RE.test(scope)) throw Object.assign(new Error('A valid Advisor scope is required'), { statusCode: 400 });
  return scope;
}

/** Name recorded with the decision: the linked KUA account, else this computer. */
function currentAuthor() {
  try {
    const status = require('../lib/account/account').getAccount().status();
    if (status.linked) return status.user.email || status.user.name || 'local';
  } catch { /* no account */ }
  return 'local';
}

function createAdvisorRouter({ store, scheduler = null, webhooks = null, auditLog, plan = getPlan, author = currentAuthor } = {}) {
  const router = express.Router();
  const fail = (res, err) => res.status(err.statusCode || 500).json({ error: err.message, code: err.code, required: err.required });
  // Accepting findings and reading their history are part of the Advisor (Pro and Team).
  const requireAdvisor = () => {
    if (!plan().features.advisor) throw planError('The KUA Advisor is part of the Pro and Team plans', 'pro');
  };

  router.get('/acceptances', (req, res) => {
    try { res.json(store().list(validScope(req.query.scope))); } catch (err) { fail(res, err); }
  });

  router.post('/acceptances', (req, res) => {
    try {
      requireAdvisor();
      const body = req.body || {};
      const scopeKey = validScope(body.scope);
      const resources = Array.isArray(body.resources)
        ? body.resources.slice(0, 50).map(item => ({ kind: String(item?.kind || ''), namespace: String(item?.namespace || ''), name: String(item?.name || '') })).filter(item => item.name)
        : [];
      const created = store().accept({ scopeKey, ruleId: String(body.ruleId || ''), resources, kind: body.kind || 'accepted', reason: body.reason, expiresAt: body.expiresAt || null, author: author() });
      auditLog?.log({
        category: 'advisor',
        action: created[0].kind === 'silenced' ? 'Advisor finding silenced' : 'Advisor risk accepted',
        resource: created[0].ruleId,
        details: { scope: scopeKey, reason: created[0].reason, expiresAt: created[0].expiresAt, resources: created.map(item => item.resourceLabel).filter(Boolean) },
      });
      res.status(201).json(created);
    } catch (err) { fail(res, err); }
  });

  router.delete('/acceptances/:id', (req, res) => {
    try {
      const revoked = store().revoke(req.params.id, { by: author() });
      if (!revoked) return res.status(404).json({ error: 'Acceptance not found' });
      auditLog?.log({ category: 'advisor', action: 'Advisor acceptance revoked', resource: revoked.ruleId, details: { scope: revoked.scope, kind: revoked.kind, resource: revoked.resourceLabel } });
      res.json(revoked);
    } catch (err) { fail(res, err); }
  });

  // Posture alerts: what changed between analyses, and acceptances about to expire.
  router.get('/alerts', (req, res) => {
    try {
      requireAdvisor();
      res.json(store().alerts({ limit: req.query.limit }));
    } catch (err) { fail(res, err); }
  });

  // { ids: [..] } or { all: true }
  router.post('/alerts/read', (req, res) => {
    try {
      requireAdvisor();
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : null;
      if (!ids && req.body?.all !== true) throw Object.assign(new Error('Send ids or all: true'), { statusCode: 400 });
      res.json({ changed: store().markRead({ ids, all: req.body?.all === true }), unread: store().alerts({ limit: 1 }).unread });
    } catch (err) { fail(res, err); }
  });

  router.get('/schedules', (_req, res) => {
    res.json(scheduler ? scheduler.list() : []);
  });

  router.put('/schedules', (req, res) => {
    try {
      if (!scheduler) return res.status(503).json({ error: 'Scheduled analysis is not available' });
      const scope = validScope(req.body?.scope);
      const schedule = scheduler.set(scope, req.body?.intervalHours);
      auditLog?.log({ category: 'advisor', action: 'Advisor scheduled analysis set', resource: scope, details: { intervalHours: schedule.intervalHours } });
      res.json(schedule);
    } catch (err) { fail(res, err); }
  });

  router.delete('/schedules', (req, res) => {
    try {
      if (!scheduler) return res.status(503).json({ error: 'Scheduled analysis is not available' });
      const scope = validScope(req.query.scope);
      if (!scheduler.remove(scope)) return res.status(404).json({ error: 'No scheduled analysis for this scope' });
      auditLog?.log({ category: 'advisor', action: 'Advisor scheduled analysis stopped', resource: scope });
      res.json({ removed: true });
    } catch (err) { fail(res, err); }
  });

  // Alert webhooks (lib/advisor/webhooks.js): the URL is a secret and never comes back unmasked.
  const webhooksOr503 = res => {
    if (!webhooks) { res.status(503).json({ error: 'Alert webhooks are not available' }); return null; }
    return webhooks;
  };

  router.get('/webhooks', (_req, res) => {
    res.json(webhooks ? webhooks.list() : []);
  });

  router.post('/webhooks', (req, res) => {
    try {
      if (!webhooksOr503(res)) return;
      const created = webhooks.create(req.body || {});
      auditLog?.log({ category: 'advisor', action: 'Advisor alert webhook added', resource: created.name, details: { kind: created.kind, minSeverity: created.minSeverity } });
      res.status(201).json(created);
    } catch (err) { fail(res, err); }
  });

  router.patch('/webhooks/:id', (req, res) => {
    try {
      if (!webhooksOr503(res)) return;
      const updated = webhooks.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Webhook not found' });
      res.json(updated);
    } catch (err) { fail(res, err); }
  });

  router.delete('/webhooks/:id', (req, res) => {
    try {
      if (!webhooksOr503(res)) return;
      const existing = webhooks.list().find(item => item.id === req.params.id);
      if (!existing || !webhooks.remove(req.params.id)) return res.status(404).json({ error: 'Webhook not found' });
      auditLog?.log({ category: 'advisor', action: 'Advisor alert webhook removed', resource: existing.name, details: { kind: existing.kind } });
      res.json({ removed: true });
    } catch (err) { fail(res, err); }
  });

  router.post('/webhooks/:id/test', async (req, res) => {
    try {
      if (!webhooksOr503(res)) return;
      const result = await webhooks.test(req.params.id);
      if (!result) return res.status(404).json({ error: 'Webhook not found' });
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  router.get('/history', (req, res) => {
    try {
      requireAdvisor();
      res.json(store().history(validScope(req.query.scope), { days: req.query.days }));
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = { createAdvisorRouter };

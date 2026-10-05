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

function createAdvisorRouter({ store, auditLog, plan = getPlan, author = currentAuthor } = {}) {
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

  router.get('/history', (req, res) => {
    try {
      requireAdvisor();
      res.json(store().history(validScope(req.query.scope), { days: req.query.days }));
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = { createAdvisorRouter };

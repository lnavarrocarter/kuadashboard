'use strict';

const PLANS = Object.freeze({
  free: Object.freeze({
    plan: 'free',
    features: Object.freeze({ cloudBackup: false, remoteHistory: false, teamSharing: false, teamRoles: false, auditComments: false }),
    limits: Object.freeze({ cloudBackups: 0, members: 1 }),
  }),
  pro: Object.freeze({
    plan: 'pro',
    features: Object.freeze({ cloudBackup: true, remoteHistory: true, teamSharing: false, teamRoles: false, auditComments: false }),
    limits: Object.freeze({ cloudBackups: 100, members: 1 }),
  }),
  team: Object.freeze({
    plan: 'team',
    features: Object.freeze({ cloudBackup: true, remoteHistory: true, teamSharing: true, teamRoles: true, auditComments: true }),
    limits: Object.freeze({ cloudBackups: 1000, members: 10 }),
  }),
});

function activePlan(subscription, stripePrices = {}) {
  if (!subscription || !['active', 'trialing'].includes(subscription.status)) return 'free';
  if (subscription.plan === 'pro' || subscription.priceId === stripePrices.pro) return 'pro';
  if (subscription.plan === 'team' || subscription.priceId === stripePrices.team) return 'team';
  return 'free';
}

function entitlementsFor(subscription, stripePrices) {
  const plan = activePlan(subscription, stripePrices);
  return { ...PLANS[plan], source: subscription ? 'subscription' : 'default' };
}

module.exports = { PLANS, activePlan, entitlementsFor };

'use strict';

const PLANS = Object.freeze({
  free: Object.freeze({
    plan: 'free',
    features: Object.freeze({ cloudBackup: false, remoteHistory: false, teamSharing: false, teamRoles: false, auditComments: false, logAutoRefresh: false }),
    // Log limits are enforced by the desktop app (lib/plans.js keeps the same values).
    limits: Object.freeze({ cloudBackups: 0, members: 1, logCacheMaxMb: 256, logRefreshMinMinutes: null }),
  }),
  pro: Object.freeze({
    plan: 'pro',
    features: Object.freeze({ cloudBackup: true, remoteHistory: true, teamSharing: false, teamRoles: false, auditComments: false, logAutoRefresh: true }),
    limits: Object.freeze({ cloudBackups: 100, members: 1, logCacheMaxMb: 2048, logRefreshMinMinutes: 15 }),
  }),
  team: Object.freeze({
    plan: 'team',
    features: Object.freeze({ cloudBackup: true, remoteHistory: true, teamSharing: true, teamRoles: true, auditComments: true, logAutoRefresh: true }),
    limits: Object.freeze({ cloudBackups: 1000, members: 10, logCacheMaxMb: 20480, logRefreshMinMinutes: 1 }),
  }),
});

/** Plan of a Stripe price id among the configured monthly and yearly prices. */
function planForPrice(priceId, stripePrices = {}) {
  if (!priceId) return null;
  if (priceId === stripePrices.team || priceId === stripePrices.teamYearly) return 'team';
  if (priceId === stripePrices.pro || priceId === stripePrices.proYearly) return 'pro';
  return null;
}

function activePlan(subscription, stripePrices = {}) {
  if (!subscription || !['active', 'trialing'].includes(subscription.status)) return 'free';
  // The price decides: plan changes from the customer portal keep the old checkout metadata.
  const byPrice = planForPrice(subscription.priceId, stripePrices);
  if (byPrice) return byPrice;
  if (subscription.plan === 'pro' || subscription.plan === 'team') return subscription.plan;
  return 'free';
}

function entitlementsFor(subscription, stripePrices) {
  const plan = activePlan(subscription, stripePrices);
  return { ...PLANS[plan], source: subscription ? 'subscription' : 'default' };
}

module.exports = { PLANS, planForPrice, activePlan, entitlementsFor };

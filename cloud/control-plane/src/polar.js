'use strict';

// Polar (merchant of record) billing: checkout, customer portal and webhooks
// over the REST API (no SDK: the v1 SDK is ESM-only and this service is CJS).
//
// Customers are linked by `external_customer_id` = KUA user id, so no Polar
// customer id has to be stored. Products carry metadata { plan: pro|team }.

const crypto = require('crypto');

const API_BASE = {
  sandbox: 'https://sandbox-api.polar.sh',
  production: 'https://api.polar.sh',
};
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
// Subscription events that change entitlements.
const SUBSCRIPTION_EVENTS = [
  'subscription.created', 'subscription.updated', 'subscription.active',
  'subscription.canceled', 'subscription.uncanceled', 'subscription.revoked',
];

function httpError(message, statusCode, details) {
  return Object.assign(new Error(message), { statusCode, ...(details ? { details } : {}) });
}

function createPolarClient({ accessToken, server = 'sandbox', fetchImpl = fetch } = {}) {
  const base = API_BASE[server] || API_BASE.sandbox;
  async function request(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const detail = Array.isArray(data?.detail) ? data.detail.map(d => d.msg).join('; ') : data?.detail || data?.error || response.statusText;
      throw httpError(`Polar API ${response.status}: ${detail}`, response.status === 404 ? 404 : 502);
    }
    return data;
  }
  return {
    createCheckout(input) { return request('POST', '/v1/checkouts/', input); },
    createCustomerSession(input) { return request('POST', '/v1/customer-sessions/', input); },
    request,
  };
}

// ── Webhooks (Standard Webhooks) ─────────────────────────────────────────────
// Secrets created since 2026-09-08 use Standard Webhooks with the whsec_ value
// as-is (base64 after the prefix); older Polar secrets use the UTF-8 bytes of
// the whole whsec_ string as HMAC key. Both are accepted, like Polar's SDKs.

function signingKeys(secret) {
  const value = String(secret || '');
  const keys = [Buffer.from(value, 'utf8')];
  if (value.startsWith('whsec_')) {
    try { keys.unshift(Buffer.from(value.slice(6), 'base64')); } catch (_) { /* not base64 */ }
  }
  return keys;
}

function sign(key, id, timestamp, body) {
  return crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

/** Verifies and parses a webhook; throws a 400 error when the signature is not valid. */
function verifyWebhook(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = String(headers['webhook-signature'] || '').split(' ')
    .map(part => part.split(',')).filter(([version]) => version === 'v1').map(([, value]) => value);
  if (!id || !timestamp || !signatures.length) throw httpError('Invalid Polar webhook signature', 400);
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) throw httpError('Polar webhook timestamp out of tolerance', 400);
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const valid = signingKeys(secret).some(key => {
    const expected = Buffer.from(sign(key, id, timestamp, body));
    return signatures.some(value => {
      const provided = Buffer.from(value);
      return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    });
  });
  if (!valid) throw httpError('Invalid Polar webhook signature', 400);
  let event;
  try { event = JSON.parse(body); } catch (_) { throw httpError('Invalid Polar webhook payload', 400); }
  return { id, event };
}

/** Plan of a Polar product: its metadata, or the configured product ids. */
function planForProduct(product, polarProducts = {}) {
  const fromMetadata = product?.metadata?.plan;
  if (fromMetadata === 'pro' || fromMetadata === 'team') return fromMetadata;
  const id = product?.id;
  if (!id) return null;
  if (id === polarProducts.team || id === polarProducts.teamYearly) return 'team';
  if (id === polarProducts.pro || id === polarProducts.proYearly) return 'pro';
  return null;
}

/**
 * What a subscription event means for KUA: `{ userId, remove }` or
 * `{ userId, subscription }` (the record stored in the repository).
 */
function subscriptionChange(event, polarProducts = {}) {
  if (!SUBSCRIPTION_EVENTS.includes(event?.type)) return null;
  const sub = event.data || {};
  const userId = sub.customer?.external_id || sub.metadata?.userId || null;
  if (!userId) return null;
  // Revoked (or ended) subscriptions lose access now; a cancellation at period
  // end stays active until Polar revokes it.
  if (event.type === 'subscription.revoked' || ['canceled', 'incomplete_expired', 'unpaid'].includes(sub.status)) {
    return { userId, remove: true };
  }
  return {
    userId,
    subscription: {
      provider: 'polar',
      polarSubscriptionId: sub.id,
      polarCustomerId: sub.customer_id || sub.customer?.id || null,
      priceId: sub.product_id || sub.product?.id || '',
      plan: planForProduct(sub.product, polarProducts) || sub.metadata?.plan || 'pro',
      interval: sub.recurring_interval || null,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      currentPeriodEnd: sub.current_period_end || null,
    },
  };
}

module.exports = { API_BASE, SUBSCRIPTION_EVENTS, createPolarClient, verifyWebhook, sign, signingKeys, planForProduct, subscriptionChange };

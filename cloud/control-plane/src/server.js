'use strict';

const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const Stripe = require('stripe');
const { loadConfig, missingGoogleConfig, missingStripeConfig } = require('./config');
const { createCloudRepository } = require('./repository');
const { entitlementsFor } = require('./entitlements');

const SESSION_COOKIE = 'kua_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const PLAN_NAMES = new Set(['pro', 'team']);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signState(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyState(value, secret, now = Date.now()) {
  const [encoded, signature] = String(value || '').split('.');
  if (!encoded || !signature) throw Object.assign(new Error('Invalid OAuth state'), { statusCode: 400 });
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw Object.assign(new Error('Invalid OAuth state'), { statusCode: 400 });
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch (_) {
    throw Object.assign(new Error('Invalid OAuth state'), { statusCode: 400 });
  }
  if (!payload.createdAt || now - payload.createdAt > OAUTH_STATE_MAX_AGE_MS) {
    throw Object.assign(new Error('Expired OAuth state'), { statusCode: 400 });
  }
  return payload;
}

function safeReturnTo(value, frontendUrl) {
  const requested = String(value || '/').trim();
  if (requested.startsWith('/') && !requested.startsWith('//')) return requested;
  try {
    const url = new URL(requested);
    const frontend = new URL(frontendUrl);
    if (url.origin === frontend.origin) return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {}
  return '/';
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, picture: user.picture || null };
}

function createApp({ config = loadConfig(), repository, googleClient, stripeClient, now = () => Date.now() } = {}) {
  if (!repository) throw new Error('repository is required');
  const app = express();
  const oauth = googleClient || (config.googleClientId && config.googleClientSecret
    ? new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri)
    : null);
  const stripe = stripeClient || (config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null);

  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && origin === config.frontendOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  function jsonError(res, error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || 'Internal server error' });
  }

  function setSessionCookie(res, token) {
    const attributes = [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      'HttpOnly', 'Path=/', `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`, 'SameSite=Lax',
    ];
    if (config.secureCookies) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`);
  }

  async function currentUser(req) {
    const authorization = req.get('Authorization') || '';
    const cookie = req.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
    const rawToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : cookie && decodeURIComponent(cookie);
    if (!rawToken) return null;
    const session = await repository.findSession(hashSessionToken(rawToken));
    return session ? repository.findUserById(session.userId) : null;
  }

  async function requireUser(req, res, next) {
    try {
      req.user = await currentUser(req);
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      next();
    } catch (error) { jsonError(res, error); }
  }

  async function updateSubscriptionFromStripe(subscription) {
    const userId = subscription.metadata?.userId;
    const user = userId
      ? await repository.findUserById(userId)
      : await repository.findUserByStripeCustomerId(subscription.customer);
    if (!user) return false;
    const priceId = subscription.items?.data?.[0]?.price?.id || subscription.metadata?.priceId || '';
    const plan = subscription.metadata?.plan || (priceId === config.stripePrices.team ? 'team' : 'pro');
    await repository.upsertSubscription(user.id, {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: String(subscription.customer || user.stripeCustomerId || ''),
      priceId,
      plan,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
      updatedAt: new Date(now()).toISOString(),
    });
    return true;
  }

  async function handleStripeEvent(event) {
    const object = event.data?.object || {};
    if (event.type === 'checkout.session.completed') {
      const userId = object.metadata?.userId || object.client_reference_id;
      if (userId) {
        const user = await repository.findUserById(userId);
        if (user) await repository.upsertUser({ ...user, stripeCustomerId: String(object.customer || user.stripeCustomerId || ''), updatedAt: new Date(now()).toISOString() });
      }
      return;
    }
    if (event.type.startsWith('customer.subscription.')) {
      if (event.type.endsWith('.deleted') || object.status === 'canceled') {
        const userId = object.metadata?.userId;
        const user = userId ? await repository.findUserById(userId) : await repository.findUserByStripeCustomerId(object.customer);
        if (user) await repository.deleteSubscription(user.id);
        return;
      }
      await updateSubscriptionFromStripe(object);
    }
  }

  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'kua-control-plane', version: '0.1.0' }));

  app.get('/auth/google/start', (req, res) => {
    const missing = missingGoogleConfig(config);
    if (missing.length || !oauth) return res.status(503).json({ error: 'Google authentication is not configured', missing });
    const state = signState({
      createdAt: now(),
      nonce: crypto.randomBytes(16).toString('hex'),
      returnTo: safeReturnTo(req.query.returnTo, config.frontendUrl),
    }, config.sessionSecret);
    res.redirect(oauth.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      state,
      nonce: JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8')).nonce,
    }));
  });

  app.get('/auth/google/callback', async (req, res) => {
    try {
      const missing = missingGoogleConfig(config);
      if (missing.length || !oauth) return res.status(503).json({ error: 'Google authentication is not configured', missing });
      const state = verifyState(req.query.state, config.sessionSecret, now());
      if (!req.query.code) throw Object.assign(new Error('Google authorization code is required'), { statusCode: 400 });
      const { tokens } = await oauth.getToken(String(req.query.code));
      if (!tokens.id_token) throw Object.assign(new Error('Google did not return an ID token'), { statusCode: 401 });
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
      const identity = ticket.getPayload();
      if (!identity?.sub || !identity.email || identity.email_verified === false) {
        throw Object.assign(new Error('A verified Google account is required'), { statusCode: 403 });
      }
      if (identity.nonce !== state.nonce) {
        throw Object.assign(new Error('Invalid Google nonce'), { statusCode: 401 });
      }
      const existing = await repository.findUserByGoogleSub(identity.sub);
      const user = await repository.upsertUser({
        id: existing?.id || `google_${identity.sub}`,
        googleSub: identity.sub,
        email: identity.email.toLowerCase(),
        name: identity.name || identity.email,
        picture: identity.picture || null,
        createdAt: existing?.createdAt || new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
      });
      const rawSessionToken = crypto.randomBytes(32).toString('base64url');
      await repository.createSession({
        tokenHash: hashSessionToken(rawSessionToken),
        userId: user.id,
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + SESSION_MAX_AGE_MS).toISOString(),
      });
      setSessionCookie(res, rawSessionToken);
      res.redirect(`${config.frontendUrl}${state.returnTo || '/'}${state.returnTo?.includes('?') ? '&' : '?'}auth=complete`);
    } catch (error) { jsonError(res, error); }
  });

  app.post('/auth/logout', async (req, res) => {
    try {
      const cookie = req.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
      if (cookie) await repository.deleteSession(hashSessionToken(decodeURIComponent(cookie)));
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) { jsonError(res, error); }
  });

  // Stripe must receive the unparsed body so its signature can be verified.
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
      if (!stripe || !config.stripeWebhookSecret) return res.status(503).json({ error: 'Stripe webhooks are not configured' });
      try {
        event = stripe.webhooks.constructEvent(req.body, req.get('Stripe-Signature'), config.stripeWebhookSecret);
      } catch (_) {
        throw Object.assign(new Error('Invalid Stripe webhook signature'), { statusCode: 400 });
      }
      const claimed = await repository.claimWebhookEvent(event.id, event.type, new Date(now()).toISOString());
      if (claimed) {
        try { await handleStripeEvent(event); } catch (error) {
          await repository.releaseWebhookEvent(event.id);
          throw error;
        }
      }
      res.json({ received: true, duplicate: !claimed });
    } catch (error) { jsonError(res, error); }
  });

  app.use(express.json({ limit: '1mb' }));
  app.get('/api/me', requireUser, async (req, res) => {
    const subscription = await repository.getSubscriptionByUserId(req.user.id);
    res.json({ user: publicUser(req.user), entitlements: entitlementsFor(subscription, config.stripePrices) });
  });
  app.get('/api/entitlements', requireUser, async (req, res) => {
    const subscription = await repository.getSubscriptionByUserId(req.user.id);
    res.json(entitlementsFor(subscription, config.stripePrices));
  });

  app.post('/api/billing/checkout', requireUser, async (req, res) => {
    try {
      const plan = String(req.body?.plan || '').toLowerCase();
      if (!PLAN_NAMES.has(plan)) return res.status(400).json({ error: 'plan must be pro or team' });
      const missing = missingStripeConfig(config, plan);
      if (missing.length || !stripe) return res.status(503).json({ error: 'Stripe billing is not configured', missing });
      let user = req.user;
      if (!user.stripeCustomerId) {
        const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
        user = await repository.upsertUser({ ...user, stripeCustomerId: customer.id, updatedAt: new Date(now()).toISOString() });
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: user.stripeCustomerId,
        client_reference_id: user.id,
        line_items: [{ price: config.stripePrices[plan], quantity: 1 }],
        success_url: `${config.frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.frontendUrl}/billing/cancelled`,
        metadata: { userId: user.id, plan },
        subscription_data: { metadata: { userId: user.id, plan, priceId: config.stripePrices[plan] } },
      });
      res.status(201).json({ url: session.url, sessionId: session.id });
    } catch (error) { jsonError(res, error); }
  });

  app.post('/api/billing/portal', requireUser, async (req, res) => {
    try {
      if (!stripe || !config.stripeSecretKey) return res.status(503).json({ error: 'Stripe billing is not configured' });
      if (!req.user.stripeCustomerId) return res.status(400).json({ error: 'No Stripe customer exists for this account' });
      const session = await stripe.billingPortal.sessions.create({ customer: req.user.stripeCustomerId, return_url: config.frontendUrl });
      res.json({ url: session.url });
    } catch (error) { jsonError(res, error); }
  });

  return app;
}

async function start() {
  const config = loadConfig();
  const repository = createCloudRepository({ projectId: config.googleCloudProject, mode: config.databaseMode });
  const app = createApp({ config, repository });
  return app.listen(config.port, () => console.log(`[kua-control-plane] listening on ${config.port}`));
}

if (require.main === module) start().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { createApp, hashSessionToken, safeReturnTo, signState, verifyState };

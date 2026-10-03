'use strict';

const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const Stripe = require('stripe');
const { loadConfig, missingGoogleConfig, missingStripeConfig, missingPolarConfig } = require('./config');
const { createPolarClient, verifyWebhook: verifyPolarWebhook, subscriptionChange } = require('./polar');
const { createCloudRepository } = require('./repository');
const { entitlementsFor, planForPrice } = require('./entitlements');

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

const LOGIN_CODE_MAX_AGE_MS = 5 * 60 * 1000;
// KUA Desktop receives the sign-in on its own local server only (loopback, RFC 8252).
const DESKTOP_CALLBACK_PATH = '/api/account/callback';

/** Loopback redirect of KUA Desktop: http://127.0.0.1|localhost:<port>/api/account/callback, else null. */
function desktopRedirect(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
    if (url.pathname !== DESKTOP_CALLBACK_PATH || url.search || url.hash || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

/** PKCE S256 challenge of a verifier. */
function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(String(verifier)).digest('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, picture: user.picture || null };
}

function createApp({ config = loadConfig(), repository, googleClient, stripeClient, polarClient, now = () => Date.now() } = {}) {
  if (!repository) throw new Error('repository is required');
  const app = express();
  const oauth = googleClient || (config.googleClientId && config.googleClientSecret
    ? new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri)
    : null);
  const stripe = stripeClient || (config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null);
  const polar = polarClient || (config.polarAccessToken ? createPolarClient({ accessToken: config.polarAccessToken, server: config.polarServer }) : null);
  const usePolar = config.billingProvider === 'polar';

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
    // Unexpected failures go to Cloud Logging with their stack; client errors (4xx) do not.
    if (status >= 500) console.error('[kua-control-plane]', error.stack || error.message);
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
    const item = subscription.items?.data?.[0] || {};
    const priceId = item.price?.id || subscription.metadata?.priceId || '';
    // Price metadata (set on every KUA price) or the configured price ids decide the plan;
    // checkout metadata is only a fallback because portal plan changes do not update it.
    const plan = item.price?.metadata?.plan || planForPrice(priceId, config.stripePrices) || subscription.metadata?.plan || 'pro';
    // API 2025-03-31 (basil) moved the billing period to the subscription items.
    const periodEnd = subscription.current_period_end || item.current_period_end || null;
    await repository.upsertSubscription(user.id, {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: String(subscription.customer || user.stripeCustomerId || ''),
      priceId,
      plan,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
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

  // Cloud Run reserves paths ending in "z" (Google answers /healthz itself), so /health is the one to probe.
  const health = (_req, res) => res.json({ ok: true, service: 'kua-control-plane', version: '0.1.0' });
  app.get('/health', health);
  app.get('/healthz', health);

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

  app.get('/auth/desktop/start', (req, res) => {
    const missing = missingGoogleConfig(config);
    if (missing.length || !oauth) return res.status(503).json({ error: 'Google authentication is not configured', missing });
    const redirectUri = desktopRedirect(req.query.redirect_uri);
    if (!redirectUri) return res.status(400).json({ error: `redirect_uri must be http://127.0.0.1:<port>${DESKTOP_CALLBACK_PATH}` });
    const challenge = String(req.query.code_challenge || '');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return res.status(400).json({ error: 'code_challenge (S256) is required' });
    const desktopState = String(req.query.state || '').slice(0, 200);
    if (!desktopState) return res.status(400).json({ error: 'state is required' });
    const state = signState({
      createdAt: now(),
      nonce: crypto.randomBytes(16).toString('hex'),
      desktop: { redirectUri, challenge, state: desktopState },
    }, config.sessionSecret);
    res.redirect(oauth.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      state,
      nonce: JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8')).nonce,
    }));
  });

  // KUA Desktop exchanges the one-time code (and its PKCE verifier) for a session token.
  app.post('/auth/desktop/token', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const code = String(req.body?.code || '');
      const verifier = String(req.body?.code_verifier || '');
      if (!code || !verifier) return res.status(400).json({ error: 'code and code_verifier are required' });
      const login = await repository.consumeLoginCode(hashSessionToken(code));
      if (!login || login.challenge !== pkceChallenge(verifier)) return res.status(400).json({ error: 'Invalid or expired sign-in code' });
      const user = await repository.findUserById(login.userId);
      if (!user) return res.status(400).json({ error: 'Invalid or expired sign-in code' });
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(now() + SESSION_MAX_AGE_MS).toISOString();
      await repository.createSession({ tokenHash: hashSessionToken(token), userId: user.id, createdAt: new Date(now()).toISOString(), expiresAt, client: 'desktop' });
      const subscription = await repository.getSubscriptionByUserId(user.id);
      res.json({ token, expiresAt, user: publicUser(user), entitlements: entitlementsFor(subscription, config.stripePrices) });
    } catch (error) { jsonError(res, error); }
  });

  // Where checkout and the billing portal send desktop users back: a page that says to return to KUA.
  app.get('/billing/done', (req, res) => {
    const status = ['success', 'cancelled', 'portal'].includes(req.query.status) ? req.query.status : 'success';
    const messages = {
      success: ['Payment received', 'Your KUA plan updates in a few seconds. You can close this tab and return to KUA.'],
      cancelled: ['Checkout cancelled', 'Nothing was charged. You can close this tab and return to KUA.'],
      portal: ['Subscription updated', 'You can close this tab and return to KUA.'],
    };
    const [title, body] = messages[status];
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>KUA · ${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px}p{color:#94a3b8;line-height:1.5}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`);
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
      if (state.desktop) {
        const code = crypto.randomBytes(32).toString('base64url');
        await repository.createLoginCode({
          codeHash: hashSessionToken(code),
          userId: user.id,
          challenge: state.desktop.challenge,
          createdAt: new Date(now()).toISOString(),
          expiresAt: new Date(now() + LOGIN_CODE_MAX_AGE_MS).toISOString(),
        });
        const target = new URL(state.desktop.redirectUri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', state.desktop.state);
        return res.redirect(target.toString());
      }
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
      const authorization = req.get('Authorization') || '';
      if (authorization.startsWith('Bearer ')) await repository.deleteSession(hashSessionToken(authorization.slice(7).trim()));
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

  // Polar signs with Standard Webhooks over the raw body; subscriptions are linked by external_customer_id.
  app.post('/webhooks/polar', express.raw({ type: '*/*' }), async (req, res) => {
    try {
      if (!config.polarWebhookSecret) return res.status(503).json({ error: 'Polar webhooks are not configured' });
      const { id, event } = verifyPolarWebhook(req.body, {
        'webhook-id': req.get('webhook-id'), 'webhook-timestamp': req.get('webhook-timestamp'), 'webhook-signature': req.get('webhook-signature'),
      }, config.polarWebhookSecret, Math.floor(now() / 1000));
      const claimed = await repository.claimWebhookEvent(`polar_${id}`, event.type, new Date(now()).toISOString());
      if (claimed) {
        try {
          const change = subscriptionChange(event, config.polarProducts);
          const user = change && await repository.findUserById(change.userId);
          if (user && change.remove) await repository.deleteSubscription(user.id);
          else if (user) await repository.upsertSubscription(user.id, { ...change.subscription, updatedAt: new Date(now()).toISOString() });
        } catch (error) {
          await repository.releaseWebhookEvent(`polar_${id}`);
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
      const interval = String(req.body?.interval || 'month').toLowerCase();
      const desktop = req.body?.client === 'desktop';
      const successUrl = desktop ? `${config.controlPlaneUrl}/billing/done?status=success` : null;
      if (!['month', 'year'].includes(interval)) return res.status(400).json({ error: 'interval must be month or year' });
      if (usePolar) {
        const missing = missingPolarConfig(config, plan, interval);
        if (missing.length || !polar) return res.status(503).json({ error: 'Polar billing is not configured', missing });
        const productId = config.polarProducts[interval === 'year' ? `${plan}Yearly` : plan];
        const checkout = await polar.createCheckout({
          products: [productId],
          external_customer_id: req.user.id,
          customer_email: req.user.email,
          success_url: successUrl || `${config.frontendUrl}/billing/success?checkout_id={CHECKOUT_ID}`,
          metadata: { userId: req.user.id, plan, interval },
        });
        return res.status(201).json({ url: checkout.url, sessionId: checkout.id, provider: 'polar' });
      }
      const priceId = interval === 'year' ? config.stripePrices[`${plan}Yearly`] : config.stripePrices[plan];
      if (interval === 'year' && !priceId) return res.status(503).json({ error: 'Yearly billing is not configured', missing: [`stripePrices.${plan}Yearly`] });
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
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl || `${config.frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: desktop ? `${config.controlPlaneUrl}/billing/done?status=cancelled` : `${config.frontendUrl}/billing/cancelled`,
        metadata: { userId: user.id, plan, interval },
        subscription_data: { metadata: { userId: user.id, plan, priceId } },
      });
      res.status(201).json({ url: session.url, sessionId: session.id });
    } catch (error) { jsonError(res, error); }
  });

  app.post('/api/billing/portal', requireUser, async (req, res) => {
    try {
      if (usePolar) {
        if (!polar) return res.status(503).json({ error: 'Polar billing is not configured' });
        try {
          const returnUrl = req.body?.client === 'desktop' ? `${config.controlPlaneUrl}/billing/done?status=portal` : config.frontendUrl;
          const session = await polar.createCustomerSession({ external_customer_id: req.user.id, return_url: returnUrl });
          return res.json({ url: session.customer_portal_url, provider: 'polar' });
        } catch (error) {
          // The Polar customer only exists after the first checkout.
          if (error.statusCode === 404) return res.status(400).json({ error: 'No billing customer exists for this account yet' });
          throw error;
        }
      }
      if (!stripe || !config.stripeSecretKey) return res.status(503).json({ error: 'Stripe billing is not configured' });
      if (!req.user.stripeCustomerId) return res.status(400).json({ error: 'No Stripe customer exists for this account' });
      const session = await stripe.billingPortal.sessions.create({
        customer: req.user.stripeCustomerId,
        return_url: req.body?.client === 'desktop' ? `${config.controlPlaneUrl}/billing/done?status=portal` : config.frontendUrl,
        ...(config.stripePortalConfiguration ? { configuration: config.stripePortalConfiguration } : {}),
      });
      res.json({ url: session.url });
    } catch (error) { jsonError(res, error); }
  });

  return app;
}

async function start() {
  const config = loadConfig();
  const repository = createCloudRepository({ projectId: config.googleCloudProject, databaseId: config.databaseId, mode: config.databaseMode });
  const app = createApp({ config, repository });
  return app.listen(config.port, () => console.log(`[kua-control-plane] listening on ${config.port}`));
}

if (require.main === module) start().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { createApp, hashSessionToken, safeReturnTo, signState, verifyState };

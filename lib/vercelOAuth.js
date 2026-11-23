'use strict';

const crypto = require('node:crypto');
const { DEFAULT_CONTROL_PLANE_URL } = require('./account/account');

const REDIRECT_URI = 'https://lnavarrocarter.github.io/kuadashboard/vercel-callback';
const OAUTH = 'https://vercel.com/api/oauth';
const MAX_AGE_MS = 10 * 60 * 1000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function brokerUrl(env) {
  const url = new URL(env.KUA_CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE_URL);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw fail('Vercel OAuth requires an HTTPS control plane', 501);
  }
  return url.href.replace(/\/$/, '');
}

function createVercelOAuth({ env = process.env, now = Date.now, fetchImpl = (...args) => fetch(...args) } = {}) {
  const states = new Map();
  const clean = () => {
    for (const [key, value] of states) if (now() - value.createdAt >= MAX_AGE_MS) states.delete(key);
  };
  const request = async (url, body, form = false) => {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      });
    } catch { throw fail('Vercel connection is temporarily unavailable. Please try connecting again.', 502); }
    if (!response.ok) throw fail('Vercel connection is temporarily unavailable. Please try connecting again.', 502);
    try { return await response.json(); } catch { throw fail('Invalid Vercel authorization response', 502); }
  };

  async function start(profileName = 'Vercel') {
    clean();
    if (states.size >= 100) throw fail('Too many pending Vercel connections', 429);
    const direct = !!env.VERCEL_OAUTH_CLIENT_SECRET;
    const redirectUri = env.VERCEL_OAUTH_REDIRECT_URI || REDIRECT_URI;
    let state = crypto.randomBytes(32).toString('hex');
    let authorizationUrl;
    let verifier;
    let broker;
    if (direct) {
      if (!env.VERCEL_OAUTH_CLIENT_ID) throw fail('VERCEL_OAUTH_CLIENT_ID is required for a custom OAuth client', 501);
      authorizationUrl = `${OAUTH}/authorize?${new URLSearchParams({ client_id: env.VERCEL_OAUTH_CLIENT_ID, redirect_uri: redirectUri, state })}`;
    } else {
      broker = brokerUrl(env);
      verifier = crypto.randomBytes(32).toString('base64url');
      const result = await request(`${broker}/auth/vercel/start`, {
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      });
      const target = new URL(result.authorizationUrl);
      if (target.origin !== 'https://vercel.com' || target.pathname !== '/api/oauth/authorize'
        || typeof result.state !== 'string' || !result.state || result.state.length > 1024
        || target.searchParams.get('state') !== result.state) throw fail('Invalid Vercel authorization response', 502);
      state = result.state;
      authorizationUrl = target.href;
    }
    states.set(state, { createdAt: now(), profileName: String(profileName).slice(0, 64), direct, redirectUri, broker, verifier });
    return authorizationUrl;
  }

  async function exchange({ code, state, configurationId } = {}) {
    clean();
    if (typeof code !== 'string' || !code || code.length > 2048) throw fail('An authorization code is required');
    let attempt = typeof state === 'string' ? states.get(state) : null;
    // An unsolicited marketplace callback has no desktop-held verifier. Users
    // connect from KUA to establish one; custom integration owners retain their
    // explicitly configured legacy marketplace flow.
    if (!attempt && configurationId && env.VERCEL_OAUTH_CLIENT_ID && env.VERCEL_OAUTH_CLIENT_SECRET) {
      attempt = { profileName: 'Vercel', direct: true, redirectUri: env.VERCEL_OAUTH_REDIRECT_URI || REDIRECT_URI };
    }
    if (!attempt) throw fail(configurationId
      ? 'Open Connect with Vercel in KUA to finish linking this installation.' : 'Invalid or expired OAuth state');
    states.delete(state);
    const data = attempt.direct
      ? await request(`${OAUTH}/access_token`, {
        client_id: env.VERCEL_OAUTH_CLIENT_ID, client_secret: env.VERCEL_OAUTH_CLIENT_SECRET, code, redirect_uri: attempt.redirectUri,
      }, true)
      : await request(`${attempt.broker}/auth/vercel/token`, { code, state, code_verifier: attempt.verifier });
    if (typeof data.access_token !== 'string' || !data.access_token) throw fail('No access_token in Vercel response', 502);
    return { token: data.access_token, teamId: data.team_id || null, profileName: attempt.profileName };
  }
  return { start, exchange };
}

module.exports = { createVercelOAuth };

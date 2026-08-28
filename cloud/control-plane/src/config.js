'use strict';

function stringEnv(env, key, fallback = '') {
  return String(env[key] ?? fallback).trim();
}

function loadConfig(env = process.env) {
  const nodeEnv = stringEnv(env, 'NODE_ENV', 'development');
  const controlPlaneUrl = stringEnv(env, 'CONTROL_PLANE_URL', `http://localhost:${env.PORT || 8080}`).replace(/\/$/, '');
  const frontendUrl = stringEnv(env, 'FRONTEND_URL', 'http://localhost:5173').replace(/\/$/, '');
  let frontendOrigin = frontendUrl;
  try { frontendOrigin = new URL(frontendUrl).origin; } catch (_) {}
  return Object.freeze({
    nodeEnv,
    port: Number(env.PORT || 8080),
    controlPlaneUrl,
    frontendUrl,
    frontendOrigin,
    googleClientId: stringEnv(env, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: stringEnv(env, 'GOOGLE_CLIENT_SECRET'),
    googleRedirectUri: stringEnv(env, 'GOOGLE_REDIRECT_URI', `${controlPlaneUrl}/auth/google/callback`),
    sessionSecret: stringEnv(env, 'KUA_SESSION_SECRET'),
    stripeSecretKey: stringEnv(env, 'STRIPE_SECRET_KEY'),
    stripeWebhookSecret: stringEnv(env, 'STRIPE_WEBHOOK_SECRET'),
    stripePrices: Object.freeze({
      pro: stringEnv(env, 'STRIPE_PRICE_PRO'),
      team: stringEnv(env, 'STRIPE_PRICE_TEAM'),
    }),
    googleCloudProject: stringEnv(env, 'GOOGLE_CLOUD_PROJECT'),
    databaseMode: stringEnv(env, 'GCP_DATABASE_MODE', 'datastore').toLowerCase(),
    secureCookies: nodeEnv === 'production',
  });
}

function missingGoogleConfig(config) {
  return ['googleClientId', 'googleClientSecret', 'googleRedirectUri', 'sessionSecret']
    .filter(key => !config[key]);
}

function missingStripeConfig(config, plan) {
  const missing = [];
  if (!config.stripeSecretKey) missing.push('stripeSecretKey');
  if (!config.stripeWebhookSecret) missing.push('stripeWebhookSecret');
  if (!config.stripePrices[plan]) missing.push(`stripePrices.${plan}`);
  return missing;
}

module.exports = { loadConfig, missingGoogleConfig, missingStripeConfig };

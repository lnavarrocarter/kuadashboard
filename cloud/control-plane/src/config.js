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
    // Monthly prices are required for checkout; yearly ones are optional.
    stripePrices: Object.freeze({
      pro: stringEnv(env, 'STRIPE_PRICE_PRO'),
      team: stringEnv(env, 'STRIPE_PRICE_TEAM'),
      proYearly: stringEnv(env, 'STRIPE_PRICE_PRO_YEARLY'),
      teamYearly: stringEnv(env, 'STRIPE_PRICE_TEAM_YEARLY'),
    }),
    // Customer portal configuration (bpc_...); Stripe's default one does not exist until saved in the Dashboard.
    stripePortalConfiguration: stringEnv(env, 'STRIPE_PORTAL_CONFIGURATION'),
    // Polar (merchant of record): one product per plan and interval.
    polarAccessToken: stringEnv(env, 'POLAR_ACCESS_TOKEN'),
    polarWebhookSecret: stringEnv(env, 'POLAR_WEBHOOK_SECRET'),
    polarServer: stringEnv(env, 'POLAR_SERVER', 'sandbox').toLowerCase(),
    polarProducts: Object.freeze({
      pro: stringEnv(env, 'POLAR_PRODUCT_PRO'),
      team: stringEnv(env, 'POLAR_PRODUCT_TEAM'),
      proYearly: stringEnv(env, 'POLAR_PRODUCT_PRO_YEARLY'),
      teamYearly: stringEnv(env, 'POLAR_PRODUCT_TEAM_YEARLY'),
    }),
    // 'polar' or 'stripe'; by default Polar when its token is configured.
    billingProvider: stringEnv(env, 'BILLING_PROVIDER', stringEnv(env, 'POLAR_ACCESS_TOKEN') ? 'polar' : 'stripe').toLowerCase(),
    googleCloudProject: stringEnv(env, 'GOOGLE_CLOUD_PROJECT'),
    databaseMode: stringEnv(env, 'GCP_DATABASE_MODE', 'datastore').toLowerCase(),
    // Named database (e.g. kua-control-plane); empty uses the project's (default) database.
    databaseId: stringEnv(env, 'GCP_DATABASE_ID'),
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

function missingPolarConfig(config, plan, interval = 'month') {
  const missing = [];
  if (!config.polarAccessToken) missing.push('polarAccessToken');
  if (!config.polarWebhookSecret) missing.push('polarWebhookSecret');
  const key = interval === 'year' ? `${plan}Yearly` : plan;
  if (!config.polarProducts[key]) missing.push(`polarProducts.${key}`);
  return missing;
}

module.exports = { loadConfig, missingGoogleConfig, missingStripeConfig, missingPolarConfig };

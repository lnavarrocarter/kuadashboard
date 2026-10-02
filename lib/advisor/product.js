'use strict';
/**
 * lib/advisor/product.js
 * Product lens for a KUApps application: are its objectives defined and met,
 * does it have an owner, a release path and enough telemetry to know how
 * users are served. The technical lens (security, infrastructure,
 * architecture, development) lives in the provider overviews; this one only
 * looks at the application as a product. Pure: no I/O.
 */

const { check, buildReport, PRODUCT_CATEGORIES } = require('./core');
const { DEFAULT_THRESHOLDS } = require('../apm/database');

const STALE_MS = 24 * 60 * 60 * 1000;
const PROD_RE = /^(prod|production|prd|live)$/i;
const FAILED_RUNS = new Set(['failed', 'budget_exhausted']);

const DOCS = {
  slo: 'https://sre.google/workbook/implementing-slos/',
  errorBudget: 'https://sre.google/workbook/error-budget-policy/',
  ownership: 'https://sre.google/workbook/how-sre-relates/',
  environments: 'https://12factor.net/dev-prod-parity',
  journeys: 'https://sre.google/workbook/implementing-slos/#modeling-user-journeys',
  telemetry: 'https://sre.google/sre-book/monitoring-distributed-systems/#xref_monitoring_golden-signals',
};

const RULES = {
  sloBreached: { id: 'product.slo_breached', category: 'product', severity: 'high', docs: DOCS.errorBudget },
  noTelemetry: { id: 'product.no_telemetry', category: 'product', severity: 'high', docs: DOCS.telemetry },
  defaultSlos: { id: 'product.default_slos', category: 'product', severity: 'medium', docs: DOCS.slo },
  noOwner: { id: 'product.no_owner', category: 'product', severity: 'medium', docs: DOCS.ownership },
  noStaging: { id: 'product.no_staging', category: 'product', severity: 'medium', docs: DOCS.environments },
  noJourneys: { id: 'product.no_architecture', category: 'product', severity: 'medium', docs: DOCS.journeys },
  noResources: { id: 'product.no_resources', category: 'product', severity: 'medium', docs: DOCS.telemetry },
  staleTelemetry: { id: 'product.stale_telemetry', category: 'product', severity: 'medium', docs: DOCS.telemetry },
  noEnvironment: { id: 'product.no_environment', category: 'product', severity: 'low', docs: DOCS.environments },
  partialTelemetry: { id: 'product.partial_telemetry', category: 'product', severity: 'low', docs: DOCS.telemetry },
};

const METRIC_LABELS = { errorRatePercent: 'Error rate', durationMs: 'Duration', readyPodsPercent: 'Ready pods', restartDelta: 'Restarts' };

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

/**
 * @param application KUApps application (lib/apm/database.js _application)
 * @param overview    getOverview() + { health, latestRun }
 * @param siblings    other applications of the same profile (to find a non-prod stage)
 */
function adviseProduct({ application, overview = {}, siblings = [], now = Date.now() } = {}) {
  const results = [];
  const app = application || {};
  const appRef = detail => ({ kind: 'Application', name: app.name, ...(detail ? { detail } : {}) });
  const metrics = overview.metrics || [];
  const resources = (overview.resources || []).reduce((sum, row) => sum + (row.enabled || 0), 0);
  const thresholds = app.thresholds || {};

  results.push(check(RULES.sloBreached, (overview.health?.signals || []).map(signal => ({
    kind: 'Objective',
    name: METRIC_LABELS[signal.metric] || signal.metric,
    detail: `${round(signal.value)} vs ${signal.comparison === 'minimum' ? '≥' : '≤'} ${signal.threshold}`,
  }))));

  results.push(check(RULES.noResources, resources ? [] : [appRef()]));
  if (resources) {
    const reason = !app.pollingEnabled ? 'polling disabled' : !metrics.length ? 'no metrics in 24h' : null;
    results.push(check(RULES.noTelemetry, reason ? [appRef(reason)] : []));
    const run = overview.latestRun;
    const finished = Date.parse(run?.finishedAt || run?.startedAt || '');
    const stale = app.pollingEnabled && run && (FAILED_RUNS.has(run.status) || (Number.isFinite(finished) && now - finished > STALE_MS));
    results.push(check(RULES.staleTelemetry, stale ? [appRef(run.errorMessage || run.status || null)] : []));
    results.push(check(RULES.partialTelemetry, metrics.filter(metric => metric.quality === 'partial').map(metric => ({ kind: 'Metric', name: metric.metricName }))));
  }

  const keys = Object.keys(DEFAULT_THRESHOLDS);
  const allDefault = keys.every(key => thresholds[key] === DEFAULT_THRESHOLDS[key]);
  const noneSet = keys.every(key => thresholds[key] == null);
  results.push(check(RULES.defaultSlos, allDefault || noneSet ? [appRef(noneSet ? 'no objectives' : 'KUA defaults')] : []));

  results.push(check(RULES.noOwner, app.team ? [] : [appRef()]));
  results.push(check(RULES.noEnvironment, app.environment ? [] : [appRef()]));
  if (PROD_RE.test(app.environment || '')) {
    const preProd = siblings.some(other => other.id !== app.id && other.name === app.name && other.environment && !PROD_RE.test(other.environment));
    results.push(check(RULES.noStaging, preProd ? [] : [appRef(app.environment)]));
  }
  const architectures = app.architectureProjectIds?.length || (app.architectureProjectId ? 1 : 0);
  results.push(check(RULES.noJourneys, architectures ? [] : [appRef()]));

  return buildReport(results, { categories: PRODUCT_CATEGORIES, scope: { provider: app.provider || null, applicationId: app.id || null }, now });
}

module.exports = { adviseProduct, RULES };

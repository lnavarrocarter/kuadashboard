'use strict';
/**
 * lib/advisor/core.js
 * Shared shape of the Advisor: deterministic good-practice checks that run on
 * data KUA already has (or on free control-plane APIs) and never call an LLM.
 *
 * A check is { id, category, severity, docs } plus the resources that break
 * it. A report keeps only the checks with resources (findings), counts the
 * passed ones per category and lists the sources that could not be read, so
 * the UI can tell "all good" from "could not look".
 *
 * Texts are i18n keys rendered by the frontend: advisor.rule.<id>.title /
 * .body, interpolated with { count, ...params }.
 */

const TECHNICAL_CATEGORIES = ['security', 'infrastructure', 'architecture', 'development'];
const PRODUCT_CATEGORIES = ['product'];
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const MAX_RESOURCES = 10;

// Env var / setting names that usually hold credentials.
const SECRET_NAME_RE = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|auth[_-]?key|access[_-]?key)/i;

/** Evaluates one check: `resources` are the offenders ({ name, namespace?, kind?, detail? }). */
function check(def, resources = [], params = {}) {
  const list = (resources || []).filter(Boolean);
  return {
    id: def.id,
    category: def.category,
    severity: def.severity,
    docs: def.docs || null,
    count: list.length,
    params,
    resources: list.slice(0, MAX_RESOURCES),
    truncated: list.length > MAX_RESOURCES,
  };
}

/**
 * Builds the report. `results` are check() outputs (a check that could not be
 * evaluated is simply not in the list); `unavailable` are { source, error }.
 */
function buildReport(results, { categories = TECHNICAL_CATEGORIES, unavailable = [], scope = null, now = Date.now() } = {}) {
  const summary = Object.fromEntries(categories.map(category => [category, { high: 0, medium: 0, low: 0, findings: 0, passed: 0, checks: 0 }]));
  for (const result of results) {
    const bucket = summary[result.category];
    if (!bucket) continue;
    bucket.checks += 1;
    if (result.count) {
      bucket.findings += 1;
      bucket[result.severity] += 1;
    } else {
      bucket.passed += 1;
    }
  }
  const findings = results
    .filter(result => result.count > 0 && summary[result.category])
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || categories.indexOf(a.category) - categories.indexOf(b.category)
      || b.count - a.count
      || a.id.localeCompare(b.id));
  return {
    generatedAt: new Date(now).toISOString(),
    scope,
    categories,
    summary,
    findings,
    unavailable,
  };
}

/** Docker/OCI image reference without a pinned tag or digest (or tagged :latest). */
function isFloatingImage(image) {
  const ref = String(image || '');
  if (!ref || ref.includes('@sha256:')) return false;
  const lastSegment = ref.split('/').pop();
  const tag = lastSegment.includes(':') ? lastSegment.split(':').pop() : '';
  return !tag || tag === 'latest';
}

module.exports = {
  TECHNICAL_CATEGORIES,
  PRODUCT_CATEGORIES,
  SECRET_NAME_RE,
  check,
  buildReport,
  isFloatingImage,
};

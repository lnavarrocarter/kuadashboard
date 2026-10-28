'use strict';
/**
 * vscode/src/applications.js
 * What the KUA view of the editor shows for each KUA Application (#303), built from KUA's local
 * API with KUA's own wording (frontend/src/lib/kuappIssues.js, frontend/src/shared/agentBrief.mjs).
 * Pure: the tree provider (applicationsView.js) only turns these nodes into TreeItems.
 *
 * Reads, all local and free: /api/kua-apps/applications, …/registry (resources with their signal
 * state), …/observability/issues and, when the Advisor node is opened, the product Advisor
 * (/api/architecture/applications/:id/advisor, which makes no cloud calls).
 */

const { ago, issueEvidence } = require('../../frontend/src/lib/kuappIssues.js');
const { advisorBrief } = require('../../frontend/src/shared/agentBrief.mjs');

const SEVERITY_ICON = { critical: 'error', warning: 'warning', info: 'info', high: 'error', medium: 'warning', low: 'info' };
// Signal states that need a look first; the rest keep KUA's order.
const STATE_ORDER = ['gone', 'error', 'no_connection', 'stale', 'partial', 'disabled', 'no_data', 'current', 'unsupported'];
const GITHUB_REMOTE = /github\.com[:/]+([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/i;

/** owner/name of a GitHub remote URL (https or ssh), or null. */
function githubRepository(remoteUrl) {
  const match = GITHUB_REMOTE.exec(String(remoteUrl || '').trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

/** The URL of [remote "origin"] (or the first remote) in a .git/config text. */
function originUrl(gitConfig) {
  const remotes = [...String(gitConfig || '').matchAll(/\[remote "([^"]+)"\]([^[]*)/g)]
    .map(([, name, body]) => ({ name, url: /^\s*url\s*=\s*(.+)$/m.exec(body)?.[1]?.trim() || null }))
    .filter(remote => remote.url);
  return (remotes.find(remote => remote.name === 'origin') || remotes[0])?.url || null;
}

/**
 * The application of this workspace: the one set in `kua.application` (id or name), else the one
 * whose GitHub repositories (set in KUA or declared by its workloads, #238) include the workspace's.
 */
function workspaceApplication(apps, { configured = '', repository = null, repositoriesOf = () => [] } = {}) {
  const wanted = String(configured || '').trim();
  if (wanted) return apps.find(app => app.id === wanted) || apps.find(app => app.name === wanted) || null;
  if (!repository) return null;
  const matches = apps.filter(app => repositoriesOf(app.id).map(item => String(item).toLowerCase()).includes(repository));
  return matches.length === 1 ? matches[0] : null;
}

function issueNode(t, application, issue, now) {
  const since = issue.since ? t('kuapps.issue.since', { ago: ago(t, issue.since, now) }) : '';
  return {
    kind: 'issue',
    id: `issue:${application.id}:${issue.id}`,
    label: issue.resourceName,
    description: [issueEvidence(t, issue), since].filter(Boolean).join(' · '),
    tooltip: `${t(`kuapps.issue.severity.${issue.severity}`)}: ${issueEvidence(t, issue)}`,
    icon: SEVERITY_ICON[issue.severity] || 'circle-outline',
    application,
    issue,
    link: { view: 'kuapps', app: application.id, tab: issue.action === 'review_missing' ? 'review' : 'signals' },
  };
}

function resourceNode(t, application, resource) {
  const state = resource.signals?.state || 'unknown';
  return {
    kind: 'resource',
    id: `resource:${application.id}:${resource.id}`,
    label: resource.displayName || resource.nativeIdentifier,
    description: `${resource.provider} · ${resource.resourceType} · ${t(`kuapps.signalState.${state}`)}`,
    tooltip: t(`kuapps.signalState.${state}.hint`),
    icon: state === 'current' ? 'pass' : ['gone', 'error'].includes(state) ? 'error' : ['no_connection', 'stale', 'partial'].includes(state) ? 'warning' : 'circle-outline',
    application,
    resource,
    link: { view: 'kuapps', app: application.id, tab: 'resources' },
  };
}

function sortResources(resources) {
  const rank = resource => { const index = STATE_ORDER.indexOf(resource.signals?.state); return index < 0 ? STATE_ORDER.length : index; };
  return resources.slice().sort((a, b) => rank(a) - rank(b) || String(a.displayName).localeCompare(String(b.displayName)));
}

/** The groups under an application: what needs attention, its resources, and its Advisor. */
function applicationChildren(t, application, { registry, issues, now = Date.now() }) {
  const resources = registry?.resources || [];
  const list = issues?.issues || [];
  return [
    {
      kind: 'group', id: `issues:${application.id}`, label: t('kuapps.issue.title'),
      description: list.length ? countsText(t, issues.counts) : t('kuapps.issue.none'),
      icon: list.length ? 'warning' : 'pass', application,
      children: list.map(issue => issueNode(t, application, issue, now)),
    },
    {
      kind: 'group', id: `resources:${application.id}`, label: t('kuapps.signalState.title'),
      description: String(resources.length), icon: 'symbol-namespace', application,
      children: sortResources(resources).map(resource => resourceNode(t, application, resource)),
    },
    { kind: 'advisor', id: `advisor:${application.id}`, label: t('advisor.title'), icon: 'lightbulb', application },
  ];
}

function countsText(t, counts = {}) {
  return ['critical', 'warning', 'info'].filter(key => counts[key]).map(key => t(`kuapps.issue.${key}`, { n: counts[key] })).join(' · ');
}

function applicationNode(t, application, { issues = null, linked = false } = {}) {
  return {
    kind: 'application',
    id: `application:${application.id}`,
    label: application.name,
    description: [linked ? '$(pin)' : '', application.environment || '', issues ? countsText(t, issues.counts) : ''].filter(Boolean).join(' '),
    icon: issues?.counts?.critical ? 'error' : issues?.counts?.warning ? 'warning' : 'package',
    application,
    linked,
    link: { view: 'kuapps', app: application.id },
  };
}

/** Advisor findings as nodes; a report the plan locks (Free) shows its counts only. */
function advisorChildren(t, application, report) {
  if (report?.locked) {
    const totals = report.totals || {};
    return [{ kind: 'message', id: `advisor-locked:${application.id}`, label: t('agentBrief.findings', { n: totals.findings ?? 0 }), description: 'Pro', icon: 'lock', application }];
  }
  const findings = report?.findings || [];
  if (!findings.length) return [{ kind: 'message', id: `advisor-none:${application.id}`, label: t('agentBrief.noFindings'), icon: 'pass', application }];
  return findings.map((finding, index) => {
    const params = { count: finding.count, ...finding.params };
    return {
      kind: 'finding',
      id: `finding:${application.id}:${finding.id}:${index}`,
      label: t(`advisor.rule.${finding.id}.title`, params),
      description: t(`advisor.severity.${finding.severity}`),
      tooltip: t(`advisor.rule.${finding.id}.body`, params),
      icon: SEVERITY_ICON[finding.severity] || 'info',
      application,
      finding,
      link: { view: 'kuapps', app: application.id, tab: 'review' },
    };
  });
}

/** The brief for the chat: the Advisor brief of KUA with only the findings asked for. */
function briefFor(t, application, report, { findings = null, now = Date.now() } = {}) {
  const selected = findings ? { ...report, findings } : report;
  return advisorBrief(selected, { t, lens: 'product', context: { [t('agentBrief.field.application')]: application.name }, now });
}

/** The brief of an issue: the resource, what KUA saw and since when, without logs or secrets. */
function issueBrief(t, application, issue, now = Date.now()) {
  return [
    `# ${t('kuapps.issue.title')}: ${issue.resourceName}`,
    '',
    `- **${t('agentBrief.field.application')}:** ${application.name}`,
    `- **${t(`kuapps.issue.severity.${issue.severity}`)}:** ${issueEvidence(t, issue)}`,
    issue.since ? `- ${t('kuapps.issue.since', { ago: ago(t, issue.since, now) })} (${issue.since})` : null,
    `- ${issue.resourceType}${issue.resourceKind ? ` / ${issue.resourceKind}` : ''}`,
    '',
    t('agentBrief.rule.verify'),
  ].filter(line => line !== null).join('\n');
}

/** The local profile that reaches an application, for the Advisor route (as the MCP server picks it). */
function advisorProfile(application) {
  return application?.local?.legacy?.profileId
    || application?.local?.bindings?.find(binding => binding.status === 'verified' && binding.profileId)?.profileId
    || null;
}

module.exports = {
  advisorChildren, advisorProfile, applicationChildren, applicationNode, briefFor, githubRepository,
  issueBrief, originUrl, sortResources, workspaceApplication,
};

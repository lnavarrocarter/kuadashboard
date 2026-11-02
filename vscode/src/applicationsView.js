'use strict';
/**
 * vscode/src/applicationsView.js
 * The "KUA Applications" view of the side bar (#303): applications, what needs attention, their
 * resources with the signal state, and the product Advisor, from the local KUA. Nodes come from
 * applications.js; this file only turns them into TreeItems and loads them on demand.
 *
 * Refreshed when the window gets focus, when KUA starts or stops, and with the refresh button:
 * there is no polling of its own.
 */

const {
  advisorChildren, advisorProfile, applicationChildren, applicationNode, workspaceApplication,
} = require('./applications');

const COLLAPSIBLE = new Set(['application', 'group', 'advisor']);

/** What the view reads from KUA, through `get(path, headers)` (null when KUA did not answer). */
function createApplicationsData({ get }) {
  const appPath = (id, suffix = '') => `/api/kua-apps/applications/${encodeURIComponent(id)}${suffix}`;
  return {
    async applications() {
      const list = await get('/api/kua-apps/applications');
      return Array.isArray(list) ? list : null;
    },
    issues: id => get(appPath(id, '/observability/issues')),
    registry: id => get(appPath(id, '/registry')),
    /** Repositories set in KUA or declared by the workloads (#238); null when the GitHub plugin is off. */
    async repositories(id) {
      const settings = await get(appPath(id, '/github'));
      return settings ? [...(settings.repositories || []), ...(settings.discovered || []).map(item => item.repository || item)] : [];
    },
    advisor(application) {
      const profileId = advisorProfile(application);
      return profileId ? get(`/api/architecture/applications/${encodeURIComponent(application.id)}/advisor`, { 'X-Profile-Id': profileId }) : Promise.resolve(null);
    },
  };
}

/**
 * @param vscode       the vscode module (TreeItem, ThemeIcon, EventEmitter)
 * @param data         createApplicationsData(...)
 * @param t            KUA's translator (texts.js)
 * @param l10n         vscode.l10n.t for the extension's own texts
 * @param reachable    () => whether KUA answers now
 * @param workspace    () => ({ configured, repository }): the application this workspace is linked to
 */
function createApplicationsView({ vscode, data, t, l10n = text => text, reachable, workspace, now = () => Date.now() }) {
  const changed = new vscode.EventEmitter();
  const advisorReports = new Map();
  let roots = null;

  const message = (id, label, icon = 'info') => ({ kind: 'message', id, label, icon });

  async function loadRoots() {
    if (!reachable()) return [message('closed', l10n('KUA is not running. Open KuaDashboard to see your applications.'), 'debug-disconnect')];
    const apps = await data.applications();
    if (!apps) return [message('unavailable', l10n('KUA did not answer. Try Refresh.'), 'warning')];
    if (!apps.length) return [message('empty', l10n('No KUA Applications yet. Create one in KUApps.'), 'package')];
    const { configured, repository } = workspace();
    const repositories = new Map();
    if (!configured && repository) {
      await Promise.all(apps.map(async app => { repositories.set(app.id, await data.repositories(app.id).catch(() => [])); }));
    }
    const linked = workspaceApplication(apps, { configured, repository, repositoriesOf: id => repositories.get(id) || [] });
    const issues = await Promise.all(apps.map(app => data.issues(app.id).catch(() => null)));
    const nodes = apps.map((app, index) => applicationNode(t, app, { issues: issues[index], linked: linked?.id === app.id }));
    // The application of this workspace first, then by name.
    return nodes.sort((a, b) => Number(b.linked) - Number(a.linked) || a.label.localeCompare(b.label));
  }

  async function childrenOf(node) {
    if (node.kind === 'application') {
      const [registry, issues] = await Promise.all([data.registry(node.application.id).catch(() => null), data.issues(node.application.id).catch(() => null)]);
      if (!registry && !issues) return [message(`unavailable:${node.application.id}`, l10n('KUA did not answer. Try Refresh.'), 'warning')];
      return applicationChildren(t, node.application, { registry, issues, now: now() });
    }
    if (node.kind === 'group') return node.children;
    if (node.kind === 'advisor') {
      if (!advisorProfile(node.application)) return [message(`advisor-scope:${node.application.id}`, l10n('Verify a scope of this application in KUApps to see its Advisor.'), 'info')];
      const report = await data.advisor(node.application).catch(() => null);
      if (!report) return [message(`advisor-unavailable:${node.application.id}`, l10n('KUA did not answer. Try Refresh.'), 'warning')];
      advisorReports.set(node.application.id, report);
      return advisorChildren(t, node.application, report);
    }
    return [];
  }

  return {
    onDidChangeTreeData: changed.event,
    async getChildren(node) {
      if (!node) {
        roots = await loadRoots();
        return roots;
      }
      return childrenOf(node);
    },
    getTreeItem(node) {
      const state = COLLAPSIBLE.has(node.kind)
        ? (node.kind === 'application' && node.linked ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(node.label, state);
      item.id = node.id;
      item.description = node.description || undefined;
      item.tooltip = node.tooltip || undefined;
      item.iconPath = new vscode.ThemeIcon(node.icon || 'circle-outline');
      item.contextValue = `kua.${node.kind}`;
      return item;
    },
    refresh() { advisorReports.clear(); changed.fire(); },
    /** The Advisor report already read for an application, or read now. */
    async advisorReport(application) {
      if (advisorReports.has(application.id)) return advisorReports.get(application.id);
      const report = await data.advisor(application).catch(() => null);
      if (report) advisorReports.set(application.id, report);
      return report;
    },
    roots: () => roots,
    dispose() { changed.dispose(); },
  };
}

module.exports = { createApplicationsData, createApplicationsView };

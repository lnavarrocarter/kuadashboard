'use strict';
/**
 * vscode/src/presentation.js
 * What the status bar says about KUA, and where "Open dashboard" goes (#302). Pure: `t` is
 * vscode.l10n.t, or `fill` in tests.
 */

const VIEW_PARAMS = ['view', 'service', 'profile', 'app', 'tab', 'selected', 'project'];

// vscode.l10n.t fills {0}, {1}…; the default does the same, for tests.
const fill = (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => String(args[index]));

function statusBar(status, t = fill) {
  if (!status) return { text: '$(sync~spin) KUA', tooltip: t('Looking for KUA…'), warning: false };
  if (!status.reachable) {
    return { text: '$(debug-disconnect) KUA', tooltip: t('KUA is not running. Open KuaDashboard to use it from the editor.'), warning: true };
  }
  const lines = [
    t('KUA {0} at {1}', status.version || '?', status.url),
    status.plan ? t('Plan: {0}', status.plan) : null,
  ];
  if (status.agents && !status.agents.enabled) {
    lines.push(t('AI agents are turned off in KUA: turn them on from the tray panel or Connect an AI agent.'));
    return { text: '$(circle-slash) KUA', tooltip: lines.filter(Boolean).join('\n'), warning: true };
  }
  if (status.agents) lines.push(status.agents.writes ? t('Agents can read and propose KUApps changes.') : t('Agents can read; KUApps changes are off.'));
  return { text: '$(server) KUA', tooltip: lines.filter(Boolean).join('\n'), warning: false };
}

/**
 * Where "Open dashboard" goes: the desktop app through kua://open (it starts it when it is closed),
 * or the local URL in the browser for a KUA run from the repository.
 */
function dashboardTarget(status, { openIn = 'auto', params = {} } = {}) {
  const search = new URLSearchParams();
  for (const key of VIEW_PARAMS) if (params[key]) search.set(key, String(params[key]));
  const query = search.toString() ? `?${search}` : '';
  const browser = status?.reachable && (openIn === 'browser' || (openIn === 'auto' && status.packaged === false));
  if (browser) return { kind: 'browser', uri: `${status.url.replace(/\/$/, '')}/${query}` };
  return { kind: 'app', uri: `kua://open${query}` };
}

/** A key that changes when the server definition must be refreshed. */
function launchKey(status) {
  return status?.launch ? JSON.stringify([status.launch, status.version, status.reachable]) : '';
}

module.exports = { VIEW_PARAMS, dashboardTarget, launchKey, statusBar };

'use strict';
/**
 * vscode/src/extension.js
 * KUA in VS Code (#302): a status bar item with the state of the local KUA, its MCP server
 * registered for the editor's chat, and commands to open KUA, verify the MCP connection and add
 * the server to a workspace `.vscode/mcp.json`.
 *
 * extensionKind "ui": it runs on the computer where KUA runs, also with Remote SSH, WSL or
 * Dev Containers. It only talks to the local KUA.
 */

const fs = require('node:fs');
const vscode = require('vscode');
const runtime = require('../../lib/mcp/runtime');
const { verifyMcp } = require('../../lib/mcp/clientSetup');
const { createKuaStatus } = require('./kuaStatus');
const { createMcpProvider, editorLaunch } = require('./mcpProvider');
const { withKuaServer } = require('./mcpJson');
const { dashboardTarget, launchKey, statusBar } = require('./presentation');

const REFRESH_MS = 15000;
const LAST_LAUNCH = 'kua.lastLaunch';

function activate(context) {
  const t = vscode.l10n.t;
  const config = () => vscode.workspace.getConfiguration('kua');
  const configuredUrl = () => String(config().get('url') || '').trim();
  const kua = createKuaStatus({ configuredUrl });
  const changed = new vscode.EventEmitter();
  let status = null;
  let lastKey = null;

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.name = 'KUA';
  item.command = 'kua.showMenu';
  item.show();

  // The launch to give the editor: the one KUA answers now, else the last one seen.
  function currentLaunch() {
    const launch = status?.launch || context.globalState.get(LAST_LAUNCH) || null;
    const ready = editorLaunch(launch, { configuredUrl: configuredUrl() });
    return ready ? { ...ready, version: status?.version || launch?.version || undefined } : null;
  }

  function render() {
    const view = statusBar(status, t);
    item.text = view.text;
    item.tooltip = view.tooltip;
    item.backgroundColor = view.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { status = await kua.read(); } catch { status = { reachable: false, url: configuredUrl() || runtime.DEFAULT_URL }; }
      if (status.launch) await context.globalState.update(LAST_LAUNCH, { ...status.launch, version: status.version });
      render();
      const key = launchKey(status);
      if (key !== lastKey) { lastKey = key; changed.fire(); }
      return status;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  render();
  refresh();
  const timer = setInterval(() => { if (vscode.window.state.focused) refresh(); }, REFRESH_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) }, item, changed);
  context.subscriptions.push(vscode.window.onDidChangeWindowState(state => { if (state.focused) refresh(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('kua')) refresh(); }));

  // A KUA that starts or stops writes ~/.kuadashboard/run/: notice it at once, not on the next tick.
  try {
    const watcher = fs.watch(runtime.runDir(), () => refresh());
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch { /* the folder appears with the first KUA; the timer covers it */ }

  // The editor's chat gets KUA's tools without any file to edit (VS Code 1.101+).
  if (vscode.lm?.registerMcpServerDefinitionProvider) {
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('kua.mcp', createMcpProvider({ vscode, currentLaunch, onDidChange: changed.event })));
  }

  const command = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));

  command('kua.refresh', async () => { await refresh(); });

  command('kua.openDashboard', async (params = {}) => {
    const target = dashboardTarget(status, { openIn: config().get('openIn') || 'auto', params });
    const opened = await vscode.env.openExternal(vscode.Uri.parse(target.uri));
    if (!opened && target.kind === 'app') vscode.window.showWarningMessage(t('KuaDashboard is not installed on this computer, or it could not be opened.'));
  });

  command('kua.verifyMcp', async () => {
    const launch = currentLaunch();
    if (!launch) {
      vscode.window.showWarningMessage(t('Open KuaDashboard once so the editor learns how to start its MCP server.'));
      return;
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('Verifying the KUA MCP server…') },
      () => verifyMcp({ launch }),
    );
    if (result.ok) {
      vscode.window.showInformationMessage(t('KUA MCP server answered: {0} tools, {1} profiles.', result.tools, result.profiles ?? '?'));
    } else {
      vscode.window.showErrorMessage(t('The KUA MCP server did not answer: {0}', result.error || ''));
    }
  });

  command('kua.addMcpToWorkspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { vscode.window.showWarningMessage(t('Open a folder first.')); return; }
    // The file is shared with the repository: it gets KUA's own launch, not the editor's paths.
    const launch = status?.launch || context.globalState.get(LAST_LAUNCH);
    if (!launch) { vscode.window.showWarningMessage(t('Open KuaDashboard once so the editor learns how to start its MCP server.')); return; }
    const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json');
    let text = '';
    try { text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { /* new file */ }
    let next;
    try { next = withKuaServer(text, { command: launch.command, args: launch.args, env: launch.env }); } catch (error) {
      vscode.window.showErrorMessage(error.message);
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
    vscode.window.showInformationMessage(t('KUA was added to .vscode/mcp.json.'));
  });

  command('kua.showMenu', async () => {
    const choices = [
      { label: `$(link-external) ${t('Open KUA')}`, id: 'kua.openDashboard' },
      { label: `$(pass) ${t('Verify MCP connection')}`, id: 'kua.verifyMcp' },
      { label: `$(add) ${t('Add MCP server to this workspace')}`, id: 'kua.addMcpToWorkspace' },
      { label: `$(refresh) ${t('Refresh')}`, id: 'kua.refresh' },
    ];
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: statusBar(status, t).tooltip.split('\n')[0] });
    if (picked) vscode.commands.executeCommand(picked.id);
  });

  return { refresh, status: () => status };
}

function deactivate() {}

module.exports = { activate, deactivate };

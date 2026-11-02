'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A stand-in for the `vscode` module: records what the extension registers and shows.
function fakeVscode({ withMcpApi = true, withChat = true } = {}) {
  const record = { commands: new Map(), providers: [], messages: [], opened: [], files: new Map(), items: [], views: [], clipboard: null, chat: [] };
  class EventEmitter { constructor() { this.listeners = []; this.event = listener => this.listeners.push(listener); } fire() { this.listeners.forEach(listener => listener()); } dispose() {} }
  const uri = path => ({ path, toString: () => path });
  const vscode = {
    l10n: { t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => String(args[index])) },
    EventEmitter,
    ThemeColor: class { constructor(id) { this.id = id; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ConfigurationTarget: { Workspace: 2 },
    StatusBarAlignment: { Left: 1 },
    ProgressLocation: { Notification: 15 },
    McpStdioServerDefinition: class { constructor(label, command, args, env, version) { Object.assign(this, { label, command, args, env, version }); } },
    Uri: { parse: value => uri(value), joinPath: (base, ...parts) => uri([base.path, ...parts].join('/')) },
    window: {
      state: { focused: true },
      createStatusBarItem: () => { const item = { show() {}, dispose() {} }; record.items.push(item); return item; },
      createTreeView: (id, options) => { record.views.push({ id, provider: options.treeDataProvider }); return { dispose() {} }; },
      onDidChangeWindowState: () => ({ dispose() {} }),
      showInformationMessage: message => record.messages.push(['info', message]),
      showWarningMessage: message => record.messages.push(['warn', message]),
      showErrorMessage: message => record.messages.push(['error', message]),
      withProgress: (_options, task) => task(),
      showQuickPick: async choices => choices[0],
    },
    workspace: {
      getConfiguration: () => ({ get: key => ({ url: '', openIn: 'auto' })[key] }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      workspaceFolders: [{ uri: uri('/work') }],
      fs: {
        readFile: async target => { if (!record.files.has(target.path)) throw new Error('ENOENT'); return Buffer.from(record.files.get(target.path)); },
        writeFile: async (target, content) => { record.files.set(target.path, Buffer.from(content).toString('utf8')); },
        createDirectory: async () => {},
      },
    },
    commands: {
      registerCommand: (id, run) => { record.commands.set(id, run); return { dispose() {} }; },
      executeCommand: async (id, ...args) => {
        if (id === 'workbench.action.chat.open') { if (!withChat) throw new Error('command not found'); record.chat.push(args[0].query); return undefined; }
        return record.commands.get(id)(...args);
      },
    },
    env: { language: 'en', clipboard: { writeText: async text => { record.clipboard = text; } }, openExternal: async target => { record.opened.push(target.path); return true; } },
    lm: withMcpApi ? { registerMcpServerDefinitionProvider: (id, provider) => { record.providers.push({ id, provider }); return { dispose() {} }; } } : undefined,
  };
  return { vscode, record };
}

function loadExtension(vscode, status) {
  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, ...rest);
  };
  for (const key of Object.keys(require.cache)) if (/vscode[\\/]src[\\/](extension|kuaStatus)\.js$/.test(key)) delete require.cache[key];
  try {
    const kuaStatus = require('./kuaStatus');
    kuaStatus.createKuaStatus = () => ({ read: async () => status() });
    return require('./extension');
  } finally { Module._load = originalLoad; }
}

const LAUNCH = { command: '/opt/KuaDashboard/kuadashboard', args: ['/opt/KuaDashboard/resources/app.asar.unpacked/mcp/server.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };

function context() {
  const state = new Map();
  return { extensionPath: require('node:path').join(__dirname, '..'), subscriptions: [], globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } } };
}

test('activation registers the KUA MCP server for the chat, and keeps it while KUA is closed', async () => {
  const { vscode, record } = fakeVscode();
  let current = { reachable: true, url: 'http://localhost:7190', version: '2.0.0', packaged: true, plan: 'free', agents: { enabled: true, writes: false }, launch: LAUNCH };
  const extension = loadExtension(vscode, () => current);
  const ctx = context();
  const api = extension.activate(ctx);
  await api.refresh();
  assert.equal(record.providers[0].id, 'kua.mcp');
  let changes = 0;
  record.providers[0].provider.onDidChangeMcpServerDefinitions(() => { changes += 1; });
  const [server] = record.providers[0].provider.provideMcpServerDefinitions();
  assert.deepEqual([server.label, server.command, server.version], ['KUA', LAUNCH.command, '2.0.0']);
  assert.equal(record.items[0].text, '$(server) KUA');

  current = { reachable: false, url: 'http://localhost:7190', version: null, launch: null };
  await api.refresh();
  assert.equal(changes, 1, 'the editor is told the server changed');
  assert.equal(record.items[0].text, '$(debug-disconnect) KUA');
  assert.equal(record.providers[0].provider.provideMcpServerDefinitions()[0].command, LAUNCH.command, 'the last launch is kept');
  for (const subscription of ctx.subscriptions) subscription.dispose?.();
});

test('commands: open KUA, and add the server to the workspace mcp.json', async () => {
  const { vscode, record } = fakeVscode({ withMcpApi: false });
  const extension = loadExtension(vscode, () => ({ reachable: true, url: 'http://localhost:7190', version: '2.0.0', packaged: true, launch: LAUNCH }));
  const ctx = context();
  const api = extension.activate(ctx);
  await api.refresh();
  assert.equal(record.providers.length, 0, 'editors without the MCP API still get the commands');
  await vscode.commands.executeCommand('kua.openDashboard', { view: 'kuapps' });
  assert.deepEqual(record.opened, ['kua://open?view=kuapps']);

  record.files.set('/work/.vscode/mcp.json', '{ "servers": { "github": { "type": "http", "url": "https://example" } } }');
  await vscode.commands.executeCommand('kua.addMcpToWorkspace');
  const written = JSON.parse(record.files.get('/work/.vscode/mcp.json'));
  assert.deepEqual(Object.keys(written.servers), ['github', 'kua']);
  assert.equal(written.servers.kua.command, LAUNCH.command);

  record.files.set('/work/.vscode/mcp.json', '{ broken');
  await vscode.commands.executeCommand('kua.addMcpToWorkspace');
  assert.equal(record.files.get('/work/.vscode/mcp.json'), '{ broken', 'an invalid file is not overwritten');
  assert.equal(record.messages.at(-1)[0], 'error');
  for (const subscription of ctx.subscriptions) subscription.dispose?.();
});

test('Kiro steering is added to the workspace, and an edited file is only replaced when the user says so (#214)', async () => {
  const { vscode, record } = fakeVscode({ withMcpApi: false });
  const extension = loadExtension(vscode, () => ({ reachable: false, url: 'http://localhost:7190', launch: null }));
  const ctx = context();
  ctx.extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-ext-'));
  fs.mkdirSync(path.join(ctx.extensionPath, 'dist'));
  fs.writeFileSync(path.join(ctx.extensionPath, 'dist', 'kua-steering.md'), 'KUA steering');
  extension.activate(ctx);
  const file = '/work/.kiro/steering/kua.md';
  await vscode.commands.executeCommand('kua.addSteering');
  assert.equal(record.files.get(file), 'KUA steering');
  await vscode.commands.executeCommand('kua.addSteering');
  assert.equal(record.messages.at(-1)[1], 'KUA steering is already in .kiro/steering/kua.md.');

  record.files.set(file, 'my own rules');
  let answer;
  vscode.window.showWarningMessage = async (message, _options, ...choices) => { record.messages.push(['warn', message]); return answer === 'replace' ? choices[0] : undefined; };
  await vscode.commands.executeCommand('kua.addSteering');
  assert.equal(record.files.get(file), 'my own rules', 'kept when the user cancels');
  answer = 'replace';
  await vscode.commands.executeCommand('kua.addSteering');
  assert.equal(record.files.get(file), 'KUA steering');
  for (const subscription of ctx.subscriptions) subscription.dispose?.();
  fs.rmSync(ctx.extensionPath, { recursive: true, force: true });
});

test('the Applications view is registered, and an issue goes to the chat or, without one, to the clipboard', async () => {
  const issue = { id: 'gone:r2', kind: 'gone', severity: 'warning', resourceName: 'api-3.9.1', resourceType: 'kubernetes', since: '2026-10-27T12:00:00Z' };
  for (const withChat of [true, false]) {
    const { vscode, record } = fakeVscode({ withChat });
    const extension = loadExtension(vscode, () => ({ reachable: false, url: 'http://localhost:7190', launch: null }));
    const ctx = context();
    extension.activate(ctx);
    assert.equal(record.views[0].id, 'kua.applications');
    await vscode.commands.executeCommand('kua.sendToChat', { kind: 'issue', application: { id: 'a', name: 'orders' }, issue });
    const brief = withChat ? record.chat[0] : record.clipboard;
    assert.match(brief, /api-3\.9\.1/);
    assert.match(brief, /orders/);
    await vscode.commands.executeCommand('kua.openInKua', { link: { view: 'kuapps', app: 'a', tab: 'review' } });
    assert.deepEqual(record.opened, ['kua://open?view=kuapps&app=a&tab=review']);
    for (const subscription of ctx.subscriptions) subscription.dispose?.();
  }
});

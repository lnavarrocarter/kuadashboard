'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// A stand-in for the `vscode` module: records what the extension registers and shows.
function fakeVscode({ withMcpApi = true } = {}) {
  const record = { commands: new Map(), providers: [], messages: [], opened: [], files: new Map(), items: [] };
  class EventEmitter { constructor() { this.listeners = []; this.event = listener => this.listeners.push(listener); } fire() { this.listeners.forEach(listener => listener()); } dispose() {} }
  const uri = path => ({ path, toString: () => path });
  const vscode = {
    l10n: { t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => String(args[index])) },
    EventEmitter,
    ThemeColor: class { constructor(id) { this.id = id; } },
    StatusBarAlignment: { Left: 1 },
    ProgressLocation: { Notification: 15 },
    McpStdioServerDefinition: class { constructor(label, command, args, env, version) { Object.assign(this, { label, command, args, env, version }); } },
    Uri: { parse: value => uri(value), joinPath: (base, ...parts) => uri([base.path, ...parts].join('/')) },
    window: {
      state: { focused: true },
      createStatusBarItem: () => { const item = { show() {}, dispose() {} }; record.items.push(item); return item; },
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
      workspaceFolders: [{ uri: uri('/work') }],
      fs: {
        readFile: async target => { if (!record.files.has(target.path)) throw new Error('ENOENT'); return Buffer.from(record.files.get(target.path)); },
        writeFile: async (target, content) => { record.files.set(target.path, Buffer.from(content).toString('utf8')); },
        createDirectory: async () => {},
      },
    },
    commands: { registerCommand: (id, run) => { record.commands.set(id, run); return { dispose() {} }; }, executeCommand: (id, ...args) => record.commands.get(id)(...args) },
    env: { openExternal: async target => { record.opened.push(target.path); return true; } },
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
  return { subscriptions: [], globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } } };
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

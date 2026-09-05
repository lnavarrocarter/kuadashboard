'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { resolveSession, createConsoleSessions, auditSession } = require('./consoleSessions');
const contract = import('../frontend/src/shared/consoleSession.mjs');
const ssh = { provider: 'aws', transport: 'ssh', profileId: 'profile-1', environment: 'dev', target: { host: 'host', user: 'ec2-user' } };
const secrets = { SSH_PASSWORD: 'secret-password', SSH_PRIVATE_KEY: 'secret-key', SSH_PASSPHRASE: 'secret-passphrase', RDP_PASSWORD: 'secret-rdp' };
const store = {
  listProfiles: async () => [{ id: 'profile-1', provider: 'aws' }],
  getRawKeys: async () => secrets,
};

test('registry exposes real transports and keeps future providers planned', async () => {
  const { capabilityRegistry, validateSession } = await contract;
  assert.equal(new Set(capabilityRegistry.map(c => c.id)).size, capabilityRegistry.length);
  for (const item of capabilityRegistry) {
    if (item.status === 'available') assert.ok(item.path.startsWith('/ws/'));
    else {
      assert.equal(item.path, undefined);
      assert.throws(() => validateSession({ provider: item.provider, transport: item.transport }), /unavailable/);
    }
  }
  assert.throws(() => validateSession({ provider: 'kubernetes', transport: 'exec' }), /Missing context/);
  assert.throws(() => validateSession({ provider: 'kubernetes', transport: 'logs', target: { namespace: 'default', name: 'x', resourceType: 'secrets' } }), /Unsupported/);
});

test('profile authority resolves exact IDs and rejects missing, ambiguous and incomplete profiles', async () => {
  const valid = await resolveSession(ssh, { store });
  assert.equal(valid.authority.ssh.privateKey, secrets.SSH_PRIVATE_KEY);
  assert.equal(valid.session.profileId, 'profile-1');
  await assert.rejects(resolveSession({ ...ssh, profileId: null }, { store }), /Missing context/);
  await assert.rejects(resolveSession({ ...ssh, profileId: 'unknown' }, { store }), /Missing credential profile/);
  await assert.rejects(resolveSession(ssh, { store: { ...store, listProfiles: async () => [{ id: 'profile-1', provider: 'gcp' }] } }), /Missing credential profile/);
  await assert.rejects(resolveSession(ssh, { store: { ...store, listProfiles: async () => [...await store.listProfiles(), ...await store.listProfiles()] } }), /Ambiguous credential profile/);
  await assert.rejects(resolveSession(ssh, { store: { ...store, getRawKeys: async () => ({}) } }), /Missing SSH credentials/);
  const rdp = await resolveSession({ ...ssh, transport: 'rdp' }, { store });
  assert.equal(rdp.authority.rdp.password, secrets.RDP_PASSWORD);
});

class KubeConfig {
  constructor() { this.context = 'dev'; this.contexts = [{ name: 'dev', cluster: 'cluster', user: 'user' }]; }
  getCurrentContext() { return this.context; }
  getContexts() { return this.contexts; }
  getClusters() { return [{ name: 'cluster' }]; }
  getUsers() { return [{ name: 'user' }]; }
  exportConfig() { return JSON.stringify({ context: this.context, contexts: this.contexts }); }
  loadFromString(value) { Object.assign(this, JSON.parse(value)); }
  setCurrentContext(value) { this.context = value; }
}

test('Kubernetes authority is valid, unambiguous and pinned before connection', async () => {
  const input = { provider: 'kubernetes', transport: 'exec', target: { namespace: 'default', name: 'pod' } };
  const kubeConfig = new KubeConfig();
  const resolved = await resolveSession(input, { kubeConfig });
  kubeConfig.context = 'other';
  assert.equal(resolved.authority.kubeConfig.context, 'dev');
  await assert.rejects(resolveSession(input, { kubeConfig }), /Missing Kubernetes context/);
  kubeConfig.context = 'dev';
  kubeConfig.contexts.push(kubeConfig.contexts[0]);
  await assert.rejects(resolveSession(input, { kubeConfig }), /Ambiguous Kubernetes context/);
  await assert.rejects(resolveSession(input), /Missing Kubernetes context/);
});

test('actual Kubernetes config snapshot does not expose its token', async () => {
  const { KubeConfig } = require('@kubernetes/client-node');
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromOptions({
    clusters: [{ name: 'cluster', server: 'https://kubernetes.invalid' }],
    users: [{ name: 'user', token: 'private-kube-token' }],
    contexts: [{ name: 'dev', cluster: 'cluster', user: 'user' }],
    currentContext: 'dev',
  });
  const sessions = createConsoleSessions({ audit: { log() {} }, getKubeConfig: () => kubeConfig });
  const prepared = await sessions.prepare({ provider: 'kubernetes', transport: 'logs', target: { namespace: 'default', name: 'pod' } });
  assert.ok(!JSON.stringify(prepared).includes('private-kube-token'));
  kubeConfig.setCurrentContext('other');
  const resolved = sessions.consume(prepared.ticket, prepared.path);
  assert.equal(resolved.authority.kubeConfig.getCurrentContext(), 'dev');
  assert.equal(resolved.authority.kubeConfig.getCurrentUser().token, 'private-kube-token');
});

test('preflight strips secrets; tickets are one-use, path-bound and expire', async () => {
  let now = 1000;
  const entries = [];
  const sessions = createConsoleSessions({ store, audit: { log: e => entries.push(e) }, now: () => now });
  const prepared = await sessions.prepare({ ...ssh, password: secrets.SSH_PASSWORD, token: 'secret-token', target: { ...ssh.target, privateKey: secrets.SSH_PRIVATE_KEY } });
  const serialized = JSON.stringify(prepared);
  for (const secret of Object.values(secrets)) assert.ok(!serialized.includes(secret));
  assert.throws(() => sessions.consume(prepared.ticket, '/ws/shell'), /Invalid session ticket/);
  const resolved = sessions.consume(prepared.ticket, prepared.path);
  assert.throws(() => sessions.consume(prepared.ticket, prepared.path), /Invalid session ticket/);
  const ws = new EventEmitter();
  ws.send = () => {};
  sessions.attach(ws, resolved);
  ws.send(JSON.stringify({ type: 'error', data: secrets.SSH_PASSWORD }));
  ws.emit('error', new Error(secrets.SSH_PRIVATE_KEY));
  ws.emit('close');
  assert.deepEqual(entries.map(e => e.action), ['session.open', 'session.error', 'session.error', 'session.close']);
  for (const secret of Object.values(secrets)) assert.ok(!JSON.stringify(entries).includes(secret));
  assert.equal(entries[0].details.environment, 'dev');
  assert.equal(entries[0].resource, 'host');
  const expired = await sessions.prepare(ssh);
  now += 30001;
  assert.throws(() => sessions.consume(expired.ticket, expired.path), /Invalid session ticket/);
});

test('audit never serializes commands, arbitrary metadata or credential authority', () => {
  const entries = [];
  auditSession({ log: e => entries.push(e) }, 'open', { ...ssh, commands: ['echo secret'], authority: secrets, meta: secrets });
  assert.ok(!JSON.stringify(entries).includes('secret'));
});

test('real auditLog persists only allowlisted session metadata', () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const writes = [];
  const sandbox = {
    module: { exports: {} }, console,
    require: name => name === 'fs' ? {
      existsSync: () => false, mkdirSync: () => {},
      appendFileSync: (_path, value) => writes.push(value),
    } : require(name),
  };
  runInNewContext(readFileSync(require.resolve('./auditLog'), 'utf8'), sandbox);
  const audit = sandbox.module.exports;
  auditSession(audit, 'open', { ...ssh, command: 'echo secret', credentials: secrets });
  assert.equal(audit.getLogs({ category: 'console' }).length, 1);
  assert.equal(writes.length, 1);
  assert.ok(!writes[0].includes('secret'));
});

test('HTTP preflight and real WebSocket admission enforce the shared boundary', async t => {
  const express = require('express');
  const http = require('node:http');
  const { once } = require('node:events');
  const WebSocket = require('ws');
  const { mountConsoleRoutes, admitConsoleUpgrade } = require('./consoleSessions');
  const sessions = createConsoleSessions({ store, audit: { log() {} } });
  const app = express();
  app.use(express.json());
  mountConsoleRoutes(app, sessions);
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ noServer: true });
  let connections = 0;
  server.on('upgrade', (req, socket, head) => {
    if (!admitConsoleUpgrade(sessions, req, socket)) return;
    wss.handleUpgrade(req, socket, head, ws => {
      connections++;
      sessions.attach(ws, req.consoleSession);
      ws.close();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    wss.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, origin = base) => fetch(`${base}/api/console/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  assert.equal((await post(ssh, 'https://example.org')).status, 403);
  assert.equal((await post(ssh, 'null')).status, 403);
  assert.equal((await post({ ...ssh, profileId: 'missing' })).status, 400);
  assert.equal((await post({ provider: 'aws', transport: 'ssm' })).status, 400);
  const catalog = await (await fetch(`${base}/api/console/capabilities`)).json();
  assert.deepEqual(catalog, (await contract).capabilityRegistry);
  const rejected = url => new Promise(resolve => {
    const ws = new WebSocket(url);
    ws.on('error', resolve);
    ws.on('open', () => { ws.close(); resolve(new Error('Unexpected open')); });
  });
  const wsBase = base.replace('http:', 'ws:');
  assert.match((await rejected(`${wsBase}/ws/ec2-shell`)).message, /403/);
  assert.equal(connections, 0);
  const response = await post({ ...ssh, token: 'secret-token', password: 'secret-password' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const prepared = await response.json();
  assert.ok(!JSON.stringify(prepared).includes('secret'));
  assert.match((await rejected(`${wsBase}/ws/shell?ticket=${prepared.ticket}`)).message, /403/);
  assert.equal(connections, 0);
  const ws = new WebSocket(`${wsBase}${prepared.path}?ticket=${prepared.ticket}`);
  await once(ws, 'close');
  assert.equal(connections, 1);
  assert.match((await rejected(`${wsBase}${prepared.path}?ticket=${prepared.ticket}`)).message, /403/);
  assert.equal(connections, 1);
});

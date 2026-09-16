'use strict';

const { randomUUID } = require('crypto');
const contract = import('../frontend/src/shared/consoleSession.mjs');

async function resolveSession(input, { store, kubeConfig } = {}) {
  const { validateSession } = await contract;
  const { session, capability } = validateSession(input);
  let authority = {};
  if (session.provider === 'kubernetes') {
    if (!kubeConfig) throw new Error('Missing Kubernetes context');
    const name = session.kubeContext || kubeConfig.getCurrentContext();
    const matches = kubeConfig.getContexts().filter(c => c.name === name);
    if (!name || matches.length !== 1) throw new Error(matches.length > 1 ? 'Ambiguous Kubernetes context' : 'Missing Kubernetes context');
    if (!kubeConfig.getClusters().some(c => c.name === matches[0].cluster)
      || !kubeConfig.getUsers().some(u => u.name === matches[0].user)) throw new Error('Invalid Kubernetes authority');
    session.kubeContext = name;
    // Snapshot the config, not the mutable global current-context selection.
    const snapshot = new kubeConfig.constructor();
    snapshot.loadFromString(kubeConfig.exportConfig());
    snapshot.setCurrentContext(name);
    authority = { kubeConfig: snapshot };
  } else if (session.provider === 'aws') {
    store ||= require('./credentialStore').getStore();
    const profiles = await store.listProfiles();
    const matches = profiles.filter(p => p.id === session.profileId && ['aws', 'generic'].includes(p.provider));
    if (matches.length !== 1) throw new Error(matches.length > 1 ? 'Ambiguous credential profile' : 'Missing credential profile');
    const keys = await store.getRawKeys(matches[0].id);
    if (session.transport === 'ssh') {
      if (!keys?.SSH_PRIVATE_KEY && !keys?.SSH_PASSWORD) throw new Error('Missing SSH credentials');
      authority.ssh = keys.SSH_PRIVATE_KEY
        ? { privateKey: keys.SSH_PRIVATE_KEY, passphrase: keys.SSH_PASSPHRASE || undefined }
        : { password: keys.SSH_PASSWORD };
    } else {
      if (!keys?.RDP_PASSWORD) throw new Error('Missing RDP credentials');
      authority.rdp = { password: keys.RDP_PASSWORD };
    }
  }
  return { session, capability, authority };
}

function auditSession(audit, action, session) {
  // Explicit allowlist: never log input, raw errors, transport frames, or authority.
  audit.log({
    category: 'console', action: `session.${action}`,
    resource: session.target?.instanceId || session.target?.name || session.target?.host || 'local',
    context: session.kubeContext || '',
    details: { provider: session.provider, environment: session.environment, transport: session.transport },
    level: action === 'error' ? 'error' : 'info',
  });
}

function createConsoleSessions({ audit, getKubeConfig, store, now = Date.now } = {}) {
  const tickets = new Map();
  function prune() {
    for (const [id, item] of tickets) if (item.expires <= now()) tickets.delete(id);
  }
  return {
    async prepare(input) {
      prune();
      let resolved;
      try {
        resolved = await resolveSession(input, { store, kubeConfig: getKubeConfig?.() });
      } catch (error) {
        const { sessionDescriptor } = await contract;
        auditSession(audit, 'error', sessionDescriptor(input));
        throw error;
      }
      if (tickets.size >= 256) throw new Error('Too many pending sessions');
      const ticket = randomUUID();
      tickets.set(ticket, { ...resolved, expires: now() + 30000 });
      const expiry = setTimeout(() => tickets.delete(ticket), 30000);
      expiry.unref();
      return { ticket, path: resolved.capability.path, session: resolved.session };
    },
    consume(ticket, path) {
      prune();
      const item = tickets.get(ticket);
      if (!item || item.capability.path !== path) throw new Error('Invalid session ticket');
      tickets.delete(ticket);
      return item;
    },
    attach(ws, resolved) {
      auditSession(audit, 'open', resolved.session);
      ws.on('close', () => auditSession(audit, 'close', resolved.session));
      ws.on('error', () => auditSession(audit, 'error', resolved.session));
      const send = ws.send.bind(ws);
      ws.send = (data, ...args) => {
        try {
          if (JSON.parse(data).type === 'error') auditSession(audit, 'error', resolved.session);
        } catch (_) {}
        return send(data, ...args);
      };
    },
  };
}

function mountConsoleRoutes(app, sessions) {
  app.get('/api/console/capabilities', async (_req, res) => {
    res.json((await contract).capabilityRegistry);
  });
  app.post('/api/console/sessions', async (req, res) => {
    let originAllowed = false;
    try {
      const host = new URL(`http://${req.headers.host}`);
      originAllowed = ['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)
        && (!req.headers.origin || new URL(req.headers.origin).host === host.host);
    } catch (_) {}
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !originAllowed) {
      return res.status(403).json({ error: 'Local same-origin requests only' });
    }
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await sessions.prepare(req.body));
    } catch (_) {
      res.status(400).json({ error: 'Invalid console context or credentials' });
    }
  });
}

function admitConsoleUpgrade(sessions, request, socket) {
  try {
    const { pathname, searchParams } = new URL(request.url, 'http://localhost');
    request.consoleSession = sessions.consume(searchParams.get('ticket'), pathname);
    return pathname;
  } catch (_) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return null;
  }
}

module.exports = { resolveSession, createConsoleSessions, auditSession, mountConsoleRoutes, admitConsoleUpgrade };

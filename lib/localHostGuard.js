'use strict';

// Check the authority as sent by the client, before URL parsers can normalize
// credentials, encoded characters, paths or unusual representations of loopback.
function parseAuthority(value) {
  if (typeof value !== 'string' || value.length > 260) return null;
  const match = /^(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/i.exec(value);
  if (!match || (match[2] && (+match[2] < 1 || +match[2] > 65535))) return null;
  const hostname = match[1].toLowerCase();
  if (!hostname.startsWith('[') && hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return { hostname, port: match[2] || null };
}

function createLocalHostGuard({ hostname = process.env.KUA_HOSTNAME } = {}) {
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (hostname) {
    const parsed = parseAuthority(hostname);
    if (!parsed || parsed.port || (parsed.hostname.startsWith('[') && parsed.hostname !== '[::1]')) {
      throw new TypeError('KUA_HOSTNAME must be a hostname without a scheme, port or path');
    }
    allowed.add(parsed.hostname);
  }

  function allows(request) {
    // Do not trust Forwarded/X-Forwarded-Host or Express's proxy-derived hostname.
    // Reject duplicate Host headers rather than accepting Node's first value.
    const raw = request.rawHeaders || [];
    let count = 0;
    for (let index = 0; index < raw.length; index += 2) {
      if (raw[index].toLowerCase() === 'host') count += 1;
    }
    if (count > 1) return false;
    const parsed = parseAuthority(request.headers?.host);
    return !!parsed && allowed.has(parsed.hostname);
  }

  function middleware(req, res, next) {
    if (allows(req)) return next();
    res.set('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Local host requests only' });
  }

  function admitUpgrade(request, socket) {
    if (allows(request)) return true;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return false;
  }

  return { allows, middleware, admitUpgrade };
}

module.exports = { createLocalHostGuard };

'use strict';

const { createLocalHostGuard } = require('./localHostGuard');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

function createLocalRequestGuard({ hostGuard = createLocalHostGuard() } = {}) {
  function allows(request) {
    if (!hostGuard.allows(request)) return false;

    const headers = request.headers || {};
    const fetchSite = headers['sec-fetch-site'];
    if (fetchSite !== undefined && !FETCH_SITES.has(fetchSite)) return false;

    const rawHeaders = request.rawHeaders || [];
    let originCount = 0;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index].toLowerCase() === 'origin') originCount += 1;
    }
    if (originCount > 1) return false;

    const origin = headers.origin;
    if (origin === undefined) {
      // Native clients send neither Origin nor Fetch Metadata. Browsers marking
      // a different origin on the same site must supply an explicit origin.
      return fetchSite !== 'same-site';
    }
    if (typeof origin !== 'string') return false;
    // Validate the serialized origin before URL normalization could turn an
    // unusual IP spelling, credentials or an encoded host into loopback.
    const match = /^https?:\/\/([^/?#]+)$/i.exec(origin);
    return !!match && hostGuard.allows({ headers: { host: match[1] } });
  }

  function middleware(req, res, next) {
    if (READ_METHODS.has(req.method) || allows(req)) return next();
    res.set('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Local application origin required', code: 'LOCAL_ORIGIN_REQUIRED' });
  }

  function admitUpgrade(request, socket) {
    if (allows(request)) return true;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return false;
  }

  return { allows, middleware, admitUpgrade };
}

module.exports = { createLocalRequestGuard };

'use strict';
/**
 * lib/proxmox/client.js
 * Read-only client of the Proxmox VE REST API (/api2/json), per profile (#195).
 *
 * TLS is verified per profile, never turned off globally:
 *   fingerprint  the SHA-256 fingerprint of the server certificate, pinned. The certificate is
 *                checked right after the handshake and before the request is handed the socket,
 *                so the API token is never sent to a server whose certificate is a different one.
 *   ca           a PEM CA bundle (the cluster CA, /etc/pve/pve-root-ca.pem) verified as usual.
 *   neither      the system trust store, as any HTTPS request.
 *
 * Errors carry a `kind`: tls, invalid_token, forbidden, unreachable, node_down, not_found,
 * timeout, invalid_response. GETs are retried once on a network error or a 5xx.
 */

const https = require('https');
const net = require('net');
const tls = require('tls');

const DEFAULT_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 300;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TLS_CODES = new Set([
  'FINGERPRINT_MISMATCH', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_UNTRUSTED', 'ERR_SSL_WRONG_VERSION_NUMBER',
]);
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);

function proxmoxError(message, kind, extra = {}) {
  return Object.assign(new Error(message), { kind, ...extra });
}

/** "AB:CD:…" in upper case, from any spelling of a SHA-256 fingerprint; null when it is not one. */
function normalizeFingerprint(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 64 ? hex.match(/.{2}/g).join(':') : null;
}

/** https://host:8006 → { origin, hostname, port }. Only https; a path or credentials are refused. */
function parseProxmoxUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw proxmoxError('The Proxmox URL is not valid (https://host:8006)', 'invalid_profile'); }
  if (url.protocol !== 'https:') throw proxmoxError('The Proxmox URL must use https', 'invalid_profile');
  if (url.username || url.password) throw proxmoxError('The Proxmox URL must not contain credentials', 'invalid_profile');
  if (url.pathname !== '/' && url.pathname !== '') throw proxmoxError('The Proxmox URL must not contain a path', 'invalid_profile');
  return { origin: url.origin, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 8006 };
}

/** The agent that verifies the server as the profile says. */
function createAgent({ fingerprint = null, ca = null } = {}) {
  if (!fingerprint) return new https.Agent({ ca: ca || undefined, keepAlive: false });
  const pinned = normalizeFingerprint(fingerprint);
  if (!pinned) throw proxmoxError('The TLS fingerprint must be a SHA-256 fingerprint (64 hex digits)', 'invalid_profile');
  const agent = new https.Agent({ keepAlive: false });
  // Called by the agent before the request gets a socket: verify first, then hand it over.
  agent.createConnection = (options, callback) => {
    let done = false;
    const finish = (error, socket) => { if (!done) { done = true; callback(error, socket); } };
    const socket = tls.connect({ ...options, rejectUnauthorized: false });
    socket.once('secureConnect', () => {
      const seen = normalizeFingerprint(socket.getPeerCertificate()?.fingerprint256);
      if (seen !== pinned) {
        socket.destroy();
        finish(proxmoxError('The server certificate does not match the pinned fingerprint', 'tls', { code: 'FINGERPRINT_MISMATCH', fingerprint: seen }));
        return;
      }
      finish(null, socket);
    });
    socket.once('error', error => finish(error));
    return undefined;
  };
  return agent;
}

function classify(error) {
  if (error.kind) return error;
  if (TLS_CODES.has(error.code) || /certificate|SSL|TLS/i.test(error.message || '')) {
    return proxmoxError(`TLS verification failed: ${error.message}`, 'tls', { code: error.code });
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') return proxmoxError('Proxmox did not answer in time', 'timeout', { code: error.code });
  if (NETWORK_CODES.has(error.code)) return proxmoxError(`Proxmox is not reachable: ${error.code}`, 'unreachable', { code: error.code });
  return proxmoxError(error.message || 'Proxmox request failed', 'unreachable', { code: error.code });
}

function statusError(status, message) {
  if (status === 401) return proxmoxError('The API token is invalid or expired', 'invalid_token', { status });
  if (status === 403) return proxmoxError(`The API token has no permission for this path${message ? `: ${message}` : ''}`, 'forbidden', { status });
  if (status === 404) return proxmoxError('Not found in Proxmox', 'not_found', { status });
  // 595: the node that should answer is offline (pveproxy could not reach it).
  if (status === 595) return proxmoxError('The Proxmox node is not reachable from the cluster', 'node_down', { status });
  return proxmoxError(`Proxmox answered ${status}${message ? `: ${message}` : ''}`, status >= 500 ? 'unreachable' : 'invalid_response', { status });
}

/** One HTTPS GET with the profile's agent. Resolves { status, body } or rejects with a network error. */
function httpsGet({ url, headers, agent, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET', headers, agent, timeout: timeoutMs }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { request.destroy(proxmoxError('The Proxmox answer is too large', 'invalid_response')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, statusMessage: response.statusMessage, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end();
  });
}

/**
 * @param profile { url, tokenId, tokenSecret, fingerprint?, ca? }
 * @param options.get   (request) => { status, body }: the transport, replaced in tests
 */
function createProxmoxClient(profile, { get = httpsGet, timeoutMs = DEFAULT_TIMEOUT_MS, sleep = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const { origin } = parseProxmoxUrl(profile.url);
  const tokenId = String(profile.tokenId || '').trim();
  if (!/^[^@\s]+@[^!\s]+![^\s]+$/.test(tokenId)) throw proxmoxError('The token id must look like user@realm!tokenid', 'invalid_profile');
  if (!profile.tokenSecret) throw proxmoxError('The token secret is required', 'invalid_profile');
  const agent = createAgent({ fingerprint: profile.fingerprint, ca: profile.ca });
  const headers = { Authorization: `PVEAPIToken=${tokenId}=${profile.tokenSecret}`, Accept: 'application/json' };

  async function attempt(path) {
    let response;
    try { response = await get({ url: `${origin}/api2/json${path}`, headers, agent, timeoutMs }); } catch (error) { throw classify(error); }
    if (response.status < 200 || response.status >= 300) throw statusError(response.status, response.statusMessage);
    try { return JSON.parse(response.body).data; } catch { throw proxmoxError('Proxmox answered something that is not JSON', 'invalid_response'); }
  }

  return {
    origin,
    /** GET /api2/json<path> → its `data`. */
    async get(path) {
      try { return await attempt(path); } catch (error) {
        const retry = ['unreachable', 'timeout'].includes(error.kind) && error.code !== 'ENOTFOUND';
        if (!retry) throw error;
        await sleep(RETRY_DELAY_MS);
        return attempt(path);
      }
    },
  };
}

/**
 * The certificate a server presents, without sending any credential, so the person can compare it
 * with the one on the Proxmox node (Datacenter → node → System → Certificates) before pinning it.
 */
function readServerCertificate(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { hostname, port } = parseProxmoxUrl(url);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: false, timeout: timeoutMs });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.fingerprint256) return reject(proxmoxError('The server presented no certificate', 'tls'));
      resolve({
        fingerprint: normalizeFingerprint(cert.fingerprint256),
        subject: cert.subject?.CN || '',
        issuer: cert.issuer?.CN || cert.issuer?.O || '',
        validTo: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
        trusted: socket.authorized === true,
      });
    });
    socket.once('timeout', () => { socket.destroy(); reject(proxmoxError('Proxmox did not answer in time', 'timeout')); });
    socket.once('error', error => reject(classify(error)));
  });
}

module.exports = { createAgent, createProxmoxClient, normalizeFingerprint, parseProxmoxUrl, readServerCertificate };

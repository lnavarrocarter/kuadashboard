/**
 * DNS Validation Module
 * Validates public resolution of DNS records (A, AAAA, TXT, MX, CNAME, NS)
 * plus SPF/DKIM mail configuration, with an optional TCP reachability check.
 */
const dns = require('dns').promises;
const net = require('net');

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9_*]([a-z0-9_-]{0,62})(\.[a-z0-9_]([a-z0-9_-]{0,62}))*\.?$/i;
const TCP_PORTS = [443, 80];

function ok(values, message)      { return { status: 'OK',      values, message }; }
function warning(values, message) { return { status: 'WARNING', values, message }; }
function error(message, values = []) { return { status: 'ERROR', values, message }; }

function resolveError(err, prefix = 'Failed to resolve') {
  return error(`${prefix}: ${err?.code || err?.message || 'unknown error'}`);
}

class DNSValidator {
  /**
   * Route 53 returns FQDNs with a trailing dot and encodes "*" as "\052".
   */
  static normalizeHostname(hostname) {
    return String(hostname || '').trim().replace(/\\052/g, '*').replace(/\.$/, '').toLowerCase();
  }

  static isValidHostname(hostname) {
    return HOSTNAME_RE.test(hostname);
  }

  /**
   * Validate A (IPv4) or AAAA (IPv6) records, optionally checking TCP 443/80.
   */
  static async validateAddress(hostname, family, { checkTcp = false } = {}) {
    let addresses;
    try {
      addresses = family === 6 ? await dns.resolve6(hostname) : await dns.resolve4(hostname);
    } catch (err) {
      return resolveError(err);
    }
    const kind = family === 6 ? 'AAAA' : 'A';
    if (!addresses.length) return error(`No ${kind} records found`);

    const result = ok(addresses, `Resolved to ${addresses.join(', ')}`);
    if (checkTcp) {
      const port = await this._checkTcpConnection(addresses[0], TCP_PORTS, 2000);
      if (port) {
        result.message += ` · TCP ${port} reachable`;
      } else {
        result.status = 'WARNING';
        result.message += ` · TCP ${TCP_PORTS.join('/')} not reachable`;
      }
    }
    return result;
  }

  static validateA(hostname, options)    { return this.validateAddress(hostname, 4, options); }
  static validateAAAA(hostname, options) { return this.validateAddress(hostname, 6, options); }

  /**
   * Validate TXT record
   */
  static async validateTXT(hostname) {
    try {
      const records = (await dns.resolveTxt(hostname)).map(r => r.join(''));
      return records.length
        ? ok(records, `Found ${records.length} TXT record(s)`)
        : warning([], 'No TXT records found');
    } catch (err) {
      return resolveError(err);
    }
  }

  /**
   * Validate SPF record (TXT starting with v=spf1, exactly one allowed)
   */
  static async validateSPF(hostname) {
    let records;
    try {
      records = (await dns.resolveTxt(hostname)).map(r => r.join(''));
    } catch (err) {
      return resolveError(err);
    }
    const spf = records.filter(r => /^v=spf1(\s|$)/i.test(r));
    if (!spf.length) return error('No SPF record found (must be TXT record starting with v=spf1)');
    if (spf.length > 1) return error(`Multiple SPF records found (${spf.length}). Only one is allowed.`, spf);
    if (/(^|\s)\+?all(\s|$)/i.test(spf[0])) {
      return warning(spf, 'SPF record ends in "+all": any server may send mail for this domain');
    }
    if (!/(^|\s)[~\-?]all(\s|$)/i.test(spf[0]) && !/redirect=/i.test(spf[0])) {
      return warning(spf, 'SPF record has no "all" mechanism or redirect');
    }
    return ok(spf, 'SPF record is valid');
  }

  /**
   * Validate DKIM record. Accepts either the full "<selector>._domainkey.<domain>"
   * hostname or a domain plus selector.
   */
  static async validateDKIM(hostname, selector = null) {
    let dkimHost = hostname;
    if (!/\._domainkey\./i.test(hostname)) {
      if (!selector) return error('DKIM selector is required (or pass <selector>._domainkey.<domain>)');
      dkimHost = `${selector}._domainkey.${hostname}`;
    }
    let records;
    try {
      records = (await dns.resolveTxt(dkimHost)).map(r => r.join(''));
    } catch (err) {
      return resolveError(err, `Failed to resolve DKIM at ${dkimHost}`);
    }
    const dkim = records.filter(r => /(^|;)\s*v=DKIM1\s*(;|$)/i.test(r) || /(^|;)\s*p=/i.test(r));
    if (!dkim.length) return error(`No DKIM record found at ${dkimHost}`);
    const key = dkim[0].match(/(?:^|;)\s*p=([^;]*)/i);
    if (!key) return error(`DKIM record at ${dkimHost} has no public key (p=)`, dkim);
    if (!key[1].trim()) return warning(dkim, `DKIM key at ${dkimHost} is revoked (empty p=)`);
    return ok(dkim, `DKIM record found at ${dkimHost}`);
  }

  /**
   * Validate MX record
   */
  static async validateMX(hostname) {
    try {
      const records = await dns.resolveMx(hostname);
      if (!records.length) return warning([], 'No MX records found');
      const values = records.sort((a, b) => a.priority - b.priority).map(r => `${r.priority} ${r.exchange}`);
      return ok(values, `Found ${records.length} MX record(s)`);
    } catch (err) {
      return resolveError(err);
    }
  }

  /**
   * Validate CNAME record
   */
  static async validateCNAME(hostname) {
    try {
      const targets = await dns.resolveCname(hostname);
      return targets.length
        ? ok(targets, `Points to ${targets.join(', ')}`)
        : error('No CNAME records found');
    } catch (err) {
      return resolveError(err);
    }
  }

  /**
   * Validate NS record
   */
  static async validateNS(hostname) {
    try {
      const records = await dns.resolveNs(hostname);
      return records.length
        ? ok(records, `Found ${records.length} NS record(s)`)
        : error('No NS records found');
    } catch (err) {
      return resolveError(err);
    }
  }

  /**
   * Generic validation dispatcher
   */
  static async validate(rawHostname, type, options = {}) {
    const hostname = this.normalizeHostname(rawHostname);
    if (!this.isValidHostname(hostname)) return error(`Invalid hostname: ${rawHostname}`);
    if (hostname.includes('*')) {
      return warning([], 'Wildcard record: test a concrete subdomain instead');
    }

    const handlers = {
      A:     () => this.validateA(hostname, options),
      AAAA:  () => this.validateAAAA(hostname, options),
      TXT:   () => this.validateTXT(hostname),
      MX:    () => this.validateMX(hostname),
      CNAME: () => this.validateCNAME(hostname),
      NS:    () => this.validateNS(hostname),
      SPF:   () => this.validateSPF(hostname),
      DKIM:  () => this.validateDKIM(hostname, options.selector),
    };
    const handler = handlers[String(type || '').toUpperCase()];
    if (!handler) return error(`Unsupported record type: ${type}`);
    return handler();
  }

  /**
   * Try each port in order; resolves to the first reachable port or null.
   */
  static async _checkTcpConnection(host, ports, timeout = 2000) {
    for (const port of ports) {
      const reachable = await new Promise(resolve => {
        const socket = net.createConnection({ host, port });
        const done = value => {
          clearTimeout(timer);
          socket.destroy();
          resolve(value);
        };
        const timer = setTimeout(() => done(false), timeout);
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
      });
      if (reachable) return port;
    }
    return null;
  }
}

module.exports = DNSValidator;

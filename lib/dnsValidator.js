/**
 * DNS Validation Module
 * Validates DNS records (A, TXT, MX, CNAME, NS)
 * Checks connectivity and validates SPF/DKIM configurations
 */
const dns = require('dns').promises;
const net = require('net');

class DNSValidator {
  /**
   * Validate A record (IPv4 address)
   */
  static async validateA(hostname, expectedValue = null) {
    try {
      const addresses = await dns.resolve4(hostname);
      const result = {
        status: addresses.length > 0 ? 'OK' : 'ERROR',
        values: addresses,
        message: addresses.length > 0
          ? `Resolved to ${addresses.join(', ')}`
          : 'No A records found',
      };

      // Try TCP connectivity check if requested
      if (addresses.length > 0 && expectedValue) {
        const canConnect = await this._checkTcpConnection(addresses[0], [80, 443], 2000);
        if (!canConnect) {
          result.status = 'WARNING';
          result.message += ' (TCP connection failed)';
        }
      }

      return result;
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve: ${err.code || err.message}`,
      };
    }
  }

  /**
   * Validate TXT record
   */
  static async validateTXT(hostname) {
    try {
      const records = await dns.resolveTxt(hostname);
      const flatRecords = records.map(r => r.join(''));
      return {
        status: flatRecords.length > 0 ? 'OK' : 'WARNING',
        values: flatRecords,
        message: flatRecords.length > 0
          ? `Found ${flatRecords.length} TXT record(s)`
          : 'No TXT records found',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve: ${err.code || err.message}`,
      };
    }
  }

  /**
   * Validate SPF record (must be TXT record starting with v=spf1)
   */
  static async validateSPF(hostname) {
    try {
      const records = await dns.resolveTxt(hostname);
      const spfRecords = records
        .map(r => r.join(''))
        .filter(r => r.startsWith('v=spf1'));

      if (spfRecords.length === 0) {
        return {
          status: 'ERROR',
          values: [],
          message: 'No SPF record found (must be TXT record starting with v=spf1)',
        };
      }

      if (spfRecords.length > 1) {
        return {
          status: 'ERROR',
          values: spfRecords,
          message: `Multiple SPF records found (${spfRecords.length}). Only one is allowed.`,
        };
      }

      return {
        status: 'OK',
        values: spfRecords,
        message: 'SPF record is valid',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve: ${err.code || err.message}`,
      };
    }
  }

  /**
   * Validate DKIM record (TXT record for selector)
   */
  static async validateDKIM(hostname, selector = 'default') {
    const dkimHost = `${selector}._domainkey.${hostname}`;
    try {
      const records = await dns.resolveTxt(dkimHost);
      const dkimRecords = records
        .map(r => r.join(''))
        .filter(r => r.startsWith('v=DKIM1'));

      if (dkimRecords.length === 0) {
        return {
          status: 'ERROR',
          values: [],
          message: `No DKIM record found for selector "${selector}" (looked for ${dkimHost})`,
        };
      }

      return {
        status: 'OK',
        values: dkimRecords,
        message: `DKIM record found for selector "${selector}"`,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve DKIM for selector "${selector}": ${err.code || err.message}`,
      };
    }
  }

  /**
   * Validate MX record
   */
  static async validateMX(hostname) {
    try {
      const records = await dns.resolveMx(hostname);
      if (records.length === 0) {
        return {
          status: 'WARNING',
          values: [],
          message: 'No MX records found',
        };
      }

      return {
        status: 'OK',
        values: records.map(r => `${r.priority} ${r.exchange}`),
        message: `Found ${records.length} MX record(s)`,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve: ${err.code || err.message}`,
      };
    }
  }

  /**
   * Validate CNAME record
   */
  static async validateCNAME(hostname) {
    try {
      const addresses = await dns.resolveCname(hostname);
      return {
        status: addresses.length > 0 ? 'OK' : 'ERROR',
        values: addresses,
        message: addresses.length > 0
          ? `Resolved to ${addresses.join(', ')}`
          : 'No CNAME records found',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve: ${err.code || err.message}`,
      };
    }
  }

  /**
   * Validate NS record
   */
  static async validateNS(hostname) {
    try {
      const records = await dns.resolveNs(hostname);
      return {
        status: records.length > 0 ? 'OK' : 'ERROR',
        values: records,
        message: records.length > 0
          ? `Found ${records.length} NS record(s)`
          : 'No NS records found',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        values: [],
        message: `Failed to resolve: ${err.code || err.message}`,
      };
    }
  }

  /**
   * Generic validation dispatcher
   */
  static async validate(hostname, type, options = {}) {
    const typeHandlers = {
      'A': () => this.validateA(hostname, options.expectedValue),
      'TXT': () => this.validateTXT(hostname),
      'MX': () => this.validateMX(hostname),
      'CNAME': () => this.validateCNAME(hostname),
      'NS': () => this.validateNS(hostname),
      'SPF': () => this.validateSPF(hostname),
      'DKIM': () => this.validateDKIM(hostname, options.selector),
    };

    const handler = typeHandlers[type];
    if (!handler) {
      return {
        status: 'ERROR',
        values: [],
        message: `Unsupported record type: ${type}`,
      };
    }

    return handler();
  }

  /**
   * Check TCP connectivity to a host on given ports
   */
  static async _checkTcpConnection(host, ports, timeout = 2000) {
    for (const port of ports) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ host, port, timeout });

          socket.on('connect', () => {
            socket.destroy();
            resolve(true);
          });

          socket.on('error', reject);

          setTimeout(() => {
            socket.destroy();
            reject(new Error('timeout'));
          }, timeout);
        });

        return true;
      } catch (err) {
        // Try next port
      }
    }

    return false;
  }
}

module.exports = DNSValidator;

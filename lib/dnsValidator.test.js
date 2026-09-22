const { describe, it, expect, beforeEach, vi, afterEach } = require('vitest');
const dns = require('dns').promises;
const DNSValidator = require('./dnsValidator');

// Mock the dns module
vi.mock('dns', () => {
  const actualDns = require('dns');
  return {
    promises: {
      resolve4: vi.fn(),
      resolveTxt: vi.fn(),
      resolveMx: vi.fn(),
      resolveCname: vi.fn(),
      resolveNs: vi.fn(),
    },
  };
});

describe('DNSValidator', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateA', () => {
    it('returns OK when A record is found', async () => {
      dns.resolve4.mockResolvedValue(['192.0.2.1']);
      const result = await DNSValidator.validateA('example.com');

      expect(result.status).toBe('OK');
      expect(result.values).toEqual(['192.0.2.1']);
      expect(result.message).toContain('192.0.2.1');
    });

    it('returns ERROR when A record resolution fails', async () => {
      dns.resolve4.mockRejectedValue({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND example.com' });
      const result = await DNSValidator.validateA('example.com');

      expect(result.status).toBe('ERROR');
      expect(result.values).toEqual([]);
      expect(result.message).toContain('Failed to resolve');
    });

    it('handles ENODATA error gracefully', async () => {
      dns.resolve4.mockRejectedValue({ code: 'ENODATA', message: 'queryA ENODATA example.com' });
      const result = await DNSValidator.validateA('example.com');

      expect(result.status).toBe('ERROR');
      expect(result.message).toContain('ENODATA');
    });
  });

  describe('validateTXT', () => {
    it('returns OK when TXT record is found', async () => {
      dns.resolveTxt.mockResolvedValue([
        ['v=spf1', 'include:_spf.google.com', '~all'],
        ['google-site-verification=abc123'],
      ]);
      const result = await DNSValidator.validateTXT('example.com');

      expect(result.status).toBe('OK');
      expect(result.values.length).toBe(2);
    });

    it('returns WARNING when no TXT records found', async () => {
      dns.resolveTxt.mockResolvedValue([]);
      const result = await DNSValidator.validateTXT('example.com');

      expect(result.status).toBe('WARNING');
      expect(result.values).toEqual([]);
    });

    it('returns ERROR on resolution failure', async () => {
      dns.resolveTxt.mockRejectedValue({ code: 'ENOTFOUND' });
      const result = await DNSValidator.validateTXT('example.com');

      expect(result.status).toBe('ERROR');
    });
  });

  describe('validateSPF', () => {
    it('returns OK for valid SPF record', async () => {
      dns.resolveTxt.mockResolvedValue([
        ['v=spf1 include:_spf.google.com ~all'],
      ]);
      const result = await DNSValidator.validateSPF('example.com');

      expect(result.status).toBe('OK');
      expect(result.values[0]).toContain('v=spf1');
    });

    it('returns ERROR when no SPF record found', async () => {
      dns.resolveTxt.mockResolvedValue([
        ['google-site-verification=abc123'],
      ]);
      const result = await DNSValidator.validateSPF('example.com');

      expect(result.status).toBe('ERROR');
      expect(result.message).toContain('No SPF record found');
    });

    it('returns ERROR when multiple SPF records found', async () => {
      dns.resolveTxt.mockResolvedValue([
        ['v=spf1 include:_spf.google.com ~all'],
        ['v=spf1 include:_spf2.google.com ~all'],
      ]);
      const result = await DNSValidator.validateSPF('example.com');

      expect(result.status).toBe('ERROR');
      expect(result.message).toContain('Multiple SPF records');
    });
  });

  describe('validateDKIM', () => {
    it('returns OK for valid DKIM record', async () => {
      dns.resolveTxt.mockResolvedValue([
        ['v=DKIM1; k=rsa; p=MIGfMA0GCSq...'],
      ]);
      const result = await DNSValidator.validateDKIM('example.com', 'default');

      expect(result.status).toBe('OK');
      expect(result.message).toContain('default');
    });

    it('returns ERROR when DKIM record not found', async () => {
      dns.resolveTxt.mockResolvedValue([]);
      const result = await DNSValidator.validateDKIM('example.com', 'default');

      expect(result.status).toBe('ERROR');
      expect(result.message).toContain('No DKIM record found');
    });

    it('uses selector in DNS query', async () => {
      dns.resolveTxt.mockResolvedValue([
        ['v=DKIM1; k=rsa; p=MIGfMA0GCSq...'],
      ]);
      await DNSValidator.validateDKIM('example.com', 'google');

      expect(dns.resolveTxt).toHaveBeenCalledWith('google._domainkey.example.com');
    });
  });

  describe('validateMX', () => {
    it('returns OK when MX records found', async () => {
      dns.resolveMx.mockResolvedValue([
        { exchange: 'aspmx.l.google.com.', priority: 10 },
        { exchange: 'alt1.aspmx.l.google.com.', priority: 20 },
      ]);
      const result = await DNSValidator.validateMX('example.com');

      expect(result.status).toBe('OK');
      expect(result.values.length).toBe(2);
      expect(result.values[0]).toContain('aspmx.l.google.com');
    });

    it('returns WARNING when no MX records found', async () => {
      dns.resolveMx.mockResolvedValue([]);
      const result = await DNSValidator.validateMX('example.com');

      expect(result.status).toBe('WARNING');
      expect(result.message).toContain('No MX records');
    });

    it('formats MX records with priority', async () => {
      dns.resolveMx.mockResolvedValue([
        { exchange: 'mail.example.com.', priority: 10 },
      ]);
      const result = await DNSValidator.validateMX('example.com');

      expect(result.values[0]).toBe('10 mail.example.com.');
    });
  });

  describe('validateCNAME', () => {
    it('returns OK when CNAME record found', async () => {
      dns.resolveCname.mockResolvedValue(['target.example.com']);
      const result = await DNSValidator.validateCNAME('alias.example.com');

      expect(result.status).toBe('OK');
      expect(result.values).toEqual(['target.example.com']);
    });

    it('returns ERROR when CNAME not found', async () => {
      dns.resolveCname.mockResolvedValue([]);
      const result = await DNSValidator.validateCNAME('alias.example.com');

      expect(result.status).toBe('ERROR');
    });
  });

  describe('validateNS', () => {
    it('returns OK when NS records found', async () => {
      dns.resolveNs.mockResolvedValue(['ns1.example.com', 'ns2.example.com']);
      const result = await DNSValidator.validateNS('example.com');

      expect(result.status).toBe('OK');
      expect(result.values.length).toBe(2);
    });

    it('returns ERROR when no NS records found', async () => {
      dns.resolveNs.mockResolvedValue([]);
      const result = await DNSValidator.validateNS('example.com');

      expect(result.status).toBe('ERROR');
    });
  });

  describe('validate (dispatcher)', () => {
    it('dispatches to correct validator based on type', async () => {
      dns.resolve4.mockResolvedValue(['192.0.2.1']);

      const result = await DNSValidator.validate('example.com', 'a');
      expect(dns.resolve4).toHaveBeenCalled();
      expect(result.status).toBe('OK');
    });

    it('handles uppercase type names', async () => {
      dns.resolve4.mockResolvedValue(['192.0.2.1']);

      await DNSValidator.validate('example.com', 'A');
      expect(dns.resolve4).toHaveBeenCalled();
    });

    it('returns error for unsupported type', async () => {
      const result = await DNSValidator.validate('example.com', 'UNSUPPORTED');

      expect(result.status).toBe('ERROR');
      expect(result.message).toContain('Unsupported record type');
    });

    it('passes selector option to DKIM validation', async () => {
      dns.resolveTxt.mockResolvedValue([['v=DKIM1; k=rsa; p=...']]);

      await DNSValidator.validate('example.com', 'DKIM', { selector: 'google' });
      expect(dns.resolveTxt).toHaveBeenCalledWith('google._domainkey.example.com');
    });
  });
});

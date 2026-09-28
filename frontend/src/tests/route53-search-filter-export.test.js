import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  displayName, filterRecords, hostnameOf, recordKey, recordTypes,
  recordsForExport, recordsToCsv, testsForRecord,
} from '../components/cloud/route53Records'
import { useAwsStore } from '../stores/useAwsStore'

const RECORDS = [
  { name: 'example.com.', type: 'A', ttl: 300, records: ['192.0.2.1'], alias: null },
  { name: 'www.example.com.', type: 'A', ttl: 300, records: ['192.0.2.1'], alias: null },
  { name: 'mail.example.com.', type: 'MX', ttl: 3600, records: ['10 mail.example.com'], alias: null },
  { name: 'example.com.', type: 'TXT', ttl: 300, records: ['"v=spf1 include:_spf.google.com ~all"'], alias: null },
  { name: 'example.com.', type: 'NS', ttl: 172800, records: ['ns1.example.com', 'ns2.example.com'], alias: null },
  { name: 'cdn.example.com.', type: 'A', ttl: null, records: [], alias: { dnsName: 'd123.cloudfront.net.' } },
  { name: 'api.example.com.', type: 'A', ttl: 60, setIdentifier: 'us-east-1', records: ['198.51.100.1'], alias: null },
  { name: 'api.example.com.', type: 'A', ttl: 60, setIdentifier: 'eu-west-1', records: ['198.51.100.2'], alias: null },
  { name: 'google._domainkey.example.com.', type: 'TXT', ttl: 300, records: ['"v=DKIM1; k=rsa; " "p=MIGf"'], alias: null },
  { name: '\\052.example.com.', type: 'A', ttl: 300, records: ['192.0.2.9'], alias: null },
  { name: 'example.com.', type: 'SOA', ttl: 900, records: ['ns1.example.com. admin.example.com. 1 7200 900 1209600 86400'], alias: null },
]

describe('Route 53 records — search and filter (#71)', () => {
  it('searches by record name', () => {
    expect(filterRecords(RECORDS, { search: 'www' }).map(r => r.name)).toEqual(['www.example.com.'])
  })

  it('searches by record value and alias target, case-insensitively', () => {
    expect(filterRecords(RECORDS, { search: '192.0.2.1' })).toHaveLength(2)
    expect(filterRecords(RECORDS, { search: 'CLOUDFRONT' }).map(r => r.name)).toEqual(['cdn.example.com.'])
    expect(filterRecords(RECORDS, { search: 'spf1' })[0].type).toBe('TXT')
  })

  it('searches wildcard records by their decoded name', () => {
    expect(filterRecords(RECORDS, { search: '*.example' }).map(r => r.name)).toEqual(['\\052.example.com.'])
  })

  it('filters by type and combines with search', () => {
    expect(filterRecords(RECORDS, { type: 'MX' })).toHaveLength(1)
    expect(filterRecords(RECORDS, { type: 'A', search: 'api' })).toHaveLength(2)
    expect(filterRecords(RECORDS, { type: 'TXT', search: 'www' })).toHaveLength(0)
  })

  it('returns everything with no search or type', () => {
    expect(filterRecords(RECORDS, {})).toHaveLength(RECORDS.length)
    expect(filterRecords(RECORDS, { search: '   ' })).toHaveLength(RECORDS.length)
  })

  it('lists record types sorted and unique', () => {
    expect(recordTypes(RECORDS)).toEqual(['A', 'MX', 'NS', 'SOA', 'TXT'])
  })
})

describe('Route 53 records — selection and export (#71)', () => {
  it('gives distinct keys to records that share name and type (routing policies)', () => {
    const [us, eu] = RECORDS.filter(r => r.name === 'api.example.com.')
    expect(recordKey(us)).not.toBe(recordKey(eu))
  })

  it('keeps the selection tied to records when the filter changes', () => {
    const www = RECORDS[1]
    const selected = new Set([recordKey(www)])
    const visibleAfterSearch = filterRecords(RECORDS, { search: 'mail' })
    // www is no longer visible, but still selected and exported
    expect(visibleAfterSearch.some(r => recordKey(r) === recordKey(www))).toBe(false)
    expect(recordsForExport(RECORDS, visibleAfterSearch, selected)).toEqual([www])
  })

  it('exports both records of a routing-policy pair when both are selected', () => {
    const pair = RECORDS.filter(r => r.name === 'api.example.com.')
    const selected = new Set(pair.map(recordKey))
    expect(recordsForExport(RECORDS, RECORDS, selected)).toEqual(pair)
  })

  it('exports the visible records when nothing is selected', () => {
    const visible = filterRecords(RECORDS, { type: 'NS' })
    expect(recordsForExport(RECORDS, visible, new Set())).toEqual(visible)
  })

  it('builds a quoted CSV with set id, alias marker and escaped quotes', () => {
    const csv = recordsToCsv([RECORDS[3], RECORDS[5], RECORDS[6], RECORDS[9]]).split('\n')
    expect(csv[0]).toBe('"Name","Type","TTL","Set ID","Value / Alias"')
    expect(csv[1]).toBe('"example.com.","TXT","300","","""v=spf1 include:_spf.google.com ~all"""')
    expect(csv[2]).toBe('"cdn.example.com.","A","","","ALIAS d123.cloudfront.net."')
    expect(csv[3]).toBe('"api.example.com.","A","60","us-east-1","198.51.100.1"')
    expect(csv[4]).toBe('"*.example.com.","A","300","","192.0.2.9"')
  })

  it('joins multi-value records with semicolons', () => {
    expect(recordsToCsv([RECORDS[4]]).split('\n')[1]).toContain('"ns1.example.com; ns2.example.com"')
  })
})

describe('Route 53 records — DNS tests offered per type (#72)', () => {
  const ids = r => testsForRecord(r).map(t => t.id)

  it('offers resolve + TCP only for address records', () => {
    expect(testsForRecord(RECORDS[0])).toEqual([expect.objectContaining({ id: 'A', checkTcp: true })])
    expect(testsForRecord({ name: 'v6.example.com.', type: 'AAAA', records: ['2001:db8::1'] })[0].checkTcp).toBe(true)
    expect(testsForRecord(RECORDS[2]).every(t => !t.checkTcp)).toBe(true)
  })

  it('offers SPF on TXT records that carry v=spf1', () => {
    expect(ids(RECORDS[3])).toEqual(['TXT', 'SPF'])
  })

  it('offers DKIM on <selector>._domainkey TXT records', () => {
    expect(ids(RECORDS[8])).toEqual(['TXT', 'DKIM'])
  })

  it('offers only a plain resolve for other TXT records', () => {
    expect(ids({ name: 'example.com.', type: 'TXT', records: ['"google-site-verification=abc"'] })).toEqual(['TXT'])
  })

  it('offers resolve for MX, NS and CNAME', () => {
    expect(ids(RECORDS[2])).toEqual(['MX'])
    expect(ids(RECORDS[4])).toEqual(['NS'])
    expect(ids({ name: 'x.example.com.', type: 'CNAME', records: ['y.example.com'] })).toEqual(['CNAME'])
  })

  it('offers nothing for unsupported types or wildcard records', () => {
    expect(ids(RECORDS[10])).toEqual([])
    expect(ids(RECORDS[9])).toEqual([])
  })

  it('normalizes hostnames sent to the validator', () => {
    expect(hostnameOf(RECORDS[1])).toBe('www.example.com')
    expect(displayName('\\052.example.com.')).toBe('*.example.com.')
  })
})

describe('useAwsStore.validateRoute53Record (#72)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the mounted AWS router path with the test options', async () => {
    const result = { status: 'OK', values: ['192.0.2.1'], message: 'Resolved' }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => result,
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useAwsStore()
    const res = await store.validateRoute53Record({ hostname: 'www.example.com', type: 'A', checkTcp: true })

    expect(res).toEqual(result)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/cloud/aws/route53/validate')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ hostname: 'www.example.com', type: 'A', checkTcp: true })
  })
})

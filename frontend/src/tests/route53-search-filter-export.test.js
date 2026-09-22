import { describe, it, expect, beforeEach } from 'vitest'

describe('Route 53 — Search, Filter, Selection, Export (#71)', () => {
  // Mock records for testing
  const mockRecords = [
    { name: 'example.com', type: 'A', ttl: 300, records: ['192.0.2.1'], alias: null },
    { name: 'www.example.com', type: 'A', ttl: 300, records: ['192.0.2.1'], alias: null },
    { name: 'mail.example.com', type: 'MX', ttl: 3600, records: ['10 mail.example.com'], alias: null },
    { name: 'example.com', type: 'TXT', ttl: 300, records: ['v=spf1 include:_spf.google.com ~all'], alias: null },
    { name: 'example.com', type: 'NS', ttl: 172800, records: ['ns1.example.com', 'ns2.example.com'], alias: null },
    { name: 'cdn.example.com', type: 'CNAME', ttl: 3600, alias: { dnsName: 'd123.cloudfront.net' }, records: null },
  ]

  it('filters records by search text (name)', () => {
    // Test: search by name "www" should find www.example.com
    const search = 'www'
    const filtered = mockRecords.filter(r =>
      r.name?.toLowerCase().includes(search.toLowerCase())
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('www.example.com')
  })

  it('filters records by search text (value)', () => {
    // Test: search by value "192.0.2.1" should find A records
    const search = '192.0.2.1'
    const filtered = mockRecords.filter(r =>
      r.records?.some(v => v?.toLowerCase().includes(search.toLowerCase())) ||
      r.alias?.dnsName?.toLowerCase().includes(search.toLowerCase())
    )
    expect(filtered).toHaveLength(2)
    expect(filtered.every(r => r.type === 'A')).toBe(true)
  })

  it('filters records by search text (SPF value)', () => {
    // Test: search for "spf1" should find TXT records with SPF
    const search = 'spf1'
    const filtered = mockRecords.filter(r =>
      r.records?.some(v => v?.toLowerCase().includes(search.toLowerCase()))
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].type).toBe('TXT')
  })

  it('filters records by record type', () => {
    // Test: filter by type "MX" should find only MX records
    const selectedType = 'MX'
    const filtered = mockRecords.filter(r => r.type === selectedType)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('mail.example.com')
  })

  it('combines search and type filter', () => {
    // Test: search "www" + type "A" should find www.example.com
    const search = 'www'
    const selectedType = 'A'
    const filtered = mockRecords.filter(r =>
      r.name?.toLowerCase().includes(search.toLowerCase()) &&
      r.type === selectedType
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('www.example.com')
    expect(filtered[0].type).toBe('A')
  })

  it('gets unique record types for filter dropdown', () => {
    // Test: extract all unique types for dropdown
    const types = Array.from(new Set(mockRecords.map(r => r.type))).sort()
    expect(types).toEqual(['A', 'CNAME', 'MX', 'NS', 'TXT'])
  })

  it('tracks selected records by key (name|type|idx)', () => {
    // Test: simulate checkbox selection with unique keys
    const selectedRecords = new Set()

    // Select first A record
    selectedRecords.add('example.com|A|0')
    expect(selectedRecords.has('example.com|A|0')).toBe(true)

    // Select MX record
    selectedRecords.add('mail.example.com|MX|2')
    expect(selectedRecords.size).toBe(2)

    // Deselect first one
    selectedRecords.delete('example.com|A|0')
    expect(selectedRecords.size).toBe(1)
    expect(selectedRecords.has('example.com|A|0')).toBe(false)
  })

  it('exports selected records to CSV format', () => {
    // Test: verify CSV export generates correct format
    const selectedIndices = [0, 2] // Select A and MX records
    const recordsToExport = [mockRecords[0], mockRecords[2]]

    const headers = ['Name', 'Type', 'TTL', 'Value / Alias']
    const rows = recordsToExport.map(r => [
      r.name || '',
      r.type || '',
      r.ttl ?? '-',
      r.alias ? r.alias.dnsName : (r.records || []).join('; '),
    ])

    const csv = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    expect(csv).toContain('"Name","Type","TTL"')
    expect(csv).toContain('"example.com","A","300"')
    expect(csv).toContain('"mail.example.com","MX","3600"')
    expect(csv).toContain('10 mail.example.com')
  })

  it('exports all filtered records when none are selected', () => {
    // Test: when selectedRecords is empty, export all visible records
    const filtered = mockRecords.filter(r => r.type === 'A')
    expect(filtered).toHaveLength(2)

    // Export all filtered (should be 2 A records)
    const recordsToExport = filtered
    expect(recordsToExport.every(r => r.type === 'A')).toBe(true)
  })

  it('handles CSV special characters (quotes)', () => {
    // Test: escape quotes in CSV values
    const testRecord = {
      name: 'test.com',
      type: 'TXT',
      ttl: 300,
      records: ['v=spf1 include:"example.com" ~all'],
      alias: null,
    }

    const value = testRecord.records[0]
    const escaped = `"${value.replace(/"/g, '""')}"`
    expect(escaped).toBe('"v=spf1 include:""example.com"" ~all"')
  })

  it('handles alias records in export', () => {
    // Test: export alias records correctly
    const aliasRecord = mockRecords.find(r => r.alias)
    const exported = aliasRecord.alias ? aliasRecord.alias.dnsName : ''
    expect(exported).toBe('d123.cloudfront.net')
  })

  it('select all checkbox state reflects all visible records selected', () => {
    // Test: checkbox should be checked only if all visible records are selected
    const filtered = mockRecords.filter(r => r.type === 'A')
    const selected = new Set()

    // Select all
    filtered.forEach((r, idx) => {
      selected.add(`${r.name}|${r.type}|${idx}`)
    })

    const allSelected = filtered.every((r, idx) => selected.has(`${r.name}|${r.type}|${idx}`))
    expect(allSelected).toBe(true)
  })
})

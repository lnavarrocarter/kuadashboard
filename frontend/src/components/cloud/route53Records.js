// Pure helpers for the Route 53 records panel in AwsView.vue:
// identity, search/filter, CSV export and the DNS tests offered per record.

/** Route 53 returns FQDNs with a trailing dot and encodes "*" as "\052". */
export function displayName(name) {
  return String(name || '').replace(/\\052/g, '*')
}

export function hostnameOf(record) {
  return displayName(record?.name).replace(/\.$/, '')
}

/**
 * Stable identity of a record set. Name + type is not unique for routing
 * policies (weighted, latency, failover...), which add a SetIdentifier.
 */
export function recordKey(record) {
  return `${record?.name ?? ''}|${record?.type ?? ''}|${record?.setIdentifier ?? ''}`
}

export function recordValue(record) {
  return record?.alias ? record.alias.dnsName : (record?.records || []).join(', ')
}

export function recordTypes(records) {
  return [...new Set((records || []).map(r => r.type))].sort()
}

export function filterRecords(records, { search = '', type = null } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (records || []).filter(r => {
    if (type && r.type !== type) return false
    if (!q) return true
    return displayName(r.name).toLowerCase().includes(q)
      || (r.records || []).some(v => String(v).toLowerCase().includes(q))
      || String(r.alias?.dnsName || '').toLowerCase().includes(q)
      || String(r.setIdentifier || '').toLowerCase().includes(q)
  })
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function recordsToCsv(records) {
  const header = ['Name', 'Type', 'TTL', 'Set ID', 'Value / Alias']
  const rows = (records || []).map(r => [
    displayName(r.name),
    r.type,
    r.ttl ?? '',
    r.setIdentifier || '',
    r.alias ? `ALIAS ${r.alias.dnsName}` : (r.records || []).join('; '),
  ])
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')
}

/**
 * Records to export: the selected ones (in table order) or, with nothing
 * selected, every record matching the current search/filter.
 */
export function recordsForExport(records, visible, selectedKeys) {
  if (selectedKeys?.size) return (records || []).filter(r => selectedKeys.has(recordKey(r)))
  return visible || []
}

/**
 * DNS tests that make sense for a record, e.g. no TCP check for a TXT and
 * SPF/DKIM only when the TXT actually carries that configuration.
 */
export function testsForRecord(record) {
  if (!record) return []
  const name = displayName(record.name)
  if (name.startsWith('*')) return []

  // Route 53 TXT values are quoted and long ones split: "v=spf1 ..." "... ~all"
  const values = (record.records || []).map(v => String(v).replace(/"\s*"/g, '').replace(/^"|"$/g, ''))
  switch (record.type) {
    case 'A':     return [{ id: 'A',    type: 'A',    label: 'Resolve + TCP', checkTcp: true }]
    case 'AAAA':  return [{ id: 'AAAA', type: 'AAAA', label: 'Resolve + TCP', checkTcp: true }]
    case 'MX':    return [{ id: 'MX',    type: 'MX',    label: 'Resolve' }]
    case 'CNAME': return [{ id: 'CNAME', type: 'CNAME', label: 'Resolve' }]
    case 'NS':    return [{ id: 'NS',    type: 'NS',    label: 'Resolve' }]
    case 'TXT': {
      const tests = [{ id: 'TXT', type: 'TXT', label: 'Resolve' }]
      if (values.some(v => /^v=spf1(\s|$)/i.test(v))) tests.push({ id: 'SPF', type: 'SPF', label: 'SPF' })
      // The selector comes from the record name: <selector>._domainkey.<domain>
      if (/\._domainkey\./i.test(name)) tests.push({ id: 'DKIM', type: 'DKIM', label: 'DKIM' })
      return tests
    }
    default: return []
  }
}

export function testResultKey(record, test) {
  return `${recordKey(record)}|${test.id}`
}

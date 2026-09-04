import { describe, expect, it } from 'vitest'
import {
  extractCorrelationIds,
  extractLogSignals,
  extractRecurringErrors,
  extractServiceReferences,
  sanitizeLogLine,
  suggestGraphRelationships,
} from '../lib/logRelationshipEvidence'

describe('sanitizeLogLine', () => {
  it('redacts common secret-shaped substrings before they are ever kept as evidence', () => {
    expect(sanitizeLogLine('Authorization: Bearer abc.def.ghi')).toBe('Authorization: [redacted]')
    expect(sanitizeLogLine('calling api with token=xyz123')).toContain('token: [redacted]')
    expect(sanitizeLogLine('connect postgres://app:secret@db.internal:5432/orders')).toContain('postgres://[redacted]@db.internal')
    expect(sanitizeLogLine('GET https://payments.internal/charge?customer=alice&debug=true')).toBe('GET https://payments.internal/charge?[redacted]')
    expect(sanitizeLogLine('notify alice@example.com')).toBe('notify [redacted-email]')
    expect(sanitizeLogLine('GET /orders 200')).toBe('GET /orders 200')
  })
})

describe('extractServiceReferences', () => {
  it('finds internal Kubernetes DNS names with occurrence counts', () => {
    const lines = [
      'calling http://payments-api.orders.svc.cluster.local:8080/charge',
      'calling http://payments-api.orders.svc.cluster.local:8080/charge',
      'calling http://payments-api.orders.svc/charge',
    ]
    const references = extractServiceReferences(lines)
    expect(references[0]).toMatchObject({ service: 'payments-api', namespace: 'orders', occurrences: 3 })
  })

  it('ignores localhost and numeric hosts', () => {
    const references = extractServiceReferences(['GET http://localhost:8080/health', 'GET http://127/health'])
    expect(references).toEqual([])
  })
})

describe('extractRecurringErrors', () => {
  it('groups error lines by a normalized signature and drops one-off noise', () => {
    const lines = [
      'ERROR connection refused to db-1 at 10:00:01',
      'ERROR connection refused to db-1 at 10:00:05',
      'ERROR unrelated one-off failure',
      'INFO all good',
    ]
    const errors = extractRecurringErrors(lines, { minOccurrences: 2 })
    expect(errors).toHaveLength(1)
    expect(errors[0].occurrences).toBe(2)
    expect(errors[0].signature).toContain('connection refused to db-<n>')
  })
})

describe('extractCorrelationIds', () => {
  it('collects distinct correlation/request/trace ids', () => {
    const lines = [
      'handling request x-request-id: req-11111111',
      'handling request x-request-id: req-11111111',
      'trace_id=trace-22222222',
    ]
    expect(extractCorrelationIds(lines).sort()).toEqual(['req-11111111', 'trace-22222222'])
  })
})

describe('extractLogSignals', () => {
  it('measures error rate, keywords and recurring patterns without returning raw log lines', () => {
    const result = extractLogSignals([
      'ERROR timeout calling payments',
      'ERROR timeout calling payments',
      'request failed with code 503',
      'WARN retrying request',
      'INFO ready',
    ])
    expect(result).toMatchObject({ lineCount: 5, errorCount: 3, warningCount: 1, repeatedErrorCount: 2 })
    expect(result.keywordCounts).toEqual(expect.arrayContaining([
      { keyword: 'timeout', count: 2 },
      { keyword: 'fail', count: 1 },
    ]))
    expect(result.recurringErrors[0].occurrences).toBe(2)
    expect(JSON.stringify(result)).not.toContain('token=')
  })
})

describe('suggestGraphRelationships', () => {
  const nodes = [
    { id: 'node:api', name: 'orders-api', provider: 'kubernetes', resourceType: 'deployment', namespace: 'orders' },
    { id: 'node:payments', name: 'payments-api', provider: 'kubernetes', resourceType: 'service', namespace: 'orders' },
    { id: 'node:unrelated', name: 'payments-api', provider: 'aws', resourceType: 'lambda' },
  ]

  it('only suggests a relationship when the referenced hostname matches a known Kubernetes node', () => {
    const lines = [
      'calling http://payments-api.orders.svc.cluster.local/charge',
      'calling http://payments-api.orders.svc.cluster.local/charge',
      'calling http://unknown-service.orders.svc.cluster.local/ping',
    ]
    const suggestions = suggestGraphRelationships({ lines, sourceNode: nodes[0], nodes })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ targetNodeId: 'node:payments', targetName: 'payments-api', occurrences: 2 })
    expect(suggestions[0].confidence).toBeLessThan(1)
  })

  it('never proposes a relationship back to the source node itself', () => {
    const lines = ['calling http://orders-api.orders.svc.cluster.local/self']
    const suggestions = suggestGraphRelationships({ lines, sourceNode: nodes[0], nodes })
    expect(suggestions).toEqual([])
  })

  it('returns no suggestions without a source node', () => {
    expect(suggestGraphRelationships({ lines: ['x'], nodes })).toEqual([])
  })
})

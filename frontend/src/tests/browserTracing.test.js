// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:7190/"}
import { describe, expect, it, vi } from 'vitest'

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    constructor(options) { this.options = options }
    export(_spans, callback) { callback({ code: 0 }) }
    shutdown() { return Promise.resolve() }
  },
}))

import { startBrowserTracing } from '../lib/observability/browserTracing'

describe('browser distributed tracing', () => {
  it('propagates W3C traceparent to same-origin API calls and keeps the collector relay out of recursion', async () => {
    const sent = []
    globalThis.fetch = vi.fn(async (_input, init = {}) => {
      sent.push(new Headers(init.headers))
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const getConfig = vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, sampleRatio: 1, serviceName: 'checkout-ui' }) }))
    const configured = await startBrowserTracing({
      origin: 'http://localhost:7190',
      fetchImpl: getConfig,
    })
    expect(getConfig).toHaveBeenCalledOnce()
    expect(configured).toBe(true)
    await globalThis.fetch('/api/orders')
    await globalThis.fetch('/api/observability/otlp/browser/v1/traces')
    expect(String(sent[0].get('traceparent'))).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(sent[1].get('traceparent')).toBeNull()
  })
})

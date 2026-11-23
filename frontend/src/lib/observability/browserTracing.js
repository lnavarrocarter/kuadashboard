import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request'

const CONFIG_PATH = '/api/observability/otlp/browser/config'
const EXPORT_PATH = '/api/observability/otlp/browser/v1/traces'

export async function startBrowserTracing({ fetchImpl = globalThis.fetch, origin = globalThis.location?.origin } = {}) {
  if (typeof fetchImpl !== 'function' || !origin) return false
  let config
  const controller = new AbortController()
  const configTimeout = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await fetchImpl(CONFIG_PATH, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) return false
    config = await response.json()
  } catch {
    return false
  } finally {
    clearTimeout(configTimeout)
  }
  const sampleRatio = Number(config?.sampleRatio)
  if (!config?.enabled || !Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) return false

  const apiOrigin = new URL(origin).origin
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      'service.name': String(config.serviceName || 'kuadashboard-frontend').slice(0, 120),
      'service.namespace': 'kua',
      'service.version': import.meta.env.VITE_APP_VERSION || '2.0.0',
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: new URL(EXPORT_PATH, apiOrigin).toString() }),
      maxQueueSize: 256,
      maxExportBatchSize: 64,
      scheduledDelayMillis: 3_000,
      exportTimeoutMillis: 3_000,
    })],
  })
  provider.register({ propagator: new W3CTraceContextPropagator() })

  const ignoredTelemetryPaths = [/\/api\/observability\/otlp\/browser\/(?:config|v1\/traces)(?:\?|$)/]
  const apiOnlyPropagation = [new RegExp(`^${apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/api(?:\/|$)`)]
  registerInstrumentations({ instrumentations: [
    new FetchInstrumentation({ ignoreUrls: ignoredTelemetryPaths, propagateTraceHeaderCorsUrls: apiOnlyPropagation }),
    new XMLHttpRequestInstrumentation({ ignoreUrls: ignoredTelemetryPaths, propagateTraceHeaderCorsUrls: apiOnlyPropagation }),
    new DocumentLoadInstrumentation(),
  ] })
  return true
}


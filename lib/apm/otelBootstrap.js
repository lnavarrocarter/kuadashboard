'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadRuntimeEnv() {
  for (const filePath of [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../../config/runtime.env')]) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const entry = line.trim();
      if (!entry || entry.startsWith('#')) continue;
      const separator = entry.indexOf('=');
      if (separator <= 0) continue;
      const key = entry.slice(0, separator).trim();
      let value = entry.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function instrumentSqlite(tracer) {
  const { SpanKind } = require('@opentelemetry/api');
  const Database = require('better-sqlite3');
  const originalPrepare = Database.prototype.prepare;
  const methods = new Set(['run', 'get', 'all', 'iterate']);
  Database.prototype.prepare = function prepareWithTracing(sql, ...prepareArgs) {
    const statement = originalPrepare.call(this, sql, ...prepareArgs);
    // The ingestion database receives the spans produced by this process. Do
    // not trace its writes, which would create a telemetry feedback loop.
    if (String(this.name || '').endsWith(`${path.sep}apm-otlp.sqlite3`)) return statement;
    const firstWord = /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i.exec(String(sql))?.[1]?.toLowerCase() || 'other';
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!methods.has(property)) return value.bind(target);
        if (property === 'iterate') {
          return (...args) => {
            const span = tracer.startSpan(`sqlite ${firstWord}`, { kind: SpanKind.CLIENT, attributes: { 'db.system.name': 'sqlite', 'db.operation.name': firstWord } });
            try {
              const iterator = Reflect.apply(value, target, args);
              return (function* traceIteration() {
                try { yield* iterator; } catch (error) { span.setAttribute('error.type', error?.name || 'Error'); throw error; }
                finally { span.end(); }
              }());
            } catch (error) {
              span.setAttribute('error.type', error?.name || 'Error');
              span.end();
              throw error;
            }
          };
        }
        return (...args) => tracer.startActiveSpan(`sqlite ${firstWord}`, {
          kind: SpanKind.CLIENT,
          attributes: { 'db.system.name': 'sqlite', 'db.operation.name': firstWord },
        }, span => {
          try { return Reflect.apply(value, target, args); }
          catch (error) { span.setAttribute('error.type', error?.name || 'Error'); throw error; }
          finally { span.end(); }
        });
      },
    });
  };
}

function startOtel() {
  loadRuntimeEnv();
  if (process.env.KUA_OTEL_ENABLED !== '1') return { enabled: false, shutdown: async () => {} };

  const token = process.env.KUA_OTEL_AGENT_TOKEN || '';
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) throw new Error('KUA_OTEL_AGENT_TOKEN must be an enrolled OTLP agent token');
  const endpoint = process.env.KUA_OTEL_ENDPOINT || `http://127.0.0.1:${process.env.PORT || 7190}/api/observability/otlp`;
  const parsedEndpoint = new URL(endpoint);
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(parsedEndpoint.hostname);
  if (parsedEndpoint.protocol !== 'https:' && !loopback) throw new Error('KUA_OTEL_ENDPOINT must use HTTPS outside loopback');
  const sampleRatio = Number(process.env.KUA_OTEL_SAMPLE_RATIO || 0.1);
  if (!Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) throw new Error('KUA_OTEL_SAMPLE_RATIO must be between 0 and 1');

  process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = 'http/json';
  process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
  process.env.OTEL_TRACES_SAMPLER_ARG = String(sampleRatio);
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  const { MySQLInstrumentation } = require('@opentelemetry/instrumentation-mysql');
  const { MySQL2Instrumentation } = require('@opentelemetry/instrumentation-mysql2');
  const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
  const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
  const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
  const { KafkaJsInstrumentation } = require('@opentelemetry/instrumentation-kafkajs');
  const { AmqplibInstrumentation } = require('@opentelemetry/instrumentation-amqplib');
  const { KnexInstrumentation } = require('@opentelemetry/instrumentation-knex');
  const { TediousInstrumentation } = require('@opentelemetry/instrumentation-tedious');
  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    headers: { Authorization: `Bearer ${token}` },
  });
  const sdk = new NodeSDK({
    serviceName: process.env.KUA_OTEL_SERVICE_NAME || 'kuadashboard-api',
    spanProcessors: [new BatchSpanProcessor({ exporter: traceExporter,
      maxQueueSize: 1024,
      maxExportBatchSize: 64,
      scheduledDelayMillis: 3_000,
      exportTimeoutMillis: 5_000,
    })],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: request => String(request.url || '').startsWith('/api/observability/otlp'),
        ignoreOutgoingRequestHook: request => String(request.path || '').startsWith('/api/observability/otlp'),
      }),
      new UndiciInstrumentation({ ignoreRequestHook: request => String(request.path || '').startsWith('/api/observability/otlp') }),
      new PgInstrumentation(),
      new MySQLInstrumentation(),
      new MySQL2Instrumentation(),
      new MongoDBInstrumentation(),
      new RedisInstrumentation(),
      new IORedisInstrumentation(),
      new KafkaJsInstrumentation(),
      new AmqplibInstrumentation(),
      new KnexInstrumentation(),
      new TediousInstrumentation(),
    ],
  });
  sdk.start();
  instrumentSqlite(require('@opentelemetry/api').trace.getTracer('kua-sqlite'));
  return { enabled: true, shutdown: () => sdk.shutdown() };
}

module.exports = { startOtel };

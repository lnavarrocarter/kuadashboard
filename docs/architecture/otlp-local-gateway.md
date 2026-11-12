# OTLP agent and local observability gateway

The versioned agent contract is **1**. It accepts OTLP/HTTP JSON metrics (`POST /api/observability/otlp/v1/metrics`) and traces (`POST /api/observability/otlp/v1/traces`) and implements OTLP success responses as JSON `{}`. Metrics currently accept gauge and sum points. Traces preserve parent span ids and span links. Kua's own browser, Node.js and SQLite path now supports opt-in instrumentation and W3C context propagation; other services can export directly or through an OpenTelemetry Collector.

## Agent lifecycle

All endpoints are under `/api/observability/otlp`:

| Endpoint | Purpose |
| --- | --- |
| `POST /enrollment-token` | Issue a five-minute, single-use enrollment token. The response shows it once. Issuing another invalidates an unused token. |
| `POST /enroll` | Exchange `X-KUA-Enrollment-Token` for a random agent id and bearer token. Send `contractVersion`, `name`, `agentVersion`, and a non-empty `capabilities` list. Supported signals are `metrics` and `traces`; enrollment grants only those explicitly selected. |
| `GET /agents` | Show known agents, capabilities, last heartbeat and revocation state. Tokens are never returned. |
| `POST /agents/:id/heartbeat` | Authenticate with `Authorization: Bearer …` and report contract version, agent version and capabilities. A heartbeat cannot add capabilities that were not approved at enrollment. |
| `POST /agents/:id/rotate` | Replace the agent bearer token; the old token stops working immediately. The new token is returned once. |
| `DELETE /agents/:id` | Revoke the agent and delete its stored metric points, spans and links. |

The enrollment token and agent token are stored only as SHA-256 digests. The gateway database is `apm-otlp.sqlite3` in KUA's data directory and uses owner-only permissions. The gateway has its own database so installing this feature does not migrate or rewrite existing APM data.

## Metrics and limits

Resource identity uses a bounded allowlist of OpenTelemetry resource attributes, including `service.name`, `service.namespace`, `service.version`, `service.instance.id`, `host.id`, `host.name`, `deployment.environment.name`, `cloud.provider`, `cloud.region`, and Kubernetes cluster/namespace/workload names. `service.name` is required. Metric point attributes are bounded and filtered; keys that can carry credentials, user identity, request bodies, URLs or SQL are discarded. This is an allowlist policy, not a guarantee that arbitrary custom labels are safe.

Ingested points can be read locally with `GET /metrics?host=<agent-id>&service=<service-name>&from=<unix-ms>&to=<unix-ms>&limit=<n>`. `GET /health` reports point and series counts, last receipt, caps, retention and database size. Deleting `/metrics?host=<agent-id>` clears that host's data without revoking its agent token. Revoke the agent separately when it should stop sending.

`DELETE /traces?host=<agent-id>` removes that agent's stored spans and span links. `DELETE /agents/:id` also removes them while revoking the sender.

Defaults are seven days, 5,000 distinct series, 1,000,000 stored metric points, 500,000 spans and 120 ingestion requests per agent per minute. A trace is limited to 5,000 spans and a projection to 20,000 links. Operators can set `KUA_OTLP_RETENTION_DAYS`, `KUA_OTLP_MAX_SERIES`, `KUA_OTLP_MAX_POINTS`, `KUA_OTLP_MAX_SPANS`, and `KUA_OTLP_REQUESTS_PER_MINUTE`. The request body is limited to 256 KiB, 500 metric descriptors, 1,000 points or 1,000 spans (with at most 32 links per span). Exceeding rate, cardinality or storage limits responds with `429` and `Retry-After`; an oversized body responds with `413`. SQLite commits are synchronous, so there is no unbounded in-memory queue. A retry of the same series/timestamp or trace/span id updates the existing record, making exporter retries idempotent.

## Network boundary and evidence

KUA binds to loopback by default. The standard KUA HTTP listener remains for local use. To accept remote agents, configure `KUA_OTLP_TLS_CERT_FILE` and `KUA_OTLP_TLS_KEY_FILE` together; this starts a separate HTTPS listener (default `127.0.0.1:7443`, configurable with `KUA_OTLP_TLS_HOST` and `KUA_OTLP_TLS_PORT`, TLS 1.2 minimum). Bind it to a reachable interface only behind a firewall or private network. This listener exposes only `POST /api/observability/otlp/v1/metrics` and `/v1/traces`; it does not expose enrollment, administration, health, KUA APIs, or the frontend. Each ingest request still requires the agent bearer token. Create the one-time enrollment token through KUA's local interface, enroll the agent locally, then configure its token and HTTPS endpoint. Remote plaintext is rejected. Never send an agent token over plaintext or reuse a cloud-provider credential as an agent credential.

Trace spans are read with `GET /traces/:traceId/architecture?projectId=<id>` and the matching `X-Profile-Id`. Exact resource ids are preferred for matching spans to graph nodes; a unique `service.name` match is the fallback. Ambiguous and missing matches remain explicit. For each observed parent/child span pair or same-trace span link, the projection may include a unique shortest path through confirmed Architecture edges. Those intermediate nodes and edges carry `observedSpan: false` and source references; this is configuration/inventory evidence, not proof that each component handled that request. Suggested/rejected edges are excluded. Missing or ambiguous paths remain partial/unknown. Span names are normalized to operation categories; SQL text, events, status messages and non-allowlisted attributes are not stored.

Metric and span resources preserve their agent and service identity as observation evidence. The trace view distinguishes spans from load balancer, DNS, proxy, queue, cache, database, and other inventory/configuration evidence. A load balancer without instrumentation is a topology hop with provenance, never a fabricated span. Missing or contradictory hops remain partial/unknown.

## Kua browser → API → database tracing

Tracing is opt-in. Enroll an agent locally with `traces` capability, keep its bearer token in the backend environment (never in Vite variables or browser storage), then set:

1. `POST http://127.0.0.1:<KUA-port>/api/observability/otlp/enrollment-token` and copy the one-use `token` from the response.
2. `POST /api/observability/otlp/enroll` with `X-KUA-Enrollment-Token` and JSON `{"contractVersion":1,"name":"Kua Dashboard API","agentVersion":"2.1.0","capabilities":["traces"]}`. Store the returned agent `token` as a backend secret.
3. Restart Kua with the environment below. This token authorizes the Kua Node process only; it is never returned by browser configuration.

```sh
KUA_OTEL_ENABLED=1
KUA_OTEL_AGENT_TOKEN=<enrolled-agent-token>
KUA_OTEL_ENDPOINT=http://127.0.0.1:7190/api/observability/otlp
KUA_OTEL_SERVICE_NAME=checkout-api
KUA_OTEL_SAMPLE_RATIO=0.1
KUA_OTEL_BROWSER_ENABLED=1
KUA_OTEL_BROWSER_SERVICE_NAME=checkout-web
KUA_OTEL_BROWSER_SAMPLE_RATIO=0.1
```

The endpoint defaults to this Kua instance on loopback. Remote endpoints must use HTTPS. For a remote gateway, configure its TLS listener and point `KUA_OTEL_ENDPOINT` to `https://<private-gateway>:7443/api/observability/otlp`. Agent tokens belong in a permission-restricted backend environment file or secret store.

The frontend reads only the non-secret browser tracing flag, service name and sampling ratio from `/browser/config`. It instruments document load, Fetch and XMLHttpRequest, and injects W3C `traceparent` only into `/api` calls. Batches go to the same-origin browser relay. The relay requires an `Origin` whose host matches the request host and `Sec-Fetch-Site: same-origin`, caps requests, sanitizes attributes and applies gateway retention/rate limits. It uses an internal identity; no agent token or enrollment endpoint reaches the browser. Collector export requests are excluded from frontend tracing to prevent recursion.

Node starts its SDK before Express and other application modules load. A curated set of HTTP, gRPC (`@grpc/grpc-js`), Undici, PostgreSQL, MySQL, MongoDB, Redis, Kafka, AMQP and SQL Server instrumentations creates request and client spans and propagates W3C context on instrumented requests. Kua adds explicit `better-sqlite3` spans with operation/system attributes only; SQL text, parameter values, file paths and database credentials are never recorded. SDK export is batched to fit the gateway request cap. The OTLP receiver itself and the outbound exporter are excluded from tracing so ingestion does not recursively generate telemetry.

Use `KUA_OTEL_SERVICE_NAME` and `KUA_OTEL_BROWSER_SERVICE_NAME` values that uniquely match the corresponding service nodes in the selected Architecture graph. Add the database host/IP in the Architecture resource's optional **Endpoint** field, or ensure discovery exposes a matching endpoint. For database client spans, Kua retains a validated `server.address` and optional `server.port` for matching against that inventory. The UI labels this as an observed client call; it does not claim a database-side span. Query text and parameter values are discarded. If the endpoint is missing, ambiguous or not present in the graph, the trace remains partial.

## Google Cloud runtimes and client libraries

When `KUA_OTEL_ENABLED=1`, Kua also enables Google's opt-in Node.js client-library tracing unless `GOOGLE_SDK_NODE_ENABLE_TRACING=false` is explicitly set. The resource detector uses only explicit runtime variables: project, region, Cloud Run/Functions service and revision, and GKE cluster when `GKE_CLUSTER_NAME` is provided. Those identities can map to matching Cloud Run, Functions or GKE nodes in Architecture; the caller's identity is not mistaken for the API target. Kua does not query the GCP metadata server, so Compute Engine instance identity is not currently mapped automatically. Kua's resource allowlist drops arbitrary Google client attributes such as resource names, full URLs and error text. Google's SDK tracing is documented as disabled by default and as producing logical request and RPC-attempt spans; inspect exported data and sampling before enabling it in a workload.

For the GCP services Kua catalogs, coverage depends on where code runs and which client it uses:

| GCP service | What can be observed | Coverage limit |
| --- | --- | --- |
| Cloud Run and Cloud Functions | HTTP server spans from the workload runtime; runtime variables map service, revision and region. Google client libraries add child RPC spans. | Each service process must run an instrumented Node.js SDK or an OTLP Collector. A control-plane inventory entry alone creates no request spans. |
| GKE | gRPC/HTTP spans and cluster identity when `GKE_CLUSTER_NAME` is explicitly set. | The Kua Architecture graph needs the cluster and matching Kubernetes workload nodes; Kua does not query metadata or instrument other containers. |
| Cloud SQL | PostgreSQL/MySQL client spans; discovered Cloud SQL IPs can match the observed `server.address`. | A Cloud SQL connector or proxy may expose only a local socket/address. That stays partial until the remote database identity is explicitly correlated; client spans do not prove server query execution. |
| Pub/Sub, Cloud Tasks, Scheduler and Workflows | Client API/RPC spans from instrumented Google Cloud Node.js clients. Architecture inventory links Pub/Sub subscriptions to topics, configured push endpoints to an exact Cloud Run URI, and Scheduler HTTP/Pub/Sub targets when their destination is uniquely identified. | These are configuration links, not proof of execution. Kua does not inspect Cloud Tasks payloads or Workflows source for job-level targets. API-call spans do not prove producer-to-consumer execution; propagate W3C context in message/task metadata or report span links. Kua never fabricates a consumer span. |
| Cloud Storage, Firestore, BigQuery and Memorystore | Client spans when a supported instrumented client is called inside an active trace. | These are per-call observations. The corresponding resource must have a unique identity in the Architecture graph; inventory by itself is not runtime telemetry. |
| Cloud load balancers and ingress | External GCP forwarding rules and backend services are imported into Architecture. When a backend service points to a serverless NEG, its configured Cloud Run or Cloud Function target is linked as inventory evidence. Traces can match an observed client endpoint to the forwarding rule address. | Instance group, internet NEG and other non-serverless backends remain partial until their members resolve to catalog resources. GCP ingress and private forwarding rules are not inferred from public endpoint scans. Inventory links remain explicitly unobserved topology. |

For Node apps on GCP, install the matching SDK/instrumentation in the workload itself, initialize it before service modules, enroll a dedicated agent with only `traces`, and point its exporter at the private Kua gateway. `GOOGLE_SDK_NODE_ENABLE_TRACING=true` enables Google client-library spans in that process. Use `service.name` plus GCP resource identity and ensure Cloud Run/Functions/GKE nodes are present in the selected Architecture graph. Cloud SDK client spans may contain sensitive resource identifiers, URLs or errors; Kua's allowlist removes those free-form attributes before storage. For non-Node workloads, use the local Collector recipe below and the language instrumentation for that runtime.

## Other services, databases and queues

For services that can export OTLP/HTTP JSON directly, enroll one agent per workload boundary with only the required signal capabilities. Configure the SDK with `http/json`, the `/api/observability/otlp` base endpoint, and `Authorization: Bearer <agent-token>`. Bind agents to the W3C Trace Context propagator so inbound and outbound HTTP calls retain the same trace. Instrument database clients and message producers/consumers in their process; async producers should propagate trace context in message headers or create span links. Do not add message bodies, SQL, credentials, request URLs or user identifiers as attributes.

For languages or exporters that use OTLP Protobuf, run a local OpenTelemetry Collector beside the workload and re-export as JSON. Its receiver should bind only to loopback or the pod network. Keep the gateway bearer token in the collector's secret environment, and limit the export queue and retry window:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:4317
      http:
        endpoint: 127.0.0.1:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 128
  batch:
    send_batch_size: 64
    timeout: 5s

exporters:
  otlp_http/kua:
    endpoint: https://<private-gateway>:7443/api/observability/otlp
    encoding: json
    headers:
      Authorization: "Bearer ${env:KUA_OTEL_AGENT_TOKEN}"
    timeout: 10s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 5m
    sending_queue:
      enabled: true
      queue_size: 256
      num_consumers: 1

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/kua]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/kua]
```

Workload SDKs send to the local Collector with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` or its pod-local equivalent and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`. Limit/retain only the signals and attributes needed for the architecture. This gateway accepts traces and metrics; logs ingestion is not part of contract 1.

Database client spans prove the application attempted a database operation and can identify a unique endpoint. They do not prove server-side query execution. A database-side span is shown only when that database engine or its managed tracing integration independently emits it. ELBs, DNS, caches, proxies and managed services that do not emit compatible spans remain explicitly marked as inventory evidence. Coverage is partial until every needed component has instrumentation and a unique Architecture identity. OpenTelemetry JavaScript browser instrumentation is experimental and should be rolled out with sampling and privacy controls.

OTLP/HTTP JSON field casing and timestamp encoding follow the [OpenTelemetry OTLP specification](https://opentelemetry.io/docs/specs/otlp/). This first receiver supports a subset of metric data point types and span fields; it is not yet a complete OTLP implementation.

OpenTelemetry references: [JavaScript Node.js setup](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/), [browser setup and its experimental status](https://opentelemetry.io/docs/languages/js/getting-started/browser/), [JS context propagation](https://opentelemetry.io/docs/languages/js/propagation/), [gRPC instrumentation](https://www.npmjs.com/package/@opentelemetry/instrumentation-grpc), [Google Cloud Node.js client-library telemetry](https://docs.cloud.google.com/nodejs/docs/observability), and the official [Collector OTLP HTTP JSON exporter configuration](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/README.md).

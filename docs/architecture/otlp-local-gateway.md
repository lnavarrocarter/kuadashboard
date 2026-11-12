# OTLP agent and local observability gateway

This is the first ingestion slice for the architecture-wide observability work. The versioned agent contract is **1**. It accepts OTLP/HTTP JSON metrics (`POST /api/observability/otlp/v1/metrics`) and traces (`POST /api/observability/otlp/v1/traces`) and implements OTLP success responses as JSON `{}`. Metrics currently accept gauge and sum points. Traces preserve parent span ids and span links. Browser/Node.js instrumentation, W3C propagation setup and automatic end-to-end coverage remain a later slice.

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

KUA binds to loopback by default. The agent gateway accepts loopback traffic or a directly encrypted TLS socket; remote plaintext is rejected. The standard KUA server currently uses HTTP, so remote agent deployment requires a TLS-capable entry point before agents are pointed at it. Never send an agent token over plaintext or reuse a cloud-provider credential as an agent credential.

Trace spans are read with `GET /traces/:traceId/architecture?projectId=<id>` and the matching `X-Profile-Id`. Exact resource ids are preferred for matching spans to graph nodes; a unique `service.name` match is the fallback. Ambiguous and missing matches remain explicit. For each observed parent/child span pair or same-trace span link, the projection may include a unique shortest path through confirmed Architecture edges. Those intermediate nodes and edges carry `observedSpan: false` and source references; this is configuration/inventory evidence, not proof that each component handled that request. Suggested/rejected edges are excluded. Missing or ambiguous paths remain partial/unknown. Span names are normalized to operation categories; SQL text, events, status messages and non-allowlisted attributes are not stored.

Metric and span resources preserve their agent and service identity as observation evidence. The gateway does not yet automatically instrument browsers, Node.js services, databases or queues. Future UI views must distinguish observed spans from load balancer, DNS, proxy, queue, cache, database, and other inventory/configuration evidence. A load balancer without instrumentation is a topology hop with provenance, never a fabricated span. Missing or contradictory hops remain partial/unknown.

OTLP/HTTP JSON field casing and timestamp encoding follow the [OpenTelemetry OTLP specification](https://opentelemetry.io/docs/specs/otlp/). This first receiver supports a subset of metric data point types and span fields; it is not yet a complete OTLP implementation.

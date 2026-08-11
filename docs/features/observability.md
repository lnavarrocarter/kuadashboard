# Local Application Observability

KuaDashboard includes a provider-scoped local APM view under **Observability > AWS/GCP/Vercel > Applications**. It groups explicitly confirmed cloud resources and Kubernetes workloads into applications without installing an agent or creating cloud resources.

**Observability > General > Applications** does not require a cloud provider or credential profile. Use it for Kubernetes-only applications spanning any kubeconfig context. Choosing AWS, GCP, or Vercel remains optional and enables that provider's inventory during setup.

The **Topology** tab evaluates each application locally. It reports structural score, connected coverage, isolated resources, generic relationships, and explainable dependency suggestions. Suggestions use resource names, compatible types, and Kubernetes scope as evidence; they are never persisted as causal dependencies until you confirm them. For Step Functions and Lambda, inspect ASL definitions, traces, or correlated logs before confirming execution links.

For AWS applications, **Analyze AWS definitions** reads the ASL definition of associated Step Functions on demand. Direct Lambda calls, nested workflows, SQS sends, and ECS tasks become 100%-confidence suggestions when the referenced resource already belongs to the application. References outside APM are grouped so you can explicitly add the resource, run the analysis again, and confirm the resulting dependency. Definitions and runtime parameters are never persisted.

The **Traces** tab performs an explicit, read-only process lookup. Enter a request/correlation ID to inspect up to 10 recent executions from each associated Step Function, enter a known execution ARN, or enter an associated Step Function ARN to trace its latest execution. Step Functions history provides the ordered process spine and highlights Lambda, ECS, S3, and nested workflow events. By default, KUA returns matching JSON paths and the input structure while hiding input/output values and requesting execution history without event payloads. Trace data is not persisted. Each Step Functions API call consumes the local AWS request budget.

Enable **Show sanitized request/response** to inspect execution-level and per-step inputs, parameters, outputs, errors, and causes. This option asks AWS for execution data only for the current explicit trace. KUA redacts common credential and personal-data fields, truncates large structures, and does not persist the returned values. Pasting a Step Function ARN also shows up to 10 recent executions so a specific run can be selected.

## Data Sources

- **Lambda**: KUA reads CloudWatch Logs with `FilterLogEvents` and extracts aggregates from Lambda `REPORT` lines. A collection cycle reads at most two pages of 500 events per enabled function.
- **Kubernetes**: KUA reads CPU and memory from `metrics.k8s.io` with an isolated kubeconfig context. Metrics already loaded by another KUA view can be captured opportunistically without another request.
- **GCP topology**: Cloud Run services and Cloud Functions can be associated with GCP applications. GKE contexts are detected from kubeconfig and their workloads use the Kubernetes collector.
- **Vercel topology**: Vercel Projects can be associated with Vercel applications. Because Vercel does not provide a managed Kubernetes service, linking a Kubernetes context is always explicit.
- **Platform metrics**: GCP and Vercel platform resources are topology-only until a provider-specific metric collector is enabled. KUA does not present inventory state as an APM metric.
- **Buckets**: measurements are reduced to 30-minute UTC buckets containing only `count`, `sum`, `min`, `max`, and `last` values.

KUA does not persist raw log lines, request or response payloads, credentials, secrets, environment variables, or arbitrary resource tags in the APM database.

## Applications and Correlation

Applications, resource membership, and dependency edges are local records. Membership and dependencies have different meanings:

- A tag or label can identify application membership.
- Name similarity is only a suggestion.
- Candidate analysis receives the inventory already loaded in the UI and performs zero AWS or Kubernetes reads.
- A resource is associated only after its checkbox is confirmed.
- A dependency is stored only after explicit manual confirmation. Membership never creates a dependency.

Candidate analysis is manual and is never run by the 30-minute scheduler.

## Collection and Cost Controls

Polling is disabled by default. When enabled, it runs every 30 minutes without overlapping runs or catch-up requests. Manual collection shows a confirmation before reading cloud data.

KUA reserves APM-initiated AWS requests against a local limit of **100,000 requests per profile per UTC month** before making them. The limit is a guardrail, not a billing guarantee: CloudWatch Logs reads can still be billable under the AWS account's pricing and free-tier status. GCP/Vercel topology reads, Kubernetes reads, and opportunistic capture do not consume the AWS ledger.

KUA never invokes a Lambda, modifies a workload, creates a metric, or provisions an AWS resource as part of APM collection.

## Thresholds

Each application has local thresholds for observed error rate, average Lambda duration, ready pod percentage, and restart delta. Signals can be disabled independently. Health is `unknown` until at least one enabled threshold has data, `healthy` when all evaluated values pass, and `degraded` when any value breaches its threshold.

Threshold evaluation uses only stored aggregates and does not initiate cloud requests.

## Retention and Local Storage

Metric buckets, collection cursors, and collection runs are retained for **90 days**. The AWS request ledger is retained for 15 months so UTC monthly limits remain auditable. Cleanup runs locally once per day.

The SQLite file is named `apm-observability.sqlite3`:

- Electron stores it in the operating system's KUA user-data directory.
- Web/server mode stores it in `~/.kuadashboard/` by default.
- `KUA_DATA_DIR` overrides the directory.

The directory is created with mode `0700` and the database with mode `0600` on systems that support POSIX permissions. SQLite uses WAL mode.

## Backup and Deletion

Close KUA before copying or restoring `apm-observability.sqlite3`. This lets SQLite close its WAL cleanly; copying only the main file while KUA is running can produce an incomplete backup.

Deleting an application removes its local resources, dependencies, metrics, cursors, and collection runs through SQLite cascade rules. To erase all APM history, close KUA and delete `apm-observability.sqlite3` plus any matching `-wal` and `-shm` files. KUA recreates an empty database on the next start. This does not delete cloud resources or credential profiles.

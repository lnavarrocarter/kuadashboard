# Local Application Observability

KuaDashboard includes a local APM view under **Observability > Applications**. It groups confirmed AWS Lambda functions and Kubernetes workloads into applications without installing an agent or creating cloud resources.

## Data Sources

- **Lambda**: KUA reads CloudWatch Logs with `FilterLogEvents` and extracts aggregates from Lambda `REPORT` lines. A collection cycle reads at most two pages of 500 events per enabled function.
- **Kubernetes**: KUA reads CPU and memory from `metrics.k8s.io` with an isolated kubeconfig context. Metrics already loaded by another KUA view can be captured opportunistically without another request.
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

KUA reserves APM-initiated AWS requests against a local limit of **100,000 requests per profile per UTC month** before making them. The limit is a guardrail, not a billing guarantee: CloudWatch Logs reads can still be billable under the AWS account's pricing and free-tier status. Kubernetes reads and opportunistic capture do not consume the AWS ledger.

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

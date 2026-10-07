# Desktop Background Task Isolation Evaluation

**Status:** Keep current Node.js execution model. Do not add workers, child processes, or Rust for scheduled tasks yet.
**Date:** 2026-10-07

## Decision

The profiled log-scan page is bounded and does not currently justify moving work out of the backend process. Scheduled APM collection, log refresh, application/team sync, and Advisor runs are dominated by network and database awaits. The scan path has a synchronous transform, but its measured event-loop delay stays below the proposed backend responsiveness threshold on this machine.

This is a local macOS result, not a cross-platform or packaged-Electron benchmark. The renderer's frame time was not measured. Revisit the decision if production reports UI stalls or the gates below fail on representative Windows, macOS, or Linux systems.

## Workloads

| Task | Dominant path | Classification |
| --- | --- | --- |
| APM collection | `ApmScheduler.runScheduled` awaits collectors per resource; collectors call provider APIs and persist results | I/O-bound |
| Automatic log refresh | `createAutoRefresh.tick` reads provider pages and ingests them into the local cache | I/O-bound with bounded local transforms |
| Log scans | `createScanRunner.runScan` waits for FilterLogEvents pages, then sanitizes, deduplicates, analyzes, seals, and persists each page | I/O-bound; measured candidate |
| Application/team sync | `pass()` hashes local bundles and contacts the account service only when content changed | Mostly I/O-bound; local hash cost depends on bundle size |
| Scheduled Advisor | `tick()` calls KUA routes sequentially for due scopes | I/O-bound |

Local embedding analysis is on-demand, not one of these scheduled tasks. Profile it separately before making it a background workload.

## Reproducible Profile

Run from the repository root:

```sh
node scripts/profile-background-tasks.js
```

The script uses the production `createScanRunner` and `createLogCache`, a temporary on-disk SQLite database, a synthetic client, and no credentials or network. It warms up with 100 events, then runs ten pages of 5,000 distinct events (about 1.01 MB of JSON per page). The measurements below were taken on Node v23.4.0, macOS arm64, on 2026-10-07.

| Measurement | Median | p95 |
| --- | ---: | ---: |
| Page wall time | 41.58 ms | 45.96 ms |
| Process CPU time per page | 50.21 ms | 81.51 ms |
| Event-loop delay p99, across runs | 27.77 ms | 29.21 ms |

Process RSS high-water mark grew from 54.48 MB before the ten measured pages to 120.95 MB after them, about 66.47 MB for the whole stress run. This is process-wide memory while 50,000 distinct events remain in ten synthetic groups; it is not memory attributable to one task. Process CPU can exceed wall time because asynchronous Brotli compression uses libuv's thread pool. A V8 profile of the main thread showed sanitizer regular expressions and event hashing among the sampled JavaScript work; Brotli compression is asynchronous.

The event-loop metric is a backend responsiveness proxy. It does not establish renderer frame impact, and synthetic pages omit network latency, platform-specific SQLite behavior, and Electron packaging.

## Reopen Gates

Prototype isolation only if a realistic, reproducible workload crosses one of these gates on a supported platform:

- A 1 MB page has p95 wall time above 100 ms, or p95 event-loop delay above 50 ms / a repeated maximum above 100 ms.
- Process CPU exceeds 100 ms per page at p95, or stays above 50% of one core for at least one second during normal background use.
- Process RSS high-water growth exceeds 128 MB over ten representative pages after warm-up. This remains a process-level gate, not per-task attribution.
- A renderer performance trace shows repeated long tasks above 50 ms correlated with backend work.

## Isolation Trade-offs If a Gate Fails

No worker-versus-process prototype was warranted by the current profile. If a gate fails, benchmark the same pure transform and payload in-process, in a reusable `worker_threads` worker, and in a child process; include startup, 1 MB IPC round-trip, peak process RSS, event-loop delay, cancellation latency, and packaged builds.

| Option | Benefits | Costs and cancellation |
| --- | --- | --- |
| `worker_threads` | Keeps the same application process; structured clone or transferable buffers can move pure CPU transforms | Does not isolate process failure or RSS; SQLite handles stay in the owning thread. Prefer cooperative cancellation at page/batch boundaries. `Worker.terminate()` is a hard stop and does not promise arbitrary cleanup. |
| Child process | Separate failure and memory boundary; can be restarted independently | More startup/RSS and serialized IPC. Use an explicit shutdown message, a bounded grace period, then platform-tested termination; do not promise graceful completion after a forced kill. |
| Rust executable/addon | Could help only if profiles show a transform that remains CPU-heavy after batching and algorithmic improvements | Adds native build, signing, and distribution matrices for Windows/macOS/Linux. No evidence currently supports that cost. |

Any prototype must keep cancellation cooperative between bounded batches, keep SQLite writes in their owning process, cap queued payload bytes, and validate ASAR/resource paths plus Windows, macOS, and Linux packaging. Do not claim exact per-task memory attribution in a shared process.

# Changelog

## Unreleased

Continues the KUA Application convergence plan (Phases 9-16): persistent Architecture context, node-level navigation, Canvas health overlays, a canonical shared Resources view, fewer surprise graph revisions, visible sync diagnostics, shared Canvas/Routes filters, and deterministic log-based relationship suggestions. Also fixes a real duplication bug found while validating this work.

### Fix: Kubernetes resources duplicated between Architecture and Observability

- An AWS-hosted Kubernetes application (e.g. EKS) stores `aws` as the resource provider for its workloads, while Architecture's Kubernetes adapter always used `kubernetes`. The shared registry treated those as two different resources, so the same Deployment could appear twice — once from APM, once from Architecture — in the Observability resources table and the registry.
- Kubernetes discovery nodes now carry a stable `context/namespace/kind/name` key (matching the key APM already uses for manual and EKS-discovered workloads), and every place that turns an APM resource into a graph node or vice versa now normalizes the provider to `kubernetes` instead of trusting the application's hosting cloud.
- Existing duplicates self-heal the next time the shared registry reconciles (automatic collection, a manual reconciliation, or any Architecture/APM resource change) — no manual data migration is required.
- Generalized the fix into a reusable rule: a resource's provider is now always derived from what the resource actually is (`resourceOwnProvider` in applicationRegistryService.js), never inherited from its parent application's hosting cloud, for both APM→Architecture and Architecture→APM projections.

### Architecture Phase 9: application context persistence

- The active KUA Application context (application, project, provider and profile) now persists to local storage and is restored on reload, so a window reload no longer loses the selected Architecture application.
- The Architecture profile no longer forces the global AWS profile selector when an application already has its own profile scope (e.g. a Kubernetes-only application), only falling back to it when no application context is active.

### Architecture Phase 10: node-level navigation

- Canvas node inspector now exposes contextual navigation actions: Kubernetes workloads/Pods can open their logs, YAML/metrics detail (reusing the existing Kubernetes detail panel) and owned Pods list; AWS Lambda, EC2, EventBridge and Step Functions nodes can open Lambda logs or jump straight to the matching AWS view tab filtered by name.
- Unsupported resource types show no navigation section instead of a broken or empty action.

### Architecture Phase 11: Canvas health overlay

- The Canvas gained an opt-in "Health" toggle that shows a small badge on each node: degraded/healthy for Kubernetes workloads and Services using the health already captured during discovery, and a stale badge for resources missing from the last sync.
- The overlay preference persists with the rest of the canvas view and does not change the diagram layout, keeping dense diagrams readable when disabled.

### Architecture Phase 12: canonical Resources view

- Architecture gained a "Resources" tab that lists the shared registry for the linked KUA Application: provider, resource type, scope/location, confirming sources (APM, Architecture, or both) and relationship count.
- Resources confirmed from only one side (APM or Architecture) are flagged as a single-source divergence instead of being silently merged.
- Operational status reuses the Phase 11 health/staleness signal already available on the Architecture graph node, with no new telemetry pipeline.
- The shared registry endpoint (`GET /apm/applications/:id/registry`) now reports which sources confirmed each resource.

### Architecture Phase 13: fewer surprise revisions from shared registry reconciliation

- Reconciling the shared registry after an Architecture operation could previously create up to two additional graph revisions on top of the user's own save (one for projecting missing APM resources into the graph, another for stamping registry correlation ids). Both mutations are now merged into a single working document and saved at most once, so one user action now produces at most one derived reconciliation revision instead of up to two.

### Architecture Phase 14: visible shared registry sync diagnostics

- Every shared registry reconciliation (manual or automatic) now persists a diagnostic: last successful sync time and duration, last error, and how many resources/relationships are confirmed from only one side (APM or Architecture).
- The Observability application view shows this diagnostic as a persistent status strip instead of a one-off toast, with a "Retry sync" action that reuses the existing reconcile endpoint.
- A failed sync no longer erases the last known good sync time or divergence counts.

### Architecture Phase 15: Routes owns its own provider/context/namespace filters

- Routes already respected the Canvas's persisted provider/context/namespace filters, but only Canvas could change them. Routes now has the same filter controls in its own toolbar, writing to the same shared view state, so switching to Canvas is no longer required to narrow down routes.

### Architecture Phase 16: deterministic log-based relationship suggestions

- Kubernetes workload/Pod nodes gained a "Suggest relationships from logs" action that scans the already-open log stream for internal DNS references (`service.namespace.svc.cluster.local`) and proposes `calls` edges to matching Kubernetes nodes in the same diagram.
- Extraction is fully deterministic (no ML) and sanitized before anything is kept as evidence: common secret-shaped substrings (Authorization headers, tokens, API keys, passwords) are redacted first, and only a short sample plus an occurrence count are stored, never full raw log payloads.
- Every suggestion is added with `status: suggested` and a confidence below 1, going through the same accept/reject relationship review already used for automatic discovery — nothing is added to the graph without explicit human confirmation.
- The underlying extraction library also groups recurring error signatures and collects distinct correlation/request/trace ids for future phases, without persisting or displaying raw log content beyond the existing terminal view.

## v1.14.1 (2026-08-26)

### Reconciliación de recursos AWS heredados

- La reconciliación de Architecture ya no falla cuando un nodo AWS legado no incluye `provider`; usa el provider de la KUA Application enlazada.
- Los nodos AWS con ARN recuperan automáticamente cuenta y región para compartir una identidad única con el recurso APM, evitando duplicados en el registro.
- Los nodos incompletos no proyectables se omiten de forma segura y se agregó una prueba de regresión para aplicaciones serverless como `syn agent-call`.

## v1.14.0 (2026-08-26)

### Shared resources and AWS topology analysis

- AWS topology analysis now isolates AWS resources and relationships from mixed Kubernetes memberships, while preserving the complete mixed application in the returned topology.
- AWS resource matching is null-safe and CloudFormation/SAM serverless functions and state machines retain their Lambda/Step Functions semantics.
- Architecture discovery derives the AWS account from preview resources when the selected scope does not provide it.
- Linked applications now reconcile observable resources in both directions: APM additions appear in an existing Architecture view, and Architecture AWS/Kubernetes/GCP/Vercel-compatible nodes become APM resources without duplicates.
- Kubernetes resource providers are persisted explicitly where needed, and Architecture-projected memberships are removed when their source node is removed.
- Added regression coverage for mixed AWS/Kubernetes analysis, bidirectional projection, serverless normalization and schema migration to v1.14.

## v1.13.0 (2026-08-26)

### Application-first Architecture workspace

- Architecture now loads and presents the KUA Application catalog before profile-scoped projects, selecting the active application and limiting its architecture views to that application.
- The Architecture workspace now exposes application identity, provider, environment, team, active scopes and link status together with the diagram revision.
- Creating or refreshing an Architecture view preserves the selected `applicationId`; legacy unlinked projects remain available as a compatibility path.

## v1.12.0 (2026-08-26)

### KUA Application shell hardening

- Architecture now accepts an application context, scopes project loading to the linked KUA Application and binds new projects to that application.
- Architecture and Observability expose reversible navigation for generic Kubernetes applications as well as cloud providers, with a shared shell context showing application identity, environment and team.
- Registry reconciliation now runs after project deletion, unlinking, snapshot restores and other graph mutations, pruning stale architecture memberships and relationships.
- Legacy Kubernetes graph nodes are normalized from their native `kind`, so existing `Deployment`, `Service`, `Pod` and related nodes no longer render as generic clusters.
- Persisted provider, context and namespace filters now apply to both Canvas and Routes, and the GitHub control uses the bundled SVG icon without Lucide warnings.

### Architecture Phase 8: Kubernetes Adapter Foundation (2026-08-26)

- The Routes view is now provider-neutral: it retains APL event/workflow paths and adds **Microservice** paths for Kubernetes `Ingress -> Service -> Pod` flows and their declared configuration or storage dependencies.
- Kubernetes route evidence remains declared and explainable. Future high-frequency log analysis will produce privacy-bounded observed suggestions for review, never automatic relationships from raw log text.
- Kubernetes Architecture preview now accepts one or more namespace filters and groups selectable resources by type, with per-group selection for workloads, Pods, Services, Ingress, ConfigMaps, Secrets and persistent volumes.
- Kubernetes diagrams now use a dedicated cluster visual treatment and distinct icons for workloads, Pods, Services, Ingress, ConfigMaps, Secrets and persistent volume claims.
- Kubernetes discovery includes Services and Ingress routing, plus only the ConfigMaps, Secrets and PVCs explicitly referenced by workload environment or volume declarations; these dependencies are drawn with evidence-backed `uses` relationships.
- Architecture now supports explicit manual resources alongside discovery: add EC2 instances or any AWS component, plus Kubernetes, GCP or Vercel resources, with provider, stable native identity, scope and location recorded in the graph.
- Architecture now uses one **Add resources** menu instead of an AWS-only action: AWS and Kubernetes previews/imports are available today, while GCP and Vercel are visible as planned provider adapters.
- Kubernetes Architecture discovery lists contexts, previews one explicitly selected context with health and relationship evidence, then imports only confirmed resources and their internal relationships in one graph revision.
- Applications with confirmed Kubernetes resources now refresh their scoped topology preview automatically after loading, querying only their configured contexts; opening the preview reuses that result.
- Creating an Architecture view from Observability now seeds the new diagram with the application's confirmed resources and dependencies instead of opening an empty graph.
- Kubernetes Observability now falls back to a discovered in-cluster Prometheus Service for aggregated Pod CPU and memory usage when `metrics.k8s.io` is unavailable, while retaining stable restart cursors across sources.
- Pod readiness, totals and restart signals now remain complete when `metrics.k8s.io` is unavailable; Observability explicitly identifies only CPU and memory usage as unavailable.
- Observability now derives KPIs, charts, cloud analysis and trace controls from confirmed application resource capabilities, so Kubernetes-only applications do not show Lambda signals or AWS-only analysis.
- Configured Kubernetes Pods, Deployments, StatefulSets and DaemonSets now expose their existing live log stream directly from Observability, switching to the associated Kubernetes context before resolving workload Pods.
- Observability setup now loads compatible Kubernetes clusters before workload discovery and queries only the explicitly selected EKS cluster, with separate cluster and workload loading states.
- The setup flow treats Kubernetes as an explicit application scope, reusing provider-aware context selection that can support GKE and general Kubernetes connections without changing confirmed membership rules.
- Kubernetes topology preview now lists compatible clusters first and requires selecting one before querying workloads, Services, Ingress and events, avoiding unnecessary multi-cluster scans.
- Added visible loading feedback while KUA lists clusters and while it reads the selected cluster's Kubernetes resources.
- Added a read-only Kubernetes topology adapter with stable context/namespace/UID identities for workloads, pods, Services and Ingress resources.
- Kubernetes previews now provide declared selector and Ingress evidence, workload/pod health signals, warning-event summaries and per-context capability metadata that degrades safely when APIs are unavailable.

### Architecture Phase 6 Foundation (2026-08-26)

- Added a provider-neutral shared registry for KUA Application resources, memberships and relationships, keyed by stable provider identities with source lineage retained separately.
- Added explicit registry reconciliation from linked APM and Architecture data, projecting correlation IDs to graph nodes and relationships while leaving metric buckets, cursors and traces in their current local stores.

### Architecture Phase 5 Foundation (2026-08-26)

- Added a reversible, profile-scoped link from an Observability application to an existing or newly created Architecture project, without moving resources, metrics, traces or graph data.
- Observability now shows Architecture link coverage, unmatched resources and duplicate identity warnings, and opens the exact linked diagram in one action.

### Architecture Phase 4 Kickoff (2026-08-26)

- Added authoritative CloudFormation sync apply with one atomic graph revision, optimistic `expectedRevision` conflict protection, selected-stack sync metadata and retained stable resource identities.
- Sync review now shows concrete resource categories, preserves manual and rejected relationship decisions, marks absent discovered resources stale, and provides explicit restore or removal actions.
- Added the KUA Unified Management Plan, defining KUA Application as the shared product boundary between APM and Architecture and sequencing the migration toward one provider-neutral application workspace.
- Added the phase 4 contract for authoritative CloudFormation synchronization, stale-resource lifecycle, sync metadata and relationship review.
- Documented the first phase 4 milestone as a safe CloudFormation sync review that compares selected stack sources before applying one graph revision.
- Added the first read-only AWS sync preview endpoint, classifying selected CloudFormation resources and relationships as new, changed, unchanged, missing, stale, manual, reinforced or rejected without mutating the graph.
- Added an Architecture workspace sync preview panel that checks existing CloudFormation sources and summarizes resource and relationship changes before any apply flow exists.

### Architecture Phase 3 Closure (2026-08-25)

- Rediscovery now reconciles current and historical AWS identities without duplicating nodes, while remapping edges, groups and saved positions to the retained graph ID.
- Manual and rejected relationship decisions continue to take precedence when the same resources and evidence are imported again.
- Canvas arrangement mode, direction and relationship-label preference are now stored in the versioned graph, restored after reload and included in snapshot comparisons.
- AWS discovery now shows whether CloudFormation stacks are loading or resources and evidence are being analyzed, including a visible waiting state for longer reads.
- Architecture projects can now be deleted explicitly, including their local graph, snapshots and revision history.
- A live rediscovery of the three AFEX stacks retained 119 nodes without duplication and recorded newly available relationship evidence.
- Lambda layer versions are now modeled as layers with their layer name instead of as functions named after a numeric version.
- API Gateway Lambda permissions are consolidated into route-to-Lambda evidence rather than rendered as repeated policy nodes; Lambda inspection now shows its API routes, permission declarations and CloudFormation identity.
- Added a bilingual phase contract with explicit acceptance criteria and deferred authoritative synchronization to phase 4.
- Closure validation passed: 118 backend tests, 374 frontend tests, the frontend production build and the VitePress documentation build.

### Architecture Workspace Foundation

- Added a new profile-scoped **Architecture** workspace for application diagrams, initially targeting AWS.
- Added a provider-neutral graph model for scopes, sources, nodes, relationships, groups, evidence, and persistent layout.
- Added a private `architecture.sqlite3` store with WAL, optimistic graph revisions, immutable snapshots, and safe server shutdown.
- Added profile-isolated APIs for creating projects, reading and updating graph drafts, and creating or browsing snapshots.
- Added the first Vue workspace for project creation, graph summaries, and local snapshot history.
- Added typed graph operations with cascading cleanup, optimistic revision checks, and semantic change history.
- Added snapshot comparison and transactional restore, which always creates a new revision and immutable snapshot instead of rewriting history.
- Added workspace controls for comparing snapshots, restoring prior graph states, and browsing recent revision history.
- Added an interactive Vue Flow canvas for manually creating, connecting, moving, editing, and deleting architecture components.
- Canvas interactions persist through typed graph operations, including layout changes recorded only after a drag completes.
- Added read-only AWS discovery for active CloudFormation deployments and ECS services, with profile/region scoping and request estimates.
- Added a two-step preview and confirmation flow: KUA never preselects resources, and confirmed resources are imported atomically with their inferred relationships.
- Added evidence-backed relationship suggestions from CloudFormation `DependsOn`, `Ref`, `GetAtt`, and `Sub` references, including YAML intrinsic shorthand support.
- Inferred relationships are classified as automatic or suggested using the project confidence threshold, while retaining their confidence and source evidence.
- Added explicit accept/reject review actions; reviewed decisions are preserved across rediscovery and rejected relationships remain in canonical history while hidden from the canvas.
- Added AWS-specific relationship semantics for EventBridge targets, Step Functions definitions, and ECS service placement, plus direct SQS-to-Lambda relationships inferred from CloudFormation event source mappings.
- Added direct regional inventory for Lambda, EventBridge, and Step Functions, with CloudFormation stacks as optional enrichment instead of a discovery requirement.
- Connected AWS resources are now identified as application candidates from EventBridge target and ASL evidence, ready for explicit selection; truncated 500-resource previews are clearly reported.
- Identified applications can now be drawn directly with one action: the validated preview is reused for five minutes, the discovery panel closes after import, and large diagrams receive a wider adaptive layout.
- Added direct regional Lambda event source mapping discovery so SQS-to-Lambda triggers complete application paths without requiring CloudFormation.
- Added an ordered APL Routes diagram with Event sequence, Name A-Z, Event bus, Service flow, and Longest route modes; ordering applies to both entrypoints and branches while preserving distinct relationship paths.
- New Architecture projects now open a guided CloudFormation-first setup: choose deployments, confirm inferred application resources, then review the generated diagram, with regional inventory available as an explicit fallback.
- Step Functions resources now open their configurable internal ASL diagram from either Routes or Canvas, while candidate composition shows which applications contain workflows and other AWS resource types.
- Architecture can now map every resource from explicitly selected CloudFormation stacks, including isolated resources and previously unsupported AWS services, without widening the APM resource contract.
- CloudFormation evidence now identifies S3 notifications, IAM role and policy attachments, workload roles, Lambda permissions, and governed resources with dedicated relationship semantics.
- The Canvas can arrange request flow horizontally or vertically using persisted causal levels and crossing reduction; dense diagrams start at a readable zoom with optional relationship labels and recognizable AWS service icons.
- API Gateway methods and HTTP API routes now display their resolved HTTP method and path, preserve direct route-to-Lambda evidence, and expose navigable component references in the Canvas inspector.
- Selecting a Canvas component now centers it at a readable zoom and dims unrelated nodes and edges, keeping direct dependencies visible in dense application topologies.
- Clearing a Canvas selection now explicitly restores every node and edge to full visibility, including styles internally mutated by Vue Flow.
- Added a resource-type arrangement mode with labeled count sections, deterministic grids, persisted resource positions, and subdued straight connectors for large diagrams.
- Architecture discovery consumes the existing per-profile AWS request budget; templates are parsed locally and never persisted or returned to the frontend.
- Added focused backend and frontend coverage for graph validation, snapshot immutability, revision conflicts, profile isolation, and store behavior.

## v1.11.3 (2026-08-11)

### macOS Packaging Hotfix

- Fixed the Intel macOS package bundling an ARM64 `better-sqlite3` native binary, which prevented the packaged backend from starting after installation.
- macOS x64 and ARM64 artifacts are now built in isolated, sequential processes so native dependencies cannot be replaced while another architecture is still being archived.
- Added architecture checks for the Electron executable and SQLite native module inside both final ZIP artifacts before a release can be published.
- Preserved a combined macOS update manifest containing the x64 and ARM64 ZIP/DMG assets.

## v1.11.2 (2026-08-11)

### Multicloud and Provider-free APM

- Extended application observability from AWS to isolated AWS, GCP, and Vercel scopes, plus a provider-free **General** scope for Kubernetes applications.
- Moved Observability into the primary navigation and added application editing, deletion, resource management, and provider-aware setup flows.
- Added explicit-column SQLite migrations for provider-scoped applications and resources, preserving existing APM data safely.
- Added bilingual credential setup guides for AWS, GCP, Vercel, and Kubernetes, with improved profile persistence and lazy provider loading.

### Explainable Topology Intelligence

- Added a local structural evaluator with topology score, connected coverage, isolated-resource detection, findings, and explainable dependency suggestions.
- Generic `related_to` relationships are now reported separately and do not count as operational causality.
- Added explicit, read-only AWS definition analysis for associated Step Functions.
- ASL analysis recognizes direct and optimized Lambda calls, nested Step Functions, SQS sends, ECS tasks, and S3 SDK operations.
- External ASL references remain suggestions: users must add the resource, reanalyze, and explicitly confirm the dependency. KUA never creates causal edges automatically.

### Process Requests and Execution Traces

- Added an AWS **Traces** tab that accepts a request/correlation ID, execution ARN, or associated Step Function ARN.
- Pasting a Step Function ARN lists up to 10 recent executions and traces the latest run; any listed execution can then be selected directly.
- Step Functions execution history provides an ordered timeline with Lambda, ECS, S3, nested workflow, status, duration, and failure evidence.
- Added an explicit **Show sanitized request/response** option for execution-level and per-step inputs, parameters, outputs, errors, and causes.
- Common credential and personal-data fields are redacted, large strings/arrays are bounded, event payloads are requested only on demand, and trace data is never persisted.
- All trace and topology reads remain scoped to associated resources and consume the existing per-profile AWS request budget. KUA does not invoke production workloads or enable logging automatically.

### Vercel and Reliability Fixes

- Updated Vercel API paths and versions, preserved upstream error details, and supported both current and legacy Cron response shapes.
- Corrected provider-specific copy, profile handling, environment management behavior, and resource presentation across the multicloud views.
- Added focused backend and frontend coverage for migrations, scoping, ASL extraction, topology analysis, request tracing, sanitization, Vercel compatibility, and profile workflows.

## v1.11.0 (2026-08-06)

### Local Application Observability

- Added a profile-scoped application workspace for explicitly confirmed Lambda, Kubernetes, SQS, EventBridge, Step Functions, and ECS resources.
- Added read-only CloudFormation and ECS deployment discovery with a preview-first import flow. KUA never selects candidates or creates dependency edges automatically.
- Added a private SQLite telemetry store with 30-minute UTC aggregates, local thresholds, collection cursors, run history, retention cleanup, and health checks.
- Added Lambda and Kubernetes collectors with resumable pagination, deduplication, partial-result states, and opportunistic capture from metrics already loaded in the UI.
- Added manual application topology, configurable health thresholds, local trend forecasts, and per-profile metric history.

### EKS Container Insights

- Added an EKS observability dashboard backed by read-only CloudWatch Container Insights queries.
- Metrics can be grouped by namespace, workload, pod, or node, with cluster and node group context shown alongside the time series.
- Collection reports unavailable or partial Container Insights data without provisioning agents, dashboards, alarms, or other AWS resources.

### Cost and Privacy Guardrails

- Automatic APM polling remains disabled by default and collection must be enabled explicitly per application.
- Enforced a local hard limit of 100,000 AWS read requests per profile and calendar month.
- KUA stores only confirmed identifiers, configuration, cursors, request counters, collection status, and metric aggregates. It does not persist CloudWatch log lines, payloads, credentials, secrets, environment variables, or arbitrary tags.
- Metric buckets, cursors, and collection runs expire after 90 days; request-budget records expire after 15 months.

### Refresh and Terminal Reliability

- Added stable five-second background refresh for Kubernetes, AWS, GCP, and Vercel, paused while the window is hidden.
- Added in-memory stale-while-revalidate caches for cloud and Kubernetes list endpoints, invalidated after mutations and context changes.
- Background refresh preserves object identity for unchanged data and ignores stale responses after resource navigation.
- Terminal logs now retain at most 5,000 lines, render 1,000-line windows, support live-follow pause/resume, and allow selecting an individual pod for workload logs.

### Runtime and Kubernetes Compatibility

- Added idempotent native-module repair for `better-sqlite3`, Electron unpacking/rebuild support, private database file permissions, and a strict Vite development port.
- Updated Kubernetes patch calls for the current client signatures and removed server-managed fields before applying edited YAML.
- Added clean APM scheduler/database shutdown and health reporting for the local backend.

## v1.10.5 (2026-07-07)

### Development and Release Reliability

- Separated the stable backend (`7190`), development/Electron backend (`7192`), and Vite frontend (`7193`) ports.
- Added a release-workflow workaround for optional native modules that could fail during cross-platform Electron rebuilds.

## v1.10.4 (2026-06-22)

### Vercel Marketplace OAuth

- Added full support for the Vercel Marketplace integration flow: the callback page now handles `configurationId`, `teamId`, `next`, and `source` parameters in addition to the standard `code`+`state` OAuth flow.
- Fixed "Missing OAuth parameters" error that appeared when Vercel Marketplace redirected to the callback page without a `state` parameter.
- After completing Marketplace authorization, the app now opens the Vercel `next` URL in the browser so the integration is marked as installed.
- `VERCEL_CONFIGURATION_ID` and `VERCEL_TEAM_ID` from the Marketplace flow are persisted in the credential profile.

## v1.10.3 (2026-06-22)

### Vercel OAuth Callback

- Switched the Vercel OAuth redirect flow to the HTTPS callback page at `https://lnavarrocarter.github.io/kuadashboard/vercel-callback` so the app can complete authorization without relying on the custom protocol redirect.
- Added an auto-forwarding callback page that hands the OAuth `code` and `state` back to the desktop app through the existing Vercel callback flow.
- Added `VERCEL_OAUTH_REDIRECT_URI` support in the runtime config so local and packaged builds stay aligned with the HTTPS callback.

## v1.10.2 (2026-06-22)

### AWS — Temporary Credentials + Browser SSO

- Added support for `AWS_SESSION_TOKEN` in stored credential profiles and AWS resolution, enabling STS / temporary credentials end-to-end.
- Added browser-based IAM Identity Center (SSO) device authorization flow with account/role credential exchange and automatic temporary credential capture.
- Added SSO session expiry tracking and renewal support through stored SSO metadata (`meta.__sso`) and one-click renewal flows.

### Security, Reliability, and UX

- Restricted local AWS profile discovery and SSO bootstrap endpoints to localhost-only access to prevent workstation metadata exposure from remote clients.
- Updated Env Manager metadata sanitization to preserve reserved structured `meta.__sso` fields (start URL, region, account/role, expiration) while keeping existing tags behavior for normal keys.
- Hardened SSO browser popups by opening verification links with `noopener,noreferrer`.
- Normalized generated `public/index.html` line endings to remove stray carriage-return artifacts and avoid noisy diffs.

### Additional AWS Fixes

- Fixed Step Functions diagram rendering freeze for state machines with cycles by adding a cycle guard in BFS level assignment (`StepFnDiagram.vue`).
- Fixed Athena query failures when the selected workgroup has no configured output location by allowing an explicit S3 output override in the Query Editor and workgroup query modal.

## v1.10.0 (2026-06-09)

### GCP — Master-detail panels

All four core GCP services now have a full split-panel master-detail layout: a resource list on the left and a tabbed detail panel on the right, consistent with the established Cognito / Athena / Lex pattern.

- **Cloud Run** — tabs: Overview (config, image, scaling), Revisions (with traffic %), Variables (env vars), Logs, Metrics.
- **Compute VMs** — tabs: Overview (tags, labels, deletion protection), Disks, Network (interfaces & IPs), Logs, Metrics.
- **Cloud SQL** — tabs: Overview (backup & availability), Config (storage type, flags), Connection (IP addresses, connection name), Logs, Metrics.
- **Cloud Functions** — tabs: Overview (runtime, resources, trigger), Variables, Logs, Invoke (inline, replaces the old floating modal), Metrics.

### GCP — Embedded Cloud Monitoring Metrics

A **Metrics** tab is now embedded in all four service panels. Each tab shows three Chart.js line charts pulled from the Cloud Monitoring v3 API with a configurable time range (1h / 3h / 6h / 24h) and a Refresh button.

| Service | Charts |
| --- | --- |
| Cloud Run | Request Rate (req/s) · Latency p99 (ms) · Instance Count |
| Compute VMs | CPU Utilization (%) · Network In (B/s) · Disk Read (B/s) |
| Cloud SQL | CPU Utilization (%) · Connections · Disk Used (bytes) |
| Cloud Functions | Execution Count (req/s) · Duration p99 (ns) · Active Instances |

### GCP — GCS Upload & Delete

- **Upload**: a new "⬆ Upload" button appears in the GCS Browser toolbar. Supports multi-file selection, uploads each file to the current folder as raw binary, and shows a per-file result log (✓ / ✗).
- **Delete**: a "🗑 Delete" button appears in the file preview panel. Asks for confirmation before calling the new `DELETE /storage/:bucket/object` backend route.

### GCP — Artifact Registry Deploy-to-K8s

Artifact Registry is redesigned as a master-detail panel with two tabs:

- **Packages & Tags** — two-column view: packages list on the left, tag table on the right. Each Docker tag row has a **🚀 Deploy** button.
- **Deploy to K8s** — clicking Deploy pre-fills the full image reference (`location-docker.pkg.dev/project/repo/pkg:tag`). The panel then lets you select the target Namespace, Deployment and Container from the active Kubernetes cluster, shows a deploy summary and applies the change with a single click.

### Kubernetes Deployment Integration

- New `POST /api/:namespace/deployments/:name/set-image` endpoint: performs a strategic-merge-patch on one container's image and writes an audit log entry.

### GCP — Log viewer improvements

- Log entries in all detail panels now use severity-based colour coding: `ERROR`/`CRITICAL` → red, `WARNING` → amber, `INFO`/`NOTICE` → green, `DEBUG`/`DEFAULT` → dim.

## v1.9.3 (2026-06-09)

### AWS Amazon Lex

- Redesigned the Lex view with a **master-detail split-panel layout** (like Cognito and Athena). The left panel lists all bots with status, version and last-updated date. Clicking a bot opens the detail panel on the right.
- Removed the 8 individual colored action buttons from each table row. All functionality (Intents, Aliases, Slot Types, Chat, Logs, Missed, Metrics, Test Set) is now accessible via a tab bar in the right panel.
- Data is loaded on-demand per tab and cached for the active bot — switching tabs for the same bot does not re-fetch.
- The Chat and Build actions inside the Aliases tab now navigate to their respective tabs instead of opening nested modals.

## v1.9.2 (2026-06-09)

### AWS DynamoDB

- Added **item editing** in the Browse modal: each row now has an ✏️ button that opens a JSON editor pre-filled with the item's current data. Saving performs a `PutItem` (full replace) and refreshes the current page.
- Added **item deletion** per row: the 🗑 button extracts the primary key fields automatically from the table's key schema and asks for confirmation before calling `DeleteItem`.
- Added **New Item** button in the Browse modal toolbar: opens the JSON editor pre-filled with only the key fields so you can create a new record from scratch.
- JSON editor validates syntax in real time and blocks saving when there are parse errors.

## v1.9.1 (2026-05-28)

### AWS Cognito

- Fixed user search behavior in User Pools to support free-text lookups without triggering AWS filter parsing errors.
- Added user attribute editing from the user details modal.
- Added group membership management from user details: assign and remove groups for a selected user.
- Added per-user MFA controls in details: enable via toggle, disable via action button, and preferred method switch (SMS/TOTP).
- Added create-group flow with description support in the Groups tab.
- Fixed runtime issue in group creation flow where the UI could fail with `createCognitoGroup is not a function` in stale hot-reload states.
- Fixed MFA status mismatch between user list and details by aligning list calculation with Cognito MFA settings (`UserMFASettingList` / `PreferredMfaSetting`, with compatibility fallback).

## v1.9.0 (2026-05-26)

### Vercel

- Full Vercel provider integration with OAuth authentication — connect your Vercel account directly from the profile modal.
- Projects view with deployment status, framework, region and quick links to the live URL.
- Deployment details with Activity feed, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config and Checks tabs.

### AWS Step Functions

- New **Executions** column in the Step Functions table showing live counts of running (▶), failed (✗) and timed-out (⏱) executions.
- New **Versiones** tab in the Info panel — lists all published workflow versions with creation date, description and on-click ASL definition viewer with copy button.
- Info modal refactored with five tabs: Detalles, Diagrama, Ejecuciones, Eventos and Versiones.

### Terminal & Shell Improvements

- **Native Copy/Paste Support**: Electron menu now includes Edit menu with native roles for copy, paste, cut, select all and standard keyboard shortcuts.
- **Context Menu**: Right-click on selected text to copy; right-click on input fields to cut/paste/copy as native OS behavior.
- **Copy Selected**: Button to copy currently selected terminal text without depending on keyboard shortcuts.
- **Copy Output**: Button to copy the entire terminal output (all filtered lines), with timestamps automatically removed for clean text.
- **Paste into Input**: Button to safely paste clipboard content into command input, with confirmation for multiline text to prevent accidental execution.
- **Terminal Panel**: Full copy/paste UI in the bottom terminal panel used for Kubernetes, local shell, and AWS/GCP logs.
- **Local Shell**: Dedicated copy/paste buttons in LocalShellView header for shell session management.
- **SSH Terminal**: Ec2Shell now supports copy selected, copy output, and safe paste with Ctrl+C remaining as interrupt signal.
- **RDP Paste Modal**: RDP session has a "Paste text" feature with textarea modal to send text as keyboard events to the focused remote field. Note: copy from RDP canvas is not available (render is pixels, not selectable text); use SSH or remote command to extract logs from Windows machines.
- **Selection CSS Fix**: Terminal output areas now allow text selection (user-select: text) while preserving non-selectable decorative elements like timestamps and tab headers.

## v1.8.0 (2026-05-10)

### Kubernetes

- Resource tables now support multi-select, bulk delete and richer row actions.
- The Kubernetes menu now covers more resources across workloads, networking, storage, config, policy, RBAC, scheduling, admission and cluster administration.
- The `Age` column displays readable durations such as `1day 3hrs 10min`, `23hrs 10min`, `2min` and `30sec`, while sorting by the real elapsed duration.
- ConfigMaps and Secrets have an easier key/value data view for mapping and editing values.
- Workloads expose environment variables in the detail panel, including editable container env entries.
- The kubeconfig modal can import pasted YAML, load a file through the desktop file picker or register an existing kubeconfig path.

### Helm

- Charts can be searched from configured repositories and installed directly into the active cluster.
- Installed releases can be listed and uninstalled from the Helm view.
- Installations show progress, output and final release status instead of leaving the UI waiting silently.
- `metrics-server` installs include a compatibility preset for local or self-signed clusters, adding kubelet TLS and preferred address flags.

### Observability

- Metrics are available for Pods, workloads and Nodes through `metrics.k8s.io`.
- When Metrics Server is unavailable, KuaDashboard can discover Prometheus services and query metrics through the Kubernetes API server proxy.
- Resource and Node detail panels include related events and notification-style summaries to help diagnose scheduling, image pull, health and lifecycle issues.

### Port Forwarding

- Service and Pod tunnels are more reliable, with improved target pod resolution, persistent session state and reconnect behavior.
- Port-forward actions are available from resource tables and detail surfaces where the selected resource supports a tunnel.

## v1.7.0 (2026-05-05)

- Auto-refresh for Kubernetes, AWS, GCP and Helm views without resetting navigation context.
- Resizable Kubernetes resource detail panel with specialized summaries and structured YAML.
- Pod metrics using `metrics.k8s.io`, Prometheus detection and Helm handoff when monitoring is missing.
- Real-time log streaming for Pods, Deployments, StatefulSets and DaemonSets.
- Terminal Logs search, serialized date filters, downloads and line counts.
- YAML editor search, lint, save, line/column status, section path and autocomplete.
- Persistent EC2 SSH/RDP sessions that can be hidden and reopened without closing the connection.

## v1.6.2 (2026-04-29)

- AWS EC2 Info copy buttons for key fields: Instance ID, AMI, Public/Private IP, Public/Private DNS, Key Pair and IAM Profile.
- AWS Lambda Info copy buttons for key fields: ARN, SHA256, VPC ID, DLQ ARN and KMS Key ARN.
- UX polish for copy actions: hover visibility and temporary visual confirmation.

## v1.6.1 (2026-04-24)

- AWS RDS: new per-instance panel with actions for Info, Configuration, Connection and password reset.
- AWS RDS: redesigned detail modal with AWS-console style tabs (connectivity/security, monitoring/logs, configuration, maintenance/backups, migration/replicas, tags).
- AWS RDS: Spanish translations completed for modal texts, buttons and status messages.
- AWS Database: unified navigation and view under RDS, removing residual DocumentDB section from UI.
- Documentation: expanded Spanish IAM minimum-permissions guide with RDS required actions.
- Fixed mojibake encoding in HelpModal titles/comments.
- Fixed Helm behavior for EKS ARN contexts by injecting full KUBECONFIG when invoking helm CLI.

## v1.6.0 (2026-04-24)

- AWS Lambda: dedicated Logs tab with CloudWatch events and selectable time ranges.
- AWS Lambda: create log group flow with retention options when missing.
- AWS ECR Deploy to K8s: optional Service creation (ClusterIP / NodePort / LoadBalancer).
- Fixed generated deployment YAML indentation issue.
- Added `--validate=false` to kubectl apply for compatibility in restricted API setups.
- Fixed Athena UI error `sortedRows is not a function`.
- Adjusted AWS Lex/Athena `maxResults` to supported API limits.

## v1.5.0 (2026-04-23)

- AWS S3: create bucket modal and per-bucket test action.
- AWS ECR: image browser and direct deploy-to-Kubernetes flow.
- AWS VPC: details panel with overview, subnets, security groups, route tables, IGW and NAT GW.
- AWS Cognito: groups tab per user pool.

## v1.4.3 (2026-04-23)

- Windows app icon/taskbar behavior fix via App User Model ID.
- Packaging metadata updates.

## v1.4.2 (2026-04-21)

- AWS Lambda details panel with multiple tabs and richer diagnostics.
- AWS EC2 details panel with monitoring, security groups, volumes and console output.
- EC2 SSH password authentication and PEM picker support.
- OS-aware SSH/RDP actions with integrated RDP canvas.

## v1.4.1 (2026-04-21)

- Auto-updater robustness: `quitAndInstall` fallback handling.
- UpdateNotice error state with manual download option.

## v1.4.0 (2026-04-20)

- GCP feature expansion (Cloud Run Jobs, Pub/Sub Subscriptions, VPC Networks, Cloud Monitoring, Cloud Logging, Cloud KMS).
- Pagination improvements in Cloud Build, IAM Service Accounts and Cloud Tasks.
- Observability section improvements in GCP sidebar.

## v1.3.3 (2026-04-21)

- macOS: migrate credential storage to native keychain using `@napi-rs/keyring`.
- macOS updater compatibility fixes for release artifacts.

## v1.3.2 (2026-04-21)

- macOS auto-updater fix ensuring ZIP artifact availability.

## v1.3.1 (2026-04-21)

- macOS auto-updater fix ensuring ZIP artifact availability.

## v1.3.0 (2026-04-21)

- GCP phase expansion (Spanner, Redis, Cloud Tasks, Scheduler, Cloud Build, IAM Service Accounts).
- Full EN/ES bilingual UI with reactive switching.
- Header quick actions for language and theme.
- Helm view and related UX improvements.
- WebSocket and terminal reliability fixes.

## v1.2.0 (2026-04-20)

- GCP phase 1-2 additions: Secret Manager, Cloud Functions, GCS Browser, Artifact Registry, BigQuery, Cloud Workflows, Cloud DNS and Firestore.
- Persistent port forwarding.
- Expanded AWS coverage across core services.

## v1.1.3 (2026-04-21)

- macOS auto-updater ZIP target compatibility fix.

## v1.1.2 (2026-04-20)

- macOS: Electron now inherits login shell PATH when launched from Dock.
- Update availability notice integrated in Help modal.

## v1.1.1 (2026-04-20)

- AWS/GCP credential selectors in global header.
- Local Shell and Env Manager quick access from header.
- Help modal with About, Releases and Feedback/Issues.
- UI icon and refresh controls improvements.

## v1.1.0 (2026-04-20)

- Initial AWS/GCP sidebar navigation and credential selectors.
- Early support for Step Functions, EventBridge, API Gateway, Pub/Sub and Cloud Functions.
- SSH and terminal UX improvements.

## v1.0.0 (2026-01-01)

- Initial KUA release: Kubernetes dashboard, cloud views, env manager, port-forwarding and log/exec tooling.

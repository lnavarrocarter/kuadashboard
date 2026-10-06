# KUA Unified Management Plan

## Executive Decision

KUA should converge Observability (APM) and Architecture around one product concept: a **KUA Application**.

A KUA Application is the operational boundary for one application, environment and profile. It owns the confirmed resource membership and becomes the entry point for:

- live and aggregated observability;
- evidence-backed topology and architecture diagrams;
- deployments, sources and discovery state;
- relationship review and topology analysis;
- process traces, findings and recommendations (Phase 19).

This does not mean creating one diagram for an entire cloud account. A project remains scoped to one application boundary. A large platform can contain several KUA Applications, while a single application can span AWS, GCP, Vercel and Kubernetes.

## Why Converge

Today the two workspaces solve adjacent parts of the same problem:

| Capability | APM today | Architecture today |
| --- | --- | --- |
| Primary object | Application | Architecture project |
| Resource membership | Confirmed resources used for collection | Nodes discovered or added to a graph |
| Relationships | Confirmed edges and explainable suggestions | Evidence-backed edges with review state |
| Operational data | 30-minute metric aggregates, collection runs and health | Not stored as telemetry |
| Evidence | Provider and ASL analysis | CloudFormation source evidence, snapshots and revisions |
| History | Collection history and retention | Immutable graph snapshots and change history |
| Trace context | AWS Step Functions request tracing | Route and workflow navigation |

The duplication creates predictable friction: a user configures the same Lambda, queue or Kubernetes workload twice; a topology finding is separated from the diagram that explains it; and an architecture resource can exist without a clear operational owner.

## Target Architecture

### Canonical ownership

APM's application identity becomes the canonical identity for the unified product. The existing Architecture project is linked to that identity during migration and later becomes an architecture view attached to the application.

The core model should be provider-neutral:

```text
KUA Application
├── identity: profile, name, environment, team
├── provider scopes: AWS, GCP, Vercel, Kubernetes
├── resources: stable provider identities and operational settings
├── relationships: confirmed, suggested, rejected, stale
├── sources: CloudFormation, labels, deployment, code, runtime
├── architecture views: layout, groups, filters, snapshots
├── observability: metrics, collection runs, health and retention
└── analysis: findings, coverage, traces and recommendations
```

The resource identity must be independent from display names. The minimum cross-provider identity is:

- provider;
- profile or connection scope;
- account/project/context;
- region or location;
- native identifier, ARN, URL, or Kubernetes UID;
- resource type and version where needed.

### Boundary rules

- One application does not silently absorb a resource from another application.
- A resource can be discovered in several sources but has one canonical membership record.
- Manual membership and relationship decisions are never overwritten by discovery.
- Discovery remains read-only; collection remains opt-in and budgeted.
- Telemetry remains local, aggregated and retention-bound. Payloads, credentials, secrets and arbitrary logs are not persisted. The one exception is the opt-in CloudWatch log cache (Phase 18): log groups the user explicitly caches are kept locally for at most 7 days, sanitized, compressed and encrypted at rest (AES-256-GCM, key in the OS user's keychain), and never leave the machine (not in KUAAppBundle exports or cloud backups).
- Architecture snapshots contain topology state, not metric history or trace payloads.
- Cross-provider edges require evidence or explicit user confirmation; name similarity alone remains a suggestion.

## User Experience

The primary navigation should move from separate mental models to one application workspace:

1. **Applications**: list KUA Applications by environment, team and health.
2. **Overview**: health, metric freshness, collection state, topology score and latest findings.
3. **Architecture**: interactive diagram, routes, source evidence, review queue and snapshots.
4. **Resources**: canonical membership, provider, location, collection status and source lineage.
5. **Traces and events**: provider-specific traces linked back to diagram nodes and relationships.
6. **Sync and review**: discovery previews, changed/missing resources, stale lifecycle and relationship decisions.

The existing APM and Architecture tabs can remain as compatibility entry points while both open the same KUA Application. The first navigation action should offer “Open architecture” from APM and “Open observability” from Architecture.

## Delivery Plan

### Phase 4B: Finish authoritative synchronization

Complete the already-started CloudFormation sync work before changing ownership:

- implement `sync-apply` with `expectedRevision` and one atomic graph revision;
- persist source sync metadata and selected stack sets;
- review new, changed, missing and stale resources separately from relationships;
- preserve manual and rejected decisions;
- add explicit stale restore/remove actions;
- expose detailed review data in the UI.

Exit criteria: repeated multi-stack sync is idempotent, outdated previews are rejected, and no apply can mutate outside the selected stack scope.

### Phase 5: Establish the KUA Application link

Add a non-destructive association between an existing APM application and an Architecture project:

- add `architecture_project_id` or an equivalent link record to the canonical application boundary;
- map APM resources to Architecture nodes through stable provider identities;
- show link status, unmatched resources and duplicate identity warnings;
- add “Create architecture view” and “Link existing project” actions;
- keep old endpoints and stored data readable during migration;
- make unlinking reversible and never delete the other side automatically.

Exit criteria: a user can open one application and reach its diagram, resources, metrics and topology without configuring membership twice.

### Phase 6: Shared resource and relationship registry

Converge the two representations behind a provider-neutral registry:

- one resource record with operational configuration and discovery lineage;
- one relationship record with source evidence, confidence and human decision;
- adapters that project registry records into APM collection and Architecture graph formats;
- revisioned membership changes and source-aware reconciliation;
- correlation identifiers for metrics, traces, deployment events and graph nodes.

Do not move metric buckets, collection cursors or trace payloads into the graph document. Keep high-volume and retention-sensitive data in their existing stores.

Exit criteria: import, manual edits, topology analysis and collectors resolve the same resource identity and no duplicate application membership is created.

### Phase 7: Operational architecture overlays

Make the diagram useful during incidents and daily operations:

- color or badges for health, freshness, partial data and collection state;
- metric sparklines and error-rate summaries on selected nodes;
- trace path highlighting from an execution or correlation ID;
- deployment and stale-resource markers with timestamps;
- findings that navigate directly to the affected node, edge or source evidence;
- snapshot comparison that distinguishes topology changes from telemetry changes.

Exit criteria: a user can move from a health anomaly to the affected resource, relationship evidence and recent trace without changing workspaces.

### Phase 8: Provider adapters and correlation

Implement providers behind the shared contracts, in this order:

1. **Kubernetes**: context, namespace, UID, workload/pod ownership, Services, Ingress and events.
2. **GCP**: project, region, Cloud Run, Cloud Functions, GKE and Cloud Monitoring evidence.
3. **Vercel**: team/project, deployment, domain, function and runtime activity.
4. **AWS expansion**: additional CloudFormation resource types, X-Ray or other trace sources when privacy and budget controls are defined.

Every adapter must provide discovery, stable identity, relationship evidence, health signals and explicit capability metadata. A provider missing one capability should degrade that view, not break the application workspace.

### Phase 9: Application context persistence

Findings from the 2026-08-27 audit show the KUA Application selection still depends on the AWS profile shell. `architectureProfileId` in [App.vue](../../frontend/src/App.vue#L798) falls back to `awsProfileId` whenever the active application context has no `profileId`, so a Kubernetes-only or profile-less application cannot open Architecture on its own. `activeApplicationContext` is a plain in-memory `ref` (`App.vue` around line 797), so a window reload loses the selected application even though it can sometimes be recovered from the linked project.

- Stop deriving the Architecture profile from the global AWS selector; resolve it from the KUA Application's own provider scope, allowing a null/local profile for Kubernetes-only or future GCP/Vercel applications.
- Persist `applicationId`, `projectId`, provider and profile in the URL (query params) and/or `localStorage`, and rehydrate them on boot before the first `ArchitectureView` mount.
- Keep backward compatibility for direct AWS-profile navigation when no application is selected.

Exit criteria: reloading the window while inside an application-scoped Architecture view restores the same application, project, provider and profile without a manual re-selection, and a Kubernetes-only application opens Architecture without requiring an AWS profile.

### Phase 10: Resource-level navigation

The Canvas inspector only shows metadata/reference lists; there is no action to jump to logs, metrics, YAML/detail or traces. The only specialized action today is the Step Functions diagram inside [ArchitectureCanvas.vue](../../frontend/src/ArchitectureCanvas.vue#L95).

- Add a per-node action menu keyed by `provider` + `resourceType`.
- Kubernetes: open Pod/workload logs, CPU/memory metrics, YAML detail, and list Pods owned by a Deployment/StatefulSet/DaemonSet.
- AWS: open Lambda detail/logs, EC2 detail, SQS/EventBridge/Step Functions detail, and metrics/traces where available.
- Reuse existing Observability navigation helpers (`openObservabilityKubernetesLogs`, Step Functions trace panel) instead of duplicating fetch logic.

Exit criteria: every supported resource type exposes at least one working navigation action from its Canvas node, and unsupported types show a disabled/explained state instead of nothing.

### Phase 11: Operational overlays on the Canvas

Provider, context and namespace filters exist, but nodes only project `label`, `method` and `resourceType` ([ArchitectureCanvas.vue](../../frontend/src/ArchitectureCanvas.vue#L350)). There is no health, freshness, collection state or recent-error indicator, which matters most for large diagrams (e.g. Jordan 360) where degraded/stale resources need to stand out.

- Extend the node projection with health, last-collected-at/freshness, collection status and a recent-error flag sourced from the shared registry/observability state.
- Render badges/colors without redesigning the whole node; keep it opt-in via a toggle so dense diagrams stay readable.
- Reuse Phase 7's overlay design intent (health, freshness, sparklines) as the target shape.

Exit criteria: a degraded or stale resource is visually distinguishable on the Canvas without opening the inspector.

### Phase 12: Canonical resources view

The shared registry is reconciled and queryable, but the UX still fragments it across the APM table, Architecture Canvas nodes and a limited link-modal summary.

- Add a `Resources` view under the KUA Application that lists the canonical registry entries: provider, identity, sources, lineage, operational status, relationships and divergences.
- Reuse the registry read APIs already used for reconciliation instead of building a new data path.

Exit criteria: a user can see every resource owned by a KUA Application, its provider identity and its divergences from one place, regardless of whether it was discovered via APM or Architecture.

### Phase 13: One action, one revision

Saving an Architecture operation can trigger `reconcileLinkedApplication()` again in [architecture.js](../../routes/architecture.js#L137), which may mutate the graph a second time right after the user's own save, producing two revisions for a single user action.

- Separate the user's revision from the derived reconciliation projection, or merge both into a single transaction/revision when they originate from the same request.
- Audit all five call sites of `reconcileLinkedApplication` (lines 136, 155, 225, 248, 329) for the same double-write risk.

Exit criteria: a single user-triggered save produces exactly one new revision/snapshot, even when it also updates shared-registry projections.

### Phase 14: Visible sync diagnostics

There is no persisted state of the last reconciliation (success time, duration, error, divergent resources/relationships); the user must manually trigger reconciliation from APM.

- Persist last-successful-sync, last-error, divergent resource count and divergent relationship count per linked application.
- Add a diagnostics panel (APM and/or Architecture) surfacing this state with a retry action.

Exit criteria: sync health is visible without triggering a manual reconciliation, and a failed sync surfaces a retry action in the same panel.

### Phase 15: Routes/Canvas filter parity

Routes already supports Kubernetes (`Ingress -> Service -> Pod`) but has no own provider/context/namespace controls, so a Canvas filter does not necessarily constrain Routes.

- Share the existing Canvas filter state (provider, context, namespace) with the Routes view instead of duplicating filter UI.

Exit criteria: applying a Canvas filter narrows Routes to the same scope without extra configuration.

### Phase 16: Observed-log relationship analysis

Logs are streamed and visually classified in [useTerminalStreams.js](../../frontend/src/composables/useTerminalStreams.js#L120), but that classification is never turned into persisted or transient evidence of HTTP calls between Services, internal DNS names, recurring errors, correlation IDs or workload dependencies. No ML layer exists yet, and none should be introduced before deterministic extraction is in place.

- Add a deterministic, sanitized extraction step over the already-classified log stream (no raw payload persistence, no secrets).
- Rank extracted candidates by confidence and surface them as suggested relationships requiring human review before touching the graph, reusing the existing suggested/rejected relationship review flow.

Exit criteria: a recurring HTTP call or DNS reference observed in logs appears as a reviewable suggested relationship, never as an automatic graph edit.

### Phase 18: Log intelligence from cached log groups

Delivered first slice (AWS CloudWatch).

- **Storage at rest.** Cached events are sealed in blocks (`lib/logCacheCrypto.js`): Brotli compression and AES-256-GCM bound to the log group, with a random per-installation key in the OS keychain of the current user (fallback: key file wrapped with the KUA vault passphrase). The last 6 hours stay in small hot blocks; older events are compacted into one block per group and hour. Measured on a real 146 MB cache: 4 MB after migration (~19x compression of the messages). Search decrypts blocks newest first; a full scan of ~28,000 events takes about 70 ms. Syncs read the most recent hours first and backfill older hours with the remaining page budget. Aggregates of the log intelligence stay unencrypted because they are sanitized and read by Observability on every topology request. Every event of a cached log group passes through one entry point (`ingest` in `lib/awsLogCache.js`): it is sanitized, stored for the cache window (≤ 7 days, size-bounded), analyzed into aggregates by `lib/logIntelligence.js`, and handed to hooks (Lambda REPORT lines feed the existing APM metric buckets with the same deduplication as the opportunistic capture).

- **One extractor for every provider.** `frontend/src/shared/logSignals.mjs` holds the deterministic rules (sanitization, levels, recurring error signatures, failure keywords, references to ARNs, SQS queues, API Gateway hosts, Kubernetes DNS and hosts). The Kubernetes log evidence of Phase 16 (`frontend/src/lib/logRelationshipEvidence.js`) now imports the same module, so a rule change applies to Kubernetes tabs and CloudWatch alike. Raising `SIGNALS_VERSION` re-analyzes cached groups on their next read.
- **Aggregates, not logs, are the durable record.** 30-minute buckets (events, errors, warnings, keywords), signatures with a sanitized sample, and references are kept 30 days, longer than the raw cache, so historical rates survive event expiry. Keys are `(scope, region, source)` and contain nothing provider-specific beyond the source name.
- **Observed evidence in the application.** `lib/logIntelligenceEvidence.js` maps cached groups to APM resources (explicit `logGroup` or the Lambda default group) and returns per-resource signals, findings (`log_error_rate_high` using the application's `errorRatePercent` threshold, `log_recurring_errors`, `log_failure_keywords`, `log_cache_stale`, `logs_not_cached`, `log_references_outside_app`) and suggestions with `observed_log_reference` evidence. `analyzeTopology` receives it as a separate evidence class: it adds findings and reviewable suggestions but never changes the structural score and never creates edges.
- **Categories, sensitive data and recommendations.** Each event gets one primary category (timeout, out of memory, throttling, access denied, connection, crash, configuration, database, code exception, not found, validation, cold start, platform, debug, other); failure categories only apply to error/warning lines, and each category has an equivalent Logs Insights query. The sanitizer reports what it redacted by type (passwords, tokens, keys, JWTs, URL credentials and queries, emails, Luhn-valid card numbers, check-digit-valid RUTs; IP addresses are reported but kept). `lib/logRecommendations.js` turns these aggregates into deterministic recommendations of four kinds (fix, sanitize, practice, cost) with evidence, confidence and actions (filter cached events, copy query, code snippet, AWS docs). Examples: the missing IAM actions named in access-denied messages with a least-privilege policy, adaptive retries for throttling, masking in the logger and a CloudWatch data protection policy for sensitive values, JSON log format, log level, retention. Cached events can be filtered by category, level or signature (decrypted locally). Observability shows the top categories and recommendations per resource. This is the shape the AI slice (18f) must keep: evidence first, explicit confidence, no automatic changes.
- **Same answer live and cached.** Live reads return the newest events of a range (`lib/awsLogFetch.js` walks backwards in growing segments, because FilterLogEvents returns events ascending), and the cache evaluates the same CloudWatch filter pattern syntax (`frontend/src/shared/filterPattern.mjs`: terms, phrases, `?`/`-` terms, JSON and space-delimited patterns). Remaining differences are explicit: the cache only reaches its last sync and stores sanitized text.
- **History control and activity chart.** Each cached group has a history setting (only new events, 1 h … whole window) that bounds backfill, and can be filled on demand with a larger page budget. The intelligence panel charts cached events per level with a resolution adapted to the range (1 s to 1 day bins), zoom by click or drag, a table view, and level colors validated for both themes; query results with a `bin()` column are charted too.
- **Background scans.** Up to 5 days of a group can be read in the background (`lib/awsLogScans.js`): state and progress live in the cache database, the newest hour is read first, a range asked by a scan is pinned beyond the group window, and the scan stops at the cache budget instead of making pruning evict it. 18d (#91) reuses this runner for scheduled syncs.
- **Raw logs stay in the provider tab** (Phase 17 direction): Observability shows aggregates and links to AWS → CloudWatch Logs for the events.

Next slices, in order (one ticket each):

1. **18b Kubernetes sources (#89).** Feed retained lines of opened Pod/workload log tabs through the same aggregates (opt-in per workload), replacing the session-only measurement.
2. **18c Historical rates in Overview (#90).** Chart the 30-day buckets next to APM metrics and evaluate log thresholds (error rate, recurring signature growth) in the same threshold engine; alerting reuses it instead of a parallel rule set.
3. **18d Scheduled sync (#91).** Optional background sync of cached groups inside the existing APM scheduler and per-profile request budget (FilterLogEvents has no scan charge, but it still counts as requests).
4. **18e GCP and Vercel sources (#92).** Cloud Logging and Vercel runtime logs plug into `ingest` through their adapters with the same extractor.
5. **18f Assisted diagnosis (Intelligent System / AI Ops, #93).** Any model-based analysis consumes the aggregates and sanitized samples, never raw logs, and its output enters the same findings and suggestions flow with explicit evidence and confidence (aligned with recommendations in #54).

Guardrails for every slice: the cache and the intelligence tables are local-only and excluded from KUAAppBundle and cloud backups (#25, #31); suggestions always require confirmation; findings name their evidence and freshness.

Exit criteria for the AWS slice: a cached Lambda's errors, recurring signatures and references appear in the application's Intelligent topology without opening the logs, and a referenced resource in the same application appears as a reviewable suggestion.

### Phase 19: Advisor — good practices per provider, product lens per application

Delivered first slice. The overviews answer "what is running and how is it doing"; the Advisor adds "what should change". Two lenses, kept apart on purpose:

- **Technical lens in each provider overview** (Kubernetes, AWS, GCP): security, infrastructure, architecture and development. These are properties of resources and accounts, so they live where those resources are listed.
- **Product lens in KUApps**: objectives (breached, or left at KUA defaults), ownership, environment and release path (production without a pre-production stage), architecture of the user journeys, and telemetry coverage and freshness. These are properties of an application, so they live on the application.

Design rules, shared with the log recommendations of Phase 18:

- **Deterministic and evidence-first.** Every finding names its rule, severity, the affected resources (first 10 and the real count) and the provider documentation. No model calls; an AI slice must keep this shape (#93).
- **No billed reads.** Kubernetes reuses the overview lists plus NetworkPolicies, PodDisruptionBudgets and HPAs. AWS reads only free control-plane APIs (IAM credential report, CloudTrail, EC2/RDS/EKS Describe, Lambda List), cached 15 minutes per profile and region; no Cost Explorer, CloudWatch metrics or S3 requests. GCP reuses the rows the overview already collected. The product lens reads the KUApps registry only.
- **Partial data is explicit.** Each source settles on its own; a source that cannot be read is listed as not checked, with the IAM actions it needs, and its rules are skipped instead of reported as passing.
- **Pure rules, thin adapters.** `lib/advisor/{kubernetes,aws,gcp,product}.js` turn collected data into one report shape (`lib/advisor/core.js`); the frontend renders it with one component (`AdvisorPanel.vue`) and i18n keys `advisor.rule.<id>.title/body`.
- **Provider-neutral endpoint for the product lens** (`GET /api/architecture/applications/:id/advisor`), so applications of every provider, Kubernetes included, are covered.

Next slices:

1. **Accept or mute findings, and score history (#94).** Accepted risk with reason and expiry, audited; posture trend stored in the snapshot history.
2. **Coverage (#95).** S3 (billed requests, shown before scanning), IAM policies, Kubernetes RBAC and Pod Security Admission, a Vercel overview, and a freshness check for the hand-maintained deprecated-runtime lists.
3. **Product lens v2 (#96).** Error budget and burn rate, DORA metrics from deployments, and the technical findings that affect the application's own resources (filtered by registry membership).

Exit criteria for the first slice: every overview shows its Advisor with no additional cost, and every KUA Application shows its product lens.

### Deferred: GCP and Vercel architecture discovery

GCP and Vercel adapters remain planned entries in [ArchitectureView.vue](../../frontend/src/ArchitectureView.vue#L20); the model and manual resources are ready, but there is no operative discovery yet. This stays out of scope until AWS and Kubernetes gaps above (Phases 9-15) are closed.

### Phase 17 (proposed, needs confirmation): provider is a navigation hint, not a resource identity

The 2026-08-27 duplication fix (Kubernetes resources appearing twice between Architecture and Observability) was caused by `apm_resources.provider` reflecting the **application's** hosting cloud (e.g. `aws` for an EKS-hosted app) rather than the **resource's own** provider, feeding directly into canonical registry identity. The proposed next step, raised by the user, generalizes that fix into a standing rule instead of a one-off patch:

- Stop deriving any resource's canonical identity from the KUA Application's or the current UI tab's provider. A resource's provider must always come from the resource itself (its native platform: Kubernetes cluster/context, AWS account/region, GCP project, Vercel team), never inherited from its parent application.
- Treat the KUA Application as a **platform boundary**, not a provider boundary: one application can and should mix AWS, GCP, Vercel and Kubernetes resources without any of them borrowing the application's top-level `provider` field for their own identity or grouping.
- Keep provider-specific raw log viewers (CloudWatch/kubectl/GCP/Vercel logs) inside their own provider tab (AWS/GCP/Vercel/Kubernetes), reached through the Phase 10 navigation actions. Observability/APM stays multicloud and aggregate-only: metrics, health, collection state and links out to the owning provider tab for raw logs, never an embedded provider-specific log console of its own.

This item needs explicit confirmation before implementation because it changes a stored data model (`apm_resources.provider`, `kua_registry_resources.provider`) that other code paths already depend on (collectors, thresholds, cost/region grouping). Open questions to resolve before starting:

- Does `apm_resources.provider` stop existing entirely, or does it stay as an application-level default while every individual resource gets its own authoritative provider column?
- Is any UI/navigation change required beyond what Phase 10 already built (provider tabs already own their log viewers for Kubernetes/Lambda; AWS EC2/EventBridge/Step Functions/SQS detail navigation is still partial per the future-improvements notebook)?
- Does this require a data migration for existing installations, or can it be introduced additively (new `resourceProvider` column/derivation) the same way the 2026-08-27 fix self-healed on the next reconcile?

Exit criteria (once scope is confirmed): no code path infers a resource's provider from its parent application or the active UI tab; the shared registry identity is stable across every entry point (manual add, EKS/Kubernetes discovery, Architecture import) without needing app-provider knowledge.

## Analysis Roadmap

The analysis engine should combine three evidence classes without pretending they have equal certainty:

- **Declared**: CloudFormation, Kubernetes ownership, deployment manifests, Vercel project configuration and source metadata.
- **Observed**: metrics, collection runs, events and sanitized execution traces.
- **Inferred**: name/type heuristics or unresolved references, always shown as suggestions.

Future scoring should report topology coverage, operational health, evidence freshness and confidence separately. A single score can be useful as a summary, but it must link to the underlying findings and never hide partial data.

Recommendations are the output of that engine: Phase 18 (logs) and Phase 19 (Advisor) already follow these rules, with findings that name their evidence, freshness and confidence.

## Provisioning, Cost and Control Roadmap

KUA Application should also become the boundary for planning and creating infrastructure, not only observing it after it exists. The detailed plan lives in [KUA Provisioning and Control Plan](./provisioning-and-control-plan.md).

The high-level direction is:

- model planned resources inside KUApps/Architecture before cloud mutation;
- estimate cost while the plan is being assembled;
- generate Terraform/OpenTofu or provider-native manifests for durable changes;
- import applied resources back into the shared registry;
- expose live controls through typed operations with guarded destructive actions.

This extends the same safety principles used by discovery: preview before mutation, provider-scoped capabilities, explicit confirmation, audit logging and no uncontrolled delete path.

## Risks and Guardrails

- **Data migration risk**: use links and read-through compatibility before moving records.
- **Identity collisions**: require strong provider identity and surface ambiguous matches for review.
- **Scope leakage**: enforce profile, account, project, region and context at every adapter boundary.
- **Telemetry privacy**: preserve sanitization, aggregation, local retention and on-demand payload reads.
- **Overloaded diagrams**: support application subviews, provider filters and route-focused views instead of drawing every account resource by default.
- **Provider coupling**: keep provider logic in adapters and keep graph, review and analysis contracts provider-neutral.
- **Stale truth**: show last successful sync and evidence age; never present an old graph as current without status.

## Success Metrics

- No duplicate configuration for a resource used by both observability and architecture.
- A user can open the diagram from an APM finding in one action.
- A user can open metrics and traces from a selected architecture node in one action.
- Repeated discovery preserves stable node/resource identity and human decisions.
- Every cross-provider relationship has declared or observed evidence, or an explicit human confirmation.
- Sync, collection and analysis show freshness and partial-result states.
- AWS, GCP, Vercel and Kubernetes can coexist inside one application without provider-specific branching in the core model.

## Explicitly Out of Scope for the Current Phase

- Replacing the existing APM and Architecture stores in one migration.
- Automatic causal relationships based only on names.
- Persisting raw logs, request/response payloads, credentials or secrets.
- Full GCP, Vercel or Kubernetes architecture discovery in the CloudFormation sync milestone.
- AI-generated remediation or autonomous production changes.

## KUApps convergence and MCP addendum — 2026-10-05

Tracking: [#146](https://github.com/lnavarrocarter/kuadashboard/issues/146).

The review of the development workspace and GitHub tickets found #17–#21 closed as completed. The code now includes the shared resources component in Observability, GCP/Vercel discovery and operational Canvas navigation/overlays. Their older problem descriptions above are historical; these delivered capabilities are the foundation for the next milestone.

The remaining product gap is application-level ownership and onboarding: `KUAppsView.openObservabilitySetup()` switches to Observability and opens the APM setup modal, while Architecture has a separate resource discovery/import workflow. A shared registry alone does not make these one application experience.

### Product contract

A KUApp owns resource membership, connection scopes and reviewed relationships. Architecture projects are views of those resources; Observability supplies their supported operational signals. Membership must not require a diagram or an enabled collector. Removing a diagram node, detaching a resource from the application and deleting live infrastructure are distinct operations. Resolve provider/profile/account/project/context/location from each resource's scope rather than inheriting the application's hosting provider. Design the compatibility migration before changing stored identities.

The contract is fixed in [KUA Application Contract](./kuapps-application-contract.md) (#149): an application has no provider or profile of its own, scopes are portable, local profiles are bound per scope on each computer and never exported, and resource identity v2 excludes the profile.

### Ordered delivery

1. **Application context and creation:** application-first entry and a KUApps form for identity, environment, team and connections; persist application/project/resource selection. Reuse existing context persistence.
2. **One Add resources workflow:** extract/reuse Architecture's provider/scope → preview → filtering/explicit selection → summary → add pattern from Resources, Architecture and Observability. Show existing membership and preserve relationships to existing nodes. Telemetry configuration is a separate opt-in step.
3. **Shared membership service:** reuse existing discovery adapters and ApplicationRegistryService through common orchestration for add/update/detach, stable identities, idempotency, concurrency, audit and defined rollback/partial failure behavior. Do not require a project to associate resources.
4. **Application workspace:** Resources and Relationships belong to KUApps. Architecture and Observability share selection and a capability-aware resource inspector for detail, relationships, metrics, logs and traces. Reuse #18/#20/#21; show unsupported, disabled, no-data, stale and failed states explicitly.
5. **Compatibility and portability:** preserve existing applications/projects. Audit multi-project bundles: kuaAppIo currently exports the singular architectureProjectId, and local import does not restore operational registry membership. Define versioning/migration and roundtrip semantics before advertising complete portability.
6. **MCP:** expose application/resource/graph reads first, then creation, discovery preview, resource attachment, project linking and graph operations through the same service as the UI. Extend the GET-only HTTP client, validate server-side arguments, provide structured results and preserve expectedRevision. Idempotency is required before retrying writes after a lost response. #133 remains installation/connectivity; #48 remains provisioning.

### Integrated acceptance

- Create an empty KUApp and add existing resources without opening APM setup.
- Adding from any view produces the same canonical membership; repeated discovery does not duplicate resources or override human relationship decisions.
- AWS resources and Kubernetes workloads coexist with explicit resource scopes.
- Unsupported telemetry does not hide a resource or enable collection automatically.
- Removing a diagram node does not detach membership or delete infrastructure.
- Partial failure is rolled back or explicitly recoverable; concurrent graph edits preserve revision checks.
- UI and MCP use the same service and yield equivalent results.
- Contract/integration tests cover cross-scope inputs, duplicates, partial failure and concurrency; UI tests cover addition/navigation from each view.

This milestone starts with existing infrastructure. Provisioning and cloud collaboration do not block local KUApps convergence.

### Extension foundation and inbound MCP

Tracking: [#147](https://github.com/lnavarrocarter/kuadashboard/issues/147), linked to #146. Establish the extension contract during domain design; deliver external connections after membership/context stabilize.

KUA has two independent MCP roles: its existing server exposes KUA to agents; a new backend client consumes external MCP servers. A versioned extension manifest declares identity, contract version, capabilities, transport and allowed scopes. Internal provider adapters and external connectors normalize results through the same domain interfaces. MCP supplies transport/tool discovery, not canonical resource semantics.

Evidence records carry source/extension identity, application/resource scope, references, observation/retrieval dates, freshness and explicit observed/inferred/historical classification. External history can explain past intent, but cannot certify current infrastructure or silently confirm relationships. Preserve contradictory evidence and missing-data states.

Use [ctx history-source plugins](https://github.com/ctxrs/ctx/blob/main/docs/history-source-plugins.md) as a reference for manifests, normalized durable inputs and publication of verified generations; its source adapters do not load plugin code in-process. Its [agent plugin packaging](https://github.com/ctxrs/ctx/blob/main/docs/agent-skill-install.md) is a separate reference for distributing skills/integrations to agents. Keep ctx optional as a historical-context pilot, and verify a pinned release's MCP catalog before writing the adapter.

Delivery: capability registry/internal adapter → backend MCP client (explicit stdio and Streamable HTTP) → connection UI/lifecycle → evidence adapters → optional ctx pilot → reviewed decision support. An LLM is optional and has a separate data-sharing/cost configuration. Do not load arbitrary third-party code in Electron/backend in the MVP.

Acceptance includes source/date citations, application scopes, invalid schema/catalog-change handling, timeout/cancellation/disconnection recovery and no local workspace dependency on an external server. Commands are explicit argv without shell execution; secrets stay backend-side; selected tools and transfer scopes are enforced independently of MCP annotations. Do not automatically relay external tools through KUA's MCP server or let external content authorize writes.

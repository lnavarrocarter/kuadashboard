# KUA Unified Management Plan

## Executive Decision

KUA should converge Observability (APM) and Architecture around one product concept: a **KUA Application**.

A KUA Application is the operational boundary for one application, environment and profile. It owns the confirmed resource membership and becomes the entry point for:

- live and aggregated observability;
- evidence-backed topology and architecture diagrams;
- deployments, sources and discovery state;
- relationship review and topology analysis;
- process traces, findings and future recommendations.

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
- Telemetry remains local, aggregated and retention-bound. Payloads, credentials, secrets and arbitrary logs are not persisted.
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

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

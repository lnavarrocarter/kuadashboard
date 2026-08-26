# Architecture Workspace: Phase 4

Phase 4 turns the Architecture workspace from preview-first importing into an authoritative synchronization workflow. The user still controls mutations, but KUA can now explain what changed since the last confirmed discovery and guide a safe update of the diagram.

## Goal

Make CloudFormation-backed diagrams continuously maintainable without losing human review, manual topology decisions or historical context.

## Scope

- Compare a selected source against the current graph and classify resources as new, changed, missing, unchanged or manually managed.
- Present a synchronization review before mutating the graph.
- Track the latest discovery metadata per source, including time, profile, account, region, stack set, resource count and relationship count.
- Mark missing discovered resources as stale before removal, and keep stale lifecycle actions explicit.
- Keep accepted and rejected relationship decisions authoritative across synchronization.
- Show all relationship changes after resource selection, including automatic and suggested outcomes.
- Support complete multi-stack diagrams as the default path for CloudFormation stack sets.
- Preserve the phase 3 safety contract: read-only discovery, explicit confirmation, profile isolation and optimistic revisions.

## First Milestone

The first implementation milestone is authoritative CloudFormation synchronization for selected stacks:

1. Run discovery for the selected stack set.
2. Compare the preview with the existing graph by source and strong AWS identity.
3. Show a review grouped by resource change type and relationship change type.
4. Apply the accepted synchronization as one graph revision.
5. Record sync metadata and expose it in the project view.

## Resource Sync States

| State | Meaning | Default action |
| --- | --- | --- |
| New | Present in discovery but absent from the graph. | Add after confirmation. |
| Changed | Same identity with changed display metadata, source metadata or evidence. | Update after confirmation. |
| Missing | Previously discovered from the same source but absent from current discovery. | Mark stale first. |
| Stale | Missing resource already reviewed as stale. | Keep, restore or remove explicitly. |
| Unchanged | Same identity and no relevant metadata changes. | No mutation. |
| Manual | User-created or source-independent node. | Never changed by sync. |

## Relationship Sync States

| State | Meaning | Default action |
| --- | --- | --- |
| New | Evidence now supports a relationship not currently in the graph. | Add as automatic or suggested by threshold. |
| Reinforced | Existing relationship has new or stronger evidence. | Update evidence without overriding review decisions. |
| Missing evidence | Previously discovered relationship is no longer supported by the selected source. | Mark stale unless manually confirmed. |
| Rejected | User rejected this relationship previously. | Keep rejected and hidden from canvas. |
| Manual | User-created relationship. | Never changed by sync. |

## Acceptance Criteria

| Area | Required result |
| --- | --- |
| Source scope | CloudFormation sync only evaluates resources from the selected stack or stack set. |
| Review | No new, changed, stale or removed resource mutates the graph without explicit confirmation. |
| Identity | Strong AWS identity reconciliation remains idempotent across repeated syncs. |
| Human decisions | Manual and rejected relationship decisions are preserved. |
| Stale lifecycle | Missing discovered resources become stale before removal. |
| Metadata | Project and source views show the latest successful sync time, resource count and relationship count. |
| Atomicity | One accepted sync produces one graph revision and fails on outdated expected revision. |
| Validation | Focused backend sync tests, HTTP integration tests and frontend review-flow tests pass. |

## Deferred Beyond Phase 4A

- Source-code discovery and static dependency parsing.
- Terraform state and plan comparison.
- GitOps and ArgoCD/Flux source reconciliation.
- GCP, Azure and multi-cloud Architecture discovery.
- Operational overlays, recommendations and AI-assisted analysis.

## Closure Evidence

Phase 4 closes when a representative multi-stack CloudFormation application can be synchronized repeatedly with stable node count, visible stale review, preserved human decisions and passing focused plus full test suites.
# Architecture Workspace: Phase 3

Phase 3 establishes the AWS Architecture workspace as a reliable, evidence-backed modeling tool. It is complete when the acceptance criteria below pass on the supported test suites and a real AWS validation account.

## Scope

- Create profile-scoped Architecture projects.
- Discover AWS resources through read-only regional inventory and CloudFormation reads.
- Preview resources and inferred relationships before any mutation.
- Import an explicit selection atomically with optimistic revision checks.
- Reconcile rediscovered resources by stable AWS identity without duplicating historical nodes.
- Preserve manual and rejected relationship decisions during rediscovery.
- Model API Gateway routes, Lambda, EventBridge, SQS, S3, IAM and Step Functions relationships with evidence.
- Inspect APL routes and Step Functions ASL workflows.
- Edit the graph manually, arrange it by request flow or resource type, and persist the selected view.
- Create snapshots, inspect change history, compare revisions and revert safely.

## Acceptance Criteria

| Area | Required result |
| --- | --- |
| Discovery safety | AWS operations are read-only, budgeted and require explicit resource selection. |
| Inventory | A CloudFormation import retains all supported stack resources instead of applying the APM allowlist. |
| Identity | Importing the same resources again updates existing nodes; legacy IDs with the same ARN or CloudFormation identity are reconciled. |
| Human review | Accepted or rejected inferred relationships are not overwritten by rediscovery. |
| Atomicity | One import produces one graph revision and fails on an outdated expected revision. |
| Canvas | Positions, arrangement mode, direction and relationship-label preference survive a reload and snapshots. |
| Navigation | API Gateway routes expose method/path evidence and navigate to their Lambda references. |
| Validation | Backend graph tests, HTTP integration tests, frontend Canvas tests and the complete backend/frontend suites pass. |
| Real environment | A representative AWS account can preview, import, arrange and rediscover a multi-stack application without node growth. |

## Reconciliation Contract

Rediscovery is non-destructive. It adds new selected resources and updates matching resources, but it does not remove an existing node merely because that node is absent from a partial preview or was not selected.

A discovered node matches an existing node through a strong identity in this order:

1. Exact graph ID.
2. AWS ARN.
3. Provider, account, region, kind and native/discovery identity.
4. Provider, account, region, stack, kind and CloudFormation logical ID.

When historical duplicates match the same discovered resource, the existing primary ID is retained and edges, groups and layout references are remapped to it. Manual relationship decisions take precedence over newly inferred state.

## Deferred To Phase 4

- Authoritative CloudFormation synchronization with new, changed and missing-resource review.
- Visible sync status, last-discovery metadata and stale-resource lifecycle.
- Source-code, Terraform state and GitOps discovery.
- GCP, Azure and multi-cloud Architecture discovery.
- Operational topology overlays, recommendations and AI-assisted analysis.
- Full browser automation against live AWS credentials; phase 3 uses deterministic HTTP/component coverage plus manual real-account validation.

## Closure Evidence

The phase is closed only when the release branch records:

- Passing backend Architecture tests.
- Passing frontend Architecture tests and production build.
- Passing full backend and frontend suites.
- A clean rediscovery validation on a representative multi-stack AWS project.
- The release date and validation result in the changelog.

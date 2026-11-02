---
title: "KUApps action catalog"
description: "What every KUApps and Observability action touches before it runs: local stores, application revision, cloud calls, cost, destructive actions and the UI data it reloads."
---

# KUApps action catalog

Every route that changes something in KUApps or Observability is declared in one catalog, `frontend/src/shared/actionCatalog.json`, before it runs. The backend validates it (`lib/kua/actionCatalog.js`) and a test fails when a write route is missing from it or a catalogued route no longer exists. The UI task coordinator (`frontend/src/lib/taskCoordinator.js`) reads from the same file what each write makes stale, so a burst of writes ends in one reload of only those parts.

## Fields

| Field | Meaning |
|---|---|
| `kind` | `read` (a POST that only computes, such as a preview), `write` (changes data on this computer), `cloud-read` / `cloud-write` (calls a cloud or provider API), `external-write` (sends data outside this computer that is not a cloud resource: KUA account backups, sync, team, GitHub) |
| `stores` | Local stores it writes: `apm-db` (applications, resources, dependencies, metrics), `architecture-graph`, `registry` (the shared resource and relationship registry), `scopes`, `change-plans`, `log-cache`, `local-settings`, plus `control-plane` and `github` outside this computer |
| `derives` | What is recomputed as a consequence, once per request (for example the registry reconciliation after a dependency is confirmed) |
| `revision` | `moves`: increments the application revision, so a stale preview or form is refused; `checked`: accepts `expectedRevision` and refuses with `409 REVISION_CONFLICT` without writing; `checked-moves`: both; `graph`: uses the Architecture graph revision; `none` |
| `invalidates` | UI data reloaded after it: `overview`, `topology`, `forecast`, `registry` (Observability) and `kuapps.registry`, `kuapps.missing` (KUApps) |
| `batchable` | One request handles a list |
| `cost` | Priced cloud calls it can make, or nothing |
| `destructive` | Deletes, detaches or overwrites; always audited |
| `audit` | Writes an entry in the audit log, with the client that asked (`ui` or `mcp`) |

## Rules

- Adding a write route means adding its entry; the test names the missing route.
- A destructive action is always audited, and anything that writes outside this computer is `external-write`.
- Cost is declared here and in the UI before the call; free List/Describe reads are `cloud-read` with no cost.
- After changing the catalog, run `node scripts/generate-action-catalog-docs.js` to update the table below (a test checks it).

## Actions

<!-- action-catalog:start -->

| Action | Route | Kind | Writes | Recomputes | Revision | UI reloads | Notes |
|---|---|---|---|---|---|---|---|
| `agent-access.set` | `PUT /api/kua-apps/agent-access` | write | `local-settings` | — | none | — | audited |
| `apm-application.create` | `POST /api/observability/:provider/applications` | write | `apm-db` | — | none | — | audited |
| `apm-application.delete` | `DELETE /api/observability/:provider/applications/:applicationId` | write | `apm-db`, `registry`, `scopes` | — | none | — | destructive · audited |
| `apm-application.update` | `PATCH /api/observability/:provider/applications/:applicationId` | write | `apm-db` | — | moves | `overview` | audited |
| `application.create` | `POST /api/kua-apps/applications` | write | `apm-db`, `scopes` | — | none | — | audited |
| `application.delete` | `DELETE /api/kua-apps/applications/:applicationId` | write | `apm-db`, `registry`, `scopes` | — | checked | — | destructive · audited |
| `application.update` | `PATCH /api/kua-apps/applications/:applicationId` | write | `apm-db` | — | checked-moves | `overview` | audited |
| `bundle.import` | `POST /api/kua-apps/import` | write | `apm-db`, `scopes`, `architecture-graph` | `registry` | none | — | audited |
| `bundle.import-preview` | `POST /api/kua-apps/import/preview` | read | — | — | none | — | — |
| `change-plan.apply` | `POST /api/kua-apps/changes/:planId/apply` | write | `change-plans`, `apm-db`, `scopes` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · batch · audited · cost: CloudWatch GetMetricData; CloudWatch Logs FilterLogEvents |
| `change-plan.preview` | `POST /api/kua-apps/changes/preview` | write | `change-plans` | — | none | — | — |
| `cloud-backup.create` | `POST /api/kua-apps/:applicationId/cloud-backup` | external-write | `control-plane` | — | none | — | audited |
| `cloud-backup.restore` | `POST /api/kua-apps/cloud-backups/:backupId/restore` | write | `apm-db`, `scopes`, `architecture-graph` | `registry` | none | — | audited |
| `collection.run` | `POST /api/observability/:provider/applications/:applicationId/collect-now` | cloud-read | `apm-db` | — | none | `overview`, `forecast` | audited · cost: CloudWatch GetMetricData; CloudWatch Logs FilterLogEvents |
| `deployment.preview` | `POST /api/observability/:provider/deployment-resources` | cloud-read | — | — | none | — | batch |
| `edge.confirm` | `POST /api/observability/:provider/applications/:applicationId/edges` | write | `apm-db` | `registry`, `scopes` | none | `topology`, `registry`, `kuapps.registry` | audited |
| `edge.confirm-batch` | `POST /api/observability/:provider/applications/:applicationId/edges/batch` | write | `apm-db` | `registry`, `scopes` | checked | `topology`, `registry`, `kuapps.registry` | batch · audited |
| `edge.remove` | `DELETE /api/observability/:provider/applications/:applicationId/edges/:edgeId` | write | `apm-db` | `registry`, `scopes` | none | `topology`, `registry`, `kuapps.registry` | destructive · audited |
| `github-sync.configure` | `PUT /api/kua-apps/applications/:applicationId/github` | write | `local-settings` | — | none | — | audited |
| `kubernetes-discovery.preview` | `POST /api/observability/:provider/applications/:applicationId/discovery/kubernetes/preview` | cloud-read | — | — | none | — | batch |
| `log-cache.disable` | `DELETE /api/observability/:provider/applications/:applicationId/log-cache` | write | `log-cache` | — | none | `overview` | destructive · audited |
| `log-cache.enable` | `POST /api/observability/:provider/applications/:applicationId/log-cache` | cloud-read | `log-cache` | — | none | `overview` | — |
| `log-cache.set-refresh` | `PATCH /api/observability/:provider/applications/:applicationId/log-cache` | write | `log-cache` | — | none | — | — |
| `missing-resource.ignore` | `POST /api/kua-apps/applications/:applicationId/observer/ignore` | write | `apm-db` | — | none | `kuapps.missing` | — |
| `process.trace` | `POST /api/observability/:provider/applications/:applicationId/process-traces` | cloud-read | — | — | none | — | audited |
| `recommendation.dismiss` | `POST /api/kua-apps/applications/:applicationId/recommendations/dismiss` | write | `apm-db` | — | none | — | audited |
| `registry-resource.detach` | `DELETE /api/kua-apps/applications/:applicationId/registry/resources/:resourceId` | write | `registry`, `apm-db` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · audited |
| `registry.reconcile` | `POST /api/observability/:provider/applications/:applicationId/registry/reconcile` | write | `registry` | — | none | `kuapps.registry` | audited |
| `relationship.explain` | `POST /api/kua-apps/applications/:applicationId/relationships/explain` | read | — | — | none | — | — |
| `relationship.review` | `POST /api/observability/:provider/applications/:applicationId/registry/relationships/:relationshipId/review` | write | `architecture-graph` | `registry`, `scopes` | graph | `registry`, `kuapps.registry` | audited |
| `resource-candidate.discover` | `POST /api/observability/:provider/candidates` | read | — | — | none | — | batch |
| `resource.attach` | `POST /api/observability/:provider/applications/:applicationId/resources` | write | `apm-db` | `registry`, `scopes` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | audited |
| `resource.attach-batch` | `POST /api/kua-apps/applications/:applicationId/resources/attach` | write | `apm-db`, `scopes` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | batch · audited |
| `resource.detach` | `DELETE /api/observability/:provider/applications/:applicationId/resources/:resourceId` | write | `apm-db` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · audited |
| `resource.replace-with-successor` | `POST /api/kua-apps/applications/:applicationId/observer/replace` | write | `apm-db` | `registry`, `scopes` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · audited |
| `resource.update` | `PATCH /api/observability/:provider/applications/:applicationId/resources/:resourceId` | write | `apm-db` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | audited |
| `scope.add` | `POST /api/kua-apps/applications/:applicationId/scopes` | write | `scopes` | — | checked-moves | `kuapps.registry` | audited |
| `scope.bind` | `PUT /api/kua-apps/applications/:applicationId/scopes/:scopeKey/binding` | write | `scopes` | — | none | `kuapps.registry` | audited |
| `scope.remove` | `DELETE /api/kua-apps/applications/:applicationId/scopes/:scopeKey` | write | `scopes` | — | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · audited |
| `scope.unbind` | `DELETE /api/kua-apps/applications/:applicationId/scopes/:scopeKey/binding` | write | `scopes` | — | none | `kuapps.registry` | destructive · audited |
| `scope.verify` | `POST /api/kua-apps/applications/:applicationId/scopes/:scopeKey/binding/verify` | cloud-read | `scopes` | — | none | `kuapps.registry` | audited |
| `stack.link` | `POST /api/observability/:provider/applications/:applicationId/link-stack` | write | `apm-db` | `registry`, `scopes` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | batch · audited |
| `sync.add-here` | `POST /api/kua-apps/sync/:syncId/add` | write | `apm-db`, `scopes`, `architecture-graph`, `local-settings` | `registry` | none | — | — |
| `sync.disable` | `DELETE /api/kua-apps/:applicationId/sync` | external-write | `local-settings`, `control-plane` | — | none | — | destructive · audited |
| `sync.enable` | `POST /api/kua-apps/:applicationId/sync` | external-write | `control-plane`, `local-settings` | — | none | — | — |
| `sync.resolve-conflict` | `POST /api/kua-apps/:applicationId/sync/resolve` | external-write | `control-plane`, `apm-db`, `architecture-graph`, `local-settings` | `registry` | moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · audited |
| `sync.run` | `POST /api/kua-apps/sync/now` | external-write | `control-plane`, `apm-db`, `architecture-graph`, `local-settings` | `registry` | moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructive · batch · audited |
| `team-backup.create` | `POST /api/kua-apps/team/items/:itemId/backups` | external-write | `control-plane` | — | none | — | — |
| `team-backup.restore` | `POST /api/kua-apps/team/items/:itemId/backups/:backupId/restore` | write | `apm-db`, `scopes`, `architecture-graph` | `registry` | none | — | — |
| `team-item.import` | `POST /api/kua-apps/team/items/:itemId/import` | write | `apm-db`, `scopes`, `architecture-graph`, `local-settings` | `registry` | none | — | audited |
| `team-item.update` | `PATCH /api/kua-apps/team/items/:itemId` | external-write | `control-plane` | — | none | — | — |
| `team-member.set-permissions` | `PATCH /api/kua-apps/team/members/:userId` | external-write | `control-plane` | — | none | — | — |
| `team.sync` | `POST /api/kua-apps/team/refresh` | external-write | `control-plane`, `apm-db`, `architecture-graph`, `local-settings` | `registry` | moves | — | destructive · batch · audited |
| `thresholds.update` | `PATCH /api/observability/:provider/applications/:applicationId/thresholds` | write | `apm-db` | — | none | `overview` | audited |
| `topology.analyze-cloud` | `POST /api/observability/:provider/applications/:applicationId/topology/analyze-cloud` | cloud-read | — | — | none | — | audited |
| `view.create-from-application` | `POST /api/observability/:provider/applications/:applicationId/architecture-link/project` | write | `architecture-graph`, `apm-db` | `registry`, `scopes` | moves | `registry`, `kuapps.registry` | audited |
| `view.link` | `PATCH /api/observability/:provider/applications/:applicationId/architecture-link` | write | `apm-db` | `registry`, `scopes` | moves | `registry`, `kuapps.registry` | audited |
| `view.unlink` | `DELETE /api/observability/:provider/applications/:applicationId/architecture-link` | write | `apm-db` | `registry`, `scopes` | moves | `registry`, `kuapps.registry` | destructive · audited |

<!-- action-catalog:end -->

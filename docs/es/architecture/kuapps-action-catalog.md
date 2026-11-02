---
title: "Catálogo de acciones de KUApps"
description: "Qué toca cada acción de KUApps y Observability antes de ejecutarse: almacenamientos locales, revisión de la aplicación, llamadas cloud, costo, acciones destructivas y los datos que recarga la UI."
---

# Catálogo de acciones de KUApps

Cada ruta que cambia algo en KUApps u Observability está declarada en un único catálogo, `frontend/src/shared/actionCatalog.json`, antes de ejecutarse. El backend lo valida (`lib/kua/actionCatalog.js`) y un test falla cuando falta una ruta de escritura o una ruta del catálogo ya no existe. El coordinador de tareas de la UI (`frontend/src/lib/taskCoordinator.js`) lee del mismo archivo qué deja desactualizado cada escritura, así una ráfaga de escrituras termina en una sola recarga de solo esas partes.

## Campos

| Campo | Significado |
|---|---|
| `kind` | `read` (un POST que solo calcula, como una vista previa), `write` (cambia datos en este computador), `cloud-read` / `cloud-write` (llama a la API de una nube o proveedor), `external-write` (envía datos fuera de este computador que no son un recurso cloud: backups de la cuenta KUA, sync, team, GitHub) |
| `stores` | Almacenamientos locales que escribe: `apm-db` (aplicaciones, recursos, dependencias, métricas), `architecture-graph`, `registry` (el registro compartido de recursos y relaciones), `scopes`, `change-plans`, `log-cache`, `local-settings`, y fuera de este computador `control-plane` y `github` |
| `derives` | Lo que se recalcula como consecuencia, una vez por petición (por ejemplo la reconciliación del registry después de confirmar una dependencia) |
| `revision` | `moves`: incrementa la revisión de la aplicación, así una vista previa o un formulario desactualizado se rechaza; `checked`: acepta `expectedRevision` y responde `409 REVISION_CONFLICT` sin escribir; `checked-moves`: ambas; `graph`: usa la revisión del grafo de Architecture; `none` |
| `invalidates` | Datos que la UI recarga después: `overview`, `topology`, `forecast`, `registry` (Observability) y `kuapps.registry`, `kuapps.missing` (KUApps) |
| `batchable` | Una petición procesa una lista |
| `cost` | Llamadas cloud con costo que puede hacer, o nada |
| `destructive` | Borra, desvincula o sobrescribe; siempre se audita |
| `audit` | Escribe una entrada en el registro de auditoría, con el cliente que la pidió (`ui` o `mcp`) |

## Reglas

- Agregar una ruta de escritura obliga a agregar su entrada; el test nombra la ruta que falta.
- Una acción destructiva siempre se audita, y lo que escribe fuera de este computador es `external-write`.
- El costo se declara aquí y en la UI antes de la llamada; las lecturas List/Describe gratuitas son `cloud-read` sin costo.
- Después de cambiar el catálogo, ejecuta `node scripts/generate-action-catalog-docs.js` para actualizar la tabla (un test lo comprueba).

## Acciones

<!-- action-catalog:start -->

| Acción | Ruta | Tipo | Escribe | Recalcula | Revisión | Recarga en la UI | Notas |
|---|---|---|---|---|---|---|---|
| `agent-access.set` | `PUT /api/kua-apps/agent-access` | write | `local-settings` | — | none | — | auditada |
| `apm-application.create` | `POST /api/observability/:provider/applications` | write | `apm-db` | — | none | — | auditada |
| `apm-application.delete` | `DELETE /api/observability/:provider/applications/:applicationId` | write | `apm-db`, `registry`, `scopes` | — | none | — | destructiva · auditada |
| `apm-application.update` | `PATCH /api/observability/:provider/applications/:applicationId` | write | `apm-db` | — | moves | `overview` | auditada |
| `application.create` | `POST /api/kua-apps/applications` | write | `apm-db`, `scopes` | — | none | — | auditada |
| `application.delete` | `DELETE /api/kua-apps/applications/:applicationId` | write | `apm-db`, `registry`, `scopes` | — | checked | — | destructiva · auditada |
| `application.update` | `PATCH /api/kua-apps/applications/:applicationId` | write | `apm-db` | — | checked-moves | `overview` | auditada |
| `bundle.import` | `POST /api/kua-apps/import` | write | `apm-db`, `scopes`, `architecture-graph` | `registry` | none | — | auditada |
| `bundle.import-preview` | `POST /api/kua-apps/import/preview` | read | — | — | none | — | — |
| `change-plan.apply` | `POST /api/kua-apps/changes/:planId/apply` | write | `change-plans`, `apm-db`, `scopes` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · en lote · auditada · costo: CloudWatch GetMetricData; CloudWatch Logs FilterLogEvents |
| `change-plan.preview` | `POST /api/kua-apps/changes/preview` | write | `change-plans` | — | none | — | — |
| `cloud-backup.create` | `POST /api/kua-apps/:applicationId/cloud-backup` | external-write | `control-plane` | — | none | — | auditada |
| `cloud-backup.restore` | `POST /api/kua-apps/cloud-backups/:backupId/restore` | write | `apm-db`, `scopes`, `architecture-graph` | `registry` | none | — | auditada |
| `collection.run` | `POST /api/observability/:provider/applications/:applicationId/collect-now` | cloud-read | `apm-db` | — | none | `overview`, `forecast` | auditada · costo: CloudWatch GetMetricData; CloudWatch Logs FilterLogEvents |
| `deployment.preview` | `POST /api/observability/:provider/deployment-resources` | cloud-read | — | — | none | — | en lote |
| `edge.confirm` | `POST /api/observability/:provider/applications/:applicationId/edges` | write | `apm-db` | `registry`, `scopes` | none | `topology`, `registry`, `kuapps.registry` | auditada |
| `edge.confirm-batch` | `POST /api/observability/:provider/applications/:applicationId/edges/batch` | write | `apm-db` | `registry`, `scopes` | checked | `topology`, `registry`, `kuapps.registry` | en lote · auditada |
| `edge.remove` | `DELETE /api/observability/:provider/applications/:applicationId/edges/:edgeId` | write | `apm-db` | `registry`, `scopes` | none | `topology`, `registry`, `kuapps.registry` | destructiva · auditada |
| `github-sync.configure` | `PUT /api/kua-apps/applications/:applicationId/github` | write | `local-settings` | — | none | — | auditada |
| `kubernetes-discovery.preview` | `POST /api/observability/:provider/applications/:applicationId/discovery/kubernetes/preview` | cloud-read | — | — | none | — | en lote |
| `log-cache.disable` | `DELETE /api/observability/:provider/applications/:applicationId/log-cache` | write | `log-cache` | — | none | `overview` | destructiva · auditada |
| `log-cache.enable` | `POST /api/observability/:provider/applications/:applicationId/log-cache` | cloud-read | `log-cache` | — | none | `overview` | — |
| `log-cache.set-refresh` | `PATCH /api/observability/:provider/applications/:applicationId/log-cache` | write | `log-cache` | — | none | — | — |
| `missing-resource.ignore` | `POST /api/kua-apps/applications/:applicationId/observer/ignore` | write | `apm-db` | — | none | `kuapps.missing` | — |
| `process.trace` | `POST /api/observability/:provider/applications/:applicationId/process-traces` | cloud-read | — | — | none | — | auditada |
| `recommendation.dismiss` | `POST /api/kua-apps/applications/:applicationId/recommendations/dismiss` | write | `apm-db` | — | none | — | auditada |
| `registry-resource.detach` | `DELETE /api/kua-apps/applications/:applicationId/registry/resources/:resourceId` | write | `registry`, `apm-db` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · auditada |
| `registry.reconcile` | `POST /api/observability/:provider/applications/:applicationId/registry/reconcile` | write | `registry` | — | none | `kuapps.registry` | auditada |
| `relationship.explain` | `POST /api/kua-apps/applications/:applicationId/relationships/explain` | read | — | — | none | — | — |
| `relationship.review` | `POST /api/observability/:provider/applications/:applicationId/registry/relationships/:relationshipId/review` | write | `architecture-graph` | `registry`, `scopes` | graph | `registry`, `kuapps.registry` | auditada |
| `resource-candidate.discover` | `POST /api/observability/:provider/candidates` | read | — | — | none | — | en lote |
| `resource.attach` | `POST /api/observability/:provider/applications/:applicationId/resources` | write | `apm-db` | `registry`, `scopes` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | auditada |
| `resource.attach-batch` | `POST /api/kua-apps/applications/:applicationId/resources/attach` | write | `apm-db`, `scopes` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | en lote · auditada |
| `resource.detach` | `DELETE /api/observability/:provider/applications/:applicationId/resources/:resourceId` | write | `apm-db` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · auditada |
| `resource.replace-with-successor` | `POST /api/kua-apps/applications/:applicationId/observer/replace` | write | `apm-db` | `registry`, `scopes` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · auditada |
| `resource.update` | `PATCH /api/observability/:provider/applications/:applicationId/resources/:resourceId` | write | `apm-db` | `registry` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | auditada |
| `scope.add` | `POST /api/kua-apps/applications/:applicationId/scopes` | write | `scopes` | — | checked-moves | `kuapps.registry` | auditada |
| `scope.bind` | `PUT /api/kua-apps/applications/:applicationId/scopes/:scopeKey/binding` | write | `scopes` | — | none | `kuapps.registry` | auditada |
| `scope.remove` | `DELETE /api/kua-apps/applications/:applicationId/scopes/:scopeKey` | write | `scopes` | — | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · auditada |
| `scope.unbind` | `DELETE /api/kua-apps/applications/:applicationId/scopes/:scopeKey/binding` | write | `scopes` | — | none | `kuapps.registry` | destructiva · auditada |
| `scope.verify` | `POST /api/kua-apps/applications/:applicationId/scopes/:scopeKey/binding/verify` | cloud-read | `scopes` | — | none | `kuapps.registry` | auditada |
| `stack.link` | `POST /api/observability/:provider/applications/:applicationId/link-stack` | write | `apm-db` | `registry`, `scopes` | checked-moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | en lote · auditada |
| `sync.add-here` | `POST /api/kua-apps/sync/:syncId/add` | write | `apm-db`, `scopes`, `architecture-graph`, `local-settings` | `registry` | none | — | — |
| `sync.disable` | `DELETE /api/kua-apps/:applicationId/sync` | external-write | `local-settings`, `control-plane` | — | none | — | destructiva · auditada |
| `sync.enable` | `POST /api/kua-apps/:applicationId/sync` | external-write | `control-plane`, `local-settings` | — | none | — | — |
| `sync.resolve-conflict` | `POST /api/kua-apps/:applicationId/sync/resolve` | external-write | `control-plane`, `apm-db`, `architecture-graph`, `local-settings` | `registry` | moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · auditada |
| `sync.run` | `POST /api/kua-apps/sync/now` | external-write | `control-plane`, `apm-db`, `architecture-graph`, `local-settings` | `registry` | moves | `overview`, `topology`, `forecast`, `registry`, `kuapps.registry`, `kuapps.missing` | destructiva · en lote · auditada |
| `team-backup.create` | `POST /api/kua-apps/team/items/:itemId/backups` | external-write | `control-plane` | — | none | — | — |
| `team-backup.restore` | `POST /api/kua-apps/team/items/:itemId/backups/:backupId/restore` | write | `apm-db`, `scopes`, `architecture-graph` | `registry` | none | — | — |
| `team-item.import` | `POST /api/kua-apps/team/items/:itemId/import` | write | `apm-db`, `scopes`, `architecture-graph`, `local-settings` | `registry` | none | — | auditada |
| `team-item.update` | `PATCH /api/kua-apps/team/items/:itemId` | external-write | `control-plane` | — | none | — | — |
| `team-member.set-permissions` | `PATCH /api/kua-apps/team/members/:userId` | external-write | `control-plane` | — | none | — | — |
| `team.sync` | `POST /api/kua-apps/team/refresh` | external-write | `control-plane`, `apm-db`, `architecture-graph`, `local-settings` | `registry` | moves | — | destructiva · en lote · auditada |
| `thresholds.update` | `PATCH /api/observability/:provider/applications/:applicationId/thresholds` | write | `apm-db` | — | none | `overview` | auditada |
| `topology.analyze-cloud` | `POST /api/observability/:provider/applications/:applicationId/topology/analyze-cloud` | cloud-read | — | — | none | — | auditada |
| `view.create-from-application` | `POST /api/observability/:provider/applications/:applicationId/architecture-link/project` | write | `architecture-graph`, `apm-db` | `registry`, `scopes` | moves | `registry`, `kuapps.registry` | auditada |
| `view.link` | `PATCH /api/observability/:provider/applications/:applicationId/architecture-link` | write | `apm-db` | `registry`, `scopes` | moves | `registry`, `kuapps.registry` | auditada |
| `view.unlink` | `DELETE /api/observability/:provider/applications/:applicationId/architecture-link` | write | `apm-db` | `registry`, `scopes` | moves | `registry`, `kuapps.registry` | destructiva · auditada |

<!-- action-catalog:end -->

# KUA Application Contract

Tracking: [#149](https://github.com/lnavarrocarter/kuadashboard/issues/149), part of [#146](https://github.com/lnavarrocarter/kuadashboard/issues/146). Code: `lib/kua/applicationContract.js` (contract), `lib/kua/applicationScopes.js` (migration and report).

A KUA Application (KUApp) is the context that owns identity, provider scopes, resources and architecture views. It has **no provider and no profile of its own**: one application can hold AWS accounts, GCP projects, Kubernetes contexts, Vercel teams and, later, plugin providers.

## Application context (version 1)

```json
{
  "contractVersion": 1,
  "id": "app-orders",
  "name": "Orders",
  "environment": "production",
  "team": "Platform",
  "revision": 12,
  "scopes": [
    { "key": "kua-scope:…", "provider": "aws", "scopeId": "111111111111", "location": "us-east-1", "label": "Orders account" },
    { "key": "kua-scope:…", "provider": "kubernetes", "scopeId": "eks-orders-prod", "location": "" }
  ],
  "views": { "architectureProjectIds": ["project-orders", "project-orders-data"] }
}
```

- `name` is required and is **not** an identity: two applications can share a name, and the `id` tells them apart.
- An application with no scopes is valid (an empty KUApp to which resources are added later).
- `scopes[]` is portable. `scopeId` is the AWS account, GCP project, Kubernetes context or Vercel team; `location` is the region or location when the provider has one. An empty `scopeId` means the scope has not been verified yet.
- `provider` is an open id (`^[a-z][a-z0-9-]{1,39}$`). KUA ships with `aws`, `gcp`, `vercel`, `kubernetes` and `generic`; plugins (#156) can add others, such as `zabbix`, `github` or `datadog`, without a schema change.
- Scopes with the same provider, `scopeId` and `location` collapse into one. Any `profileId` passed with a scope is dropped.

`lib/kua/applicationContract.js` exports three examples (`EXAMPLES.empty`, `EXAMPLES.kubernetesOnly`, `EXAMPLES.multiScope`) that the tests validate.

## Local bindings: profiles never travel

A profile is a credential on one computer. Each computer binds **its own** profile to a scope:

```text
binding (local only) = { scopeKey, profileId, status }
```

Bindings are never part of the context, a KUAAppBundle, sync, team sharing or the Control Plane. When an application is imported or shared, each person binds their profiles to its scopes. A scope without a binding is reported as such, and its resources stay visible. Before a binding is trusted, KUA must check that the session matches the scope: the AWS account from `sts:GetCallerIdentity` (no charge), the configured GCP project, an existing kube context, or the Vercel team.

## Resource identity v2

```text
["v2", provider, scopeId, location, resourceType, nativeIdentifier]   (lower-cased)
id = "kua-resource:" + sha256(identityKey)[0..24]
```

The identity does not include the profile or the display name. The same resource therefore has the same id on every computer, and an exported id does not reveal a credential name. The same native identifier in different scopes (for example a deployment in `staging` and in `production`) keeps two identities. Relationship ids are built from the portable ids of their two resources and their type.

The local registry (`kua_registry_resources`) uses identity v2 too. At startup, KUA drops the rows still keyed by identity v1 and reconciles every application again. The registry is derived from APM resources and architecture graphs, where human decisions live, so nothing is lost; graphs get one `registry.reconcile` revision with the new ids. Resources that v1 kept apart only by profile become one, and each merge is recorded for the migration report.

## Legacy mapping

`legacyApplicationContext(application, { resources, architectureProjectIds })` in `lib/kua/applicationScopes.js` maps an existing APM application (one provider, profile and region) to the contract without losing anything:

| Today | Contract |
| --- | --- |
| `provider` + `region` | primary scope, `scopeId` empty (unverified) unless a resource names it |
| resources' ARN account/region, kube context | one scope per distinct provider scope |
| resources of the application's provider without an account (no ARN, global S3 bucket) | the primary scope |
| `generic` provider | a scope only while the application has no resources |
| `profile_id` | local binding of the scopes of the application's own provider (`migrated`, or `unverified` when `scopeId` is empty) |
| `architecture_project_id` and the project link table | `views.architectureProjectIds` |

A Kubernetes workload inside an AWS application gets a Kubernetes scope with no binding: it is reached through its kube context, not the AWS profile.

## Storage

| Table | Travels | Content |
| --- | --- | --- |
| `apm_applications` | yes (no profile) | identity, `revision`; `provider`, `profile_id` and `region` are now optional and only describe a legacy application |
| `kua_application_scopes` | yes | portable scopes per application |
| `kua_scope_bindings` | **never** | scope → local profile, with `status` (`migrated`, `unverified`, `verified`, `mismatch`) and the verified identity |
| `kua_registry_identity_merges` | no | resources that identity v2 merged, for the report |

An application created without provider, profile or region is valid. It is not listed under any profile in Observability, and the scheduler does not collect it: collection per scope binding is [#166](https://github.com/lnavarrocarter/kuadashboard/issues/166). Application names are no longer unique. Adding or removing a scope or a view, or editing the identity, moves `revision`.

At every start, and whenever an application's resources change, legacy applications get the scopes their resources live in and a binding to their profile where none exists. A binding chosen by the user is never replaced, and scopes are never removed automatically.

## API

`/api/kua-apps/applications` serves KUA Applications through `lib/kua/applicationService.js`. The MCP tools of #154 and #155 must use the same service. The API is not scoped by `X-Profile-Id`, because an application has no profile of its own.

| Method and path | Effect |
| --- | --- |
| `GET /applications` | every application, legacy ones included |
| `POST /applications` | create from `{ name, environment, team, scopes[] }`, with no provider or profile |
| `GET /applications/:id` | one application |
| `PATCH /applications/:id` | edit `name`, `environment`, `team` |
| `DELETE /applications/:id` | delete the application and its local data; architecture projects and live infrastructure stay |
| `POST /applications/:id/scopes` | add a scope: `201` when new, `200` when it already existed |
| `DELETE /applications/:id/scopes/:scopeKey` | remove a scope; `409 SCOPE_IN_USE` while legacy resources live in it |
| `PUT /applications/:id/scopes/:scopeKey/binding` | bind a local profile `{ profileId }` and verify it |
| `POST /applications/:id/scopes/:scopeKey/binding/verify` | verify the binding again |
| `DELETE /applications/:id/scopes/:scopeKey/binding` | remove the binding |

Writes that change the application accept `expectedRevision`, in the body or the query. A stale value answers `409 REVISION_CONFLICT` with the current `revision`, and nothing is written. Bindings are local, so they do not move the revision.

A response has the contract fields, `warnings` (`scope_unbound`, `scope_unverified`, `scope_mismatch`, `duplicate_name`) and `local`. `local` holds the bindings and the legacy provider/profile/region, and must never be exported or synced.

### Verification

Verification only uses reads that have no charge:

| Provider | Read | Verified when |
| --- | --- | --- |
| AWS | `sts:GetCallerIdentity` | the account equals `scopeId` |
| GCP | the project of the gcloud configuration or service account | the project equals `scopeId` |
| Vercel | the team of the stored profile | the team equals `scopeId` |
| Kubernetes | the kube contexts of this computer | the context exists (context names differ between computers) |
| others (plugins) | none | stays `unverified` |

A different identity is `mismatch`. A failed read (expired session, missing profile) leaves the binding `unverified` with its error and never reports a mismatch. A scope without `scopeId` is completed with the identity the profile reveals: the scope is replaced and the binding moves with it, and legacy synchronization does not bring the pending scope back.

KUApps shows these applications with an **Accounts and scopes** panel (`frontend/src/components/kuapps/KUAppScopes.vue`) that adds and removes scopes, binds a profile of this computer to each one and shows the verification result. Architecture and Observability still need one profile, so for an application without a provider they open once resources can be added to its scopes ([#151](https://github.com/lnavarrocarter/kuadashboard/issues/151)). They export, import, back up and publish to the team with their scopes ([#153](https://github.com/lnavarrocarter/kuadashboard/issues/153)). A link with `?app=<id>` opens an application in KUApps.

## Resource membership
## Extension sources and evidence (#156)

`lib/kua/extensionContract.js` defines strict JSON Schemas and runtime normalizers for manifest version 1 and evidence schema version 1. Manifests identify the source, publisher, semantic version, contract version, transport/runtime, supported scopes and declared permissions. Every capability is present as an explicit boolean: `discovery`, `enrichment`, `relationshipEvidence`, `telemetry`, `historicalSearch` and `findings`. A declaration describes a source; it does not authorize remote calls or replace a user's per-connection/tool selection.

Example manifest:

```json
{
  "manifestVersion": 1,
  "id": "kua.internal",
  "version": "1.0.0",
  "contractVersion": 1,
  "source": { "kind": "builtin", "publisher": "KUA", "name": "KUA internal registry" },
  "capabilities": { "discovery": false, "enrichment": true, "relationshipEvidence": true, "telemetry": false, "historicalSearch": true, "findings": false },
  "transport": { "kind": "internal", "runtime": "node" },
  "scopes": ["application", "resource"],
  "permissions": ["kua.registry.read", "kua.architecture.history.read"]
}
```

`GET /api/kua-apps/applications/:id/extensions` lists the manifests, and `GET /api/kua-apps/applications/:id/evidence` returns evidence records plus per-source availability. An evidence record carries a source id, a safe reference, application/resource scope, observed/retrieved timestamps, optional revision/generation, freshness (`current`, `stale` or `unknown`) and class (`observation`, `inference` or `history`). Unknown schema versions, unsupported URI schemes, cross-application/resource scopes and source-id spoofing are rejected. Duplicate records from the same source collapse by id.

The initial `kua.internal` adapter is read-only. It maps existing registry resources to observations, suggested relationships to inferences, human relationship decisions to history, and Architecture changes to historical references. It does not copy snapshots, change payloads, credentials or raw evidence into a second store. Registry timestamps do not prove that cloud state was freshly observed, so the adapter reports freshness as `unknown`. A source failure is isolated in the evidence response; local resources and normal KUApps editing remain available. Evidence is not membership and never confirms a relationship.

Example evidence record:

```json
{
  "schemaVersion": 1,
  "id": "evidence:7f52d6b8",
  "sourceId": "kua.internal",
  "reference": { "kind": "kua_resource", "uri": "kua://applications/app-orders/registry/resources/resource-orders-api", "label": "orders-api" },
  "scope": { "applicationId": "app-orders", "resourceId": "resource-orders-api", "scopeKey": "kua-scope:prod" },
  "observedAt": "2026-10-06T12:00:00.000Z",
  "retrievedAt": "2026-10-06T12:01:00.000Z",
  "revision": 12,
  "generation": null,
  "freshness": "unknown",
  "class": "observation",
  "summary": "Resource is present in the local registry via apm_resource."
}
```

Evolution is fail-closed: additive or semantic changes to either strict schema increment its schema version; changes to shared adapter/runtime behavior increment `contractVersion`. A reader that encounters an unknown version marks only that source unavailable and preserves local KUApps data. Existing versions remain supported until a separately reviewed migration removes them.

## Resource membership

`ApplicationRegistryService` is the one place that attaches, updates and detaches a resource of an application (#150). The APM routes delegate to it, so Observability, Architecture and KUApps get the same behaviour.

- **Attach is idempotent.** Attaching the same resource again (same type and key) answers `200` with the existing resource instead of `201`, and creates no duplicate membership, node or relationship.
- **Revision checks.** Attach, update and detach accept `expectedRevision`. A stale value answers `409 REVISION_CONFLICT` and writes nothing. A successful attach or detach moves the application `revision`.
- **Partial failure is recoverable.** The resource is stored in one transaction. If projecting it into an Architecture view fails, the registry sync status records the error and the next reconciliation finishes the work without duplicates.
- **Detach is not delete.** Detaching removes the resource from the application and records the detachment by portable identity, so reconciliation does not attach it again from an Architecture node. The node stays in the diagram, and nothing is deleted in the cloud. Attaching the resource again clears the detachment.
- **Human decisions survive.** Relationships the user confirmed or rejected keep their status through attach, detach and reconciliation.
- **Verified scope profiles.** A profile bound and verified for one of the application's scopes can open the application's Architecture views, also for an application without a provider.

`GET /api/kua-apps/applications/:id/registry` lists the application's canonical resources and relationships with names, without local profile ids.

## Migration report

`GET /api/kua-apps/migration-report` is read-only and lists what needs a decision. It names applications, views and scopes, never profiles.

| Finding | Severity | Suggested resolution |
| --- | --- | --- |
| `scope_mismatch` | error | bind a profile whose session matches the scope |
| `scope_unbound` | warning | bind a local profile |
| `broken_view_link` | warning | unlink the missing architecture project |
| `view_profile_mismatch` | warning | the project belongs to another profile; reconciliation skips it today |
| `view_shared_by_applications` | warning | review which application owns the view |
| `registry_identity_v1` | warning | reconcile (startup does it) |
| `scope_unverified` | info | verify the scope against the session |
| `application_without_view` / `view_without_application` | info | create or link a view |
| `duplicate_name` | info | optional rename; the id is the identity |
| `resource_identities_merged` | info | none, recorded for traceability |

## Export and import (KUAAppBundle)

Tracking: [#153](https://github.com/lnavarrocarter/kuadashboard/issues/153). Code: `lib/kua/kuaAppBundle.js` (format), `lib/kua/kuaAppIo.js` (export, preview, import, sync).

### Format

The envelope stays `kind: "KUAAppBundle"`, `version: 1`, `mode: "sanitized"`, because the account service (cloud backups, sync and team) and older KUA versions only accept version 1. New content is added inside it and announced by `contentVersion` (now `2`; a bundle without it is content version 1).

| Field | Content |
| --- | --- |
| `application` | `name`, `environment`, `team`, `pollingEnabled` and `scopes[]` (`provider`, `scopeId`, `location`, `label`). `provider` and `region` only appear for a legacy application, never for one created without provider. |
| `architecture` | the first architecture view: `project`, `graph`, `snapshots`, `changes` |
| `additionalViews[]` | the other views, with the same shape |
| `registry.resources[]` | identity v2 (`sourceId`, `identityKey`, `identityVersion: 2`) and, for a resource of the application, `apm`: how to observe it again (`type`, `key`, `name`, `arn`, `kind`, `service`, `logGroup`, `kubeContext`, `namespace`, `scopeId`, `location`, `enabled`, `associationSource`) |
| `registry.relationships[]` | portable resource ids, status (`confirmed`, `rejected`, `suggested`, `automatic`) and evidence type and origin only |
| `registry.detachments[]` | identity v2 keys of resources the user detached |
| `advisor.acceptances[]` | product Advisor findings accepted or silenced |

Never in a bundle: profiles or scope bindings, credentials, kubeconfigs, tokens, secrets, change payloads, raw evidence values, telemetry, logs, metric data or thresholds. The local `id` and the v1 `identityKey` are never copied; both are recomputed when a bundle is read, so an older bundle loses its v1 keys when it is read again. `architecture.changes[].author` is `local` when the author was a local profile. Older versions exported `identityKey` with the profile id in plain text; cloud backups and team copies made before that fix keep it until the application is uploaded again.

An older KUA reads a content version 2 bundle as a legacy one: it imports the first view and ignores scopes, additional views, membership and detachments. It cannot read a bundle of an application without provider.

### Reading a bundle

Every bundle (file, cloud backup, sync, team) is checked and sanitized again on this computer. What is left out is reported, not dropped silently:

| Issue | Meaning |
| --- | --- |
| `newer_content` | made by a newer KUA; what this version does not know is ignored |
| `resource_invalid` | a resource without a valid identity |
| `relationship_dangling` | a relationship to a resource that is not in the bundle |
| `detachment_invalid` | a detachment that is not an identity v2 key |
| `view_invalid` / `views_truncated` | a view without project, or more than 100 views |

An unknown `kind` or `version`, a non-sanitized bundle or an invalid `contentVersion` is refused.

### Preview and import

`POST /api/kua-apps/import/preview` (header `X-Profile-Id`) answers what an import would do and writes nothing: the name the application gets, whether it already exists here (same source id) or shares its name, the scopes to bind (and whether this KUA supports their provider), the views and the names they get, the resources that come back, the ones that cannot and why (`no_source`, `unsupported_type`, `unsupported_provider`), resources this computer already has in other applications, resources outside the application scopes, relationship counts by status, detachments, Advisor decisions and the issues above. KUApps shows it before **Import**.

`POST /api/kua-apps/import` creates a **new** application; it never merges into an existing one:

- A bundle with `provider` and `region` becomes a legacy application of the selected profile, renamed `Name (imported)` when that profile already has the name. A bundle without them becomes a KUA Application without provider, with its own name.
- Scopes are added without bindings: each person binds a profile of their computer (see Local bindings above).
- Every view becomes an architecture project of the selected profile, with its graph and snapshots. Human decisions (rejected and confirmed relationships, manual nodes) come back with the graph.
- Detachments are restored first, so reconciling the views does not attach those resources again.
- Resources with `apm` become members again through `ApplicationRegistryService.attachResources` (#150), which is idempotent and reconciles once. A resource that joined from a view comes back with that view. Relationships drawn between members are restored. Nothing is created in the cloud and restoring a resource does not turn on collection.
- The response lists `skipped` resources with their reason. A failure rolls back the application and the projects it created.

Export and cloud backup of an application without provider work from any profile, and team publishing includes it. The account service accepts these bundles from [kua-control-plane#42](https://github.com/lnavarrocarter/kua-control-plane/pull/42); until then it refuses them, and KUA does not send the same refused bundle again until the application changes. Sync between computers is still enabled per profile, so it remains for legacy applications.

Sync between computers (`applyBundle`) takes the details, adds missing scopes (it never removes one), and updates each view, matched by name (ignoring an `(imported)` suffix) and then in order; a missing view is created once. The sync hash only includes additional views, and the scopes of an application without provider, when there are some, so existing applications keep their hash. A legacy application's scopes are derived from its resources on each computer and are not part of the hash.

The report-style export (Advisor findings, resource references, routes and communications) is not part of this format.

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

## Export (KUAAppBundle)

The bundle carries portable data only:

- `registry.resources[]` uses identity v2: `sourceId`, `identityKey` and `identityVersion: 2`. The local `id` and the v1 `identityKey` are never copied. Both are recomputed on import, so an older bundle loses its v1 keys when it is read again.
- `registry.relationships[]` point to portable resource ids. A relationship to a resource that is not in the bundle is left out.
- `architecture.changes[].author` is `local` when the author was a local profile.

Older versions exported `identityKey` with the profile id in plain text. Cloud backups and team copies made before this change keep that value until the application is uploaded again.

Restoring registry membership on import, several architecture projects per bundle, and the report-style export (Advisor, resource references, routes and communications) are part of [#153](https://github.com/lnavarrocarter/kuadashboard/issues/153).

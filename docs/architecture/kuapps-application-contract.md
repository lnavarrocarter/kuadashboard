# KUA Application Contract

Tracking: [#149](https://github.com/lnavarrocarter/kuadashboard/issues/149), part of [#146](https://github.com/lnavarrocarter/kuadashboard/issues/146). Code: `lib/kua/applicationContract.js`.

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

The local registry (`kua_registry_resources`) still uses identity v1, which includes the profile. Moving it to v2 needs a migration that reports resources whose v1 identities collapse into one v2 identity. That migration is the next step of #149.

## Legacy mapping

`legacyApplicationContext(application, { resources, architectureProjectIds })` maps an existing APM application (one provider, profile and region) to the contract without losing anything:

| Today | Contract |
| --- | --- |
| `provider` + `region` | primary scope, `scopeId` empty (unverified) unless a resource names it |
| resources' ARN account/region, kube context | one scope per distinct provider scope |
| `profile_id` | local binding of the scopes of the application's own provider (`migrated`, or `unverified` when `scopeId` is empty) |
| `architecture_project_id` and the project link table | `views.architectureProjectIds` |

A Kubernetes workload inside an AWS application gets a Kubernetes scope with no binding: it is reached through its kube context, not the AWS profile.

## Export (KUAAppBundle)

The bundle carries portable data only:

- `registry.resources[]` uses identity v2: `sourceId`, `identityKey` and `identityVersion: 2`. The local `id` and the v1 `identityKey` are never copied. Both are recomputed on import, so an older bundle loses its v1 keys when it is read again.
- `registry.relationships[]` point to portable resource ids. A relationship to a resource that is not in the bundle is left out.
- `architecture.changes[].author` is `local` when the author was a local profile.

Older versions exported `identityKey` with the profile id in plain text. Cloud backups and team copies made before this change keep that value until the application is uploaded again.

Restoring registry membership on import, several architecture projects per bundle, and the report-style export (Advisor, resource references, routes and communications) are part of [#153](https://github.com/lnavarrocarter/kuadashboard/issues/153).

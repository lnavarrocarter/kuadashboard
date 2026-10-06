# Contrato de KUA Application

Seguimiento: [#149](https://github.com/lnavarrocarter/kuadashboard/issues/149), parte de [#146](https://github.com/lnavarrocarter/kuadashboard/issues/146). Código: `lib/kua/applicationContract.js`.

Una KUA Application (KUApp) es el contexto dueño de la identidad, los scopes de provider, los recursos y las vistas de arquitectura. **No tiene provider ni perfil propios**: una misma aplicación puede reunir cuentas AWS, proyectos GCP, contextos de Kubernetes, teams de Vercel y, más adelante, providers de plugins.

## Contexto de aplicación (versión 1)

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

- `name` es obligatorio y **no** es identidad: dos aplicaciones pueden tener el mismo nombre, y el `id` las distingue.
- Una aplicación sin scopes es válida (una KUApp vacía a la que luego se le agregan recursos).
- `scopes[]` es portable. `scopeId` es la cuenta AWS, el proyecto GCP, el contexto de Kubernetes o el team de Vercel; `location` es la región o ubicación cuando el provider la tiene. Un `scopeId` vacío significa que el scope todavía no se verificó.
- `provider` es un id abierto (`^[a-z][a-z0-9-]{1,39}$`). KUA trae `aws`, `gcp`, `vercel`, `kubernetes` y `generic`; los plugins (#156) pueden agregar otros, como `zabbix`, `github` o `datadog`, sin cambiar el esquema.
- Los scopes con el mismo provider, `scopeId` y `location` se juntan en uno. Si un scope trae `profileId`, se descarta.

`lib/kua/applicationContract.js` exporta tres ejemplos (`EXAMPLES.empty`, `EXAMPLES.kubernetesOnly`, `EXAMPLES.multiScope`) que validan los tests.

## Bindings locales: los perfiles no viajan

Un perfil es una credencial de un computador. Cada computador asocia **su propio** perfil a un scope:

```text
binding (solo local) = { scopeKey, profileId, status }
```

Los bindings nunca forman parte del contexto, de un KUAAppBundle, de la sincronización, del equipo ni del Control Plane. Al importar o compartir una aplicación, cada persona asocia sus perfiles a los scopes. Un scope sin binding se informa como tal, y sus recursos siguen visibles. Antes de confiar en un binding, KUA debe verificar que la sesión calce con el scope: la cuenta AWS de `sts:GetCallerIdentity` (sin costo), el proyecto GCP configurado, que exista el contexto de kube o el team de Vercel.

## Identidad de recurso v2

```text
["v2", provider, scopeId, location, resourceType, nativeIdentifier]   (en minúsculas)
id = "kua-resource:" + sha256(identityKey)[0..24]
```

La identidad no incluye el perfil ni el nombre visible. Por eso el mismo recurso tiene el mismo id en todos los computadores, y un id exportado no revela el nombre de una credencial. El mismo identificador nativo en scopes distintos (por ejemplo, un deployment en `staging` y en `production`) mantiene dos identidades. Los ids de relaciones se arman con los ids portables de sus dos recursos y su tipo.

El registry local (`kua_registry_resources`) todavía usa la identidad v1, que incluye el perfil. Pasarlo a v2 requiere una migración que informe los recursos cuyas identidades v1 se juntan en una sola v2. Esa migración es el siguiente paso de #149.

## Mapeo legacy

`legacyApplicationContext(application, { resources, architectureProjectIds })` traduce una aplicación APM existente (un provider, un perfil y una región) al contrato sin perder nada:

| Hoy | Contrato |
| --- | --- |
| `provider` + `region` | scope primario, con `scopeId` vacío (sin verificar) salvo que un recurso lo indique |
| cuenta/región del ARN de los recursos, contexto de kube | un scope por cada scope de provider distinto |
| `profile_id` | binding local de los scopes del provider propio de la aplicación (`migrated`, o `unverified` si `scopeId` está vacío) |
| `architecture_project_id` y la tabla de enlaces de proyectos | `views.architectureProjectIds` |

Un workload de Kubernetes dentro de una aplicación AWS queda en un scope de Kubernetes sin binding: se llega a él por su contexto de kube, no por el perfil AWS.

## Export (KUAAppBundle)

El bundle lleva solo datos portables:

- `registry.resources[]` usa la identidad v2: `sourceId`, `identityKey` e `identityVersion: 2`. El `id` local y el `identityKey` v1 nunca se copian. Ambos se recalculan al importar, así que un bundle antiguo pierde sus claves v1 al leerse otra vez.
- `registry.relationships[]` apuntan a ids portables. Una relación con un recurso que no está en el bundle queda fuera.
- `architecture.changes[].author` es `local` cuando el autor era un perfil local.

Las versiones anteriores exportaban `identityKey` con el id del perfil en texto plano. Los respaldos en la nube y las copias de equipo hechos antes de este cambio conservan ese valor hasta que la aplicación se vuelva a subir.

Restaurar la membresía del registry al importar, varios proyectos de arquitectura por bundle y el export como informe (Advisor, referencias de recursos, rutas y comunicaciones) son parte de [#153](https://github.com/lnavarrocarter/kuadashboard/issues/153).

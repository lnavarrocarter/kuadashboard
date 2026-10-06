# Contrato de KUA Application

Seguimiento: [#149](https://github.com/lnavarrocarter/kuadashboard/issues/149), parte de [#146](https://github.com/lnavarrocarter/kuadashboard/issues/146). Código: `lib/kua/applicationContract.js` (contrato), `lib/kua/applicationScopes.js` (migración y reporte).

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

El registry local (`kua_registry_resources`) también usa la identidad v2. Al arrancar, KUA elimina las filas que siguen con identidad v1 y vuelve a reconciliar cada aplicación. El registry se deriva de los recursos APM y de los grafos de arquitectura, donde viven las decisiones humanas, así que no se pierde nada; los grafos reciben una revisión `registry.reconcile` con los ids nuevos. Los recursos que v1 separaba solo por perfil pasan a ser uno, y cada unión queda registrada para el reporte de migración.

## Mapeo legacy

`legacyApplicationContext(application, { resources, architectureProjectIds })`, en `lib/kua/applicationScopes.js`, traduce una aplicación APM existente (un provider, un perfil y una región) al contrato sin perder nada:

| Hoy | Contrato |
| --- | --- |
| `provider` + `region` | scope primario, con `scopeId` vacío (sin verificar) salvo que un recurso lo indique |
| cuenta/región del ARN de los recursos, contexto de kube | un scope por cada scope de provider distinto |
| recursos del provider de la aplicación sin cuenta (sin ARN, bucket S3 global) | el scope primario |
| provider `generic` | un scope solo mientras la aplicación no tiene recursos |
| `profile_id` | binding local de los scopes del provider propio de la aplicación (`migrated`, o `unverified` si `scopeId` está vacío) |
| `architecture_project_id` y la tabla de enlaces de proyectos | `views.architectureProjectIds` |

Un workload de Kubernetes dentro de una aplicación AWS queda en un scope de Kubernetes sin binding: se llega a él por su contexto de kube, no por el perfil AWS.

## Almacenamiento

| Tabla | Viaja | Contenido |
| --- | --- | --- |
| `apm_applications` | sí (sin perfil) | identidad, `revision`; `provider`, `profile_id` y `region` ahora son opcionales y solo describen una aplicación legacy |
| `kua_application_scopes` | sí | scopes portables por aplicación |
| `kua_scope_bindings` | **nunca** | scope → perfil local, con `status` (`migrated`, `unverified`, `verified`, `mismatch`) y la identidad verificada |
| `kua_registry_identity_merges` | no | recursos que la identidad v2 unió, para el reporte |

Una aplicación creada sin provider, perfil ni región es válida. No aparece bajo ningún perfil en Observabilidad y el scheduler no la recolecta: la recolección por binding de scope es [#166](https://github.com/lnavarrocarter/kuadashboard/issues/166). Los nombres de aplicación ya no son únicos. Agregar o quitar un scope o una vista, o editar la identidad, mueve `revision`.

En cada arranque, y cada vez que cambian los recursos de una aplicación, las aplicaciones legacy reciben los scopes donde viven sus recursos y un binding a su perfil donde no haya uno. Un binding elegido por el usuario nunca se reemplaza, y los scopes nunca se quitan automáticamente.

## API

`/api/kua-apps/applications` sirve las KUA Applications a través de `lib/kua/applicationService.js`. Las herramientas MCP de #154 y #155 deben usar el mismo servicio. La API no se limita por `X-Profile-Id`, porque una aplicación no tiene perfil propio.

| Método y ruta | Efecto |
| --- | --- |
| `GET /applications` | todas las aplicaciones, incluidas las legacy |
| `POST /applications` | crear desde `{ name, environment, team, scopes[] }`, sin provider ni perfil |
| `GET /applications/:id` | una aplicación |
| `PATCH /applications/:id` | editar `name`, `environment`, `team` |
| `DELETE /applications/:id` | eliminar la aplicación y sus datos locales; los proyectos de arquitectura y la infraestructura real se mantienen |
| `POST /applications/:id/scopes` | agregar un scope: `201` si es nuevo, `200` si ya existía |
| `DELETE /applications/:id/scopes/:scopeKey` | quitar un scope; `409 SCOPE_IN_USE` mientras tenga recursos legacy |
| `PUT /applications/:id/scopes/:scopeKey/binding` | asociar un perfil local `{ profileId }` y verificarlo |
| `POST /applications/:id/scopes/:scopeKey/binding/verify` | volver a verificar el binding |
| `DELETE /applications/:id/scopes/:scopeKey/binding` | quitar el binding |

Las escrituras que cambian la aplicación aceptan `expectedRevision`, en el body o en la query. Un valor obsoleto responde `409 REVISION_CONFLICT` con la `revision` actual, y no se escribe nada. Los bindings son locales, así que no mueven la revisión.

Una respuesta tiene los campos del contrato, `warnings` (`scope_unbound`, `scope_unverified`, `scope_mismatch`, `duplicate_name`) y `local`. `local` contiene los bindings y el provider/perfil/región legacy, y nunca debe exportarse ni sincronizarse.

### Verificación

La verificación solo usa lecturas sin costo:

| Provider | Lectura | Verificado cuando |
| --- | --- | --- |
| AWS | `sts:GetCallerIdentity` | la cuenta es igual a `scopeId` |
| GCP | el proyecto de la configuración de gcloud o de la service account | el proyecto es igual a `scopeId` |
| Vercel | el team del perfil guardado | el team es igual a `scopeId` |
| Kubernetes | los contextos de kube de este computador | el contexto existe (los nombres de contexto cambian entre computadores) |
| otros (plugins) | ninguna | queda `unverified` |

Una identidad distinta es `mismatch`. Una lectura fallida (sesión expirada, perfil inexistente) deja el binding `unverified` con su error y nunca informa un mismatch. Un scope sin `scopeId` se completa con la identidad que revela el perfil: el scope se reemplaza, el binding se mueve con él, y la sincronización legacy no vuelve a crear el scope pendiente.

KUApps muestra estas aplicaciones con un panel **Cuentas y scopes** (`frontend/src/components/kuapps/KUAppScopes.vue`) que agrega y quita scopes, asocia un perfil de este computador a cada uno y muestra el resultado de la verificación. La arquitectura y la observabilidad todavía necesitan un perfil, así que en una aplicación sin provider se abren cuando se puedan agregar recursos a sus scopes ([#151](https://github.com/lnavarrocarter/kuadashboard/issues/151)). La publicación al equipo omite estas aplicaciones hasta que el bundle lleve scopes ([#153](https://github.com/lnavarrocarter/kuadashboard/issues/153)). Un enlace con `?app=<id>` abre una aplicación en KUApps.

## Reporte de migración

`GET /api/kua-apps/migration-report` es de solo lectura y lista lo que necesita una decisión. Nombra aplicaciones, vistas y scopes, nunca perfiles.

| Hallazgo | Severidad | Resolución sugerida |
| --- | --- | --- |
| `scope_mismatch` | error | asociar un perfil cuya sesión calce con el scope |
| `scope_unbound` | advertencia | asociar un perfil local |
| `broken_view_link` | advertencia | desvincular el proyecto de arquitectura que no existe |
| `view_profile_mismatch` | advertencia | el proyecto pertenece a otro perfil; hoy la reconciliación lo omite |
| `view_shared_by_applications` | advertencia | revisar qué aplicación es dueña de la vista |
| `registry_identity_v1` | advertencia | reconciliar (lo hace el arranque) |
| `scope_unverified` | info | verificar el scope contra la sesión |
| `application_without_view` / `view_without_application` | info | crear o vincular una vista |
| `duplicate_name` | info | renombrar es opcional; el id es la identidad |
| `resource_identities_merged` | info | ninguna, queda registrado para trazabilidad |

## Export (KUAAppBundle)

El bundle lleva solo datos portables:

- `registry.resources[]` usa la identidad v2: `sourceId`, `identityKey` e `identityVersion: 2`. El `id` local y el `identityKey` v1 nunca se copian. Ambos se recalculan al importar, así que un bundle antiguo pierde sus claves v1 al leerse otra vez.
- `registry.relationships[]` apuntan a ids portables. Una relación con un recurso que no está en el bundle queda fuera.
- `architecture.changes[].author` es `local` cuando el autor era un perfil local.

Las versiones anteriores exportaban `identityKey` con el id del perfil en texto plano. Los respaldos en la nube y las copias de equipo hechos antes de este cambio conservan ese valor hasta que la aplicación se vuelva a subir.

Restaurar la membresía del registry al importar, varios proyectos de arquitectura por bundle y el export como informe (Advisor, referencias de recursos, rutas y comunicaciones) son parte de [#153](https://github.com/lnavarrocarter/kuadashboard/issues/153).

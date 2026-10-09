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
| `POST /changes/preview` | un cambio de un agente `{ applicationId, operation, input }` como plan, sin escribir (#155) |
| `POST /changes/:planId/apply` | aplica un plan con `{ confirm: true }` mientras `GET/PUT /agent-access` permite escrituras de agentes |
| `GET /changes/:planId` | el estado y el resultado de un plan |
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

KUApps muestra estas aplicaciones con un panel **Cuentas y scopes** (`frontend/src/components/kuapps/KUAppScopes.vue`) que agrega y quita scopes, asocia un perfil de este computador a cada uno y muestra el resultado de la verificación. La arquitectura y la observabilidad todavía necesitan un perfil, así que en una aplicación sin provider se abren cuando se puedan agregar recursos a sus scopes ([#151](https://github.com/lnavarrocarter/kuadashboard/issues/151)). Se exportan, importan, respaldan y publican al equipo con sus scopes ([#153](https://github.com/lnavarrocarter/kuadashboard/issues/153)). Un enlace con `?app=<id>` abre una aplicación en KUApps, y `&tab=resources` (o `map`, `signals`, `review`, `settings`) abre esa pestaña del workspace; la pestaña se conserva en la URL cuando cambia. Un scope cuyo provider no tiene conector en esta versión de KUA (un provider de plugin, #156) aparece como **No soportado**, no ofrece perfiles y no genera advertencias de asociación.

## Fuentes de extensiones y evidencia (#156)

`lib/kua/extensionContract.js` define JSON Schemas estrictos y normalizadores en runtime para manifest versión 1 y evidencia versión 1. Cada manifest identifica la fuente, publisher, versión semántica, versión del contrato, transporte/runtime, scopes admitidos y permisos declarados. Todas las capacidades aparecen como booleanos explícitos: `discovery`, `enrichment`, `relationshipEvidence`, `telemetry`, `historicalSearch` y `findings`. La declaración describe la fuente; no autoriza llamadas remotas ni reemplaza la selección explícita de conexiones/herramientas de la persona usuaria.

Ejemplo de manifest:

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

`GET /api/kua-apps/applications/:id/extensions` lista los manifests y `GET /api/kua-apps/applications/:id/evidence` devuelve registros de evidencia más la disponibilidad de cada fuente. Cada registro conserva source id, referencia segura, scope de aplicación/recurso, fechas de observación/consulta, revisión/generación opcionales, frescura (`current`, `stale` o `unknown`) y clase (`observation`, `inference` o `history`). Se rechazan versiones desconocidas, esquemas de URI no admitidos, scopes de otra aplicación/recurso y la suplantación de source id. Los duplicados de una misma fuente se colapsan por id.

El adaptador inicial `kua.internal` es de solo lectura. Proyecta recursos del registry como observaciones, relaciones sugeridas como inferencias, decisiones humanas sobre relaciones como historial y cambios de Architecture como referencias históricas. No copia snapshots, payloads de cambios, credenciales ni evidencia cruda a otro store. Las fechas del registry no prueban que el estado cloud se haya observado recientemente, por eso la frescura se informa como `unknown`. Las fallas de una fuente se aíslan en la respuesta de evidencia; los recursos locales y la edición normal de KUApps siguen disponibles. La evidencia no es membresía ni confirma relaciones.

Ejemplo de registro de evidencia:

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

La evolución es fail-closed: cambios aditivos o semánticos de cualquiera de los schemas estrictos incrementan su versión; los cambios al comportamiento compartido de adaptadores/runtime incrementan `contractVersion`. Si un lector recibe una versión desconocida, marca solo esa fuente como no disponible y conserva los datos locales de KUApps. Las versiones existentes siguen soportadas hasta que una migración revisada por separado las retire.

## Membresía de recursos

`ApplicationRegistryService` es el único lugar que asocia, actualiza y desvincula un recurso de una aplicación (#150). Las rutas de APM delegan en él, incluida la que vincula un stack de CloudFormation (`link-stack`, que además recupera los recursos desvinculados del stack), así que Observabilidad, Arquitectura y KUApps se comportan igual.

- **Asociar es idempotente.** Asociar otra vez el mismo recurso (mismo tipo y clave) responde `200` con el recurso existente en vez de `201`, y no duplica membresía, nodo ni relación.
- **Control de revisión.** Asociar, actualizar y desvincular aceptan `expectedRevision`. Un valor obsoleto responde `409 REVISION_CONFLICT` y no escribe nada. Asociar o desvincular con éxito mueve la `revision` de la aplicación.
- **Una falla parcial se puede recuperar.** El recurso se guarda en una transacción. Si falla la proyección a una vista de Arquitectura, el estado de sincronización del registry guarda el error y la siguiente reconciliación termina el trabajo sin duplicados.
- **Desvincular no es eliminar.** Desvincular quita el recurso de la aplicación y registra la desvinculación por identidad portable, así la reconciliación no lo vuelve a asociar desde un nodo de Arquitectura. El nodo sigue en el diagrama y no se elimina nada en la nube. Asociar el recurso otra vez borra la desvinculación.
- **Las decisiones humanas se mantienen.** Las relaciones que el usuario confirmó o rechazó conservan su estado al asociar, desvincular y reconciliar.
- **Perfiles verificados por scope.** Un perfil asociado y verificado para uno de los scopes de la aplicación puede abrir sus vistas de Arquitectura, también en una aplicación sin provider.

`GET /api/kua-apps/applications/:id/registry` lista los recursos y relaciones canónicos de la aplicación con sus nombres, sin ids de perfiles locales. Cada recurso tiene `signals: { state, lastDataAt, reason }` (`lib/kua/resourceSignalState.js`, solo tablas locales), que se muestra como etiqueta en Recursos y en el inspector para que un recurso sin datos nunca parezca vacío o sano:

| Estado | Significado |
| --- | --- |
| `unsupported` | KUA no puede recolectar señales de este provider o tipo de recurso |
| `gone` | el recurso ya no existe donde estaba (ver Recursos que ya no existen) |
| `no_connection` | ningún perfil verificado de este computador llega al scope del recurso |
| `disabled` | la recolección está apagada para la aplicación o el recurso |
| `error` | la última recolección de la aplicación falló |
| `no_data` | todavía no se recolectó nada |
| `stale` | los últimos datos tienen más de tres intervalos de recolección (al menos 2 horas) |
| `partial` | la última recolección leyó solo parte de los datos |
| `current` | datos recientes |

Qué recolecta KUA se decide en un solo lugar (`lib/apm/signalCapabilities.js`): métricas de Lambda (desde sus logs), workloads de Kubernetes con contexto y las métricas de CloudWatch de load balancers, EC2 y S3; logs de Lambda, ECS, EventBridge, Cloud Run, Cloud Functions, proyectos Vercel y workloads de Kubernetes. Los demás tipos (API Gateway, SQS, DynamoDB…) son solo inventario y aparecen como `unsupported`, no como "sin datos".

**KUApps → Señales** lista **Toda la aplicación** (métricas agregadas, historial de logs y trazas) y luego cada recurso agrupado por tipo, con buscador y filtro por estado de señales. Un recurso muestra sus métricas (`GET /applications/:id/observability/resources/:resourceId/metrics`) y sus logs, leídos con el perfil y la región que resuelve su scope (`GET /applications/:id/observability/resources` los entrega por recurso); las rutas de logs de AWS aceptan `?region=` para eso. Un recurso cuyo scope no tiene un perfil verificado lo indica en vez de fallar.

### Recursos que ya no existen (#236)

Cuando el recolector lee un recurso de Kubernetes y el clúster responde 404 por el recurso mismo (no por la API de métricas), registra desde cuándo falta (`lib/apm/resourcePresence.js`, junto a los cursores de recolección) en vez de fallar la recolección: una recolección donde solo faltan recursos no queda parcial. Mientras el recurso se ve, KUA guarda sus labels de identidad (`app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app`, `k8s-app`).

`GET /applications/:id/observer` lista los recursos que faltan. Para Deployments, StatefulSets y DaemonSets busca sucesores con un listado sin costo del mismo tipo en el mismo contexto y namespace: el mismo label de identidad (probable), o el mismo nombre sin su versión ni hash, como `attencion-3.9.1` → `attencion-3.9.2` (posible). KUApps → Revisión los muestra con esa evidencia. `POST /observer/replace { resourceId, successor, expectedRevision }` asocia el sucesor y desvincula el recurso que falta; `POST /observer/ignore` deja de listarlo; desvincular funciona como en Recursos. No se reemplaza nada automáticamente y no cambia nada en el clúster. Los Pods no son miembros por sí mismos: se reemplazan en cada rollout y se observan a través de su Deployment o StatefulSet.

**Agregar recursos** (el encabezado, Recursos y el Mapa abren el mismo panel) marca los recursos descubiertos que ya están en la aplicación ("Ya está en" seguido del nombre de la aplicación), que no se pueden volver a seleccionar, y muestra la identidad nativa de cada uno. Una escritura sobre una vista que cambió mientras tanto responde `409`: el panel recarga la vista, conserva la selección y pide volver a agregar los recursos; no se escribió nada. En el Mapa, **Quitar del diagrama** pide confirmación. Para un recurso real (con identidad nativa) solo oculta el nodo en esa vista (`node.hide`): el recurso sigue en la aplicación con su membresía, relaciones, señales e historial, la reconciliación no lo vuelve a dibujar y **Ocultos en esta vista** lo vuelve a mostrar (`node.show`). Un dibujo sin identidad nativa se elimina. Las tres operaciones siguen separadas: ocultar en un diagrama, desvincular de la aplicación (Recursos) y borrar infraestructura, que KUApps nunca hace.

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

## Exportar e importar (KUAAppBundle)

Seguimiento: [#153](https://github.com/lnavarrocarter/kuadashboard/issues/153). Código: `lib/kua/kuaAppBundle.js` (formato), `lib/kua/kuaAppIo.js` (exportar, vista previa, importar, sincronizar).

### Formato

El sobre sigue siendo `kind: "KUAAppBundle"`, `version: 1`, `mode: "sanitized"`, porque el servicio de cuenta (respaldos en la nube, sincronización y equipo) y las versiones anteriores de KUA solo aceptan la versión 1. El contenido nuevo se agrega dentro y se anuncia con `contentVersion` (ahora `2`; un bundle sin ese campo es contenido versión 1).

| Campo | Contenido |
| --- | --- |
| `application` | `name`, `environment`, `team`, `pollingEnabled` y `scopes[]` (`provider`, `scopeId`, `location`, `label`). `provider` y `region` solo aparecen en una aplicación legacy, nunca en una creada sin provider. |
| `architecture` | la primera vista de arquitectura: `project`, `graph`, `snapshots`, `changes` |
| `additionalViews[]` | las demás vistas, con la misma forma |
| `registry.resources[]` | identidad v2 (`sourceId`, `identityKey`, `identityVersion: 2`) y, para un recurso de la aplicación, `apm`: cómo volver a observarlo (`type`, `key`, `name`, `arn`, `kind`, `service`, `logGroup`, `kubeContext`, `namespace`, `scopeId`, `location`, `enabled`, `associationSource`) |
| `registry.relationships[]` | ids portables de recursos, estado (`confirmed`, `rejected`, `suggested`, `automatic`) y solo el tipo y origen de la evidencia |
| `registry.detachments[]` | claves de identidad v2 de los recursos que el usuario desvinculó |
| `advisor.acceptances[]` | hallazgos del Advisor de producto aceptados o silenciados |

Nunca van en un bundle: perfiles ni asociaciones de scopes, credenciales, kubeconfigs, tokens, secretos, payloads de cambios, valores crudos de evidencia, telemetría, logs, métricas ni umbrales. El `id` local y el `identityKey` v1 nunca se copian; ambos se recalculan al leer un bundle, así que un bundle antiguo pierde sus claves v1 al leerse otra vez. `architecture.changes[].author` es `local` cuando el autor era un perfil local. Las versiones anteriores exportaban `identityKey` con el id del perfil en texto plano; los respaldos en la nube y las copias de equipo hechos antes de esa corrección lo conservan hasta que la aplicación se vuelva a subir.

Una versión anterior de KUA lee un bundle de contenido versión 2 como uno legacy: importa la primera vista e ignora scopes, vistas adicionales, membresía y desvinculaciones. No puede leer el bundle de una aplicación sin provider.

### Leer un bundle

Todo bundle (archivo, respaldo en la nube, sincronización, equipo) se revisa y depura otra vez en este computador. Lo que queda fuera se informa, no se descarta en silencio:

| Aviso | Significado |
| --- | --- |
| `newer_content` | lo creó una versión más nueva de KUA; se ignora lo que esta versión no conoce |
| `resource_invalid` | un recurso sin identidad válida |
| `relationship_dangling` | una relación con un recurso que no está en el bundle |
| `detachment_invalid` | una desvinculación que no es una clave de identidad v2 |
| `view_invalid` / `views_truncated` | una vista sin proyecto, o más de 100 vistas |

Un `kind` o `version` desconocido, un bundle no depurado o un `contentVersion` inválido se rechazan.

### Vista previa e importación

`POST /api/kua-apps/import/preview` (cabecera `X-Profile-Id`) responde qué haría una importación y no escribe nada: el nombre que recibe la aplicación, si ya existe aquí (mismo id de origen) o comparte su nombre, los scopes por asociar (y si esta versión de KUA soporta su provider), las vistas y sus nombres, los recursos que vuelven, los que no y por qué (`no_source`, `unsupported_type`, `unsupported_provider`), los recursos que este computador ya tiene en otras aplicaciones, los recursos fuera de los scopes de la aplicación, las relaciones por estado, las desvinculaciones, las decisiones del Advisor y los avisos anteriores. KUApps la muestra antes de **Importar**.

`POST /api/kua-apps/import` crea una aplicación **nueva**; nunca la fusiona con una existente:

- Un bundle con `provider` y `region` se convierte en una aplicación legacy del perfil seleccionado, renombrada `Nombre (imported)` si ese perfil ya tiene el nombre. Un bundle sin ellos se convierte en una KUA Application sin provider, con su propio nombre.
- Los scopes se agregan sin asociaciones: cada persona asocia un perfil de su computador (ver «Bindings locales»).
- Cada vista se convierte en un proyecto de arquitectura del perfil seleccionado, con su grafo y snapshots. Las decisiones humanas (relaciones rechazadas y confirmadas, nodos manuales) vuelven con el grafo.
- Las desvinculaciones se restauran primero, para que reconciliar las vistas no vuelva a asociar esos recursos.
- Los recursos con `apm` vuelven a ser miembros mediante `ApplicationRegistryService.attachResources` (#150), que es idempotente y reconcilia una sola vez. Un recurso que llegó desde una vista vuelve con esa vista. Se restauran las relaciones dibujadas entre miembros. No se crea nada en la nube y restaurar un recurso no activa la recolección.
- La respuesta lista los recursos `skipped` con su motivo. Si algo falla, se deshacen la aplicación y los proyectos creados.

Exportar y respaldar en la nube una aplicación sin provider funciona desde cualquier perfil, y la publicación al equipo la incluye. El servicio de cuenta acepta estos bundles desde [kua-control-plane#42](https://github.com/lnavarrocarter/kua-control-plane/pull/42); mientras tanto los rechaza, y KUA no vuelve a enviar el mismo bundle rechazado hasta que la aplicación cambie. La sincronización entre computadores también funciona para ellas: el vínculo de sincronización pertenece a la aplicación, no a un perfil, así que se ve en todos los perfiles.

La sincronización entre computadores (`applyBundle`) toma los detalles, agrega los scopes que faltan (nunca quita uno) y actualiza cada vista, emparejada por nombre (ignorando un sufijo `(imported)`) y luego en orden; una vista que falta se crea una sola vez. En una aplicación sin provider también toma la membresía: un recurso que el otro computador desvinculó se desvincula aquí (una desvinculación es una decisión; no se borra nada en la nube), y sus miembros se asocian salvo los desvinculados aquí. Los miembros que solo existen aquí se conservan y van al otro computador en el siguiente envío. El hash de sincronización solo incluye las vistas adicionales, y los scopes y la membresía de una aplicación sin provider, cuando existen, así que las aplicaciones existentes conservan su hash. Los scopes y el registry de una aplicación legacy se derivan de sus recursos en cada computador y no forman parte del hash.

El export como informe (hallazgos del Advisor, referencias de recursos, rutas y comunicaciones) no es parte de este formato.

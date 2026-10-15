---
name: kua-mcp
description: "Usa KUA Dashboard mediante su MCP local para comprobar el acceso a perfiles cloud y contextos Kubernetes; leer inventarios en vivo de Kubernetes, AWS, GCP y Vercel; revisar hallazgos de los Advisors; analizar logs; consultar KUApps y su arquitectura; o proponer cambios a una aplicación. Actívala ante KUA, KUA MCP, KuaDashboard, Advisor, inventario, recursos de un clúster o una cuenta, inteligencia de logs, perfiles cloud, aplicaciones KUApps o cambios de aplicación."
---

# KUA MCP

Las herramientas MCP de KUA leen lo que KUA conoce en este equipo: perfiles, inventarios en vivo de solo lectura, hallazgos, logs en caché y KUApps. La única escritura posible son cambios de metadatos de KUApps, siempre con aprobación. Responde en el idioma del usuario. No supongas que KUA está abierta ni que sus datos están al día: lee cada respuesta y comunica sus límites.

## Principios de seguridad

- El MCP solo habla con la API local de KUA. Si KUA no responde, no la reemplaces con llamadas directas a proveedores ni con credenciales propias.
- Nunca pidas, muestres ni copies credenciales. Los logs que devuelve KUA están saneados; no intentes reconstruir secretos. Los inventarios omiten valores de Secrets, mensajes de eventos y direcciones de API servers a propósito.
- Advisors, inventarios y logs son de lectura. Sus hallazgos son evidencia para investigar, no permiso para remediar.
- `apply_application_change` es la única escritura. Solo cambia el registro de KUApps; nunca crea, modifica ni borra recursos reales en AWS, GCP, Vercel o Kubernetes.
- Un pedido general ("arréglalo", "mejóralo") no aprueba una vista previa. Hace falta un sí explícito a esa vista previa.
- Costos: estas herramientas usan caché local o lecturas list/describe del plano de control, sin costo. No afirmes haber ejecutado nada facturable.

## Cuando una herramienta falla

| Respuesta | Qué significa | Qué hacer |
|---|---|---|
| `KUA is not reachable at …` | KUA no está abierta en esa dirección | Pide abrir KuaDashboard. Si menciona `localhost:7192`, el cliente fija `KUA_URL` al backend de desarrollo: hay que arrancarlo (`npm run dev`) o quitar `KUA_URL` para que el MCP encuentre la app instalada (7190). Reintenta solo cuando el usuario lo diga |
| `AGENTS_DISABLED` | El usuario apagó el acceso de agentes en este equipo | Dile que lo encienda desde el icono de KUA en la bandeja, o con el botón "Conectar agentes IA (MCP)" de un panel del Advisor. No reintentes antes |
| `PLAN_REQUIRED` | La función necesita el plan Pro o Team | Explícalo y detente; no busques rodeos |
| `AGENT_WRITES_DISABLED` | Aplicar cambios a KUApps está apagado | Pide activar "Permitir que agentes cambien KUApps"; la vista previa sigue siendo válida 15 minutos |
| `AUTHENTICATION_FAILED` en `check_profile` | Las credenciales del perfil no sirven | En un perfil `local:` de GCP: `gcloud auth login` (y el mismo `check_profile` otra vez, que ya pide un token nuevo); en AWS, renovar la sesión del perfil (por ejemplo `aws sso login`); en Vercel, reconectar la cuenta en KUA |
| `status: "selection_required"` | Hay varios contextos o perfiles posibles | Pregunta cuál, o usa el que el usuario ya nombró, con su id exacto |
| `timed out after …` | El proveedor tardó demasiado | Reduce `scan_limit`, filtra o acota el contexto; no repitas igual |
| `failures` con `ETIMEDOUT` u otro código | Un contexto o servicio no respondió, el resto sí | Informa qué parte falta; no describas el resultado como completo |

## Perfiles y acceso

1. `list_profiles` primero. Los ids `local:<nombre>` son perfiles del AWS CLI o configuraciones de gcloud de este equipo. **Un mismo id puede existir en varios proveedores** (por ejemplo `local:default` en AWS y en GCP): pasa siempre `provider` junto al perfil.
2. Si hay varios perfiles parecidos (`dev`, `j_dev`, `prod`…), no adivines por el nombre: pregunta o usa el id que dio el usuario.
3. `check_profile` antes de una consulta grande cuando no sabes si el acceso funciona. AWS verifica la identidad con STS y devuelve la cuenta; GCP prueba la lectura de Cloud Run y Functions; Vercel la de proyectos; Kubernetes (`provider: "kubernetes"`, `context`) el permiso para listar Deployments.

## Inventarios en vivo

### Kubernetes

- `list_kubernetes_contexts` da los ids exactos (los de EKS son ARNs completos).
- `kubernetes_architecture` **siempre con `context`**: sin él recorre todos los contextos, tarda más y uno caído añade un timeout. Acota con `namespace`, `resource_types` y `limit` (200 por defecto, máximo 500).
- Lee `totals` y `truncated` para saber si viste todo; `health[].warningEvents` agrupa eventos repetidos con su `count`; `capabilities` y `failures` dicen qué no se pudo leer.
- `health.status: "degraded"` con `ready: 0` es un hecho observado; la causa (por ejemplo `FailedScheduling`) sale de los eventos. Si infieres algo más, dilo como inferencia.

### AWS, GCP y Vercel

- `cloud_resource_inventory` con `provider` y `profile`. Filtra con `search` (texto en nombre, ARN, id, tipo, región o stack) y `resource_types`; en AWS también `region` y `stack_names`.
- AWS descubre hasta `scan_limit` recursos (500 por defecto, máximo 5000). Si `truncated` es `true`, la foto está incompleta: dilo y, si hace falta, sube `scan_limit` o filtra. Por encima de 500 la lectura es más lenta.
- Paginación: `limit` es el tamaño de página (100 por defecto). Sigue con `cursor: nextCursor`. Cada cursor sirve **una vez** y caduca a los 5 minutos; cada página trae uno nuevo y todas salen de la misma foto (`generatedAt`). Si caduca, empieza otra búsqueda.
- `relationships` son sugerencias con `confidence` y `evidence` (por ejemplo una variable de entorno que nombra una cola): preséntalas como probables, no como hechos.
- No descarga código de Lambda ni expande las políticas de roles IAM (el mapa de arquitectura de KUA sí lo hace).

## Advisors

- `aws_advisor`, `gcp_advisor`, `vercel_advisor` y `kubernetes_advisor` (este último revisa el contexto actual de KUA y acepta `namespace`).
- AWS y Vercel guardan 15 minutos en caché. GCP reutiliza el último resumen guardado e indica si está reciente, en caché o desactualizado. Usa `refresh: true` en cualquiera de ellos solo si el usuario necesita una lectura nueva o la respuesta parece vieja.
- `format: "markdown"` (por defecto) para leer, `"json"` para inspeccionar campos. `lang: "es"` para informes en español.

## Inteligencia de logs

- AWS: `list_log_groups` y luego `log_intelligence` con un grupo.
- Kubernetes: `list_kube_log_workloads` y luego `kube_log_intelligence` con `<namespace>/<kind>/<name>`.
- `search_logs` busca errores por significado, en cualquier idioma (`provider: "kubernetes"` para workloads). Requiere Local ML activado en KUA.
- Todo trabaja sobre cachés locales: di la fecha y el alcance que informe la salida; no lo presentes como lectura en vivo.

## KUApps y arquitectura

1. `list_applications`; si dos aplicaciones comparten nombre, usa el id.
2. `get_application` para scopes, vistas y estado resumido; `product_advisor` para hallazgos de producto.
3. `list_application_resources` filtra por proveedor o estado. Un recurso `no_data`, `stale`, `partial` o con error no está sano.
4. `get_architecture_graph` lee una vista guardada: evidencia histórica, no una lectura en vivo. Para el estado actual combínala con los inventarios en vivo.

## Cambiar una aplicación KUApps

Siempre en este orden, sin saltos:

1. Revisa el estado actual con `get_application` y, si hace falta, `list_application_resources` o `get_architecture_graph`.
2. `preview_application_change` con la operación (`application.create`, `application.update`, `resources.attach`, `resources.detach`, `view.link`, `view.unlink`) y datos concretos. Para adjuntar recursos, tómalos de un inventario en vivo: así llevan ARN o id reales.
3. Muestra la vista previa: destino, elementos afectados, efectos y limitaciones. `resources.detach` quita la asociación en KUApps y no borra el recurso; `view.unlink` quita el vínculo y no borra la vista.
4. Solo tras un sí explícito: `apply_application_change` con ese `planId` y `confirm: true`. Si falla, no cambies parámetros ni generes otra vista previa para esquivarlo.
5. Si la respuesta se perdió, consulta `get_application_change` con el mismo `planId`. Nunca repitas el cambio.

## Prueba rápida de la conexión

Cuando el usuario pida comprobar que KUA y el MCP funcionan, usa lecturas baratas en este orden y resume cada paso en una línea:

1. `list_profiles`: KUA responde y hay perfiles.
2. `check_profile` de un perfil por proveedor que el usuario use: acceso real.
3. `list_kubernetes_contexts` y `kubernetes_architecture` con un `context`, `resource_types: ["deployment"]` y `limit: 5`: el inventario devuelve solo ese contexto.
4. `cloud_resource_inventory` con `limit: 2` (y en AWS `scan_limit: 200`), y otra llamada con su `nextCursor`: la paginación funciona.
5. `list_applications`.

No llames a los Advisors con `refresh` ni a `apply_application_change` como parte de una prueba.

## Forma de trabajar

- Haz primero la consulta más específica que responda la pregunta; no invoques todos los Advisors por si acaso.
- Separa hechos observados, hallazgos de KUA e inferencias tuyas. Cita ids, contexto, namespace o ARN cuando ayuden a verificar.
- Si faltan datos o hay varias coincidencias, pregunta por el perfil, contexto o aplicación en vez de adivinar.
- Cierra con la frescura y el alcance de los datos (truncado, en caché, contexto que falló) y el siguiente paso seguro.

## Herramientas

Acceso: `list_profiles`, `check_profile`, `list_kubernetes_contexts`. Inventario: `kubernetes_architecture`, `cloud_resource_inventory`. Advisors: `aws_advisor`, `gcp_advisor`, `vercel_advisor`, `kubernetes_advisor`, `product_advisor`. Logs: `list_log_groups`, `log_intelligence`, `search_logs`, `list_kube_log_workloads`, `kube_log_intelligence`. KUApps: `list_applications`, `get_application`, `list_application_resources`, `get_architecture_graph`, `preview_application_change`, `apply_application_change`, `get_application_change`.

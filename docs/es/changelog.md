# Changelog

## v1.10.4 (2026-06-22)

### OAuth de Vercel Marketplace

- Soporte completo para el flujo de integración de Vercel Marketplace: la página de callback ahora maneja `configurationId`, `teamId`, `next` y `source` además del flujo estándar OAuth con `code`+`state`.
- Corregido el error "Missing OAuth parameters" que aparecía cuando Vercel Marketplace redirigía al callback sin parámetro `state`.
- Al completar la autorización de Marketplace, la app abre la URL `next` de Vercel en el navegador para que la integración quede marcada como instalada.
- `VERCEL_CONFIGURATION_ID` y `VERCEL_TEAM_ID` del flujo Marketplace se persisten en el perfil de credenciales.

## v1.10.3 (2026-06-22)

### Callback OAuth de Vercel

- Se cambió el redirect OAuth de Vercel a la página HTTPS `https://lnavarrocarter.github.io/kuadashboard/vercel-callback` para completar la autorización sin depender del redirect con protocolo custom.
- Se agregó una página de callback con auto-forward que devuelve `code` y `state` a la app de escritorio usando el flujo existente de Vercel.
- Se agregó soporte para `VERCEL_OAUTH_REDIRECT_URI` en la configuración runtime para que los builds locales y empaquetados queden alineados con el callback HTTPS.

## v1.10.2 (2026-06-22)

### AWS — Credenciales temporales + SSO en navegador

- Soporte completo para `AWS_SESSION_TOKEN` en perfiles guardados y resolución de credenciales AWS, habilitando sesiones temporales de STS de extremo a extremo.
- Nuevo flujo de autorización por dispositivo de IAM Identity Center (SSO) desde navegador, con selección de cuenta/rol y captura automática de credenciales temporales.
- Seguimiento de expiración de sesión SSO y renovación con un clic mediante metadata persistida (`meta.__sso`).

### Seguridad, estabilidad y UX

- Restricción a localhost para endpoints de perfiles locales de AWS y bootstrap SSO, evitando exposición remota de configuración local de la estación de trabajo.
- Ajuste de sanitización en Env Manager para conservar metadata estructurada reservada en `meta.__sso` (start URL, región, cuenta/rol y expiración), manteniendo el comportamiento previo de tags para claves normales.
- Endurecimiento de apertura de ventana SSO usando `noopener,noreferrer`.
- Normalización de finales de línea en `public/index.html` para eliminar `CR` residuales y reducir diffs ruidosos.

### Fixes AWS adicionales

- Corregido el congelamiento del render de diagramas de Step Functions en máquinas de estado con ciclos, agregando una protección de ciclo en la asignación BFS de niveles (`StepFnDiagram.vue`).
- Corregidos los fallos de ejecución en Athena cuando el workgroup no tiene output location configurado, permitiendo definir un override S3 explícito en el Query Editor y en el modal de consulta por workgroup.

## v1.10.0 (2026-06-09)

### GCP — Paneles master-detail

Los cuatro servicios principales de GCP estrenan un layout completo de panel dividido: lista de recursos a la izquierda y panel de detalle con tabs a la derecha, coherente con el patrón ya establecido en Cognito, Athena y Lex.

- **Cloud Run** — tabs: Overview (configuración, imagen, escalado), Revisions (con % de tráfico), Variables (vars de entorno), Logs, Metrics.
- **Compute VMs** — tabs: Overview (tags, labels, protección de borrado), Discos, Red (interfaces e IPs), Logs, Metrics.
- **Cloud SQL** — tabs: Overview (backup y disponibilidad), Config (tipo de almacenamiento, flags), Connection (direcciones IP, connection name), Logs, Metrics.
- **Cloud Functions** — tabs: Overview (runtime, recursos, trigger), Variables, Logs, Invoke (inline, reemplaza el modal flotante anterior), Metrics.

### GCP — Métricas Cloud Monitoring embebidas

El tab **Metrics** se incluye ahora en los cuatro paneles de servicio. Muestra tres gráficas de línea (Chart.js) obtenidas desde la API Cloud Monitoring v3, con selector de rango (1h / 3h / 6h / 24h) y botón de actualización.

| Servicio | Gráficas |
|---|---|
| Cloud Run | Request Rate (req/s) · Latency p99 (ms) · Instance Count |
| Compute VMs | CPU Utilization (%) · Network In (B/s) · Disk Read (B/s) |
| Cloud SQL | CPU Utilization (%) · Connections · Disk Used (bytes) |
| Cloud Functions | Execution Count (req/s) · Duration p99 (ns) · Active Instances |

### GCP — GCS Upload y Delete

- **Upload**: nuevo botón "⬆ Upload" en la barra del GCS Browser. Permite seleccionar múltiples archivos, los sube como binario raw a la carpeta actual y muestra un log de resultado por archivo (✓ / ✗).
- **Delete**: botón "🗑 Delete" en el panel de preview del archivo. Pide confirmación antes de llamar a la nueva ruta `DELETE /storage/:bucket/object`.

### GCP — Artifact Registry Deploy-to-K8s

Artifact Registry se rediseña como panel master-detail con dos tabs:

- **Packages & Tags** — vista en dos columnas: lista de packages a la izquierda y tabla de tags a la derecha. Cada fila de tag Docker tiene un botón **🚀 Deploy**.
- **Deploy to K8s** — al pulsar Deploy se rellena automáticamente la referencia completa de imagen (`location-docker.pkg.dev/project/repo/pkg:tag`). El panel permite seleccionar el Namespace, el Deployment y el Container del cluster Kubernetes activo, muestra un resumen del despliegue y aplica el cambio con un clic.

### Kubernetes

- Nuevo endpoint `POST /api/:namespace/deployments/:name/set-image`: aplica un strategic-merge-patch sobre la imagen de un container específico y escribe una entrada en el audit log.

### GCP — Visor de logs mejorado

- Las entradas de log en todos los paneles de detalle usan colores según severidad: `ERROR`/`CRITICAL` → rojo, `WARNING` → ámbar, `INFO`/`NOTICE` → verde, `DEBUG`/`DEFAULT` → tenue.

## v1.9.3 (2026-06-09)

### AWS Amazon Lex

- Rediseño del módulo Lex con un **layout master-detail de panel dividido** (igual al de Cognito y Athena). El panel izquierdo lista todos los bots con estado, versión y fecha de actualización. Al hacer clic en un bot se abre el panel de detalle a la derecha.
- Se eliminaron los 8 botones de acción de colores de cada fila. Toda la funcionalidad (Intents, Aliases, Slot Types, Chat, Logs, Missed, Metrics, Test Set) ahora está accesible mediante la barra de tabs del panel derecho.
- Los datos se cargan bajo demanda por tab y se cachean mientras el bot esté seleccionado — cambiar de tab para el mismo bot no provoca una nueva llamada a la API.
- Las acciones Chat y Build en el tab de Aliases ahora navegan a sus tabs correspondientes en lugar de abrir modales anidados.

## v1.9.2 (2026-06-09)

### AWS DynamoDB

- Edición de ítems en el modal Browse: cada fila tiene un botón ✏️ que abre un editor JSON pre-llenado con los datos actuales del ítem. Al guardar se ejecuta un `PutItem` (reemplazo completo) y se refresca la página actual.
- Eliminación de ítems por fila: el botón 🗑 extrae automáticamente los campos de la clave primaria desde el key schema de la tabla y pide confirmación antes de llamar a `DeleteItem`.
- Botón **New Item** en la barra del modal Browse: abre el editor JSON pre-llenado solo con los campos de clave para crear un nuevo registro desde cero.
- El editor JSON valida sintaxis en tiempo real y bloquea el guardado si hay errores de parseo.

## v1.9.1 (2026-05-28)

### AWS Cognito

- Búsqueda libre de texto en User Pools sin errores de filtro de AWS.
- Edición de atributos de usuario desde el modal de detalle.
- Gestión de membresía de grupos desde el detalle de usuario: asignar y quitar grupos.
- Controles de MFA por usuario: habilitar, deshabilitar y cambiar método preferido (SMS/TOTP).
- Flujo de creación de grupos con soporte de descripción en el tab Groups.
- Corrección de error en tiempo de ejecución en el flujo de creación de grupos con HMR.
- Corrección del estado MFA en la lista de usuarios alineando el cálculo con los settings de Cognito.

## v1.9.0 (Mayo 2026)

### Vercel

- Integración completa con Vercel mediante autenticación OAuth — conecta tu cuenta directamente desde el modal de perfil.
- Vista de proyectos con estado de deployment, framework, región y acceso directo a la URL en vivo.
- Detalle de deployments con pestañas de Actividad, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config y Checks.

### AWS Step Functions

- Nueva columna **Executions** en la tabla de Step Functions con conteos en vivo de ejecuciones activas (▶), fallidas (✗) y con timeout (⏱).
- Nueva pestaña **Versiones** en el panel Info — lista todas las versiones publicadas del workflow con fecha, descripción y visor de definición ASL con botón de copia.
- Modal Info refactorizado con cinco pestañas: Detalles, Diagrama, Ejecuciones, Eventos y Versiones.


## v1.8.0 (2026-05-10)

### Kubernetes

- Las tablas de recursos ahora soportan seleccion multiple, eliminacion masiva y acciones por fila mas completas.
- El menu de Kubernetes cubre mas recursos de workloads, networking, storage, config, policy, RBAC, scheduling, admission y administracion del cluster.
- La columna `Age` muestra duraciones legibles como `1day 3hrs 10min`, `23hrs 10min`, `2min` y `30sec`, pero ordena por duracion real transcurrida.
- ConfigMaps y Secrets tienen una vista clave/valor mas simple para mapear y editar datos.
- Los workloads muestran variables de entorno en el panel de detalle, incluyendo edicion de entradas por contenedor.
- El modal de kubeconfig permite importar YAML pegado, cargar un archivo desde el selector desktop o registrar una ruta existente.

### Helm

- Los charts se pueden buscar desde repositorios configurados e instalar directamente en el cluster activo.
- Los releases instalados se pueden listar y desinstalar desde la vista Helm.
- Las instalaciones muestran progreso, salida y estado final del release en lugar de dejar la UI esperando sin contexto.
- La instalacion de `metrics-server` incluye un preset de compatibilidad para clusters locales o self-signed, con flags de TLS de kubelet y tipos de direccion preferidos.

### Observabilidad

- Las metricas estan disponibles para Pods, workloads y Nodes usando `metrics.k8s.io`.
- Cuando Metrics Server no esta disponible, KuaDashboard puede detectar servicios Prometheus y consultar metricas mediante el proxy del API server de Kubernetes.
- Los paneles de detalle de recursos y Nodes incluyen eventos relacionados y resumen de notificaciones para diagnosticar scheduling, image pull, salud y ciclo de vida.

### Port Forwarding

- Los tuneles para Services y Pods son mas confiables, con mejor resolucion del pod objetivo, estado persistente y reconexion.
- Las acciones de port-forward estan disponibles desde tablas y detalles cuando el recurso seleccionado soporta tunel.

## v1.7.0 (2026-05-05)

- Auto-refresh para vistas Kubernetes, AWS, GCP y Helm sin resetear el contexto de navegacion.
- Panel lateral Kubernetes ajustable con resumen especializado y YAML estructurado.
- Metricas de Pods usando `metrics.k8s.io`, deteccion de Prometheus y acceso a Helm cuando falta monitoreo.
- Streaming de logs en tiempo real para Pods, Deployments, StatefulSets y DaemonSets.
- Busqueda en Terminal Logs, filtros por fecha serializada, descarga y conteo de lineas.
- Editor YAML con busqueda, lint, guardado, estado linea/columna, ruta de seccion y autocompletado.
- Sesiones EC2 SSH/RDP persistentes que se pueden ocultar y reabrir sin cerrar la conexion.

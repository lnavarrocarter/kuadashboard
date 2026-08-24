# Changelog

## Sin publicar

### Base del espacio Architecture

- Nuevo espacio **Architecture** aislado por perfil para diagramas de aplicaciones, inicialmente orientado a AWS.
- Nuevo modelo de grafo independiente del proveedor para ámbitos, fuentes, nodos, relaciones, grupos, evidencia y layout persistente.
- Nuevo almacenamiento privado `architecture.sqlite3` con WAL, revisiones optimistas del grafo, snapshots inmutables y cierre seguro del servidor.
- Nuevas APIs aisladas por perfil para crear proyectos, leer y actualizar borradores del grafo, y crear o consultar snapshots.
- Primer workspace Vue para crear proyectos, consultar el resumen del grafo y mantener historial local de snapshots.
- Nuevas operaciones tipadas del grafo con limpieza en cascada, control optimista de revisiones e historial semántico de cambios.
- Comparación y restauración transaccional de snapshots, creando siempre una nueva revisión y un snapshot inmutable sin reescribir el historial.
- Nuevos controles del workspace para comparar snapshots, restaurar estados anteriores y consultar el historial reciente de revisiones.
- Nuevo canvas interactivo con Vue Flow para crear, conectar, mover, editar y eliminar componentes de arquitectura manualmente.
- Las interacciones del canvas persisten mediante operaciones tipadas, incluyendo cambios de layout registrados sólo al terminar cada movimiento.
- Cobertura backend y frontend para validación del grafo, inmutabilidad de snapshots, conflictos de revisión, aislamiento por perfil y comportamiento del store.

## v1.11.3 (2026-08-11)

### Hotfix de empaquetado macOS

- Se corrigió el paquete de macOS Intel que incluía el binario nativo ARM64 de `better-sqlite3`, lo que impedía iniciar el backend después de instalar la aplicación.
- Los artefactos macOS x64 y ARM64 ahora se generan en procesos aislados y secuenciales para impedir que una dependencia nativa sea reemplazada mientras se archiva otra arquitectura.
- Se agregaron validaciones de arquitectura para el ejecutable Electron y el módulo nativo SQLite dentro de ambos ZIP finales antes de publicar un release.
- Se conserva un manifiesto de actualización macOS combinado con los artefactos ZIP/DMG para x64 y ARM64.

## v1.11.2 (2026-08-11)

### APM multicloud y sin proveedor

- Se extendió la observabilidad de aplicaciones desde AWS a ámbitos aislados para AWS, GCP y Vercel, más un ámbito **General** sin proveedor para aplicaciones Kubernetes.
- Observabilidad ahora forma parte de la navegación principal e incluye edición, eliminación, gestión de recursos y configuración según el proveedor.
- Se agregaron migraciones SQLite por columnas explícitas para aplicaciones y recursos por proveedor, conservando de forma segura los datos APM existentes.
- Nuevas guías bilingües de credenciales para AWS, GCP, Vercel y Kubernetes, con persistencia de perfiles corregida y carga diferida por proveedor.

### Inteligencia de topología explicable

- Nuevo evaluador estructural local con puntuación, cobertura conectada, detección de recursos aislados, hallazgos y sugerencias de dependencia explicables.
- Las relaciones genéricas `related_to` se informan por separado y no cuentan como causalidad operacional.
- Nuevo análisis AWS explícito y de solo lectura para las definiciones de Step Functions asociadas.
- El análisis ASL reconoce invocaciones Lambda directas y optimizadas, subflujos Step Functions, envíos SQS, tareas ECS y operaciones SDK de S3.
- Las referencias ASL externas siguen siendo sugerencias: el usuario debe agregar el recurso, analizar nuevamente y confirmar la dependencia. KUA nunca crea relaciones causales automáticamente.

### Requests de procesos y trazas de ejecución

- Nueva pestaña AWS **Trazas** que acepta request/correlation ID, ARN de ejecución o ARN de una Step Function asociada.
- Al pegar el ARN de una Step Function se muestran hasta 10 ejecuciones recientes y se traza la última; luego se puede seleccionar directamente cualquier ejecución de la lista.
- El historial de Step Functions genera un timeline ordenado con Lambda, ECS, S3, subflujos, estados, duración y evidencia de fallos.
- Nueva opción explícita **Mostrar request/response sanitizados** para entradas, parámetros, salidas, errores y causas de la ejecución y de cada paso.
- Los campos habituales de credenciales y datos personales se ocultan, strings y arrays grandes se limitan, los payloads se solicitan sólo bajo demanda y las trazas nunca se persisten.
- Todas las lecturas de trazas y topología permanecen limitadas a recursos asociados y consumen el presupuesto AWS por perfil. KUA no invoca workloads productivos ni habilita logging automáticamente.

### Correcciones Vercel y estabilidad

- Se actualizaron rutas y versiones API de Vercel, se conservaron errores upstream y se soportan las respuestas Cron actuales y antiguas.
- Se corrigieron textos por proveedor, manejo de perfiles, comportamiento de Env Manager y presentación de recursos en las vistas multicloud.
- Se agregó cobertura backend y frontend para migraciones, scoping, extracción ASL, evaluación de topología, trazas, sanitización, compatibilidad Vercel y perfiles.

## v1.11.0 (2026-08-06)

### Observabilidad local de aplicaciones

- Nuevo espacio de aplicaciones por perfil para recursos Lambda, Kubernetes, SQS, EventBridge, Step Functions y ECS confirmados explícitamente.
- Discovery read-only de despliegues CloudFormation y ECS con preview antes de importar. KUA nunca selecciona candidatos ni crea dependencias automáticamente.
- Almacén privado SQLite con agregados UTC de 30 minutos, umbrales locales, cursores de recolección, historial de ejecuciones, retención y health checks.
- Colectores Lambda y Kubernetes con paginación reanudable, deduplicación, estados parciales y captura oportunista de métricas ya cargadas en la interfaz.
- Topología manual por aplicación, umbrales de salud configurables, tendencias locales e historial de métricas aislado por perfil.

### EKS Container Insights

- Nuevo dashboard de observabilidad EKS basado en consultas read-only a CloudWatch Container Insights.
- Las métricas se pueden agrupar por namespace, workload, pod o nodo, mostrando contexto del clúster y sus node groups junto a las series.
- La recolección informa cuando Container Insights no está disponible o devuelve datos parciales, sin provisionar agentes, dashboards, alarmas ni otros recursos AWS.

### Controles de coste y privacidad

- El polling automático APM permanece desactivado por defecto y la recolección se habilita explícitamente por aplicación.
- Límite local estricto de 100.000 lecturas AWS por perfil y mes calendario.
- KUA almacena sólo identificadores confirmados, configuración, cursores, contadores, estado de recolección y agregados. No persiste líneas de CloudWatch Logs, payloads, credenciales, secretos, variables de entorno ni tags arbitrarios.
- Los buckets, cursores y ejecuciones expiran a los 90 días; los registros de presupuesto expiran a los 15 meses.

### Estabilidad de refresco y terminal

- Refresco silencioso y estable cada 5 segundos para Kubernetes, AWS, GCP y Vercel, pausado cuando la ventana está oculta.
- Cachés en memoria stale-while-revalidate para listados cloud y Kubernetes, invalidadas después de mutaciones y cambios de contexto.
- El refresco en segundo plano conserva la identidad de datos sin cambios e ignora respuestas obsoletas después de navegar entre recursos.
- Terminal Logs conserva hasta 5.000 líneas, renderiza ventanas de 1.000, permite pausar/reanudar el seguimiento y seleccionar un pod individual para logs de workloads.

### Compatibilidad runtime y Kubernetes

- Reparación idempotente de módulos nativos para `better-sqlite3`, soporte de unpack/rebuild en Electron, permisos privados para la base y puerto Vite estricto.
- Actualización de patches Kubernetes para las firmas actuales del cliente y eliminación de campos administrados por el servidor antes de aplicar YAML editado.
- Cierre limpio del scheduler/base APM y health reporting en el backend local.

## v1.10.5 (2026-07-07)

### Estabilidad de desarrollo y release

- Separación de puertos para backend estable (`7190`), backend de desarrollo/Electron (`7192`) y frontend Vite (`7193`).
- Workaround en el workflow de release para módulos nativos opcionales que podían fallar durante electron-rebuild multiplataforma.

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
| --- | --- |
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

### Integración con Kubernetes

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

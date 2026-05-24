# Resumen de Funcionalidades

KuaDashboard proporciona una interfaz unificada para gestionar clústeres de Kubernetes y recursos cloud.

![KuaDashboard — Vista de Nodes](/screenshots/dashboard-nodes.png)

## Kubernetes

| Funcionalidad | Recursos |
|---------------|----------|
| **Navegar, Filtrar & Seleccionar** | Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Services, Ingresses, Endpoints, EndpointSlices, ConfigMaps, Secrets, PVCs, PVs, StorageClasses, ResourceQuotas, LimitRanges, HPAs, PDBs, Leases, Nodes, Events y recursos de cluster |
| **Reiniciar** | Deployments, StatefulSets |
| **Escalar** | Deployments, StatefulSets |
| **Ver/Editar YAML + Aplicar** | Todos los recursos |
| **Buscar/Lint/Guardar YAML** | Búsqueda confirmada, validación, botón de guardado, ruta de sección y autocompletado |
| **Operaciones Masivas** | Seleccion multiple y eliminacion masiva para recursos soportados |
| **Panel de Detalle de Recursos** | Resumen por tipo, secciones data/env editables, arbol YAML estructurado, eventos, metricas y panel lateral ajustable |
| **Edicion de Config y Secrets** | Edicion clave/valor para ConfigMaps y Secrets, mas variables de entorno de workloads |
| **Metricas & Eventos** | CPU/memoria via metrics.k8s.io, fallback Prometheus, metricas de Nodes y notificaciones de eventos relacionados |
| **Flujo de Instalacion Helm** | Buscar charts, instalar/actualizar en el cluster activo, ver releases instalados y desinstalar releases |
| **Streaming de Logs en Vivo** | Pods, Deployments, StatefulSets, DaemonSets (WebSocket, multi-contenedor) |
| **Búsqueda/Descarga de Logs** | Búsqueda de texto, filtros por fecha serializada y exportación `.log` |
| **Shell Interactiva** | Pods (exec vía WebSocket) |
| **Eliminar** | Todos los recursos |
| **Cordon / Uncordon** | Nodes |
| **Drain** | Nodes (cordon + evict pods) |
| **Ordenamiento por Age** | Formato de antiguedad legible con ordenamiento numerico por duracion |
| **Multi-contexto** | Cambiar contextos desde el encabezado |
| **Multi-namespace** | Selector global de namespace (incluyendo "Todos los namespaces") |
| **Importar Kubeconfig** | Pegar YAML, elegir un archivo local en Electron o registrar una ruta kubeconfig existente |

## Proveedores Cloud

### AWS
- **Lambda** — Listar funciones, ver configuraciones, invocar
- **ECS** — Navegar clústeres, servicios, tareas
- **EKS** — Listar clústeres, ver detalles
- **EC2** — Gestionar instancias, start/stop, sesiones remotas SSH/RDP persistentes
- **S3** — Navegar buckets, listar/descargar objetos
- **API Gateway** — APIs REST & HTTP, integraciones
- **EventBridge** — Reglas, targets, event buses
- **Step Functions** — State machines, diagrama visual

### GCP
- **Cómputo** — Cloud Run (start/stop), Cloud Run Jobs (ejecutar + historial), GKE, Compute Engine VMs (start/stop)
- **Base de datos** — Cloud SQL (start/stop), Cloud Spanner (editor SQL), Firestore (explorador de documentos), Memorystore Redis
- **Almacenamiento** — Cloud Storage (explorador + vista previa + descarga), Artifact Registry (paquetes)
- **Serverless** — Cloud Functions (invocar + logs)
- **Mensajería** — Pub/Sub Tópicos, Pub/Sub Suscripciones
- **Seguridad** — Secret Manager (vista previa + importar al Env Manager), Cloud KMS (key rings + claves criptográficas)
- **Analítica** — BigQuery (editor SQL + polling de jobs)
- **Flujos de trabajo** — Cloud Workflows (ejecuciones + visor de definición)
- **Red** — Cloud DNS (zonas + registros), VPC Networks (redes + subnets)
- **Asíncrono** — Cloud Tasks (colas + tareas), Cloud Scheduler (ejecutar/pausar/reanudar)
- **DevOps** — Cloud Build (builds + visor de logs)
- **Observabilidad** — Cloud Monitoring (alert policies + uptime checks), Cloud Logging (panel de consulta interactivo)
- **IAM** — Cuentas de servicio (lista + claves)

### Vercel
- **Proyectos** — Navegar todos los proyectos con framework, estado del último deployment y URL de producción
- **Deployments** — Listar deployments por proyecto, filtrar por destino (production/preview); redeployar, promover y cancelar
- **Logs de Build** — Panel de logs en tiempo real vía SSE con auto-scroll
- **Dominios** — Ver dominios personalizados, estado de verificación DNS y mapeos de rama git
- **Variables de Entorno** — Listar claves de env vars por proyecto (valores nunca expuestos)
- **Funciones** — Inspeccionar funciones serverless y edge en cualquier deployment
- **OAuth** — Autorización con un clic desde el navegador (solo app Electron)

## Herramientas

- **Port Forwarding** — Tuneles confiables para Services/Pods con resolucion del pod objetivo, estado persistente y auto-reconexion
- **Helm** — Busqueda/instalacion de charts, inventario de releases, desinstalacion y preset de compatibilidad para metrics-server
- **Shell Local** — Terminal integrada para comandos locales
- **Sesiones Remotas Persistentes** — SSH/RDP a EC2 permanece vivo al ocultarse y puede restaurarse desde tabs de sesión
- **Env Manager** — Almacenar y gestionar credenciales/perfiles cloud

## Interfaz

- Diseño nativo en modo oscuro (con opción de modo claro)
- Tablas de recursos ordenables y filtrables
- Panel de terminal multi-tab
- Panel de recursos Kubernetes ajustable
- Notificaciones toast
- Diálogos modales para acciones destructivas
- Barra de estado con información de contexto y namespace

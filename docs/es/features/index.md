# Resumen de Funcionalidades

KuaDashboard proporciona una interfaz unificada para gestionar clústeres de Kubernetes y recursos cloud.

![KuaDashboard — Vista de Nodes](/screenshots/dashboard-nodes.png)

## Kubernetes

| Funcionalidad | Recursos |
|---------------|----------|
| **Navegar & Filtrar** | Pods, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, PVCs, Nodes, Events |
| **Reiniciar** | Deployments, StatefulSets |
| **Escalar** | Deployments, StatefulSets |
| **Ver/Editar YAML + Aplicar** | Todos los recursos |
| **Streaming de Logs en Vivo** | Pods (WebSocket, multi-contenedor) |
| **Shell Interactiva** | Pods (exec vía WebSocket) |
| **Eliminar** | Todos los recursos |
| **Cordon / Uncordon** | Nodes |
| **Drain** | Nodes (cordon + evict pods) |
| **Multi-contexto** | Cambiar contextos desde el encabezado |
| **Multi-namespace** | Selector global de namespace (incluyendo "Todos los namespaces") |

## Proveedores Cloud

### AWS
- **Lambda** — Listar funciones, ver configuraciones, invocar
- **ECS** — Navegar clústeres, servicios, tareas
- **EKS** — Listar clústeres, ver detalles
- **EC2** — Gestionar instancias, start/stop
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

## Herramientas

- **Port Forwarding** — Port forwards con un clic y gestor visual
- **Shell Local** — Terminal integrada para comandos locales
- **Env Manager** — Almacenar y gestionar credenciales/perfiles cloud

## Interfaz

- Diseño nativo en modo oscuro (con opción de modo claro)
- Tablas de recursos ordenables y filtrables
- Panel de terminal multi-tab
- Notificaciones toast
- Diálogos modales para acciones destructivas
- Barra de estado con información de contexto y namespace

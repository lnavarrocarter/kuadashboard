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
- **Cloud Run** — Servicios, start/stop, scaling
- **GKE** — Listado de clústeres, estado
- **Compute Engine** — Instancias VM, start/stop

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

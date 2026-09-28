---
title: Funcionalidades del Dashboard Kubernetes y Multi-Cloud
description: Conoce las funcionalidades de KUA para gestionar Kubernetes, AWS, GCP, Vercel, logs, Helm, port forwarding y credenciales cifradas.
---

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

## Observabilidad

- **[APM local de aplicaciones](./observability.md)** — Pertenencia confirmada de Lambda y Kubernetes, agregados UTC de 30 minutos, umbrales locales, dependencias manuales y controles de coste sin provisionar recursos cloud.

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

## Opciones de Plataforma: Caché y Almacenamiento

**Ayuda → Opciones** define cada cuánto KUA vuelve a leer datos por su cuenta y muestra cuánto cuesta cada lectura con el valor elegido (lo que se cobra lleva **$**). Los botones de actualizar siempre vuelven a leer, sin importar la opción.

| Opción | Por defecto | Valores | Costo |
|---|---|---|---|
| Actividad de Lambda y Step Functions | 15 min | 5, 15, 30, 60 min | `GetMetricData` de CloudWatch, USD 0.01 por cada 1.000 métricas (fuera de la capa gratuita) |
| KPIs del Resumen de AWS | 15 min | 5, 15, 30, 60 min | `GetMetricData` igual que arriba; las lecturas de CloudTrail y Glue son gratis |
| Conteo de recursos de AWS | 5 min | 1, 5, 15, 30 min | Gratis |
| Costos de AWS (Cost Explorer) | 12 h | 1, 6, 12, 24, 48 h | USD 0.01 por consulta, por perfil; se guarda en disco |
| Auto-actualización de dashboards de CloudWatch | 1 min | 1, 5, 15 min | `GetMetricData` para métricas y alarmas, solo con la auto-actualización activada |
| Límite de ejecución automática de Logs Insights | 1 GB | Preguntar siempre, 256 MB, 1 GB, 5 GB | USD 0.005 por GB leído; las consultas más grandes preguntan antes |

**Almacenamiento local** muestra el espacio que usa la carpeta de datos de KUA (`KUA_DATA_DIR` o `~/.kuadashboard`): el total, cada base SQLite (espacio usado, páginas libres y journal WAL), sus tablas con filas y tamaño, cada archivo con su última modificación, el almacenamiento del navegador que usan vistas, filtros y conexiones guardadas, los perfiles con costos de AWS en caché y el espacio libre en disco. Solo lee; no cambia nada.

**Restaurar valores por defecto** vuelve todas las opciones a su valor inicial, salvo el idioma.

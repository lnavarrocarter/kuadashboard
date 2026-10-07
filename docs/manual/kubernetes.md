# ☸️ Kubernetes

> Las capturas de esta página se retiraron porque mostraban infraestructura real. Volverán generadas desde el Demo Mode, con datos sintéticos.

KUA se conecta a cualquier cluster definido en tu kubeconfig (EKS, GKE, AKS, k3s, minikube…). Soporta **multi-contexto** (cambio en caliente desde el header), **multi-namespace** (selector "Todos los namespaces" o uno específico) e **importación de kubeconfig** por YAML pegado, archivo o ruta.

Características transversales a todas las tablas de recursos:

- **Selección múltiple** con checkbox y eliminación masiva.
- **Filtro de texto** en vivo y ordenamiento por columna (Age ordena por duración real).
- **Panel lateral de detalle** al hacer clic: resumen especializado por tipo, YAML estructurado con editor (validación, lint, autocompletado Ctrl+Space), eventos relacionados y métricas.
- **Auto-refresh** configurable sin perder el contexto de trabajo.

---

## Workloads

### Pods

La vista central de operación diaria. Columnas: nombre, namespace, estado (Running/Pending/Failed con badge de color), ready, reinicios, edad, IP y nodo.

- **Logs en streaming** en tiempo real con buscador, filtros y descarga.
- **Terminal exec** dentro del contenedor.
- **Port-forward** visual persistente entre sesiones.
- **Métricas CPU/memoria** vía metrics-server o Prometheus autodetectado.

### Deployments

Gestión completa del ciclo de vida: **restart** (rollout), **scale** (réplicas), edición de **variables de entorno** por contenedor y vista de imágenes/puertos. Desde aquí también se refleja el cambio de imagen aplicado por el Deploy-to-K8s de ECR (AWS) o Artifact Registry (GCP).

### StatefulSets

Igual que Deployments (restart, scale, env vars) para cargas con estado: bases de datos, colas, brokers.

### DaemonSets

Agentes que corren en cada nodo (CNI, log shippers, monitoring). Vista de pods deseados/listos por nodo.

### ReplicaSets

Generaciones de réplicas creadas por los Deployments — útil para inspeccionar rollouts e historial.

### Jobs

Tareas de ejecución única con estado de completitud y acceso a logs del pod asociado.

### CronJobs

Tareas programadas con su schedule cron, última ejecución y suspensión.

---

## Red

### Services

ClusterIP, NodePort y LoadBalancer con sus puertos. **Port-forward directo** desde la fila para probar servicios sin exponer nada.

### EndpointSlices / Endpoints

Resolución real de los Services: qué IPs de pods están detrás de cada servicio.

### Ingresses

Reglas de entrada HTTP/HTTPS: hosts, paths, backend services y TLS.

### IngressClasses

Controladores de ingreso disponibles (nginx, ALB, traefik…).

### NetworkPolicies

Políticas de tráfico entre pods — quién puede hablar con quién.

---

## Configuración

### ConfigMaps

**Editor clave/valor integrado** — edita datos de configuración sin tocar YAML, y vista de variables de entorno asociadas a workloads.

### Secrets

Igual que ConfigMaps pero con valores enmascarados; editor clave/valor con decodificación base64 transparente.

### ResourceQuotas / LimitRanges

Cuotas y límites de recursos por namespace.

### HorizontalPodAutoscalers

Autoescalado: réplicas min/max, métrica objetivo y estado actual.

### PodDisruptionBudgets / PriorityClasses / RuntimeClasses / Leases

Recursos de gobernanza del scheduling y coordinación de líderes.

### Webhooks de admisión

Configuraciones de mutación y validación que interceptan la creación de recursos.

---

## Almacenamiento

### PVC (PersistentVolumeClaims)

Solicitudes de almacenamiento por namespace con capacidad, modo de acceso y estado de binding.

### PersistentVolumes

Volúmenes del cluster con su claim asociado, política de retención y clase.

### StorageClasses

Provisionadores disponibles (gp2/gp3 en EKS, pd-ssd en GKE…).

---

## Clúster

### Nodes

Nodos con estado, roles, versión de kubelet, OS y **métricas de CPU/memoria** en vivo. Panel de detalle con condiciones, capacidad y eventos del nodo.

### Namespaces

Gestión de namespaces con estado y edad; vista YAML.

### Events

Stream de eventos del cluster — Warning/Normal con razón, objeto involucrado y conteo. Primera parada para diagnóstico.

---

## Helm

### Releases

Releases instalados con chart, versión de app, estado y revisión. Desinstalación con un clic. Tabs adicionales **Repositories** y **Search Charts**.

### Repositorios

Gestión de repositorios Helm y **búsqueda + instalación directa de charts** en el cluster, con presets de compatibilidad (p. ej. metrics-server para clusters locales).

# ☸️ Kubernetes

KUA se conecta a cualquier cluster definido en tu kubeconfig (EKS, GKE, AKS, k3s, minikube…). Soporta **multi-contexto** (cambio en caliente desde el header), **multi-namespace** (selector "Todos los namespaces" o uno específico) e **importación de kubeconfig** por YAML pegado, archivo o ruta.

Características transversales a todas las tablas de recursos:

- **Selección múltiple** con checkbox y eliminación masiva.
- **Filtro de texto** en vivo y ordenamiento por columna (Age ordena por duración real).
- **Panel lateral de detalle** al hacer clic: resumen especializado por tipo, YAML estructurado con editor (validación, lint, autocompletado Ctrl+Space), eventos relacionados y métricas.
- **Auto-refresh** configurable sin perder el contexto de trabajo.

---

## Workloads

### Pods

![Pods](./images/k8s-pods.png)

La vista central de operación diaria. Columnas: nombre, namespace, estado (Running/Pending/Failed con badge de color), ready, reinicios, edad, IP y nodo.

- **Logs en streaming** en tiempo real con buscador, filtros y descarga.
- **Terminal exec** dentro del contenedor.
- **Port-forward** visual persistente entre sesiones.
- **Métricas CPU/memoria** vía metrics-server o Prometheus autodetectado.

### Deployments

![Deployments](./images/k8s-deployments.png)

Gestión completa del ciclo de vida: **restart** (rollout), **scale** (réplicas), edición de **variables de entorno** por contenedor y vista de imágenes/puertos. Desde aquí también se refleja el cambio de imagen aplicado por el Deploy-to-K8s de ECR (AWS) o Artifact Registry (GCP).

### StatefulSets

![StatefulSets](./images/k8s-statefulsets.png)

Igual que Deployments (restart, scale, env vars) para cargas con estado: bases de datos, colas, brokers.

### DaemonSets

![DaemonSets](./images/k8s-daemonsets.png)

Agentes que corren en cada nodo (CNI, log shippers, monitoring). Vista de pods deseados/listos por nodo.

### ReplicaSets

![ReplicaSets](./images/k8s-replicasets.png)

Generaciones de réplicas creadas por los Deployments — útil para inspeccionar rollouts e historial.

### Jobs

![Jobs](./images/k8s-jobs.png)

Tareas de ejecución única con estado de completitud y acceso a logs del pod asociado.

### CronJobs

![CronJobs](./images/k8s-cronjobs.png)

Tareas programadas con su schedule cron, última ejecución y suspensión.

---

## Red

### Services

![Services](./images/k8s-services.png)

ClusterIP, NodePort y LoadBalancer con sus puertos. **Port-forward directo** desde la fila para probar servicios sin exponer nada.

### EndpointSlices / Endpoints

![EndpointSlices](./images/k8s-endpointslices.png)
![Endpoints](./images/k8s-endpoints.png)

Resolución real de los Services: qué IPs de pods están detrás de cada servicio.

### Ingresses

![Ingresses](./images/k8s-ingresses.png)

Reglas de entrada HTTP/HTTPS: hosts, paths, backend services y TLS.

### IngressClasses

![IngressClasses](./images/k8s-ingressclasses.png)

Controladores de ingreso disponibles (nginx, ALB, traefik…).

### NetworkPolicies

![NetworkPolicies](./images/k8s-networkpolicies.png)

Políticas de tráfico entre pods — quién puede hablar con quién.

---

## Configuración

### ConfigMaps

![ConfigMaps](./images/k8s-configmaps.png)

**Editor clave/valor integrado** — edita datos de configuración sin tocar YAML, y vista de variables de entorno asociadas a workloads.

### Secrets

![Secrets](./images/k8s-secrets.png)

Igual que ConfigMaps pero con valores enmascarados; editor clave/valor con decodificación base64 transparente.

### ResourceQuotas / LimitRanges

![ResourceQuotas](./images/k8s-resourcequotas.png)
![LimitRanges](./images/k8s-limitranges.png)

Cuotas y límites de recursos por namespace.

### HorizontalPodAutoscalers

![HPA](./images/k8s-horizontalpodautoscalers.png)

Autoescalado: réplicas min/max, métrica objetivo y estado actual.

### PodDisruptionBudgets / PriorityClasses / RuntimeClasses / Leases

![PDB](./images/k8s-poddisruptionbudgets.png)
![PriorityClasses](./images/k8s-priorityclasses.png)
![RuntimeClasses](./images/k8s-runtimeclasses.png)
![Leases](./images/k8s-leases.png)

Recursos de gobernanza del scheduling y coordinación de líderes.

### Webhooks de admisión

![Mutating](./images/k8s-mutatingwebhookconfigurations.png)
![Validating](./images/k8s-validatingwebhookconfigurations.png)

Configuraciones de mutación y validación que interceptan la creación de recursos.

---

## Almacenamiento

### PVC (PersistentVolumeClaims)

![PVC](./images/k8s-pvc.png)

Solicitudes de almacenamiento por namespace con capacidad, modo de acceso y estado de binding.

### PersistentVolumes

![PV](./images/k8s-persistentvolumes.png)

Volúmenes del cluster con su claim asociado, política de retención y clase.

### StorageClasses

![StorageClasses](./images/k8s-storageclasses.png)

Provisionadores disponibles (gp2/gp3 en EKS, pd-ssd en GKE…).

---

## Clúster

### Nodes

![Nodes](./images/k8s-nodes.png)

Nodos con estado, roles, versión de kubelet, OS y **métricas de CPU/memoria** en vivo. Panel de detalle con condiciones, capacidad y eventos del nodo.

### Namespaces

![Namespaces](./images/k8s-namespaces.png)

Gestión de namespaces con estado y edad; vista YAML.

### Events

![Events](./images/k8s-events.png)

Stream de eventos del cluster — Warning/Normal con razón, objeto involucrado y conteo. Primera parada para diagnóstico.

---

## Helm

### Releases

![Releases](./images/k8s-releases.png)

Releases instalados con chart, versión de app, estado y revisión. Desinstalación con un clic. Tabs adicionales **Repositories** y **Search Charts**.

### Repositorios

![Repositorios](./images/k8s-repositorios.png)

Gestión de repositorios Helm y **búsqueda + instalación directa de charts** en el cluster, con presets de compatibilidad (p. ej. metrics-server para clusters locales).

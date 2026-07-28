# 🌐 GCP

KUA cubre **25 servicios de Google Cloud**. El perfil de credenciales (Env Manager) usa una **service account JSON** o token de acceso, con el proyecto asociado. Desde v1.10.0 los cuatro servicios principales usan paneles **master-detail** con métricas de Cloud Monitoring embebidas.

---

## Cómputo

### Cloud Run

![Cloud Run](./images/gcp-cloud-run.png)

Servicios serverless en master-detail: lista con estado, min/max instances a la izquierda.

- **Overview** — URL, región, ingress, imagen, CPU/memoria, puerto, service account, fechas.
- **Revisions** — historial con **% de tráfico** por revisión y estado Ready.
- **Variables** — env vars del contenedor.
- **Logs** — visor en vivo con selector de rango (1h–3d) y colores por severidad.
- **Metrics** — Request Rate (req/s), Latency p99 (ms) e Instance Count desde Cloud Monitoring.
- Acciones **Start / Stop** del servicio.

### GKE

![GKE](./images/gcp-gke.png)

Clusters Kubernetes con tipo (Autopilot/Standard), versión, nodos/pools, canal de release y estado. **Connect** importa el kubeconfig y cambia el contexto activo de KUA — mismo flujo que EKS.

### Compute VMs

![Compute VMs](./images/gcp-compute-vms.png)

Instancias en master-detail:

- **Overview** — estado, machine type, CPU platform, deletion protection, service account, tags y labels.
- **Disks** — discos adjuntos con tipo, modo y boot flag.
- **Network** — interfaces con red, subred, IP interna y externa.
- **Logs** — Cloud Logging del guest con selector de rango.
- **Metrics** — CPU Utilization (%), Network In (B/s) y Disk Read (B/s).
- Acciones **Start / Stop** de la VM.

---

## Bases de datos

### Cloud SQL

![Cloud SQL](./images/gcp-cloud-sql.png)

Instancias gestionadas (MySQL/PostgreSQL/SQL Server) en master-detail:

- **Overview** — motor, región/zona, disponibilidad, backup habilitado y ventana de mantenimiento.
- **Config** — tier, tipo y tamaño de almacenamiento, auto-resize y database flags.
- **Connection** — connection name e IPs (pública/privada) por tipo.
- **Logs** y **Metrics** — CPU (%), Connections y Disk Used.
- Acciones **Start / Stop** de la instancia.

### Firestore

![Firestore](./images/gcp-firestore.png)

Bases de datos de documentos: navegación por colecciones y documentos con sus campos.

### Cloud Spanner

![Cloud Spanner](./images/gcp-cloud-spanner.png)

Instancias y bases de datos distribuidas con **editor de query SQL**.

---

## Almacenamiento

### Storage (GCS)

![Storage](./images/gcp-storage.png)

Buckets con clase de almacenamiento, ubicación y acceso público. **Browser integrado**:

- Navegación por carpetas virtuales con breadcrumb y filtro.
- **Preview** de texto, imágenes y PDF con metadata completa.
- **⬆ Upload multi-archivo** a la carpeta actual con log de resultados por archivo.
- **🗑 Delete** con confirmación y **⬇ Download** de cualquier objeto.

### Artifact Registry

![Artifact Registry](./images/gcp-artifact-registry.png)

Repositorios de artefactos en master-detail:

- **Packages & Tags** — packages a la izquierda, tabla de tags con digest y fecha a la derecha.
- **🚀 Deploy to K8s** — al pulsar Deploy en un tag Docker se pre-llena la imagen completa; selecciona namespace, deployment y container del cluster activo, revisa el resumen y aplica el cambio de imagen con un clic (strategic merge patch + audit log).

---

## Serverless

### Functions

![Functions](./images/gcp-functions.png)

Cloud Functions v2 en master-detail:

- **Overview** — runtime, trigger, entry point, memoria/CPU/timeout, min/max instances, URL.
- **Variables**, **Logs** y **Metrics** (Executions, Duration p99, Active Instances).
- **Invoke inline** — payload JSON + respuesta en el propio panel (funciones HTTPS).

### Run Jobs

![Run Jobs](./images/gcp-run-jobs.png)

Cloud Run Jobs: ejecución bajo demanda y historial de ejecuciones con estado.

---

## Mensajería

### Pub/Sub

![Pub/Sub](./images/gcp-pub-sub.png)

Tópicos con labels.

### Subscriptions

![Subscriptions](./images/gcp-subscriptions.png)

Suscripciones con tipo (push/pull), tópico asociado, filtro y ack deadline.

---

## Seguridad

### Secret Manager

![Secret Manager](./images/gcp-secret-manager.png)

Secretos con replicación y labels. **Preview & Import**: inspecciona las claves del secreto y selecciona cuáles importar como perfil de credenciales de KUA.

### Cloud KMS

![Cloud KMS](./images/gcp-cloud-kms.png)

Key rings y crypto keys por ubicación con propósito, algoritmo y rotación.

---

## Analítica

### BigQuery

![BigQuery](./images/gcp-bigquery.png)

Datasets con **explorador de tablas** (filas, tamaño, tipo) y **editor de queries SQL** con resultados tabulados.

---

## Workflows y Redes

### Cloud Workflows

![Cloud Workflows](./images/gcp-cloud-workflows.png)

Workflows con estado, ejecuciones, definición YAML y logs.

### Cloud DNS

![Cloud DNS](./images/gcp-cloud-dns.png)

Zonas DNS con sus registros por tipo.

### VPC Networks

![VPC Networks](./images/gcp-vpc-networks.png)

Redes y subnets con CIDR, gateway, Private Google Access y Flow Logs.

---

## Caché y Asincronía

### Memorystore

![Memorystore](./images/gcp-memorystore.png)

Instancias Redis con tier, capacidad, versión y host.

### Cloud Tasks

![Cloud Tasks](./images/gcp-cloud-tasks.png)

Colas de tareas con sus tasks pendientes (paginadas).

### Cloud Scheduler

![Cloud Scheduler](./images/gcp-cloud-scheduler.png)

Jobs programados con cron, estado y **Run / Pause / Resume** por job.

---

## CI/CD y Observabilidad

### Cloud Build

![Cloud Build](./images/gcp-cloud-build.png)

Historial de builds con estado, fuente, duración y **logs por build** (paginado).

### Cloud Monitoring

![Cloud Monitoring](./images/gcp-cloud-monitoring.png)

Alert policies y uptime checks con estado habilitado/deshabilitado. Las **métricas por recurso** están embebidas en los paneles de Cloud Run, VMs, SQL y Functions.

### Cloud Logging

![Cloud Logging](./images/gcp-cloud-logging.png)

Panel de query interactivo: filtro de Cloud Logging, rango de horas y resultados en vivo con severidad coloreada.

### Service Accounts

![Service Accounts](./images/gcp-service-accounts.png)

Cuentas de servicio IAM con sus claves (paginado).

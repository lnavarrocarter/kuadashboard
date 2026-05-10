# Features Overview

KuaDashboard provides a unified interface for managing Kubernetes clusters and cloud resources.

![KuaDashboard — Nodes overview](/screenshots/dashboard-nodes.png)

## Kubernetes

| Feature | Resources |
|---------|-----------|
| **Browse, Filter & Select** | Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Services, Ingresses, Endpoints, EndpointSlices, ConfigMaps, Secrets, PVCs, PVs, StorageClasses, ResourceQuotas, LimitRanges, HPAs, PDBs, Leases, Nodes, Events and cluster resources |
| **Restart** | Deployments, StatefulSets |
| **Scale** | Deployments, StatefulSets |
| **YAML View/Edit + Apply** | All resources |
| **YAML Search/Lint/Save** | Confirmed search, validation, save button, section path and autocomplete |
| **Bulk Operations** | Multi-select and bulk delete for supported resources |
| **Resource Detail Panel** | Per-resource summaries, editable data/env sections, structured YAML tree, events, metrics and resizable side panel |
| **Config & Secret Editing** | Key/value editing for ConfigMaps and Secrets plus workload environment variable editing |
| **Metrics & Events** | CPU/memory via metrics.k8s.io, Prometheus fallback, Node metrics and related event notifications |
| **Helm Install Flow** | Search charts, install/upgrade into the active cluster, inspect installed releases and uninstall releases |
| **Live Log Streaming** | Pods, Deployments, StatefulSets, DaemonSets (WebSocket, multi-container) |
| **Log Search/Download** | Text search, serialized date filters and `.log` export |
| **Interactive Shell** | Pods (exec via WebSocket) |
| **Delete** | All resources |
| **Cordon / Uncordon** | Nodes |
| **Drain** | Nodes (cordon + evict pods) |
| **Age Sorting** | Human-readable age formatting with numeric duration sorting |
| **Multi-context** | Switch contexts from header |
| **Multi-namespace** | Global namespace selector (including "All namespaces") |
| **Kubeconfig Import** | Paste YAML, choose a local file in Electron or register an existing kubeconfig path |

## Cloud Providers

### AWS
- **Lambda** — List functions, view configs, invoke
- **ECS** — Browse clusters, services, tasks
- **EKS** — List clusters, view details
- **EC2** — Manage instances, start/stop, persistent SSH/RDP remote sessions
- **S3** — Browse buckets, list/download objects
- **API Gateway** — REST & HTTP APIs, integrations
- **EventBridge** — Rules, targets, event buses
- **Step Functions** — State machines, visual diagram

### GCP
- **Compute** — Cloud Run (start/stop), Cloud Run Jobs (run + executions), GKE, Compute Engine VMs (start/stop)
- **Database** — Cloud SQL (start/stop), Cloud Spanner (SQL query editor), Firestore (document browser), Memorystore Redis
- **Storage** — Cloud Storage (file browser + preview + download), Artifact Registry (packages)
- **Serverless** — Cloud Functions (invoke + logs)
- **Messaging** — Pub/Sub Topics, Pub/Sub Subscriptions
- **Security** — Secret Manager (preview + import to Env Manager), Cloud KMS (key rings + crypto keys)
- **Analytics** — BigQuery (SQL query editor + job polling)
- **Workflows** — Cloud Workflows (executions + source viewer)
- **Networking** — Cloud DNS (zones + records), VPC Networks (networks + subnets)
- **Async** — Cloud Tasks (queues + tasks), Cloud Scheduler (run/pause/resume)
- **DevOps** — Cloud Build (builds + log viewer)
- **Observability** — Cloud Monitoring (alert policies + uptime checks), Cloud Logging (interactive query panel)
- **IAM** — Service Accounts (list + keys)

## Tools

- **Port Forwarding** — Reliable Service/Pod tunnels with target pod resolution, persistent state and auto-reconnect
- **Helm** — Chart search/install, release inventory, uninstall and metrics-server compatibility preset
- **Local Shell** — Integrated terminal for local commands
- **Persistent Remote Sessions** — EC2 SSH/RDP sessions stay alive while hidden and can be restored from session tabs
- **Env Manager** — Store and manage cloud credentials/profiles

## UI

- Dark mode native design
- Sortable, filterable resource tables
- Multi-tab terminal panel
- Resizable Kubernetes resource panel
- Toast notifications
- Modal dialogs for destructive actions
- Status bar with context and namespace info

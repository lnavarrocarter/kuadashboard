# Features Overview

KuaDashboard provides a unified interface for managing Kubernetes clusters and cloud resources.

![KuaDashboard — Nodes overview](/screenshots/dashboard-nodes.png)

## Kubernetes

| Feature | Resources |
|---------|-----------|
| **Browse & Filter** | Pods, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, PVCs, Nodes, Events |
| **Restart** | Deployments, StatefulSets |
| **Scale** | Deployments, StatefulSets |
| **YAML View/Edit + Apply** | All resources |
| **Live Log Streaming** | Pods (WebSocket, multi-container) |
| **Interactive Shell** | Pods (exec via WebSocket) |
| **Delete** | All resources |
| **Cordon / Uncordon** | Nodes |
| **Drain** | Nodes (cordon + evict pods) |
| **Multi-context** | Switch contexts from header |
| **Multi-namespace** | Global namespace selector (including "All namespaces") |

## Cloud Providers

### AWS
- **Lambda** — List functions, view configs, invoke
- **ECS** — Browse clusters, services, tasks
- **EKS** — List clusters, view details
- **EC2** — Manage instances, start/stop
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

- **Port Forwarding** — One-click port forwards with visual manager
- **Local Shell** — Integrated terminal for local commands
- **Env Manager** — Store and manage cloud credentials/profiles

## UI

- Dark mode native design
- Sortable, filterable resource tables
- Multi-tab terminal panel
- Toast notifications
- Modal dialogs for destructive actions
- Status bar with context and namespace info

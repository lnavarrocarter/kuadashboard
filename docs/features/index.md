# Features Overview

KuaDashboard provides a unified interface for managing Kubernetes clusters and cloud resources.

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
- **Cloud Run** — Services, start/stop, scaling
- **GKE** — Cluster listing, status
- **Compute Engine** — VM instances, start/stop

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

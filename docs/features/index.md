---
title: Kubernetes & Multi-Cloud Dashboard Features
description: Explore KUA features for Kubernetes management, AWS, GCP, Vercel, logs, Helm, port forwarding and encrypted credential profiles.
---

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

### Vercel
- **Projects** — Browse all projects with framework, latest deployment state, and production URL
- **Deployments** — List deployments per project, filter by target (production/preview); redeploy, promote, and cancel
- **Build Logs** — Real-time SSE log streaming panel with auto-scroll
- **Domains** — View custom domains, DNS verification status, and git-branch mappings
- **Environment Variables** — List env var keys per project (values never exposed)
- **Functions** — Inspect serverless and edge functions in any deployment
- **OAuth** — One-click browser authorization (Electron app only)

## Observability

- **[Local Application APM](./observability.md)** — Confirmed Lambda and Kubernetes membership, 30-minute UTC aggregates, local thresholds, manual dependencies, and cost guardrails without cloud provisioning.

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

## Platform Options: Cache & Storage

**Help → Options** controls how often KUA re-reads data on its own, and shows what each re-read costs at the chosen value (billed items are marked with **$**). The refresh buttons always read again, whatever the setting.

| Option | Default | Choices | Cost |
|---|---|---|---|
| Lambda & Step Functions activity | 15 min | 5, 15, 30, 60 min | CloudWatch `GetMetricData`, USD 0.01 per 1,000 metrics (not in the free tier) |
| AWS Overview KPIs | 15 min | 5, 15, 30, 60 min | `GetMetricData` as above; CloudTrail and Glue reads are free |
| AWS resource counts | 5 min | 1, 5, 15, 30 min | Free |
| AWS costs (Cost Explorer) | 12 h | 1, 6, 12, 24, 48 h | USD 0.01 per request, per profile; cached on disk |
| CloudWatch dashboard auto-refresh | 1 min | 1, 5, 15 min | `GetMetricData` for metrics and alarms, only while auto-refresh is on |
| Logs Insights auto-run limit | 1 GB | Always ask, 256 MB, 1 GB, 5 GB | USD 0.005 per GB scanned; larger queries ask first |

**Local storage** shows the disk used by KUA's data folder (`KUA_DATA_DIR` or `~/.kuadashboard`): the total, each SQLite database (used space, free pages and WAL journal), its tables with rows and size, every file with its last change, the browser storage used by views, filters and saved connections, the profiles with cached AWS costs, and the free disk space. It only reads; nothing is changed.

**Restore defaults** resets every option except the language.

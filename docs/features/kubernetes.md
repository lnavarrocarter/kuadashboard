---
title: Kubernetes Dashboard & Cluster Management
description: Manage Kubernetes workloads, services, networking, storage, YAML, metrics, events, logs and port forwarding with KUA.
---

# Kubernetes Features

![KuaDashboard — Kubernetes dashboard](/screenshots/dashboard-main.png)

## Cluster Overview

**Overview** at the top of the Kubernetes sidebar summarizes the health of the active context:

- **Headline tiles** — pods (ready and running), pods with problems and their total restarts, nodes ready, workloads (Deployments, StatefulSets, DaemonSets) below their desired replicas, and Warning events in the last hour.
- **Cluster usage** — current CPU and memory against the nodes' allocatable capacity, read from the Metrics API (metrics-server). Without metrics-server KUA reads the same numbers from Prometheus (node-exporter), per node too; with neither, the card says so and shows the API's answer. The card also shows which Prometheus service was detected.
- **Pods by status** — a bar and legend with Running, Pending, Succeeded, Failed and Unknown counts, plus chips for each problem reason.
- **Pods with problems** — the worst pods first (most restarts), with the reason kubectl would show: `CrashLoopBackOff`, `ImagePullBackOff`, `OOMKilled`, `Unschedulable`, `Evicted`, or `NotReady` for running pods failing their readiness probe.
- **Nodes** — readiness, cordon state, pressure conditions (memory, disk, PID, network) and per-node CPU/memory when metrics-server is available.
- **Trends** — with Prometheus in the cluster (for example kube-prometheus-stack), charts for CPU, memory, container restarts and not-ready pods over the last 1 h, 6 h, 24 h or 7 d (about 120 points per range; the chosen range is remembered). For the whole cluster CPU and memory come from node-exporter; for a namespace they come from its containers (cAdvisor). Restarts and not-ready pods need kube-state-metrics; a chart without data says so without hiding the others.
- **Workloads not ready** and **recent warnings**.

Pods, workloads and events follow the namespace selector (including *All namespaces*); nodes and usage always cover the whole cluster. Every tile, chip and row opens the matching table with the filter already applied, for example *Pods with problems* opens Pods with the **With problems** quick filter on. Each section degrades on its own: if your RBAC role cannot list nodes, only the node section shows the error. The view refreshes with the global auto-refresh interval.

The Overview is not an alerting system: it shows the current state and never sends notifications.

## Resource Browser

Browse all major Kubernetes resources with sortable, filterable tables:

- **Workloads**: Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs
- **Network**: Services, Ingresses, IngressClasses, Endpoints, EndpointSlices, NetworkPolicies
- **Config**: ConfigMaps, Secrets (values redacted by default)
- **Storage**: PersistentVolumeClaims, PersistentVolumes, StorageClasses
- **Policy & Scheduling**: ResourceQuotas, LimitRanges, HPAs, PDBs, Leases, PriorityClasses, RuntimeClasses
- **Admission & Cluster**: MutatingWebhookConfigurations, ValidatingWebhookConfigurations, Namespaces, Nodes, Events

Each resource table shows key fields (name, namespace, status, age) and provides contextual actions. Tables support multi-select for bulk deletion where Kubernetes allows deletion of the selected resource type.

### Services table

Besides Type, Cluster IP and Ports, the Services table shows:

- **App** — the application behind the Service, taken from its selector (`app.kubernetes.io/name`, then `app`, then `k8s-app`); falls back to the Service's own labels, or `-`.
- **Backend IPs** — internal IPs of the pods currently backing the Service, read from its EndpointSlices. Pods that exist but are not ready are listed after `not ready:`. Long lists are truncated; hover to see all of them. `ExternalName` Services show their target (`→ host`), `-` means no backing pods, and `?` means KUA could not read EndpointSlices (check RBAC for `discovery.k8s.io/endpointslices`).

The IPs come from one EndpointSlice list call per namespace (or for the whole cluster in *All namespaces*), not one lookup per Service, so large namespaces stay fast. The table filter also matches app names and backend IPs.

The `Age` column is displayed as a readable duration and still sorts by the real elapsed time, so values such as `30sec`, `2min`, `23hrs 10min` and `1day 3hrs 10min` order correctly in both directions.

Selecting a row opens a resizable detail panel with a resource-specific summary, labels, containers, networking, storage, events or scheduling fields depending on the resource type.

### Events severity

The Events table colour-codes every event by criticality and lets you filter by it:

- **Critical** (red) — something is failing now: crash loops and back-offs, image pull errors, OOM kills, evictions, volume mount/attach failures, failed pod or job creation, and node problems (not ready, disk/memory/PID pressure).
- **Warning** (amber) — any other `Warning` event, such as probe failures or scheduling retries.
- **Normal** (grey) — `Normal` events.

Use the **Critical / Warning / Normal** chips in the table toolbar to show only those severities (each chip shows how many events it matches; select several to combine them, ✕ to show all). The chips work together with the text filter, and clicking the **Severity** column header sorts critical events first.

### Filters, quick filters and history

- **Per-table view** — each resource table remembers its own text filter, sort column and filter chips when you move to another section and back, and after reloading the app.
- **Quick filters** — one-click chips with counts for common questions, such as Pods *With problems*, *Not Running*, *Not ready* and *With restarts*; Deployments *Not ready* and *Scaled to 0*; ReplicaSets *Inactive*; Secrets *TLS* and *Registry*; HPAs *At max*; PDBs *Blocking evictions*; Nodes *Not Ready* and *Cordoned*. Active chips combine (a row must match all of them) and combine with the text filter.
- **Filter history** — focus the filter box to see the table's **Saved** and **Recent** filters. A filter becomes recent when you press Enter, leave the box or switch tables; the star (☆) saves it and ✕ forgets it.
- **Pod status** — the Status column shows the problem reason (for example `CrashLoopBackOff` or `NotReady`) instead of the phase when a pod is unhealthy, and the text filter matches it.

## Auto Refresh

KuaDashboard can refresh the active Kubernetes view automatically without changing your selected namespace, resource type or detail panel.

Auto-refresh is also respected across AWS, GCP and Helm views, so the currently visible operational surface stays current without manual reloads.

## Live Log Streaming

Stream pod and workload logs in real time via WebSocket:

- Select specific containers in multi-container pods
- Stream Pods directly or resolve Deployments, StatefulSets and DaemonSets to their active Pods
- Multi-tab interface — stream logs from multiple pods or workloads simultaneously
- Search within log output and filter by serialized date/time
- Download the current filtered log view as a `.log` file
- ANSI/VT cleanup and chunk buffering for correctly serialized framework logs
- Auto-scroll with manual override

## Interactive Shell (Exec)

Open a terminal session directly into any running pod:

- Full PTY support via WebSocket
- Container selection for multi-container pods
- Keyboard shortcuts work as expected

## YAML Viewer & Editor

View and edit the full YAML manifest of any resource:

- Confirmed search action with next/previous navigation
- Lint/validation before save, with line and column diagnostics
- Save button and keyboard shortcut support
- Current line, column, total line count and section path indicator
- Autocomplete suggestions via `Ctrl+Space`
- Edit in-place and save changes back to the cluster
- Secret values are `[REDACTED]` for security

## Config, Secrets & Environment Editing

ConfigMaps and Secrets include a focused key/value editor so common edits do not require hand-editing the full manifest. Secret values remain protected in YAML views while still supporting controlled edits from the data tab.

Workload detail panels expose container environment variables, making it easier to inspect and update env definitions without leaving the resource context.

## Resource Detail Panel

Click any Kubernetes resource row to open a right-side detail panel:

- **Overview** — resource-specific fields for Pods, workloads, Services, Ingresses, Secrets, PVCs, Nodes and Events
- **YAML** — structured tree view of the live manifest
- **Metrics** — CPU and memory cards for Pods using `metrics.k8s.io`
- **Metrics** — CPU and memory cards for Pods, workloads and Nodes using `metrics.k8s.io` where available
- **Prometheus fallback** — discovers Prometheus services and queries them through the Kubernetes API server proxy when Metrics Server is unavailable
- **Events** — related event and notification view for scheduling, image pull, health and lifecycle diagnostics
- **Resizable layout** — drag the divider to adjust the panel width

## Helm & Metrics Server

The Helm view can search configured chart repositories, install charts into the active cluster and list installed releases. Install operations show output and release status so long-running installs are visible.

When installing `metrics-server`, KuaDashboard offers a compatibility preset for local or self-signed clusters:

```yaml
args:
	- --kubelet-insecure-tls
	- --kubelet-preferred-address-types=InternalIP,ExternalIP,Hostname
apiService:
	insecureSkipTLSVerify: true
```

## Scaling

Scale Deployments and StatefulSets with a simple dialog:

- Shows current replica count
- Input desired replicas
- Immediate apply with status feedback

## Node Management

Advanced node operations:

- **Cordon** — Mark node as unschedulable
- **Uncordon** — Restore scheduling
- **Drain** — Safely evict all pods (cordon + evict)

## Context & Namespace Switching

- **Multi-context** — Switch between Kubernetes contexts from the header dropdown
- **Multi-namespace** — Filter by namespace or view "All namespaces"
- **Import kubeconfig** — Add new clusters directly from pasted YAML, a desktop file picker or a registered kubeconfig path
- **Delete context** — Remove unwanted contexts

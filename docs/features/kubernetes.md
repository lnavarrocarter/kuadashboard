# Kubernetes Features

![KuaDashboard — Kubernetes dashboard](/screenshots/dashboard-main.png)

## Resource Browser

Browse all major Kubernetes resources with sortable, filterable tables:

- **Workloads**: Pods, Deployments, StatefulSets, DaemonSets
- **Network**: Services, Ingresses
- **Config**: ConfigMaps, Secrets (values redacted by default)
- **Storage**: PersistentVolumeClaims
- **Cluster**: Nodes, Events

Each resource table shows key fields (name, namespace, status, age) and provides contextual actions.

Selecting a row opens a resizable detail panel with a resource-specific summary, labels, containers, networking, storage, events or scheduling fields depending on the resource type.

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

## Resource Detail Panel

Click any Kubernetes resource row to open a right-side detail panel:

- **Overview** — resource-specific fields for Pods, workloads, Services, Ingresses, Secrets, PVCs, Nodes and Events
- **YAML** — structured tree view of the live manifest
- **Metrics** — CPU and memory cards for Pods using `metrics.k8s.io`
- **Prometheus detection** — shows whether Prometheus services exist and offers a Helm handoff when monitoring is missing
- **Resizable layout** — drag the divider to adjust the panel width

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
- **Import kubeconfig** — Add new clusters directly from the UI
- **Delete context** — Remove unwanted contexts

# Kubernetes Features

## Resource Browser

Browse all major Kubernetes resources with sortable, filterable tables:

- **Workloads**: Pods, Deployments, StatefulSets, DaemonSets
- **Network**: Services, Ingresses
- **Config**: ConfigMaps, Secrets (values redacted by default)
- **Storage**: PersistentVolumeClaims
- **Cluster**: Nodes, Events

Each resource table shows key fields (name, namespace, status, age) and provides contextual actions.

## Live Log Streaming

Stream pod logs in real time via WebSocket:

- Select specific containers in multi-container pods
- Multi-tab interface — stream logs from multiple pods simultaneously
- Search within log output
- Auto-scroll with manual override

## Interactive Shell (Exec)

Open a terminal session directly into any running pod:

- Full PTY support via WebSocket
- Container selection for multi-container pods
- Keyboard shortcuts work as expected

## YAML Viewer & Editor

View and edit the full YAML manifest of any resource:

- Syntax-highlighted YAML display
- Edit in-place and **Apply** changes back to the cluster
- Secret values are `[REDACTED]` for security

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

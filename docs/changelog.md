# Changelog

## v1.9.0 (Mayo 2026)

### Vercel

- Full Vercel provider integration with OAuth authentication — connect your Vercel account directly from the profile modal.
- Projects view with deployment status, framework, region and quick links to the live URL.
- Deployment details with Activity feed, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config and Checks tabs.

### AWS Step Functions

- New **Executions** column in the Step Functions table showing live counts of running (▶), failed (✗) and timed-out (⏱) executions.
- New **Versiones** tab in the Info panel — lists all published workflow versions with creation date, description and on-click ASL definition viewer with copy button.
- Info modal refactored with five tabs: Detalles, Diagrama, Ejecuciones, Eventos and Versiones.

## v1.8.0 (2026-05-10)

### Kubernetes

- Resource tables now support multi-select, bulk delete and richer row actions.
- The Kubernetes menu now covers more resources across workloads, networking, storage, config, policy, RBAC, scheduling, admission and cluster administration.
- The `Age` column displays readable durations such as `1day 3hrs 10min`, `23hrs 10min`, `2min` and `30sec`, while sorting by the real elapsed duration.
- ConfigMaps and Secrets have an easier key/value data view for mapping and editing values.
- Workloads expose environment variables in the detail panel, including editable container env entries.
- The kubeconfig modal can import pasted YAML, load a file through the desktop file picker or register an existing kubeconfig path.

### Helm

- Charts can be searched from configured repositories and installed directly into the active cluster.
- Installed releases can be listed and uninstalled from the Helm view.
- Installations show progress, output and final release status instead of leaving the UI waiting silently.
- `metrics-server` installs include a compatibility preset for local or self-signed clusters, adding kubelet TLS and preferred address flags.

### Observability

- Metrics are available for Pods, workloads and Nodes through `metrics.k8s.io`.
- When Metrics Server is unavailable, KuaDashboard can discover Prometheus services and query metrics through the Kubernetes API server proxy.
- Resource and Node detail panels include related events and notification-style summaries to help diagnose scheduling, image pull, health and lifecycle issues.

### Port Forwarding

- Service and Pod tunnels are more reliable, with improved target pod resolution, persistent session state and reconnect behavior.
- Port-forward actions are available from resource tables and detail surfaces where the selected resource supports a tunnel.

## v1.7.0 (2026-05-05)

- Auto-refresh for Kubernetes, AWS, GCP and Helm views without resetting navigation context.
- Resizable Kubernetes resource detail panel with specialized summaries and structured YAML.
- Pod metrics using `metrics.k8s.io`, Prometheus detection and Helm handoff when monitoring is missing.
- Real-time log streaming for Pods, Deployments, StatefulSets and DaemonSets.
- Terminal Logs search, serialized date filters, downloads and line counts.
- YAML editor search, lint, save, line/column status, section path and autocomplete.
- Persistent EC2 SSH/RDP sessions that can be hidden and reopened without closing the connection.

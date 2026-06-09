# Changelog

## v1.10.0 (2026-06-09)

### GCP — Master-detail panels

All four core GCP services now have a full split-panel master-detail layout: a resource list on the left and a tabbed detail panel on the right, consistent with the established Cognito / Athena / Lex pattern.

- **Cloud Run** — tabs: Overview (config, image, scaling), Revisions (with traffic %), Variables (env vars), Logs, Metrics.
- **Compute VMs** — tabs: Overview (tags, labels, deletion protection), Disks, Network (interfaces & IPs), Logs, Metrics.
- **Cloud SQL** — tabs: Overview (backup & availability), Config (storage type, flags), Connection (IP addresses, connection name), Logs, Metrics.
- **Cloud Functions** — tabs: Overview (runtime, resources, trigger), Variables, Logs, Invoke (inline, replaces the old floating modal), Metrics.

### GCP — Embedded Cloud Monitoring Metrics

A **Metrics** tab is now embedded in all four service panels. Each tab shows three Chart.js line charts pulled from the Cloud Monitoring v3 API with a configurable time range (1h / 3h / 6h / 24h) and a Refresh button.

| Service | Charts |
|---|---|
| Cloud Run | Request Rate (req/s) · Latency p99 (ms) · Instance Count |
| Compute VMs | CPU Utilization (%) · Network In (B/s) · Disk Read (B/s) |
| Cloud SQL | CPU Utilization (%) · Connections · Disk Used (bytes) |
| Cloud Functions | Execution Count (req/s) · Duration p99 (ns) · Active Instances |

### GCP — GCS Upload & Delete

- **Upload**: a new "⬆ Upload" button appears in the GCS Browser toolbar. Supports multi-file selection, uploads each file to the current folder as raw binary, and shows a per-file result log (✓ / ✗).
- **Delete**: a "🗑 Delete" button appears in the file preview panel. Asks for confirmation before calling the new `DELETE /storage/:bucket/object` backend route.

### GCP — Artifact Registry Deploy-to-K8s

Artifact Registry is redesigned as a master-detail panel with two tabs:

- **Packages & Tags** — two-column view: packages list on the left, tag table on the right. Each Docker tag row has a **🚀 Deploy** button.
- **Deploy to K8s** — clicking Deploy pre-fills the full image reference (`location-docker.pkg.dev/project/repo/pkg:tag`). The panel then lets you select the target Namespace, Deployment and Container from the active Kubernetes cluster, shows a deploy summary and applies the change with a single click.

### Kubernetes

- New `POST /api/:namespace/deployments/:name/set-image` endpoint: performs a strategic-merge-patch on one container's image and writes an audit log entry.

### GCP — Log viewer improvements

- Log entries in all detail panels now use severity-based colour coding: `ERROR`/`CRITICAL` → red, `WARNING` → amber, `INFO`/`NOTICE` → green, `DEBUG`/`DEFAULT` → dim.

## v1.9.3 (2026-06-09)

### AWS Amazon Lex

- Redesigned the Lex view with a **master-detail split-panel layout** (like Cognito and Athena). The left panel lists all bots with status, version and last-updated date. Clicking a bot opens the detail panel on the right.
- Removed the 8 individual colored action buttons from each table row. All functionality (Intents, Aliases, Slot Types, Chat, Logs, Missed, Metrics, Test Set) is now accessible via a tab bar in the right panel.
- Data is loaded on-demand per tab and cached for the active bot — switching tabs for the same bot does not re-fetch.
- The Chat and Build actions inside the Aliases tab now navigate to their respective tabs instead of opening nested modals.

## v1.9.2 (2026-06-09)

### AWS DynamoDB

- Added **item editing** in the Browse modal: each row now has an ✏️ button that opens a JSON editor pre-filled with the item's current data. Saving performs a `PutItem` (full replace) and refreshes the current page.
- Added **item deletion** per row: the 🗑 button extracts the primary key fields automatically from the table's key schema and asks for confirmation before calling `DeleteItem`.
- Added **New Item** button in the Browse modal toolbar: opens the JSON editor pre-filled with only the key fields so you can create a new record from scratch.
- JSON editor validates syntax in real time and blocks saving when there are parse errors.

## v1.9.1 (2026-05-28)

### AWS Cognito

- Fixed user search behavior in User Pools to support free-text lookups without triggering AWS filter parsing errors.
- Added user attribute editing from the user details modal.
- Added group membership management from user details: assign and remove groups for a selected user.
- Added per-user MFA controls in details: enable via toggle, disable via action button, and preferred method switch (SMS/TOTP).
- Added create-group flow with description support in the Groups tab.
- Fixed runtime issue in group creation flow where the UI could fail with `createCognitoGroup is not a function` in stale hot-reload states.
- Fixed MFA status mismatch between user list and details by aligning list calculation with Cognito MFA settings (`UserMFASettingList` / `PreferredMfaSetting`, with compatibility fallback).

## v1.9.0 (2026-05-26)

### Vercel

- Full Vercel provider integration with OAuth authentication — connect your Vercel account directly from the profile modal.
- Projects view with deployment status, framework, region and quick links to the live URL.
- Deployment details with Activity feed, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config and Checks tabs.

### AWS Step Functions

- New **Executions** column in the Step Functions table showing live counts of running (▶), failed (✗) and timed-out (⏱) executions.
- New **Versiones** tab in the Info panel — lists all published workflow versions with creation date, description and on-click ASL definition viewer with copy button.
- Info modal refactored with five tabs: Detalles, Diagrama, Ejecuciones, Eventos and Versiones.

### Terminal & Shell Improvements

- **Native Copy/Paste Support**: Electron menu now includes Edit menu with native roles for copy, paste, cut, select all and standard keyboard shortcuts.
- **Context Menu**: Right-click on selected text to copy; right-click on input fields to cut/paste/copy as native OS behavior.
- **Copy Selected**: Button to copy currently selected terminal text without depending on keyboard shortcuts.
- **Copy Output**: Button to copy the entire terminal output (all filtered lines), with timestamps automatically removed for clean text.
- **Paste into Input**: Button to safely paste clipboard content into command input, with confirmation for multiline text to prevent accidental execution.
- **Terminal Panel**: Full copy/paste UI in the bottom terminal panel used for Kubernetes, local shell, and AWS/GCP logs.
- **Local Shell**: Dedicated copy/paste buttons in LocalShellView header for shell session management.
- **SSH Terminal**: Ec2Shell now supports copy selected, copy output, and safe paste with Ctrl+C remaining as interrupt signal.
- **RDP Paste Modal**: RDP session has a "Paste text" feature with textarea modal to send text as keyboard events to the focused remote field. Note: copy from RDP canvas is not available (render is pixels, not selectable text); use SSH or remote command to extract logs from Windows machines.
- **Selection CSS Fix**: Terminal output areas now allow text selection (user-select: text) while preserving non-selectable decorative elements like timestamps and tab headers.

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

## v1.6.2 (2026-04-29)

- AWS EC2 Info copy buttons for key fields: Instance ID, AMI, Public/Private IP, Public/Private DNS, Key Pair and IAM Profile.
- AWS Lambda Info copy buttons for key fields: ARN, SHA256, VPC ID, DLQ ARN and KMS Key ARN.
- UX polish for copy actions: hover visibility and temporary visual confirmation.

## v1.6.1 (2026-04-24)

- AWS RDS: new per-instance panel with actions for Info, Configuration, Connection and password reset.
- AWS RDS: redesigned detail modal with AWS-console style tabs (connectivity/security, monitoring/logs, configuration, maintenance/backups, migration/replicas, tags).
- AWS RDS: Spanish translations completed for modal texts, buttons and status messages.
- AWS Database: unified navigation and view under RDS, removing residual DocumentDB section from UI.
- Documentation: expanded Spanish IAM minimum-permissions guide with RDS required actions.
- Fixed mojibake encoding in HelpModal titles/comments.
- Fixed Helm behavior for EKS ARN contexts by injecting full KUBECONFIG when invoking helm CLI.

## v1.6.0 (2026-04-24)

- AWS Lambda: dedicated Logs tab with CloudWatch events and selectable time ranges.
- AWS Lambda: create log group flow with retention options when missing.
- AWS ECR Deploy to K8s: optional Service creation (ClusterIP / NodePort / LoadBalancer).
- Fixed generated deployment YAML indentation issue.
- Added `--validate=false` to kubectl apply for compatibility in restricted API setups.
- Fixed Athena UI error `sortedRows is not a function`.
- Adjusted AWS Lex/Athena `maxResults` to supported API limits.

## v1.5.0 (2026-04-23)

- AWS S3: create bucket modal and per-bucket test action.
- AWS ECR: image browser and direct deploy-to-Kubernetes flow.
- AWS VPC: details panel with overview, subnets, security groups, route tables, IGW and NAT GW.
- AWS Cognito: groups tab per user pool.

## v1.4.3 (2026-04-23)

- Windows app icon/taskbar behavior fix via App User Model ID.
- Packaging metadata updates.

## v1.4.2 (2026-04-21)

- AWS Lambda details panel with multiple tabs and richer diagnostics.
- AWS EC2 details panel with monitoring, security groups, volumes and console output.
- EC2 SSH password authentication and PEM picker support.
- OS-aware SSH/RDP actions with integrated RDP canvas.

## v1.4.1 (2026-04-21)

- Auto-updater robustness: `quitAndInstall` fallback handling.
- UpdateNotice error state with manual download option.

## v1.4.0 (2026-04-20)

- GCP feature expansion (Cloud Run Jobs, Pub/Sub Subscriptions, VPC Networks, Cloud Monitoring, Cloud Logging, Cloud KMS).
- Pagination improvements in Cloud Build, IAM Service Accounts and Cloud Tasks.
- Observability section improvements in GCP sidebar.

## v1.3.3 (2026-04-21)

- macOS: migrate credential storage to native keychain using `@napi-rs/keyring`.
- macOS updater compatibility fixes for release artifacts.

## v1.3.2 (2026-04-21)

- macOS auto-updater fix ensuring ZIP artifact availability.

## v1.3.1 (2026-04-21)

- macOS auto-updater fix ensuring ZIP artifact availability.

## v1.3.0 (2026-04-21)

- GCP phase expansion (Spanner, Redis, Cloud Tasks, Scheduler, Cloud Build, IAM Service Accounts).
- Full EN/ES bilingual UI with reactive switching.
- Header quick actions for language and theme.
- Helm view and related UX improvements.
- WebSocket and terminal reliability fixes.

## v1.2.0 (2026-04-20)

- GCP phase 1-2 additions: Secret Manager, Cloud Functions, GCS Browser, Artifact Registry, BigQuery, Cloud Workflows, Cloud DNS and Firestore.
- Persistent port forwarding.
- Expanded AWS coverage across core services.

## v1.1.3 (2026-04-21)

- macOS auto-updater ZIP target compatibility fix.

## v1.1.2 (2026-04-20)

- macOS: Electron now inherits login shell PATH when launched from Dock.
- Update availability notice integrated in Help modal.

## v1.1.1 (2026-04-20)

- AWS/GCP credential selectors in global header.
- Local Shell and Env Manager quick access from header.
- Help modal with About, Releases and Feedback/Issues.
- UI icon and refresh controls improvements.

## v1.1.0 (2026-04-20)

- Initial AWS/GCP sidebar navigation and credential selectors.
- Early support for Step Functions, EventBridge, API Gateway, Pub/Sub and Cloud Functions.
- SSH and terminal UX improvements.

## v1.0.0 (2026-01-01)

- Initial KUA release: Kubernetes dashboard, cloud views, env manager, port-forwarding and log/exec tooling.

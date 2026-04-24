# AWS Integration

KuaDashboard provides a comprehensive AWS management panel accessible from the sidebar under **Cloud > AWS**. It gives you a single unified view over **19 AWS services** without ever leaving the dashboard.

> **v1.6.0 highlights:** Lambda Logs tab with CloudWatch viewer & log group creation; ECR Deploy to K8s YAML bug fixes + Service creation option; API maxResults constraint fixes (Lex, Athena).

![KuaDashboard — dashboard overview](/screenshots/dashboard-main.png)

## Authentication

AWS credentials can be configured in multiple ways:

| Method | Description |
|---|---|
| **Env Manager** | Store named profiles with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION` |
| **AWS CLI** | Reads `~/.aws/credentials` and `~/.aws/config` automatically |
| **Local profiles** | Select any named profile from your existing `~/.aws/credentials` |
| **Environment variables** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| **IAM roles** | When running on AWS infrastructure (EC2, ECS task, Lambda, etc.) |

Select your active profile and region from the dropdowns in the AWS panel header. All API calls use the selected profile credentials.

---

## Compute

### EC2 Instances

Browse all EC2 instances with full detail and lifecycle control:

- Instance ID, name tag, type, public/private IP, availability zone, launch time
- **Start** and **Stop** instances directly from the table
- **SSH** — open a browser-based interactive SSH session (available when `running`)
- **Tags** — view all resource tags
- **Config** — view full JSON configuration of the instance
- Sortable by any column; searchable by name, ID, type or state

### ECS (Elastic Container Service)

Full visibility into ECS services across all clusters:

- Service name, task definition, cluster, status (ACTIVE / DRAINING / INACTIVE)
- Desired, running and pending task counts
- **Start** — scale the service to 1 desired task
- **Stop** — scale the service to 0 desired tasks
- **Logs** — stream CloudWatch logs for the service
- **CW Logs** — open the CloudWatch Logs browser with configurable time window
- **Config** — view full service JSON configuration

### EKS (Elastic Kubernetes Service)

Browse all EKS clusters:

- Cluster name, region, Kubernetes version, status, creation date
- **Config** — inspect ARN, endpoint, IAM role and tags
- **Add to Dashboard** — runs `aws eks update-kubeconfig` automatically so the cluster appears in the Kubernetes panel immediately

---

## Serverless

### Lambda Functions

Manage Lambda functions with a rich detail modal — click any function name to open it.

- Function name, description, runtime (Node.js / Python / Go / Java / etc.), memory (MB), timeout (s), state, last modified
- **Invoke** — send a custom JSON payload synchronously and inspect the full response
- **Detail modal** (6 tabs):
  - **Básico** — name, ARN, description, state, version, architecture, package type, memory, timeout, ephemeral storage, code size/hash and **Tags** (all in one grid)
  - **Configuración** — environment variables (toggle reveal), layers, VPC config, tracing/DLQ/concurrency, EFS mounts
  - **Logs** — live CloudWatch log viewer with time-range selector (15 min → 24 h) and refresh; if the log group does not exist yet, shows a **Create Log Group** button with configurable retention (7–365 days)
  - **Monitoreo** — CloudWatch metric sparklines: Invocations, Errors, Duration, Throttles, ConcurrentExecutions
  - **Aliases** — aliases and published versions table
  - **Código** — file tree + syntax-highlighted code viewer for ZIP-packaged functions

### API Gateway

List all REST (v1) and HTTP/WebSocket (v2) APIs in one unified table:

- API name, ID, type (REST / HTTP / WEBSOCKET), endpoint URL, creation date
- **Config** — view stages, settings and deployment history
- **Routes** — open the integrations panel listing all routes, HTTP methods and backend targets

---

## Storage

### S3 Browser

Browse bucket contents without leaving the dashboard:

- Bucket name, region, creation date, tags
- **Browse** — navigate folders, view object sizes, download files, preview text content inline
- **Tags** — view bucket tags
- **Config** — view versioning, encryption, ACLs and CORS configuration
- **Test** — check endpoint accessibility and measure latency (ms) for any bucket; result shown inline per row
- **+ Create Bucket** — create a new S3 bucket with name, optional region and optional public access block

### DynamoDB

Inspect and manage DynamoDB tables:

- Table name, partition + sort key schema, status, billing mode (PAY_PER_REQUEST / PROVISIONED), item count, size on disk, creation date
- **Browse** — scan / query records visually in the inline item browser
- **Info** — detailed panel: billing mode, provisioned throughput, key schema, GSIs, LSIs, stream status, ARN
- **+ Create Table** — create a new table with partition key, optional sort key, billing mode and RCU/WCU

### ECR (Elastic Container Registry)

Manage Docker image repositories:

- Repository name, full URI, image tag mutability (MUTABLE / IMMUTABLE), scan-on-push status, creation date
- **Tags** — view resource tags
- **Config** — view lifecycle policies and scanning configuration
- **Images** — browse all images in the repository with digest, tags, push date, size and scan findings
- **Deploy to K8s** — generate Kubernetes manifests from any image tag and apply them directly to the connected cluster:
  - Configure app name, namespace, replica count, container port, image pull secret and `kubectl` context
  - **Create Service** option — optionally append a `Service` resource (`ClusterIP`, `NodePort` or `LoadBalancer`) separated by `---`
  - Copy YAML to clipboard or apply with one click (`kubectl apply --validate=false`)

---

## Networking

### VPC

Inspect Virtual Private Clouds:

- VPC name, ID, CIDR block, state, subnet count, default VPC indicator
- **Tags** — view all VPC tags
- **Config** — view route tables, internet gateways and DHCP options
- **Details** — deep-dive panel with 6 inner tabs:
  - **Overview** — VPC info card, resource summary counts (subnets, SGs, route tables, IGWs, NAT GWs) and all tags
  - **Subnets** — subnet ID, CIDR, availability zone, state, auto-assign public IP, available IP count
  - **Security Groups** — per-group card showing name, description and inbound rules table (protocol, port range, source CIDR)
  - **Route Tables** — per-table card listing all routes (destination CIDR, target, origin, state)
  - **Internet Gateways** — gateway ID, state, attachment state
  - **NAT Gateways** — gateway ID, subnet, public/private IP, state, creation date

### CloudFront

Manage CDN distributions:

- Domain name, status (Deployed / InProgress), enabled/disabled, price class, custom aliases, origins
- **Invalidate** — create a cache invalidation (`/*` or specific paths)
- **Stats** — view data transfer, request count and error-rate charts
- **Visit Site** — open the distribution URL (or primary alias) in a new tab
- **Config** — view full distribution configuration
- **+ Create from S3** — wizard to create a new distribution backed by an S3 bucket

### Route 53

Two-panel DNS browser:

- **Left panel** — hosted zones with record count and public/private indicator
- **Right panel** — click a zone to load all records: name, type, TTL, value or alias target

---

## Database & Analytics

### DocumentDB

Manage Amazon DocumentDB clusters (MongoDB-compatible):

- Cluster ID, master username, status, engine version, endpoint, port, multi-AZ and storage encryption indicators
- **Connect** — view connection string and TLS options
- **Config** — view full cluster configuration
- **Reset Pwd** — trigger a master-user password reset
- **+ New Cluster** — launch the cluster creation wizard

### Glue

Monitor and trigger ETL jobs:

- Job name, type (glueetl / pythonshell / ray), Glue version, worker type, worker count, last modified
- **Run** — trigger an on-demand job execution
- **Runs** — view recent execution history with status and duration
- **Info** — detailed job info: type, worker config, script location, IAM role, connections, default arguments, tags

### Athena

Full data pipeline browser and query IDE organised in three sub-tabs:

**Workgroups**
- Workgroup name, state (ENABLED / DISABLED), engine version, S3 output location, bytes scanned, queries run, description
- **Config** — full workgroup configuration (engine, encryption, output, stats, IAM role, policies)
- **Query** — jump directly to the inline query editor pre-loaded with the workgroup

**Data Sources**
- Expandable catalog → database tree with type, description, parameters and database count
- **Info** — catalog detail panel
- **Editor** — open the query editor scoped to that catalog
- **Tables** — inline table list for any database

**Query Editor**
- Split-pane layout: sidebar data tree (catalogs → databases → tables) + SQL editor
- Run queries and view results in a paginated grid
- Export results to CSV
- Query history panel with the 20 most recent executions

### Data Pipeline

Manage scheduled data pipelines:

- Pipeline name, ID, state (SCHEDULED / PAUSED / INACTIVE), last run time, next scheduled run
- **Activate** — resume a paused or inactive pipeline
- **Pause** — suspend a running scheduled pipeline

---

## Security & Identity

### Cognito

Full user pool management across four tabs:

**Users**
- Search/filter by email or username; paginated for large pools
- Username, email, status (CONFIRMED / FORCE_CHANGE_PASSWORD), MFA, enabled state, creation date
- **Detail** — view all user attributes
- **Reset pwd** — send a password reset email
- **Enable / Disable** — toggle account access
- **+ Create User** — create a new pool user

**App Clients**
- Client name, ID, explicit auth flows, OAuth flows, callback URLs, token validity, has-secret

**Identity Providers**
- Federated IdPs: name, type (SAML / OIDC / Google / Facebook), issuer/metadata URL, attribute mapping

**Groups**
- All groups in the pool: group name, description, precedence, IAM role ARN, last modified date

**Pool Config**
- Password policy (length, character requirements, temporary pwd validity)
- Auto-verified attributes, creation/modification dates
- Schema attributes grid (data type, required, mutable)
- Lambda triggers (pre-sign-up, post-confirmation, pre-token generation, etc.)

### Secrets Manager

Browse AWS Secrets Manager secrets:

- Secret name with full path hierarchy, description, rotation enabled, last changed date, ARN
- **Reveal** — fetch and display the secret value (masked by default for security)
- **Config** — view rotation schedule, resource policy and replica regions

---

## Observability

### EventBridge

Manage event-driven rules across all event buses:

- Rule name, description, bus, state (ENABLED / DISABLED), schedule expression or event pattern type
- **Details** — inspect rule targets (Lambda ARN, SQS URL, etc.) and full event pattern JSON
- **Logs** — stream logs from the rule's associated CloudWatch log group
- **Tags** — view rule tags
- **Config** — view full rule configuration

### Step Functions

Visualise and inspect state machines:

- State machine name, type (STANDARD / EXPRESS), creation date, ARN
- **Diagram** — render the ASL workflow diagram visually inline using the state machine definition
- **Tags** — view tags
- **Config** — view the full ASL definition JSON

---

## Common Features

All 19 AWS service tabs share these global features:

| Feature | Description |
|---|---|
| **Live search** | Filter rows by typing in the search bar at the top — results update instantly |
| **Sortable columns** | Click any column header to toggle ascending / descending sort |
| **Region switcher** | Change the active AWS region from the header dropdown; data reloads automatically |
| **Refresh** | Click ↺ to reload the current tab from AWS APIs |
| **Result counter** | Shows loading status and final record count in the toolbar |
| **Tag chips** | Tags are displayed as inline chips on each row for quick reference |

---
title: AWS Management Dashboard for EC2, EKS, ECS and Lambda
description: Manage AWS services including EC2, EKS, ECS, Lambda, S3, DynamoDB, CloudFront and more from the open source KUA dashboard.
---

# AWS Integration

KuaDashboard provides a comprehensive AWS management panel accessible from the sidebar under **Cloud > AWS**. It gives you a single unified view over **22 AWS services** without ever leaving the dashboard.

> **v1.7.0 highlights:** EC2 SSH/RDP sessions now stay alive as restoreable tabs; Kubernetes logs, YAML and metrics improvements are available from the unified operations surface.

![KuaDashboard — dashboard overview](/screenshots/dashboard-main.png)

## Authentication

AWS credentials can be configured in multiple ways:

| Method | Description |
|---|---|
| **Env Manager** | Store named profiles with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (optional, for temporary credentials), and `AWS_DEFAULT_REGION` |
| **AWS CLI** | Reads `~/.aws/credentials` and `~/.aws/config` automatically |
| **Local profiles** | Select any named profile from your existing `~/.aws/credentials` or `~/.aws/config`, including SSO profiles created with `aws configure sso` |
| **Environment variables** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| **IAM roles** | When running on AWS infrastructure (EC2, ECS task, Lambda, etc.) |

### Temporary credentials (STS / IAM Identity Center)

Profiles support temporary session credentials — the kind issued by AWS STS or the IAM Identity Center (SSO) access portal, where the access key starts with `ASIA`. Paste the three values (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) into the profile form or import them from a `.env` file. When the session expires, the dashboard shows a clear message asking you to refresh the credentials.

Alternatively, if you already use `aws sso login` from the terminal, your SSO profiles appear in the **local profiles** list and the SDK resolves the cached session automatically — no copy-pasting needed while the SSO session is active.

### Built-in SSO login (no copy-paste at all)

When creating an AWS profile, choose **"Iniciar sesión temporal (SSO)"**. KuaDashboard detects your SSO profiles from `~/.aws/config` (or you paste the start URL once), opens the AWS access portal in your browser, and once you approve it captures the temporary credentials and stores them in the encrypted vault automatically — the same device-authorization flow the AWS CLI uses.

The dashboard tracks the session expiration: profile cards show a live countdown badge, and when less than 15 minutes remain a persistent alert appears with a one-click **"Renovar sesión"** button that re-runs the browser login and refreshes the stored credentials.

Select your active profile and region from the dropdowns in the AWS panel header. All API calls use the selected profile credentials.

---

## Overview

**Overview** is the first item of the AWS sidebar and the view AWS opens on. It shows who the active profile is and what it can see:

- **Account** — account ID (and alias when the profile may read it), with a copy button.
- **Identity** — whether the profile is an IAM user, a role, an SSO permission set, a federated user or the root user, with its ARN. Root credentials show a warning.
- **Region** — the profile's region and the regions enabled in the account.
- **Services** — a card per service with its resource count: EC2 (running/stopped), Lambda, ECS (clusters and services), EKS, ECR, VPC, API Gateway (REST/HTTP), S3, DynamoDB, RDS, EventBridge, Step Functions, CloudFront, Route 53, Cognito and Secrets Manager. A service is **active** when it has at least one resource; active services come first. S3, CloudFront and Route 53 are account-wide (marked *Global*); the rest are counted in the profile's region. A `+` means there are more resources than the overview reads.

Every service is read on its own, in parallel and with a timeout: a missing permission marks only that card as *No permission* (with the IAM action when AWS reports it), and the rest still load. Clicking a card opens that service's tab. Only read-only List/Describe calls are made.

## Compute

### EC2 Instances

Browse all EC2 instances with full detail and lifecycle control:

- Instance ID, name tag, type, public/private IP, availability zone, launch time
- **Start** and **Stop** instances directly from the table
- **SSH** — open a browser-based interactive SSH session (available when `running`)
- **RDP** — open a browser-based Windows remote desktop canvas (available for Windows instances)
- **Persistent remote tabs** — hide SSH/RDP windows without closing the WebSocket, then restore them from the floating session dock
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

- Cluster name and API endpoint, region, Kubernetes version, status, creation date
- **Node groups** — managed node groups of each cluster
- **EC2** — number of EC2 instances running as nodes (managed node groups, Karpenter and self-managed nodes, detected from their EKS/Kubernetes tags)
- **Info** — AWS infrastructure of the cluster, in the same layout as the EC2 and Lambda Info panels:
  - **Overview** — ARN, version and platform version, IAM role, API endpoint access (public/private, allowed CIDRs), OIDC issuer, service CIDR, enabled control-plane logs and tags
  - **Network** — VPC, every subnet used by the control plane, node groups or nodes (with CIDR, AZ, free IPs and who uses it) and the cluster, additional and remote-access security groups
  - **Node groups** — status, capacity type, architecture, instance types, scaling (min/desired/max), EC2 count, AMI and release, subnets, Auto Scaling groups, launch template, node role and health issues
  - **EC2 instances** — every node instance with type, state, origin (node group, `karpenter/<pool>` or `self-managed`), private IP, AZ and spot/on-demand
  - **Add-ons** — EKS-managed add-ons with version, status, IRSA role and health issues
  - If a permission is missing (e.g. `ec2:DescribeInstances`), the other sections still load and a notice lists what could not be read
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
- **Info** — deep-dive panel (same layout as the EC2 and Lambda Info panels, with copy buttons on IDs) with 6 inner tabs:
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
- **Right panel** — click a zone to load all records (every page, including routing-policy sets with their Set ID): name, type, TTL, value or alias target
- **Search** — filter by record name, value, alias target or Set ID
- **Type filter** — show only one record type (A, TXT, MX, CNAME...)
- **Select & export** — tick records (the selection survives search/filter changes) and click **Export** to download a CSV. With nothing selected, Export downloads the records currently visible

#### DNS diagnostics

The **DNS test** column checks whether a record is actually published on the internet. Tests run from the machine running KUA against its public resolver, so they show what the internet sees, not only what is stored in Route 53. They do not use AWS credentials.

Only tests that make sense for the record type are offered:

| Record | Test | What it checks |
|---|---|---|
| A / AAAA | Resolve + TCP | The name resolves, then opens a TCP connection to the first address on port 443 and then 80 (2 s timeout each). No ping or system binaries are used |
| MX | Resolve | Mail exchangers, sorted by priority |
| CNAME | Resolve | The alias target |
| NS | Resolve | Name servers for the name |
| TXT | Resolve | All TXT strings (chunked values are joined) |
| TXT with `v=spf1` | SPF | Exactly one SPF record exists and it ends in an `all` mechanism or `redirect=` |
| TXT at `<selector>._domainkey.<domain>` | DKIM | A DKIM record with a public key (`p=`) is published for that selector |

Results use three states:

- **OK** — the record resolves and passes the check.
- **WARNING** — it resolves but something needs attention: A/AAAA not reachable on TCP 443/80, SPF with `+all` or without `all`, DKIM key revoked (empty `p=`), TXT name with no strings.
- **ERROR** — it does not resolve (the resolver code, e.g. `ENOTFOUND` or `ENODATA`, is shown), SPF is missing or duplicated, or no DKIM key is found.

Hover over a result to see the resolved values; click it to run the test again. Wildcard records (`*.example.com`) and types such as SOA, SRV or CAA show no test: test a concrete subdomain instead.

::: tip
A record that is **OK** in Route 53 but **ERROR** here usually means the domain's registrar is not delegating to the hosted zone's name servers, or the zone is private.
:::

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

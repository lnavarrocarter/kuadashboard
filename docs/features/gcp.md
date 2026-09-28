---
title: Google Cloud GCP Management Dashboard
description: Manage Google Cloud services such as Cloud Run, GKE, Cloud SQL, Storage, BigQuery, Pub/Sub and more with KUA.
---

# GCP Integration

KuaDashboard provides comprehensive Google Cloud Platform management accessed from the sidebar under **Cloud > Google Cloud**. Services are grouped by category in the left sidebar.

## Compute

### Cloud Run
- Table of services with status (including failed deploys), image, CPU/memory, min–max instances, ingress, serving revision (flags a newer revision not yet serving) and last update
- **Start / Stop / Delete** inline in each row; **＋ New service** creates one (see [safe actions](#creating-starting-and-deleting-resources-safely))
- **Start / Stop** adjusts the minimum instance count
- Direct link to Cloud Console

### Cloud Run Jobs
- List all Cloud Run Jobs with status and last execution result
- **Run** a job on demand (triggers an execution)
- **View executions** — drill-down modal showing execution history with status and timestamps

### GKE (Google Kubernetes Engine)
- List GKE clusters with version, location, node count and status
- Copy `kubectl` connection command to clipboard

### Compute Engine VMs
- Table of VMs with status, machine type (Spot/Preemptible flagged), internal and external IP, network/subnet, disk count and size, deletion protection and creation date
- **Start / Stop / Delete** inline; **＋ New VM** creates one (see [safe actions](#creating-starting-and-deleting-resources-safely))

## Database

### Cloud SQL
- Table of instances with a clear status — **RUNNING**, **STOPPED** (Cloud SQL reports RUNNABLE while stopped, so KUA derives it from the activation policy), PENDING_CREATE, MAINTENANCE… — plus engine, tier/edition, zonal or HA, storage, backups, public/private IP and deletion protection
- **Start / Stop / Delete** inline, enabled according to the status; **＋ New instance** creates one (see [safe actions](#creating-starting-and-deleting-resources-safely))

### Cloud Spanner
- List Spanner instances with node count and processing units
- Drill-down into **databases** per instance
- **SQL query editor** — run read-only queries against any Spanner database

### Firestore
- List Firestore databases (including the default `(default)` database)
- Drill-down into **collections** per database
- Browse **documents** within each collection

### Memorystore (Redis)
- List Memorystore Redis instances with version, tier, capacity and status

## Storage

### Cloud Storage
- Browse all GCS buckets
- Drill-down file browser inside each bucket (prefix navigation)
- **Preview** text/JSON/YAML objects inline
- **Download** objects directly to your machine

### Artifact Registry
- List all Artifact Registry repositories with format and location
- Drill-down into **packages** (Docker images, Maven artifacts, npm packages, etc.)

## Serverless

### Cloud Functions
- List all Cloud Functions (1st and 2nd gen) with runtime, trigger and status
- **Invoke** a function with a custom JSON body
- **View logs** — last 50 log entries streamed in real time

## Messaging

### Pub/Sub Topics
- List all Pub/Sub topics

### Pub/Sub Subscriptions
- List all Pub/Sub subscriptions with type (push/pull), topic, filter, ACK deadline and retention period

## Security

### Secret Manager
- List all secrets with creation date and last access
- **Preview** the latest version value (first 500 chars)
- **Import to Env Manager** — save the secret value as an environment variable

### Cloud KMS
- List key rings across all available locations
- Drill-down into **crypto keys** per key ring with purpose, algorithm and rotation schedule

## Analytics

### BigQuery
- List all BigQuery datasets
- Drill-down into **tables** per dataset (schema, row count, size)
- **SQL query editor** — run queries with job polling and paginated results

## Workflows

### Cloud Workflows
- List all Cloud Workflows with status and last updated time
- View **executions** (last 20) with state and duration
- **View source** — see the workflow YAML/JSON definition

## Networking

### Cloud DNS
- List all DNS managed zones with DNS name and visibility
- Drill-down into **DNS records** per zone (type, TTL, values)

### VPC Networks
- List all VPC networks with auto-subnet mode and routing mode
- Drill-down into **subnets** per network with CIDR, gateway, region, Private Google Access and Flow Logs status

## Async / Scheduling

### Cloud Tasks
- List all Cloud Tasks queues with state and rate limits
- View **tasks** in a queue (paginated)

### Cloud Scheduler
- List all Cloud Scheduler jobs with schedule, target type and status
- **Run** a job immediately
- **Pause / Resume** a job

## DevOps

### Cloud Build
- List recent Cloud Build builds with trigger, branch, status and duration (paginated)
- **View logs** — full build log streamed inline

## Observability

### Cloud Monitoring
- **Alert policies** — list all alert policies with enabled/disabled status and condition count
- **Uptime checks** — list all uptime check configurations with type, resource and period

### Cloud Logging
- Interactive **log query panel** — enter an advanced filter, choose a time range (1–72 hours) and execute
- Results show timestamp, severity (color-coded), resource type, log name and text payload

## Creating, starting and deleting resources safely

Cloud Run, Compute Engine VMs and Cloud SQL list their resources in a table with the actions inline (**Start**, **Stop**, **🗑 Delete**), and a **＋ New** button creates new ones. Clicking a row opens its detail below the table. Every action that costs money or cannot be undone asks for confirmation first:

| Action | What you must confirm |
|---|---|
| **Start** | Shows the estimated monthly cost of keeping it running and requires *"I understand this generates costs"*. On Cloud Run, Start sets min instances to 1, which bills 24/7. |
| **Stop** | Lists what keeps billing while stopped (disks, static IPs, SQL storage) and side effects (ephemeral IP changes, cold starts). |
| **Delete** | Irreversible: you must type the resource name. The dialog lists what is lost (Cloud Run revisions and URL; VM auto-delete disks — disks without auto-delete are kept and keep billing; all Cloud SQL databases, users and automated backups). Resources with **deletion protection** cannot be deleted from KUA: disable it in the Google Cloud console first. |
| **Create** | Pick the region and zone from lists (only zones that exist in that region) and the machine type or SQL tier from preset cards showing vCPU, memory, typical use and monthly price — or choose **Other…** to type any type. The form shows a live cost estimate. Before creating, a review screen summarizes the configuration, calls out risky choices (public Cloud Run service, VM with a public IP, SQL without backups or without deletion protection) and requires the typed name plus the cost acknowledgement. Estimates of **$100/month or more** need a second, explicit high-cost confirmation. |

Safe defaults when creating: Cloud Run services are **private** unless you explicitly allow unauthenticated access; Cloud SQL instances get **automated backups** and **deletion protection** on; resources are labelled `created-by=kua`.

The backend enforces the same rules: create and delete requests without the typed name or the required acknowledgements are rejected, so they cannot be skipped by calling the API directly. Every create and delete is recorded in the audit log with its estimated monthly cost.

::: warning Cost estimates are approximate
Estimates use on-demand list prices for us-central1 and exclude sustained/committed-use discounts, free tier, network egress, licences and taxes. Use them as a warning, not a quote — check the [Google Cloud pricing calculator](https://cloud.google.com/products/calculator) for exact figures.
:::

## IAM

### IAM Service Accounts
- List all service accounts with display name, email and status (paginated)
- Drill-down into **keys** per service account with key ID, type and creation/expiry dates


## Authentication

GCP credentials can be configured in several ways:

### Stored Profiles (Env Manager)
Create a GCP profile in the Env Manager with a service account key JSON. The profile is stored securely and can be selected from the GCP panel dropdown.

### gcloud CLI Configs
If `gcloud` is installed, KuaDashboard automatically detects all `gcloud` configurations and lists them in the profile dropdown. This uses Application Default Credentials.

### Profile Selection
The GCP panel dropdown shows two groups:
- **Stored profiles** — Created in the Env Manager
- **gcloud configs** — Auto-detected from the local `gcloud` CLI

## Tab-Based Layout

The GCP panel uses a tabbed interface:

| Tab | Content |
|-----|---------|
| Cloud Run | Cloud Run services table |
| GKE | Kubernetes Engine clusters |
| Compute VMs | Compute Engine instances |

Each tab loads data independently and shows a count badge. Errors (like disabled APIs) display an inline banner with a direct link to enable the API in Cloud Console.

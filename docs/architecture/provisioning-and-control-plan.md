# KUA Provisioning and Control Plan

## Goal

KUA should evolve from observing and documenting an application to planning, costing, provisioning and operating it from the same KUA Application workspace.

The target experience is not a generic cloud-account console. The user starts from a KUA Application, adds the resources needed for that application, sees estimated cost and dependencies while designing, chooses whether to create manually or through IaC, and then operates the live resources with audited controls.

```text
KUA Application
├── Architecture view: desired and observed topology
├── Resources registry: canonical live resource identities
├── Provisioning workspace: planned resources, cost, dependencies and IaC
├── Control center: start, stop, scale, disable, update and guarded delete
└── Evidence: discovery, IaC state, manual decisions, metrics and audit history
```

## Product Principles

- **Application first**: provisioning is scoped to a KUA Application, environment and provider scope, not to a whole cloud account by default.
- **Preview before mutation**: every create, update or delete action has a preview, dependency summary and explicit confirmation.
- **Cost is visible while designing**: estimates update as the user adds resources or selects required supporting resources.
- **IaC is the preferred durable path**: manual creation remains available, but KUA should generate Terraform/OpenTofu, CloudFormation or provider-native manifests when a stable repeatable plan matters.
- **Live state and desired state are separate**: Architecture can show both what exists and what is planned before apply.
- **Destructive actions are controlled**: delete is dependency-aware, typed-confirmed, audit-logged and, when possible, staged through stale/disable states before removal.
- **Provider adapters declare capabilities**: AWS, GCP, Azure, Kubernetes, Vercel and future providers expose the same high-level contract while degrading gracefully when a resource type lacks cost, IaC or control support.

## Core Concepts

### Resource blueprint

A provider-neutral description of something the user wants to create. It is not yet live.

- provider: `aws`, `gcp`, `azure`, `kubernetes`, `vercel`, `cloudflare`, etc.
- resource type: `ec2`, `ecr`, `ecs-service`, `s3`, `cloud-run`, `aks`, `deployment`, `vercel-project`, etc.
- inputs: typed fields, defaults, validation and secrets policy.
- dependencies: required VPC, subnet, IAM role, security group, registry, cluster, namespace, DNS zone, bucket, log group.
- cost dimensions: instance size, storage, requests, bandwidth, retention, replicas, region.
- supported engines: manual API, Terraform/OpenTofu, CloudFormation, Kubernetes manifest, provider CLI.
- supported controls: start, stop, restart, scale, disable, update, rotate, invalidate, delete.

### Provisioning plan

A versioned set of blueprints attached to a KUA Application.

- desired resources and relationships;
- selected provider scopes;
- dependency graph;
- cost estimate by provider, resource and environment;
- generated IaC artifacts;
- validation findings;
- apply history and resulting live registry links.

### Control operation

A typed action against a live resource or planned resource.

Examples: `start`, `stop`, `restart`, `scale`, `edit-tags`, `update-config`, `disable`, `delete`, `restore`, `rotate-secret`, `invalidate-cache`, `apply-iac`, `destroy-iac`.

Each operation declares:

- risk level: low, medium, high, destructive;
- required permission/capability;
- preview availability;
- dependency impact;
- rollback path, if any;
- audit category and required confirmation.

## Target UX

### KUApps / Application Workspace

Add a new application-level view: **Plan and Deploy**.

Initial sections:

1. **Canvas planner**: add resources from a provider-neutral catalog onto the Architecture graph as planned nodes.
2. **Cost estimate**: live monthly estimate, one-time costs and unknown-cost warnings.
3. **Dependencies**: missing required resources and suggested supporting resources.
4. **IaC output**: generated Terraform/OpenTofu modules or provider-native manifests.
5. **Apply review**: diff between desired state and live state before mutation.
6. **Control center**: live resources with allowed operations and guarded destructive actions.

### Resource Catalog

The catalog should be grouped by capability instead of provider-only navigation:

- Compute: EC2, Lambda, ECS/Fargate, EKS/AKS/GKE nodes, Cloud Run, Azure Container Apps, Kubernetes Deployment.
- Containers: ECR, Artifact Registry, ACR, ECS service, Kubernetes workload, Vercel functions.
- Storage: S3, GCS, Azure Blob, EBS/PersistentVolume, DynamoDB, RDS, Cloud SQL, Cosmos DB.
- Network: VPC/VNet, subnet, security group, load balancer, API Gateway, CloudFront/CDN, DNS.
- Security: IAM role/policy, service account, secrets, KMS.
- Observability: log group, metric alarms, dashboards, tracing.

Each card shows what KUA can do today:

- `discover`: can read existing resources;
- `plan`: can model desired resources;
- `estimate`: can estimate cost;
- `generate`: can generate IaC;
- `apply`: can create/update;
- `control`: can operate live state;
- `delete`: supports guarded removal.

## Cost Calculator

### Inputs

- Provider, account/project/subscription, region/location.
- Resource type and size settings.
- Usage assumptions: hours/month, requests/month, GB stored, GB transferred, replicas, retention days.
- Supporting resources that are required to make the resource usable.
- Discounts or pricing modes: on-demand, reserved, savings plans, free tier, spot/preemptible.

### Provider adapters

- **AWS**: AWS Pricing API for list prices, Cost Explorer for historical actuals, CloudWatch/request budget for billable metric reads.
- **GCP**: Cloud Billing Catalog API plus Billing export to BigQuery for actuals.
- **Azure**: Azure Retail Prices API plus Cost Management for actuals.
- **Kubernetes**: OpenCost/Kubecost when available; fallback estimate from node instance type and requested CPU/memory.
- **Vercel**: usage and project limits where API access allows; otherwise manual assumption profiles.

### Estimate states

- `estimated`: calculated from pricing catalog and user assumptions.
- `historical`: based on actual spend for an existing matched resource.
- `partial`: missing one or more price dimensions.
- `unknown`: provider does not expose enough pricing data or the resource is custom.

KUA should never present an estimate as exact. The UI should show confidence and the assumptions that drive the number.

## IaC Strategy

### Engines

1. **Terraform/OpenTofu**: primary multi-cloud durable output.
2. **CloudFormation**: AWS-native compatibility for existing stacks.
3. **Kubernetes manifests/Kustomize/Helm values**: Kubernetes-native resources.
4. **Provider API manual apply**: fast path for single low-risk resources.

### Workflow

1. User adds or edits planned resources.
2. KUA validates required fields and dependencies.
3. KUA estimates cost and flags unknowns.
4. KUA generates IaC in an application-scoped local workspace.
5. User runs `plan` from KUA and sees the diff.
6. User applies after confirmation.
7. KUA imports resulting live resources into the shared registry and Architecture graph.
8. Future discovery compares live state, IaC state and planned state for drift.

### State policy

- Local-only state for early MVP.
- Optional remote state later: S3+DynamoDB, GCS, Azure Storage or Terraform Cloud.
- KUA must mark whether it owns the resource through IaC, created it manually, or only discovered it.
- KUA must not destroy resources it does not own without a special manual override flow.

## Controlled Delete Policy

Delete is a separate workflow, never a simple row button.

Required checks:

- show downstream dependencies and relationships;
- show whether resource is referenced by IaC state;
- show expected cost reduction separately from operational impact;
- require typed confirmation for destructive resources;
- require a second confirmation for data-bearing resources such as S3, RDS, DynamoDB, disks, snapshots and secrets;
- offer disable/stop/scale-to-zero first when supported;
- require explicit `destroy` plan when IaC owns the resource;
- always write audit log with provider, identity, user/profile, reason and preview summary.

Suggested lifecycle:

```text
active -> disabled/stopped -> stale/pending-removal -> deleted
```

For data-bearing resources, `deleted` should usually mean KUA has requested provider deletion, not that data is immediately gone.

## Multi-Cloud Capability Contract

Every provider adapter should implement the same shape:

- `discover(scope)` returns live resources and relationships.
- `blueprintCatalog(scope)` returns resource blueprints and constraints.
- `estimate(plan)` returns cost estimates and unknowns.
- `generate(plan, engine)` returns IaC artifacts.
- `previewApply(plan)` returns create/update/delete diff.
- `apply(plan)` performs mutation only after confirmation.
- `controls(resource)` lists allowed live operations.
- `runControl(resource, operation)` executes a typed operation.

Missing methods are capabilities, not failures. A provider can support discovery and controls before it supports IaC generation.

## Delivery Roadmap

### Phase 18: Provisioning foundation

- Add provisioning plan tables/storage linked to KUA Application.
- Add resource blueprint schema and provider capability registry.
- Show a read-only **Plan and Deploy** tab with planned resources, dependencies and estimate placeholders.
- Allow planned manual nodes to appear on the Architecture canvas without creating cloud resources.
- Add audit events for plan creation, edit and discard.

Exit criteria: a user can model an EC2 + ECR + ECS/Fargate application as planned resources, see missing dependencies and save the plan without mutating cloud state.

### Phase 19: AWS MVP create flow

- ECR repository creation from blueprint and manual API path.
- EC2 launch plan with AMI, instance type, subnet, security group, key pair and tags.
- ECS/Fargate service blueprint with cluster, task definition, image, environment, logs and networking.
- Required dependency suggestions: VPC/subnet/security group/IAM/log group/ECR repository.
- Live cost estimate for EC2 hours, EBS storage, Fargate vCPU/memory and ECR storage.
- Import created resources into registry and Architecture immediately after successful apply.

Exit criteria: KUA can create a small AWS app stack through reviewed steps, then show the resulting resources in Architecture, Resources and Observability where supported.

### Phase 20: Terraform/OpenTofu generation

- Generate application-scoped Terraform/OpenTofu files for the AWS MVP resources.
- Run `fmt`, `validate` and `plan` from KUA.
- Show plan diff and estimated mutations.
- Keep local state metadata and generated artifact history.
- Support import of existing resources into generated state only through explicit user action.

Exit criteria: the same AWS MVP stack can be created through generated IaC rather than direct API calls.

### Phase 21: Control center and guarded delete

- Normalize live controls across AWS and Kubernetes first.
- Add operation preview and confirmation policies per operation.
- Start/stop/restart/scale/disable/update controls where provider APIs already exist.
- Add delete workflows for low-risk resources first, then data-bearing resources with stronger confirmation.
- Add operation history per resource in the KUA Application.

Exit criteria: users can operate resources from the KUA Application without hunting provider-specific tabs, and destructive actions are reviewable and auditable.

### Phase 22: GCP and Vercel provisioning adapters

- GCP blueprints: Cloud Run, Cloud Functions, GKE workload target, Cloud SQL, GCS, IAM service account.
- Vercel blueprints: project, env vars, domain, deployment link, functions where API allows.
- Cost adapters: GCP Billing Catalog, Vercel plan/usage assumptions.
- IaC generation: Terraform/OpenTofu provider blocks and resources.

Exit criteria: KUA can plan and estimate mixed AWS/GCP/Vercel applications with consistent UX, even if apply support is staged per provider.

### Phase 23: Azure and broader provider coverage

- Azure blueprints: VM, AKS, Container Apps, Blob Storage, SQL, VNet, Key Vault.
- Azure Retail Prices and Cost Management integration.
- Terraform/OpenTofu generation for Azure resources.
- Provider capability registry becomes plugin-ready.

Exit criteria: Azure participates in the same plan, cost, IaC and control contract as AWS/GCP/Kubernetes/Vercel.

### Phase 24: Drift, recommendations and automation

- Compare desired plan, IaC state, live discovery and registry membership.
- Surface drift as reviewable Architecture changes.
- Recommend cost optimizations and missing controls.
- Add runbooks and scheduled actions once operation policies are stable.

Exit criteria: KUA can explain what changed, what it costs, what owns it and what action is safe next.

## First MVP Recommendation

Start with **AWS ECR + ECS/Fargate + EC2 optional** inside KUApps/Architecture, not as isolated AWS-tab buttons.

Reasoning:

- ECR is low-risk and validates create/import/audit.
- ECS/Fargate exercises real dependency planning and cost calculation without requiring users to manage servers.
- EC2 should be supported, but with stronger cost and network/security guardrails.
- The same design maps naturally to Kubernetes Deployment, GCP Cloud Run, Azure Container Apps and Vercel deployments later.

Suggested first slice:

1. Add plan storage and blueprint registry.
2. Add ECR repository blueprint, estimate and create action.
3. Add ECS/Fargate service blueprint with dependency suggestions.
4. Generate Terraform/OpenTofu for those two resources.
5. Import created resources back into the shared registry.
6. Add guarded delete policy for ECR only after create/update is reliable.

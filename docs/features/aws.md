# AWS Integration

KuaDashboard provides a comprehensive AWS management panel accessed from the sidebar under **Cloud > AWS**.

## Supported Services

### Lambda Functions
- List all Lambda functions with runtime, memory, and timeout info
- View function configuration
- Invoke functions with custom payloads

### ECS (Elastic Container Service)
- Browse ECS clusters
- List services and tasks per cluster
- View task definitions and status

### EKS (Elastic Kubernetes Service)
- List EKS clusters
- View cluster details (version, status, endpoint)

### EC2 Instances
- List all instances across regions
- Start and stop instances
- View instance details (type, IP, status)

### S3 Browser
- List and browse S3 buckets
- Navigate bucket contents (folders and files)
- Download objects
- View file contents for text files

### API Gateway
- List REST APIs and HTTP APIs
- View routes and integrations
- Inspect stage configurations

### EventBridge
- List event buses and rules
- View rule targets
- Browse event patterns

### Step Functions
- List state machines
- Visual diagram rendering of workflows
- View execution history

## Authentication

AWS credentials can be configured in multiple ways:

1. **Env Manager** — Store profiles with access keys
2. **AWS CLI** — Uses `~/.aws/credentials` and `~/.aws/config`
3. **Environment variables** — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
4. **IAM roles** — When running on AWS infrastructure

Select your active profile from the dropdown in the AWS panel header.

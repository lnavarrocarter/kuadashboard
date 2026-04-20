# GCP Integration

KuaDashboard provides Google Cloud Platform management accessed from the sidebar under **Cloud > Google Cloud**.

## Supported Services

### Cloud Run
- List all Cloud Run services
- View service status, region, and scaling config
- **Start** / **Stop** services (adjust min instances)
- Direct link to Cloud Console

### GKE (Google Kubernetes Engine)
- List GKE clusters
- View cluster version, location, node count, and status

### Compute Engine VMs
- List all VM instances
- View zone, machine type, external IP, and status
- **Start** / **Stop** VM instances

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

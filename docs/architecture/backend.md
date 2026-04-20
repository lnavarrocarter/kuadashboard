# Backend API

The backend is a single Express server (`server.js`) that provides both REST API endpoints and WebSocket connections.

## Server Structure

```js
server.js          // Main entry — Express app, K8s routes, WebSocket setup
routes/
├── aws.js         // AWS service endpoints
├── gcp.js         // GCP service endpoints
├── envManager.js  // Profile/credential management
├── localShell.js  // Local terminal WebSocket
└── systemTools.js // CLI tool detection
```

## REST API Endpoints

### Kubernetes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contexts` | List all kubeconfig contexts |
| POST | `/api/context` | Switch active context |
| DELETE | `/api/context/:name` | Delete a context |
| GET | `/api/namespaces` | List namespaces |
| GET | `/api/:ns/pods` | List pods |
| GET | `/api/:ns/pods/:name/yaml` | Get pod YAML |
| DELETE | `/api/:ns/pods/:name` | Delete pod |
| POST | `/api/:ns/deployments/:name/restart` | Restart deployment |
| POST | `/api/:ns/deployments/:name/scale` | Scale deployment |
| POST | `/api/kubeconfig/import` | Import kubeconfig YAML |
| POST | `/api/nodes/:name/cordon` | Cordon node |
| POST | `/api/nodes/:name/uncordon` | Uncordon node |
| POST | `/api/nodes/:name/drain` | Drain node |

### Cloud Routes
| Prefix | Module | Description |
|--------|--------|-------------|
| `/api/cloud/aws` | `routes/aws.js` | AWS services |
| `/api/cloud/gcp` | `routes/gcp.js` | GCP services |
| `/api/cloud/envs` | `routes/envManager.js` | Profile management |
| `/api/system` | `routes/systemTools.js` | CLI tool detection |

## WebSocket Endpoints

| Path | Purpose |
|------|---------|
| `/ws/logs` | Pod log streaming |
| `/ws/exec` | Pod exec (interactive shell) |
| `/ws/shell` | Local system shell |
| `/ws/ec2-shell` | EC2 instance shell (via SSH) |

All WebSocket connections use `noServer` mode with manual upgrade routing to avoid conflicts between multiple WebSocket.Server instances.

## Kubeconfig Management

The server merges kubeconfig files from multiple sources:
1. `KUBECONFIG` env var paths
2. Default `~/.kube/config`
3. UI-imported configs (`~/.kube/kuadashboard_merged.yaml`)

Merging is non-destructive — existing entries are never overwritten.

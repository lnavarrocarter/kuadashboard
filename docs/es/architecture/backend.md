# Backend API

El backend es un único servidor Express (`server.js`) que proporciona tanto endpoints REST API como conexiones WebSocket.

## Estructura del Servidor

```js
server.js          // Entrada principal — app Express, rutas K8s, setup WebSocket
routes/
├── aws.js         // Endpoints de servicios AWS
├── gcp.js         // Endpoints de servicios GCP
├── envManager.js  // Gestión de perfiles/credenciales
├── localShell.js  // WebSocket de terminal local
└── systemTools.js // Detección de herramientas CLI
```

## Endpoints REST API

### Kubernetes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/contexts` | Listar todos los contextos kubeconfig |
| POST | `/api/context` | Cambiar contexto activo |
| DELETE | `/api/context/:name` | Eliminar un contexto |
| GET | `/api/namespaces` | Listar namespaces |
| GET | `/api/:ns/pods` | Listar pods |
| GET | `/api/:ns/pods/:name/yaml` | Obtener YAML del pod |
| DELETE | `/api/:ns/pods/:name` | Eliminar pod |
| POST | `/api/:ns/deployments/:name/restart` | Reiniciar deployment |
| POST | `/api/:ns/deployments/:name/scale` | Escalar deployment |
| POST | `/api/kubeconfig/import` | Importar YAML kubeconfig |
| POST | `/api/nodes/:name/cordon` | Cordon de nodo |
| POST | `/api/nodes/:name/uncordon` | Uncordon de nodo |
| POST | `/api/nodes/:name/drain` | Drain de nodo |

### Rutas Cloud
| Prefijo | Módulo | Descripción |
|---------|--------|-------------|
| `/api/cloud/aws` | `routes/aws.js` | Servicios AWS |
| `/api/cloud/gcp` | `routes/gcp.js` | Servicios GCP |
| `/api/cloud/envs` | `routes/envManager.js` | Gestión de perfiles |
| `/api/system` | `routes/systemTools.js` | Detección de herramientas CLI |

## Endpoints WebSocket

| Ruta | Propósito |
|------|-----------|
| `/ws/logs` | Streaming de logs de pods |
| `/ws/exec` | Pod exec (shell interactiva) |
| `/ws/shell` | Shell del sistema local |
| `/ws/ec2-shell` | Shell de instancia EC2 (vía SSH) |

Todas las conexiones WebSocket usan modo `noServer` con enrutamiento de upgrade manual para evitar conflictos entre múltiples instancias WebSocket.Server.

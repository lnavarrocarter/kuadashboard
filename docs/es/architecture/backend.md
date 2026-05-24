# Backend API

El backend es un único servidor Express (`server.js`) que proporciona tanto endpoints REST API como conexiones WebSocket.

## Estructura del Servidor

```js
server.js          // Entrada principal — app Express, rutas K8s, setup WebSocket
routes/
├── aws.js         // Endpoints de servicios AWS
├── gcp.js         // Endpoints de servicios GCP
├── helm.js        // Repositorios Helm, busqueda de charts, instalacion y releases
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
| POST | `/api/kubeconfig/path` | Registrar una ruta kubeconfig existente |
| GET | `/api/:ns/:resource/:name/metrics` | Metricas para Pods y workloads con fallback Prometheus |
| GET | `/api/nodes/:name/metrics` | Metricas CPU/memoria de Node |
| GET | `/api/events/related` | Eventos relacionados a un recurso o Node |
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
| `/api/helm` | `routes/helm.js` | Repositorios Helm, busqueda de charts, instalacion, inventario de releases y desinstalacion |

## Endpoints WebSocket

| Ruta | Propósito |
|------|-----------|
| `/ws/logs` | Streaming de logs de pods |
| `/ws/exec` | Pod exec (shell interactiva) |
| `/ws/shell` | Shell del sistema local |
| `/ws/ec2-shell` | Shell de instancia EC2 (vía SSH) |

Todas las conexiones WebSocket usan modo `noServer` con enrutamiento de upgrade manual para evitar conflictos entre múltiples instancias WebSocket.Server.

## Gestion de Kubeconfig

El servidor fusiona kubeconfigs desde multiples fuentes:

1. Rutas de la variable `KUBECONFIG`
2. Config por defecto `~/.kube/config`
3. Configs importados por UI (`~/.kube/kuadashboard_merged.yaml`)
4. Rutas registradas (`~/.kube/kuadashboard_paths.json`)

La fusion es no destructiva: las entradas existentes no se sobreescriben.

## Fallback de Metricas

Las metricas Kubernetes usan primero la API `metrics.k8s.io/v1beta1`. Si Metrics Server no esta disponible, KuaDashboard detecta Services Prometheus y consulta metricas mediante el Service proxy del API server de Kubernetes, preservando kubeconfig y contexto activos.

# KuaDashboard

A Lens-like Kubernetes web dashboard built with **Node.js + Express** (backend) and **Vue 3 + Vite + Pinia** (frontend). Available as a web app or native desktop app (Electron) for **Windows**, **macOS**, and **Linux**.

![KuaDashboard — Kubernetes Nodes](screenshots/dashboard-nodes.png)

## Features

- Browse all K8s resources: Pods, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, PVCs, Nodes, Events
- **Live log streaming** with multi-tab terminal panel
- **Interactive shell** (exec) into pods
- **Port-forward** management with persistence (localStorage)
- YAML viewer/editor with apply
- Scale, restart, cordon/uncordon, drain nodes
- Delete resources and contexts
- Import kubeconfigs
- Multiple cluster context support

## Architecture

```
kuadashboard/
├── server.js          # Express + WebSocket API server
├── public/            # Legacy vanilla JS frontend (preserved)
└── frontend/          # Vue 3 + Vite + Pinia frontend (new)
    ├── src/
    │   ├── App.vue
    │   ├── components/
    │   │   ├── ResourceTable.vue
    │   │   ├── TerminalPanel.vue
    │   │   ├── PortForwardPanel.vue
    │   │   ├── ToastContainer.vue
    │   │   └── modals/
    │   ├── stores/        # Pinia stores
    │   ├── composables/   # useApi, useToast, useTerminalStreams
    │   └── config/        # Resource definitions
    └── vite.config.js     # Proxy → localhost:3000
```

## Getting Started

### Backend
```bash
npm install
node server.js        # → http://localhost:3000
```

### Frontend (Vue dev server)
```bash
cd frontend
npm install
npm run dev           # → http://localhost:5173
```

### Production build
```bash
cd frontend
npm run build         # outputs to frontend/dist/
```

## Requirements

- Node.js >= 16
- kubectl / kubeconfig configured


Admin web de Kubernetes estilo Lens – ligero, dark-mode, sin dependencias de frontend.

## Características

| Función | Recursos |
|---|---|
| **Ver / filtrar** | Pods, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, PVCs, Nodes, Events |
| **Reiniciar** | Deployments, StatefulSets |
| **Escalar** | Deployments, StatefulSets |
| **Ver / editar YAML y Apply** | Todos los recursos |
| **Ver logs en tiempo real** | Pods (streaming WebSocket, múltiples containers) |
| **Eliminar** | Todos los recursos |
| **Cordon / Uncordon** | Nodes |
| **Drain** | Nodes (cordon + evict pods) |
| **Múltiples contexts** | Switch de contexto desde la cabecera |
| **Múltiples namespaces** | Selector global (incluye "All namespaces") |

## Requisitos

- Node.js ≥ 16
- `kubectl` configurado con kubeconfig válido (`~/.kube/config`)

## Instalación

```bash
cd kuadashboard
npm install
```

## Uso

```bash
npm start
# Dev (hot-reload):
npm run dev
```

Abre http://localhost:3000

Cambia el puerto con la variable de entorno `PORT`:
```bash
PORT=8080 npm start
```

## Estructura

```
kuadashboard/
├── server.js          # API Express + WebSocket
├── package.json
└── public/
    ├── index.html     # Layout HTML
    ├── styles.css     # Dark theme
    └── app.js         # Lógica de UI (vanilla JS)
```

## Nota de seguridad

- Los valores de Secrets se muestran como `[REDACTED]` en el YAML viewer.
- El servidor expone tu kubeconfig al navegador; úsalo en red local o detrás de autenticación.

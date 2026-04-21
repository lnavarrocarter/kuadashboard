# KUA — Know Unified Administration

> **K**now · **U**nified · **A**dministration

KUA es una plataforma open source para centralizar el conocimiento y la administración de infraestructura distribuida en múltiples entornos cloud y clusters Kubernetes. No es solo un dashboard: **entiende, organiza y permite operar** toda tu infraestructura desde un único punto.

Construido con **Node.js + Express** (backend) y **Vue 3 + Vite + Pinia** (frontend). Disponible como aplicación web o app nativa de escritorio (Electron) para **Windows**, **macOS** y **Linux**.

![KUA Dashboard](screenshots/dashboard-nodes.png)

---

## ¿Por qué KUA?

| Problema | Solución KUA |
|---|---|
| Consolas separadas para AWS, GCP y Kubernetes | **Unificación** — un solo lugar |
| Falta de contexto global entre servicios | **Know** — entiende el estado real |
| Operación manual repetitiva | **Administration** — actúas, no solo observas |
| Difícil trazabilidad entre entornos | Vista cross-cloud con credentials persisted |

---

## Funcionalidades

### ☸️ Kubernetes
- Gestión completa: Pods, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, PVCs, Nodes, Events
- Live log streaming (WebSocket, multi-container)
- Interactive shell (exec) en pods
- Scale, restart, cordon/uncordon, drain con un clic
- YAML viewer/editor con apply
- Port-forward visual con auto-reconexión persistente
- Soporte multi-contexto y multi-namespace
- Import kubeconfigs

### ☁️ AWS
- EC2, ECS, EKS, Lambda, S3, ECR, VPC
- API Gateway, EventBridge, Step Functions
- CloudFront, Route 53, Cognito
- DynamoDB, DocumentDB, Glue, Athena, Data Pipeline
- Secrets Manager (import individual de variables al Env Manager)
- SSH directo a instancias EC2

### 🌐 GCP
- Cloud Run, GKE, Compute VMs
- Cloud SQL, Cloud Storage
- Cloud Functions, Pub/Sub

### 🔐 Env Manager
- Perfiles de credenciales cifradas (AES-256) para AWS, GCP y genéricos
- Import/Export de archivos `.env`
- Credenciales seleccionadas persisten entre sesiones (localStorage)

### 🖥️ Desktop App (Electron)
- Aplicación nativa para Windows, macOS y Linux
- Auto-inicia el servidor backend
- Auto-update integrado

---

## Arquitectura

```
kuadashboard/
├── server.js            # Express + WebSocket API server
├── electron/            # Electron main + preload
├── routes/
│   ├── aws.js           # AWS SDK v3 endpoints
│   ├── gcp.js           # GCP endpoints
│   ├── helm.js          # Helm endpoints
│   ├── envManager.js    # Credential profiles CRUD
│   └── localShell.js    # Local terminal WebSocket
├── lib/
│   ├── credentialStore.js  # Encrypted credential vault
│   └── crypto.js           # AES-256-GCM helpers
└── frontend/            # Vue 3 + Vite + Pinia
    └── src/
        ├── App.vue
        ├── components/  # ResourceTable, TerminalPanel, PortForwardPanel, modals…
        ├── stores/      # useKubeStore, useAwsStore, useGcpStore, useEnvStore…
        └── composables/ # useApi, useToast, useTerminalStreams
```

---

## Instalación

### Prerrequisitos

- Node.js ≥ 16 (recomendado: 20+)
- `kubectl` configurado con kubeconfig válido (`~/.kube/config`)
- Para cloud: AWS CLI o `gcloud` CLI configurados (opcional)

### Modo web

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
npm install
cd frontend && npm install && cd ..
npm start
# → http://localhost:7190
```

### Dev (hot-reload)

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — frontend
cd frontend && npm run dev
# → http://localhost:7191 (proxy → :7190)
```

### Build de producción

```bash
cd frontend && npm run build
```

---

## Nota de seguridad

- Las credenciales se almacenan cifradas con AES-256-GCM; la clave se deriva de la máquina.
- Los valores de Secrets K8s se muestran como `[REDACTED]` en el YAML viewer.
- Usar en red local o detrás de autenticación — el servidor expone acceso total al kubeconfig.

---

## Visión

KUA evoluciona hacia una plataforma de **AI-driven Unified Cloud Operations**:

1. Dashboard → 2. Control Platform → 3. Intelligent System → 4. AI Ops

---

## Licencia

MIT — Construido con ❤️ y mantenido en tiempo libre.
[¿Te resulta útil? Considera apoyar el proyecto →](https://github.com/sponsors/lnavarrocarter/)


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
    └── vite.config.js     # Proxy → localhost:7190
```

## Getting Started

### Backend
```bash
npm install
node server.js        # → http://localhost:7190
```

### Frontend (Vue dev server)
```bash
cd frontend
npm install
npm run dev           # → http://localhost:7191
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

Abre http://localhost:7190

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

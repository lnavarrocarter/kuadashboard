# Architecture Overview

KuaDashboard uses a three-layer architecture: **Backend API** → **Frontend SPA** → **Electron Shell** (optional).

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Electron (optional)                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Express + WebSocket Server            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │   │
│  │  │ K8s API  │  │ AWS SDK  │  │  GCP SDK      │   │   │
│  │  └──────────┘  └──────────┘  └───────────────┘   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │   │
│  │  │ REST API │  │ WS Logs  │  │  WS Exec/Shell│   │   │
│  │  └──────────┘  └──────────┘  └───────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Vue 3 + Pinia + Vite (SPA)              │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │   │
│  │  │  Stores  │  │Components│  │  Composables  │   │   │
│  │  └──────────┘  └──────────┘  └───────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
kuadashboard/
├── server.js              # Express + WebSocket server
├── package.json           # Root package (backend + Electron)
├── electron/
│   ├── main.js            # Electron main process
│   └── preload.js         # Secure IPC bridge
├── routes/
│   ├── aws.js             # AWS service routes
│   ├── gcp.js             # GCP service routes
│   ├── envManager.js      # Credential/profile management
│   ├── localShell.js      # Local terminal WebSocket
│   └── systemTools.js     # CLI tool detection
├── lib/
│   ├── credentialStore.js  # Pluggable credential storage
│   └── crypto.js          # Encryption utilities
├── frontend/
│   ├── src/
│   │   ├── App.vue         # Root component
│   │   ├── components/     # UI components
│   │   ├── stores/         # Pinia state management
│   │   ├── composables/    # Vue composables (hooks)
│   │   └── config/         # Resource definitions
│   ├── vite.config.js
│   └── package.json
├── public/                 # Built frontend output (served by Express)
├── assets/                 # Electron builder resources (icons)
├── docs/                   # VitePress documentation
└── scripts/                # Build utilities
```

## Data Flow

1. **Vue components** call the `useApi` composable for REST requests or `useTerminalStreams` for WebSocket connections
2. **Pinia stores** manage application state (Kubernetes, AWS, GCP, port forwards, terminals)
3. **Express routes** handle API requests by calling the appropriate SDK (K8s client, AWS SDK, GCP SDK)
4. **WebSocket servers** handle real-time streams (logs, exec, shell)
5. **Electron** (when used) wraps everything in a native window with an IPC bridge

## Product Architecture

- [KUA Unified Management Plan](./kua-unified-management-plan)
- [Architecture Workspace Phase 3](./workspace-phase-3)
- [Architecture Workspace Phase 4](./workspace-phase-4)

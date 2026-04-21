# Resumen de Arquitectura

KuaDashboard usa una arquitectura de tres capas: **Backend API** → **Frontend SPA** → **Shell Electron** (opcional).

## Diagrama General

```
┌─────────────────────────────────────────────────────────┐
│                    Electron (opcional)                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Servidor Express + WebSocket            │   │
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

## Estructura del Proyecto

```
kuadashboard/
├── server.js              # Servidor Express + WebSocket
├── package.json           # Paquete raíz (backend + Electron)
├── electron/
│   ├── main.js            # Proceso principal de Electron
│   └── preload.js         # Puente IPC seguro
├── routes/
│   ├── aws.js             # Rutas de servicios AWS
│   ├── gcp.js             # Rutas de servicios GCP
│   ├── envManager.js      # Gestión de credenciales/perfiles
│   ├── localShell.js      # WebSocket de terminal local
│   └── systemTools.js     # Detección de herramientas CLI
├── lib/
│   ├── credentialStore.js  # Almacenamiento de credenciales
│   └── crypto.js          # Utilidades de cifrado
├── frontend/
│   ├── src/
│   │   ├── App.vue         # Componente raíz
│   │   ├── components/     # Componentes UI
│   │   ├── stores/         # Gestión de estado Pinia
│   │   ├── composables/    # Composables Vue (hooks)
│   │   └── config/         # Definiciones de recursos
│   ├── vite.config.js
│   └── package.json
├── public/                 # Frontend compilado (servido por Express)
├── assets/                 # Recursos de electron-builder (iconos)
├── docs/                   # Documentación VitePress
└── scripts/                # Utilidades de build
```

# App de Escritorio Electron

KuaDashboard se distribuye como aplicación de escritorio nativa para **Windows**, **macOS** y **Linux** usando Electron.

![KuaDashboard — Panel principal](/screenshots/dashboard-main.png)

## Cómo Funciona

La app Electron agrupa el backend completo (servidor Express + WebSocket) y el frontend (Vue 3 compilado) en un solo paquete:

1. **Proceso principal** (`electron/main.js`) — hace fork del servidor Express como proceso hijo
2. **Renderer** — carga el frontend desde el servidor Express local
3. **Preload** (`electron/preload.js`) — puente IPC seguro vía `contextBridge`

```
┌─────────────────────────────────────┐
│         Proceso Principal Electron  │
│  ┌───────────────┐ ┌─────────────┐ │
│  │  Express Server│ │ BrowserWindow│ │
│  │  (child fork)  │→│ (renderer)  │ │
│  │  :7190         │ │  Vue 3 SPA  │ │
│  └───────────────┘ └─────────────┘ │
└─────────────────────────────────────┘
```

## Desarrollo

```bash
# Ejecutar Electron con live-reload (backend + Vite + Electron)
npm run electron:dev
```

Esto inicia tres procesos concurrentes:
- Backend con nodemon
- Vite dev server con HMR
- Ventana Electron apuntando al dev server

## Build

### Prerequisitos

```bash
# Asegurarse de que las dependencias estén instaladas
npm install
cd frontend && npm install && cd ..

# Generar icono de la app (solo una vez)
npm run icons:generate
```

### Build para la Plataforma Actual

```bash
npm run electron:build
```

### Build para Plataforma Específica

```bash
# Solo Windows (instalador NSIS)
npm run electron:build:win

# Solo macOS (DMG)
npm run electron:build:mac

# Solo Linux (AppImage + deb)
npm run electron:build:linux

# Todas las plataformas
npm run electron:build:all
```

::: warning Builds Multiplataforma
- El build para **macOS** requiere ejecutar en macOS
- El build para **Windows** se puede hacer desde Windows o macOS
- El build para **Linux** requiere ejecutar en Linux (o Docker con `electronuserland/builder`)
- Usa CI/CD (GitHub Actions) para builds automáticos multiplataforma
:::

### Salida del Build

Los paquetes compilados se ubican en `dist-electron/`:

```
dist-electron/
├── win-unpacked/                     # App Windows sin empaquetar
├── KuaDashboard-Setup-1.0.0.exe     # Instalador Windows
├── mac/                              # App macOS sin empaquetar
├── KuaDashboard-1.0.0.dmg          # Imagen de disco macOS
├── linux-unpacked/                   # App Linux sin empaquetar
├── KuaDashboard-1.0.0.AppImage     # AppImage Linux
└── kuadashboard_1.0.0_amd64.deb    # Paquete Debian/Ubuntu
```

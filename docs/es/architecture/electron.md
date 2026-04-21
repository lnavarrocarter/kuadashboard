# Integración Electron

La integración Electron de KuaDashboard envuelve el stack completo (Express + Vue) en una aplicación de escritorio nativa.

## Arquitectura de Procesos

```
┌──────────────────────────────────────┐
│      Proceso Principal Electron       │
│                                      │
│  ┌──────────────────────────────┐   │
│  │  child_process.fork()         │   │
│  │  → server.js (Express)        │   │
│  │  → Escucha en :7190           │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │  BrowserWindow                │   │
│  │  → Carga http://localhost:7190│   │
│  │  → preload.js (contextBridge)│   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │  Manejadores IPC              │   │
│  │  → app:version                │   │
│  └──────────────────────────────┘   │
└──────────────────────────────────────┘
```

## Archivos

### `electron/main.js`

Punto de entrada del proceso principal. Responsabilidades:
1. Hacer fork de `server.js` como proceso hijo con `silent: true`
2. Esperar la señal stdout `"KuaDashboard running"`
3. Crear `BrowserWindow` con preferencias web seguras
4. Construir el menú de la aplicación (adaptado por plataforma)
5. Manejar eventos IPC
6. Limpiar el proceso hijo al salir

### `electron/preload.js`

Puente seguro entre el renderer y el proceso principal:

```js
window.kuaElectron = {
  openExternal(url)      // Abrir URL en el navegador del sistema
  platform()             // Retorna 'win32' | 'darwin' | 'linux'
  getVersion()           // Versión de la app desde package.json
  on(channel, callback)  // Escuchar eventos IPC (canales permitidos)
  removeListener(channel, handler)
}
```

Canales IPC permitidos:
- `update:available`
- `system-tools:changed`
- `server:ready`
- `server:error`

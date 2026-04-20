# Electron Integration

KuaDashboard's Electron integration wraps the full stack (Express + Vue) into a native desktop application.

## Process Architecture

```
┌──────────────────────────────────────┐
│        Electron Main Process         │
│                                      │
│  ┌──────────────────────────────┐   │
│  │  child_process.fork()         │   │
│  │  → server.js (Express)        │   │
│  │  → Listens on :7190           │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │  BrowserWindow                │   │
│  │  → Loads http://localhost:7190│   │
│  │  → preload.js (contextBridge)│   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │  IPC Handlers                 │   │
│  │  → app:version                │   │
│  └──────────────────────────────┘   │
└──────────────────────────────────────┘
```

## Files

### `electron/main.js`

Main process entry point. Responsibilities:
1. Fork `server.js` as a child process with `silent: true`
2. Wait for the `"KuaDashboard running"` stdout signal
3. Create `BrowserWindow` with secure web preferences
4. Build the application menu (platform-aware)
5. Handle IPC events
6. Clean up the child process on quit

### `electron/preload.js`

Secure bridge between renderer and main process:

```js
window.kuaElectron = {
  openExternal(url)      // Open URL in system browser
  platform()             // Returns 'win32' | 'darwin' | 'linux'
  getVersion()           // App version from package.json
  on(channel, callback)  // Listen to IPC events (allowlisted)
  removeListener(channel, handler)
}
```

Allowed IPC channels:
- `update:available`
- `system-tools:changed`
- `server:ready`
- `server:error`

## Security

| Feature | Implementation |
|---------|---------------|
| Context isolation | `contextIsolation: true` |
| No Node in renderer | `nodeIntegration: false` |
| IPC allowlist | Only specific channels permitted |
| URL validation | External links verified against `https?://` |
| Navigation guard | Prevents navigation away from backend URL |
| Window open guard | External links open in OS browser |

## Build Configuration

electron-builder config in `package.json`:

```json
{
  "build": {
    "appId": "dev.kua.kuadashboard",
    "productName": "KuaDashboard",
    "asar": true,
    "files": [
      "electron/**",
      "server.js",
      "routes/**",
      "lib/**",
      "public/**"
    ]
  }
}
```

The `asar` archive bundles all source files into a single compressed archive for distribution. `node_modules` are automatically included by electron-builder.

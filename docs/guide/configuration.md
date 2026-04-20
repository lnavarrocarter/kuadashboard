# Configuration

## Server Configuration

KuaDashboard is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `KUBECONFIG` | `~/.kube/config` | Kubeconfig file path(s) |
| `KUADASHBOARD_STORE` | `env` | Credential store backend |

## Kubeconfig

The server loads kubeconfig files in this order:

1. **`KUBECONFIG` env var** — supports multiple paths (`;` on Windows, `:` on Unix)
2. **`~/.kube/config`** — always included as fallback
3. **`~/.kube/kuadashboard_merged.yaml`** — UI-imported configs

All configs are merged non-destructively — duplicate clusters/contexts are skipped.

## Credential Store

KuaDashboard supports two credential storage backends for cloud profiles:

### `env` (Default)
Stores credentials in environment variables and JSON files. Works everywhere.

### `keytar` (Electron)
Uses the OS keychain (Windows Credential Store, macOS Keychain, Linux Secret Service). Automatically enabled when running as an Electron desktop app.

## Vite Development Proxy

During development, the Vite dev server proxies API requests to the backend:

```js
// frontend/vite.config.js
server: {
  proxy: {
    '/api': { target: 'http://localhost:7190', changeOrigin: true },
    '/ws':  { target: 'ws://localhost:7190', ws: true, changeOrigin: true },
  }
}
```

## Custom Port

```bash
# Web mode
PORT=8080 npm start

# Electron mode
PORT=8080 npm run electron:dev
```

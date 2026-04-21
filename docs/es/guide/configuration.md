# Configuración

## Configuración del Servidor

KuaDashboard se configura mediante variables de entorno:

| Variable | Por Defecto | Descripción |
|----------|-------------|-------------|
| `PORT` | `3000` | Puerto del servidor HTTP |
| `KUBECONFIG` | `~/.kube/config` | Ruta(s) al archivo kubeconfig |
| `KUADASHBOARD_STORE` | `env` | Backend de almacenamiento de credenciales |

## Kubeconfig

El servidor carga los archivos kubeconfig en este orden:

1. **Variable de entorno `KUBECONFIG`** — soporta múltiples rutas (`;` en Windows, `:` en Unix)
2. **`~/.kube/config`** — siempre incluido como fallback
3. **`~/.kube/kuadashboard_merged.yaml`** — configs importados por la UI

Todos los configs se fusionan de forma no destructiva — clusters/contextos duplicados son ignorados.

## Almacén de Credenciales

KuaDashboard soporta dos backends de almacenamiento de credenciales para los perfiles cloud:

### `env` (Por Defecto)
Guarda las credenciales en variables de entorno y archivos JSON. Funciona en todos los entornos.

### `keytar` (Electron)
Usa el llavero del sistema operativo (Windows Credential Store, macOS Keychain, Linux Secret Service). Se activa automáticamente al ejecutar como app de escritorio Electron.

## Proxy de Desarrollo Vite

Durante el desarrollo, el servidor Vite proxia las peticiones API al backend:

```js
// frontend/vite.config.js
server: {
  proxy: {
    '/api': { target: 'http://localhost:7190', changeOrigin: true },
    '/ws':  { target: 'ws://localhost:7190', ws: true, changeOrigin: true },
  }
}
```

## Puerto Personalizado

```bash
# Modo web
PORT=8080 npm start

# Modo Electron
PORT=8080 npm run electron:dev
```

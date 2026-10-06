# Configuración

## Configuración del Servidor

KuaDashboard se configura mediante variables de entorno:

| Variable | Por Defecto | Descripción |
|----------|-------------|-------------|
| `PORT` | `7190` | Puerto del servidor HTTP |
| `KUA_HOST` | `127.0.0.1` | Dirección en la que escucha el servidor. Por defecto solo este equipo puede llegar a KUA. La API no tiene autenticación, así que `0.0.0.0` permite que cualquiera en tu red controle KUA: úsalo solo en una red de confianza |
| `KUBECONFIG` | `~/.kube/config` | Ruta(s) al archivo kubeconfig |
| `KUADASHBOARD_STORE` | `env` | Backend de almacenamiento de credenciales |
| `KUA_PLAN` | — | Reemplaza en esta computadora el plan de la cuenta KUA vinculada (desarrollo): `free`, `pro` o `team`. Desbloquea el Advisor (Pro), el refresco automático de logs y cachés de logs más grandes. Se ve en Ayuda y Opciones → Cuenta |
| `KUA_CONTROL_PLANE_URL` | el control plane de KUA | Servicio de cuentas KUA usado para iniciar sesión y contratar (Ayuda y Opciones → Cuenta). Cámbialo solo para probar un control plane local |
| `KUA_LOG_CACHE_MB` | — | Tamaño fijo de la caché local de logs en MB. Reemplaza el tamaño elegido en KUA y no está limitado por el plan |

## Kubeconfig

El servidor carga los archivos kubeconfig en este orden:

1. **Variable de entorno `KUBECONFIG`** — soporta múltiples rutas (`;` en Windows, `:` en Unix)
2. **`~/.kube/config`** — siempre incluido como fallback
3. **`~/.kube/kuadashboard_merged.yaml`** — configs importados por la UI
4. **Rutas kubeconfig registradas** — rutas agregadas desde el selector de archivos desktop o el formulario manual, guardadas en `~/.kube/kuadashboard_paths.json`

Todos los configs se fusionan de forma no destructiva — clusters/contextos duplicados son ignorados.

El modal de importacion soporta tres flujos:

- Pegar YAML kubeconfig directamente en el modal
- Elegir un archivo kubeconfig local desde la app desktop Electron
- Registrar una ruta kubeconfig existente sin copiar su contenido

## Almacén de Credenciales

KuaDashboard soporta dos backends de almacenamiento de credenciales para los perfiles cloud:

### `env` (Por Defecto)
Guarda las credenciales en variables de entorno y archivos JSON. Funciona en todos los entornos.

### `keytar` (Electron)
Usa el llavero del sistema operativo (Windows Credential Store, macOS Keychain, Linux Secret Service). Se activa automáticamente al ejecutar como app de escritorio Electron.

## Comportamiento de Escritorio en Segundo Plano

Al cerrar la ventana de KuaDashboard, se oculta en la bandeja del sistema por defecto y el backend sigue ejecutándose. Usa **Mostrar KuaDashboard** para recuperarla o **Salir** para detener el backend ordenadamente. La opción **Cerrar ventana en la bandeja** del menú se guarda localmente. Si el escritorio Linux no ofrece una bandeja compatible, vuelve a iniciar KuaDashboard para recuperar la instancia existente; usa **Salir** en el menú de la app para cerrar.

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

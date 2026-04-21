# Descargar KuaDashboard

Obtén la última versión de KuaDashboard para tu plataforma. La app de escritorio incluye todo — no es necesario instalar Node.js ni ejecutar ningún servidor manualmente.

## Captura de Pantalla

![KuaDashboard — Vista de Kubernetes Nodes](/screenshots/dashboard-nodes.png)

## Requisitos del Sistema

| Plataforma | Mínimo | Arquitectura |
|------------|--------|-------------|
| Windows    | Windows 10+ | x64 |
| macOS      | macOS 12+ | x64 / Apple Silicon |
| Linux      | Ubuntu 20.04+ / Debian 11+ | x64 |

## Releases

<script setup>
import DownloadReleases from '../.vitepress/components/DownloadReleases.vue'
</script>

<DownloadReleases />

## Instalación Manual

Si prefieres ejecutar desde el código fuente:

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
npm install
cd frontend && npm install && cd ..
npm run build:frontend
npm start
```

Luego abre [http://localhost:7190](http://localhost:7190).

## Primer Inicio

### Windows
- Ejecuta el instalador (`KuaDashboard Setup x.x.x.exe`)
- Windows SmartScreen puede mostrar una advertencia (app sin firmar) — haz clic en **Más información** → **Ejecutar de todas formas**
- KuaDashboard se instalará e iniciará automáticamente

### macOS
- Abre el archivo `.dmg` — aparecerá un diálogo de licencia con instrucciones para bypass de Gatekeeper
- Arrastra **KuaDashboard** a la carpeta **Aplicaciones**
- En el primer inicio, macOS bloqueará la app. Para permitirla:
  1. Ve a **Configuración del Sistema** → **Privacidad y Seguridad**
  2. Desplázate hacia abajo — verás un mensaje sobre KuaDashboard bloqueado
  3. Haz clic en **Abrir de todas formas** y confirma
- Alternativamente, ejecuta en Terminal:
  ```bash
  xattr -cr /Applications/KuaDashboard.app
  ```

### Linux (AppImage)
```bash
chmod +x KuaDashboard-x.x.x.AppImage
./KuaDashboard-x.x.x.AppImage
```

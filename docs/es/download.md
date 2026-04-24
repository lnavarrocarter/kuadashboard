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

## Verificar Descargas

Todos los releases se construyen automáticamente con GitHub Actions desde el [repositorio fuente](https://github.com/lnavarrocarter/kuadashboard). Puedes validar el flujo en la [pestaña de Actions](https://github.com/lnavarrocarter/kuadashboard/actions/workflows/electron-build.yml).

Cada release incluye `SHA256SUMS.txt`. Verifica el checksum antes de instalar:

### Checksum en Windows

```powershell
Get-FileHash .\KuaDashboard-Setup-x.x.x.exe -Algorithm SHA256
```

### Checksum en macOS

```bash
shasum -a 256 KuaDashboard-x.x.x.dmg
```

### Checksum en Linux

```bash
sha256sum KuaDashboard-x.x.x.AppImage
```

Compara el hash obtenido con la entrada correspondiente en `SHA256SUMS.txt` del mismo release.

Para detalles de firma, notarizacion y configuracion de certificados/secrets, revisa [Firma de Codigo y Notarizacion](/es/guide/code-signing).

## Primer Inicio

### Windows

- Ejecuta el instalador (`KuaDashboard Setup x.x.x.exe`)
- Verifica que el editor mostrado sea **lnavarrocarter**
- KuaDashboard se instalará e iniciará automáticamente

### macOS

- Arrastra **KuaDashboard** a la carpeta **Aplicaciones**
- La app se distribuye firmada y notarizada; Gatekeeper debería permitir su ejecución normal

Validación opcional de firma:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/KuaDashboard.app
spctl -a -vv /Applications/KuaDashboard.app
```

### Linux (AppImage)

```bash
chmod +x KuaDashboard-x.x.x.AppImage
./KuaDashboard-x.x.x.AppImage
```

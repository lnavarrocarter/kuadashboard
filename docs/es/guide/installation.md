# Instalación

## Requisitos del Sistema

| Componente | Mínimo | Recomendado |
|------------|--------|-------------|
| Node.js    | 16.x   | 20.x+       |
| SO         | Windows 10, macOS 12, Ubuntu 20.04 | Latest |
| RAM        | 512 MB | 1 GB+       |
| kubectl    | 1.24+  | Latest      |

## Instalar desde el Código Fuente

### 1. Clonar el Repositorio

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
```

### 2. Instalar Dependencias

```bash
# Dependencias raíz (backend + Electron)
npm install

# Dependencias frontend
cd frontend && npm install && cd ..
```

### 3. Compilar el Frontend

```bash
npm run build:frontend
```

Esto compila el frontend Vue 3 y genera la salida en el directorio `public/`, donde el servidor Express lo sirve como archivos estáticos.

### 4. Iniciar el Servidor

```bash
npm start
# o con un puerto personalizado:
PORT=8080 npm start
```

## Instalar como App de Escritorio

Descarga el instalador más reciente para tu plataforma desde la página de [Descargas](/es/download), o desde [GitHub Releases](https://github.com/lnavarrocarter/kuadashboard/releases):

| Plataforma | Formato | Archivo |
|------------|---------|---------|
| Windows    | Instalador | `KuaDashboard-Setup-x.x.x.exe` |
| macOS      | DMG | `KuaDashboard-x.x.x.dmg` |
| Linux      | AppImage | `KuaDashboard-x.x.x.AppImage` |
| Linux      | Debian/Ubuntu | `kuadashboard_x.x.x_amd64.deb` |

### Modelo de confianza en Windows y macOS

Los releases de escritorio se distribuyen con firma de codigo (Windows) y notarizacion (macOS).

Para ver el proceso completo de generacion/exportacion de certificados y configuracion de secrets en CI, revisa [Firma de Codigo y Notarizacion](/es/guide/code-signing).

### Linux — AppImage

```bash
chmod +x KuaDashboard-x.x.x.AppImage
./KuaDashboard-x.x.x.AppImage
```

### Linux — Debian / Ubuntu

```bash
sudo dpkg -i kuadashboard_x.x.x_amd64.deb
sudo apt-get install -f   # corregir dependencias si es necesario
```

## Configuración de Kubeconfig

KuaDashboard lee tu kubeconfig desde las ubicaciones estándar:

1. Variable de entorno `KUBECONFIG` (soporta múltiples rutas)
2. `~/.kube/config` (por defecto)
3. Configs importados vía UI (guardados en `~/.kube/kuadashboard_merged.yaml`)

::: tip
Puedes importar archivos kubeconfig adicionales directamente desde la UI usando el botón **+** en el encabezado.
:::

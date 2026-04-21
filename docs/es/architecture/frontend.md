# Frontend (Vue 3)

El frontend es una Single Page Application Vue 3 usando Pinia para gestión de estado y Vite como tooling.

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Vue 3 (Composition API) |
| Estado | Pinia |
| Build | Vite |
| Iconos | Lucide |
| Markdown | marked |
| YAML | js-yaml |
| Enrutamiento | Basado en componentes (cambio por sidebar) |

## Arquitectura de Componentes

```
App.vue
├── Header (selectores de contexto/namespace, herramientas)
├── CliToolsNotice
├── Sidebar (navegación de recursos, vistas cloud)
├── Contenido Principal
│   ├── ResourceTable (recursos K8s)
│   ├── EnvManagerView (perfiles de credenciales)
│   ├── GcpView (panel GCP)
│   ├── AwsView (panel AWS)
│   └── LocalShellView (terminal)
├── TerminalPanel (logs/exec multi-tab)
├── PortForwardPanel
├── StatusBar
├── Modales
│   ├── DeleteModal
│   ├── ScaleModal
│   ├── YamlModal
│   ├── PortForwardModal
│   └── KubeconfigModal
└── ToastContainer
```

## Stores Pinia

| Store | Archivo | Propósito |
|-------|---------|-----------|
| `useKubeStore` | `stores/useKubeStore.js` | Estado K8s (contextos, namespaces, recursos) |
| `usePortForwardStore` | `stores/usePortForwardStore.js` | Gestión de port forwards |
| `useTerminalStore` | `stores/useTerminalStore.js` | Pestañas y salida de terminal |
| `useAwsStore` | `stores/useAwsStore.js` | Datos y estado de servicios AWS |
| `useGcpStore` | `stores/useGcpStore.js` | Datos y estado de servicios GCP |

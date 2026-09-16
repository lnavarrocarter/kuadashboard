# Frontend (Vue 3)

The frontend is a Vue 3 Single Page Application using Pinia for state management and Vite for tooling.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vue 3 (Composition API) |
| State | Pinia |
| Build | Vite |
| Icons | Lucide |
| Markdown | marked |
| YAML | js-yaml |
| Routing | Component-based (sidebar switching) |

## Component Architecture

```
App.vue
├── Header (context/namespace selectors, tools)
├── CliToolsNotice
├── Sidebar (resource navigation, cloud views)
├── Main Content
│   ├── ResourceTable (K8s resources)
│   ├── EnvManagerView (credential profiles)
│   ├── GcpView (GCP panel)
│   └── AwsView (AWS panel)
├── ConsoleWorkspaceView (dedicated Console session workspace)
├── TerminalPanel (multi-tab logs/exec/local/EC2 quick panel)
├── PortForwardPanel
├── StatusBar
├── Modals
│   ├── DeleteModal
│   ├── ScaleModal
│   ├── YamlModal
│   ├── PortForwardModal
│   └── KubeconfigModal
└── ToastContainer
```

## Pinia Stores

| Store | File | Purpose |
|-------|------|---------|
| `useKubeStore` | `stores/useKubeStore.js` | K8s state (contexts, namespaces, resources) |
| `usePortForwardStore` | `stores/usePortForwardStore.js` | Port forward management |
| `useTerminalStore` | `stores/useTerminalStore.js` | Terminal tabs and output |
| `useAwsStore` | `stores/useAwsStore.js` | AWS service data and state |
| `useGcpStore` | `stores/useGcpStore.js` | GCP service data and state |
| `useEnvStore` | `stores/useEnvStore.js` | Cloud profiles/credentials |

## Composables

| Composable | File | Purpose |
|-----------|------|---------|
| `useApi` | `composables/useApi.js` | HTTP fetch wrapper with error handling |
| `useToast` | `composables/useToast.js` | Toast notification system |
| `useTerminalStreams` | `composables/useTerminalStreams.js` | WebSocket stream management |
| `useSortable` | `composables/useSortable.js` | Table sorting logic |

## Build Output

```bash
npm run build    # Outputs to ../public/
```

The Vite build outputs to the root `public/` directory so the Express server can serve it directly as static files. When building for Electron, the `ELECTRON_BUILD=1` env var tells Vite to use relative paths (`base: './'`).

## Testing

```bash
cd frontend
npm test         # Run all tests (Vitest)
npm run test:watch  # Watch mode
```

Tests use Vitest with jsdom environment and `@vue/test-utils` for component testing.

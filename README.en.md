# KUA — Know Unified Administration

> **K**now · **U**nified · **A**dministration

Language: [English](README.en.md) · [Español](README.md)

KUA is an open-source dashboard for observing and operating infrastructure across Kubernetes and multiple cloud providers. It brings inventory, activity, logs, and application architecture into one interface.

Built with **Node.js, Express, Vue 3, Vite, and Pinia**. Available as a web app or an Electron desktop app for **Windows, macOS, and Linux**. See the [changelog](docs/changelog.md) for the current release.

## Screenshots

![KUA Pods view](screenshots/dashboard-main.png)

![KUA Deployments view](screenshots/dashboard-deployments.png)

## Features

- **Kubernetes:** multi-context and multi-namespace resource management, logs, pod exec, metrics, events, YAML editing, port forwarding, and Helm.
- **AWS and GCP:** browse and operate supported compute, storage, networking, database, messaging, security, and observability services.
- **Vercel:** browse projects, deployments, and deployment logs.
- **KUApps:** connect application resources, architecture, and observability signals.
- **Insights:** deterministic Advisor checks, local log analysis, CloudWatch dashboards, and estimated KUA API costs.
- **AI tools:** read-only MCP tools for compatible clients.
- **Desktop:** native Electron app with an integrated backend and automatic updates.

## Getting started

Requirements: Node.js 18 or later, `kubectl` with a configured kubeconfig, and provider credentials for the cloud services you use.

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
npm install
cd frontend && npm install && cd ..
npm start
```

Open `http://localhost:7190`. For hot reload, run `npm run dev:full`; the backend uses port 7192 and Vite uses port 7191.

## Documentation

- [Documentation in English](docs/index.md)
- [Documentación en español](docs/es/index.md)
- [Changelog](docs/changelog.md)
- [Product roadmap](docs/ROADMAP.md)

The README describes available product capabilities. The roadmap lists planned work and does not imply that those items are already implemented.

## Security

KUA stores credential profiles encrypted with AES-256-GCM. The local server binds to `127.0.0.1` by default. Setting `KUA_HOST` exposes its unauthenticated API, so only do this on a trusted network with appropriate access controls.

## License

MIT. [Sponsor the project](https://github.com/sponsors/lnavarrocarter/).

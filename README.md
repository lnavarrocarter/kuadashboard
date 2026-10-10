# KUA — Know Unified Administration

> **K**now · **U**nified · **A**dministration

Language: English · [Español](README.es.md)

[![Release](https://img.shields.io/github/v/release/lnavarrocarter/kuadashboard)](https://github.com/lnavarrocarter/kuadashboard/releases/latest)
[![Desktop build](https://github.com/lnavarrocarter/kuadashboard/actions/workflows/electron-build.yml/badge.svg)](https://github.com/lnavarrocarter/kuadashboard/actions/workflows/electron-build.yml)
[![Stars](https://img.shields.io/github/stars/lnavarrocarter/kuadashboard)](https://github.com/lnavarrocarter/kuadashboard/stargazers)
[![Forks](https://img.shields.io/github/forks/lnavarrocarter/kuadashboard)](https://github.com/lnavarrocarter/kuadashboard/forks)
[![Documentation](https://img.shields.io/badge/docs-English%20%7C%20Espa%C3%B1ol-008060)](docs/index.md)

KUA is an open-source dashboard for observing and operating infrastructure across Kubernetes and multiple cloud providers. It brings inventory, activity, logs, and application architecture into one interface.

For developers and DevOps/SRE teams managing Kubernetes, AWS, GCP, or Vercel who need to inspect their environments without constantly switching consoles.

**[Download the desktop app](https://github.com/lnavarrocarter/kuadashboard/releases/latest)** · [English documentation](docs/index.md) · [Install from source](#getting-started)

## First try

1. Download and install the package for your system from Releases. The desktop app includes the server and does not require Node.js.
2. For Kubernetes, use a test-environment kubeconfig and an available `kubectl`; for cloud, configure only the provider you want to inspect and use read permissions.
3. Select a context or profile and, where applicable, a namespace or region. Open the inventory and inspect an existing resource.
4. Check that its data loads without authentication errors. Do not perform write operations during this first try.

You need access to your own environment: this walkthrough does not provide a public demo or cloud resources. Queries may incur provider charges. If resources are missing, check the context, namespace, region, and permissions before changing credentials.

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

Source installation requires Git, Node.js 22.12+ on the 22 LTS branch, and npm. Kubernetes requires `kubectl` with a configured kubeconfig; configure credentials only for the cloud services you use. AWS can use the AWS CLI or credentials in `~/.aws/`; for GCP application default credentials, use `gcloud auth application-default login`.

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
npm install
npm install --prefix frontend
npm run build:frontend
npm start
```

Check `http://localhost:7190/api/health` and open `http://localhost:7190`, then follow the read-only first try above. If the port is occupied, stop your previous instance or run `node server.js` with the `PORT` environment variable set to a free port. If the interface is missing, run `npm run build:frontend` again. For hot reload, run `npm run dev:full`; the backend uses port 7192 and Vite uses port 7191.

If startup fails with a kubeconfig `ENOENT` error, check that `KUBECONFIG` points to an existing file or unset it to use the default configuration. See the [validation and baseline record (Spanish)](docs/growth-baseline.md) for the tested environment and limitations.

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

# Getting Started

KuaDashboard is a lightweight Kubernetes & Cloud dashboard built with **Node.js + Express** (backend) and **Vue 3 + Vite + Pinia** (frontend). It can run as a web app or a native desktop app via Electron.

## Prerequisites

- **Node.js** >= 16 (recommended: 20+)
- **kubectl** configured with a valid kubeconfig (`~/.kube/config`)
- For cloud features: AWS CLI or GCP `gcloud` CLI configured

## Quick Start (Web Mode)

```bash
# Clone the repository
git clone https://github.com/YOUR_USER/kuadashboard.git
cd kuadashboard

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Development Mode

For hot-reload during development:

```bash
# Backend + Frontend dev servers (concurrent)
npm run dev:full
```

This starts:
- **Backend** on `http://localhost:3000` (with nodemon auto-reload)
- **Frontend** Vite dev server on `http://localhost:5173` (with HMR)

## Desktop App (Electron)

```bash
# Development mode with Electron
npm run electron:dev

# Build for your current platform
npm run electron:build
```

See the [Electron guide](/guide/electron) for cross-platform build details.

## Next Steps

- [Installation](/guide/installation) — Detailed setup and system requirements
- [Features](/features/) — Explore all capabilities
- [Architecture](/architecture/) — Understand the project structure

# Installation

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js   | 16.x    | 20.x+       |
| OS        | Windows 10, macOS 12, Ubuntu 20.04 | Latest |
| RAM       | 512 MB  | 1 GB+       |
| kubectl   | 1.24+   | Latest      |

## Install from Source

### 1. Clone the Repository

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
```

### 2. Install Dependencies

```bash
# Root dependencies (backend + Electron)
npm install

# Frontend dependencies
cd frontend && npm install && cd ..
```

### 3. Build the Frontend

```bash
npm run build:frontend
```

This compiles the Vue 3 frontend and outputs it to the `public/` directory, where the Express server serves it as static files.

### 4. Start the Server

```bash
npm start
# or with a custom port:
PORT=8080 npm start
```

## Install as Desktop App

Download the latest installer for your platform from the [Downloads](/download) page, or from [GitHub Releases](https://github.com/lnavarrocarter/kuadashboard/releases):

| Platform | Format | File |
|----------|--------|------|
| Windows  | Installer | `KuaDashboard-Setup-x.x.x.exe` |
| macOS    | DMG | `KuaDashboard-x.x.x.dmg` |
| Linux    | AppImage | `KuaDashboard-x.x.x.AppImage` |

## Kubeconfig Setup

KuaDashboard reads your kubeconfig from the standard locations:

1. `KUBECONFIG` environment variable (supports multiple paths)
2. `~/.kube/config` (default)
3. Imported configs via the UI (stored in `~/.kube/kuadashboard_merged.yaml`)

::: tip
You can import additional kubeconfig files directly from the UI using the **+** button in the header.
:::

## Cloud Provider Setup

### AWS
Configure AWS credentials using any standard method:
- `~/.aws/credentials` and `~/.aws/config`
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- Stored profiles via the Env Manager

### GCP
- Install `gcloud` CLI and run `gcloud auth application-default login`
- Or use stored service account keys via the Env Manager

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `KUBECONFIG` | `~/.kube/config` | Kubeconfig path(s) |
| `KUADASHBOARD_STORE` | `env` | Credential store (`env` or `keytar`) |

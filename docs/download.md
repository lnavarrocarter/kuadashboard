# Download KuaDashboard

Get the latest version of KuaDashboard for your platform. The desktop app bundles everything — no need to install Node.js or run any server manually.

## System Requirements

| Platform | Minimum | Architecture |
|----------|---------|-------------|
| Windows  | Windows 10+ | x64 |
| macOS    | macOS 12+ | x64 / Apple Silicon |

## Releases

<script setup>
import DownloadReleases from './.vitepress/components/DownloadReleases.vue'
</script>

<DownloadReleases />

## Manual Installation

If you prefer to run from source:

```bash
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard
npm install
cd frontend && npm install && cd ..
npm run build:frontend
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Verify Downloads

All releases are built automatically via GitHub Actions from the [source repository](https://github.com/lnavarrocarter/kuadashboard). You can verify the build by checking the [Actions tab](https://github.com/lnavarrocarter/kuadashboard/actions/workflows/electron-build.yml).

## First Launch

### Windows
- Run the installer (`KuaDashboard Setup x.x.x.exe`)
- Windows SmartScreen may show a warning (app is unsigned) — click **More info** → **Run anyway**
- KuaDashboard will install and start automatically

### macOS
- Open the `.dmg` file
- Drag **KuaDashboard** to the **Applications** folder
- On first launch: right-click → **Open** (needed because the app is unsigned)

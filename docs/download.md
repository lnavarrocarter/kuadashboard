# Download KuaDashboard

Get the latest version of KuaDashboard for your platform. The desktop app bundles everything — no need to install Node.js or run any server manually.

## Screenshot

![KuaDashboard — Kubernetes Nodes view](/screenshots/dashboard-nodes.png)

## System Requirements

| Platform | Minimum | Architecture |
|----------|---------|-------------|
| Windows  | Windows 10+ | x64 |
| macOS    | macOS 12+ | x64 / Apple Silicon |
| Linux    | Ubuntu 20.04+ / Debian 11+ | x64 |

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
- Open the `.dmg` file — a license dialog will appear with Gatekeeper bypass instructions
- Drag **KuaDashboard** to the **Applications** folder
- On first launch, macOS will block the app. To allow it:
  1. Go to **System Settings** → **Privacy & Security**
  2. Scroll down — you'll see a message about KuaDashboard being blocked
  3. Click **Open Anyway** and confirm
- Alternatively, run in Terminal:
  ```bash
  xattr -cr /Applications/KuaDashboard.app
  ```
- The app only needs this step once. After that it will open normally.

### Linux

#### AppImage
```bash
chmod +x KuaDashboard-x.x.x.AppImage
./KuaDashboard-x.x.x.AppImage
```

#### Debian / Ubuntu (.deb)
```bash
sudo dpkg -i kuadashboard_x.x.x_amd64.deb
# If there are missing dependencies:
sudo apt-get install -f
```
Then launch from the application menu or run `kuadashboard` from the terminal.

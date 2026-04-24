'use strict';
/**
 * electron/main.js
 * Electron main process — entry point for the KuaDashboard desktop app.
 *
 * Lifecycle:
 *   1. Start the Express backend (server.js) as a child process via fork().
 *   2. Wait for the backend to signal it is ready (stdout "KuaDashboard running").
 *   3. Create the BrowserWindow and load http://localhost:7190.
 *   4. On app quit, kill the backend child process cleanly.
 *
 * Architecture decisions:
 *   - The backend runs as a separate Node.js process (fork) so it keeps its own
 *     event loop and native modules (keytar, k8s, etc.) don't need to be
 *     rebuilt for Electron's Node version.
 *   - The frontend is served by the Express static middleware (production build).
 *     In dev mode (`npm run electron:dev`) Vite serves the frontend and Express
 *     proxies API calls.
 *   - contextIsolation: true + nodeIntegration: false — renderer is sandboxed.
 *     All Node/Electron access goes through preload.js contextBridge.
 */

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path        = require('path');
const { fork }    = require('child_process');
const { execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');

// ─── Config ───────────────────────────────────────────────────────────────────

const IS_DEV       = process.env.NODE_ENV === 'development' || !app.isPackaged;
const BACKEND_PORT = process.env.PORT || 7190;
const BACKEND_URL  = `http://localhost:${BACKEND_PORT}`;
const SERVER_PATH  = path.join(__dirname, '..', 'server.js');

// ─── macOS PATH fix ──────────────────────────────────────────────────────────
// When Electron launches from the Dock or Finder on macOS it does NOT inherit
// the user's login-shell PATH, so CLI tools installed via Homebrew
// (/opt/homebrew/bin on Apple Silicon, /usr/local/bin on Intel) are invisible.
// This function queries the real PATH from the user's login shell and injects
// it into process.env before the backend is forked, so every child process
// (including the Express server and any spawn'd tool checks) can find them.
function expandMacPath() {
  if (process.platform !== 'darwin') return;
  const shells = [process.env.SHELL, '/bin/zsh', '/bin/bash'].filter(Boolean);
  for (const sh of shells) {
    try {
      const loginPath = execSync(`${sh} -lc 'echo $PATH'`, {
        encoding: 'utf8',
        timeout:  3000,
      }).trim();
      if (loginPath && loginPath.includes('/')) {
        process.env.PATH = loginPath;
        console.log('[electron] Resolved macOS PATH from login shell:', sh);
        return;
      }
    } catch (_) { /* try next shell */ }
  }
  // Hard-coded fallback: prepend the most common Homebrew binary locations
  const extra   = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin'];
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  process.env.PATH = [...extra, ...current].filter((v, i, a) => a.indexOf(v) === i).join(':');
  console.log('[electron] Using fallback macOS PATH (login shell unavailable)');
}

// ─── State ────────────────────────────────────────────────────────────────────

let mainWindow    = null;
let backendProcess = null;
let backendReady  = false;

// ─── Backend (Express) ────────────────────────────────────────────────────────

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT:                    String(BACKEND_PORT),
      // Activate KeytarStore automatically (we are in Electron)
      KUADASHBOARD_STORE:      'keytar',
      // Disable color codes in child process stdout
      FORCE_COLOR:             '0',
    };

    backendProcess = fork(SERVER_PATH, [], {
      env,
      silent: true,   // capture stdout/stderr so we can detect readiness
    });

    backendProcess.stdout.on('data', chunk => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);

      // Detect readiness signal from server.js
      if (!backendReady && text.includes('KuaDashboard running')) {
        backendReady = true;
        resolve();
      }
    });

    backendProcess.stderr.on('data', chunk => {
      process.stderr.write(`[server:err] ${chunk.toString()}`);
    });

    backendProcess.on('error', err => {
      console.error('[electron] Backend process error:', err.message);
      reject(err);
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[electron] Backend exited — code: ${code}, signal: ${signal}`);
      backendReady = false;
      if (!backendReady && mainWindow) {
        mainWindow.webContents.send('server:error', 'Backend process exited unexpectedly.');
      }
    });

    // Timeout: if server hasn't signalled readiness after 15s, reject
    setTimeout(() => {
      if (!backendReady) reject(new Error('Backend startup timed out after 15s'));
    }, 15_000);
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ─── Browser Window ───────────────────────────────────────────────────────────

function createWindow() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, '..', 'assets', iconFile);

  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    title:           'KuaDashboard',
    icon:            iconPath,
    backgroundColor: '#1e1e1e',
    show:            false,   // show after 'ready-to-show' to avoid white flash
    webPreferences: {
      preload:            path.join(__dirname, 'preload.js'),
      contextIsolation:   true,    // required for security
      nodeIntegration:    false,   // renderer has no Node access
      sandbox:            false,   // needed for preload to use require()
      webSecurity:        true,
    },
  });

  // Load app — in dev, you can optionally load the Vite dev server instead
  const loadUrl = IS_DEV
    ? process.env.VITE_DEV_URL || BACKEND_URL
    : BACKEND_URL;

  mainWindow.loadURL(loadUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in OS browser, not in Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Application menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About KuaDashboard',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'KuaDashboard',
              message: `KuaDashboard v${app.getVersion()}`,
              detail:  `Know Unified Administration\n\nElectron ${process.versions.electron}\nNode ${process.versions.node}\nChrome ${process.versions.chrome}`,
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => {
            if (!IS_DEV) {
              autoUpdater.checkForUpdates().catch(err => {
                console.warn('[updater] Manual check failed:', err.message);
              });
            } else {
              const { dialog } = require('electron');
              dialog.showMessageBox(mainWindow, {
                type:    'info',
                title:   'Updates',
                message: 'Auto-updates are disabled in development mode.',
                buttons: ['OK'],
              });
            }
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.on('app:version', event => {
  event.returnValue = app.getVersion();
});

ipcMain.handle('dialog:openFile', async (event, opts = {}) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      opts.title      || 'Select file',
    filters:    opts.filters    || [],
    properties: opts.properties || ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.on('app:check-updates', () => {
  if (!IS_DEV) {
    autoUpdater.checkForUpdates().catch(err => {
      console.warn('[updater] IPC check failed:', err.message);
    });
  }
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', info => {
    console.log('[updater] Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update:available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    }
  });

  autoUpdater.on('update-downloaded', info => {
    console.log('[updater] Update downloaded:', info.version);
    updateDownloaded = true;
    if (mainWindow) {
      mainWindow.webContents.send('update:downloaded', {
        version: info.version,
      });
    }
  });

  autoUpdater.on('error', err => {
    console.error('[updater] Error:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('update:error', err.message);
    }
  });

  // Check for updates (silently — no dialogs)
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.warn('[updater] Check failed:', err.message);
  });
}

let updateDownloaded = false;

ipcMain.on('app:install-update', () => {
  console.log('[updater] install-update requested, downloaded:', updateDownloaded);
  if (!updateDownloaded) {
    console.warn('[updater] update not yet downloaded, cannot install');
    if (mainWindow) mainWindow.webContents.send('update:error', 'La actualización no se ha descargado aún');
    return;
  }
  try {
    // Primary: quit + install + relaunch
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err.message);
    // Fallback: just quit — autoInstallOnAppQuit will install on exit
    try {
      console.log('[updater] Falling back to app.quit() — update will install on exit');
      if (mainWindow) mainWindow.webContents.send('update:error', 'quitAndInstall falló. La app se cerrará e instalará la actualización.');
      setTimeout(() => app.quit(), 1500);
    } catch (e2) {
      console.error('[updater] app.quit() also failed:', e2.message);
      if (mainWindow) mainWindow.webContents.send('update:error', err.message);
    }
  }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Set App User Model ID on Windows so the taskbar and notifications show
  // the correct icon instead of the default Electron icon.
  if (process.platform === 'win32') {
    app.setAppUserModelId('dev.kua.kuadashboard');
  }

  // Expand PATH on macOS before anything else so the backend and all child
  // processes can find Homebrew-installed CLI tools (kubectl, aws, gcloud…)
  expandMacPath();

  buildMenu();

  console.log('[electron] Starting backend…');
  try {
    await startBackend();
    console.log('[electron] Backend ready. Creating window…');
  } catch (err) {
    console.error('[electron] Failed to start backend:', err.message);
    // Still create the window so the user sees an error instead of a blank screen
  }

  createWindow();

  // Check for updates after window is ready (production only)
  if (!IS_DEV) setupAutoUpdater();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  // On macOS, keep the app running in the dock (standard behavior)
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopBackend);

// Prevent navigation to arbitrary URLs (security hardening)
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(BACKEND_URL)) {
      event.preventDefault();
    }
  });
});

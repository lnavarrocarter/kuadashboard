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

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, nativeTheme, screen } = require('electron');
const path        = require('path');
const { fork }    = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');
const { createDesktopLifecycle } = require('./desktopLifecycle');
const { summarizeTaskProgress } = require('./taskbarProgress');
const { buildTrayStatus, parseTrayAction, panelPosition } = require('./trayStatus');
const { openLinkTarget } = require('./openLink');

// ─── Config ───────────────────────────────────────────────────────────────────

const IS_DEV       = process.env.NODE_ENV === 'development' || !app.isPackaged;
const BACKEND_PORT = process.env.PORT || 7190;
const BACKEND_URL  = `http://localhost:${BACKEND_PORT}`;
const SERVER_PATH  = path.join(__dirname, '..', 'server.js');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// ─── Deep-link protocol (kua://) ──────────────────────────────────────────────
// Register the kua:// custom URL scheme so Vercel OAuth can redirect back to
// the app after authorization. On macOS/Linux this is handled via the
// 'open-url' event; on Windows we receive the URL as a CLI argument.

const KUA_PROTOCOL = 'kua';

// Register as default protocol handler (must happen before app is ready on Windows)
if (!app.isDefaultProtocolClient(KUA_PROTOCOL)) {
  app.setAsDefaultProtocolClient(KUA_PROTOCOL);
}

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
let desktopLifecycle = null;
let appTray = null;
let taskProgressTimer = null;
let taskProgressPollInFlight = false;
let trayPanel = null;
let trayPanelClosedAt = 0;
let trayPanelLang = null;
let backendStarting = false;
let restartingBackend = false;
// App update in the background (electron-updater), shown in the tray panel.
let updateState = { status: 'idle' };

// ─── Backend (Express) ────────────────────────────────────────────────────────

/** True when a KUA backend already answers on BACKEND_PORT. */
function backendAnswers() {
  return new Promise(resolve => {
    const request = require('http').get(`http://127.0.0.1:${BACKEND_PORT}/api/system/plan`, { timeout: 1000 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function startBackend() {
  backendStarting = true;
  try {
    return await forkBackend();
  } finally {
    backendStarting = false;
  }
}

async function forkBackend() {
  // `npm run electron:dev` already runs the backend under nodemon: a second
  // fork on the same port dies with EADDRINUSE and the window waits the 15 s timeout.
  if (IS_DEV && await backendAnswers()) {
    console.log(`[electron] Using the backend already running on port ${BACKEND_PORT}`);
    backendReady = true;
    return;
  }
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT:                    String(BACKEND_PORT),
      KUA_DATA_DIR:            app.getPath('userData'),
      // Activate KeytarStore automatically (we are in Electron)
      KUADASHBOARD_STORE:      'keytar',
      // The packaged app ignores KUA_PLAN: the plan comes from the KUA account (lib/plans.js).
      ...(app.isPackaged ? { KUA_PACKAGED: '1' } : {}),
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
      if (!restartingBackend && mainWindow) {
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

/** Restarts the backend this app runs (tray panel), waiting for the old one to free the port. */
async function restartBackend() {
  if (restartingBackend) return;
  restartingBackend = true;
  try {
    const previous = backendProcess;
    if (previous && previous.exitCode === null && previous.signalCode === null) {
      const exited = new Promise(resolve => previous.once('exit', resolve));
      stopBackend();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    backendProcess = null;
    backendReady = false;
    await startBackend();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  } catch (err) {
    console.error('[electron] Backend restart failed:', err.message);
  } finally {
    restartingBackend = false;
  }
}

/** One request to the local backend: { status, body } or null when it does not answer. */
function backendRequest(method, requestPath, payload, { timeout = 1500 } = {}) {
  return new Promise(resolve => {
    const data = payload === undefined ? null : JSON.stringify(payload);
    const request = require('http').request({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: requestPath,
      method,
      timeout,
      headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
    if (data) request.write(data);
    request.end();
  });
}

function readDesktopPreferences() {
  const filePath = path.join(app.getPath('userData'), 'desktop-preferences.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveCloseToTray(enabled) {
  const filePath = path.join(app.getPath('userData'), 'desktop-preferences.json');
  let preferences = {};
  try {
    preferences = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* start with defaults */ }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...preferences, closeToTray: enabled }, null, 2));
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show status…', click: () => openTrayPanel() },
    { label: 'Show KuaDashboard', click: () => desktopLifecycle.showWindow() },
    { type: 'separator' },
    {
      label: 'Close window to tray',
      type: 'checkbox',
      checked: desktopLifecycle.closeToTray,
      click: item => desktopLifecycle.setCloseToTray(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => desktopLifecycle.quit() },
  ]);
}

function setupTray() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, '..', 'assets', iconFile);
  try {
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) throw new Error(`Tray icon could not be loaded: ${iconPath}`);
    image = image.resize({ width: process.platform === 'darwin' ? 16 : 24, height: process.platform === 'darwin' ? 16 : 24 });
    if (process.platform === 'darwin') image.setTemplateImage(true);
    appTray = new Tray(image);
    appTray.setToolTip('KuaDashboard');
    // Click opens the status panel and right-click the menu. Linux trays only show
    // a context menu, so there the panel is its first item.
    if (process.platform === 'linux') {
      appTray.setContextMenu(trayMenu());
    } else {
      appTray.on('right-click', () => appTray?.popUpContextMenu(trayMenu()));
    }
    appTray.on('click', () => toggleTrayPanel());
  } catch (err) {
    console.warn('[electron] System tray unavailable; launch KuaDashboard again to restore its window:', err.message);
  }
}

// ─── Tray panel ───────────────────────────────────────────────────────────────
// Status of KUA, the background tasks running and up next, AI agent access (MCP)
// and the app update (electron/trayPanel.html, electron/trayStatus.js).

const TRAY_PANEL_SIZE = { width: 360, height: 500 };

function trayPanelOpen() {
  return !!trayPanel && !trayPanel.isDestroyed();
}

/** The language chosen in KUA (settings of the main window), else the OS one. */
async function readTrayPanelLang() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const lang = await mainWindow.webContents.executeJavaScript(
        "(() => { try { return JSON.parse(localStorage.getItem('kua:settings') || '{}').lang || '' } catch { return '' } })()", true);
      if (lang === 'es' || lang === 'en') return lang;
    }
  } catch { /* window still loading */ }
  return app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en';
}

async function collectTrayStatus() {
  const [health, plan, tasks, access] = await Promise.all([
    backendRequest('GET', '/api/health'),
    backendRequest('GET', '/api/system/plan'),
    backendRequest('GET', '/api/system/tasks'),
    backendRequest('GET', '/api/kua-apps/agent-access'),
  ]);
  const ok = response => (response?.status === 200 ? response.body : null);
  const taskList = Array.isArray(ok(tasks)?.tasks) ? ok(tasks).tasks : [];
  applyTaskProgress(taskList);
  return {
    ...buildTrayStatus({
      backend: { ready: backendReady, starting: backendStarting || restartingBackend, managed: !IS_DEV || !!backendProcess },
      health: ok(health),
      plan: ok(plan),
      tasks: taskList,
      access: ok(access),
      update: updateState,
      port: BACKEND_PORT,
      appVersion: app.getVersion(),
    }),
    lang: trayPanelLang || 'en',
  };
}

async function pushTrayStatus() {
  if (!trayPanelOpen()) return null;
  const status = await collectTrayStatus();
  if (trayPanelOpen()) trayPanel.webContents.send('tray:status', status);
  return status;
}

async function openTrayPanel() {
  if (trayPanelOpen()) {
    trayPanel.show();
    trayPanel.focus();
    return;
  }
  trayPanelLang = await readTrayPanelLang();
  if (trayPanelOpen()) return;
  trayPanel = new BrowserWindow({
    ...TRAY_PANEL_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'KuaDashboard',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2125' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'trayPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const trayBounds = appTray?.getBounds?.() || null;
  const cursor = screen.getCursorScreenPoint();
  const display = trayBounds && trayBounds.width > 0 ? screen.getDisplayMatching(trayBounds) : screen.getDisplayNearestPoint(cursor);
  const { x, y } = panelPosition({ ...TRAY_PANEL_SIZE, trayBounds, cursor, workArea: display.workArea });
  trayPanel.setPosition(x, y, false);
  trayPanel.loadFile(path.join(__dirname, 'trayPanel.html'));
  trayPanel.once('ready-to-show', () => {
    if (!trayPanelOpen()) return;
    trayPanel.show();
    trayPanel.focus();
  });
  // Closes like a menu: when it loses focus, or with Escape.
  trayPanel.on('blur', () => { if (trayPanelOpen()) trayPanel.close(); });
  trayPanel.on('closed', () => {
    trayPanel = null;
    trayPanelClosedAt = Date.now();
  });
}

function closeTrayPanel() {
  if (trayPanelOpen()) trayPanel.close();
}

function toggleTrayPanel() {
  if (trayPanelOpen()) return closeTrayPanel();
  // A click on the icon while the panel is open first blurs (closes) it: that click only closes.
  if (Date.now() - trayPanelClosedAt < 300) return;
  openTrayPanel();
}

async function runTrayAction(action) {
  switch (action.type) {
    case 'open':
      closeTrayPanel();
      desktopLifecycle.showWindow();
      return null;
    case 'quit':
      desktopLifecycle.quit();
      return null;
    case 'mcp':
      await backendRequest('PUT', '/api/kua-apps/agent-access', { enabled: action.enabled });
      break;
    case 'task':
      await backendRequest('POST', `/api/system/tasks/${encodeURIComponent(action.id)}/${action.action}`);
      break;
    case 'restart-backend':
      if (!IS_DEV || backendProcess) await restartBackend();
      break;
    case 'check-updates':
      checkForUpdates();
      break;
    case 'install-update':
      installUpdate();
      return null;
    default:
      break;
  }
  return collectTrayStatus();
}

// Only the tray panel may ask: its actions are validated by parseTrayAction.
ipcMain.handle('tray:get-status', event => {
  if (!trayPanelOpen() || event.sender !== trayPanel.webContents) return null;
  return collectTrayStatus();
});

ipcMain.handle('tray:action', async (event, input) => {
  if (!trayPanelOpen() || event.sender !== trayPanel.webContents) return null;
  const action = parseTrayAction(input);
  if (!action) return null;
  return runTrayAction(action);
});

function applyTaskProgress(tasks) {
  const summary = summarizeTaskProgress(tasks);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (summary.mode === 'determinate') mainWindow.setProgressBar(summary.progress);
    else if (summary.mode === 'indeterminate') mainWindow.setProgressBar(2, { mode: 'indeterminate' });
    else mainWindow.setProgressBar(-1);
  }
  appTray?.setToolTip(summary.tooltip);
}

function pollTaskProgress() {
  if (taskProgressPollInFlight) return;
  // While the panel is open its refresh also updates the taskbar and the tooltip.
  if (trayPanelOpen()) {
    taskProgressPollInFlight = true;
    pushTrayStatus().catch(() => {}).finally(() => { taskProgressPollInFlight = false; });
    return;
  }
  taskProgressPollInFlight = true;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    taskProgressPollInFlight = false;
  };
  const request = require('http').get({
    hostname: '127.0.0.1',
    port: BACKEND_PORT,
    path: '/api/system/tasks',
    timeout: 1500,
  }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => {
      try {
        const snapshot = response.statusCode === 200 ? JSON.parse(body) : null;
        applyTaskProgress(Array.isArray(snapshot?.tasks) ? snapshot.tasks : []);
      } catch {
        applyTaskProgress([]);
      }
      finish();
    });
  });
  request.on('timeout', () => request.destroy());
  request.on('error', () => {
    applyTaskProgress([]);
    finish();
  });
}

function startTaskProgressPolling() {
  pollTaskProgress();
  if (!taskProgressTimer) {
    taskProgressTimer = setInterval(pollTaskProgress, 2000);
    taskProgressTimer.unref?.();
  }
}

function stopTaskProgressPolling() {
  if (!taskProgressTimer) return;
  clearInterval(taskProgressTimer);
  taskProgressTimer = null;
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
  desktopLifecycle?.attachWindow(mainWindow);

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

  setupContextMenu();
}

function setupContextMenu() {
  if (!mainWindow) return;
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];

    if (params.selectionText) {
      items.push({ role: 'copy', label: 'Copy' });
    }

    if (params.isEditable) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { role: 'cut', label: 'Cut', enabled: params.editFlags?.canCut !== false },
        { role: 'copy', label: 'Copy', enabled: params.editFlags?.canCopy !== false },
        { role: 'paste', label: 'Paste', enabled: params.editFlags?.canPaste !== false },
      );
    }

    if (items.length) {
      items.push({ type: 'separator' }, { role: 'selectAll', label: 'Select All' });
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
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
        { label: 'Quit KuaDashboard', accelerator: 'Command+Q', click: () => desktopLifecycle?.quit() },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        process.platform === 'darwin' ? { role: 'close' } : { label: 'Quit', click: () => desktopLifecycle?.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(process.platform === 'darwin'
          ? [{ role: 'pasteAndMatchStyle' }]
          : []),
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
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
              checkForUpdates();
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

function checkForUpdates() {
  if (IS_DEV) {
    updateState = { status: 'error', error: 'Auto-updates are disabled in development mode' };
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.checkForUpdates().catch(err => {
    console.warn('[updater] Check failed:', err.message);
  });
}

ipcMain.on('app:check-updates', () => {
  if (!IS_DEV) checkForUpdates();
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    if (updateState.status !== 'downloaded') updateState = { status: 'checking' };
  });

  autoUpdater.on('update-not-available', () => {
    updateState = { status: 'none' };
  });

  autoUpdater.on('download-progress', progress => {
    updateState = { ...updateState, status: 'downloading', percent: Math.round(progress.percent || 0) };
  });

  autoUpdater.on('update-available', info => {
    console.log('[updater] Update available:', info.version);
    updateState = { status: 'available', version: info.version };
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
    updateState = { status: 'downloaded', version: info.version };
    if (mainWindow) {
      mainWindow.webContents.send('update:downloaded', {
        version: info.version,
      });
    }
  });

  autoUpdater.on('error', err => {
    console.error('[updater] Error:', err.message);
    updateState = { ...updateState, status: 'error', error: String(err.message || err).slice(0, 160) };
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

ipcMain.on('app:install-update', () => installUpdate());

function installUpdate() {
  console.log('[updater] install-update requested, downloaded:', updateDownloaded);
  if (!updateDownloaded) {
    console.warn('[updater] update not yet downloaded, cannot install');
    if (mainWindow) mainWindow.webContents.send('update:error', 'La actualización no se ha descargado aún');
    return;
  }
  try {
    const { autoUpdater } = require('electron-updater');
    desktopLifecycle?.allowQuit();
    // Primary: quit + install + relaunch
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err.message);
    // Fallback: just quit — autoInstallOnAppQuit will install on exit
    try {
      console.log('[updater] Falling back to app.quit() — update will install on exit');
      if (mainWindow) mainWindow.webContents.send('update:error', 'quitAndInstall falló. La app se cerrará e instalará la actualización.');
      setTimeout(() => desktopLifecycle?.quit(), 1500);
    } catch (e2) {
      console.error('[updater] app.quit() also failed:', e2.message);
      if (mainWindow) mainWindow.webContents.send('update:error', err.message);
    }
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

if (!hasSingleInstanceLock) {
  app.quit();
} else app.whenReady().then(async () => {
  // Set App User Model ID on Windows so the taskbar and notifications show
  // the correct icon instead of the default Electron icon.
  if (process.platform === 'win32') {
    app.setAppUserModelId('dev.kua.kuadashboard');
  }

  // Expand PATH on macOS before anything else so the backend and all child
  // processes can find Homebrew-installed CLI tools (kubectl, aws, gcloud…)
  expandMacPath();

  const preferences = readDesktopPreferences();
  desktopLifecycle = createDesktopLifecycle({
    app,
    getWindow: () => mainWindow,
    createWindow,
    stopBackend,
    closeToTray: preferences.closeToTray !== false,
    persistCloseToTray: saveCloseToTray,
    destroyTray: () => {
      stopTaskProgressPolling();
      closeTrayPanel();
      appTray?.destroy();
      appTray = null;
    },
  });

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
  setupTray();
  startTaskProgressPolling();

  // Check for updates after window is ready (production only)
  if (!IS_DEV) setupAutoUpdater();

  app.on('activate', () => {
    desktopLifecycle.showWindow();
  });
});

// ─── Deep-link handler ────────────────────────────────────────────────────────
// Handles kua://vercel/callback?code=…&state=… after Vercel OAuth redirect.
// macOS/Linux: 'open-url' event fires with the full URL.
// Windows: the URL is passed as a command-line argument to a second instance;
//          we use the 'second-instance' event to capture it.

function handleDeepLink(url) {
  if (!url || !url.startsWith(`${KUA_PROTOCOL}://`)) return;
  console.log('[electron] Deep-link received:', url);

  try {
    // kua://vercel/callback?code=…&state=…
    // Parse by treating kua:// as https:// so URL constructor works
    const parsed = new URL(url.replace(`${KUA_PROTOCOL}://`, 'https://'));
    const host   = parsed.hostname; // 'vercel'
    const path   = parsed.pathname; // '/callback'

    // kua://open?view=… (VS Code extension, #302): show KUA, on that view when one is given.
    const open = openLinkTarget(url, BACKEND_URL);
    if (open) {
      desktopLifecycle?.showWindow();
      if (open.hasView && mainWindow) mainWindow.loadURL(open.url);
      return;
    }

    if (host === 'vercel' && path === '/callback') {
      const code            = parsed.searchParams.get('code');
      const state           = parsed.searchParams.get('state');
      const configurationId = parsed.searchParams.get('configurationId');
      const teamId          = parsed.searchParams.get('teamId');
      const next            = parsed.searchParams.get('next');
      const source          = parsed.searchParams.get('source');
      const oauthError      = parsed.searchParams.get('error');
      const oauthErrorDescription = parsed.searchParams.get('error_description');

      if (oauthError) {
        const message = oauthErrorDescription
          ? `Vercel OAuth failed: ${oauthErrorDescription}`
          : `Vercel OAuth failed: ${oauthError}`;
        console.error('[electron] vercel oauth callback error:', message);
        if (mainWindow) {
          mainWindow.webContents.send('vercel:oauth-error', message);
        }
        return;
      }

      if (!code || (!state && !configurationId)) {
        const message = 'Vercel OAuth callback missing code and state/configurationId';
        console.warn(`[electron] ${message}`);
        if (mainWindow) {
          mainWindow.webContents.send('vercel:oauth-error', message);
        }
        return;
      }

      // Forward to our backend OAuth callback endpoint
      fetch(`${BACKEND_URL}/api/cloud/vercel/oauth/callback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, state, configurationId, teamId, next, source }),
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = data?.error || `OAuth callback failed (${response.status})`;
            throw new Error(message);
          }
          if (!data?.id || !data?.name) {
            throw new Error('OAuth callback returned invalid profile data');
          }
          return data;
        })
        .then(data => {
          if (mainWindow) {
            // Notify the renderer so it can refresh its profile list and
            // auto-select the newly created Vercel profile
            mainWindow.webContents.send('vercel:oauth-complete', data);
          }
          // Marketplace flow: Vercel requires a redirect to `next` to mark
          // the integration as installed. Open it in the OS browser.
          if (data?.next) {
            const nextUrl = data.next;
            if (/^https:\/\/vercel\.com\//.test(nextUrl)) {
              shell.openExternal(nextUrl);
            }
          }
        })
        .catch(err => {
          console.error('[electron] vercel oauth callback error:', err.message);
          if (mainWindow) {
            mainWindow.webContents.send('vercel:oauth-error', err.message);
          }
        });
    }
  } catch (err) {
    console.error('[electron] handleDeepLink parse error:', err.message);
  }
}

// macOS / Linux: app already running, URL comes via 'open-url'
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows: second-instance event (app receives URL as argv)
app.on('second-instance', (_event, argv) => {
  // The deep-link URL is typically the last argv item on Windows
  const deepLink = argv.find(a => a.startsWith(`${KUA_PROTOCOL}://`));
  if (deepLink) handleDeepLink(deepLink);

  // Bring the existing window to the foreground
  desktopLifecycle?.showWindow();
});

// Prevent navigation to arbitrary URLs (security hardening)
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(BACKEND_URL)) {
      event.preventDefault();
    }
  });
});

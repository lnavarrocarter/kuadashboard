'use strict';
/**
 * electron/preload.js
 * Secure IPC bridge between the Electron renderer (Vue app) and the main process.
 *
 * Uses contextBridge to expose a minimal, typed API on `window.kuaElectron`.
 * The renderer NEVER gets direct access to Node.js or Electron internals.
 *
 * Exposed API (window.kuaElectron):
 *   openExternal(url)          → opens URL in the default system browser
 *   platform()                 → returns process.platform ('win32', 'darwin', 'linux')
 *   onUpdateAvailable(cb)      → registers a listener for app update notifications
 *   onSystemToolsChanged(cb)   → registers a listener when CLI tool availability changes
 *   removeListener(channel, cb)→ cleans up IPC listeners
 *   getVersion()               → returns the app version from package.json
 */

const { contextBridge, ipcRenderer, shell } = require('electron');

// Allowlist of valid IPC channels the renderer may listen to
const ALLOWED_RECEIVE = new Set([
  'update:available',
  'system-tools:changed',
  'server:ready',
  'server:error',
]);

contextBridge.exposeInMainWorld('kuaElectron', {
  /** Open a URL in the OS default browser (safe — validated against http/https) */
  openExternal(url) {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
  },

  /** Current OS platform */
  platform() {
    return process.platform;
  },

  /** App version from package.json */
  getVersion() {
    return ipcRenderer.sendSync('app:version');
  },

  /**
   * Listen to an IPC channel from main process.
   * Only channels in ALLOWED_RECEIVE are permitted.
   */
  on(channel, callback) {
    if (!ALLOWED_RECEIVE.has(channel)) {
      console.warn(`[preload] Blocked attempt to listen on channel: ${channel}`);
      return;
    }
    // Wrap to avoid leaking the full event object to the renderer
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return handler; // return so caller can pass it to removeListener
  },

  /** Remove a previously registered IPC listener */
  removeListener(channel, handler) {
    if (!ALLOWED_RECEIVE.has(channel)) return;
    ipcRenderer.removeListener(channel, handler);
  },

  /** Convenience: listen to app update available notification */
  onUpdateAvailable(cb) {
    return this.on('update:available', cb);
  },

  /** Convenience: listen to system tool change notifications */
  onSystemToolsChanged(cb) {
    return this.on('system-tools:changed', cb);
  },
});

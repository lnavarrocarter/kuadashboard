'use strict';
/**
 * electron/trayPreload.js
 * Bridge of the tray panel (electron/trayPanel.html): it reads the status main.js
 * builds (electron/trayStatus.js) and asks for the actions it validates there.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuaTray', {
  getStatus: () => ipcRenderer.invoke('tray:get-status'),
  action: action => ipcRenderer.invoke('tray:action', action),
  onStatus(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('tray:status', (_event, status) => callback(status));
  },
});

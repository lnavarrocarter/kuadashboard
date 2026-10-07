'use strict';

function createDesktopLifecycle({
  app,
  getWindow,
  createWindow,
  stopBackend,
  closeToTray = true,
  persistCloseToTray = () => {},
  destroyTray = () => {},
}) {
  let quitting = false;
  let closeWindowToTray = closeToTray;

  function showWindow() {
    let window = getWindow();
    if (!window || window.isDestroyed?.()) window = createWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function attachWindow(window) {
    window.on('close', event => {
      if (quitting || !closeWindowToTray) return;
      event.preventDefault();
      window.hide();
    });
  }

  function setCloseToTray(enabled) {
    closeWindowToTray = Boolean(enabled);
    persistCloseToTray(closeWindowToTray);
  }

  function allowQuit() {
    quitting = true;
  }

  function quit() {
    allowQuit();
    app.quit();
  }

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    allowQuit();
    destroyTray();
    stopBackend();
  });

  return {
    attachWindow,
    showWindow,
    setCloseToTray,
    allowQuit,
    quit,
    get closeToTray() { return closeWindowToTray; },
  };
}

module.exports = { createDesktopLifecycle };
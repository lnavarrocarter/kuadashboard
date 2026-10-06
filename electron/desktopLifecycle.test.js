'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createDesktopLifecycle } = require('./desktopLifecycle');

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.minimized = true;
    this.hidden = false;
    this.restored = false;
    this.focused = false;
  }

  isMinimized() { return this.minimized; }
  restore() { this.restored = true; this.minimized = false; }
  show() { this.hidden = false; }
  hide() { this.hidden = true; }
  focus() { this.focused = true; }
}

function setup(options = {}) {
  const app = new EventEmitter();
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls += 1; };
  const window = new FakeWindow();
  const calls = { stopped: 0, trayDestroyed: 0, persisted: [] };
  const lifecycle = createDesktopLifecycle({
    app,
    getWindow: () => window,
    createWindow: () => window,
    stopBackend: () => { calls.stopped += 1; },
    destroyTray: () => { calls.trayDestroyed += 1; },
    persistCloseToTray: value => calls.persisted.push(value),
    ...options,
  });
  lifecycle.attachWindow(window);
  return { app, window, lifecycle, calls };
}

test('closing hides the window without stopping the backend; show restores it', () => {
  const { window, lifecycle, calls } = setup();
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(window.hidden, true);
  assert.equal(calls.stopped, 0);

  lifecycle.showWindow();
  assert.equal(window.hidden, false);
  assert.equal(window.restored, true);
  assert.equal(window.focused, true);
});

test('close-to-tray is configurable and persisted', () => {
  const { window, lifecycle, calls } = setup();
  lifecycle.setCloseToTray(false);
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });

  assert.equal(lifecycle.closeToTray, false);
  assert.deepEqual(calls.persisted, [false]);
  assert.equal(prevented, false);
});

test('explicit quit allows window close and stops the backend once on before-quit', () => {
  const { app, window, lifecycle, calls } = setup();
  lifecycle.quit();
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });

  assert.equal(app.quitCalls, 1);
  assert.equal(prevented, false);
  app.emit('before-quit');
  assert.equal(calls.stopped, 1);
  assert.equal(calls.trayDestroyed, 1);
});

test('closing the last non-hidden window requests application quit', () => {
  const { app } = setup({ closeToTray: false });
  app.emit('window-all-closed');
  assert.equal(app.quitCalls, 1);
});
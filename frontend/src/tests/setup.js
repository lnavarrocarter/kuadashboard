// Global test setup for jsdom environment
import { vi } from 'vitest'

// Set a consistent location that matches the production Electron port
// so WebSocket URL assertions in tests are predictable.
Object.defineProperty(window, 'location', {
  value: { protocol: 'http:', host: 'localhost:7190', hostname: 'localhost', port: '7190', href: 'http://localhost:7190/' },
  writable: true,
})

// Mock WebSocket globally
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this._listeners = {}
    MockWebSocket.instances.push(this)
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = []
    this._listeners[type].push(fn)
  }
  removeEventListener(type, fn) {
    if (this._listeners[type])
      this._listeners[type] = this._listeners[type].filter(f => f !== fn)
  }
  send(data) {
    this._lastSent = data
  }
  close() {
    this.readyState = 3
    this._emit('close', {})
  }
  _emit(type, event) {
    ;(this._listeners[type] || []).forEach(fn => fn(event))
  }
  static instances = []
  static reset() { MockWebSocket.instances = [] }
}
global.WebSocket = MockWebSocket

// Mock localStorage
const store = {}
global.localStorage = {
  getItem:    key        => store[key] ?? null,
  setItem:    (key, val) => { store[key] = String(val) },
  removeItem: key        => { delete store[key] },
  clear:      ()         => { Object.keys(store).forEach(k => delete store[k]) },
}

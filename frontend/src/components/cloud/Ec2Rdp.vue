<template>
  <Teleport to="body">
    <div v-if="open" class="rdpc-backdrop" @mousedown.self="onBackdropClick">
      <div class="rdpc-modal" :class="{ fullscreen: isFullscreen }">

        <!-- Header -->
        <div class="rdpc-header">
          <div class="rdpc-title">
            <span>🪟</span>
            <span>RDP — {{ instance?.name || instance?.id }}</span>
            <span v-if="connectedHost" class="rdpc-host-badge">{{ connectedHost }}</span>
          </div>
          <div class="rdpc-hdr-right">
            <span :class="['rdpc-status', sessionStatus]">{{ statusLabel }}</span>
            <button class="rdpc-tbtn" title="Fullscreen" @click="toggleFullscreen">⛶</button>
            <button class="rdpc-close" @click="$emit('close')">✕</button>
          </div>
        </div>

        <!-- Connect form -->
        <div v-if="sessionStatus === 'disconnected'" class="rdpc-form">

          <!-- NLA warning -->
          <div class="rdpc-notice">
            <strong>⚠ Requisito:</strong> La instancia Windows debe tener NLA deshabilitado.<br>
            <span class="rdpc-notice-sub">
              En el servidor → Propiedades del sistema → Acceso remoto →
              <em>"Permitir conexiones de equipos con cualquier versión de Escritorio remoto"</em>.
            </span>
          </div>

          <div class="rdpc-form-row">
            <label>Host / IP</label>
            <input v-model="form.host" placeholder="e.g. 54.1.2.3" class="rdpc-input" />
          </div>
          <div class="rdpc-form-row">
            <label>Puerto</label>
            <input v-model.number="form.port" type="number" min="1" max="65535" class="rdpc-input" style="width:80px" />
          </div>
          <div class="rdpc-form-row">
            <label>Usuario</label>
            <input v-model="form.user" placeholder="Administrator" class="rdpc-input" style="width:200px" />
          </div>
          <div class="rdpc-form-row">
            <label>Contraseña</label>
            <input v-model="form.password" type="password" placeholder="Contraseña de Windows" class="rdpc-input" style="width:240px" />
          </div>
          <div class="rdpc-form-row">
            <label>Dominio</label>
            <input v-model="form.domain" placeholder="(opcional)" class="rdpc-input" style="width:180px" />
          </div>
          <div class="rdpc-form-row">
            <label>Resolución</label>
            <select v-model="form.resolution" class="rdpc-select">
              <option value="1024x768">1024 × 768</option>
              <option value="1280x800">1280 × 800</option>
              <option value="1366x768">1366 × 768</option>
              <option value="1600x900">1600 × 900</option>
              <option value="1920x1080">1920 × 1080</option>
            </select>
          </div>

          <div class="rdpc-form-actions">
            <button class="btn" @click="connect" :disabled="!form.host || !form.password">Conectar</button>
            <button class="btn btn-ghost" @click="$emit('close')">Cancelar</button>
            <button class="btn btn-ghost" @click="downloadRdpFile" :disabled="!form.host">⬇ Archivo .rdp</button>
          </div>
        </div>

        <!-- Canvas area -->
        <div v-show="sessionStatus !== 'disconnected'" class="rdpc-canvas-wrap">

          <!-- Toolbar -->
          <div class="rdpc-toolbar">
            <span class="rdpc-conn-info">{{ form.user }}@{{ form.host }}:{{ form.port }}</span>
            <div class="rdpc-toolbar-btns">
              <button v-if="sessionStatus === 'connected'" class="rdpc-tbtn" @click="sendCtrlAltDel" title="Enviar Ctrl+Alt+Del">
                ⌨ Ctrl+Alt+Del
              </button>
              <button v-if="sessionStatus === 'connected'" class="rdpc-tbtn" @click="sendWinKey" title="Tecla Windows">
                ⊞ Win
              </button>
              <span v-if="sessionStatus === 'connecting'" class="rdpc-conn-info">Conectando...</span>
              <button v-if="sessionStatus === 'ended'" class="rdpc-tbtn accent" @click="connect">↺ Reconectar</button>
              <button v-else-if="sessionStatus === 'connected'" class="rdpc-tbtn" @click="disconnect">Desconectar</button>
            </div>
          </div>

          <!-- Canvas container -->
          <div class="rdpc-canvas-container" ref="containerRef">
            <canvas
              ref="canvasRef"
              class="rdpc-canvas"
              :width="canvasW"
              :height="canvasH"
              tabindex="0"
              @mousemove="onMouseMove"
              @mousedown="onMouseDown"
              @mouseup="onMouseUp"
              @contextmenu.prevent
              @keydown="onKeyDown"
              @keyup="onKeyUp"
              @wheel.prevent="onWheel"
            ></canvas>

            <!-- Overlay states -->
            <div v-if="sessionStatus === 'connecting'" class="rdpc-overlay">
              <div class="rdpc-overlay-content">
                <div class="rdpc-spinner"></div>
                <span>Conectando a {{ form.host }}...</span>
              </div>
            </div>
            <div v-if="sessionStatus === 'ended'" class="rdpc-overlay rdpc-overlay-ended">
              <div class="rdpc-overlay-content">
                <span style="font-size:2rem">🔌</span>
                <span>{{ errorMsg || 'Sesión terminada' }}</span>
                <div style="display:flex;gap:8px">
                  <button class="btn" @click="connect">↺ Reconectar</button>
                  <button class="btn btn-ghost" @click="sessionStatus = 'disconnected'">← Formulario</button>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted, markRaw } from 'vue'

const props = defineProps({
  open:     { type: Boolean, default: false },
  instance: { type: Object,  default: null  },
})
defineEmits(['close'])

// ── Refs ──────────────────────────────────────────────────────────────────────
const canvasRef    = ref(null)
const containerRef = ref(null)
const ws           = ref(null)
const sessionStatus = ref('disconnected')  // disconnected | connecting | connected | ended
const errorMsg     = ref('')
const isFullscreen = ref(false)
const canvasW      = ref(1280)
const canvasH      = ref(800)
const connectedHost = ref('')

const form = ref({
  host:       '',
  port:       3389,
  user:       'Administrator',
  password:   '',
  domain:     '',
  resolution: '1280x800',
})

// ── Watchers ──────────────────────────────────────────────────────────────────
watch(() => props.open, val => {
  if (val && props.instance) {
    form.value.host = props.instance.publicIp || props.instance.privateIp || ''
    sessionStatus.value = 'disconnected'
    errorMsg.value = ''
  } else if (!val) {
    disconnectWs()
  }
})

// ── Computed ──────────────────────────────────────────────────────────────────
const statusLabel = computed(() => ({
  disconnected: 'Desconectado',
  connecting:   'Conectando...',
  connected:    'Conectado',
  ended:        'Sesión terminada',
})[sessionStatus.value] || sessionStatus.value)

// ── WS URL ────────────────────────────────────────────────────────────────────
function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}

// ── Connection ────────────────────────────────────────────────────────────────
function connect() {
  disconnectWs()
  errorMsg.value = ''
  sessionStatus.value = 'connecting'

  const [w, h] = form.value.resolution.split('x').map(Number)
  canvasW.value = w
  canvasH.value = h

  const sock = markRaw(new WebSocket(wsUrl('/ws/ec2-rdp')))
  ws.value = sock

  sock.addEventListener('open', () => {
    sock.send(JSON.stringify({
      action:   'connect',
      host:     form.value.host,
      port:     form.value.port || 3389,
      user:     form.value.user || 'Administrator',
      password: form.value.password,
      domain:   form.value.domain || '',
      width:    w,
      height:   h,
    }))
  })

  sock.addEventListener('message', e => {
    let msg
    try { msg = JSON.parse(e.data) } catch (_) { return }

    if (msg.type === 'connected') {
      sessionStatus.value = 'connected'
      connectedHost.value = form.value.host
      nextTick(() => canvasRef.value?.focus())
    } else if (msg.type === 'bitmap') {
      renderBitmap(msg)
    } else if (msg.type === 'error') {
      errorMsg.value = msg.data || 'Error de conexión'
      sessionStatus.value = 'ended'
    } else if (msg.type === 'done') {
      if (sessionStatus.value === 'connected') {
        errorMsg.value = ''
      }
      sessionStatus.value = 'ended'
    }
  })

  sock.addEventListener('close', () => {
    if (sessionStatus.value === 'connecting' || sessionStatus.value === 'connected') {
      if (!errorMsg.value) errorMsg.value = 'Conexión cerrada inesperadamente'
      sessionStatus.value = 'ended'
    }
  })

  sock.addEventListener('error', () => {
    errorMsg.value = 'Error de WebSocket'
    sessionStatus.value = 'ended'
  })
}

function disconnectWs() {
  if (ws.value) {
    try { ws.value.send(JSON.stringify({ action: 'stop' })); ws.value.close() } catch (_) {}
    ws.value = null
  }
}

function disconnect() {
  disconnectWs()
  sessionStatus.value = 'disconnected'
}

function onBackdropClick() {
  if (!isFullscreen.value) return  // only close if NOT fullscreen
}

// ── Bitmap rendering ──────────────────────────────────────────────────────────
// RDP bitmaps are in bottom-up order. We convert them to RGBA top-down for canvas.
function renderBitmap({ x, y, w, h, bpp, data: b64 }) {
  const cv = canvasRef.value
  if (!cv || !w || !h) return
  const ctx = cv.getContext('2d')
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const img = ctx.createImageData(w, h)
  const dst = img.data

  if (bpp === 16) {
    // RGB565 → RGBA, bottom-up rows
    for (let row = 0; row < h; row++) {
      const srcRow = h - 1 - row
      for (let col = 0; col < w; col++) {
        const si = (srcRow * w + col) * 2
        const di = (row * w + col) * 4
        const px = raw[si] | (raw[si + 1] << 8)
        dst[di]     = ((px >> 11) & 0x1f) * 255 / 31 | 0   // R
        dst[di + 1] = ((px >>  5) & 0x3f) * 255 / 63 | 0   // G
        dst[di + 2] =  (px & 0x1f)        * 255 / 31 | 0   // B
        dst[di + 3] = 255
      }
    }
  } else if (bpp === 24) {
    // BGR → RGBA, bottom-up rows
    for (let row = 0; row < h; row++) {
      const srcRow = h - 1 - row
      for (let col = 0; col < w; col++) {
        const si = (srcRow * w + col) * 3
        const di = (row * w + col) * 4
        dst[di]     = raw[si + 2]   // R
        dst[di + 1] = raw[si + 1]   // G
        dst[di + 2] = raw[si]       // B
        dst[di + 3] = 255
      }
    }
  } else if (bpp === 32) {
    // BGRA → RGBA, bottom-up rows
    for (let row = 0; row < h; row++) {
      const srcRow = h - 1 - row
      for (let col = 0; col < w; col++) {
        const si = (srcRow * w + col) * 4
        const di = (row * w + col) * 4
        dst[di]     = raw[si + 2]   // R
        dst[di + 1] = raw[si + 1]   // G
        dst[di + 2] = raw[si]       // B
        dst[di + 3] = 255
      }
    }
  } else {
    // Fallback: assume RGBA straight
    dst.set(raw.subarray(0, dst.length))
  }

  ctx.putImageData(img, x, y)
}

// ── Mouse events ──────────────────────────────────────────────────────────────
function canvasPos(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: Math.round((e.clientX - rect.left) * (canvasW.value / rect.width)),
    y: Math.round((e.clientY - rect.top)  * (canvasH.value / rect.height)),
  }
}

function sendMouse(e, isDown, button) {
  if (!ws.value || sessionStatus.value !== 'connected') return
  const { x, y } = canvasPos(e)
  ws.value.send(JSON.stringify({ action: 'mouse', x, y, button: button ?? 0, isDown: !!isDown }))
}

function onMouseMove(e)  { sendMouse(e, false, 0) }
function onMouseDown(e)  { canvasRef.value?.focus(); sendMouse(e, true,  e.button === 2 ? 2 : e.button === 1 ? 4 : 1) }
function onMouseUp(e)    { sendMouse(e, false, e.button === 2 ? 2 : e.button === 1 ? 4 : 1) }
function onWheel(e) {
  if (!ws.value || sessionStatus.value !== 'connected') return
  const { x, y } = canvasPos(e)
  const button = e.deltaY < 0 ? 8 : 16  // RDP wheel up/down flags
  ws.value.send(JSON.stringify({ action: 'mouse', x, y, button, isDown: true }))
}

// ── Keyboard events (scan codes) ──────────────────────────────────────────────
// Maps DOM KeyboardEvent.code → RDP scan code
const SCAN = {
  Escape:0x01, Backquote:0x29,
  Digit1:0x02, Digit2:0x03, Digit3:0x04, Digit4:0x05, Digit5:0x06,
  Digit6:0x07, Digit7:0x08, Digit8:0x09, Digit9:0x0a, Digit0:0x0b,
  Minus:0x0c, Equal:0x0d, Backspace:0x0e, Tab:0x0f,
  KeyQ:0x10, KeyW:0x11, KeyE:0x12, KeyR:0x13, KeyT:0x14,
  KeyY:0x15, KeyU:0x16, KeyI:0x17, KeyO:0x18, KeyP:0x19,
  BracketLeft:0x1a, BracketRight:0x1b, Enter:0x1c,
  ControlLeft:0x1d, ControlRight:0x1d,
  KeyA:0x1e, KeyS:0x1f, KeyD:0x20, KeyF:0x21, KeyG:0x22,
  KeyH:0x23, KeyJ:0x24, KeyK:0x25, KeyL:0x26,
  Semicolon:0x27, Quote:0x28, Backslash:0x2b,
  ShiftLeft:0x2a, ShiftRight:0x36,
  KeyZ:0x2c, KeyX:0x2d, KeyC:0x2e, KeyV:0x2f,
  KeyB:0x30, KeyN:0x31, KeyM:0x32, Comma:0x33, Period:0x34, Slash:0x35,
  AltLeft:0x38, AltRight:0x38, Space:0x39, CapsLock:0x3a,
  F1:0x3b, F2:0x3c, F3:0x3d, F4:0x3e, F5:0x3f, F6:0x40,
  F7:0x41, F8:0x42, F9:0x43, F10:0x44, F11:0x57, F12:0x58,
  NumLock:0x45, ScrollLock:0x46,
  Numpad7:0x47, Numpad8:0x48, Numpad9:0x49,
  NumpadSubtract:0x4a, Numpad4:0x4b, Numpad5:0x4c, Numpad6:0x4d,
  NumpadAdd:0x4e, Numpad1:0x4f, Numpad2:0x50, Numpad3:0x51,
  Numpad0:0x52, NumpadDecimal:0x53,
  // Extended keys (will set extended flag)
  Insert:0x52, Delete:0x53, Home:0x47, End:0x4f,
  PageUp:0x49, PageDown:0x51,
  ArrowLeft:0x4b, ArrowRight:0x4d, ArrowUp:0x48, ArrowDown:0x50,
  NumpadEnter:0x1c, NumpadDivide:0x35,
  PrintScreen:0x37, Pause:0x45,
  MetaLeft:0x5b, MetaRight:0x5c,
}

const EXTENDED_KEYS = new Set([
  'Insert','Delete','Home','End','PageUp','PageDown',
  'ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
  'NumpadEnter','NumpadDivide','ControlRight','AltRight',
  'MetaLeft','MetaRight','PrintScreen',
])

function sendKey(code, isDown) {
  if (!ws.value || sessionStatus.value !== 'connected') return
  const scanCode = SCAN[code]
  if (scanCode === undefined) return
  ws.value.send(JSON.stringify({
    action:   'key',
    code:     scanCode,
    isDown:   !!isDown,
    extended: EXTENDED_KEYS.has(code),
  }))
}

function onKeyDown(e) {
  e.preventDefault()
  sendKey(e.code, true)
}
function onKeyUp(e) {
  e.preventDefault()
  sendKey(e.code, false)
}

// ── Special key combos ────────────────────────────────────────────────────────
function sendScanSeq(seq) {
  if (!ws.value) return
  seq.forEach(msg => ws.value.send(JSON.stringify({ action: 'key', ...msg })))
}

function sendCtrlAltDel() {
  sendScanSeq([
    { code: 0x1d, isDown: true  },               // Ctrl down
    { code: 0x38, isDown: true  },               // Alt down
    { code: 0x53, isDown: true,  extended: true },// Del down
    { code: 0x53, isDown: false, extended: true },// Del up
    { code: 0x38, isDown: false },               // Alt up
    { code: 0x1d, isDown: false },               // Ctrl up
  ])
}

function sendWinKey() {
  sendScanSeq([
    { code: 0x5b, isDown: true,  extended: true },
    { code: 0x5b, isDown: false, extended: true },
  ])
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  nextTick(() => canvasRef.value?.focus())
}

// ── Download .rdp file ────────────────────────────────────────────────────────
function downloadRdpFile() {
  const h    = form.value.host
  const name = props.instance?.name || props.instance?.id || 'ec2'
  const content = [
    `full address:s:${h}:${form.value.port || 3389}`,
    `username:s:${form.value.user || 'Administrator'}`,
    'prompt for credentials:i:1',
    'screen mode id:i:2',
    'use multimon:i:0',
    'desktopwidth:i:' + (form.value.resolution.split('x')[0] || 1280),
    'desktopheight:i:' + (form.value.resolution.split('x')[1] || 800),
    'session bpp:i:32',
    'compression:i:1',
    'keyboardhook:i:2',
    'connection type:i:7',
    'networkautodetect:i:1',
    'bandwidthautodetect:i:1',
    'displayconnectionbar:i:1',
  ].join('\r\n')

  const blob = new Blob([content], { type: 'application/x-rdp' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `${name}.rdp`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

onUnmounted(() => disconnectWs())
</script>

<style scoped>
.rdpc-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 900;
}
.rdpc-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(96vw, 1000px);
  max-height: 92vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
  transition: all .2s;
}
.rdpc-modal.fullscreen {
  position: fixed; inset: 0;
  width: 100vw; max-height: 100vh;
  border-radius: 0;
  z-index: 1000;
}

/* Header */
.rdpc-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  gap: 8px; flex-shrink: 0;
}
.rdpc-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; color: #e6edf3; font-size: 0.95rem;
}
.rdpc-host-badge {
  background: rgba(88,166,255,.15); color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 4px; padding: 1px 7px;
  font-size: 0.78rem; font-family: monospace;
}
.rdpc-hdr-right { display: flex; align-items: center; gap: 8px; }
.rdpc-status {
  font-size: 0.78rem; padding: 2px 8px;
  border-radius: 12px; font-weight: 500;
}
.rdpc-status.disconnected { background: rgba(139,148,158,.2); color: #8b949e; }
.rdpc-status.connecting   { background: rgba(210,153,34,.2);  color: #d29922; }
.rdpc-status.connected    { background: rgba(63,185,80,.2);   color: #3fb950; }
.rdpc-status.ended        { background: rgba(248,81,73,.2);   color: #f85149; }
.rdpc-close {
  background: none; border: none; color: #8b949e;
  cursor: pointer; font-size: 1rem; padding: 2px 4px; border-radius: 4px;
}
.rdpc-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Form */
.rdpc-form {
  padding: 18px 24px;
  display: flex; flex-direction: column; gap: 10px;
  overflow-y: auto;
}
.rdpc-notice {
  background: rgba(210,153,34,.1);
  border: 1px solid rgba(210,153,34,.3);
  border-left: 3px solid #d29922;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 0.82rem;
  color: #e6edf3;
  line-height: 1.5;
}
.rdpc-notice-sub { color: #8b949e; font-size: 0.8rem; }
.rdpc-form-row {
  display: flex; align-items: center; gap: 12px;
}
.rdpc-form-row label {
  color: #8b949e; font-size: 0.85rem;
  min-width: 100px; text-align: right;
}
.rdpc-input {
  background: #161b22;
  border: 1px solid #30363d;
  color: #e6edf3;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.87rem;
  font-family: monospace;
  width: 260px;
  outline: none;
  transition: border-color .15s;
}
.rdpc-input:focus { border-color: #388bfd; }
.rdpc-select {
  background: #161b22;
  border: 1px solid #30363d;
  color: #e6edf3;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.87rem;
  outline: none;
}
.rdpc-form-actions {
  display: flex; gap: 10px;
  padding-top: 6px;
  margin-left: 112px;
}

/* Canvas */
.rdpc-canvas-wrap {
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.rdpc-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 12px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  font-size: 0.78rem; gap: 8px; flex-shrink: 0;
}
.rdpc-conn-info { color: #58a6ff; font-family: monospace; font-size: 0.8rem; }
.rdpc-toolbar-btns { display: flex; gap: 6px; align-items: center; }
.rdpc-tbtn {
  background: rgba(139,148,158,.12);
  border: 1px solid #30363d;
  color: #8b949e;
  border-radius: 4px;
  padding: 2px 9px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all .15s;
}
.rdpc-tbtn:hover { background: rgba(255,255,255,.08); color: #e6edf3; }
.rdpc-tbtn.accent { background: rgba(63,185,80,.15); border-color: #3fb950; color: #3fb950; }

.rdpc-canvas-container {
  flex: 1; min-height: 0;
  display: flex; align-items: center; justify-content: center;
  background: #000;
  position: relative;
  overflow: auto;
}
.rdpc-canvas {
  display: block;
  cursor: default;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.rdpc-canvas:focus { outline: none; }

/* Overlays */
.rdpc-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.7);
  display: flex; align-items: center; justify-content: center;
}
.rdpc-overlay-ended { background: rgba(0,0,0,.8); }
.rdpc-overlay-content {
  display: flex; flex-direction: column;
  align-items: center; gap: 16px;
  color: #e6edf3; font-size: 0.9rem;
  text-align: center;
}
.rdpc-spinner {
  width: 32px; height: 32px;
  border: 3px solid #30363d;
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Buttons */
.btn {
  background: rgba(88,166,255,.15);
  border: 1px solid rgba(88,166,255,.4);
  color: #58a6ff;
  border-radius: 6px; padding: 6px 16px;
  font-size: 0.87rem; cursor: pointer;
  transition: all .15s;
}
.btn:hover { background: rgba(88,166,255,.25); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn-ghost {
  background: transparent;
  border-color: #30363d; color: #8b949e;
}
.btn-ghost:hover { color: #e6edf3; background: rgba(255,255,255,.05); }
</style>

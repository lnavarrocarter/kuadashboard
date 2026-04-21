<template>
  <Teleport to="body">
    <div v-if="open" class="rdp-backdrop" @mousedown.self="$emit('close')">
      <div class="rdp-modal">

        <!-- Header -->
        <div class="rdp-header">
          <div class="rdp-title">
            <span class="rdp-icon">🪟</span>
            <span>RDP — {{ instance?.name || instance?.id }}</span>
            <span v-if="host" class="rdp-host-badge">{{ host }}</span>
            <span class="rdp-os-badge">Windows</span>
          </div>
          <button class="rdp-close" @click="$emit('close')">&#x2715;</button>
        </div>

        <!-- Body -->
        <div class="rdp-body">

          <!-- Connection details card -->
          <div class="rdp-card">
            <div class="rdp-card-title">🔌 Datos de conexión</div>
            <div class="rdp-row">
              <span class="rdp-label">Host / IP</span>
              <span class="rdp-value mono">{{ host || '—' }}</span>
              <button v-if="host" class="rdp-copy-btn" @click="copy(host)" :class="{ copied: copied === 'host' }">
                {{ copied === 'host' ? '✓' : 'Copiar' }}
              </button>
            </div>
            <div class="rdp-row">
              <span class="rdp-label">Puerto</span>
              <span class="rdp-value mono">3389</span>
            </div>
            <div class="rdp-row">
              <span class="rdp-label">Usuario</span>
              <span class="rdp-value mono">Administrator</span>
              <button class="rdp-copy-btn" @click="copy('Administrator')" :class="{ copied: copied === 'Administrator' }">
                {{ copied === 'Administrator' ? '✓' : 'Copiar' }}
              </button>
            </div>
          </div>

          <!-- Password retrieval -->
          <div class="rdp-card">
            <div class="rdp-card-title">🔑 Obtener contraseña de Windows</div>
            <p class="rdp-hint">
              AWS genera una contraseña temporal cifrada con tu PEM. Necesitas descifrarla con la AWS CLI:
            </p>
            <div class="rdp-code-block">
              <code>aws ec2 get-password-data \<br>
&nbsp;&nbsp;--instance-id {{ instance?.id || '&lt;instance-id&gt;' }} \<br>
&nbsp;&nbsp;--priv-launch-key /ruta/a/tu/key.pem \<br>
&nbsp;&nbsp;{{ profileArg }}</code>
            </div>
            <button class="rdp-copy-btn wide" @click="copyCmd" :class="{ copied: copied === 'cmd' }">
              {{ copied === 'cmd' ? '✓ Copiado' : '📋 Copiar comando' }}
            </button>
          </div>

          <!-- How to connect -->
          <div class="rdp-card">
            <div class="rdp-card-title">🚀 Cómo conectarse</div>
            <div class="rdp-steps">
              <div class="rdp-step">
                <span class="rdp-step-num">1</span>
                <span>Ejecuta el comando de arriba para obtener la contraseña.</span>
              </div>
              <div class="rdp-step">
                <span class="rdp-step-num">2</span>
                <span>
                  Abre tu cliente RDP:
                  <strong>macOS</strong>: Microsoft Remote Desktop (App Store) ·
                  <strong>Linux</strong>: Remmina o FreeRDP ·
                  <strong>Windows</strong>: mstsc.exe
                </span>
              </div>
              <div class="rdp-step">
                <span class="rdp-step-num">3</span>
                <span>Introduce el host <code>{{ host || '&lt;IP&gt;' }}</code>, usuario <code>Administrator</code> y la contraseña obtenida.</span>
              </div>
              <div class="rdp-step rdp-step-tip">
                <span class="rdp-step-num">💡</span>
                <span>Asegúrate de que el Security Group permite tráfico entrante en el puerto <strong>3389 (TCP)</strong> desde tu IP.</span>
              </div>
            </div>
          </div>

          <!-- Quick open RDP file (macOS / Windows) -->
          <div v-if="host" class="rdp-card rdp-card-action">
            <div class="rdp-card-title">⚡ Acceso rápido</div>
            <p class="rdp-hint">Descarga un archivo <code>.rdp</code> listo para abrir con tu cliente RDP.</p>
            <button class="rdp-dl-btn" @click="downloadRdpFile">
              ⬇ Descargar archivo .rdp
            </button>
          </div>

        </div>

        <!-- Footer -->
        <div class="rdp-footer">
          <button class="btn btn-ghost" @click="$emit('close')">Cerrar</button>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  open:     { type: Boolean, default: false },
  instance: { type: Object,  default: null  },
})
defineEmits(['close'])

const copied = ref('')

const host = computed(() =>
  props.instance?.publicIp || props.instance?.privateIp || ''
)

const profileArg = computed(() => {
  // If we can infer profile from the store we'd pass it, for now show placeholder
  return '--profile &lt;tu-perfil&gt;'
})

function copy(text) {
  navigator.clipboard?.writeText(text)
  copied.value = text
  setTimeout(() => { copied.value = '' }, 1500)
}

const rawCmd = computed(() =>
  `aws ec2 get-password-data \\\n  --instance-id ${props.instance?.id || '<instance-id>'} \\\n  --priv-launch-key /ruta/a/tu/key.pem`
)

function copyCmd() {
  navigator.clipboard?.writeText(rawCmd.value)
  copied.value = 'cmd'
  setTimeout(() => { copied.value = '' }, 1500)
}

function downloadRdpFile() {
  const h = host.value
  if (!h) return
  const name = props.instance?.name || props.instance?.id || 'ec2'
  const content = [
    'full address:s:' + h + ':3389',
    'username:s:Administrator',
    'prompt for credentials:i:1',
    'screen mode id:i:2',
    'use multimon:i:0',
    'desktopwidth:i:1920',
    'desktopheight:i:1080',
    'session bpp:i:32',
    'compression:i:1',
    'keyboardhook:i:2',
    'audiocapturemode:i:0',
    'videoplaybackmode:i:1',
    'connection type:i:7',
    'networkautodetect:i:1',
    'bandwidthautodetect:i:1',
    'displayconnectionbar:i:1',
    'enableworkspacereconnect:i:0',
    'disable wallpaper:i:0',
    'allow font smoothing:i:0',
    'allow desktop composition:i:0',
    'disable full window drag:i:1',
    'disable menu anims:i:1',
    'disable themes:i:0',
    'disable cursor setting:i:0',
    'bitmapcachepersistenable:i:1',
  ].join('\r\n')

  const blob = new Blob([content], { type: 'application/x-rdp' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${name}.rdp`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.rdp-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 900;
}
.rdp-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(92vw, 700px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
}

/* Header */
.rdp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  gap: 8px;
}
.rdp-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #e6edf3;
  font-size: 0.95rem;
}
.rdp-icon { font-size: 1.1rem; }
.rdp-host-badge {
  background: rgba(88,166,255,.15);
  color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 0.78rem;
  font-family: monospace;
}
.rdp-os-badge {
  background: rgba(0,120,212,.2);
  color: #58a6ff;
  border: 1px solid rgba(0,120,212,.4);
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 0.72rem;
  font-weight: 500;
}
.rdp-close {
  background: none;
  border: none;
  color: #8b949e;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 4px;
  border-radius: 4px;
}
.rdp-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Body */
.rdp-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rdp-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rdp-card-title {
  font-weight: 600;
  font-size: 0.88rem;
  color: #e6edf3;
  margin-bottom: 2px;
}
.rdp-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rdp-label {
  color: #8b949e;
  font-size: 0.82rem;
  min-width: 80px;
}
.rdp-value {
  color: #e6edf3;
  font-size: 0.87rem;
  flex: 1;
}
.rdp-value.mono { font-family: monospace; }
.rdp-hint {
  color: #8b949e;
  font-size: 0.82rem;
  line-height: 1.5;
  margin: 0;
}
.rdp-hint code {
  background: rgba(255,255,255,.07);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 0.8rem;
  color: #79c0ff;
}
.rdp-code-block {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 10px 14px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 0.8rem;
  color: #79c0ff;
  line-height: 1.7;
}
.rdp-copy-btn {
  background: rgba(139,148,158,.12);
  border: 1px solid #30363d;
  color: #8b949e;
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all .15s;
  white-space: nowrap;
}
.rdp-copy-btn:hover { background: rgba(255,255,255,.08); color: #e6edf3; }
.rdp-copy-btn.copied { border-color: #3fb950; color: #3fb950; background: rgba(63,185,80,.1); }
.rdp-copy-btn.wide {
  align-self: flex-start;
  padding: 4px 14px;
  font-size: 0.8rem;
}

/* Steps */
.rdp-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rdp-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #c9d1d9;
  font-size: 0.83rem;
  line-height: 1.5;
}
.rdp-step code {
  background: rgba(255,255,255,.07);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 0.79rem;
  color: #79c0ff;
}
.rdp-step-num {
  background: rgba(88,166,255,.15);
  color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}
.rdp-step-tip .rdp-step-num {
  background: rgba(210,153,34,.15);
  color: #d29922;
  border-color: rgba(210,153,34,.3);
}

/* Action card */
.rdp-card-action { border-color: rgba(88,166,255,.25); }
.rdp-dl-btn {
  align-self: flex-start;
  background: rgba(88,166,255,.15);
  border: 1px solid rgba(88,166,255,.4);
  color: #58a6ff;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 0.87rem;
  cursor: pointer;
  transition: all .15s;
}
.rdp-dl-btn:hover { background: rgba(88,166,255,.25); }

/* Footer */
.rdp-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  background: #161b22;
  border-top: 1px solid #21262d;
}
.btn {
  background: rgba(88,166,255,.15);
  border: 1px solid rgba(88,166,255,.4);
  color: #58a6ff;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 0.87rem;
  cursor: pointer;
  transition: all .15s;
}
.btn-ghost {
  background: transparent;
  border-color: #30363d;
  color: #8b949e;
}
.btn-ghost:hover { color: #e6edf3; background: rgba(255,255,255,.05); }
</style>

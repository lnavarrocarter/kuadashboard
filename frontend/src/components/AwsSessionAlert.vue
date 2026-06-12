<template>
  <Teleport to="body">
    <div v-if="visibleProfiles.length" class="sso-alert">
      <div class="sso-alert-title">⚠ Sesiones temporales de AWS</div>
      <div v-for="p in visibleProfiles" :key="p.id" class="sso-alert-row">
        <div style="min-width:0">
          <div class="sso-alert-name">{{ p.name }}</div>
          <div class="sso-alert-status" :class="{ expired: isExpired(p) }">
            {{ isExpired(p) ? 'Sesión expirada' : `Expira en ${remainingLabel(p)}` }}
          </div>
        </div>
        <button class="btn sm primary" :disabled="renewingId === p.id" @click="renew(p)">
          {{ renewingId === p.id ? 'Esperando login…' : '↻ Renovar sesión' }}
        </button>
      </div>
      <div v-if="error" class="sso-alert-error">{{ error }}</div>
      <button class="sso-alert-snooze" @click="snooze">Recordar en 30 min</button>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useEnvStore } from '../stores/useEnvStore'
import { useAwsSso }   from '../composables/useAwsSso.js'

const WARN_MS    = 15 * 60 * 1000   // alert when less than 15 minutes remain
const SNOOZE_MS  = 30 * 60 * 1000

const envStore    = useEnvStore()
const sso         = useAwsSso()
const now         = ref(Date.now())
const renewingId  = ref(null)
const error       = ref('')
const snoozeUntil = ref(0)

let tick = null
let refreshTimer = null

onMounted(() => {
  if (!envStore.profiles.length) envStore.fetchProfiles()
  tick         = setInterval(() => { now.value = Date.now() }, 30_000)
  refreshTimer = setInterval(() => envStore.fetchProfiles(), 5 * 60_000)
})
onUnmounted(() => { clearInterval(tick); clearInterval(refreshTimer); sso.reset() })

const visibleProfiles = computed(() => {
  if (now.value < snoozeUntil.value) return []
  return envStore.profiles.filter(p =>
    p.provider === 'aws' &&
    p.meta?.__sso?.expiresAt &&
    p.meta.__sso.expiresAt - now.value < WARN_MS
  )
})

const isExpired = p => p.meta.__sso.expiresAt <= now.value

function remainingLabel(p) {
  const mins = Math.max(0, Math.round((p.meta.__sso.expiresAt - now.value) / 60000))
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
}

function snooze() { snoozeUntil.value = Date.now() + SNOOZE_MS }

async function renew(p) {
  const cfg = p.meta.__sso
  renewingId.value = p.id
  error.value      = ''
  try {
    await sso.startLogin({ startUrl: cfg.startUrl, ssoRegion: cfg.ssoRegion })
    const creds = await sso.fetchCredentials(cfg.accountId, cfg.roleName)
    await envStore.updateProfile(p.id, {
      keys: {
        AWS_ACCESS_KEY_ID:     creds.accessKeyId,
        AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
        AWS_SESSION_TOKEN:     creds.sessionToken,
      },
      meta: { __sso: { ...cfg, expiresAt: creds.expiration } },
    })
    now.value = Date.now()   // re-evaluate visibility immediately
  } catch (e) {
    if (e.message !== 'cancelled') error.value = `${p.name}: ${e.message}`
  } finally {
    renewingId.value = null
  }
}
</script>

<style scoped>
.sso-alert {
  position: fixed;
  bottom: 18px;
  right: 18px;
  z-index: 9000;
  width: 320px;
  background: var(--bg-alt, #1e1e2e);
  border: 1px solid var(--yellow, #e0b341);
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sso-alert-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--yellow, #e0b341);
}
.sso-alert-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sso-alert-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #ddd);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sso-alert-status {
  font-size: 11px;
  color: var(--yellow, #e0b341);
}
.sso-alert-status.expired {
  color: var(--red, #e05c5c);
  font-weight: 600;
}
.sso-alert-error {
  font-size: 11px;
  color: var(--red, #e05c5c);
}
.sso-alert-snooze {
  align-self: flex-end;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-dim, #888);
  text-decoration: underline;
  padding: 0;
}
.sso-alert-snooze:hover { color: var(--text, #ddd); }
</style>

<template>
  <section class="plugins-view" data-test="plugins-view">
    <header class="plugins-head">
      <h2>{{ t('plugins.title') }}</h2>
      <p>{{ t('plugins.hint') }}</p>
    </header>
    <p v-if="error" class="plugins-error" role="alert">{{ error }}</p>
    <p v-if="loaded && !plugins.length" class="plugins-empty">{{ t('plugins.empty') }}</p>
    <article v-for="plugin in plugins" :key="plugin.manifest.id" class="plugin-card" :data-test="`plugin-${plugin.manifest.id}`">
      <div class="plugin-top">
        <div>
          <h3>{{ plugin.manifest.name }} <small>v{{ plugin.manifest.version }}</small></h3>
          <p>{{ plugin.manifest.description }}</p>
        </div>
        <label class="plugin-switch">
          <input type="checkbox" :checked="plugin.active" :disabled="busy === plugin.manifest.id" :data-test="`plugin-toggle-${plugin.manifest.id}`" @change="toggle(plugin, $event.target.checked)" />
          <span>{{ plugin.active ? t('plugins.on') : t('plugins.off') }}</span>
        </label>
      </div>
      <p v-if="plugin.active && plugin.status" class="plugin-status" :class="plugin.status.state" data-test="plugin-status">
        {{ t(`plugins.state.${plugin.status.state}`) }}<template v-if="plugin.status.detail"> · {{ plugin.status.detail }}</template>
      </p>
      <dl>
        <dt>{{ t('plugins.capabilities') }}</dt>
        <dd>{{ capabilities(plugin) || '—' }}</dd>
        <dt>{{ t('plugins.reads') }}</dt>
        <dd>{{ plugin.manifest.reads.join(' · ') || '—' }}</dd>
        <dt>{{ t('plugins.cost') }}</dt>
        <dd>{{ t(`plugins.costLevel.${plugin.manifest.cost.level}`) }} — {{ plugin.manifest.cost.summary }}</dd>
        <template v-if="plugin.manifest.credentialFields.length">
          <dt>{{ t('plugins.credentials') }}</dt>
          <dd>{{ plugin.manifest.credentialFields.map(field => field.name).join(', ') }}</dd>
        </template>
      </dl>
    </article>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'
import { refreshProviders } from '../composables/useProviders'

// Plugins/Connections (#193): what each first-party plugin reads and costs, and whether it is on.
const { t } = useI18n()
const plugins = ref([])
const loaded = ref(false)
const busy = ref('')
const error = ref('')

const capabilities = plugin => Object.entries(plugin.manifest.capabilities).filter(([, on]) => on).map(([name]) => t(`plugins.capability.${name}`)).join(' · ')

async function load() {
  try { plugins.value = (await api('GET', '/api/plugins'))?.plugins || [] } catch (e) { error.value = e.message } finally { loaded.value = true }
}

async function toggle(plugin, active) {
  busy.value = plugin.manifest.id
  error.value = ''
  // The top bar follows at once: a provider of a plugin turned off leaves it.
  try { await api('PUT', `/api/plugins/${encodeURIComponent(plugin.manifest.id)}`, { active }); await Promise.all([load(), refreshProviders()]) } catch (e) { error.value = e.message; await load() } finally { busy.value = '' }
}

onMounted(load)
</script>

<style scoped>
.plugins-view { padding: 24px; max-width: 880px; margin: 0 auto; display: grid; gap: 14px; align-content: start; overflow: auto; }
.plugins-head h2 { margin: 0 0 4px; font-size: 18px; }
.plugins-head p, .plugin-top p, .plugins-empty { margin: 0; color: var(--text-dim); font-size: 13px; }
.plugin-card { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: grid; gap: 10px; }
.plugin-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.plugin-top h3 { margin: 0 0 4px; font-size: 15px; }
.plugin-top small { color: var(--text-dim); font-weight: 400; }
.plugin-switch { display: inline-flex; gap: 8px; align-items: center; font-size: 12px; cursor: pointer; white-space: nowrap; }
.plugin-status { margin: 0; font-size: 12px; }
.plugin-status.connected { color: var(--green); }
.plugin-status.unavailable { color: var(--yellow); }
dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 12px; }
dt { color: var(--text-dim); }
dd { margin: 0; }
.plugins-error { color: var(--red); font-size: 13px; margin: 0; }
</style>

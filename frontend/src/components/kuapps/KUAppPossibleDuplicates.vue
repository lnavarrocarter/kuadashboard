<template>
  <div v-if="groups.length" class="kuapps-review-group kpd" data-test="possible-duplicates">
    <div class="kuapps-review-group-heading"><strong>{{ t('kuapps.duplicates.title') }}</strong><span>{{ groups.length }}</span></div>
    <p class="kpd-hint">{{ t('kuapps.duplicates.hint') }}</p>
    <article v-for="group in groups" :key="`${group.provider}:${group.resourceType}:${group.nativeIdentifier}`" class="kpd-group">
      <code :title="group.nativeIdentifier">{{ group.nativeIdentifier }}</code>
      <ul>
        <li v-for="resource in group.resources" :key="resource.id">
          <button class="kpd-resource" @click="$emit('select-resource', resource.id)">
            <strong>{{ resource.displayName }}</strong>
            <small>{{ resource.scopeId ? [resource.scopeId, resource.location].filter(Boolean).join(' · ') : t('kuapps.duplicates.noAccount') }} · {{ (resource.sources || []).map(source => t(`kuapps.source.${source}`, source)).join(', ') }}</small>
          </button>
        </li>
      </ul>
    </article>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'

// Resources with the same identifier where one has no account and KUA could not tell which
// account it belongs to (#239). Informative: a name alone never joins two resources.
const props = defineProps({ applicationId: { type: String, required: true } })
defineEmits(['select-resource'])
const { t } = useI18n()
const groups = ref([])

async function load() {
  try {
    const response = await api('GET', `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/registry/possible-duplicates`)
    groups.value = Array.isArray(response) ? response : []
  } catch { groups.value = [] }
}
watch(() => props.applicationId, load, { immediate: true })
defineExpose({ reload: load })
</script>

<style scoped>
.kpd-hint { margin: 0 0 6px; font-size: 12px; color: var(--text-dim); }
.kpd-group { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 6px; }
.kpd-group code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kpd-group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kpd-resource { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 13px; }
.kpd-resource:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.kpd-resource small { color: var(--text-dim); font-size: 12px; }
</style>

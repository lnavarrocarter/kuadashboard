<template>
  <!-- Folded, after the decisions: a count, then per group the name and how the copies differ;
       the technical identifier comes last (#239). -->
  <details v-if="groups.length" class="kuapps-review-group kpd" data-test="possible-duplicates">
    <summary class="kuapps-review-group-heading"><strong>{{ t('kuapps.duplicates.title') }}</strong><span>{{ groups.length }}</span><small class="kpd-summary-hint">{{ t('kuapps.duplicates.summary') }}</small></summary>
    <p class="kpd-hint">{{ t('kuapps.duplicates.hint') }}</p>
    <details v-for="group in groups" :key="`${group.provider}:${group.resourceType}:${group.nativeIdentifier}`" class="kpd-group">
      <summary>
        <strong>{{ group.resources[0]?.displayName || group.nativeIdentifier }}</strong>
        <small>{{ group.resourceType }} · {{ t('kuapps.duplicates.copies', { n: group.resources.length }) }} · {{ differences(group) }}</small>
      </summary>
      <ul>
        <li v-for="resource in group.resources" :key="resource.id">
          <button class="kpd-resource" @click="$emit('select-resource', resource.id)">
            <strong>{{ resource.scopeId ? [resource.scopeId, resource.location].filter(Boolean).join(' · ') : t('kuapps.duplicates.noAccount') }}</strong>
            <small>{{ (resource.sources || []).map(source => t(`kuapps.source.${source}`, source)).join(', ') }}</small>
          </button>
        </li>
      </ul>
      <code class="kpd-identifier" :title="group.nativeIdentifier">{{ group.nativeIdentifier }}</code>
    </details>
  </details>
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
// How the copies of a group differ: accounts known and unknown, and their sources.
function differences(group) {
  const accounts = new Set(group.resources.map(resource => resource.scopeId).filter(Boolean))
  const withoutAccount = group.resources.filter(resource => !resource.scopeId).length
  return t('kuapps.duplicates.differences', { accounts: accounts.size, without: withoutAccount })
}

async function load() {
  try {
    const response = await api('GET', `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/registry/possible-duplicates`)
    // Anything unexpected reads as no groups, never as a broken Review.
    groups.value = (Array.isArray(response) ? response : []).filter(group => Array.isArray(group?.resources) && group.resources.length > 1)
  } catch { groups.value = [] }
}
watch(() => props.applicationId, load, { immediate: true })
defineExpose({ reload: load })
</script>

<style scoped>
.kpd > summary { cursor: pointer; list-style: none; }
.kpd-summary-hint { flex-basis: 100%; color: var(--text-dim); font-size: 12px; font-weight: 400; }
.kpd-hint { margin: 6px 10px; font-size: 12px; color: var(--text-dim); }
.kpd-group > summary { cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.kpd-group > summary small { color: var(--text-dim); font-size: 12px; }
.kpd-identifier { color: var(--text-dim); }
.kpd-group { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin: 0 10px 6px; display: flex; flex-direction: column; gap: 6px; }
.kpd-group code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kpd-group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kpd-resource { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 13px; }
.kpd-resource:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.kpd-resource small { color: var(--text-dim); font-size: 12px; }
</style>

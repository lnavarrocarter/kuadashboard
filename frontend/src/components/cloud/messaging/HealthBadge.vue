<template>
  <span v-if="!health" class="text-dim">{{ loading ? '…' : '—' }}</span>
  <span v-else-if="list" class="hb-list">
    <span v-for="(reason, i) in health.reasons" :key="i" :class="['hb-reason', reason.level]">{{ reasonText(reason) }}</span>
    <span v-if="!health.reasons.length" class="hb-reason ok">{{ t('health.allGood') }}</span>
  </span>
  <span v-else :class="['hb', health.status]" :title="title">{{ t(`health.status_${health.status}`) }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '../../../composables/useI18n'
import { formatDuration } from './messagingFormat'

// Health from lib/awsMessagingCatalog.js: { status, reasons: [{ level, key, params }] }.
const props = defineProps({
  health: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  // Render every reason instead of a single badge (used in details).
  list: { type: Boolean, default: false },
})
const { t } = useI18n()

function reasonText(reason) {
  const params = { ...(reason.params || {}) }
  if (params.age != null) params.age = formatDuration(params.age)
  if (params.retention != null) params.retention = formatDuration(params.retention)
  return t(`health.${reason.key}`, params)
}
const title = computed(() => (props.health?.reasons || []).map(reasonText).join('\n') || t('health.allGood'))
</script>

<style>
.hb { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); white-space: nowrap; cursor: help; }
.hb.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 50%, var(--border)); }
.hb.warning { color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 55%, var(--border)); }
.hb.critical { color: var(--red); border-color: color-mix(in srgb, var(--red) 55%, var(--border)); }
.hb.unknown { color: var(--text-dim); }
.hb-list { display: flex; flex-direction: column; gap: 3px; }
.hb-reason { font-size: 12px; padding-left: 14px; position: relative; }
.hb-reason::before { content: ''; position: absolute; left: 2px; top: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); }
.hb-reason.ok::before { background: var(--green); }
.hb-reason.warning::before { background: var(--yellow); }
.hb-reason.critical::before { background: var(--red); }
.hb-reason.info { color: var(--text-dim); }
</style>

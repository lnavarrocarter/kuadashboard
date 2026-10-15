<template>
  <div class="ebs-tab" data-test="aws-ebs">
    <div class="msg-hint">{{ t('ebs.hint') }}</div>
    <div v-if="summary?.unattached" class="activity-notice ebs-unattached" data-test="ebs-unattached">
      <span>{{ t('ebs.unattachedSummary', { count: summary.unattached, gb: summary.unattachedGb, usd: formatUsd(summary.unattachedMonthlyUsd) }) }}</span>
      <button class="btn sm" :class="{ primary: onlyUnattached }" :aria-pressed="onlyUnattached" data-test="ebs-only-unattached" @click="onlyUnattached = !onlyUnattached">
        {{ onlyUnattached ? t('ebs.showAll') : t('ebs.onlyUnattached') }}
      </button>
    </div>
    <div v-if="awsStore.ebsVolumes?.truncated" class="activity-notice">{{ t('ebs.truncated') }}</div>

    <div v-if="awsStore.loading && !volumes.length" class="empty-row">{{ t('state.loading') }}</div>
    <div v-else-if="!rows.length" class="empty-row" data-test="empty-ebs">{{ search || onlyUnattached ? t('awsv.lit.noMatches') : t('ebs.empty') }}</div>
    <table v-else class="cloud-table">
      <thead><tr>
        <th v-for="column in COLUMNS" :key="column.key" :class="thClass(column.key)" :aria-sort="ariaSort(column.key)" :title="column.hint ? t(column.hint) : null">
          <button type="button" class="th-sort" @click="sortBy(column.key)">{{ t(column.label) }} <span class="sort-icon" aria-hidden="true">{{ sortIcon(column.key) }}</span></button>
        </th>
      </tr></thead>
      <tbody>
        <tr v-for="volume in sortRows(rows)" :key="volume.id" :class="{ 'ebs-row-unattached': volume.unattached }">
          <td>
            <div>{{ volume.name }}</div>
            <div v-if="volume.name !== volume.id" class="text-dim mono-xs">{{ volume.id }}</div>
          </td>
          <td>{{ volume.size != null ? `${volume.size} GiB` : '—' }}</td>
          <td class="text-dim">{{ volume.type || '—' }}<template v-if="volume.iops"> · {{ volume.iops }} IOPS</template></td>
          <td><span :class="volume.unattached ? 'status-warn' : 'text-dim'">{{ volume.unattached ? t('ebs.unattached') : volume.state }}</span></td>
          <td class="mono-xs">{{ volume.attachedTo || '—' }}</td>
          <td>
            <span v-if="volume.kubernetes?.pvc" :title="volume.kubernetes.pv || ''">{{ volume.kubernetes.namespace }}/{{ volume.kubernetes.pvc }}</span>
            <span v-else-if="volume.kubernetes?.cluster" class="text-dim">{{ volume.kubernetes.cluster }}</span>
            <span v-else class="text-dim">—</span>
          </td>
          <td class="text-dim">{{ volume.az || '—' }}</td>
          <td class="text-dim">{{ volume.encrypted ? t('ebs.yes') : t('ebs.no') }}</td>
          <td class="text-dim" style="white-space:nowrap">{{ volume.createdAt ? formatDate(volume.createdAt) : '—' }}</td>
          <td :class="volume.unattached ? 'status-warn' : ''">{{ volume.monthlyUsd != null ? formatUsd(volume.monthlyUsd) : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAwsStore } from '../../stores/useAwsStore'
import { useI18n } from '../../composables/useI18n'
import { useSortable } from '../../composables/useSortable'
import { settings } from '../../composables/useSettings'

const props = defineProps({ search: { type: String, default: '' } })
const awsStore = useAwsStore()
const { t } = useI18n()
const { sortBy, sortRows, sortIcon, thClass, ariaSort } = useSortable()
const onlyUnattached = ref(false)

const COLUMNS = [
  { key: 'name', label: 'awsv.nameId' },
  { key: 'size', label: 'ebs.size' },
  { key: 'type', label: 'th.type' },
  { key: 'state', label: 'th.state' },
  { key: 'attachedTo', label: 'ebs.attachedTo' },
  { key: 'claim', label: 'ebs.claim', hint: 'ebs.claimHint' },
  { key: 'az', label: 'ebs.az' },
  { key: 'encrypted', label: 'ebs.encrypted' },
  { key: 'createdAt', label: 'ebs.created' },
  { key: 'monthlyUsd', label: 'ebs.monthly', hint: 'ebs.monthlyHint' },
]

const volumes = computed(() => awsStore.ebsVolumes?.volumes || [])
const summary = computed(() => awsStore.ebsVolumes?.summary || null)
const rows = computed(() => {
  const query = String(props.search || '').toLowerCase()
  return volumes.value
    .filter(volume => !onlyUnattached.value || volume.unattached)
    .filter(volume => !query || JSON.stringify(volume).toLowerCase().includes(query))
    .map(volume => ({ ...volume, claim: volume.kubernetes?.pvc ? `${volume.kubernetes.namespace}/${volume.kubernetes.pvc}` : '' }))
})

function formatUsd(value) {
  return new Intl.NumberFormat(settings.lang === 'es' ? 'es-CL' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value || 0)
}
function formatDate(value) {
  return new Date(value).toLocaleDateString(settings.lang === 'es' ? 'es-CL' : 'en-US')
}
</script>

<style scoped>
.ebs-unattached { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ebs-row-unattached td:first-child { box-shadow: inset 3px 0 0 var(--warn, #d29922); }
</style>

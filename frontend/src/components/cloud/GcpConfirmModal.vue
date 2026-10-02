<template>
  <div v-if="open" class="modal-overlay" @click.self="!busy && $emit('cancel')">
    <div class="modal gcpc-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <div :class="['gcpc-header', `tone-${tone}`]">
        <span class="gcpc-icon">{{ tone === 'danger' ? '⚠' : tone === 'warning' ? '$' : 'ℹ' }}</span>
        <span :id="titleId" class="gcpc-title">{{ title }}</span>
      </div>

      <div class="gcpc-body">
        <p v-if="message" class="gcpc-message">{{ message }}</p>

        <ul v-if="lines.length" class="gcpc-lines">
          <li v-for="(line, i) in lines" :key="i">{{ line }}</li>
        </ul>

        <!-- Cost estimate -->
        <div v-if="estimateLoading" class="gcpc-estimate text-dim">{{ t('gcc.calculating') }}</div>
        <div v-else-if="estimate" :class="['gcpc-estimate', { high: estimate.highCost }]" data-test="estimate">
          <div class="gcpc-estimate-total">
            <span>{{ t('gcc.estimated') }}</span>
            <strong v-if="estimate.known">{{ t('gcc.perMonth', { usd: formatUsd(estimate.monthlyUsd) }) }}</strong>
            <strong v-else>{{ t('gcc.unknown') }}</strong>
          </div>
          <table v-if="estimate.items?.length" class="gcpc-items">
            <tr v-for="item in estimate.items" :key="item.label">
              <td>{{ item.key && t(`gcn.estimate.${item.key}`, item.params) !== `gcn.estimate.${item.key}` ? t(`gcn.estimate.${item.key}`, item.params) : item.label }}</td><td class="num">${{ formatUsd(item.monthlyUsd) }}</td>
            </tr>
          </table>
          <ul v-if="estimate.warnings?.length" class="gcpc-warnings">
            <li v-for="w in estimate.warnings" :key="w">{{ w }}</li>
          </ul>
          <div v-if="estimate.disclaimer" class="gcpc-disclaimer">{{ estimate.disclaimer }}</div>
        </div>

        <!-- Acknowledgements -->
        <label v-if="costAck && !blocked" class="gcpc-check">
          <input v-model="costAcked" type="checkbox" data-test="cost-ack" />
          {{ t('gcc.costAck') }}
        </label>
        <label v-if="costAck && estimate?.highCost" class="gcpc-check high">
          <input v-model="highCostAcked" type="checkbox" data-test="high-cost-ack" />
          {{ t('gcc.highCostAck', { usd: formatUsd(estimate.monthlyUsd) }) }}
        </label>

        <div v-if="requireName && !blocked" class="gcpc-name">
          <label :for="inputId">{{ t('gcc.typePre') }} <code>{{ requireName }}</code> {{ t('gcc.typePost') }}</label>
          <input :id="inputId" v-model="typedName" class="gcpc-input" autocomplete="off" spellcheck="false" data-test="confirm-name" @keydown.enter="canConfirm && confirm()" />
        </div>

        <div v-if="blocked" class="alert-error gcpc-error" data-test="blocked">{{ blocked }}</div>
        <div v-if="error" class="alert-error gcpc-error">{{ error }}</div>
      </div>

      <div class="gcpc-footer">
        <button class="btn sm" :disabled="busy" @click="$emit('cancel')">{{ t('gcc.cancel') }}</button>
        <button :class="['btn', 'sm', tone === 'danger' ? 'danger' : 'primary']" :disabled="!canConfirm" data-test="confirm" @click="confirm">
          {{ busy ? t('gcc.processing') : (confirmLabel || t('gcc.confirm')) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
// Confirmation for GCP actions. Layers, depending on props:
//   requireName → the resource name must be typed back (deletes, creates)
//   costAck     → "this generates costs" checkbox, plus a second one when the
//                 estimate is flagged highCost
// The confirm event carries the acknowledgements so callers can forward them to
// the backend, which validates them again.
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()

const props = defineProps({
  open:            { type: Boolean, default: false },
  title:           { type: String,  required: true },
  message:         { type: String,  default: '' },
  lines:           { type: Array,   default: () => [] },
  tone:            { type: String,  default: 'info' },   // info | warning | danger
  confirmLabel:    { type: String,  default: '' },
  requireName:     { type: String,  default: '' },
  costAck:         { type: Boolean, default: false },
  estimate:        { type: Object,  default: null },
  estimateLoading: { type: Boolean, default: false },
  busy:            { type: Boolean, default: false },
  error:           { type: String,  default: '' },
  // Reason the action cannot proceed (e.g. deletion protection); disables confirm
  blocked:         { type: String,  default: '' },
})
const emit = defineEmits(['confirm', 'cancel'])

let seq = 0
const uid = `gcpc-${++seq}-${Math.random().toString(36).slice(2, 7)}`
const titleId = `${uid}-title`
const inputId = `${uid}-name`

const typedName = ref('')
const costAcked = ref(false)
const highCostAcked = ref(false)

watch(() => props.open, open => {
  if (open) { typedName.value = ''; costAcked.value = false; highCostAcked.value = false }
})

const canConfirm = computed(() => {
  if (props.busy || props.estimateLoading || props.blocked) return false
  if (props.requireName && typedName.value !== props.requireName) return false
  if (props.costAck && !costAcked.value) return false
  if (props.costAck && props.estimate?.highCost && !highCostAcked.value) return false
  return true
})

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', {
    confirmName: typedName.value || undefined,
    acknowledgeCost: props.costAck ? costAcked.value : undefined,
    acknowledgeHighCost: props.costAck && props.estimate?.highCost ? highCostAcked.value : undefined,
  })
}

function formatUsd(n) {
  return Number(n || 0).toFixed(2)
}
</script>

<style scoped>
.gcpc-modal { width: 520px; max-width: 96vw; max-height: 90vh; display: flex; flex-direction: column; }
.gcpc-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.gcpc-icon { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
.tone-warning .gcpc-icon { background: color-mix(in srgb, var(--yellow) 20%, transparent); color: var(--yellow); }
.tone-danger .gcpc-icon  { background: color-mix(in srgb, var(--red) 20%, transparent); color: var(--red); }
.gcpc-title { font-weight: 600; font-size: 14px; }
.gcpc-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.gcpc-message { margin: 0; }
.gcpc-lines { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--text); }
.gcpc-estimate { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.gcpc-estimate.high { border-color: var(--red); background: color-mix(in srgb, var(--red) 6%, transparent); }
.gcpc-estimate-total { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.gcpc-estimate-total strong { font-size: 16px; }
.gcpc-estimate.high .gcpc-estimate-total strong { color: var(--red); }
.gcpc-items { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 12px; color: var(--text-dim); }
.gcpc-items td { padding: 2px 0; }
.gcpc-items .num { text-align: right; white-space: nowrap; }
.gcpc-warnings { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--yellow); }
.gcpc-disclaimer { margin-top: 6px; font-size: 11px; color: var(--text-dim); }
.gcpc-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
.gcpc-check.high { color: var(--red); font-weight: 600; }
.gcpc-check input { margin-top: 2px; accent-color: var(--accent); }
.gcpc-name { display: flex; flex-direction: column; gap: 6px; }
.gcpc-name code { font-family: monospace; padding: 0 4px; border-radius: 3px; background: var(--bg-hover); }
.gcpc-input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-family: monospace; }
.gcpc-error { margin: 0; word-break: break-word; }
.gcpc-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
</style>

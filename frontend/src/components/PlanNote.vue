<template>
  <!-- In-place note: what the plan does not include here, and the way to the plans. -->
  <p v-if="locked" class="plan-note" data-test="plan-note" :data-feature="feature">
    <i data-lucide="sparkles"></i>
    <span>{{ text || t(`blocked.plan.${feature}`) }}</span>
    <button type="button" class="btn sm" data-test="plan-note-see-plans" @click="seePlans">{{ t('blocked.seePlans') }}</button>
  </p>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { usePlan } from '../composables/usePlan'

const props = defineProps({
  // A feature of lib/plans.js (agents, scheduledTasks, advisor…)
  feature: { type: String, required: true },
  text: { type: String, default: '' },
})

const { t } = useI18n()
const { plan } = usePlan()
// Only an answered plan that lacks the feature shows the note: never while it loads.
const locked = computed(() => !!plan.value?.features && plan.value.features[props.feature] === false)

function seePlans() {
  window.dispatchEvent(new CustomEvent('kua:open-help', { detail: { tab: 'account' } }))
}

defineExpose({ locked })
</script>

<style scoped>
.plan-note { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0; padding: 6px 10px; border: 1px solid var(--yellow); border-radius: 6px; font-size: 12px; }
.plan-note span { flex: 1; min-width: 180px; }
</style>

<template>
  <span class="abr" data-test="agent-brief">
    <button
      :class="['btn', compact ? 'btn-icon' : 'sm']" :disabled="disabled"
      :title="t('agentBrief.copyHint')" :aria-label="t('agentBrief.copy')"
      data-test="agent-brief-copy" @click="copyBrief"
    >
      <i data-lucide="bot"></i><span v-if="!compact">{{ t('agentBrief.copy') }}</span>
    </button>
    <button
      :class="['btn', compact ? 'btn-icon' : 'sm']" :disabled="disabled"
      :title="t('agentBrief.download')" :aria-label="t('agentBrief.download')"
      data-test="agent-brief-download" @click="downloadBrief"
    >
      <i data-lucide="file-down"></i>
    </button>
    <button
      :class="['btn', compact ? 'btn-icon' : 'sm']"
      :title="t('agentConnect.open')" :aria-label="t('agentConnect.open')"
      data-test="agent-connect-open" @click="connectOpen = true"
    >
      <i data-lucide="plug"></i>
    </button>
    <AgentConnectModal :show="connectOpen" @close="connectOpen = false" />
  </span>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { briefFileName } from '../../shared/agentBrief.mjs'
import AgentConnectModal from './AgentConnectModal.vue'

const props = defineProps({
  // Returns the Markdown brief; called on click so it reflects the latest data.
  build: { type: Function, required: true },
  // Names the downloaded file (kua-brief-<subject>-<date>.md)
  subject: { type: String, default: 'report' },
  compact: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const { t } = useI18n()
const { toast } = useToast()
const connectOpen = ref(false)

async function copyBrief() {
  try {
    await navigator.clipboard.writeText(props.build())
    toast(t('agentBrief.copied'), 'success')
  } catch {
    toast(t('agentBrief.copyFailed'), 'error')
  }
}

function downloadBrief() {
  const blob = new Blob([props.build()], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = briefFileName(props.subject)
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => nextTick(() => createIcons({ icons })))
</script>

<style scoped>
.abr { display: inline-flex; gap: 4px; align-items: center; flex: none; }
.abr .btn.sm { display: inline-flex; gap: 5px; align-items: center; }
.abr svg { width: 14px; height: 14px; }
</style>

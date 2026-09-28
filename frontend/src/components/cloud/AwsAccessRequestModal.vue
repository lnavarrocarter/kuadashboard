<template>
  <BaseModal :show="show" wide @close="emit('close')">
    <template #title><i data-lucide="key-round"></i> {{ t('awsAccess.title') }}</template>

    <div v-if="access" class="aar">
      <p class="aar-lead">
        <template v-if="access.failedAction">{{ t('awsAccess.leadAction', { action: access.failedAction }) }}</template>
        <template v-else>{{ t('awsAccess.leadGeneric') }}</template>
      </p>

      <template v-if="access.actions.length">
        <div class="aar-actions">
          <span v-for="action in access.actions" :key="action" :class="['aar-action', { failed: action === access.failedAction }]">
            {{ action }}<span v-if="action === access.failedAction" class="aar-failed-mark">· {{ t('awsAccess.failed') }}</span>
          </span>
        </div>
        <p class="aar-note">{{ t(access.source === 'error' ? 'awsAccess.sourceError' : 'awsAccess.sourceRoute') }}</p>

        <div class="aar-block">
          <div class="aar-block-head">
            <h4>{{ t('awsAccess.requestTitle') }}</h4>
            <div class="aar-lang" role="group" :aria-label="t('awsAccess.language')">
              <button v-for="lang in LANGS" :key="lang" :class="{ active: requestLang === lang }" @click="requestLang = lang">{{ lang.toUpperCase() }}</button>
            </div>
            <button class="btn sm" @click="copy(requestText)"><i data-lucide="copy"></i> {{ t('awsAccess.copyRequest') }}</button>
          </div>
          <textarea class="aar-text" readonly :value="requestText" rows="11"></textarea>
        </div>

        <div class="aar-block">
          <div class="aar-block-head">
            <h4>{{ t('awsAccess.policyTitle') }}</h4>
            <button class="btn sm" @click="copy(policyJson)"><i data-lucide="copy"></i> {{ t('awsAccess.copyPolicy') }}</button>
          </div>
          <pre class="aar-policy">{{ policyJson }}</pre>
        </div>
        <p class="aar-note">{{ t('awsAccess.reviewNote') }}</p>
      </template>

      <div v-else class="aar-unknown">
        <p>{{ t('awsAccess.unknown') }}</p>
        <code>{{ message }}</code>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('action.close') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import { useI18n, translate } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import { useToast } from '../../composables/useToast'

const props = defineProps({
  show: Boolean,
  access: { type: Object, default: null },
  message: { type: String, default: '' },
  // Fallback identity (e.g. from the overview) when AWS did not name the principal.
  identity: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { toast } = useToast()
const LANGS = ['en', 'es']
const requestLang = ref(settings.lang === 'es' ? 'es' : 'en')
watch(() => props.show, open => { if (open) requestLang.value = settings.lang === 'es' ? 'es' : 'en' })

const policyJson = computed(() => (props.access?.policy ? JSON.stringify(props.access.policy, null, 2) : ''))

// Text meant for whoever manages IAM, in the language chosen for them.
const requestText = computed(() => {
  const access = props.access
  if (!access) return ''
  const tr = (key, params) => translate(requestLang.value, key, params)
  const principal = access.principal || props.identity?.arn || tr('awsAccess.textUnknownPrincipal')
  const account = access.account || props.identity?.account
  const lines = [
    tr('awsAccess.textGreeting'),
    '',
    account ? tr('awsAccess.textIntroAccount', { principal, account }) : tr('awsAccess.textIntro', { principal }),
    '',
    ...access.actions.map(action => `- ${action}${action === access.failedAction ? ` ${tr('awsAccess.textFailedMark')}` : ''}`),
  ]
  if (access.resource) lines.push('', tr('awsAccess.textResource', { resource: access.resource }))
  lines.push('', tr('awsAccess.textAsk'), '', policyJson.value)
  return lines.join('\n')
})

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value)
    toast(t('awsOverview.copied'), 'success')
  } catch {
    toast(t('awsOverview.copyFailed'), 'error')
  }
}
</script>

<style scoped>
.aar { display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.aar-lead { margin: 0; font-weight: 600; }
.aar-note { margin: 0; font-size: 12px; color: var(--text-dim); }
.aar-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.aar-action { font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 12px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border); }
.aar-action.failed { border-color: color-mix(in srgb, var(--yellow) 55%, var(--border)); color: var(--yellow); }
.aar-failed-mark { margin-left: 4px; font-family: inherit; opacity: .85; }
.aar-block { display: flex; flex-direction: column; gap: 6px; }
.aar-block-head { display: flex; align-items: center; gap: 10px; }
.aar-block-head h4 { margin: 0; font-size: 12px; flex: 1; }
.aar-block-head .btn { display: inline-flex; align-items: center; gap: 5px; }
.aar-block-head .btn svg { width: 12px; height: 12px; }
.aar-lang { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.aar-lang button { border: none; background: transparent; color: var(--text-dim); font: inherit; font-size: 11px; font-weight: 600; padding: 3px 9px; cursor: pointer; }
.aar-lang button + button { border-left: 1px solid var(--border); }
.aar-lang button.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.aar-text, .aar-policy {
  width: 100%; box-sizing: border-box; margin: 0; padding: 10px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg-row); color: var(--text);
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 12px; line-height: 1.5;
}
.aar-text { resize: vertical; }
.aar-policy { overflow: auto; max-height: 260px; }
.aar-unknown { display: flex; flex-direction: column; gap: 8px; }
.aar-unknown p { margin: 0; }
.aar-unknown code { font-size: 12px; color: var(--text-dim); white-space: pre-wrap; }
</style>

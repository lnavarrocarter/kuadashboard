<template>
  <!-- Where an AWS write goes: environment, account, profile and region of the active
       profile, read when the dialog opens. A production account adds a warning. -->
  <div class="aws-destination" data-test="aws-destination">
    <dl>
      <dt>{{ t('kubeAction.environment') }}</dt>
      <dd><span :class="['kube-env-badge', `env-${environment || 'unknown'}`]" data-test="aws-destination-env">{{ t(`kubeAction.env.${environment || 'unknown'}`) }}</span></dd>
      <dt>{{ t('awsv.dest.account') }}</dt>
      <dd data-test="aws-destination-account">{{ account }}</dd>
      <dt>{{ t('awsv.dest.profile') }}</dt>
      <dd>{{ profileName }}</dd>
      <dt>{{ t('awsv.dest.region') }}</dt>
      <dd>{{ region }}</dd>
      <template v-if="application">
        <dt>{{ t('awsv.dest.application') }}</dt>
        <dd>{{ application }}</dd>
      </template>
      <template v-if="resource">
        <dt>{{ t('kubeAction.resource') }}</dt>
        <dd class="aws-destination-resource">{{ resource }}</dd>
      </template>
    </dl>
    <p v-if="environment === 'production'" class="aws-destination-warning" role="alert">{{ t('awsv.dest.productionWarning') }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useAwsStore } from '../../stores/useAwsStore'
import { useEnvStore } from '../../stores/useEnvStore'
import { useI18n } from '../../composables/useI18n'
import { cloudProfileEnvironment } from '../../lib/profileEnvironment'

const props = defineProps({
  resource: { type: String, default: '' },
  application: { type: String, default: '' },
})

const { t } = useI18n()
const awsStore = useAwsStore()
const envStore = useEnvStore()

const profileId = computed(() => awsStore.activeProfileId || '')
const profileName = computed(() => {
  const id = profileId.value
  if (!id) return '—'
  if (id.startsWith('local:')) return `${id.slice('local:'.length)} (local)`
  return envStore.awsProfiles.find(profile => profile.id === id)?.name || id
})
const environment = computed(() => cloudProfileEnvironment('aws', profileId.value, { awsProfiles: envStore.awsProfiles }))
// The context belongs to the active profile only: another profile's account is never shown.
const context = computed(() => (awsStore.accountContext?.profileId === profileId.value ? awsStore.accountContext : null))
const account = computed(() => {
  if (!context.value) return t('state.loading')
  const id = context.value.account
  if (!id) return t('awsv.op.unknown')
  const alias = awsStore.overview?.identity?.account === id ? awsStore.overview.identity.alias : null
  return alias ? `${alias} (${id})` : id
})
const region = computed(() => (context.value ? context.value.region || t('awsv.op.unknown') : t('state.loading')))

// STS GetCallerIdentity: no charge; cached per profile by the store.
onMounted(() => { awsStore.fetchAccountContext?.() })
defineExpose({ environment })
</script>

<style scoped>
.aws-destination { margin: 10px 12px 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-input, rgba(127,127,127,.06)); font-size: 12px; }
.aws-destination dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; margin: 0; }
.aws-destination dt { color: var(--text-dim); }
.aws-destination dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.aws-destination-resource { font-family: var(--font-mono, monospace); }
.aws-destination-warning { margin: 6px 0 0; color: var(--red); font-weight: 600; }
</style>

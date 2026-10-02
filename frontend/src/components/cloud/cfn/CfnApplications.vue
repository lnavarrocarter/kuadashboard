<template>
  <section class="msg-section cap">
    <h5>{{ t('cfn.apps.title') }}</h5>
    <div v-if="error" class="activity-notice">{{ error }}</div>
    <div v-if="loading && !links" class="text-dim">{{ t('common.loading') }}</div>
    <template v-else-if="links">
      <div v-if="!links.linkable" class="text-dim">{{ t('cfn.apps.noneLinkable') }}</div>
      <ul v-if="links.applications.length" class="msg-list">
        <li v-for="app in links.applications" :key="app.applicationId">
          <b>{{ app.name }}</b><span v-if="app.environment" class="text-dim"> ({{ app.environment }})</span>
          · {{ t('cfn.apps.matched', { matched: app.matched, linkable: links.linkable }) }}
          <button class="btn sm" @click="emit('open-application', app)">{{ t('cfn.apps.open') }}</button>
          <button v-if="app.matched < links.linkable" class="btn sm" :disabled="busy" @click="link(app.applicationId)">{{ t('cfn.apps.complete') }}</button>
        </li>
      </ul>
      <div v-else-if="links.linkable" class="text-dim">{{ t('cfn.apps.notLinked') }}</div>
      <div v-if="links.linkable" class="cap-row">
        <select v-model="target" class="ctrl-select" :aria-label="t('cfn.apps.target')">
          <option value="__new">{{ t('cfn.apps.newApp', { name: stackName }) }}</option>
          <option v-for="app in otherApps" :key="app.id" :value="app.id">{{ app.name }}{{ app.environment ? ` (${app.environment})` : '' }}</option>
        </select>
        <button class="btn sm primary" :disabled="busy" @click="link(target)">{{ busy ? '…' : t('cfn.apps.link', { n: links.linkable }) }}</button>
      </div>
      <div class="text-dim cap-hint">{{ t('cfn.apps.hint') }}</div>
    </template>
  </section>
</template>

<script setup>
// Which KUA Applications use this stack's resources, and linking the stack to
// one (adds its supported resources through the same reader as the APM setup).
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'

const props = defineProps({ stackName: { type: String, required: true }, region: { type: String, default: '' }, profileId: { type: String, default: '' } })
const emit = defineEmits(['open-application', 'linked'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const APM = '/api/observability/aws'

const links = ref(null)
const apps = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref(null)
const target = ref('__new')

const otherApps = computed(() => apps.value.filter(app => !links.value?.applications.some(l => l.applicationId === app.id)))

function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [stackLinks, applications] = await Promise.all([
      apiFetch(`${APM}/stack-applications?stackName=${encodeURIComponent(props.stackName)}&region=${encodeURIComponent(props.region)}`, { headers: headers() }),
      apiFetch(`${APM}/applications?region=${encodeURIComponent(props.region)}`, { headers: headers() }),
    ])
    links.value = stackLinks
    apps.value = applications
  } catch (err) { error.value = err.message } finally { loading.value = false }
}

async function link(applicationId) {
  busy.value = true
  error.value = null
  try {
    let id = applicationId
    if (id === '__new') {
      const created = await apiFetch(`${APM}/applications`, { method: 'POST', headers: headers(true), body: JSON.stringify({ name: props.stackName, region: props.region }) })
      id = created.id
    }
    const result = await apiFetch(`${APM}/applications/${encodeURIComponent(id)}/link-stack`, { method: 'POST', headers: headers(true), body: JSON.stringify({ stackName: props.stackName, region: props.region }) })
    toast(t('cfn.apps.linked', { added: result.added, already: result.alreadyLinked }), 'success')
    emit('linked', { applicationId: id, ...result })
    target.value = '__new'
    load()
  } catch (err) { error.value = err.message } finally { busy.value = false }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.cap-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.cap-hint { font-size: 11px; }
.msg-list li { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
</style>

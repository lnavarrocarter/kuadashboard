<template>
  <div v-if="open && !reviewing" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal gcpn-modal" role="dialog" aria-modal="true">
      <div class="modal-header gcpn-header">
        <span style="font-weight:600">{{ t(`gcn.title_${kind}`) }}</span>
        <button class="btn sm" @click="$emit('close')">✕</button>
      </div>

      <div class="gcpn-body">
        <div class="gcpn-form">
          <div v-if="presetsError" class="gcpn-invalid wide">{{ t('gcn.presetsError', { error: presetsError }) }}</div>
          <label class="gcpn-field">
            <span>{{ t('res.name') }}</span>
            <input v-model.trim="form.name" class="gcpn-input" data-test="name" :placeholder="PLACEHOLDERS[kind]" />
            <small v-if="form.name && !nameValid" class="gcpn-invalid">{{ t('gcn.nameRule') }}</small>
          </label>

          <!-- Cloud Run -->
          <template v-if="kind === 'cloudrun'">
            <label class="gcpn-field"><span>{{ t('res.region') }}</span>
              <select v-model="form.region" class="gcpn-input" data-test="region">
                <option v-for="l in locations" :key="l.region" :value="l.region">{{ l.label }}</option>
              </select></label>
            <label class="gcpn-field wide"><span>{{ t('lmd.image') }}</span>
              <input v-model.trim="form.image" class="gcpn-input mono" /></label>
            <label class="gcpn-field"><span>CPU</span>
              <select v-model="form.cpu" class="gcpn-input"><option v-for="c in cloudRunOptions.cpu" :key="c" :value="c">{{ c }} vCPU</option></select></label>
            <label class="gcpn-field"><span>{{ t('lmd.memory') }}</span>
              <select v-model="form.memory" class="gcpn-input"><option v-for="m in cloudRunOptions.memory" :key="m">{{ m }}</option></select></label>
            <label class="gcpn-field"><span>{{ t('gcn.minInstances') }}</span>
              <input v-model.number="form.minInstances" type="number" min="0" max="10" class="gcpn-input" data-test="min-instances" /></label>
            <label class="gcpn-field"><span>{{ t('gcn.maxInstances') }}</span>
              <input v-model.number="form.maxInstances" type="number" min="1" max="100" class="gcpn-input" /></label>
            <label class="gcpn-check wide">
              <input v-model="form.allowUnauthenticated" type="checkbox" />
              {{ t('gcn.allowPublic') }} (<code>allUsers</code>)
            </label>
          </template>

          <!-- Compute VM -->
          <template v-else-if="kind === 'vm'">
            <label class="gcpn-field"><span>{{ t('res.region') }}</span>
              <select v-model="form.region" class="gcpn-input" data-test="region">
                <option v-for="l in locations" :key="l.region" :value="l.region">{{ l.label }}</option>
              </select></label>
            <label class="gcpn-field"><span>{{ t('res.zone') }}</span>
              <select v-model="form.zone" class="gcpn-input" data-test="zone">
                <option v-for="z in zonesForRegion" :key="z" :value="z">{{ z }}</option>
              </select></label>
            <fieldset class="gcpn-presets wide" data-test="machine-presets">
              <legend>{{ t('gcn.machineType') }}</legend>
              <label v-for="p in presets.vm" :key="p.value" :class="['gcpn-preset', { active: !customMachine && form.machineType === p.value }]">
                <input type="radio" name="gcpn-machine" :value="p.value" :checked="!customMachine && form.machineType === p.value" @change="pickPreset('machineType', p.value)" />
                <span class="gcpn-preset-name">{{ p.label }} <small class="mono">{{ p.value }}</small></span>
                <span class="gcpn-preset-specs">{{ p.specs }}</span>
                <span class="gcpn-preset-use">{{ p.use }}</span>
                <span class="gcpn-preset-price">{{ p.monthlyUsd != null ? `~$${p.monthlyUsd.toFixed(2)}/mes` : '' }}</span>
              </label>
              <label :class="['gcpn-preset', 'other', { active: customMachine }]">
                <input type="radio" name="gcpn-machine" :checked="customMachine" @change="customMachine = true" data-test="machine-other" />
                <span class="gcpn-preset-name">{{ t('gcn.other') }}</span>
                <input v-if="customMachine" v-model.trim="form.machineType" class="gcpn-input mono" placeholder="n2-standard-8" data-test="machine-type" @click.stop />
                <span v-else class="gcpn-preset-use">{{ t('gcn.anyMachine') }}</span>
              </label>
            </fieldset>
            <label class="gcpn-field"><span>{{ t('lmd.image') }}</span>
              <select v-model="form.imageKey" class="gcpn-input">
                <option v-for="img in presets.vmImages" :key="img.key" :value="img.key">{{ img.label }}</option>
              </select></label>
            <label class="gcpn-field"><span>{{ t('gcn.diskGb') }}</span>
              <input v-model.number="form.diskSizeGb" type="number" min="10" class="gcpn-input" /></label>
            <label class="gcpn-field"><span>{{ t('gcn.diskType') }}</span>
              <select v-model="form.diskType" class="gcpn-input"><option v-for="d in ['pd-balanced','pd-standard','pd-ssd']" :key="d">{{ d }}</option></select></label>
            <label class="gcpn-check"><input v-model="form.externalIp" type="checkbox" /> {{ t('ec2d.publicIp') }}</label>
            <label class="gcpn-check"><input v-model="form.spot" type="checkbox" /> {{ t('gcn.spot') }}</label>
            <label class="gcpn-check"><input v-model="form.deletionProtection" type="checkbox" /> {{ t('gvi.deletionProtection') }}</label>
          </template>

          <!-- Cloud SQL -->
          <template v-else-if="kind === 'sql'">
            <label class="gcpn-field"><span>{{ t('res.region') }}</span>
              <select v-model="form.region" class="gcpn-input" data-test="region">
                <option v-for="l in locations" :key="l.region" :value="l.region">{{ l.label }}</option>
              </select></label>
            <label class="gcpn-field"><span>{{ t('gsi.engine') }}</span>
              <select v-model="form.databaseVersion" class="gcpn-input">
                <option v-for="v in presets.sqlVersions" :key="v">{{ v }}</option>
              </select></label>
            <fieldset class="gcpn-presets wide" data-test="tier-presets">
              <legend>{{ t('gcn.instanceSize') }}</legend>
              <label v-for="p in presets.sql" :key="p.value" :class="['gcpn-preset', { active: !customTier && form.tier === p.value }]">
                <input type="radio" name="gcpn-tier" :value="p.value" :checked="!customTier && form.tier === p.value" @change="pickPreset('tier', p.value)" />
                <span class="gcpn-preset-name">{{ p.label }} <small class="mono">{{ p.value }}</small></span>
                <span class="gcpn-preset-specs">{{ p.specs }}</span>
                <span class="gcpn-preset-use">{{ p.use }}</span>
                <span class="gcpn-preset-price">{{ p.monthlyUsd != null ? `~$${p.monthlyUsd.toFixed(2)}/mes` : '' }}</span>
              </label>
              <label :class="['gcpn-preset', 'other', { active: customTier }]">
                <input type="radio" name="gcpn-tier" :checked="customTier" @change="customTier = true" data-test="tier-other" />
                <span class="gcpn-preset-name">{{ t('gcn.other') }}</span>
                <input v-if="customTier" v-model.trim="form.tier" class="gcpn-input mono" placeholder="db-custom-8-30720" data-test="tier" @click.stop />
                <span v-else class="gcpn-preset-use">{{ t('gcn.customTier') }}</span>
              </label>
            </fieldset>
            <label class="gcpn-field"><span>{{ t('gcn.storageGb') }}</span>
              <input v-model.number="form.storageGb" type="number" min="10" class="gcpn-input" /></label>
            <label class="gcpn-field"><span>{{ t('res.type') }}</span>
              <select v-model="form.storageType" class="gcpn-input"><option>PD_SSD</option><option>PD_HDD</option></select></label>
            <label class="gcpn-field"><span>{{ t('gvi.availability') }}</span>
              <select v-model="form.availabilityType" class="gcpn-input" data-test="availability">
                <option value="ZONAL">{{ t('gsi.zonal') }}</option><option value="REGIONAL">{{ t('gcn.haOption') }}</option>
              </select></label>
            <label class="gcpn-field wide"><span>{{ t('gcn.rootPassword') }}</span>
              <span class="gcpn-inline">
                <input v-model="form.rootPassword" :type="showPassword ? 'text' : 'password'" class="gcpn-input mono" autocomplete="new-password" data-test="root-password" />
                <button type="button" class="btn sm" @click="showPassword = !showPassword">{{ showPassword ? 'Ocultar' : 'Ver' }}</button>
                <button type="button" class="btn sm" @click="generatePassword">{{ t('gcn.generate') }}</button>
              </span></label>
            <label class="gcpn-check"><input v-model="form.backupEnabled" type="checkbox" /> {{ t('gcn.autoBackups') }}</label>
            <label class="gcpn-check"><input v-model="form.deletionProtection" type="checkbox" /> {{ t('gvi.deletionProtection') }}</label>
          </template>
        </div>

        <!-- Live estimate -->
        <aside :class="['gcpn-estimate', { high: estimateData?.highCost }]" data-test="live-estimate">
          <div class="gcpn-estimate-label">{{ t('gcn.estimatedCost') }}</div>
          <div v-if="estimateLoading" class="text-dim">{{ t('gcn.calculating') }}</div>
          <template v-else-if="estimateData">
            <div class="gcpn-estimate-total">{{ estimateData.known ? t('gcn.perMonth', { usd: estimateData.monthlyUsd.toFixed(2) }) : t('gcn.noPrice') }}</div>
            <div v-if="estimateData.highCost" class="gcpn-high">{{ t('gcn.highCost') }}</div>
            <div v-for="item in estimateData.items" :key="item.label" class="gcpn-item"><span>{{ item.label }}</span><span>${{ item.monthlyUsd.toFixed(2) }}</span></div>
          </template>
          <div v-else-if="estimateError" class="gcpn-invalid">{{ estimateError }}</div>
        </aside>
      </div>

      <div class="modal-footer gcpn-footer">
        <button class="btn sm" @click="$emit('close')">{{ t('action.cancel') }}</button>
        <button class="btn sm primary" :disabled="!formValid" data-test="review" @click="reviewing = true">{{ t('gcn.review') }}</button>
      </div>

    </div>
  </div>

  <GcpConfirmModal
    :open="open && reviewing"
    :title="t(`gcn.createTitle_${kind}`, { name: form.name })"
    :message="t('gcn.reviewMessage')"
    :lines="reviewLines"
    tone="warning"
    :require-name="form.name"
    cost-ack
    :estimate="estimateData"
    :estimate-loading="estimateLoading"
    :busy="creating"
    :error="createError"
    :confirm-label="t('gcn.createResource')"
    @cancel="reviewing = false; createError = ''"
    @confirm="create"
  />
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useGcpStore } from '../../stores/useGcpStore'
import { useI18n } from '../../composables/useI18n'
import GcpConfirmModal from './GcpConfirmModal.vue'

const props = defineProps({
  open:          { type: Boolean, default: false },
  kind:          { type: String,  required: true },   // cloudrun | vm | sql
  defaultRegion: { type: String,  default: 'us-central1' },
})
const emit = defineEmits(['close', 'created'])

const gcpStore = useGcpStore()

const { t } = useI18n()
const PLACEHOLDERS = { cloudrun: 'mi-servicio', vm: 'mi-vm', sql: 'mi-base' }
const NAME_RULES = {
  cloudrun: /^[a-z](?:[a-z0-9-]{0,47}[a-z0-9])?$/,
  vm: /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  sql: /^[a-z](?:[a-z0-9-]{0,96}[a-z0-9])?$/,
}
// Minimal fallback if GET /presets fails; the backend list is the source of truth
// (it also carries prices from the same table as the estimates).
const FALLBACK_PRESETS = {
  locations: [{ region: 'us-central1', label: 'Iowa (us-central1)', zones: ['us-central1-a', 'us-central1-b', 'us-central1-c', 'us-central1-f'] }],
  vm: [{ value: 'e2-small', label: t('gcn.presetSmall'), specs: t('gcn.presetSmallSpecs'), use: '', monthlyUsd: null }],
  sql: [{ value: 'db-f1-micro', label: 'Micro', specs: t('gcn.presetMicroSpecs'), use: '', monthlyUsd: null }],
  vmImages: [{ key: 'debian-12', label: 'Debian 12', project: 'debian-cloud', family: 'debian-12' }],
  sqlVersions: ['POSTGRES_16', 'MYSQL_8_0'],
  cloudRun: { cpu: ['1', '2', '4'], memory: ['512Mi', '1Gi', '2Gi', '4Gi'] },
}
const presets = ref(FALLBACK_PRESETS)
const presetsError = ref('')
const customMachine = ref(false)
const customTier = ref(false)

// Regions offered: curated list, plus the current default if it is not in it
const locations = computed(() => {
  const list = presets.value.locations
  const region = props.defaultRegion
  if (!region || list.some(l => l.region === region)) return list
  // Unknown zones for a non-curated region: let the user pick after choosing a listed region
  return [...list, { region, label: region, zones: ['b', 'c'].map(z => `${region}-${z}`) }]
})
const zonesForRegion = computed(() => locations.value.find(l => l.region === form.region)?.zones || [])
const cloudRunOptions = computed(() => presets.value.cloudRun)

function pickPreset(field, value) {
  if (field === 'machineType') customMachine.value = false
  if (field === 'tier') customTier.value = false
  form[field] = value
}

function defaults(kind) {
  const region = props.defaultRegion || 'us-central1'
  const zone = locations.value.find(l => l.region === region)?.zones[0] || `${region}-b`
  if (kind === 'cloudrun') return { name: '', region, image: 'us-docker.pkg.dev/cloudrun/container/hello', cpu: '1', memory: '512Mi', minInstances: 0, maxInstances: 3, allowUnauthenticated: false }
  if (kind === 'vm') return { name: '', region, zone, machineType: 'e2-small', imageKey: 'debian-12', diskSizeGb: 10, diskType: 'pd-balanced', externalIp: true, spot: false, deletionProtection: false }
  return { name: '', region, databaseVersion: 'POSTGRES_16', tier: 'db-f1-micro', storageGb: 10, storageType: 'PD_SSD', availabilityType: 'ZONAL', rootPassword: '', backupEnabled: true, deletionProtection: true }
}

const form = reactive({})
const reviewing = ref(false)
const creating = ref(false)
const createError = ref('')
const showPassword = ref(false)

function resetForm() {
  Object.keys(form).forEach(k => delete form[k])
  Object.assign(form, defaults(props.kind))
  customMachine.value = false
  customTier.value = false
}
resetForm()

watch(() => [props.open, props.kind], async ([open]) => {
  if (!open) return
  resetForm()
  reviewing.value = false
  createError.value = ''
  showPassword.value = false
  try {
    const res = await gcpStore.fetchPresets()
    if (!Array.isArray(res?.vm) || !Array.isArray(res?.locations)) throw new Error(t('gcn.invalidResponse'))
    presets.value = res
    presetsError.value = ''
  } catch (e) {
    presetsError.value = e.message
  }
}, { immediate: true })

// Keep the zone valid for the selected region (VM form), also after presets load
watch(() => [form.region, zonesForRegion.value], () => {
  if (props.kind !== 'vm' || !form.region) return
  if (!zonesForRegion.value.includes(form.zone)) form.zone = zonesForRegion.value[0] || ''
})

const nameValid = computed(() => NAME_RULES[props.kind]?.test(form.name || ''))
const formValid = computed(() => {
  if (!nameValid.value) return false
  if (props.kind === 'cloudrun') return !!form.region && !!form.image && form.maxInstances >= Math.max(1, form.minInstances)
  if (props.kind === 'vm') return !!form.zone && !!form.machineType && form.diskSizeGb >= 10
  return !!form.region && !!form.tier && form.storageGb >= 10 && (form.rootPassword || '').length >= 12
})

// Request body for the backend (image choice expanded, password kept out of the estimate)
function payload() {
  if (props.kind === 'vm') {
    const { imageKey, region, ...rest } = form
    const images = presets.value.vmImages
    const img = images.find(i => i.key === imageKey) || images[0]
    return { ...rest, imageProject: img.project, imageFamily: img.family }
  }
  return { ...form }
}

// ── Live estimate (debounced) ────────────────────────────────────────────────
const estimateData = ref(null)
const estimateLoading = ref(false)
const estimateError = ref('')
let estimateTimer = null
let estimateSeq = 0

watch(() => [props.open, props.kind, JSON.stringify({ ...form, rootPassword: undefined, name: undefined })], ([open]) => {
  if (!open) return
  clearTimeout(estimateTimer)
  estimateLoading.value = true
  estimateTimer = setTimeout(async () => {
    const seq = ++estimateSeq
    try {
      const { rootPassword, ...spec } = payload()
      const res = await gcpStore.estimateResource(props.kind, spec)
      if (seq === estimateSeq) { estimateData.value = res; estimateError.value = '' }
    } catch (e) {
      if (seq === estimateSeq) { estimateData.value = null; estimateError.value = e.message }
    } finally {
      if (seq === estimateSeq) estimateLoading.value = false
    }
  }, 300)
}, { immediate: true })

// ── Review summary (security-relevant choices called out) ────────────────────
const reviewLines = computed(() => {
  const f = form
  if (props.kind === 'cloudrun') return [
    t('gcn.lineRunRegion', { region: f.region, image: f.image }),
    t('gcn.lineRunSize', { cpu: f.cpu, memory: f.memory, min: f.minInstances, max: f.maxInstances }),
    f.allowUnauthenticated ? t('gcn.linePublic') : t('gcn.linePrivate'),
  ]
  if (props.kind === 'vm') return [
    `${t('gcn.lineZone', { zone: f.zone })} · ${f.machineType}${f.spot ? ' (Spot)' : ''}`,
    t('gcn.lineDisk', { gb: f.diskSizeGb, type: f.diskType, image: presets.value.vmImages.find(i => i.key === f.imageKey)?.label }),
    f.externalIp ? t('gcn.linePublicIp') : t('gcn.lineNoPublicIp'),
    f.deletionProtection ? t('gcn.lineProtectionOn') : t('gcn.lineProtectionOff'),
  ]
  return [
    `${t('gcn.lineRegion', { region: f.region })} · ${f.databaseVersion} · ${f.tier}`,
    `${f.storageGb} GB ${f.storageType} · ${f.availabilityType === 'REGIONAL' ? t('gsi.highAvailability') : t('gsi.zonal')}`,
    f.backupEnabled ? t('gcn.lineBackupsOn') : `⚠ ${t('gcn.lineBackupsOff')}`,
    f.deletionProtection ? t('gcn.lineProtectionOn') : `⚠ ${t('gcn.lineProtectionOff')}`,
    t('gcn.lineSqlSlow'),
  ]
})

async function create(acks) {
  creating.value = true
  createError.value = ''
  try {
    const res = await gcpStore.createResource(props.kind, { ...payload(), ...acks })
    emit('created', { kind: props.kind, name: form.name, result: res })
  } catch (e) {
    createError.value = e.message
  } finally {
    creating.value = false
  }
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_'
  const bytes = new Uint32Array(20)
  crypto.getRandomValues(bytes)
  form.rootPassword = Array.from(bytes, b => chars[b % chars.length]).join('')
  showPassword.value = true
}
</script>

<style scoped>
.gcpn-modal { width: 820px; max-width: 97vw; max-height: 92vh; display: flex; flex-direction: column; }
.gcpn-header { display: flex; justify-content: space-between; align-items: center; }
.gcpn-body { display: grid; grid-template-columns: 1fr 240px; gap: 16px; padding: 14px 16px; overflow-y: auto; }
.gcpn-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; align-content: start; }
.gcpn-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-dim); }
.gcpn-field.wide, .gcpn-check.wide { grid-column: 1 / -1; }
.gcpn-input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-size: 13px; min-width: 0; }
.gcpn-input.mono { font-family: monospace; }
.gcpn-inline { display: flex; gap: 6px; }
.gcpn-inline .gcpn-input { flex: 1; }
.gcpn-check { display: flex; gap: 6px; align-items: center; font-size: 12px; cursor: pointer; }
.gcpn-check code { font-family: monospace; }
.gcpn-invalid { color: var(--red); font-size: 11px; }
.gcpn-estimate { border: 1px solid var(--border); border-radius: 8px; padding: 12px; align-self: start; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.gcpn-estimate.high { border-color: var(--red); background: color-mix(in srgb, var(--red) 6%, transparent); }
.gcpn-estimate-label { font-size: 10px; text-transform: uppercase; color: var(--text-dim); }
.gcpn-estimate-total { font-size: 18px; font-weight: 700; }
.gcpn-estimate.high .gcpn-estimate-total { color: var(--red); }
.gcpn-high { color: var(--red); font-weight: 600; }
.gcpn-item { display: flex; justify-content: space-between; gap: 8px; color: var(--text-dim); }
.gcpn-presets { grid-column: 1 / -1; border: 1px solid var(--border); border-radius: 8px; padding: 8px; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; }
.gcpn-presets legend { font-size: 12px; color: var(--text-dim); padding: 0 4px; }
.gcpn-preset { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 12px; transition: border-color .15s, background .15s; }
.gcpn-preset:hover { border-color: var(--accent); }
.gcpn-preset.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.gcpn-preset input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
.gcpn-preset input[type="radio"]:focus-visible + .gcpn-preset-name { outline: 2px solid var(--accent); outline-offset: 2px; }
.gcpn-preset-name { font-weight: 600; color: var(--text); }
.gcpn-preset-name small { font-weight: 400; color: var(--text-dim); margin-left: 4px; }
.gcpn-preset-specs { color: var(--text); }
.gcpn-preset-use { color: var(--text-dim); font-size: 11px; }
.gcpn-preset-price { color: var(--accent); font-weight: 600; margin-top: 2px; }
.gcpn-preset.other .gcpn-input { margin-top: 4px; }
.gcpn-invalid.wide { grid-column: 1 / -1; }
.gcpn-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
@media (max-width: 720px) {
  .gcpn-body { grid-template-columns: 1fr; }
  .gcpn-form { grid-template-columns: 1fr; }
}
</style>

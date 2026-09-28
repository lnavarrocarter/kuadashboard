<template>
  <div v-if="open && !reviewing" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal gcpn-modal" role="dialog" aria-modal="true">
      <div class="modal-header gcpn-header">
        <span style="font-weight:600">{{ TITLES[kind] }}</span>
        <button class="btn sm" @click="$emit('close')">✕</button>
      </div>

      <div class="gcpn-body">
        <div class="gcpn-form">
          <label class="gcpn-field">
            <span>Nombre</span>
            <input v-model.trim="form.name" class="gcpn-input" data-test="name" :placeholder="PLACEHOLDERS[kind]" />
            <small v-if="form.name && !nameValid" class="gcpn-invalid">Minúsculas, números y guiones; debe empezar con letra.</small>
          </label>

          <!-- Cloud Run -->
          <template v-if="kind === 'cloudrun'">
            <label class="gcpn-field"><span>Región</span>
              <input v-model.trim="form.region" class="gcpn-input" list="gcpn-regions" /></label>
            <label class="gcpn-field wide"><span>Imagen</span>
              <input v-model.trim="form.image" class="gcpn-input mono" /></label>
            <label class="gcpn-field"><span>CPU</span>
              <select v-model="form.cpu" class="gcpn-input"><option v-for="c in ['1','2','4']" :key="c" :value="c">{{ c }} vCPU</option></select></label>
            <label class="gcpn-field"><span>Memoria</span>
              <select v-model="form.memory" class="gcpn-input"><option v-for="m in ['512Mi','1Gi','2Gi','4Gi']" :key="m">{{ m }}</option></select></label>
            <label class="gcpn-field"><span>Min instancias</span>
              <input v-model.number="form.minInstances" type="number" min="0" max="10" class="gcpn-input" data-test="min-instances" /></label>
            <label class="gcpn-field"><span>Max instancias</span>
              <input v-model.number="form.maxInstances" type="number" min="1" max="100" class="gcpn-input" /></label>
            <label class="gcpn-check wide">
              <input v-model="form.allowUnauthenticated" type="checkbox" />
              Permitir acceso público sin autenticación (<code>allUsers</code>)
            </label>
          </template>

          <!-- Compute VM -->
          <template v-else-if="kind === 'vm'">
            <label class="gcpn-field"><span>Zona</span>
              <input v-model.trim="form.zone" class="gcpn-input" list="gcpn-zones" /></label>
            <label class="gcpn-field"><span>Tipo de máquina</span>
              <input v-model.trim="form.machineType" class="gcpn-input" list="gcpn-machine-types" data-test="machine-type" /></label>
            <label class="gcpn-field"><span>Imagen</span>
              <select v-model="form.imageKey" class="gcpn-input">
                <option v-for="img in IMAGES" :key="img.key" :value="img.key">{{ img.label }}</option>
              </select></label>
            <label class="gcpn-field"><span>Disco (GB)</span>
              <input v-model.number="form.diskSizeGb" type="number" min="10" class="gcpn-input" /></label>
            <label class="gcpn-field"><span>Tipo de disco</span>
              <select v-model="form.diskType" class="gcpn-input"><option v-for="d in ['pd-balanced','pd-standard','pd-ssd']" :key="d">{{ d }}</option></select></label>
            <label class="gcpn-check"><input v-model="form.externalIp" type="checkbox" /> IP pública</label>
            <label class="gcpn-check"><input v-model="form.spot" type="checkbox" /> Spot (más barata, puede detenerse)</label>
            <label class="gcpn-check"><input v-model="form.deletionProtection" type="checkbox" /> Protección contra eliminación</label>
          </template>

          <!-- Cloud SQL -->
          <template v-else-if="kind === 'sql'">
            <label class="gcpn-field"><span>Región</span>
              <input v-model.trim="form.region" class="gcpn-input" list="gcpn-regions" /></label>
            <label class="gcpn-field"><span>Motor</span>
              <select v-model="form.databaseVersion" class="gcpn-input">
                <option v-for="v in ['POSTGRES_16','POSTGRES_15','MYSQL_8_0','MYSQL_8_4']" :key="v">{{ v }}</option>
              </select></label>
            <label class="gcpn-field"><span>Tier</span>
              <input v-model.trim="form.tier" class="gcpn-input" list="gcpn-sql-tiers" data-test="tier" /></label>
            <label class="gcpn-field"><span>Almacenamiento (GB)</span>
              <input v-model.number="form.storageGb" type="number" min="10" class="gcpn-input" /></label>
            <label class="gcpn-field"><span>Tipo</span>
              <select v-model="form.storageType" class="gcpn-input"><option>PD_SSD</option><option>PD_HDD</option></select></label>
            <label class="gcpn-field"><span>Disponibilidad</span>
              <select v-model="form.availabilityType" class="gcpn-input" data-test="availability">
                <option value="ZONAL">Zonal</option><option value="REGIONAL">Alta disponibilidad (×2 costo)</option>
              </select></label>
            <label class="gcpn-field wide"><span>Password de root (mín. 12)</span>
              <span class="gcpn-inline">
                <input v-model="form.rootPassword" :type="showPassword ? 'text' : 'password'" class="gcpn-input mono" autocomplete="new-password" data-test="root-password" />
                <button type="button" class="btn sm" @click="showPassword = !showPassword">{{ showPassword ? 'Ocultar' : 'Ver' }}</button>
                <button type="button" class="btn sm" @click="generatePassword">Generar</button>
              </span></label>
            <label class="gcpn-check"><input v-model="form.backupEnabled" type="checkbox" /> Backups automáticos</label>
            <label class="gcpn-check"><input v-model="form.deletionProtection" type="checkbox" /> Protección contra eliminación</label>
          </template>
        </div>

        <!-- Live estimate -->
        <aside :class="['gcpn-estimate', { high: estimateData?.highCost }]" data-test="live-estimate">
          <div class="gcpn-estimate-label">Costo estimado</div>
          <div v-if="estimateLoading" class="text-dim">Calculando…</div>
          <template v-else-if="estimateData">
            <div class="gcpn-estimate-total">{{ estimateData.known ? `~$${estimateData.monthlyUsd.toFixed(2)} / mes` : 'Sin datos de precio' }}</div>
            <div v-if="estimateData.highCost" class="gcpn-high">Costo alto: requerirá una confirmación adicional.</div>
            <div v-for="item in estimateData.items" :key="item.label" class="gcpn-item"><span>{{ item.label }}</span><span>${{ item.monthlyUsd.toFixed(2) }}</span></div>
          </template>
          <div v-else-if="estimateError" class="gcpn-invalid">{{ estimateError }}</div>
        </aside>
      </div>

      <div class="modal-footer gcpn-footer">
        <button class="btn sm" @click="$emit('close')">Cancelar</button>
        <button class="btn sm primary" :disabled="!formValid" data-test="review" @click="reviewing = true">Revisar y crear…</button>
      </div>

      <datalist id="gcpn-regions"><option v-for="r in REGIONS" :key="r" :value="r" /></datalist>
      <datalist id="gcpn-zones"><option v-for="z in REGIONS.map(r => r + '-a')" :key="z" :value="z" /></datalist>
      <datalist id="gcpn-machine-types"><option v-for="m in MACHINE_TYPES" :key="m" :value="m" /></datalist>
      <datalist id="gcpn-sql-tiers"><option v-for="t in SQL_TIERS" :key="t" :value="t" /></datalist>
    </div>
  </div>

  <GcpConfirmModal
    :open="open && reviewing"
    :title="`Crear ${KIND_LABELS[kind]} ${form.name}`"
    :message="'Revisa la configuración y el costo antes de crear el recurso.'"
    :lines="reviewLines"
    tone="warning"
    :require-name="form.name"
    cost-ack
    :estimate="estimateData"
    :estimate-loading="estimateLoading"
    :busy="creating"
    :error="createError"
    confirm-label="Crear recurso"
    @cancel="reviewing = false; createError = ''"
    @confirm="create"
  />
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useGcpStore } from '../../stores/useGcpStore'
import GcpConfirmModal from './GcpConfirmModal.vue'

const props = defineProps({
  open:          { type: Boolean, default: false },
  kind:          { type: String,  required: true },   // cloudrun | vm | sql
  defaultRegion: { type: String,  default: 'us-central1' },
})
const emit = defineEmits(['close', 'created'])

const gcpStore = useGcpStore()

const TITLES = { cloudrun: 'Nuevo servicio Cloud Run', vm: 'Nueva VM de Compute Engine', sql: 'Nueva instancia Cloud SQL' }
const KIND_LABELS = { cloudrun: 'servicio Cloud Run', vm: 'VM', sql: 'instancia Cloud SQL' }
const PLACEHOLDERS = { cloudrun: 'mi-servicio', vm: 'mi-vm', sql: 'mi-base' }
const NAME_RULES = {
  cloudrun: /^[a-z](?:[a-z0-9-]{0,47}[a-z0-9])?$/,
  vm: /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  sql: /^[a-z](?:[a-z0-9-]{0,96}[a-z0-9])?$/,
}
const REGIONS = ['us-central1', 'us-east1', 'us-west1', 'southamerica-east1', 'southamerica-west1', 'europe-west1', 'asia-east1']
const MACHINE_TYPES = ['e2-micro', 'e2-small', 'e2-medium', 'e2-standard-2', 'e2-standard-4', 'n2-standard-2', 'n2-standard-4', 'n2d-standard-2']
const SQL_TIERS = ['db-f1-micro', 'db-g1-small', 'db-custom-1-3840', 'db-custom-2-7680', 'db-custom-4-15360']
const IMAGES = [
  { key: 'debian-12', label: 'Debian 12', project: 'debian-cloud', family: 'debian-12' },
  { key: 'ubuntu-2404', label: 'Ubuntu 24.04 LTS', project: 'ubuntu-os-cloud', family: 'ubuntu-2404-lts-amd64' },
  { key: 'rocky-9', label: 'Rocky Linux 9', project: 'rocky-linux-cloud', family: 'rocky-linux-9' },
]

function defaults(kind) {
  const region = props.defaultRegion || 'us-central1'
  if (kind === 'cloudrun') return { name: '', region, image: 'us-docker.pkg.dev/cloudrun/container/hello', cpu: '1', memory: '512Mi', minInstances: 0, maxInstances: 3, allowUnauthenticated: false }
  if (kind === 'vm') return { name: '', zone: `${region}-a`, machineType: 'e2-small', imageKey: 'debian-12', diskSizeGb: 10, diskType: 'pd-balanced', externalIp: true, spot: false, deletionProtection: false }
  return { name: '', region, databaseVersion: 'POSTGRES_16', tier: 'db-f1-micro', storageGb: 10, storageType: 'PD_SSD', availabilityType: 'ZONAL', rootPassword: '', backupEnabled: true, deletionProtection: true }
}

const form = reactive(defaults(props.kind))
const reviewing = ref(false)
const creating = ref(false)
const createError = ref('')
const showPassword = ref(false)

watch(() => [props.open, props.kind], ([open]) => {
  if (!open) return
  Object.keys(form).forEach(k => delete form[k])
  Object.assign(form, defaults(props.kind))
  reviewing.value = false
  createError.value = ''
  showPassword.value = false
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
    const { imageKey, ...rest } = form
    const img = IMAGES.find(i => i.key === imageKey) || IMAGES[0]
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
    `Región ${f.region} · imagen ${f.image}`,
    `${f.cpu} vCPU, ${f.memory} · instancias ${f.minInstances}–${f.maxInstances}`,
    f.allowUnauthenticated ? '⚠ El servicio quedará PÚBLICO: cualquiera en Internet podrá invocarlo.' : 'Acceso privado: requiere autenticación IAM.',
  ]
  if (props.kind === 'vm') return [
    `Zona ${f.zone} · ${f.machineType}${f.spot ? ' (Spot)' : ''}`,
    `Disco de ${f.diskSizeGb} GB ${f.diskType} · ${IMAGES.find(i => i.key === f.imageKey)?.label}`,
    f.externalIp ? '⚠ Tendrá una IP pública expuesta a Internet (red "default").' : 'Sin IP pública.',
    f.deletionProtection ? 'Protección contra eliminación activada.' : 'Sin protección contra eliminación.',
  ]
  return [
    `Región ${f.region} · ${f.databaseVersion} · ${f.tier}`,
    `${f.storageGb} GB ${f.storageType} · ${f.availabilityType === 'REGIONAL' ? 'alta disponibilidad' : 'zonal'}`,
    f.backupEnabled ? 'Backups automáticos activados.' : '⚠ Sin backups automáticos.',
    f.deletionProtection ? 'Protección contra eliminación activada.' : '⚠ Sin protección contra eliminación.',
    'La creación tarda varios minutos; la instancia aparecerá como PENDING_CREATE.',
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
.gcpn-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
@media (max-width: 720px) {
  .gcpn-body { grid-template-columns: 1fr; }
  .gcpn-form { grid-template-columns: 1fr; }
}
</style>

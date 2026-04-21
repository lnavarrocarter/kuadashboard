<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @mousedown.self="$emit('close')">
      <div class="modal-box" style="width:540px">
        <div class="modal-header">
          <span>{{ isEdit ? t('profile.editTitle') : t('profile.createTitle') }}</span>
          <button class="btn-close" @click="$emit('close')">✕</button>
        </div>

        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <!-- Name -->
          <label class="field-label">
            {{ t('profile.nameLabel') }}
            <input v-model="form.name" class="ctrl-input" placeholder="e.g. my-gcp-prod" />
          </label>

          <!-- Category -->
          <label class="field-label">
            {{ t('profile.categoryLabel') }} <span class="text-dim" style="font-weight:normal">{{ t('profile.categoryHint') }}</span>
            <input v-model="form.category" class="ctrl-input" placeholder="e.g. backend, infra, staging…" />
          </label>

          <!-- Provider -->
          <label class="field-label">
            {{ t('profile.providerLabel') }}
            <select v-model="form.provider" class="ctrl-select" :disabled="isEdit" @change="gcpAuthMode = 'sa'">
              <option value="gcp">Google Cloud (GCP)</option>
              <option value="aws">Amazon Web Services (AWS)</option>
              <option value="generic">Generic / Other</option>
            </select>
          </label>

          <!-- GCP auth mode toggle -->
          <template v-if="form.provider === 'gcp' && !isEdit">
            <div class="auth-mode-tabs">
              <button
                :class="['auth-mode-tab', { active: gcpAuthMode === 'sa' }]"
                @click="gcpAuthMode = 'sa'"
              >Service Account JSON</button>
              <button
                :class="['auth-mode-tab', { active: gcpAuthMode === 'gcloud' }]"
                @click="gcpAuthMode = 'gcloud'; loadGcloudConfigs(); loadGcloudAccounts()"
              >gcloud CLI (auto-auth)</button>
            </div>
          </template>

          <!-- Key fields — dynamic per provider / mode -->
          <div style="display:flex;flex-direction:column;gap:10px">

            <!-- GCP → Service Account -->
            <template v-if="form.provider === 'gcp' && (isEdit || gcpAuthMode === 'sa')">
              <div class="field-label" style="margin-bottom:4px">
                Keys
                <span class="text-dim" style="font-weight:normal"> ({{ isEdit ? 'leave blank to keep existing value' : 'required' }})</span>
              </div>
              <label class="field-label">
                GCP_PROJECT_ID
                <input v-model="form.keys.GCP_PROJECT_ID" class="ctrl-input" placeholder="my-project-id" />
              </label>
              <label class="field-label">
                GCP_SERVICE_ACCOUNT_JSON
                <textarea v-model="form.keys.GCP_SERVICE_ACCOUNT_JSON" class="ctrl-input code-input"
                  rows="6" placeholder='Paste full Service Account JSON here...' />
              </label>
            </template>

            <!-- GCP → gcloud CLI auto-auth -->
            <template v-else-if="form.provider === 'gcp' && gcpAuthMode === 'gcloud'">
              <!-- Info banner -->
              <div class="gcloud-info-box">
                <strong>gcloud CLI authentication</strong><br/>
                This creates a local gcloud configuration linked to your Google account.
                No credentials are stored in KuaDashboard — the app uses
                <code>gcloud auth print-access-token</code> each time.
              </div>

              <!-- Existing configs list -->
              <div class="field-label" style="margin-bottom:2px">Existing gcloud configurations</div>
              <div v-if="gcloudConfigsLoading" class="text-dim" style="font-size:12px;padding:4px 0">Loading…</div>
              <div v-else-if="!gcloudConfigs.length" class="text-dim" style="font-size:12px;padding:4px 0">
                No configurations found — authenticate below to create one.
              </div>
              <div v-else class="gcloud-config-list">
                <div
                  v-for="c in gcloudConfigs"
                  :key="c.name"
                  :class="['gcloud-config-row', { selected: gcpSelectedConfig === c.name }]"
                  @click="gcpSelectedConfig = c.name; form.name = form.name || c.name"
                >
                  <div class="gcloud-config-name">
                    {{ c.name }}
                    <span v-if="c.isActive" class="gcloud-badge">active</span>
                  </div>
                  <div class="gcloud-config-meta text-dim">
                    {{ c.account || 'no account' }}
                    {{ c.project ? ` · ${c.project}` : '' }}
                  </div>
                </div>
              </div>

              <!-- Refresh configs -->
              <button class="btn sm" @click="loadGcloudConfigs" :disabled="gcloudConfigsLoading">
                ↻ Refresh list
              </button>

              <!-- New config section -->
              <div class="field-label" style="margin-top:6px">Crear nueva configuración</div>
              <div style="display:flex;gap:8px">
                <label class="field-label" style="flex:1;margin:0">
                  Nombre de config
                  <input v-model="gcpNewConfigName" class="ctrl-input" placeholder="e.g. my-project-prod" />
                </label>
                <label class="field-label" style="flex:1;margin:0">
                  Project ID
                  <input v-model="gcpNewConfigProject" class="ctrl-input" placeholder="my-gcp-project" />
                </label>
              </div>

              <!-- Account selector (already-authenticated accounts) -->
              <label class="field-label" style="margin:0">
                Cuenta Google
                <div style="display:flex;gap:6px;align-items:center">
                  <select v-model="gcpNewConfigAccount" class="ctrl-select" style="flex:1">
                    <option value="">— nueva cuenta (abre navegador) —</option>
                    <option v-for="a in gcloudAccounts" :key="a.account" :value="a.account">
                      {{ a.account }}{{ a.status === 'ACTIVE' ? ' ★' : '' }}
                    </option>
                  </select>
                  <button class="btn sm" :disabled="gcloudConfigsLoading" @click="loadGcloudAccounts" title="Refrescar cuentas">↻</button>
                </div>
              </label>

              <!-- Action buttons: create config (existing account) OR gcloud auth login (new account) -->
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button
                  class="btn primary"
                  :disabled="!gcpNewConfigName.trim() || gcpCreatePending"
                  @click="createGcloudConfig"
                >
                  {{ gcpCreatePending ? 'Creando…' : '+ Crear configuración' }}
                </button>
                <span class="text-dim" style="font-size:11px">o</span>
                <button
                  class="btn"
                  :disabled="gcloudLoginPending"
                  @click="launchGcloudLogin"
                >
                  {{ gcloudLoginPending ? 'Abriendo navegador…' : '🔑 Auth con nueva cuenta' }}
                </button>
              </div>
              <span v-if="gcloudLoginMsg" :class="gcloudLoginErr ? 'text-red' : 'text-dim'" style="font-size:12px">
                {{ gcloudLoginMsg }}
              </span>

              <!-- Select config to use -->
              <div v-if="gcloudConfigs.length" style="margin-top:4px">
                <label class="field-label">
                  Usar configuración
                  <select v-model="gcpSelectedConfig" class="ctrl-select">
                    <option value="">— seleccionar —</option>
                    <option v-for="c in gcloudConfigs" :key="c.name" :value="c.name">
                      {{ c.name }}{{ c.account ? ` (${c.account})` : '' }}{{ c.project ? ` · ${c.project}` : '' }}
                    </option>
                  </select>
                </label>
              </div>
            </template>

            <!-- AWS fields -->
            <template v-else-if="form.provider === 'aws'">
              <div class="field-label" style="margin-bottom:4px">
                Keys
                <span class="text-dim" style="font-weight:normal"> ({{ isEdit ? 'leave blank to keep existing value' : 'required' }})</span>
              </div>
              <label class="field-label">
                AWS_ACCESS_KEY_ID
                <input v-model="form.keys.AWS_ACCESS_KEY_ID" class="ctrl-input" placeholder="AKIAIOSFODNN7EXAMPLE" />
              </label>
              <label class="field-label">
                AWS_SECRET_ACCESS_KEY
                <input v-model="form.keys.AWS_SECRET_ACCESS_KEY" class="ctrl-input" type="password" placeholder="••••••••••••••••••••" />
              </label>
              <label class="field-label">
                AWS_DEFAULT_REGION
                <input v-model="form.keys.AWS_DEFAULT_REGION" class="ctrl-input" placeholder="us-east-1" />
              </label>
            </template>

            <!-- Generic: dynamic key-value pairs with tags -->
            <template v-else>
              <div
                v-for="(pair, idx) in form.genericPairs"
                :key="idx"
                style="border:1px solid var(--border,#333);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:6px"
              >
                <div style="display:flex;gap:8px;align-items:center">
                  <input v-model="pair.key"   class="ctrl-input" style="flex:1" placeholder="KEY_NAME" />
                  <input v-model="pair.value" class="ctrl-input" style="flex:2" placeholder="value" />
                  <button class="btn sm" style="color:var(--red)" @click="removePair(idx)">✕</button>
                </div>
                <!-- Tags for this key -->
                <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
                  <span
                    v-for="(tag, ti) in pair.tags"
                    :key="ti"
                    style="display:inline-flex;align-items:center;gap:3px;background:var(--bg-alt,#2a2a3a);border:1px solid var(--border,#444);border-radius:12px;padding:1px 8px;font-size:11px"
                  >
                    {{ tag }}
                    <button style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:10px;padding:0" @click="removeTag(idx, ti)">✕</button>
                  </span>
                  <input
                    v-model="pair.newTag"
                    class="ctrl-input"
                    style="font-size:11px;padding:1px 6px;height:22px;width:90px"
                    placeholder="+ tag"
                    @keydown.enter.prevent="addTag(idx)"
                  />
                  <button class="btn sm" style="padding:0 6px;height:22px;font-size:11px" @click="addTag(idx)">Add</button>
                </div>
              </div>
              <button class="btn sm" @click="addPair" style="align-self:flex-start">+ Add Key</button>
            </template>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" @click="$emit('close')">{{ t('action.cancel') }}</button>
          <!-- gcloud mode: "Use Config" instead of "Create Profile" -->
          <template v-if="form.provider === 'gcp' && gcpAuthMode === 'gcloud' && !isEdit">
            <button
              class="btn primary"
              :disabled="!gcpSelectedConfig"
              @click="submitGcloud"
            >Use Selected Config</button>
          </template>
          <template v-else>
            <button
              class="btn primary"
              :disabled="!canSave"
              @click="submit"
            >
              {{ isEdit ? t('action.save') : t('profile.saveBtn') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from '../../composables/useI18n.js'

const { t } = useI18n()

const props = defineProps({
  show:            { type: Boolean, default: false },
  profile:         { type: Object,  default: null },   // null = create mode
  defaultProvider: { type: String,  default: 'gcp' },  // pre-select provider in create mode
})
const emit = defineEmits(['close', 'save'])

const isEdit = computed(() => !!props.profile)

// ── gcloud CLI mode state ──────────────────────────────────────────────────────
const gcpAuthMode         = ref('sa')         // 'sa' | 'gcloud'
const gcloudConfigs       = ref([])
const gcloudAccounts      = ref([])
const gcloudConfigsLoading = ref(false)
const gcpSelectedConfig   = ref('')
const gcpNewConfigName    = ref('')
const gcpNewConfigProject = ref('')
const gcpNewConfigAccount = ref('')
const gcpCreatePending    = ref(false)
const gcloudLoginPending  = ref(false)
const gcloudLoginMsg      = ref('')
const gcloudLoginErr      = ref(false)

async function loadGcloudConfigs() {
  gcloudConfigsLoading.value = true
  try {
    const res = await fetch('/api/cloud/gcp/gcloud-configs')
    gcloudConfigs.value = await res.json()
  } catch {
    gcloudConfigs.value = []
  } finally {
    gcloudConfigsLoading.value = false
  }
}

async function loadGcloudAccounts() {
  try {
    const res = await fetch('/api/cloud/gcp/gcloud-accounts')
    gcloudAccounts.value = await res.json()
  } catch {
    gcloudAccounts.value = []
  }
}

async function createGcloudConfig() {
  const name    = gcpNewConfigName.value.trim()
  const project = gcpNewConfigProject.value.trim()
  const account = gcpNewConfigAccount.value
  if (!name) return

  gcpCreatePending.value = true
  gcloudLoginMsg.value   = ''
  gcloudLoginErr.value   = false
  try {
    const res  = await fetch('/api/cloud/gcp/gcloud-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, project: project || undefined, account: account || undefined }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al crear configuración')
    gcloudLoginMsg.value = `Configuración "${name}" creada. Selecciónala abajo.`
    await loadGcloudConfigs()
    gcpSelectedConfig.value = name
  } catch (e) {
    gcloudLoginMsg.value = e.message
    gcloudLoginErr.value = true
  } finally {
    gcpCreatePending.value = false
  }
}

async function launchGcloudLogin() {
  gcloudLoginPending.value = true
  gcloudLoginMsg.value     = ''
  gcloudLoginErr.value     = false
  try {
    const body = {}
    if (gcpNewConfigName.value.trim()) body.configName = gcpNewConfigName.value.trim()
    const res  = await fetch('/api/cloud/gcp/gcloud-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'gcloud login failed')
    gcloudLoginMsg.value = data.message || 'Navegador abierto — completa el OAuth y haz clic en Refresh.'
    setTimeout(() => { loadGcloudConfigs(); loadGcloudAccounts() }, 4000)
  } catch (e) {
    gcloudLoginMsg.value = e.message
    gcloudLoginErr.value = true
  } finally {
    gcloudLoginPending.value = false
  }
}

function submitGcloud() {
  if (!gcpSelectedConfig.value) return
  // Emit a special save event with gcpAuthMode = 'gcloud' and profileId = 'local:<configName>'
  // App.vue's handleConnectionSave will pick this up and call selectProfile instead of createProfile
  emit('save', {
    gcpAuthMode: 'gcloud',
    profileId:   `local:${gcpSelectedConfig.value}`,
    provider:    'gcp',
  })
}

// ── Regular profile form ───────────────────────────────────────────────────────
const defaultForm = () => ({
  name:     '',
  category: '',
  provider: props.defaultProvider || 'gcp',
  keys: {
    GCP_PROJECT_ID: '',
    GCP_SERVICE_ACCOUNT_JSON: '',
    AWS_ACCESS_KEY_ID: '',
    AWS_SECRET_ACCESS_KEY: '',
    AWS_DEFAULT_REGION: '',
  },
  genericPairs: [{ key: '', value: '', tags: [], newTag: '' }],
})

const form = ref(defaultForm())

watch(() => props.show, (v) => {
  if (!v) return
  // Reset gcloud state each time modal opens
  gcpAuthMode.value         = 'sa'
  gcpSelectedConfig.value   = ''
  gcpNewConfigName.value    = ''
  gcpNewConfigProject.value = ''
  gcpNewConfigAccount.value = ''
  gcloudLoginMsg.value      = ''
  gcloudLoginErr.value      = false
  gcloudConfigs.value       = []
  gcloudAccounts.value      = []

  if (props.profile) {
    form.value = {
      name:     props.profile.name,
      category: props.profile.category || '',
      provider: props.profile.provider,
      keys: {
        GCP_PROJECT_ID: '',
        GCP_SERVICE_ACCOUNT_JSON: '',
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        AWS_DEFAULT_REGION: '',
      },
      genericPairs: props.profile.keyNames?.map(k => ({
        key: k, value: '', tags: props.profile.meta?.[k]?.tags?.slice() || [], newTag: '',
      })) || [{ key: '', value: '', tags: [], newTag: '' }],
    }
  } else {
    form.value = defaultForm()   // uses props.defaultProvider
  }
})

const canSave = computed(() => form.value.name.trim().length > 0)

function addPair()       { form.value.genericPairs.push({ key: '', value: '', tags: [], newTag: '' }) }
function removePair(idx) { form.value.genericPairs.splice(idx, 1) }

function addTag(idx) {
  const pair = form.value.genericPairs[idx]
  const t = pair.newTag.trim()
  if (t && !pair.tags.includes(t)) pair.tags.push(t)
  pair.newTag = ''
}
function removeTag(pairIdx, tagIdx) {
  form.value.genericPairs[pairIdx].tags.splice(tagIdx, 1)
}

function submit() {
  const { name, category, provider, keys, genericPairs } = form.value
  let finalKeys = {}
  let finalMeta = {}

  if (provider === 'gcp') {
    if (keys.GCP_PROJECT_ID)            finalKeys.GCP_PROJECT_ID = keys.GCP_PROJECT_ID
    if (keys.GCP_SERVICE_ACCOUNT_JSON)  finalKeys.GCP_SERVICE_ACCOUNT_JSON = keys.GCP_SERVICE_ACCOUNT_JSON
  } else if (provider === 'aws') {
    if (keys.AWS_ACCESS_KEY_ID)         finalKeys.AWS_ACCESS_KEY_ID = keys.AWS_ACCESS_KEY_ID
    if (keys.AWS_SECRET_ACCESS_KEY)     finalKeys.AWS_SECRET_ACCESS_KEY = keys.AWS_SECRET_ACCESS_KEY
    if (keys.AWS_DEFAULT_REGION)        finalKeys.AWS_DEFAULT_REGION = keys.AWS_DEFAULT_REGION
  } else {
    for (const pair of genericPairs) {
      if (pair.key.trim()) {
        finalKeys[pair.key.trim()] = pair.value
        if (pair.tags.length) finalMeta[pair.key.trim()] = { tags: pair.tags }
      }
    }
  }

  emit('save', { name: name.trim(), category: category.trim(), provider, keys: finalKeys, meta: finalMeta })
}
</script>

<style scoped>
/* Auth mode tabs */
.auth-mode-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-alt, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 4px;
}
.auth-mode-tab {
  flex: 1;
  padding: 6px 10px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  background: transparent;
  color: var(--text-dim, #888);
  transition: background 0.15s, color 0.15s;
}
.auth-mode-tab.active {
  background: var(--accent, #5b6ef5);
  color: #fff;
}
.auth-mode-tab:hover:not(.active) {
  background: var(--bg, #2a2a3a);
  color: var(--text, #ddd);
}

/* gcloud info box */
.gcloud-info-box {
  background: var(--bg-alt, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-left: 3px solid var(--accent, #5b6ef5);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-dim, #aaa);
  line-height: 1.5;
}
.gcloud-info-box code {
  background: var(--bg, #111);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--text, #ddd);
}

/* gcloud config list */
.gcloud-config-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}
.gcloud-config-row {
  padding: 7px 10px;
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.gcloud-config-row:hover {
  background: var(--bg-alt, #2a2a3a);
}
.gcloud-config-row.selected {
  border-color: var(--accent, #5b6ef5);
  background: color-mix(in srgb, var(--accent, #5b6ef5) 12%, transparent);
}
.gcloud-config-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #ddd);
  display: flex;
  align-items: center;
  gap: 6px;
}
.gcloud-config-meta {
  font-size: 11px;
  margin-top: 2px;
}
.gcloud-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--accent, #5b6ef5);
  color: #fff;
  font-weight: 500;
}
.text-red { color: var(--red, #f55); }
</style>

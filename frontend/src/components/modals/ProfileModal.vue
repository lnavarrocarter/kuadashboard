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
            <select v-model="form.provider" class="ctrl-select" :disabled="isEdit" @change="gcpAuthMode = 'sa'; awsAuthMode = 'manual'">
              <option value="gcp">Google Cloud (GCP)</option>
              <option value="aws">Amazon Web Services (AWS)</option>
              <option value="vercel">Vercel</option>
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

          <!-- AWS auth mode toggle -->
          <template v-if="form.provider === 'aws'">
            <div class="auth-mode-tabs">
              <button
                :class="['auth-mode-tab', { active: awsAuthMode === 'manual' }]"
                @click="awsAuthMode = 'manual'"
              >Ingresar manualmente</button>
              <button
                :class="['auth-mode-tab', { active: awsAuthMode === 'sso' }]"
                @click="switchToAwsSso"
              >Iniciar sesión temporal (SSO)</button>
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

            <!-- Vercel fields -->
            <template v-else-if="form.provider === 'vercel'">
              <!-- OAuth button — only available inside Electron -->
              <div v-if="isElectron && !isEdit" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
                <button
                  class="btn primary"
                  style="justify-content:center;gap:8px;background:#000;border-color:#333;color:#fff"
                  :disabled="oauthPending"
                  @click="startVercelOAuth"
                >
                  <!-- Vercel triangle logo -->
                  <svg width="14" height="12" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>
                  {{ oauthPending ? 'Waiting for authorization…' : 'Connect with Vercel' }}
                </button>
                <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-dim)">
                  <hr style="flex:1;border-color:var(--border)" />
                  or enter token manually
                  <hr style="flex:1;border-color:var(--border)" />
                </div>
              </div>
              <div class="field-label" style="margin-bottom:4px">
                Keys
                <span class="text-dim" style="font-weight:normal"> ({{ isEdit ? 'leave blank to keep existing value' : 'required' }})</span>
              </div>
              <label class="field-label">
                VERCEL_API_TOKEN
                <input v-model="form.keys.VERCEL_API_TOKEN" class="ctrl-input" type="password" placeholder="••••••••••••••••••••" />
              </label>
              <label class="field-label">
                VERCEL_TEAM_ID
                <span class="text-dim" style="font-weight:normal;font-size:11px"> (optional — for team accounts)</span>
                <input v-model="form.keys.VERCEL_TEAM_ID" class="ctrl-input" placeholder="team_XXXXXXXXXXXX" />
              </label>
            </template>

            <!-- AWS → manual keys -->
            <template v-else-if="form.provider === 'aws' && awsAuthMode === 'manual'">
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
                AWS_SESSION_TOKEN
                <span class="text-dim" style="font-weight:normal;font-size:11px"> (optional — for temporary credentials: STS / IAM Identity Center / SSO)</span>
                <textarea v-model="form.keys.AWS_SESSION_TOKEN" class="ctrl-input code-input" rows="3"
                  placeholder="IQoJb3JpZ2luX2VjE... (leave empty for permanent keys)"></textarea>
              </label>
              <label class="field-label">
                AWS_DEFAULT_REGION
                <input v-model="form.keys.AWS_DEFAULT_REGION" class="ctrl-input" placeholder="us-east-1" />
              </label>
            </template>

            <!-- AWS → SSO temporary session (IAM Identity Center) -->
            <template v-else-if="form.provider === 'aws' && awsAuthMode === 'sso'">
              <div class="gcloud-info-box">
                <strong>Sesión temporal con IAM Identity Center (SSO)</strong><br/>
                Se abre el login de AWS en tu navegador; al aprobar, las credenciales temporales
                (access key, secret y session token) se capturan y guardan automáticamente.
                Cuando la sesión expire podrás renovarla con un clic.
              </div>

              <!-- Detected SSO profiles from ~/.aws/config -->
              <label class="field-label" style="margin:0">
                Perfil SSO detectado (~/.aws/config)
                <div style="display:flex;gap:6px;align-items:center">
                  <select v-model="ssoSelectedLocal" class="ctrl-select" style="flex:1" :disabled="ssoBusy">
                    <option value="">— configurar manualmente —</option>
                    <option v-for="p in ssoLocalProfiles" :key="p.name" :value="p.name">
                      {{ p.name }}{{ p.accountId ? ` · ${p.accountId}` : '' }}{{ p.roleName ? ` (${p.roleName})` : '' }}
                    </option>
                  </select>
                  <button class="btn sm" :disabled="ssoBusy" @click="loadSsoLocalProfiles" title="Refrescar perfiles">↻</button>
                </div>
              </label>

              <!-- Manual start URL (when no detected profile selected) -->
              <template v-if="!ssoSelectedLocal">
                <label class="field-label" style="margin:0">
                  URL de inicio de SSO
                  <input v-model="ssoStartUrl" class="ctrl-input" :disabled="ssoBusy"
                    placeholder="https://identitycenter.amazonaws.com/ssoins-... o https://mi-org.awsapps.com/start" />
                </label>
                <label class="field-label" style="margin:0">
                  Región de SSO
                  <input v-model="ssoRegionInput" class="ctrl-input" :disabled="ssoBusy" placeholder="us-east-1" />
                </label>
              </template>

              <!-- Login button + status -->
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button class="btn primary" :disabled="ssoBusy || sso.phase.value === 'waiting'" @click="runSsoLogin">
                  {{ sso.phase.value === 'waiting' ? 'Esperando aprobación en el navegador…' : '🔑 Iniciar sesión en AWS' }}
                </button>
                <a v-if="sso.phase.value === 'waiting' && sso.verificationUrl.value"
                   :href="sso.verificationUrl.value" target="_blank"
                   style="font-size:11px;color:var(--accent)">reabrir página de login</a>
              </div>
              <span v-if="sso.phase.value === 'waiting' && sso.userCode.value" class="text-dim" style="font-size:12px">
                Código de verificación: <code>{{ sso.userCode.value }}</code>
              </span>
              <span v-if="ssoError" class="text-red" style="font-size:12px">{{ ssoError }}</span>

              <!-- Account / role pickers (manual start URL without preconfigured account) -->
              <template v-if="ssoAccounts.length">
                <label class="field-label" style="margin:0">
                  Cuenta AWS
                  <select v-model="ssoAccountId" class="ctrl-select" :disabled="ssoBusy">
                    <option value="">— seleccionar cuenta —</option>
                    <option v-for="a in ssoAccounts" :key="a.accountId" :value="a.accountId">
                      {{ a.accountName }} ({{ a.accountId }})
                    </option>
                  </select>
                </label>
                <label class="field-label" style="margin:0">
                  Rol
                  <select v-model="ssoRoleName" class="ctrl-select" :disabled="ssoBusy || !ssoAccountId">
                    <option value="">— seleccionar rol —</option>
                    <option v-for="r in ssoSelectedAccountRoles" :key="r" :value="r">{{ r }}</option>
                  </select>
                </label>
                <button class="btn primary" style="align-self:flex-start"
                        :disabled="ssoBusy || !ssoAccountId || !ssoRoleName"
                        @click="captureSsoCredentials(ssoAccountId, ssoRoleName)">
                  {{ ssoBusy ? 'Obteniendo credenciales…' : 'Obtener credenciales' }}
                </button>
              </template>

              <!-- Captured credentials summary -->
              <div v-if="ssoCaptured" class="gcloud-info-box" style="border-left-color:var(--green,#3fbf6f)">
                ✅ <strong>Credenciales capturadas</strong> — cuenta {{ ssoMeta.accountId }} · rol {{ ssoMeta.roleName }}<br/>
                La sesión expira {{ formatSsoExpiry(ssoCaptured.expiresAt) }}.
                Guarda el perfil para terminar.
              </div>

              <!-- Region (editable, prefilled from the SSO profile) -->
              <label v-if="ssoCaptured" class="field-label" style="margin:0">
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../composables/useI18n.js'
import { useAwsSso } from '../../composables/useAwsSso.js'

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

// ── AWS SSO mode state ─────────────────────────────────────────────────────────
const awsAuthMode      = ref('manual')   // 'manual' | 'sso'
const sso              = useAwsSso()
const ssoLocalProfiles = ref([])
const ssoSelectedLocal = ref('')         // name of a detected ~/.aws/config profile, '' = manual
const ssoStartUrl      = ref('')
const ssoRegionInput   = ref('us-east-1')
const ssoAccounts      = ref([])
const ssoAccountId     = ref('')
const ssoRoleName      = ref('')
const ssoBusy          = ref(false)
const ssoError         = ref('')
const ssoCaptured      = ref(null)       // { expiresAt } once credentials are filled in
const ssoMeta          = ref(null)       // { startUrl, ssoRegion, accountId, roleName, expiresAt }
let   ssoActive        = null            // { startUrl, ssoRegion, defaultRegion } of the running login

const ssoSelectedAccountRoles = computed(() =>
  ssoAccounts.value.find(a => a.accountId === ssoAccountId.value)?.roles || [])

function resetSsoState() {
  sso.reset()
  ssoSelectedLocal.value = ''
  ssoStartUrl.value      = ''
  ssoRegionInput.value   = 'us-east-1'
  ssoAccounts.value      = []
  ssoAccountId.value     = ''
  ssoRoleName.value      = ''
  ssoBusy.value          = false
  ssoError.value         = ''
  ssoCaptured.value      = null
  ssoMeta.value          = null
  ssoActive              = null
}

function switchToAwsSso() {
  awsAuthMode.value = 'sso'
  loadSsoLocalProfiles()
}

async function loadSsoLocalProfiles() {
  ssoLocalProfiles.value = await sso.fetchLocalSsoProfiles()
  // Preselect when there is exactly one detected profile
  if (ssoLocalProfiles.value.length === 1 && !ssoSelectedLocal.value)
    ssoSelectedLocal.value = ssoLocalProfiles.value[0].name
}

async function runSsoLogin() {
  ssoError.value    = ''
  ssoAccounts.value = []
  ssoCaptured.value = null

  let startUrl = ssoStartUrl.value.trim()
  let region   = ssoRegionInput.value.trim() || 'us-east-1'
  let accountId = '', roleName = '', defaultRegion = ''
  const localProf = ssoLocalProfiles.value.find(p => p.name === ssoSelectedLocal.value)
  if (localProf) {
    startUrl      = localProf.startUrl
    region        = localProf.ssoRegion
    accountId     = localProf.accountId
    roleName      = localProf.roleName
    defaultRegion = localProf.region
  }
  if (!startUrl) { ssoError.value = 'Selecciona un perfil o ingresa la URL de inicio de SSO'; return }

  ssoBusy.value = true
  ssoActive     = { startUrl, ssoRegion: region, defaultRegion }
  try {
    await sso.startLogin({ startUrl, ssoRegion: region })
    if (accountId && roleName) {
      await captureSsoCredentials(accountId, roleName)
    } else {
      ssoAccounts.value = await sso.fetchAccounts()
      if (ssoAccounts.value.length === 1) {
        ssoAccountId.value = ssoAccounts.value[0].accountId
        if (ssoAccounts.value[0].roles.length === 1) {
          ssoRoleName.value = ssoAccounts.value[0].roles[0]
          await captureSsoCredentials(ssoAccountId.value, ssoRoleName.value)
        }
      }
    }
  } catch (e) {
    if (e.message !== 'cancelled') ssoError.value = e.message
  } finally {
    ssoBusy.value = false
  }
}

async function captureSsoCredentials(accountId, roleName) {
  ssoBusy.value  = true
  ssoError.value = ''
  try {
    const creds = await sso.fetchCredentials(accountId, roleName)
    form.value.keys.AWS_ACCESS_KEY_ID     = creds.accessKeyId
    form.value.keys.AWS_SECRET_ACCESS_KEY = creds.secretAccessKey
    form.value.keys.AWS_SESSION_TOKEN     = creds.sessionToken
    if (!form.value.keys.AWS_DEFAULT_REGION)
      form.value.keys.AWS_DEFAULT_REGION = ssoActive?.defaultRegion || 'us-east-1'
    if (!form.value.name.trim())
      form.value.name = ssoSelectedLocal.value || `aws-sso-${accountId}`
    ssoMeta.value = {
      startUrl:  ssoActive.startUrl,
      ssoRegion: ssoActive.ssoRegion,
      accountId, roleName,
      expiresAt: creds.expiration,
    }
    ssoCaptured.value = { expiresAt: creds.expiration }
  } catch (e) {
    ssoError.value = e.message
  } finally {
    ssoBusy.value = false
  }
}

function formatSsoExpiry(epochMs) {
  if (!epochMs) return 'pronto'
  const d    = new Date(epochMs)
  const mins = Math.max(0, Math.round((epochMs - Date.now()) / 60000))
  const rel  = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  return `a las ${d.toLocaleTimeString()} (en ${rel})`
}

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
    AWS_SESSION_TOKEN: '',
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
  awsAuthMode.value         = 'manual'
  resetSsoState()

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
        AWS_SESSION_TOKEN: '',
        AWS_DEFAULT_REGION: '',
        VERCEL_API_TOKEN: '',
        VERCEL_TEAM_ID: '',
      },
      genericPairs: props.profile.keyNames?.map(k => ({
        key: k, value: '', tags: props.profile.meta?.[k]?.tags?.slice() || [], newTag: '',
      })) || [{ key: '', value: '', tags: [], newTag: '' }],
    }
  } else {
    form.value = defaultForm()   // uses props.defaultProvider
  }
})

const canSave = computed(() => {
  if (!form.value.name.trim()) return false
  // SSO mode on a new profile: credentials must be captured before saving
  if (form.value.provider === 'aws' && awsAuthMode.value === 'sso' && !isEdit.value && !ssoCaptured.value)
    return false
  return true
})

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
    if (keys.AWS_SESSION_TOKEN)         finalKeys.AWS_SESSION_TOKEN = keys.AWS_SESSION_TOKEN.trim()
    if (keys.AWS_DEFAULT_REGION)        finalKeys.AWS_DEFAULT_REGION = keys.AWS_DEFAULT_REGION
    // SSO connection info: lets the session alert renew credentials with one click
    if (ssoMeta.value)                  finalMeta.__sso = { ...ssoMeta.value }
  } else if (provider === 'vercel') {
    if (keys.VERCEL_API_TOKEN)          finalKeys.VERCEL_API_TOKEN = keys.VERCEL_API_TOKEN
    if (keys.VERCEL_TEAM_ID)            finalKeys.VERCEL_TEAM_ID = keys.VERCEL_TEAM_ID
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

// ── Vercel OAuth ───────────────────────────────────────────────────────────────
const isElectron   = typeof window !== 'undefined' && !!window.kuaElectron
const oauthPending = ref(false)
let oauthHandlers  = []

function startVercelOAuth() {
  if (!window.kuaElectron?.startVercelOAuth) return
  oauthPending.value = true
  const name = form.value.name.trim() || 'Vercel'
  window.kuaElectron.startVercelOAuth(name)
}

onMounted(() => {
  if (!isElectron) return

  const successHandler = window.kuaElectron.onVercelOAuthComplete?.((profile) => {
    oauthPending.value = false
    // Emit save with the profile returned by the backend OAuth callback
    // App.vue treats this as a "select existing profile" event
    emit('save', { oauthProfile: profile, provider: 'vercel' })
    emit('close')
  })

  const errorHandler = window.kuaElectron.onVercelOAuthError?.((msg) => {
    oauthPending.value = false
    console.error('[ProfileModal] Vercel OAuth error:', msg)
  })

  if (successHandler) oauthHandlers.push(['vercel:oauth-complete', successHandler])
  if (errorHandler)   oauthHandlers.push(['vercel:oauth-error', errorHandler])
})

onUnmounted(() => {
  for (const [channel, handler] of oauthHandlers) {
    window.kuaElectron?.removeListener?.(channel, handler)
  }
  oauthHandlers = []
})
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

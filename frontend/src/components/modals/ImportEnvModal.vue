<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @mousedown.self="$emit('close')">
      <div class="modal-box import-env-modal">
        <div class="modal-header">
          <span>{{ t('importEnv.title') }}</span>
          <button class="btn-close" @click="$emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <!-- Step 1: paste or load file -->
          <div v-if="step === 1" style="display:flex;flex-direction:column;gap:14px">
            <label class="field-label">
              {{ t('importEnv.nameLabel') }}
              <input v-model="form.name" class="ctrl-input" placeholder="e.g. my-app-prod" />
            </label>

            <label class="field-label">
              {{ t('importEnv.categoryLabel') }} <span class="text-dim" style="font-weight:normal">{{ t('importEnv.categoryHint') }}</span>
              <input v-model="form.category" class="ctrl-input" placeholder="e.g. backend, infra, staging…" />
            </label>

            <div class="field-label">
              .env Content
              <div style="display:flex;gap:8px;margin-bottom:6px;margin-top:4px">
                <label class="btn sm" style="cursor:pointer">
                  Browse file…
                  <input type="file" accept=".env,text/plain" style="display:none" @change="onFileChange" />
                </label>
                <span class="text-dim" style="font-size:12px;align-self:center">or paste below</span>
              </div>
              <textarea
                v-model="form.content"
                class="ctrl-input code-input"
                rows="10"
                placeholder="DB_HOST=localhost&#10;DB_PORT=5432&#10;API_KEY=secret…"
              />
            </div>

            <div v-if="parseError" class="alert-error">{{ parseError }}</div>
          </div>

          <!-- Step 2: review + add tags -->
          <div v-else style="display:flex;flex-direction:column;gap:10px">
            <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px">
              <strong style="color:var(--text)">{{ parsed.length }}</strong> variables parsed.
              You can add tags to each variable below.
            </div>

            <div class="import-vars-list">
              <div
                v-for="entry in parsed"
                :key="entry.key"
                class="import-var-row"
              >
                <div class="import-var-key">{{ entry.key }}</div>
                <div class="import-var-value text-dim">{{ maskValue(entry.value) }}</div>
                <div class="import-var-tags">
                  <div class="tag-chips">
                    <span
                      v-for="(tag, ti) in entry.tags"
                      :key="ti"
                      class="tag-chip"
                    >
                      {{ tag }}
                      <button class="tag-chip-remove" @click="removeTag(entry, ti)">✕</button>
                    </span>
                  </div>
                  <div style="display:flex;gap:4px;margin-top:4px">
                    <input
                      v-model="entry.newTag"
                      class="ctrl-input"
                      style="font-size:12px;padding:2px 6px;height:24px;flex:1"
                      placeholder="+ tag"
                      @keydown.enter.prevent="addTag(entry)"
                    />
                    <button class="btn sm" style="padding:0 8px;height:24px" @click="addTag(entry)">Add</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" @click="step === 2 ? (step = 1) : $emit('close')">
            {{ step === 2 ? t('importEnv.back') : t('action.cancel') }}
          </button>
          <button
            v-if="step === 1"
            class="btn primary"
            :disabled="!canParse"
            @click="goToStep2"
          >
            Parse →
          </button>
          <button
            v-else
            class="btn primary"
            :disabled="envStore.loading"
            @click="submit"
          >
            {{ envStore.loading ? t('profile.saving') : t('importEnv.import') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useEnvStore } from '../../stores/useEnvStore'
import { useI18n } from '../../composables/useI18n.js'

const { t } = useI18n()

const props = defineProps({ show: { type: Boolean, default: false } })
const emit  = defineEmits(['close', 'imported'])

const envStore = useEnvStore()

const step       = ref(1)
const parseError = ref('')
const parsed     = ref([])  // [{ key, value, tags: [], newTag: '' }]

const form = ref({ name: '', category: '', content: '' })

watch(() => props.show, (v) => {
  if (!v) return
  step.value       = 1
  parseError.value = ''
  parsed.value     = []
  form.value       = { name: '', category: '', content: '' }
})

const canParse = computed(() =>
  form.value.name.trim().length > 0 && form.value.content.trim().length > 0
)

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { form.value.content = ev.target.result }
  reader.readAsText(file)
}

function parseDotenvClient(text) {
  const result = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Z0-9_]+$/i.test(key)) continue
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    result.push({ key, value: val, tags: [], newTag: '' })
  }
  return result
}

function goToStep2() {
  parseError.value = ''
  const entries = parseDotenvClient(form.value.content)
  if (!entries.length) {
    parseError.value = 'No valid KEY=value pairs found. Make sure your file uses KEY=value format.'
    return
  }
  parsed.value = entries
  step.value = 2
}

function maskValue(v) {
  if (!v) return '(empty)'
  if (v.length <= 4) return '••••'
  return v.slice(0, 2) + '•'.repeat(Math.min(v.length - 2, 8))
}

function addTag(entry) {
  const t = entry.newTag.trim()
  if (t && !entry.tags.includes(t)) entry.tags.push(t)
  entry.newTag = ''
}

function removeTag(entry, idx) {
  entry.tags.splice(idx, 1)
}

async function submit() {
  const meta = {}
  for (const e of parsed.value) {
    if (e.tags.length) meta[e.key] = { tags: e.tags }
  }

  const created = await envStore.importEnv({
    content:  form.value.content,
    name:     form.value.name,
    category: form.value.category,
    meta,
  })
  if (created) emit('imported', created)
}
</script>

<style scoped>
.import-env-modal { width: 600px; max-height: 85vh; display: flex; flex-direction: column; }
.modal-body       { flex: 1; overflow-y: auto; }

.import-vars-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
}

.import-var-row {
  background: var(--bg-card, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 8px 10px;
  display: grid;
  grid-template-columns: 180px 1fr;
  grid-template-rows: auto auto;
  gap: 4px 12px;
}

.import-var-key {
  font-family: monospace;
  font-size: 13px;
  color: var(--accent, #7c9ef8);
  font-weight: 600;
  align-self: center;
}

.import-var-value {
  font-family: monospace;
  font-size: 12px;
  align-self: center;
}

.import-var-tags {
  grid-column: 1 / -1;
}

.tag-chips { display: flex; flex-wrap: wrap; gap: 4px; }

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-alt, #2a2a3a);
  border: 1px solid var(--border, #444);
  border-radius: 12px;
  padding: 1px 8px;
  font-size: 11px;
  color: var(--text, #cdd6f4);
}

.tag-chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #888);
  font-size: 10px;
  padding: 0;
  line-height: 1;
}
.tag-chip-remove:hover { color: var(--red, #f38ba8); }
</style>

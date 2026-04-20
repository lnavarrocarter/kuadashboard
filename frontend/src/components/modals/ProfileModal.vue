<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @mousedown.self="$emit('close')">
      <div class="modal-box" style="width:520px">
        <div class="modal-header">
          <span>{{ isEdit ? 'Edit Profile' : 'New Credential Profile' }}</span>
          <button class="btn-close" @click="$emit('close')">✕</button>
        </div>

        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <!-- Name -->
          <label class="field-label">
            Name
            <input v-model="form.name" class="ctrl-input" placeholder="e.g. my-gcp-prod" />
          </label>

          <!-- Provider -->
          <label class="field-label">
            Provider
            <select v-model="form.provider" class="ctrl-select" :disabled="isEdit">
              <option value="gcp">Google Cloud (GCP)</option>
              <option value="aws">Amazon Web Services (AWS)</option>
              <option value="generic">Generic / Other</option>
            </select>
          </label>

          <!-- Key fields — dynamic per provider -->
          <div style="display:flex;flex-direction:column;gap:10px">
            <div class="field-label" style="margin-bottom:4px">
              Keys
              <span class="text-dim" style="font-weight:normal"> ({{ isEdit ? 'leave blank to keep existing value' : 'required' }})</span>
            </div>

            <!-- GCP fields -->
            <template v-if="form.provider === 'gcp'">
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

            <!-- AWS fields -->
            <template v-else-if="form.provider === 'aws'">
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

            <!-- Generic: dynamic key-value pairs -->
            <template v-else>
              <div v-for="(pair, idx) in form.genericPairs" :key="idx" style="display:flex;gap:8px;align-items:center">
                <input v-model="pair.key" class="ctrl-input" style="flex:1" placeholder="KEY_NAME" />
                <input v-model="pair.value" class="ctrl-input" style="flex:2" placeholder="value" />
                <button class="btn sm" style="color:var(--red)" @click="removePair(idx)">✕</button>
              </div>
              <button class="btn sm" @click="addPair" style="align-self:flex-start">+ Add Key</button>
            </template>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" @click="$emit('close')">Cancel</button>
          <button class="btn primary" :disabled="!canSave" @click="submit">
            {{ isEdit ? 'Save Changes' : 'Create Profile' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  show:    { type: Boolean, default: false },
  profile: { type: Object, default: null },   // null = create mode
})
const emit = defineEmits(['close', 'save'])

const isEdit = computed(() => !!props.profile)

const defaultForm = () => ({
  name:     '',
  provider: 'gcp',
  keys: {
    GCP_PROJECT_ID: '',
    GCP_SERVICE_ACCOUNT_JSON: '',
    AWS_ACCESS_KEY_ID: '',
    AWS_SECRET_ACCESS_KEY: '',
    AWS_DEFAULT_REGION: '',
  },
  genericPairs: [{ key: '', value: '' }],
})

const form = ref(defaultForm())

watch(() => props.show, (v) => {
  if (!v) return
  if (props.profile) {
    form.value = {
      name:     props.profile.name,
      provider: props.profile.provider,
      keys: {
        GCP_PROJECT_ID: '',
        GCP_SERVICE_ACCOUNT_JSON: '',
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        AWS_DEFAULT_REGION: '',
      },
      genericPairs: props.profile.keyNames?.map(k => ({ key: k, value: '' })) || [{ key: '', value: '' }],
    }
  } else {
    form.value = defaultForm()
  }
})

const canSave = computed(() => form.value.name.trim().length > 0)

function addPair()       { form.value.genericPairs.push({ key: '', value: '' }) }
function removePair(idx) { form.value.genericPairs.splice(idx, 1) }

function submit() {
  const { name, provider, keys, genericPairs } = form.value
  let finalKeys = {}

  if (provider === 'gcp') {
    if (keys.GCP_PROJECT_ID)            finalKeys.GCP_PROJECT_ID = keys.GCP_PROJECT_ID
    if (keys.GCP_SERVICE_ACCOUNT_JSON)  finalKeys.GCP_SERVICE_ACCOUNT_JSON = keys.GCP_SERVICE_ACCOUNT_JSON
  } else if (provider === 'aws') {
    if (keys.AWS_ACCESS_KEY_ID)         finalKeys.AWS_ACCESS_KEY_ID = keys.AWS_ACCESS_KEY_ID
    if (keys.AWS_SECRET_ACCESS_KEY)     finalKeys.AWS_SECRET_ACCESS_KEY = keys.AWS_SECRET_ACCESS_KEY
    if (keys.AWS_DEFAULT_REGION)        finalKeys.AWS_DEFAULT_REGION = keys.AWS_DEFAULT_REGION
  } else {
    for (const pair of genericPairs) {
      if (pair.key.trim()) finalKeys[pair.key.trim()] = pair.value
    }
  }

  emit('save', { name: name.trim(), provider, keys: finalKeys })
}
</script>

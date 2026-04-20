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

          <!-- Category -->
          <label class="field-label">
            Category <span class="text-dim" style="font-weight:normal">(optional group label)</span>
            <input v-model="form.category" class="ctrl-input" placeholder="e.g. backend, infra, staging…" />
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
  category: '',
  provider: 'gcp',
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
    form.value = defaultForm()
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

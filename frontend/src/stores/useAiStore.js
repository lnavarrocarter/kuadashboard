import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useEnvStore } from './useEnvStore'

export const useAiStore = defineStore('ai', () => {
  const envStore = useEnvStore()

  const provider = ref(localStorage.getItem('kua:aiProvider') || 'ollama')
  const model = ref(localStorage.getItem('kua:aiModel') || 'llama3.1:8b')
  const profileId = ref(localStorage.getItem('kua:aiProfile') || '')
  const agent = ref(localStorage.getItem('kua:aiAgent') || 'devops')
  const messages = ref([])
  const streaming = ref(false)
  const error = ref('')
  const models = ref([])
  const ollamaStatus = ref(null)

  const aiProfiles = computed(() => envStore.profiles.filter(p => ['openai', 'anthropic'].includes(p.provider)))
  const providerProfiles = computed(() => aiProfiles.value.filter(p => p.provider === provider.value))

  function persist() {
    localStorage.setItem('kua:aiProvider', provider.value)
    localStorage.setItem('kua:aiModel', model.value)
    localStorage.setItem('kua:aiAgent', agent.value)
    if (profileId.value) localStorage.setItem('kua:aiProfile', profileId.value)
    else localStorage.removeItem('kua:aiProfile')
  }

  async function refreshStatus() {
    const res = await fetch('/api/ai/status')
    ollamaStatus.value = await res.json()
    return ollamaStatus.value
  }

  async function refreshModels() {
    const res = await fetch('/api/ai/models')
    const data = await res.json()
    models.value = data.models || []
    return data
  }

  async function pullModel(name) {
    const res = await fetch('/api/ai/models/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    })
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`)
    await refreshModels()
  }

  async function sendMessage(text, context = {}) {
    const content = String(text || '').trim()
    if (!content || streaming.value) return

    persist()
    error.value = ''
    const userMessage = { role: 'user', content }
    const assistantMessage = { role: 'assistant', content: '' }
    messages.value.push(userMessage, assistantMessage)
    streaming.value = true

    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-AI-Provider': provider.value,
        'X-AI-Model': model.value,
      }
      if (profileId.value) headers['X-Profile-Id'] = profileId.value

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent: agent.value,
          provider: provider.value,
          model: model.value,
          profileId: profileId.value || undefined,
          context,
          messages: messages.value
            .filter(m => m !== assistantMessage)
            .map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(await res.text())
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n')
          const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim()
          const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim()
          if (!event || !dataLine) continue
          const payload = JSON.parse(dataLine)
          if (event === 'chunk') assistantMessage.content += payload.delta || ''
          if (event === 'error') throw new Error(payload.error || 'AI stream error')
        }
      }
    } catch (e) {
      error.value = e.message
      assistantMessage.content += `\n\nError: ${e.message}`
    } finally {
      streaming.value = false
    }
  }

  function clearMessages() {
    messages.value = []
    error.value = ''
  }

  return {
    provider, model, profileId, agent,
    messages, streaming, error, models, ollamaStatus,
    aiProfiles, providerProfiles,
    persist, refreshStatus, refreshModels, pullModel, sendMessage, clearMessages,
  }
})

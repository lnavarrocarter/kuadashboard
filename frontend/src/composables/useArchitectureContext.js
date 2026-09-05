import { computed, ref, watch } from 'vue'

// Persists the active KUA Application context (id/provider/profile/project) so that
// reloading the window or switching tabs restores Architecture without re-selecting
// an AWS profile, and so a profile-less/non-AWS application keeps its own scope.
export function useArchitectureContext({ storage, awsProfileId, setProvider }) {
  function loadStoredApplicationContext() {
    const raw = storage.get('architectureApplication', '')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      return parsed?.id ? parsed : null
    } catch { return null }
  }

  const architectureProjectId = ref(storage.get('architectureProject', ''))
  const activeApplicationContext = ref(loadStoredApplicationContext())
  // A fresh Architecture entry should be application-first. Keep the AWS fallback
  // only for legacy, unlinked projects that still need the old profile-scoped path.
  const architectureProfileId = computed(() => activeApplicationContext.value?.profileId
    ?? (architectureProjectId.value ? awsProfileId.value : ''))

  watch(architectureProjectId, v => storage.set('architectureProject', v))
  watch(activeApplicationContext, v => storage.set('architectureApplication', v?.id ? JSON.stringify(v) : ''), { deep: true })

  function openApplicationArchitecture(input) {
    const context = typeof input === 'object' && input ? input : { projectId: input }
    activeApplicationContext.value = context.applicationId ? {
      id: context.applicationId,
      provider: context.provider || 'aws',
      profileId: context.profileId ?? awsProfileId.value,
      ...(context.application || {}),
    } : null
    architectureProjectId.value = context.projectId || ''
    setProvider('architecture')
  }

  function setApplicationContext(application) {
    if (application?.id) activeApplicationContext.value = application
  }

  return {
    architectureProjectId,
    activeApplicationContext,
    architectureProfileId,
    openApplicationArchitecture,
    setApplicationContext,
  }
}

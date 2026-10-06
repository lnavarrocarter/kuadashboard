import { computed, ref, watch } from 'vue'

const URL_PARAM = 'app'

// Persists the active KUA Application context (id/provider/profile/project) so that
// reloading the window or switching tabs restores Architecture without re-selecting
// an AWS profile, and so a profile-less/non-AWS application keeps its own scope.
// The application id is also kept in the URL (?app=) so a link opens that application.
export function useArchitectureContext({ storage, awsProfileId, setProvider, location = globalThis.location, history = globalThis.history }) {
  function loadStoredApplicationContext() {
    const raw = storage.get('architectureApplication', '')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      return parsed?.id ? parsed : null
    } catch { return null }
  }

  function readUrlApplicationId() {
    try { return new URLSearchParams(location?.search || '').get(URL_PARAM) || '' } catch { return '' }
  }

  function writeUrlApplicationId(id) {
    if (!location || !history?.replaceState) return
    try {
      const url = new URL(location.href)
      if (id) url.searchParams.set(URL_PARAM, id)
      else url.searchParams.delete(URL_PARAM)
      if (url.href !== location.href) history.replaceState(history.state, '', url.href)
    } catch { /* non-http locations (tests, file://) keep working without the param */ }
  }

  // An application named by the URL that is not the stored one: the caller loads it.
  const urlApplicationId = readUrlApplicationId()
  const architectureProjectId = ref(storage.get('architectureProject', ''))
  const activeApplicationContext = ref(loadStoredApplicationContext())
  // A fresh Architecture entry should be application-first. Keep the AWS fallback
  // only for legacy, unlinked projects that still need the old profile-scoped path.
  const architectureProfileId = computed(() => activeApplicationContext.value?.profileId
    ?? (architectureProjectId.value ? awsProfileId.value : ''))

  watch(architectureProjectId, v => storage.set('architectureProject', v))
  watch(activeApplicationContext, v => {
    storage.set('architectureApplication', v?.id ? JSON.stringify(v) : '')
    writeUrlApplicationId(v?.id || '')
  }, { deep: true })

  function openApplicationArchitecture(input) {
    const context = typeof input === 'object' && input ? input : { projectId: input }
    // Provider and profile come from the application itself (a KUA Application may have
    // neither), never from the global AWS selector.
    activeApplicationContext.value = context.applicationId ? {
      id: context.applicationId,
      provider: context.provider ?? context.application?.provider ?? null,
      profileId: context.profileId ?? context.application?.profileId ?? null,
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
    urlApplicationId: urlApplicationId && urlApplicationId !== activeApplicationContext.value?.id ? urlApplicationId : '',
  }
}

/** The context App.vue keeps for an application served by /api/kua-apps/applications. */
export function applicationContextFromView(view) {
  if (!view?.id) return null
  const projectIds = view.views?.architectureProjectIds || []
  return {
    id: view.id,
    name: view.name,
    environment: view.environment || '',
    team: view.team || '',
    provider: view.local?.legacy?.provider ?? null,
    profileId: view.local?.legacy?.profileId ?? null,
    region: view.local?.legacy?.region ?? null,
    architectureProjectIds: projectIds,
    architectureProjectId: projectIds[0] || null,
  }
}

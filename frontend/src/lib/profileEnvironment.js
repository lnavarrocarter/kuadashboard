import { contextEnvironment } from './kubeContext'

// Environment of the cloud profile shown in the header (AWS, GCP, Vercel), guessed
// from its name the same way as a kubeconfig context, so a restored "prod" profile
// is as visible as a production cluster. null when nothing matches: the header then
// says the environment is unidentified instead of implying it is safe.

/** The words a profile is known by: its name and, for a gcloud configuration, its project. */
export function cloudProfileText(provider, id, { awsProfiles = [], gcpProfiles = [], gcpLocalConfigs = [], vercelProfiles = [] } = {}) {
  if (!id) return ''
  if (id.startsWith('local:')) {
    const name = id.slice('local:'.length)
    if (provider !== 'gcp') return name
    const config = gcpLocalConfigs.find(item => item.name === name)
    return [name, config?.project].filter(Boolean).join(' ')
  }
  const stored = { aws: awsProfiles, gcp: gcpProfiles, vercel: vercelProfiles }[provider] || []
  const profile = stored.find(item => item.id === id)
  return profile ? [profile.name, profile.projectId, profile.environment].filter(Boolean).join(' ') : ''
}

export function cloudProfileEnvironment(provider, id, lists) {
  const text = cloudProfileText(provider, id, lists)
  return text ? contextEnvironment(text) : null
}

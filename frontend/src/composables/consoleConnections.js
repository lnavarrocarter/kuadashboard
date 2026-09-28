// Saved console connections and console presentation helpers (#63).

// Icon and accent color per provider, shared by the workspace and the tab strip.
const PROVIDERS = {
  local:      { icon: 'terminal', color: '#3fb950', label: 'Local' },
  kubernetes: { icon: 'boxes',    color: '#4f8ff7', label: 'Kubernetes' },
  aws:        { icon: 'cloud',    color: '#ff9900', label: 'AWS' },
  gcp:        { icon: 'cloud',    color: '#4285f4', label: 'GCP' },
  vercel:     { icon: 'triangle', color: '#c9d1d9', label: 'Vercel' },
}

export function providerMeta(provider) {
  return PROVIDERS[provider] || { icon: 'terminal', color: '#8b949e', label: provider || 'console' }
}

/** Keeps the start and the end of long names ("StartProcessCa…Function-v1"). */
export function middleTruncate(value, max = 32) {
  const text = String(value ?? '')
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep * 0.55)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}

const PROVIDER_BY_KIND = { log: 'kubernetes', exec: 'kubernetes', local: 'local', ec2: 'aws', ssm: 'aws', 'gcp-logs': 'gcp', 'gcp-ssh': 'gcp', vercel: 'vercel' }

/** What is needed to reopen a session later (never credentials or output). */
export function connectionFromTab(tab) {
  const kind = tab.type
  switch (kind) {
    case 'log': return { kind, params: { kubeContext: tab.kubeContext || '', namespace: tab.ns || '', name: tab.pod || '', resourceType: tab.resourceType || 'pods' } }
    case 'exec': return { kind, params: { kubeContext: tab.kubeContext || '', namespace: tab.ns || '', name: tab.pod || '' } }
    case 'local': return { kind, params: {} }
    case 'ec2': return { kind, params: { host: tab.target?.host || '', user: tab.target?.user || 'ec2-user', port: tab.target?.port || 22, profileId: tab.profileId || '' } }
    case 'ssm': return { kind, params: { instanceId: tab.target?.instanceId || '', profileId: tab.profileId || '' } }
    case 'gcp-logs': return { kind, params: { project: tab.project || '', region: tab.region || '', service: tab.target?.name || '', profileId: tab.profileId || '' } }
    case 'gcp-ssh': return { kind, params: { project: tab.project || '', profileId: tab.profileId || '', target: { ...(tab.target || {}) } } }
    case 'vercel': return { kind, params: { deploymentId: tab.target?.name || '', profileId: tab.profileId || '' } }
    default: return null
  }
}

export function connectionProvider(connection) {
  return PROVIDER_BY_KIND[connection.kind] || 'local'
}

/** Short human description of where a saved connection points. */
export function connectionTarget(connection) {
  const p = connection.params || {}
  switch (connection.kind) {
    case 'log': return `${p.kubeContext ? `${p.kubeContext} · ` : ''}${p.namespace}/${p.name}${p.resourceType && p.resourceType !== 'pods' ? ` (${p.resourceType})` : ''} · logs`
    case 'exec': return `${p.kubeContext ? `${p.kubeContext} · ` : ''}${p.namespace}/${p.name} · exec`
    case 'local': return 'local shell'
    case 'ec2': return `${p.user}@${p.host}${p.port && p.port !== 22 ? `:${p.port}` : ''} · ssh`
    case 'ssm': return `${p.instanceId} · ssm`
    case 'gcp-logs': return `${p.project ? `${p.project} · ` : ''}${p.region}/${p.service} · logs`
    case 'gcp-ssh': return `${p.target?.zone ? `${p.target.zone}/` : ''}${p.target?.name || ''} · ssh`
    case 'vercel': return `${p.deploymentId} · logs`
    default: return connection.kind
  }
}

export function sameConnection(a, b) {
  return a.kind === b.kind && JSON.stringify(a.params) === JSON.stringify(b.params)
}

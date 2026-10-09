// The Kubernetes view in the URL (?view=kubernetes&context=…&ns=…&resource=…&name=…),
// so a reload, back/forward or a shared link opens the same cluster, namespace,
// resource list and selection. Only names travel: no credentials.

const KUBE_PARAMS = ['view', 'context', 'ns', 'resource', 'name']
// Parameters of other views (KUApps ?app=&tab=) that must not linger here:
// a stale ?app= would reopen that application on reload.
const OTHER_VIEW_PARAMS = ['app', 'tab']

export function readKubeUrl(search = '') {
  let params
  try { params = new URLSearchParams(search) } catch { return null }
  if (params.get('view') !== 'kubernetes') return null
  return {
    context: params.get('context') || '',
    namespace: params.get('ns') || '',
    resource: params.get('resource') || '',
    name: params.get('name') || '',
  }
}

/** The href for `state`, or with the Kubernetes params removed when `state` is null. */
export function kubeUrlHref(href, state) {
  const url = new URL(href)
  for (const key of KUBE_PARAMS) url.searchParams.delete(key)
  if (state) {
    for (const key of OTHER_VIEW_PARAMS) url.searchParams.delete(key)
    url.searchParams.set('view', 'kubernetes')
    if (state.context) url.searchParams.set('context', state.context)
    if (state.namespace) url.searchParams.set('ns', state.namespace)
    if (state.resource) url.searchParams.set('resource', state.resource)
    if (state.name) url.searchParams.set('name', state.name)
  }
  return url.href
}

/**
 * Texts and places of the Advisor posture alerts (GET /api/advisor/alerts).
 * Scope keys come from lib/advisor/posture.js scopeKeys():
 *   aws:<profileId>:<region>   gcp:<profileId>:<projectId>
 *   kubernetes:<context>:<namespace>   product:<applicationId>
 * Profile ids and contexts may contain ':' (local:prod, EKS ARNs), so the
 * last segment is split off from the end.
 */

export function parseScope(scope = '') {
  const [provider, ...rest] = String(scope).split(':')
  if (provider === 'product') return { provider, applicationId: rest.join(':') }
  const tail = rest.pop() ?? ''
  const head = rest.join(':')
  if (provider === 'aws') return { provider, profileId: head, region: tail }
  if (provider === 'gcp') return { provider, profileId: head, projectId: tail }
  if (provider === 'kubernetes') return { provider, context: head, namespace: tail }
  return { provider }
}

/** Short, readable place of an alert: "AWS · prod · us-east-1". */
export function scopeLabel(alert, { t, profileName = id => id } = {}) {
  const scope = parseScope(alert.scope)
  const name = id => (String(id).startsWith('local:') ? String(id).slice(6) : profileName(id) || id)
  switch (scope.provider) {
    case 'aws': return ['AWS', name(scope.profileId), scope.region].filter(Boolean).join(' · ')
    case 'gcp': return ['GCP', name(scope.profileId), scope.projectId].filter(Boolean).join(' · ')
    case 'kubernetes': return ['Kubernetes', scope.context.split('/').pop(), scope.namespace === 'all' ? t('advisorAlerts.allNamespaces') : scope.namespace].filter(Boolean).join(' · ')
    case 'product': return ['KUApps', alert.data?.scopeLabel || scope.applicationId].filter(Boolean).join(' · ')
    default: return alert.scope
  }
}

/** One line for the alert: what happened to which rule. */
export function alertTitle(alert, { t, lang = 'en' } = {}) {
  const data = alert.data || {}
  const rule = t(`advisor.rule.${alert.ruleId}.title`, { count: data.count ?? '', ...(data.params || {}) })
  const date = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { dateStyle: 'medium' }) : ''
  return t(`advisorAlerts.type.${alert.type}`, { rule, date })
}

/** Alerts worth a system notification: new high findings and expired acceptances. */
export const notifiable = alert => !alert.read && (alert.severity === 'high' || alert.type === 'acceptance_expired')

export const ALERT_ICONS = {
  new_finding: 'alert-triangle',
  fixed: 'check-circle-2',
  acceptance_expiring: 'clock',
  acceptance_expired: 'clock-alert',
}

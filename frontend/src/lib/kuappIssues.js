// How KUApps names a health signal or an issue (#239), shared by the Summary and Signals so both
// say the same thing about the same resource.

export const THRESHOLD_LABELS = {
  errorRatePercent: 'apm.threshold.errorRate',
  durationMs: 'apm.threshold.duration',
  readyPodsPercent: 'apm.threshold.readyPods',
  restartDelta: 'apm.threshold.restarts',
  elb5xxRatePercent: 'apm.threshold.elb5xx',
  elbLatencyP95Ms: 'apm.threshold.elbLatency',
  elbGenerated5xxCount: 'apm.signal.elbGenerated5xx',
  logErrorRatePercent: 'apm.threshold.errorRate',
}

const round = value => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : value)

export function signalLabel(t, metric) {
  return THRESHOLD_LABELS[metric] ? t(THRESHOLD_LABELS[metric]) : metric
}

/** "Error rate (%): 30 (threshold 5)", or "…: 885" for a count. */
export function signalText(t, signal) {
  const label = signalLabel(t, signal.metric)
  return signal.comparison === 'count'
    ? t('kuapps.issue.signalCount', { label, value: round(signal.value) })
    : t('kuapps.issue.signal', { label, value: round(signal.value), threshold: round(signal.threshold) })
}

/** What the issue says, in one line. */
export function issueEvidence(t, issue) {
  if (issue.kind === 'threshold') return signalText(t, issue.evidence)
  if (issue.kind === 'collection_failed') {
    return t('kuapps.issue.collectionFailed', { cause: [issue.evidence?.errorCode, issue.evidence?.message].filter(Boolean).join(': ') || t('kuapps.issue.unknownCause') })
  }
  return t(`kuapps.issue.${issue.kind}`)
}

/** "2 h ago", "3 d ago" from an ISO date; '' without one. */
export function ago(t, iso, now = Date.now()) {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 60) return t('kuapps.issue.agoMinutes', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('kuapps.issue.agoHours', { n: hours })
  return t('kuapps.issue.agoDays', { n: Math.round(hours / 24) })
}

export const ISSUE_ACTIONS = {
  open_signals: 'kuapps.issue.action.open_signals',
  review_missing: 'kuapps.issue.action.review_missing',
  bind_scope: 'kuapps.issue.action.bind_scope',
  retry: 'kuapps.issue.action.retry',
}

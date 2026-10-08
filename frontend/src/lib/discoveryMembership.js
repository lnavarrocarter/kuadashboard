// What a discovery preview row says before anything is written (#151): the resource's native
// identity, and whether it is already part of the application (or only of this diagram).

export function nativeIdentity(node) {
  return String(node?.arn || node?.nativeId || node?.discoveryKey || '')
}

// In KUApps the diagram is a view of the application, so a node already there is a member of it.
export function alreadyAddedLabel(t, application) {
  return application?.name
    ? t('archDisc.alreadyInApplication', { name: application.name })
    : t('archDisc.alreadyInProject')
}

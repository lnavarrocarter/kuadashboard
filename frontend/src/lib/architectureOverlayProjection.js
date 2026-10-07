const AWS_KIND_TYPES = {
  lambda: ['lambda'],
  ec2: ['ec2'],
  'security group': ['ec2'],
  eks: ['eks'],
  rds: ['rds', 'database'],
  ebs: ['ebs', 'ec2'],
  'elastic ip': ['ec2'],
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 }

function addFinding(result, node, finding, resource) {
  const entry = result[node.id] || { count: 0, high: 0, medium: 0, low: 0, severity: 'low', details: [] }
  const severity = SEVERITY_RANK[finding.severity] ? finding.severity : 'low'
  entry.count += 1
  entry[severity] += 1
  if (SEVERITY_RANK[severity] > SEVERITY_RANK[entry.severity]) entry.severity = severity
  entry.details.push(`${finding.id}: ${resource.name}${resource.detail ? ` (${resource.detail})` : ''}`)
  result[node.id] = entry
}

export function kubernetesSecurityByNode(reports = [], nodes = []) {
  const result = {}
  for (const report of reports) {
    for (const finding of report.findings || []) {
      if (finding.category !== 'security') continue
      for (const resource of finding.resources || []) {
        const matches = nodes.filter(node => node.provider === 'kubernetes'
          && node.kubeContext === report.context
          && (node.namespace || '') === (resource.namespace || '')
          && (node.kind || '').toLowerCase() === (resource.kind || '').toLowerCase()
          && node.name === resource.name)
        for (const node of matches) addFinding(result, node, finding, resource)
      }
    }
  }
  for (const entry of Object.values(result)) entry.detail = entry.details.join('\n')
  return result
}

function awsNodeMatches(node, resource, kind, region) {
  if (node.provider !== 'aws') return false
  if (region && node.region && node.region !== region) return false
  const allowedTypes = AWS_KIND_TYPES[kind.toLowerCase()]
  if (!allowedTypes?.includes(String(node.resourceType || '').toLowerCase())) return false
  const identities = [node.name, node.nativeId, node.arn].filter(Boolean).map(String)
  const reported = [resource.name, ...(String(resource.name || '').match(/\(([^)]+)\)/g) || []).map(value => value.slice(1, -1))]
  return reported.some(identity => identities.includes(identity))
}

export function awsSecurityByNode(report, nodes = []) {
  const result = {}
  if (!report || report.locked) return result
  for (const finding of report.findings || []) {
    if (finding.category !== 'security') continue
    for (const resource of finding.resources || []) {
      const kind = String(resource.kind || '')
      for (const node of nodes) {
        if (awsNodeMatches(node, resource, kind, report.scope?.region)) addFinding(result, node, finding, resource)
      }
    }
  }
  for (const entry of Object.values(result)) entry.detail = entry.details.join('\n')
  return result
}

const GCP_KIND_TYPES = {
  'cloud run': ['gcp-cloud-run'],
  function: ['gcp-function'],
}

export function gcpSecurityByNode(report, nodes = []) {
  const result = {}
  const projectId = report?.scope?.projectId
  if (!report || report.locked || !projectId) return result
  for (const finding of report.findings || []) {
    if (finding.category !== 'security') continue
    for (const resource of finding.resources || []) {
      const allowedTypes = GCP_KIND_TYPES[String(resource.kind || '').toLowerCase()]
      if (!allowedTypes) continue
      const matches = nodes.filter(node => {
        if (node.provider !== 'gcp' || String(node.projectId || node.accountId || '') !== String(projectId)) return false
        if (!allowedTypes.includes(String(node.resourceType || '').toLowerCase())) return false
        if (![node.name, node.nativeId].filter(Boolean).map(String).includes(String(resource.name || ''))) return false
        const location = resource.namespace
        if (location && String(node.location || node.region || '').toLowerCase() !== String(location).toLowerCase()) return false
        return true
      })
      if (!resource.namespace && matches.length !== 1) continue
      for (const node of matches) addFinding(result, node, finding, resource)
    }
  }
  for (const entry of Object.values(result)) entry.detail = entry.details.join('\n')
  return result
}

export function mergeNodeFindings(...sources) {
  const result = {}
  for (const source of sources) {
    for (const [nodeId, finding] of Object.entries(source || {})) {
      const entry = result[nodeId] || { count: 0, high: 0, medium: 0, low: 0, severity: 'low', details: [] }
      entry.count += finding.count
      entry.high += finding.high
      entry.medium += finding.medium
      entry.low += finding.low
      if ((SEVERITY_RANK[finding.severity] || 0) > (SEVERITY_RANK[entry.severity] || 0)) entry.severity = finding.severity
      entry.details.push(...finding.details)
      result[nodeId] = entry
    }
  }
  for (const entry of Object.values(result)) entry.detail = entry.details.join('\n')
  return result
}

export function kubernetesRolloutsByNode(rollouts = [], nodes = []) {
  const latestByOwner = new Map()
  for (const rollout of rollouts) {
    if (!rollout.deploymentUid) continue
    const key = `${rollout.context}\u0000${rollout.namespace}\u0000${rollout.deploymentUid}`
    const current = latestByOwner.get(key)
    if (!current || rollout.revision > current.revision) latestByOwner.set(key, rollout)
  }
  const result = {}
  for (const node of nodes) {
    if (node.provider !== 'kubernetes' || node.kind !== 'Deployment' || !node.nativeId) continue
    const rollout = latestByOwner.get(`${node.kubeContext}\u0000${node.namespace || ''}\u0000${node.nativeId}`)
    if (!rollout) continue
    result[node.id] = {
      revision: rollout.revision,
      status: rollout.replicas > 0 && rollout.readyReplicas >= rollout.replicas ? 'ready' : 'degraded',
      createdAt: rollout.createdAt,
      readyReplicas: rollout.readyReplicas,
      replicas: rollout.replicas,
    }
  }
  return result
}

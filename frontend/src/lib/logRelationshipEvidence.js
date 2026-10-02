// Deterministic, sanitized extraction of relationship evidence from already-classified log lines.
// No ML, no raw payload persistence: every candidate must be confirmed/rejected by a human through
// the existing suggested/rejected relationship review flow before it changes the Architecture graph.

import {
  extractCorrelationIds,
  extractRecurringErrors,
  extractServiceReferences,
  referenceConfidence,
  sanitizeLogLine,
} from '../shared/logSignals.mjs'

// Extraction rules live in shared/logSignals.mjs so Kubernetes log tabs and cached
// CloudWatch groups (analyzed by the backend) produce the same evidence.

const confidenceFromOccurrences = referenceConfidence

/**
 * Matches extracted service references against known Kubernetes nodes in the same Architecture graph,
 * returning reviewable suggestions. Never returns a match confidence of 1: a suggestion always requires
 * explicit human acceptance through the existing edge review flow.
 */
function suggestGraphRelationships({ lines = [], sourceNode, nodes = [] } = {}) {
  if (!sourceNode) return []
  const references = extractServiceReferences(lines)
  const candidates = nodes.filter(node =>
    node.id !== sourceNode.id &&
    node.provider === 'kubernetes' &&
    ['service', 'deployment', 'statefulset', 'daemonset'].includes(node.resourceType))
  const suggestions = []
  for (const reference of references) {
    const match = candidates.find(node =>
      String(node.name).toLowerCase() === reference.service.toLowerCase() &&
      (!reference.namespace || !node.namespace || node.namespace.toLowerCase() === reference.namespace.toLowerCase()))
    if (!match) continue
    suggestions.push({
      targetNodeId: match.id,
      targetName: match.name,
      occurrences: reference.occurrences,
      confidence: confidenceFromOccurrences(reference.occurrences),
      sample: reference.sample,
    })
  }
  return suggestions
}

export {
  sanitizeLogLine,
  extractServiceReferences,
  extractRecurringErrors,
  extractCorrelationIds,
  suggestGraphRelationships,
}

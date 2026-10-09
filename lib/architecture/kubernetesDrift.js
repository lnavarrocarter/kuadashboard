'use strict';
/**
 * lib/architecture/kubernetesDrift.js
 * Whether the Kubernetes resources drawn in a map still exist in their cluster (#239).
 *
 * A release replaces pods (new names), a workload can be recreated (same name, new uid) or renamed
 * with its version ("auth-1.2" → "auth-1.3"), and resources get deleted: the map kept showing them.
 * Here the contexts and namespaces present in the map are read again (free reads of the Kubernetes
 * API) and each drawn resource is classified:
 *   present    still there (same uid)
 *   recreated  same context, namespace, kind and name with a new uid: refreshed in place
 *   replaced   gone, and the same workload now runs under another name (pod hash, version)
 *   gone       gone with no successor
 * A context that cannot be read marks nothing: unreachable is not the same as deleted.
 * Nothing is written here; refreshOperation builds the graph change the user confirms.
 */

const { nameStem } = require('../kua/resourceObserver');

const MAX_SUCCESSORS = 10;

function kubernetesNodes(document) {
  return (document?.nodes || []).filter(node => node.provider === 'kubernetes' && node.kubeContext && !node.manual);
}

function identityKey(node) {
  return node.discoveryKey || `${node.kubeContext}/${node.namespace || ''}/${node.kind || node.resourceType}/${node.name}`;
}

/** The contexts in the map and, for each, the namespaces its resources live in. */
function kubernetesScope(document) {
  const scope = new Map();
  for (const node of kubernetesNodes(document)) {
    if (!scope.has(node.kubeContext)) scope.set(node.kubeContext, new Set());
    if (node.namespace) scope.get(node.kubeContext).add(node.namespace);
  }
  return [...scope.entries()].map(([context, namespaces]) => ({ context, namespaces: [...namespaces].sort() }));
}

/** Reads every context of the map once; failures are kept per context. */
async function readClusters(document, adapter) {
  const preview = { sources: [], nodes: [], relationships: [], failures: [] };
  for (const { context, namespaces } of kubernetesScope(document)) {
    try {
      const result = await adapter.preview({ provider: 'generic', contexts: [context], namespaces });
      preview.sources.push(...(result.sources || []));
      preview.nodes.push(...(result.nodes || []));
      preview.relationships.push(...(result.relationships || []));
      preview.failures.push(...(result.failures || []));
      if (!(result.sources || []).some(source => source.context === context) && !(result.failures || []).some(item => item.context === context)) {
        preview.failures.push({ context, error: 'The context is not in the kubeconfig of this computer' });
      }
    } catch (error) {
      preview.failures.push({ context, error: error.message });
    }
  }
  return preview;
}

/** Pure: compares the map with what the clusters returned. */
function diffKubernetesMap(document, preview, { now = () => Date.now() } = {}) {
  const drawn = kubernetesNodes(document);
  const drawnIds = new Set((document?.nodes || []).map(node => node.id));
  const drawnKeys = new Set(drawn.map(identityKey));
  const reachable = new Set((preview.sources || []).map(source => source.context));
  const failed = new Map((preview.failures || []).map(item => [item.context, item.error || item.message || '']));
  const live = preview.nodes || [];
  const liveIds = new Set(live.map(node => node.id));
  const liveByKey = new Map(live.map(node => [identityKey(node), node]));

  const changes = [];
  let present = 0;
  for (const node of drawn) {
    if (!reachable.has(node.kubeContext) || failed.has(node.kubeContext)) continue;
    const same = liveByKey.get(identityKey(node));
    // A recreated resource refreshed in place keeps its id and takes the new uid: it is present.
    if (liveIds.has(node.id) || (same && same.nativeId && same.nativeId === node.nativeId)) { present += 1; continue; }
    const base = { nodeId: node.id, name: node.name, resourceType: node.resourceType, kind: node.kind, namespace: node.namespace || '', context: node.kubeContext };
    if (same) { changes.push({ ...base, change: 'recreated', successors: [{ id: same.id, name: same.name }] }); continue; }
    const stem = nameStem(node.name);
    const successors = live.filter(item => item.kubeContext === node.kubeContext && item.namespace === node.namespace &&
      item.resourceType === node.resourceType && !drawnIds.has(item.id) && !drawnKeys.has(identityKey(item)) &&
      stem && nameStem(item.name) === stem)
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_SUCCESSORS)
      .map(item => ({ id: item.id, name: item.name }));
    changes.push({ ...base, change: successors.length ? 'replaced' : 'gone', successors });
  }
  const contexts = kubernetesScope(document).map(({ context, namespaces }) => ({
    context, namespaces,
    status: failed.has(context) ? 'unreachable' : reachable.has(context) ? 'checked' : 'unreachable',
    ...(failed.has(context) ? { error: failed.get(context) } : {}),
  }));
  return { checkedAt: new Date(now()).toISOString(), contexts, present, changes };
}

/**
 * The graph change for the chosen nodes (all changes when nodeIds is empty): the successors and the
 * resources still present come from the cluster (merged by identity, so a recreated one keeps its
 * place), replaced resources hand over to their successors, gone ones leave the map.
 */
function refreshOperation({ drift, preview, profileId = '', nodeIds = [] }) {
  const chosen = new Set(nodeIds.length ? nodeIds : drift.changes.map(item => item.nodeId));
  const changes = drift.changes.filter(item => chosen.has(item.nodeId));
  const successorIds = new Set(changes.flatMap(item => item.successors.map(successor => successor.id)));
  const contexts = new Set(changes.map(item => item.context));
  const drawnKeys = new Set();
  // Resources of the map still in the cluster travel along so relationships to the successors import.
  const nodes = (preview.nodes || []).filter(node => successorIds.has(node.id) || (contexts.has(node.kubeContext) && drift.presentIds?.has(node.id)));
  for (const node of nodes) drawnKeys.add(node.id);
  const edges = (preview.relationships || []).filter(edge => drawnKeys.has(edge.sourceNodeId) && drawnKeys.has(edge.targetNodeId));
  return {
    type: 'discovery.refresh',
    value: {
      scopes: [...contexts].map(context => ({ id: `kubernetes:${context}`, provider: 'kubernetes', profileId, context })),
      sources: (preview.sources || []).filter(source => contexts.has(source.context)),
      nodes,
      edges,
      replacements: orderedReplacements(changes.filter(item => item.change === 'replaced')),
      removeIds: changes.filter(item => item.change === 'gone').map(item => item.nodeId),
    },
  };
}

// Old pods and the new pods of the same workload pair up first (one to one), so each successor
// takes the place of a different predecessor; every other pair only carries relationships.
function orderedReplacements(replaced) {
  const first = [];
  const rest = [];
  const taken = new Set();
  for (const item of replaced) {
    const free = item.successors.find(successor => !taken.has(successor.id)) || item.successors[0];
    taken.add(free.id);
    first.push({ fromId: item.nodeId, toId: free.id });
    for (const successor of item.successors) if (successor.id !== free.id) rest.push({ fromId: item.nodeId, toId: successor.id });
  }
  return [...first, ...rest];
}

/** Reads the clusters of a map and compares; keeps the preview for an apply. */
async function checkKubernetesMap(document, adapter, options = {}) {
  const preview = await readClusters(document, adapter);
  const drift = diffKubernetesMap(document, preview, options);
  const liveById = new Map((preview.nodes || []).map(node => [node.id, node]));
  const liveByUid = new Map((preview.nodes || []).filter(node => node.nativeId).map(node => [`${node.kubeContext}:${node.nativeId}`, node]));
  // Live twins of the drawn resources still there, by id or (refreshed in place) by uid.
  drift.presentIds = new Set(kubernetesNodes(document)
    .map(node => liveById.get(node.id) || liveByUid.get(`${node.kubeContext}:${node.nativeId}`))
    .filter(Boolean).map(node => node.id));
  return { drift, preview };
}

/** What the API returns: no internal sets. */
function publicDrift(drift) {
  const { presentIds: _presentIds, ...rest } = drift;
  return rest;
}

module.exports = { checkKubernetesMap, diffKubernetesMap, kubernetesScope, publicDrift, refreshOperation };

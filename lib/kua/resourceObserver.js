'use strict';
/**
 * lib/kua/resourceObserver.js
 * Resources of a KUA Application that no longer exist, and what replaced them (#236).
 *
 * The collector records when a resource stopped existing (lib/apm/resourcePresence.js). Here the
 * Kubernetes workloads among them get successor suggestions from free reads of the Kubernetes API
 * (same context, namespace and kind): the same identity label (app.kubernetes.io/name, app…) or
 * the same name without its version or hash ("attencion-3.9.1" → "attencion-3.9.2"). Nothing is
 * replaced automatically: the user replaces, detaches or ignores. Nothing changes in the cluster.
 */

const k8s = require('@kubernetes/client-node');
const { canonicalFromApm } = require('./applicationRegistryService');
const { IDENTITY_LABELS, ignoreGone, readPresence } = require('../apm/resourcePresence');

const WORKLOAD_KINDS = { deployment: 'Deployment', statefulset: 'StatefulSet', daemonset: 'DaemonSet' };
const AROUND_MS = 3 * 24 * 60 * 60 * 1000;

function observerError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** The name without its release version or generated hash: "attencion-3.9.1" → "attencion". */
function nameStem(name) {
  const value = String(name || '').toLowerCase();
  const withoutVersion = value.replace(/-v?\d+(\.\d+)+([.-][a-z0-9]+)*$/, '');
  if (withoutVersion !== value) return withoutVersion;
  return value.replace(/-[a-z0-9]{8,10}(-[a-z0-9]{5})?$/, '');
}

/** Workloads of one kind in a namespace, from the Kubernetes API (no charge). */
function createKubeWorkloadLister({ buildKubeConfig = require('../kubeConfigManager').buildKubeConfig } = {}) {
  return {
    async listWorkloads({ kubeContext, namespace, kind }) {
      const { kubeConfig } = buildKubeConfig(kubeContext);
      const apps = kubeConfig.makeApiClient(k8s.AppsV1Api);
      const list = { deployment: 'listNamespacedDeployment', statefulset: 'listNamespacedStatefulSet', daemonset: 'listNamespacedDaemonSet' }[kind];
      const response = await apps[list](namespace);
      const items = (response?.body || response)?.items || [];
      return items.map(item => ({
        name: item.metadata?.name,
        namespace: item.metadata?.namespace || namespace,
        labels: item.metadata?.labels || {},
        createdAt: item.metadata?.creationTimestamp ? new Date(item.metadata.creationTimestamp).toISOString() : null,
      })).filter(item => item.name);
    },
  };
}

function createResourceObserver({ database, registry, kubeLister = createKubeWorkloadLister(), now = () => Date.now() }) {
  const goneMembers = application => database.listResources(application.id)
    .map(resource => ({ resource, presence: readPresence(database, resource.id) }))
    .filter(item => item.presence.goneSince && !item.presence.ignored);

  async function successorsOf(application, resource, presence) {
    const kind = String(resource.kind || '').toLowerCase();
    if (resource.type !== 'kubernetes' || !WORKLOAD_KINDS[kind] || !resource.kubeContext) return { successors: [], reason: 'unsupported' };
    const namespace = resource.namespace || 'default';
    const members = new Set(database.listResources(application.id)
      .filter(item => item.type === 'kubernetes' && String(item.kind || '').toLowerCase() === kind && (item.namespace || 'default') === namespace)
      .map(item => item.name));
    const workloads = await kubeLister.listWorkloads({ kubeContext: resource.kubeContext, namespace, kind });
    const stem = nameStem(resource.name);
    const goneAt = Date.parse(presence.goneSince);
    const successors = workloads
      .filter(candidate => candidate.name !== resource.name && !members.has(candidate.name))
      .map(candidate => {
        const evidence = [];
        const label = IDENTITY_LABELS.find(key => presence.labels?.[key] && candidate.labels?.[key] === presence.labels[key]);
        if (label) evidence.push({ type: 'same_label', label, value: presence.labels[label] });
        if (stem && nameStem(candidate.name) === stem) evidence.push({ type: 'same_name_stem', stem });
        if (!evidence.length) return null;
        const created = candidate.createdAt ? Date.parse(candidate.createdAt) : NaN;
        if (Number.isFinite(created) && Math.abs(created - goneAt) <= AROUND_MS) evidence.push({ type: 'created_around_removal', createdAt: candidate.createdAt });
        return {
          kind: WORKLOAD_KINDS[kind], name: candidate.name, namespace, createdAt: candidate.createdAt,
          confidence: label ? 'high' : 'medium', evidence,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return { successors };
  }

  /** The application's resources that no longer exist, with successor suggestions. */
  async function gone(application) {
    const items = [];
    for (const { resource, presence } of goneMembers(application)) {
      let registryId = null;
      try { registryId = canonicalFromApm(application, resource).id; } catch { /* not in the registry */ }
      const item = {
        resourceId: resource.id, registryId, name: resource.name, type: resource.type, kind: resource.kind || null,
        namespace: resource.namespace || null, kubeContext: resource.kubeContext || null, goneSince: presence.goneSince,
      };
      try {
        Object.assign(item, await successorsOf(application, resource, presence));
      } catch (error) {
        // The cluster could not be read now (expired session, VPN…): the resource is still listed.
        Object.assign(item, { successors: [], error: error.message });
      }
      items.push(item);
    }
    return { checkedAt: new Date(now()).toISOString(), resources: items };
  }

  function goneMember(application, resourceId) {
    const resource = database.getResource(resourceId);
    if (!resource || resource.applicationId !== application.id) throw observerError('Resource not found', 404, 'RESOURCE_NOT_FOUND');
    const presence = readPresence(database, resource.id);
    if (!presence.goneSince) throw observerError('This resource still exists', 409, 'RESOURCE_PRESENT');
    return { resource, presence };
  }

  /**
   * The successor becomes a member (observed like any other) and the resource that no longer
   * exists is detached from the application. Only a workload that exists now, in the same context,
   * namespace and kind, is accepted.
   */
  async function replace(application, resourceId, successorName, { expectedRevision } = {}) {
    const { resource } = goneMember(application, resourceId);
    const kind = String(resource.kind || '').toLowerCase();
    if (!WORKLOAD_KINDS[kind]) throw observerError('Only Kubernetes workloads can be replaced by a successor', 400, 'UNSUPPORTED');
    const namespace = resource.namespace || 'default';
    const workloads = await kubeLister.listWorkloads({ kubeContext: resource.kubeContext, namespace, kind });
    const successor = workloads.find(item => item.name === String(successorName || ''));
    if (!successor) throw observerError(`${WORKLOAD_KINDS[kind]} ${namespace}/${successorName} does not exist in the cluster`, 404, 'SUCCESSOR_NOT_FOUND');
    const suffix = `/${resource.name}`;
    const key = resource.key.endsWith(suffix)
      ? `${resource.key.slice(0, -suffix.length)}/${successor.name}`
      : `${resource.kubeContext}/${namespace}/${resource.kind}/${successor.name}`;
    const { results } = registry.attachResources(application, [{
      provider: 'kubernetes', type: 'kubernetes', kind: resource.kind, key, name: successor.name,
      kubeContext: resource.kubeContext, namespace, associationSource: 'manual',
    }], { expectedRevision, clearDetachments: true });
    if (results[0]?.error) throw observerError(results[0].error, 400, 'ATTACH_FAILED');
    registry.detachResource(database.getApplication(application.id), resource.id);
    return { replaced: resource.name, by: successor.name, resource: results[0].resource };
  }

  function ignore(application, resourceId) {
    const { resource } = goneMember(application, resourceId);
    ignoreGone(database, resource.id, { now: now() });
    return { ignored: resource.id };
  }

  return { gone, replace, ignore };
}

module.exports = { createKubeWorkloadLister, createResourceObserver, nameStem };

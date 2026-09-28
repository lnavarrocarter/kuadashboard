'use strict';

class KubeResponseCache {
  constructor({ freshMs = 15000, staleMs = 120000 } = {}) {
    if (freshMs < 0 || staleMs < freshMs) throw new Error('Invalid cache TTL configuration');
    this.freshMs = freshMs;
    this.staleMs = staleMs;
    this.entries = new Map();
  }

  // Options can change the windows at runtime; stored entries follow the new ones.
  configure({ freshMs = this.freshMs, staleMs = this.staleMs } = {}) {
    if (freshMs < 0 || staleMs < freshMs) throw new Error('Invalid cache TTL configuration');
    this.freshMs = freshMs;
    this.staleMs = staleMs;
    return { freshMs, staleMs };
  }

  read(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = now - entry.storedAt;
    if (age > this.staleMs) {
      this.entries.delete(key);
      return null;
    }
    return { value: entry.value, state: age <= this.freshMs ? 'fresh' : 'stale' };
  }

  write(key, value, now = Date.now()) {
    this.entries.set(key, { value, storedAt: now });
  }

  clear() {
    this.entries.clear();
  }

  // Drops every cached list (any context/namespace) whose resource is listed.
  invalidate(resources) {
    const targets = new Set(resources);
    for (const key of this.entries.keys()) {
      const resource = key.slice(key.lastIndexOf('/') + 1);
      if (targets.has(resource)) this.entries.delete(key);
    }
  }
}

// Lists whose content changes when a resource of the given type is mutated.
const MUTATION_DEPENDENTS = {
  pods: ['pods', 'events'],
  deployments: ['deployments', 'replicasets', 'pods', 'events'],
  statefulsets: ['statefulsets', 'pods', 'events'],
  daemonsets: ['daemonsets', 'pods', 'events'],
  services: ['services', 'endpoints', 'endpointslices', 'events'],
  ingresses: ['ingresses', 'events'],
  configmaps: ['configmaps'],
  secrets: ['secrets'],
  pvcs: ['pvcs', 'pvs', 'events'],
  nodes: ['nodes', 'pods', 'events'],
};

const KIND_RESOURCES = {
  Deployment: 'deployments',
  StatefulSet: 'statefulsets',
  DaemonSet: 'daemonsets',
  Service: 'services',
  ConfigMap: 'configmaps',
  Secret: 'secrets',
  Ingress: 'ingresses',
  PersistentVolumeClaim: 'pvcs',
};

/**
 * Resolves which cached lists a successful mutation invalidates.
 * Returns an array of resource names, or null when the whole cache must go.
 */
function kubeMutationScope(pathname, { kind } = {}) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return null;
  if (parts[1] === 'portforward' || parts.at(-1) === 'portforward') return [];
  if (parts[1] === 'apply') return MUTATION_DEPENDENTS[KIND_RESOURCES[kind]] || null;
  if (parts[1] === 'nodes') return MUTATION_DEPENDENTS.nodes;
  return MUTATION_DEPENDENTS[parts[2]] || null;
}

module.exports = { KubeResponseCache, kubeMutationScope };
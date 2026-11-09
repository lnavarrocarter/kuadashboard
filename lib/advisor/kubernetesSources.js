'use strict';

// These rules need metadata not present in the pod/workload lists. Keep each
// read independent: missing cluster-wide RBAC permission must not hide PSA or
// the rest of the Overview. Never reads Secret contents.
async function collectKubernetesSecuritySources({ core, rbac }, namespace = 'all') {
  const all = namespace === 'all';
  const reads = {
    namespaces: () => all ? core.listNamespace() : core.readNamespace(namespace),
    clusterRoleBindings: () => rbac.listClusterRoleBinding(),
    roleBindings: () => all ? rbac.listRoleBindingForAllNamespaces() : rbac.listNamespacedRoleBinding(namespace),
  };
  return Object.fromEntries(await Promise.all(Object.entries(reads).map(async ([key, read]) => {
    try {
      const result = await read();
      const body = result?.body ?? result;
      return [key, { ok: true, value: key === 'namespaces' && !all ? [body] : body.items || [] }];
    } catch (error) {
      return [key, { ok: false, error }];
    }
  })));
}
module.exports = { collectKubernetesSecuritySources };

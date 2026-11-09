'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectKubernetesSecuritySources } = require('./kubernetesSources');
const { adviseKubernetes } = require('./kubernetes');
const binding = { metadata: { name: 'app-admin' }, roleRef: { kind: 'ClusterRole', name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'operator' }] };

test('namespace metadata and RBAC reads actually feed the security rules', async () => {
  const calls = [];
  const sources = await collectKubernetesSecuritySources({
    core: { readNamespace: async ns => { calls.push(['namespace', ns]); return { body: { metadata: { name: ns } } }; } },
    rbac: {
      listClusterRoleBinding: async () => ({ body: { items: [binding] } }),
      listNamespacedRoleBinding: async ns => { calls.push(['bindings', ns]); return { items: [] }; },
    },
  }, 'shop');
  assert.deepEqual(calls, [['namespace', 'shop'], ['bindings', 'shop']]);
  const ids = adviseKubernetes({ sources, namespace: 'shop' }).findings.map(f => f.id);
  assert.ok(ids.includes('k8s.cluster_admin_binding'));
  assert.ok(ids.includes('k8s.no_pod_security_admission'));
});

test('forbidden cluster RBAC leaves namespaced checks available; failed reads are not passed checks', async () => {
  const sources = await collectKubernetesSecuritySources({
    core: { listNamespace: async () => ({ items: [{ metadata: { name: 'shop' } }] }) },
    rbac: {
      listClusterRoleBinding: async () => { throw Object.assign(new Error('forbidden'), { statusCode: 403 }); },
      listRoleBindingForAllNamespaces: async () => { throw new Error('forbidden'); },
    },
  });
  assert.equal(sources.clusterRoleBindings.ok, false);
  assert.equal(sources.roleBindings.ok, false);
  assert.equal(sources.namespaces.ok, true);
  const report = adviseKubernetes({ sources });
  assert.ok(report.findings.some(f => f.id === 'k8s.no_pod_security_admission'));
  assert.ok(!report.findings.some(f => f.id === 'k8s.cluster_admin_binding'));
});

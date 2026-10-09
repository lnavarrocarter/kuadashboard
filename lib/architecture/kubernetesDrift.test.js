'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { diffKubernetesMap, kubernetesScope, refreshOperation } = require('./kubernetesDrift');

const pod = (id, name, context = 'eks-dev') => ({ id, provider: 'kubernetes', resourceType: 'pod', kind: 'Pod', name, nativeId: `uid-${id}`, kubeContext: context, namespace: 'auth', discoveryKey: `${context}/auth/Pod/${name}` });
const source = { id: 'kubernetes:context:eks-dev', context: 'eks-dev' };

test('the scope is the contexts and namespaces drawn; manual nodes and other providers are ignored', () => {
  const document = { nodes: [pod('a', 'auth-1'), { ...pod('m', 'drawn'), manual: true }, { id: 'l', provider: 'aws', name: 'fn' }, { ...pod('p', 'x'), kubeContext: 'eks-prod', namespace: 'jobs' }] };
  assert.deepEqual(kubernetesScope(document), [{ context: 'eks-dev', namespaces: ['auth'] }, { context: 'eks-prod', namespaces: ['jobs'] }]);
});

test('two old pods hand over to two new pods of the same workload, one place each', () => {
  const document = { nodes: [pod('o1', 'auth-7d9f8c6b5d-aaaaa'), pod('o2', 'auth-7d9f8c6b5d-bbbbb'), pod('keep', 'billing-6f5e4d3c2b-ccccc')] };
  const preview = { sources: [source], nodes: [pod('n1', 'auth-5c4b3a2f1e-ddddd'), pod('n2', 'auth-5c4b3a2f1e-eeeee'), pod('keep', 'billing-6f5e4d3c2b-ccccc'), pod('x', 'other-1a2b3c4d5e-fffff')], relationships: [], failures: [] };
  const drift = diffKubernetesMap(document, preview, { now: () => 0 });
  assert.equal(drift.present, 1);
  assert.deepEqual(drift.changes.map(item => [item.nodeId, item.change, item.successors.map(successor => successor.id)]), [
    ['o1', 'replaced', ['n1', 'n2']],
    ['o2', 'replaced', ['n1', 'n2']],
  ]);
  const operation = refreshOperation({ drift: { ...drift, presentIds: new Set(['keep']) }, preview, profileId: 'local:dev' });
  assert.deepEqual(operation.value.replacements.slice(0, 2), [{ fromId: 'o1', toId: 'n1' }, { fromId: 'o2', toId: 'n2' }]);
  assert.deepEqual(operation.value.nodes.map(node => node.id).sort(), ['keep', 'n1', 'n2']);
  assert.deepEqual(operation.value.removeIds, []);
});

test('a context that answered nothing for itself is unreachable, never deleted', () => {
  const document = { nodes: [pod('a', 'auth-1', 'eks-gone')] };
  const drift = diffKubernetesMap(document, { sources: [], nodes: [], relationships: [], failures: [] });
  assert.deepEqual(drift.changes, []);
  assert.equal(drift.contexts[0].status, 'unreachable');
});

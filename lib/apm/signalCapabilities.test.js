'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { signalCapabilities } = require('./signalCapabilities');
const { canonicalKubernetesType } = require('../kua/applicationRegistryService');

const kube = kind => ({ type: 'kubernetes', kind, kubeContext: 'dev' });

test('Kubernetes kinds claim metrics only when the collector measures them (#280)', () => {
  for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Pod', 'Node', 'Ingress']) {
    assert.equal(signalCapabilities(kube(kind)).metrics, true, kind);
  }
  for (const kind of ['ConfigMap', 'Secret', 'PersistentVolumeClaim', 'PersistentVolume']) {
    assert.deepEqual(signalCapabilities(kube(kind)), { metrics: false, logs: false }, kind);
  }
  assert.equal(signalCapabilities({ type: 'kubernetes', kind: 'Deployment' }).metrics, false, 'no context, nothing to read');
});

test('PersistentVolumes have their own type instead of the generic one (#280)', () => {
  assert.equal(canonicalKubernetesType(kube('PersistentVolume')), 'pv');
  assert.equal(canonicalKubernetesType(kube('pv')), 'pv');
  assert.equal(canonicalKubernetesType(kube('PersistentVolumeClaim')), 'pvc');
});

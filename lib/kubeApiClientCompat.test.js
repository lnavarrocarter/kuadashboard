'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptApiClient, apiParameters, legacyArguments, normalizeApiError, patchKubeConfigPrototype } = require('./kubeApiClientCompat');

class GeneratedApi {
  listNamespacedPod(param, options) {
    return Promise.resolve({ namespace: param.namespace, pretty: param.pretty, timeout: options?.timeout });
  }

  listNamespacedPodWithHttpInfo(param, options) {
    return Promise.resolve({
      body: { namespace: param.namespace, pretty: param.pretty, timeout: options?.timeout },
      statusCode: 206,
      headers: { 'x-kubernetes-pf-flags': 'test' },
    });
  }

  readNamespacedPodLog(param) {
    return Promise.resolve({ name: param.name, namespace: param.namespace, tailLines: param.tailLines });
  }
}

test('maps legacy positional Kubernetes calls to the current parameter object', async () => {
  const client = adaptApiClient(new GeneratedApi());
  const response = await client.listNamespacedPod('monitoring', 'true');
  assert.deepEqual(response, {
    body: { namespace: 'monitoring', pretty: 'true', timeout: undefined },
    response: { statusCode: 206, headers: { 'x-kubernetes-pf-flags': 'test' } },
  });
});

test('passes object-style calls through and preserves generated log parameter names', async () => {
  const client = adaptApiClient(new GeneratedApi());
  assert.deepEqual(await client.readNamespacedPodLog({ name: 'api', namespace: 'default', tailLines: 9 }), {
    body: { name: 'api', namespace: 'default', tailLines: 9 },
    response: { statusCode: 200 },
  });
  assert.deepEqual(apiParameters(GeneratedApi.prototype.readNamespacedPodLog), ['name', 'namespace', 'tailLines']);
});

test('normalizes v2 API error codes to the legacy status fields without changing the body', () => {
  const error = Object.assign(new Error('Not found'), { code: 404, body: { message: 'missing' } });
  assert.equal(normalizeApiError(error), error);
  assert.equal(error.statusCode, 404);
  assert.deepEqual(error.response, { statusCode: 404, headers: {} });
  assert.deepEqual(error.body, { message: 'missing' });
});

test('patches KubeConfig makeApiClient once and wraps the returned client', () => {
  class TestKubeConfig {
    makeApiClient(Api) { return new Api(); }
  }
  class Api { listNamespacedPod(param) { return Promise.resolve({ namespace: param.namespace }); } }
  patchKubeConfigPrototype(TestKubeConfig);
  patchKubeConfigPrototype(TestKubeConfig);
  const client = new TestKubeConfig().makeApiClient(Api);
  return assert.doesNotReject(async () => {
    assert.deepEqual(await client.listNamespacedPod('default'), { body: { namespace: 'default' }, response: { statusCode: 200 } });
  });
});

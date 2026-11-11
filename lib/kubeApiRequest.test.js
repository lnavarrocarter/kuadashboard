'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { requestKubeApi } = require('./kubeApiRequest');

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function fakeConfig(server) {
  return {
    getCurrentCluster: () => ({ server, skipTLSVerify: true }),
    async applyToHTTPSOptions(options) {
      options.headers.Authorization = 'Bearer fixture-token';
    },
  };
}

test('preserves the Kubernetes proxy path and query, and applies kubeconfig auth', async t => {
  let received;
  const server = http.createServer((req, res) => {
    received = { url: req.url, authorization: req.headers.authorization };
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"success"}');
  });
  const base = await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));

  const result = await requestKubeApi(fakeConfig(base), '/api/v1/namespaces/monitoring/services/prometheus:9090/proxy/api/v1/query?query=up%7Bpod%3D~%22a%7Cb%22%7D');
  assert.equal(result, '{"status":"success"}');
  assert.equal(received.url, '/api/v1/namespaces/monitoring/services/prometheus:9090/proxy/api/v1/query?query=up%7Bpod%3D~%22a%7Cb%22%7D');
  assert.equal(received.authorization, 'Bearer fixture-token');
});

test('rejects redirects instead of following them to another host', async t => {
  let followed = false;
  const destination = http.createServer((_req, res) => { followed = true; res.end('unexpected'); });
  const target = await listen(destination);
  const source = http.createServer((_req, res) => res.writeHead(302, { Location: target }).end());
  const base = await listen(source);
  t.after(async () => {
    await Promise.all([source, destination].map(server => new Promise(resolve => server.close(resolve))));
  });

  await assert.rejects(requestKubeApi(fakeConfig(base), '/redirect'), error => {
    assert.equal(error.statusCode, 302);
    assert.match(error.message, /HTTP 302/);
    return true;
  });
  assert.equal(followed, false);
});

test('refuses a proxy path that changes the configured Kubernetes origin', async () => {
  await assert.rejects(requestKubeApi(fakeConfig('http://127.0.0.1:1234'), 'http://127.0.0.2:1234/private'), /configured cluster/);
});

test('uses the kubeconfig CA and bearer token for HTTPS API proxy requests', async t => {
  const cert = fs.readFileSync(require.resolve('./fixtures/kube-api-test-cert.pem'));
  const key = fs.readFileSync(require.resolve('./fixtures/kube-api-test-key.pem'));
  let authorization;
  const server = https.createServer({ cert, key }, (req, res) => {
    authorization = req.headers.authorization;
    res.writeHead(200).end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const k8s = require('@kubernetes/client-node');
  const kubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromOptions({
    clusters: [{ name: 'fixture', server: `https://127.0.0.1:${server.address().port}`, caData: cert.toString('base64') }],
    users: [{ name: 'fixture', token: 'fixture-token' }],
    contexts: [{ name: 'fixture', cluster: 'fixture', user: 'fixture' }],
    currentContext: 'fixture',
  });

  assert.equal(await requestKubeApi(kubeConfig, '/api/v1/nodes'), 'ok');
  assert.equal(authorization, 'Bearer fixture-token');
});

'use strict';

const http = require('node:http');
const https = require('node:https');

function nativeRequest(options, callback) {
  const url = new URL(options.uri);
  const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
  if (!transport) throw new Error('Unsupported Kubernetes API protocol');

  const request = transport.request(url, options, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(Buffer.from(chunk)));
    response.on('end', () => callback(null, response, Buffer.concat(chunks).toString('utf8')));
    response.on('error', callback);
  });
  request.on('error', callback);
  request.setTimeout(options.timeout, () => {
    const error = Object.assign(new Error('Kubernetes API request timed out'), { code: 'ETIMEDOUT' });
    request.destroy(error);
  });
  request.end();
  return request;
}

function requestKubeApi(kubeConfig, pathname, { requestImpl = nativeRequest, timeoutMs = 10000 } = {}) {
  const cluster = kubeConfig?.getCurrentCluster?.();
  if (!cluster?.server) return Promise.reject(new Error('No active Kubernetes cluster server'));

  let url;
  try {
    const base = new URL(cluster.server);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Unsupported Kubernetes API protocol');
    url = new URL(pathname, base);
    if (url.origin !== base.origin) throw new Error('Kubernetes API path must remain on the configured cluster');
  } catch (error) {
    return Promise.reject(error);
  }

  const options = {
    method: 'GET',
    uri: url.href,
    path: `${url.pathname}${url.search}`,
    headers: {},
    timeout: timeoutMs,
  };

  const apply = typeof kubeConfig.applyToHTTPSOptions === 'function'
    ? kubeConfig.applyToHTTPSOptions(options)
    : typeof kubeConfig.applyToRequest === 'function'
      ? kubeConfig.applyToRequest(options)
      : Promise.resolve();

  return Promise.resolve(apply).then(() => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, response, body) => {
      if (settled) return;
      settled = true;
      if (error) return reject(error);
      if (response.statusCode < 200 || response.statusCode > 299) {
        const failure = new Error(`HTTP ${response.statusCode}`);
        failure.statusCode = response.statusCode;
        failure.response = { statusCode: response.statusCode };
        return reject(failure);
      }
      resolve(body);
    };

    try {
      requestImpl(options, finish);
    } catch (error) {
      finish(error);
    }
  }));
}

module.exports = { nativeRequest, requestKubeApi };

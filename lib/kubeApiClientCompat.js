'use strict';

const PATCHED = Symbol.for('kua.kubernetesClientLegacyResponses');
const PARAMS = new WeakMap();

function apiParameters(method) {
  if (PARAMS.has(method)) return PARAMS.get(method);
  const names = [...new Set([...method.toString().matchAll(/\bparam\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]))];
  PARAMS.set(method, names);
  return names;
}

function legacyArguments(method, args) {
  const names = apiParameters(method);
  if (!names.length) return args;
  const first = args[0];
  const isOptionsObject = first && typeof first === 'object' && !Array.isArray(first)
    && Object.keys(first).some(key => names.includes(key));
  if (isOptionsObject) return args;

  const params = {};
  for (let index = 0; index < Math.min(args.length, names.length); index += 1) {
    params[names[index]] = args[index];
  }
  return [params, ...args.slice(names.length)];
}

function legacyResponse(info) {
  if (info && typeof info === 'object' && Object.hasOwn(info, 'body') && Number.isInteger(info.statusCode)) {
    return { body: info.body, response: { statusCode: info.statusCode, headers: info.headers } };
  }
  return { body: info, response: { statusCode: 200 } };
}

function normalizeApiError(error) {
  if (error && !Number.isInteger(error.statusCode) && Number.isInteger(error.code)) {
    error.statusCode = error.code;
  }
  if (error && error.statusCode && !error.response) {
    error.response = { statusCode: error.statusCode, headers: error.headers || {} };
  }
  return error;
}

function adaptApiClient(client) {
  return new Proxy(client, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || typeof method !== 'function' || property === 'constructor') return method;
      const owner = Object.getPrototypeOf(target);
      if (!Object.prototype.hasOwnProperty.call(owner, property)) return method;

      return (...args) => {
        const callArgs = legacyArguments(method, args);
        const withInfo = target[`${property}WithHttpInfo`];
        const call = typeof withInfo === 'function' ? withInfo : method;
        return Promise.resolve(call.apply(target, callArgs))
          .then(legacyResponse)
          .catch(error => { throw normalizeApiError(error); });
      };
    },
  });
}

function patchKubeConfigPrototype(KubeConfig) {
  const prototype = KubeConfig?.prototype;
  if (!prototype || prototype[PATCHED] || typeof prototype.makeApiClient !== 'function') return;
  const makeApiClient = prototype.makeApiClient;
  Object.defineProperty(prototype, PATCHED, { value: true });
  prototype.makeApiClient = function makeCompatibleApiClient(...args) {
    return adaptApiClient(makeApiClient.apply(this, args));
  };
}

module.exports = { adaptApiClient, apiParameters, legacyArguments, legacyResponse, normalizeApiError, patchKubeConfigPrototype };

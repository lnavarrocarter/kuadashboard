'use strict';

const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|session|email|phone|rut|ssn/i;
const MAX_FIELDS = 50;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 1000;

function parseJson(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function payloadShape(value, depth = 0) {
  if (depth > 3) return '...';
  if (Array.isArray(value)) return { type: 'array', length: value.length, items: value.length ? payloadShape(value[0], depth + 1) : null };
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [key, payloadShape(item, depth + 1)]));
  }
  if (value == null) return 'null';
  return typeof value;
}

function sanitizePayload(value, depth = 0, seen = new WeakSet()) {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizePayload(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, MAX_FIELDS).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizePayload(item, depth + 1, seen),
  ]));
}

function matchingPaths(value, query, path = '$', matches = []) {
  if (matches.length >= 20) return matches;
  if (Array.isArray(value)) {
    value.forEach((item, index) => matchingPaths(item, query, `${path}[${index}]`, matches));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) matchingPaths(item, query, `${path}.${key}`, matches);
  } else if (String(value ?? '').toLowerCase().includes(query.toLowerCase())) {
    matches.push(path);
  }
  return matches;
}

function eventDetails(event) {
  const key = Object.keys(event || {}).find(name => name.endsWith('EventDetails'));
  return key ? event[key] || {} : {};
}

function resourceFromEvent(event) {
  const details = eventDetails(event);
  const resource = details.resource || details.resourceType || '';
  const resourceType = details.resourceType || '';
  const parameters = parseJson(details.parameters) || {};
  if (event.type?.startsWith('LambdaFunction')) {
    return { type: 'lambda', name: String(resource).split(':').pop() || 'Lambda', resource };
  }
  if (/ecs/i.test(resourceType) || /ecs/i.test(resource) || event.type?.startsWith('Ecs')) {
    return { type: 'ecs', name: parameters.TaskDefinition || parameters.Cluster || 'ECS task', resource };
  }
  if (/s3/i.test(resourceType) || /s3/i.test(resource) || event.type?.startsWith('S3')) {
    return { type: 's3', name: parameters.Bucket || 'S3', resource };
  }
  if (event.type?.startsWith('Execution') && details.stateMachineArn) {
    return { type: 'stepfunctions', name: details.stateMachineArn.split(':').pop(), resource: details.stateMachineArn };
  }
  return null;
}

function eventData(details) {
  const request = parseJson(details.input) ?? parseJson(details.parameters);
  const response = parseJson(details.output);
  return {
    ...(request == null ? {} : { request: sanitizePayload(request) }),
    ...(response == null ? {} : { response: sanitizePayload(response) }),
    ...(details.error ? { error: String(details.error).slice(0, 300) } : {}),
    ...(details.cause ? { cause: sanitizePayload(parseJson(details.cause) ?? String(details.cause)) } : {}),
  };
}

function executionTimeline(events = [], { includeData = false } = {}) {
  return events.map(event => {
    const details = eventDetails(event);
    const resource = resourceFromEvent(event);
    return {
      id: event.id,
      previousEventId: event.previousEventId || null,
      timestamp: event.timestamp || null,
      type: event.type,
      state: details.name || null,
      status: /Failed|Aborted|TimedOut/.test(event.type) ? 'error' : /Succeeded/.test(event.type) ? 'success' : 'info',
      resource,
      ...(includeData ? { data: eventData(details) } : {}),
    };
  });
}

module.exports = { eventData, executionTimeline, matchingPaths, parseJson, payloadShape, resourceFromEvent, sanitizePayload };
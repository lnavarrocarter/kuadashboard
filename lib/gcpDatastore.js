'use strict';

function decodeValue(value) {
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.entityValue) return decodeProperties(value.entityValue.properties);
  return value.stringValue ?? value.integerValue ?? value.doubleValue ?? value.booleanValue
    ?? value.timestampValue ?? value.blobValue ?? value.keyValue ?? value.geoPointValue ?? null;
}
function decodeProperties(properties = {}) {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, decodeValue(value)]));
}
function createDatastoreReader(fetchApi, authCtx, db) {
  const databaseId = db === '(default)' ? '' : db;
  async function run(query, namespaceId = '') {
    const data = await fetchApi(`https://datastore.googleapis.com/v1/projects/${authCtx.projectId}:runQuery`,
      authCtx, 'POST', { databaseId, partitionId: { projectId: authCtx.projectId, databaseId, namespaceId }, query },
      { 'x-goog-request-params': new URLSearchParams({ project_id: authCtx.projectId, database_id: databaseId }).toString() });
    return data.batch || {};
  }
  async function metadata(kind, namespaceId = '') {
    const entities = [];
    let cursor;
    do {
      const batch = await run({ kind: [{ name: kind }], ...(cursor ? { startCursor: cursor } : {}) }, namespaceId);
      entities.push(...(batch.entityResults || []).map(result => result.entity));
      const next = ['NOT_FINISHED', 'MORE_RESULTS_AFTER_LIMIT'].includes(batch.moreResults) ? batch.endCursor : null;
      if (next && next === cursor) throw new Error('Datastore returned a non-advancing cursor');
      cursor = next;
    } while (cursor);
    return entities;
  }
  return {
    async collections() {
      const namespaces = await metadata('__namespace__');
      const rows = [];
      for (const namespace of namespaces) {
        const namespaceId = namespace.key.path.at(-1).name || '';
        for (const kind of await metadata('__kind__', namespaceId)) {
          rows.push({ id: kind.key.path.at(-1).name, namespace: namespaceId, docCount: null });
        }
      }
      return rows;
    },
    async documents(kind, { pageSize = 25, pageToken = '', namespace = '' } = {}) {
      const batch = await run({ kind: [{ name: kind }], limit: pageSize,
        ...(pageToken ? { startCursor: pageToken } : {}) }, namespace);
      return {
        docs: (batch.entityResults || []).map(({ entity }) => ({
          id: entity.key.path.map(part => `${part.kind}:${part.name ?? part.id}`).join('/'),
          fields: decodeProperties(entity.properties), created: null, updated: null,
        })),
        nextPageToken: ['NOT_FINISHED', 'MORE_RESULTS_AFTER_LIMIT'].includes(batch.moreResults) ? batch.endCursor || null : null,
      };
    },
  };
}
module.exports = { createDatastoreReader };

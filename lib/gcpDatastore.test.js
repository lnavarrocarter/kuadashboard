'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatastoreReader } = require('./gcpDatastore');

test('lists kinds across namespaces and metadata pages in a named database', async () => {
  const requests = [];
  const responses = [
    { entityResults: [{ entity: { key: { path: [{ id: '1' }] } } }], moreResults: 'NOT_FINISHED', endCursor: 'next' },
    { entityResults: [{ entity: { key: { path: [{ name: 'tenant' }] } } }] },
    { entityResults: [{ entity: { key: { path: [{ name: 'Users' }] } } }] },
    { entityResults: [{ entity: { key: { path: [{ name: 'Orders' }] } } }] },
  ];
  const reader = createDatastoreReader(async (url, auth, method, body, headers) => {
    requests.push({ url, method, body, headers }); return { batch: responses.shift() };
  }, { projectId: 'project' }, 'kua-control-plane');
  assert.deepEqual(await reader.collections(), [
    { id: 'Users', namespace: '', docCount: null }, { id: 'Orders', namespace: 'tenant', docCount: null },
  ]);
  assert.equal(requests[0].url, 'https://datastore.googleapis.com/v1/projects/project:runQuery');
  assert.equal(requests[0].body.databaseId, 'kua-control-plane');
  assert.equal(requests[0].headers['x-goog-request-params'], 'project_id=project&database_id=kua-control-plane');
  assert.equal(requests[1].body.query.startCursor, 'next');
  assert.equal(requests[3].body.partitionId.namespaceId, 'tenant');
});

test('reads entities, preserves typed values and paginates the default database', async () => {
  let request;
  const reader = createDatastoreReader(async (url, auth, method, body) => {
    request = body;
    return { batch: { moreResults: 'MORE_RESULTS_AFTER_LIMIT', endCursor: 'next', entityResults: [{ entity: {
      key: { path: [{ kind: 'Users', id: '123' }] }, properties: {
        active: { booleanValue: false }, size: { integerValue: '9007199254740993' },
        nested: { entityValue: { properties: { list: { arrayValue: { values: [{ nullValue: null }, { doubleValue: 0 }] } } } } },
      },
    } }] } };
  }, { projectId: 'project' }, '(default)');
  const result = await reader.documents('Users', { namespace: 'tenant', pageToken: 'previous', pageSize: 10 });
  assert.equal(request.databaseId, '');
  assert.equal(request.partitionId.namespaceId, 'tenant');
  assert.equal(request.query.startCursor, 'previous');
  assert.equal(request.query.limit, 10);
  assert.deepEqual(result.docs[0].fields, { active: false, size: '9007199254740993', nested: { list: [null, 0] } });
  assert.equal(result.docs[0].id, 'Users:123');
  assert.equal(result.nextPageToken, 'next');
});

test('does not paginate completed queries and propagates access errors', async () => {
  assert.equal((await createDatastoreReader(async () => ({ batch: { moreResults: 'NO_MORE_RESULTS', endCursor: 'end' } }), { projectId: 'p' }, 'db').documents('Users')).nextPageToken, null);
  await assert.rejects(createDatastoreReader(async () => { throw new Error('permission denied'); }, { projectId: 'p' }, 'db').collections(), /permission denied/);
});

'use strict';
function mapWorkflow(workflow) {
  return {
    name: workflow.name?.split('/').pop(), location: workflow.name?.split('/')[3],
    state: workflow.state, description: workflow.description || '', updated: workflow.updateTime,
    created: workflow.createTime, serviceAccount: workflow.serviceAccount?.split('/').pop() || '', labels: workflow.labels || {},
  };
}
async function listWorkflows(fetchApi, authCtx) {
  async function list(parent, collection, field, routingField = 'parent') {
    const items = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await fetchApi(`https://workflows.googleapis.com/v1/${parent}/${collection}?${params}`, authCtx, 'GET', undefined,
        { 'x-goog-request-params': new URLSearchParams({ [routingField]: parent }).toString() });
      items.push(...(data[field] || []));
      const next = data.nextPageToken || '';
      if (next && next === pageToken) throw new Error('Workflows returned a non-advancing page token');
      pageToken = next;
    } while (pageToken);
    return items;
  }
  const locations = await list(`projects/${authCtx.projectId}`, 'locations', 'locations', 'name');
  const results = new Array(locations.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, locations.length) }, async () => {
    while (index < locations.length) {
      const current = index++;
      results[current] = await list(locations[current].name, 'workflows', 'workflows');
    }
  }));
  return results.flat();
}
module.exports = { mapWorkflow, listWorkflows };

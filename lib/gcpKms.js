'use strict';

function createKmsReader(fetchApi, authCtx) {
  async function list(parent, collection, field, routingField = 'parent') {
    const items = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await fetchApi(`https://cloudkms.googleapis.com/v1/${parent}/${collection}?${params}`,
        authCtx, 'GET', undefined, { 'x-goog-request-params': new URLSearchParams({ [routingField]: parent }).toString() });
      items.push(...(data[field] || []));
      const next = data.nextPageToken || '';
      if (next && next === pageToken) throw new Error('Cloud KMS returned a non-advancing page token');
      pageToken = next;
    } while (pageToken);
    return items;
  }
  return {
    async keyRings() {
      const locations = await list(`projects/${authCtx.projectId}`, 'locations', 'locations', 'name');
      const results = new Array(locations.length);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(8, locations.length) }, async () => {
        while (index < locations.length) {
          const current = index++;
          results[current] = await list(locations[current].name, 'keyRings', 'keyRings');
        }
      }));
      return results.flat();
    },
    keys(location, ring) {
      return list(`projects/${authCtx.projectId}/locations/${location}/keyRings/${ring}`, 'cryptoKeys', 'cryptoKeys');
    },
  };
}
module.exports = { createKmsReader };

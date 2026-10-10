'use strict';
// Artifact Registry repositories. ListRepositories rejects the "locations/-"
// wildcard with 400 INVALID_ARGUMENT, so the project's locations are listed
// first and each one is read (all pages). Empty locations are cheap reads.

function mapRepository(r = {}) {
  return {
    name:        r.name?.split('/').pop(),
    location:    r.name?.split('/')[3],
    format:      r.format,
    description: r.description || '',
    created:     r.createTime,
    updated:     r.updateTime,
    sizeBytes:   r.sizeBytes ? parseInt(r.sizeBytes, 10) : null,
  };
}

async function listPages(fetchApi, authCtx, url, field) {
  const items = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '500' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await fetchApi(`${url}?${params}`, authCtx);
    items.push(...(data[field] || []));
    const next = data.nextPageToken || '';
    if (next && next === pageToken) throw new Error('Artifact Registry returned a non-advancing page token');
    pageToken = next;
  } while (pageToken);
  return items;
}

async function listArtifactRepositories(fetchApi, authCtx, { concurrency = 8 } = {}) {
  const base = `https://artifactregistry.googleapis.com/v1/projects/${authCtx.projectId}`;
  const locations = await listPages(fetchApi, authCtx, `${base}/locations`, 'locations');
  const ids = locations.map(l => l.locationId || String(l.name || '').split('/').pop()).filter(Boolean);
  const results = new Array(ids.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (index < ids.length) {
      const current = index++;
      results[current] = await listPages(fetchApi, authCtx, `${base}/locations/${ids[current]}/repositories`, 'repositories');
    }
  }));
  return results.flat();
}

module.exports = { mapRepository, listArtifactRepositories };

'use strict';
// REST list pagination for GCP collectors. Reads pages until there is no
// nextPageToken or maxPages is reached; in that case the result is marked
// partial instead of being presented as the exact inventory.
// Only pageToken is added: page size stays in the caller's URL because some
// APIs reject unknown query parameters (pageSize vs maxResults vs none).

async function listAllPages(fetchApi, authCtx, url, field, { maxPages = 20 } = {}) {
  const items = [];
  let pageToken = '';
  let pages = 0;
  do {
    const next = new URL(url);
    if (pageToken) next.searchParams.set('pageToken', pageToken);
    const data = await fetchApi(next.toString(), authCtx);
    items.push(...(data?.[field] || []));
    pages += 1;
    const token = data?.nextPageToken || '';
    if (token && token === pageToken) throw new Error(`Non-advancing page token while listing ${field}`);
    pageToken = token;
  } while (pageToken && pages < maxPages);
  return { items, partial: !!pageToken, pages };
}

module.exports = { listAllPages };

'use strict';
/**
 * lib/architecture/gcpInfraManager.js
 * Infrastructure Manager (Google's managed Terraform) deployments of a GCP project: GCP's
 * equivalent of a CloudFormation stack for the architecture map. A deployment's latest revision
 * lists the resources it manages with their Cloud Asset Inventory names, which map onto the keys of
 * the GCP resource catalog. Only List calls of config.googleapis.com, which Google does not charge
 * for; a project without the API enabled simply has no deployments.
 */

const API = 'https://config.googleapis.com/v1';
const MAX_PAGES = 20;

async function listAll(fetchApi, authCtx, url, field) {
  const items = [];
  let pageToken = '';
  let pages = 0;
  do {
    const next = new URL(url);
    if (pageToken) next.searchParams.set('pageToken', pageToken);
    const data = await fetchApi(next.toString(), authCtx);
    items.push(...(data?.[field] || []));
    pageToken = data?.nextPageToken || '';
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);
  return items;
}

/** Deployments of every location of the project, newest first. */
async function listDeployments(fetchApi, authCtx) {
  const locations = await listAll(fetchApi, authCtx, `${API}/projects/${authCtx.projectId}/locations?pageSize=100`, 'locations');
  const deployments = [];
  for (const location of locations) {
    const items = await listAll(fetchApi, authCtx, `${API}/${location.name}/deployments?pageSize=100`, 'deployments');
    for (const deployment of items) {
      const parts = String(deployment.name || '').split('/');
      deployments.push({
        id: deployment.name,
        name: parts[5] || deployment.name,
        location: parts[3] || location.locationId || '',
        state: deployment.state || null,
        latestRevision: deployment.latestRevision || null,
        labels: deployment.labels || {},
        updatedAt: deployment.updateTime || deployment.createTime || null,
      });
    }
  }
  return deployments.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

/**
 * The catalog key of a Cloud Asset Inventory name: `//service.googleapis.com/<path>` → `<path>`,
 * except buckets, whose CAI name has no project (`//storage.googleapis.com/<bucket>`).
 */
function catalogKeyOf(fullResourceName) {
  const value = String(fullResourceName || '');
  const bucket = /^\/\/storage\.googleapis\.com\/([^/]+)$/.exec(value);
  if (bucket) return `projects/_/buckets/${bucket[1]}`;
  return value.replace(/^\/\/[^/]+\//, '');
}

/** The resources a deployment manages: Terraform address and type, and their catalog keys. */
async function listDeploymentResources(fetchApi, authCtx, deployment) {
  if (!deployment?.latestRevision) return [];
  const resources = await listAll(fetchApi, authCtx, `${API}/${deployment.latestRevision}/resources?pageSize=500`, 'resources');
  return resources.map(resource => ({
    address: resource.terraformInfo?.address || null,
    terraformType: resource.terraformInfo?.type || null,
    keys: Object.values(resource.caiAssets || {}).map(asset => catalogKeyOf(asset.fullResourceName)).filter(Boolean),
  }));
}

module.exports = { listDeployments, listDeploymentResources, catalogKeyOf };

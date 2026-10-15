'use strict';
/**
 * lib/kua/resourceCatalog/gcp.js
 * The resources of a GCP project a KUA Application can hold (#282): Compute VMs and persistent
 * disks, GKE, Cloud SQL, buckets, Pub/Sub, Cloud Run services and jobs, Functions, Firestore,
 * Memorystore, Workflows, Cloud Scheduler, Cloud Tasks and BigQuery. Every item carries the full
 * resource name (`projects/P/...`), the project and the location in `attach`.
 *
 * Only List/Get calls of the GCP APIs, which Google does not charge for. An API that is disabled
 * or not readable is reported in `failures` and the other types still answer.
 */

const { listAllPages } = require('../../gcpPaging');
const { listSchedulerJobs, listTaskQueues, listCloudRunJobs } = require('../../gcpLocations');
const { listWorkflows } = require('../../gcpWorkflows');
const { createSnapshotPager, matchesSearch, mapLimited, catalogError, SNAPSHOT_TTL_MS } = require('./snapshots');

const CONCURRENCY = 4;
const last = value => String(value || '').split('/').filter(Boolean).pop() || '';
// projects/P/locations/L/... or projects/P/zones/Z/... or projects/P/regions/R/...
const locationOf = name => {
  const parts = String(name || '').split('/');
  const index = parts.findIndex(part => ['locations', 'zones', 'regions'].includes(part));
  return index >= 0 ? parts[index + 1] || '' : '';
};

/** Compute aggregated lists: { items: { 'zones/us-central1-a': { instances: [...] } }, nextPageToken }. */
async function aggregated(fetchApi, authCtx, resource, field) {
  const items = [];
  let pageToken = '';
  let pages = 0;
  do {
    const url = new URL(`https://compute.googleapis.com/compute/v1/projects/${authCtx.projectId}/aggregated/${resource}`);
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await fetchApi(url.toString(), authCtx);
    for (const scoped of Object.values(data?.items || {})) items.push(...(scoped?.[field] || []));
    pageToken = data?.nextPageToken || '';
    pages += 1;
  } while (pageToken && pages < 20);
  return { items, partial: !!pageToken };
}

// One entry per type. Readers return { items: [{ key, name, location, details }], partial }.
const TYPES = {
  'gcp-compute-instance': {
    label: 'Compute Engine VMs',
    async list({ fetchApi, authCtx, project }) {
      const page = await aggregated(fetchApi, authCtx, 'instances', 'instances');
      return {
        partial: page.partial,
        items: page.items.map(vm => {
          const zone = last(vm.zone);
          return {
            key: `projects/${project}/zones/${zone}/instances/${vm.name}`, name: vm.name, location: zone,
            details: { status: vm.status || null, machineType: last(vm.machineType) || null, disks: (vm.disks || []).map(disk => last(disk.source)).filter(Boolean) },
          };
        }),
      };
    },
  },
  'gcp-disk': {
    label: 'Persistent disks',
    async list({ fetchApi, authCtx, project }) {
      const page = await aggregated(fetchApi, authCtx, 'disks', 'disks');
      return {
        partial: page.partial,
        items: page.items.map(disk => {
          const zone = last(disk.zone);
          const region = last(disk.region);
          const location = zone || region;
          return {
            key: `projects/${project}/${zone ? 'zones' : 'regions'}/${location}/disks/${disk.name}`, name: disk.name, location,
            details: { sizeGb: disk.sizeGb ? Number(disk.sizeGb) : null, diskType: last(disk.type) || null, status: disk.status || null, attachedTo: (disk.users || []).map(last) },
          };
        }),
      };
    },
  },
  'gcp-gke': {
    label: 'GKE clusters',
    async list({ fetchApi, authCtx, project }) {
      const data = await fetchApi(`https://container.googleapis.com/v1/projects/${project}/locations/-/clusters`, authCtx);
      return {
        partial: (data?.missingZones || []).length > 0,
        items: (data?.clusters || []).map(cluster => ({
          key: `projects/${project}/locations/${cluster.location}/clusters/${cluster.name}`, name: cluster.name, location: cluster.location,
          details: { status: cluster.status || null, autopilot: !!cluster.autopilot?.enabled, version: cluster.currentMasterVersion || null },
        })),
      };
    },
  },
  'gcp-sql': {
    label: 'Cloud SQL instances',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://sqladmin.googleapis.com/v1/projects/${project}/instances`, 'items');
      return {
        partial: page.partial,
        items: page.items.map(instance => ({
          key: `projects/${project}/instances/${instance.name}`, name: instance.name, location: instance.region || '',
          details: { databaseVersion: instance.databaseVersion || null, state: instance.state || null, connectionName: instance.connectionName || null },
        })),
      };
    },
  },
  'gcp-bucket': {
    label: 'Cloud Storage buckets',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(project)}&maxResults=1000`, 'items');
      return {
        partial: page.partial,
        items: page.items.map(bucket => ({
          key: `projects/_/buckets/${bucket.name}`, name: bucket.name, location: String(bucket.location || '').toLowerCase(),
          details: { storageClass: bucket.storageClass || null, locationType: bucket.locationType || null },
        })),
      };
    },
  },
  'gcp-pubsub-topic': {
    label: 'Pub/Sub topics',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://pubsub.googleapis.com/v1/projects/${project}/topics?pageSize=1000`, 'topics');
      return { partial: page.partial, items: page.items.map(topic => ({ key: topic.name, name: last(topic.name), location: 'global', details: {} })) };
    },
  },
  'gcp-pubsub-subscription': {
    label: 'Pub/Sub subscriptions',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://pubsub.googleapis.com/v1/projects/${project}/subscriptions?pageSize=1000`, 'subscriptions');
      return {
        partial: page.partial,
        items: page.items.map(subscription => ({
          key: subscription.name, name: last(subscription.name), location: 'global',
          details: { topic: last(subscription.topic) || null, push: !!subscription.pushConfig?.pushEndpoint },
        })),
      };
    },
  },
  'gcp-cloud-run': {
    label: 'Cloud Run services',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://run.googleapis.com/v2/projects/${project}/locations/-/services?pageSize=500`, 'services');
      return { partial: page.partial, items: page.items.map(service => ({ key: service.name, name: last(service.name), location: locationOf(service.name), details: { uri: service.uri || null } })) };
    },
  },
  'gcp-cloud-run-job': {
    label: 'Cloud Run jobs',
    async list({ fetchApi, authCtx }) {
      const page = await listCloudRunJobs(fetchApi, authCtx);
      return { partial: !!page.partial, items: page.items.map(job => ({ key: job.name, name: last(job.name), location: locationOf(job.name), details: { lastStatus: job.latestCreatedExecution?.completionStatus || null } })) };
    },
  },
  'gcp-function': {
    label: 'Cloud Functions',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions?pageSize=500`, 'functions');
      return { partial: page.partial, items: page.items.map(fn => ({ key: fn.name, name: last(fn.name), location: locationOf(fn.name), details: { state: fn.state || null, runtime: fn.buildConfig?.runtime || null } })) };
    },
  },
  'gcp-firestore': {
    label: 'Firestore databases',
    async list({ fetchApi, authCtx, project }) {
      const data = await fetchApi(`https://firestore.googleapis.com/v1/projects/${project}/databases`, authCtx);
      return { partial: false, items: (data?.databases || []).map(db => ({ key: db.name, name: last(db.name), location: db.locationId || '', details: { type: db.type || null } })) };
    },
  },
  'gcp-memorystore': {
    label: 'Memorystore (Redis) instances',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://redis.googleapis.com/v1/projects/${project}/locations/-/instances?pageSize=500`, 'instances');
      return { partial: page.partial, items: page.items.map(instance => ({ key: instance.name, name: last(instance.name), location: locationOf(instance.name), details: { tier: instance.tier || null, state: instance.state || null, memorySizeGb: instance.memorySizeGb ?? null } })) };
    },
  },
  'gcp-workflow': {
    label: 'Workflows',
    async list({ fetchApi, authCtx }) {
      const items = await listWorkflows(fetchApi, authCtx);
      return { partial: false, items: items.map(workflow => ({ key: workflow.name, name: last(workflow.name), location: locationOf(workflow.name), details: { state: workflow.state || null } })) };
    },
  },
  'gcp-scheduler-job': {
    label: 'Cloud Scheduler jobs',
    async list({ fetchApi, authCtx }) {
      const page = await listSchedulerJobs(fetchApi, authCtx);
      return { partial: !!page.partial, items: page.items.map(job => ({ key: job.name, name: last(job.name), location: locationOf(job.name), details: { schedule: job.schedule || null, state: job.state || null } })) };
    },
  },
  'gcp-tasks-queue': {
    label: 'Cloud Tasks queues',
    async list({ fetchApi, authCtx }) {
      const page = await listTaskQueues(fetchApi, authCtx);
      return { partial: !!page.partial, items: page.items.map(queue => ({ key: queue.name, name: last(queue.name), location: locationOf(queue.name), details: { state: queue.state || null } })) };
    },
  },
  'gcp-bigquery-dataset': {
    label: 'BigQuery datasets',
    async list({ fetchApi, authCtx, project }) {
      const page = await listAllPages(fetchApi, authCtx, `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets?all=false&maxResults=1000`, 'datasets');
      return {
        partial: page.partial,
        items: page.items.map(dataset => {
          const id = dataset.datasetReference?.datasetId || last(String(dataset.id || '').replace(':', '/'));
          return { key: `projects/${project}/datasets/${id}`, name: id, location: String(dataset.location || '').toLowerCase(), details: {} };
        }),
      };
    },
  },
};

const TYPE_NAMES = Object.keys(TYPES);

/** The catalog types a full resource name can be (a name may fit two, e.g. Cloud Run and Scheduler jobs). */
function typesForName(name) {
  const value = String(name || '').replace(/^\/\/[^/]+\//, '');
  const rules = [
    [/^projects\/[^/]+\/zones\/[^/]+\/instances\/[^/]+$/, ['gcp-compute-instance']],
    [/^projects\/[^/]+\/(zones|regions)\/[^/]+\/disks\/[^/]+$/, ['gcp-disk']],
    [/^projects\/[^/]+\/locations\/[^/]+\/clusters\/[^/]+$/, ['gcp-gke']],
    [/^projects\/[^/]+\/instances\/[^/]+$/, ['gcp-sql']],
    [/^projects\/_\/buckets\/[^/]+$/, ['gcp-bucket']],
    [/^projects\/[^/]+\/topics\/[^/]+$/, ['gcp-pubsub-topic']],
    [/^projects\/[^/]+\/subscriptions\/[^/]+$/, ['gcp-pubsub-subscription']],
    [/^projects\/[^/]+\/locations\/[^/]+\/services\/[^/]+$/, ['gcp-cloud-run']],
    [/^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/, ['gcp-cloud-run-job', 'gcp-scheduler-job']],
    [/^projects\/[^/]+\/locations\/[^/]+\/functions\/[^/]+$/, ['gcp-function']],
    [/^projects\/[^/]+\/databases\/[^/]+$/, ['gcp-firestore']],
    [/^projects\/[^/]+\/locations\/[^/]+\/instances\/[^/]+$/, ['gcp-memorystore']],
    [/^projects\/[^/]+\/locations\/[^/]+\/workflows\/[^/]+$/, ['gcp-workflow']],
    [/^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/, ['gcp-tasks-queue']],
    [/^projects\/[^/]+\/datasets\/[^/]+$/, ['gcp-bigquery-dataset']],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || null;
}

function errorCode(error) {
  const status = Number(error?.code || error?.statusCode || 0);
  const text = String(error?.message || '');
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) return 'api_disabled';
  if (status === 401 || /UNAUTHENTICATED|invalid authentication/i.test(text)) return 'credentials';
  if (status === 403 || /PERMISSION_DENIED/i.test(text)) return 'access_denied';
  return status ? `http_${status}` : (error?.name || 'list_failed');
}

function createGcpResourceCatalog({
  // routes/gcp.js resolves local gcloud configs and stored service accounts, with its token cache.
  resolveAuth = profileId => require('../../../routes/gcp').resolveGcpAuth(profileId),
  fetchApi = (...args) => require('../../../routes/gcp').gcpFetch(...args),
  forgetRejectedToken = (profileId, error) => require('../../../routes/gcp').forgetRejectedGcpToken?.(profileId, error),
  now = () => Date.now(),
  snapshotTtlMs = SNAPSHOT_TTL_MS,
} = {}) {
  const pager = createSnapshotPager({ now, ttlMs: snapshotTtlMs });

  function types() {
    return TYPE_NAMES.map(type => ({ type, label: TYPES[type].label }));
  }

  async function list({ profileId, types: requestedTypes, search, name, limit, cursor } = {}) {
    if (cursor) {
      const { snapshot, offset } = pager.resume(cursor, profileId);
      return pager.page(snapshot, { offset, limit, owner: profileId });
    }
    if (!profileId) throw catalogError('profile is required', 400, 'INVALID');
    let types = Array.isArray(requestedTypes) && requestedTypes.length ? [...new Set(requestedTypes)] : TYPE_NAMES;
    if (name) {
      const candidates = typesForName(name);
      if (!candidates) throw catalogError(`The catalog does not list this kind of resource name: ${name}`, 400, 'UNSUPPORTED_NAME');
      types = candidates;
    }
    const unknown = types.filter(type => !TYPES[type]);
    if (unknown.length) throw catalogError(`Unknown type(s): ${unknown.join(', ')}. Known: ${TYPE_NAMES.join(', ')}`, 400, 'INVALID');
    const authCtx = await resolveAuth(profileId);
    const project = authCtx?.projectId;
    if (!project) throw catalogError('This GCP profile has no project', 400, 'PROJECT_REQUIRED');
    // A full resource name resolves one resource: its type is the one whose key matches.
    const wanted = name ? String(name).replace(/^\/\/[^/]+\//, '') : null;
    const failures = [];
    const partialTypes = [];
    const lists = await mapLimited(types, CONCURRENCY, async type => {
      try {
        const result = await TYPES[type].list({ fetchApi, authCtx, project });
        if (result.partial) partialTypes.push(type);
        return result.items.map(item => ({
          type, name: item.name, key: item.key, project, location: item.location || '', details: item.details || {},
          attach: { provider: 'gcp', type, key: item.key, name: item.name, scopeId: project, location: item.location || '' },
        }));
      } catch (error) {
        forgetRejectedToken(profileId, error);
        failures.push({ type, code: errorCode(error) });
        return [];
      }
    });
    const items = lists.flat().filter(item => (!wanted || item.key === wanted) && matchesSearch(item, search));
    const snapshot = {
      generatedAt: new Date(now()).toISOString(), project, types, failures, partialTypes, items,
      ...(wanted ? { name: wanted, found: items.length > 0 } : {}),
    };
    return pager.page(snapshot, { offset: 0, limit, owner: profileId });
  }

  return { types, list };
}

module.exports = { createGcpResourceCatalog, typesForName, GCP_CATALOG_TYPES: TYPE_NAMES };

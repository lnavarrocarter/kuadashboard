'use strict';
// Lists a regional collection in every location of the project. Several APIs
// reject the "locations/-" wildcard with 400 INVALID_ARGUMENT (Artifact
// Registry, Cloud Scheduler, Cloud Run v2 jobs, Cloud Tasks), so the locations
// are listed first and each one is read with all its pages.
const { listAllPages } = require('./gcpPaging');
const { classifyGcpError } = require('./gcpErrors');

// A location the organization policy forbids (or that does not exist for this
// API) cannot hold resources: it is skipped, not reported as a failure.
function isSkippableLocationError(err) {
  const info = classifyGcpError(err);
  return info.reason === 'LOCATION_POLICY_VIOLATED' || info.kind === 'not_found';
}

// locations: where the API publishes its locations; items: the regional list.
// Cloud Run v2 has no locations list, v1 does.
const SOURCES = {
  artifact: {
    locations: p => `https://artifactregistry.googleapis.com/v1/projects/${p}/locations`,
    items: (p, l) => `https://artifactregistry.googleapis.com/v1/projects/${p}/locations/${l}/repositories`, field: 'repositories',
  },
  scheduler: {
    locations: p => `https://cloudscheduler.googleapis.com/v1/projects/${p}/locations`,
    items: (p, l) => `https://cloudscheduler.googleapis.com/v1/projects/${p}/locations/${l}/jobs`, field: 'jobs',
  },
  tasks: {
    locations: p => `https://cloudtasks.googleapis.com/v2/projects/${p}/locations`,
    items: (p, l) => `https://cloudtasks.googleapis.com/v2/projects/${p}/locations/${l}/queues`, field: 'queues',
  },
  runJobs: {
    locations: p => `https://run.googleapis.com/v1/projects/${p}/locations`,
    items: (p, l) => `https://run.googleapis.com/v2/projects/${p}/locations/${l}/jobs`, field: 'jobs',
  },
};

async function listAcrossLocations(fetchApi, authCtx, source, { concurrency = 8 } = {}) {
  const project = authCtx.projectId;
  const { items: locations } = await listAllPages(fetchApi, authCtx, source.locations(project), 'locations');
  const ids = locations.map(l => l.locationId || String(l.name || '').split('/').pop()).filter(Boolean);
  const results = new Array(ids.length).fill([]);
  const failures = [];
  const skippedLocations = [];
  let partial = false;
  let read = 0;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (index < ids.length) {
      const current = index++;
      try {
        const page = await listAllPages(fetchApi, authCtx, source.items(project, ids[current]), source.field);
        results[current] = page.items;
        partial = partial || page.partial;
        read += 1;
      } catch (err) {
        if (isSkippableLocationError(err)) skippedLocations.push(ids[current]);
        else failures.push({ location: ids[current], err });
      }
    }
  }));
  // Nothing could be read: surface the real error instead of an empty list.
  if (failures.length && !read) throw failures[0].err;
  return { items: results.flat(), partial: partial || failures.length > 0, failedLocations: failures.map(f => f.location), skippedLocations };
}

const listRegional = kind => (fetchApi, authCtx) => listAcrossLocations(fetchApi, authCtx, SOURCES[kind]);

module.exports = {
  SOURCES,
  listAcrossLocations,
  listArtifactRepositories: listRegional('artifact'),
  listSchedulerJobs: listRegional('scheduler'),
  listTaskQueues: listRegional('tasks'),
  listCloudRunJobs: listRegional('runJobs'),
};

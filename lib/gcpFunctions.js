'use strict';
// Cloud Functions identity. The canonical resource name is
// projects/{project}/locations/{region}/functions/{name}; the region is
// segment 3 and the name segment 5. Reading the wrong segment sent the
// function name as the location and turned every detail read into a 403.

const REGION_RE = /^[a-z]+(?:-[a-z]+)+\d+$/;
const NAME_RE = /^[A-Za-z0-9_-]+$/;

function parseFunctionName(fullName) {
  const parts = String(fullName || '').split('/');
  if (parts.length !== 6 || parts[0] !== 'projects' || parts[2] !== 'locations' || parts[4] !== 'functions') return null;
  const [, project, , location, , name] = parts;
  if (!project || !location || !name) return null;
  return { project, location, name, fullName: String(fullName) };
}

function isValidRegion(location) {
  return REGION_RE.test(String(location || ''));
}

function isValidFunctionName(name) {
  return NAME_RE.test(String(name || ''));
}

// Route params guard: the location must look like a region before a request
// goes out, so a malformed identity fails locally instead of as an IAM error.
function functionParamsError({ location, name } = {}) {
  if (!isValidRegion(location)) return `Invalid function region "${location}". Expected a region such as us-central1.`;
  if (!isValidFunctionName(name)) return `Invalid function name "${name}".`;
  return null;
}

function mapFunction(f = {}) {
  const id = parseFunctionName(f.name);
  return {
    name:     id?.name || String(f.name || '').split('/').pop(),
    location: id?.location || null,
    fullName: id?.fullName || f.name || null,
    runtime:  f.buildConfig?.runtime,
    state:    f.state,
    trigger:  f.eventTrigger?.eventType ? 'EVENT' : 'HTTPS',
    url:      f.serviceConfig?.uri,
    updated:  f.updateTime,
  };
}

// Gen 2 functions run as Cloud Run services; Gen 1 log under cloud_function.
// Both clauses are pinned to the region so homonyms in other regions stay out.
function functionLogFilter({ location, name, since }) {
  return [
    `((resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions" AND resource.labels.service_name="${name}" AND resource.labels.location="${location}")`,
    `OR (resource.type="cloud_function" AND resource.labels.function_name="${name}" AND resource.labels.region="${location}"))`,
    `timestamp>="${since}"`,
  ].join(' ');
}

module.exports = { parseFunctionName, isValidRegion, isValidFunctionName, functionParamsError, mapFunction, functionLogFilter };

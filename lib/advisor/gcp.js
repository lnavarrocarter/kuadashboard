'use strict';
/**
 * lib/advisor/gcp.js
 * Good-practice checks for the GCP Overview, from the rows the overview
 * already collects (no extra API calls): Cloud Run, VMs and Cloud SQL come
 * mapped by lib/gcpResources.js; GKE clusters, buckets and functions come as
 * the raw API objects. A collector that failed is reported as unavailable
 * and its checks are skipped. Pure: no I/O.
 */

const { check, buildReport, isFloatingImage } = require('./core');

const DOCS = {
  serviceAccounts: 'https://cloud.google.com/iam/docs/service-account-overview#default',
  runIdentity: 'https://cloud.google.com/run/docs/securing/service-identity',
  vmExternalIp: 'https://cloud.google.com/compute/docs/connect/ssh-using-iap',
  sqlPrivateIp: 'https://cloud.google.com/sql/docs/mysql/configure-private-ip',
  sqlBackups: 'https://cloud.google.com/sql/docs/mysql/backup-recovery/backups',
  sqlHa: 'https://cloud.google.com/sql/docs/mysql/high-availability',
  sqlDeletion: 'https://cloud.google.com/sql/docs/mysql/deletion-protection',
  bucketUniform: 'https://cloud.google.com/storage/docs/uniform-bucket-level-access',
  bucketPublic: 'https://cloud.google.com/storage/docs/public-access-prevention',
  bucketVersioning: 'https://cloud.google.com/storage/docs/object-versioning',
  gkeHardening: 'https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster',
  gkePrivate: 'https://cloud.google.com/kubernetes-engine/docs/concepts/private-cluster-concept',
  gkeWorkloadIdentity: 'https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity',
  gkeAuthorizedNetworks: 'https://cloud.google.com/kubernetes-engine/docs/how-to/authorized-networks',
  gkeReleaseChannels: 'https://cloud.google.com/kubernetes-engine/docs/concepts/release-channels',
  gkeRegional: 'https://cloud.google.com/kubernetes-engine/docs/concepts/regional-clusters',
  runIngress: 'https://cloud.google.com/run/docs/securing/ingress',
  runMaxInstances: 'https://cloud.google.com/run/docs/configuring/max-instances',
  images: 'https://cloud.google.com/run/docs/deploying#images',
  functionRuntimes: 'https://cloud.google.com/functions/docs/runtime-support',
  keptDisks: 'https://cloud.google.com/compute/docs/disks/add-persistent-disk#updateautodelete',
};

const RULES = {
  gkeLegacyAbac: { id: 'gcp.gke_legacy_abac', category: 'security', severity: 'high', docs: DOCS.gkeHardening },
  defaultSa: { id: 'gcp.default_service_account', category: 'security', severity: 'medium', docs: DOCS.runIdentity },
  vmPublicIp: { id: 'gcp.vm_public_ip', category: 'security', severity: 'medium', docs: DOCS.vmExternalIp },
  sqlPublicIp: { id: 'gcp.sql_public_ip', category: 'security', severity: 'medium', docs: DOCS.sqlPrivateIp },
  bucketUniform: { id: 'gcp.bucket_uniform_access', category: 'security', severity: 'medium', docs: DOCS.bucketUniform },
  gkePublicNodes: { id: 'gcp.gke_public_nodes', category: 'security', severity: 'medium', docs: DOCS.gkePrivate },
  gkeWorkloadIdentity: { id: 'gcp.gke_no_workload_identity', category: 'security', severity: 'medium', docs: DOCS.gkeWorkloadIdentity },
  gkeAuthorizedNetworks: { id: 'gcp.gke_no_authorized_networks', category: 'security', severity: 'medium', docs: DOCS.gkeAuthorizedNetworks },
  bucketPublicPrevention: { id: 'gcp.bucket_public_prevention', category: 'security', severity: 'low', docs: DOCS.bucketPublic },
  runPublicIngress: { id: 'gcp.cloudrun_public_ingress', category: 'security', severity: 'low', docs: DOCS.runIngress },
  sqlNoBackup: { id: 'gcp.sql_no_backup', category: 'infrastructure', severity: 'high', docs: DOCS.sqlBackups },
  sqlDeletion: { id: 'gcp.sql_deletion_protection', category: 'infrastructure', severity: 'low', docs: DOCS.sqlDeletion },
  keptDisks: { id: 'gcp.vm_kept_disks', category: 'infrastructure', severity: 'low', docs: DOCS.keptDisks },
  gkeReleaseChannel: { id: 'gcp.gke_no_release_channel', category: 'infrastructure', severity: 'low', docs: DOCS.gkeReleaseChannels },
  bucketVersioning: { id: 'gcp.bucket_no_versioning', category: 'infrastructure', severity: 'low', docs: DOCS.bucketVersioning },
  sqlZonal: { id: 'gcp.sql_zonal', category: 'architecture', severity: 'medium', docs: DOCS.sqlHa },
  gkeZonal: { id: 'gcp.gke_zonal', category: 'architecture', severity: 'low', docs: DOCS.gkeRegional },
  runUnbounded: { id: 'gcp.cloudrun_unbounded', category: 'architecture', severity: 'low', docs: DOCS.runMaxInstances },
  deprecatedRuntime: { id: 'gcp.function_deprecated_runtime', category: 'development', severity: 'high', docs: DOCS.functionRuntimes },
  floatingImage: { id: 'gcp.latest_tag', category: 'development', severity: 'medium', docs: DOCS.images },
};

// Cloud Functions runtimes past their deprecation date (as of 2026).
const DEPRECATED_RUNTIMES = new Set([
  'nodejs6', 'nodejs8', 'nodejs10', 'nodejs12', 'nodejs14', 'nodejs16',
  'python37', 'python38',
  'go111', 'go113', 'go116', 'go118',
  'ruby26', 'ruby27', 'ruby30',
  'php74', 'php81',
  'java11', 'dotnet3',
]);

const DEFAULT_COMPUTE_SA_RE = /-compute@developer\.gserviceaccount\.com$/;
const ZONE_RE = /^[a-z]+-[a-z]+\d+-[a-z]$/;
const last = value => String(value || '').split('/').pop();

function cloudRunRules(services) {
  const ref = (s, detail) => ({ kind: 'Cloud Run', name: s.name, ...(s.region ? { namespace: s.region } : {}), ...(detail ? { detail } : {}) });
  return {
    defaultSa: services.filter(s => !s.serviceAccount || DEFAULT_COMPUTE_SA_RE.test(s.serviceAccount)).map(s => ref(s, s.serviceAccount || 'default compute SA')),
    publicIngress: services.filter(s => s.ingress === 'all').map(s => ref(s)),
    unbounded: services.filter(s => s.maxInstances == null || s.maxInstances === 0).map(s => ref(s)),
    floating: services.filter(s => isFloatingImage(s.image)).map(s => ref(s, s.image)),
  };
}

function vmRules(vms) {
  const ref = (vm, detail) => ({ kind: 'VM', name: vm.name, ...(vm.zone ? { namespace: vm.zone } : {}), ...(detail ? { detail } : {}) });
  return {
    defaultSa: vms.filter(vm => DEFAULT_COMPUTE_SA_RE.test(vm.serviceAccount || '')).map(vm => ref(vm, vm.serviceAccount)),
    publicIp: vms.filter(vm => vm.externalIp).map(vm => ref(vm, vm.externalIp)),
    keptDisks: vms.filter(vm => vm.keptDiskCount > 0).map(vm => ref(vm, `${vm.keptDiskCount} disk(s)`)),
  };
}

function sqlRules(instances) {
  const ref = (i, detail) => ({ kind: 'Cloud SQL', name: i.name, ...(i.region ? { namespace: i.region } : {}), ...(detail ? { detail } : {}) });
  return [
    check(RULES.sqlPublicIp, instances.filter(i => i.publicIp).map(i => ref(i, i.publicIp))),
    check(RULES.sqlNoBackup, instances.filter(i => !i.backupEnabled).map(i => ref(i, i.database))),
    check(RULES.sqlDeletion, instances.filter(i => !i.deletionProtection).map(i => ref(i))),
    check(RULES.sqlZonal, instances.filter(i => i.availabilityType !== 'REGIONAL').map(i => ref(i, i.tier))),
  ];
}

function bucketRules(buckets) {
  const ref = (b, detail) => ({ kind: 'Bucket', name: b.name, ...(b.location ? { namespace: String(b.location).toLowerCase() } : {}), ...(detail ? { detail } : {}) });
  return [
    check(RULES.bucketUniform, buckets.filter(b => !b.iamConfiguration?.uniformBucketLevelAccess?.enabled).map(b => ref(b))),
    check(RULES.bucketPublicPrevention, buckets.filter(b => b.iamConfiguration?.publicAccessPrevention !== 'enforced').map(b => ref(b))),
    check(RULES.bucketVersioning, buckets.filter(b => !b.versioning?.enabled).map(b => ref(b))),
  ];
}

function gkeRules(clusters) {
  const ref = (c, detail) => ({ kind: 'GKE', name: c.name, ...(c.location ? { namespace: c.location } : {}), ...(detail ? { detail } : {}) });
  const autopilot = c => !!c.autopilot?.enabled;
  return [
    check(RULES.gkeLegacyAbac, clusters.filter(c => c.legacyAbac?.enabled).map(c => ref(c))),
    check(RULES.gkePublicNodes, clusters.filter(c => !c.privateClusterConfig?.enablePrivateNodes && !c.networkConfig?.defaultEnablePrivateNodes).map(c => ref(c))),
    // Autopilot always has Workload Identity.
    check(RULES.gkeWorkloadIdentity, clusters.filter(c => !autopilot(c) && !c.workloadIdentityConfig?.workloadPool).map(c => ref(c))),
    check(RULES.gkeAuthorizedNetworks, clusters
      .filter(c => !c.privateClusterConfig?.enablePrivateEndpoint && !c.masterAuthorizedNetworksConfig?.enabled)
      .map(c => ref(c, c.endpoint || null))),
    check(RULES.gkeReleaseChannel, clusters.filter(c => !c.releaseChannel?.channel || c.releaseChannel.channel === 'UNSPECIFIED').map(c => ref(c, c.currentMasterVersion))),
    check(RULES.gkeZonal, clusters.filter(c => ZONE_RE.test(c.location || '')).map(c => ref(c))),
  ];
}

function functionRules(functions) {
  const ref = (fn, detail) => ({ kind: 'Function', name: last(fn.name), ...(detail ? { detail } : {}) });
  return {
    deprecated: functions.filter(fn => DEPRECATED_RUNTIMES.has(fn.buildConfig?.runtime)).map(fn => ref(fn, fn.buildConfig.runtime)),
    defaultSa: functions
      .filter(fn => fn.serviceConfig && (!fn.serviceConfig.serviceAccountEmail || DEFAULT_COMPUTE_SA_RE.test(fn.serviceConfig.serviceAccountEmail)))
      .map(fn => ref(fn, fn.serviceConfig.serviceAccountEmail || 'default compute SA')),
  };
}

/**
 * @param rows        Map or object: collector id → rows (only for collectors that succeeded)
 * @param unavailable collector ids that failed
 */
function adviseGcp({ rows = {}, unavailable = [], projectId = null, now = Date.now() } = {}) {
  const get = id => (rows instanceof Map ? rows.get(id) : rows[id]);
  const has = id => !unavailable.includes(id) && Array.isArray(get(id));
  const results = [];

  const run = has('cloudrun') ? cloudRunRules(get('cloudrun')) : null;
  const vms = has('vms') ? vmRules(get('vms')) : null;
  const fns = has('functions') ? functionRules(get('functions')) : null;

  if (run || vms || fns) {
    results.push(check(RULES.defaultSa, [...(run?.defaultSa || []), ...(vms?.defaultSa || []), ...(fns?.defaultSa || [])]));
  }
  if (run) {
    results.push(check(RULES.runPublicIngress, run.publicIngress));
    results.push(check(RULES.runUnbounded, run.unbounded));
    results.push(check(RULES.floatingImage, run.floating));
  }
  if (vms) {
    results.push(check(RULES.vmPublicIp, vms.publicIp));
    results.push(check(RULES.keptDisks, vms.keptDisks));
  }
  if (fns) results.push(check(RULES.deprecatedRuntime, fns.deprecated));
  if (has('sql')) results.push(...sqlRules(get('sql')));
  if (has('storage')) results.push(...bucketRules(get('storage')));
  if (has('gke')) results.push(...gkeRules(get('gke')));

  const checked = ['cloudrun', 'vms', 'functions', 'sql', 'storage', 'gke'];
  return buildReport(results, {
    unavailable: unavailable.filter(id => checked.includes(id)).map(source => ({ source })),
    scope: { provider: 'gcp', projectId },
    now,
  });
}

module.exports = { adviseGcp, RULES, DEPRECATED_RUNTIMES };

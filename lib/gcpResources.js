'use strict';

// Cloud Run, Compute Engine and Cloud SQL helpers for routes/gcp.js:
//   - list-row mapping (the list APIs already return full resources, so the
//     tables get detail-level columns without one detail call per row)
//   - approximate monthly cost estimates shown before anything that bills
//   - validation of create/delete requests, including the typed-name and
//     cost acknowledgements the UI asks for (enforced again server side)

// ── Helpers ──────────────────────────────────────────────────────────────────

const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;
// Above this estimate the create request needs a second, explicit acknowledgement.
const HIGH_COST_THRESHOLD_USD = 100;

function lastSegment(value) {
  return value ? String(value).split('/').pop() : null;
}

function toIso(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp === 'string') return timestamp;
  if (timestamp.seconds != null) return new Date(Number(timestamp.seconds) * 1000).toISOString();
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Cloud Run ────────────────────────────────────────────────────────────────

function cloudRunStatus(s) {
  const state = s.terminalCondition?.state;
  if (s.reconciling) return 'reconciling';
  if (state === 'CONDITION_FAILED') return 'failed';
  return 'ready';
}

function mapCloudRunService(s) {
  const container = s.template?.containers?.[0] || {};
  const limits = container.resources?.limits || {};
  const latestReady = lastSegment(s.latestReadyRevision);
  const latestCreated = lastSegment(s.latestCreatedRevision);
  return {
    name: lastSegment(s.name),
    region: s.name?.split('/')[3] || null,
    uri: s.uri || null,
    status: cloudRunStatus(s),
    statusMessage: s.terminalCondition?.message || null,
    minInstances: s.template?.scaling?.minInstanceCount ?? 0,
    maxInstances: s.template?.scaling?.maxInstanceCount ?? null,
    image: container.image || null,
    cpu: limits.cpu || null,
    memory: limits.memory || null,
    port: container.ports?.[0]?.containerPort || null,
    ingress: s.ingress ? String(s.ingress).replace(/^INGRESS_TRAFFIC_/, '').toLowerCase() : null,
    serviceAccount: s.template?.serviceAccount || null,
    latestRevision: latestReady || latestCreated,
    // A newer revision exists that is not serving yet (still deploying or failed)
    revisionPending: !!(latestCreated && latestReady && latestCreated !== latestReady),
    updatedAt: toIso(s.updateTime),
    lastModifier: s.lastModifier || null,
  };
}

// ── Compute Engine ───────────────────────────────────────────────────────────

function mapVm(vm) {
  const nic = vm.networkInterfaces?.[0] || {};
  const disks = vm.disks || [];
  const provisioning = vm.scheduling?.provisioningModel || (vm.scheduling?.preemptible ? 'PREEMPTIBLE' : 'STANDARD');
  return {
    name: vm.name,
    zone: lastSegment(vm.zone),
    status: vm.status,
    machineType: lastSegment(vm.machineType),
    diskType: lastSegment(disks[0]?.type || disks[0]?.diskType) || 'pd-balanced',
    cpuPlatform: vm.cpuPlatform || null,
    externalIp: nic.accessConfigs?.[0]?.natIP || null,
    internalIp: nic.networkIP || null,
    network: lastSegment(nic.network),
    subnetwork: lastSegment(nic.subnetwork),
    diskCount: disks.length,
    diskSizeGb: disks.reduce((sum, d) => sum + Number(d.diskSizeGb || 0), 0),
    // Disks without autoDelete survive a VM deletion and keep billing
    keptDiskCount: disks.filter(d => d.autoDelete === false).length,
    bootImage: lastSegment(disks.find(d => d.boot)?.licenses?.[0]) || null,
    provisioningModel: provisioning,
    deletionProtection: !!vm.deletionProtection,
    serviceAccount: vm.serviceAccounts?.[0]?.email || null,
    labels: vm.labels || {},
    tags: vm.tags?.items || [],
    createdAt: vm.creationTimestamp || null,
  };
}

// ── Cloud SQL ────────────────────────────────────────────────────────────────

// Cloud SQL `state` stays RUNNABLE while stopped (activationPolicy NEVER), so the
// table derives a clearer status from both fields.
function sqlStatus(i) {
  const policy = i.settings?.activationPolicy;
  if (i.state === 'RUNNABLE' && policy === 'NEVER') return 'STOPPED';
  if (i.state === 'RUNNABLE') return 'RUNNING';
  return i.state || 'UNKNOWN';
}

function mapSqlInstance(i) {
  const s = i.settings || {};
  const ips = i.ipAddresses || [];
  return {
    name: i.name,
    database: i.databaseVersion,
    region: i.region,
    zone: i.gceZone || null,
    state: i.state,
    status: sqlStatus(i),
    activationPolicy: s.activationPolicy || null,
    tier: s.tier || null,
    edition: s.edition || null,
    availabilityType: s.availabilityType || null,
    storageGb: s.dataDiskSizeGb ? Number(s.dataDiskSizeGb) : null,
    storageType: s.dataDiskType || null,
    backupEnabled: !!s.backupConfiguration?.enabled,
    deletionProtection: !!s.deletionProtectionEnabled,
    ipAddress: ips[0]?.ipAddress || null,
    publicIp: ips.find(ip => ip.type === 'PRIMARY')?.ipAddress || null,
    privateIp: ips.find(ip => ip.type === 'PRIVATE')?.ipAddress || null,
    connectionName: i.connectionName || null,
    createdAt: i.createTime || null,
  };
}

// ── Cost estimates ───────────────────────────────────────────────────────────
// Approximate on-demand list prices in USD (us-central1). Enough to warn before
// billing starts; not a quote — no discounts, free tier, egress or taxes.

const PRICES = {
  compute: {
    // per vCPU-hour and GiB-hour by machine family
    families: {
      e2: { cpu: 0.021811, mem: 0.002923 },
      n1: { cpu: 0.031611, mem: 0.004237 },
      n2: { cpu: 0.031611, mem: 0.004237 },
      n2d: { cpu: 0.027502, mem: 0.003686 },
      c2: { cpu: 0.03398, mem: 0.00455 },
      c3: { cpu: 0.03465, mem: 0.00464 },
      t2d: { cpu: 0.027502, mem: 0.003686 },
    },
    sharedCore: { 'e2-micro': 0.008376, 'e2-small': 0.016751, 'e2-medium': 0.033503, 'f1-micro': 0.0076, 'g1-small': 0.0257 },
    disk: { 'pd-standard': 0.04, 'pd-balanced': 0.10, 'pd-ssd': 0.17 },
    externalIpHour: 0.005,
    spotDiscount: 0.6, // conservative; real Spot discounts are 60-91% and vary
  },
  sql: {
    cpuHour: 0.0413,
    memGbHour: 0.007,
    sharedCore: { 'db-f1-micro': 0.0105, 'db-g1-small': 0.035 },
    storage: { PD_SSD: 0.17, PD_HDD: 0.09 },
  },
  cloudRun: {
    // Always-allocated idle rate for min instances, per vCPU-second and GiB-second
    idleCpuSecond: 0.0000025,
    idleMemGibSecond: 0.0000025,
  },
};

const MEMORY_PER_VCPU = { standard: 4, highmem: 8, highcpu: 1 };

function parseMachineType(machineType) {
  const type = String(machineType || '');
  if (PRICES.compute.sharedCore[type]) return { shared: true };
  const custom = type.match(/^(?:([a-z0-9]+)-)?custom-(\d+)-(\d+)$/);
  if (custom) return { family: custom[1] || 'n1', vcpus: Number(custom[2]), memGb: Number(custom[3]) / 1024 };
  const std = type.match(/^([a-z0-9]+)-(standard|highmem|highcpu)-(\d+)$/);
  if (std) return { family: std[1], vcpus: Number(std[3]), memGb: Number(std[3]) * MEMORY_PER_VCPU[std[2]] };
  return null;
}

function estimateVm({ machineType, diskSizeGb = 10, diskType = 'pd-balanced', externalIp = true, spot = false }) {
  const items = [];
  const warnings = [];
  const shared = PRICES.compute.sharedCore[machineType];
  let computeHour;
  if (shared) {
    computeHour = shared;
  } else {
    const parsed = parseMachineType(machineType);
    const rates = parsed && PRICES.compute.families[parsed.family];
    if (!rates) return { known: false, monthlyUsd: null, items, warnings: [`No price data for machine type ${machineType}`] };
    computeHour = parsed.vcpus * rates.cpu + parsed.memGb * rates.mem;
  }
  if (spot) {
    computeHour *= 1 - PRICES.compute.spotDiscount;
    warnings.push('Spot VMs can be stopped by Google at any time.');
  }
  items.push({ label: `VM ${machineType}${spot ? ' (Spot)' : ''}`, monthlyUsd: round2(computeHour * HOURS_PER_MONTH) });
  const diskRate = PRICES.compute.disk[diskType] ?? PRICES.compute.disk['pd-balanced'];
  items.push({ label: `${diskSizeGb} GB ${diskType}`, monthlyUsd: round2(diskSizeGb * diskRate) });
  if (externalIp) items.push({ label: 'External IPv4', monthlyUsd: round2(PRICES.compute.externalIpHour * HOURS_PER_MONTH) });
  warnings.push('Billing starts when the VM is created and continues while it runs; disks are billed even when stopped.');
  return finalize(items, warnings);
}

function parseSqlTier(tier) {
  const t = String(tier || '');
  if (PRICES.sql.sharedCore[t]) return { shared: true };
  const custom = t.match(/^db-custom-(\d+)-(\d+)$/);
  if (custom) return { vcpus: Number(custom[1]), memGb: Number(custom[2]) / 1024 };
  const std = t.match(/^db-n1-(standard|highmem)-(\d+)$/);
  if (std) return { vcpus: Number(std[2]), memGb: Number(std[2]) * (std[1] === 'highmem' ? 6.5 : 3.75) };
  return null;
}

function estimateSql({ tier, storageGb = 10, storageType = 'PD_SSD', availabilityType = 'ZONAL' }) {
  const items = [];
  const warnings = [];
  const ha = availabilityType === 'REGIONAL';
  let instanceHour = PRICES.sql.sharedCore[tier];
  if (instanceHour == null) {
    const parsed = parseSqlTier(tier);
    if (!parsed) return { known: false, monthlyUsd: null, items, warnings: [`No price data for tier ${tier}`] };
    instanceHour = parsed.vcpus * PRICES.sql.cpuHour + parsed.memGb * PRICES.sql.memGbHour;
  } else {
    warnings.push('Shared-core tiers have no SLA and are meant for development.');
  }
  const factor = ha ? 2 : 1;
  items.push({ label: `Instance ${tier}${ha ? ' (HA ×2)' : ''}`, monthlyUsd: round2(instanceHour * HOURS_PER_MONTH * factor) });
  const storageRate = PRICES.sql.storage[storageType] ?? PRICES.sql.storage.PD_SSD;
  items.push({ label: `${storageGb} GB ${storageType}${ha ? ' (HA ×2)' : ''}`, monthlyUsd: round2(storageGb * storageRate * factor) });
  warnings.push('Cloud SQL bills every hour it is running, even without connections. Storage is billed while stopped.');
  if (ha) warnings.push('High availability (REGIONAL) doubles instance and storage cost.');
  return finalize(items, warnings);
}

function parseCpu(cpu) {
  const value = String(cpu || '1');
  if (value.endsWith('m')) return Number(value.slice(0, -1)) / 1000;
  return Number(value) || 1;
}

function parseMemoryGib(memory) {
  const match = String(memory || '512Mi').match(/^(\d+(?:\.\d+)?)(Mi|Gi)$/);
  if (!match) return 0.5;
  return match[2] === 'Gi' ? Number(match[1]) : Number(match[1]) / 1024;
}

function estimateCloudRun({ cpu = '1', memory = '512Mi', minInstances = 0 }) {
  const items = [];
  const warnings = [];
  const perInstance = SECONDS_PER_MONTH *
    (parseCpu(cpu) * PRICES.cloudRun.idleCpuSecond + parseMemoryGib(memory) * PRICES.cloudRun.idleMemGibSecond);
  if (minInstances > 0) {
    items.push({ key: 'alwaysOn', params: { n: minInstances, cpu, memory }, label: `${minInstances} always-on instance(s) (${cpu} vCPU, ${memory})`, monthlyUsd: round2(perInstance * minInstances) });
    warnings.push('Min instances are billed 24/7 even with no traffic.');
  } else {
    items.push({ key: 'scalesToZero', label: 'Scales to zero: billed only while handling requests', monthlyUsd: 0 });
  }
  warnings.push('Request-time CPU, memory, requests and egress are billed per use on top of this.');
  return finalize(items, warnings);
}

function finalize(items, warnings) {
  const monthlyUsd = round2(items.reduce((sum, item) => sum + item.monthlyUsd, 0));
  return {
    known: true,
    monthlyUsd,
    highCost: monthlyUsd >= HIGH_COST_THRESHOLD_USD,
    items,
    warnings,
    disclaimer: 'Approximate on-demand list price in us-central1; excludes discounts, free tier, egress and taxes.',
  };
}

function estimate(kind, spec = {}) {
  if (kind === 'vm') return estimateVm(spec);
  if (kind === 'sql') return estimateSql(spec);
  if (kind === 'cloudrun') return estimateCloudRun(spec);
  throw Object.assign(new Error(`Unknown resource kind: ${kind}`), { code: 400 });
}

function estimateOverviewCosts({ cloudrun = [], vms = [], sql = [] } = {}) {
  const definitions = [
    {
      id: 'cloudrun', label: 'Cloud Run', tab: 'cloudrun', kind: 'cloudrun', rows: cloudrun,
      spec: row => ({ cpu: row.cpu || '1', memory: row.memory || '512Mi', minInstances: row.minInstances || 0 }),
    },
    {
      id: 'vms', label: 'Compute VMs', tab: 'vms', kind: 'vm', rows: vms,
      spec: row => ({
        machineType: row.machineType,
        diskSizeGb: row.diskSizeGb || 10,
        diskType: row.diskType || 'pd-balanced',
        externalIp: !!row.externalIp,
        spot: row.provisioningModel === 'SPOT' || row.provisioningModel === 'PREEMPTIBLE',
      }),
    },
    {
      id: 'sql', label: 'Cloud SQL', tab: 'sql', kind: 'sql', rows: sql,
      spec: row => ({
        tier: row.tier,
        storageGb: row.storageGb || 10,
        storageType: row.storageType || 'PD_SSD',
        availabilityType: row.availabilityType || 'ZONAL',
      }),
    },
  ];
  let monthlyBaseline = 0;
  let modeledResources = 0;
  let unknownResources = 0;
  const warnings = new Set();
  const unpricedResources = [];
  const byService = [];

  for (const definition of definitions) {
    const rows = Array.isArray(definition.rows) ? definition.rows : [];
    if (!rows.length) continue;
    let monthlyUsd = 0;
    let modeled = 0;
    let unknown = 0;
    for (const row of rows) {
      const result = estimate(definition.kind, definition.spec(row));
      if (!result.known) {
        unknown += 1;
        unpricedResources.push({
          service: definition.label,
          name: row.name || row.machineType || row.tier || 'Unnamed resource',
        });
        continue;
      }
      modeled += 1;
      monthlyUsd += result.monthlyUsd;
      result.warnings.forEach(warning => warnings.add(warning));
    }
    monthlyBaseline += monthlyUsd;
    modeledResources += modeled;
    unknownResources += unknown;
    byService.push({
      id: definition.id,
      label: definition.label,
      tab: definition.tab,
      count: rows.length,
      modeled,
      unknown,
      monthlyUsd: round2(monthlyUsd),
    });
  }

  const monthlyEstimate = modeledResources ? round2(monthlyBaseline) : null;
  return {
    status: modeledResources ? (unknownResources ? 'partial' : 'estimated') : 'no-data',
    source: 'resource-baseline-estimate',
    estimated: true,
    currency: 'USD',
    monthlyEstimate,
    monthlyBaseline: monthlyEstimate,
    modeledResources,
    unknownResources,
    unpricedResources,
    byService,
    pricingRegion: 'us-central1',
    warnings: [...warnings].slice(0, 6),
    disclaimer: 'Approximate 24/7 on-demand baseline in us-central1; excludes usage, egress, discounts, free tier, taxes and unmodeled services.',
  };
}

// ── Labels ───────────────────────────────────────────────────────────────────
// GCP label rules: ≤64 labels; keys start with a lowercase letter, ≤63 chars of
// lowercase letters, digits, "_" or "-"; values ≤63 chars of the same set.
// System labels (goog-* or domain-prefixed like run.googleapis.com/…) are kept
// as they are and cannot be added, changed or removed from KUA.

const LABEL_KEY = /^[a-z][a-z0-9_-]{0,62}$/;
const LABEL_VALUE = /^[a-z0-9_-]{0,63}$/;
const MAX_LABELS = 64;

function isSystemLabel(key) {
  return /^goog-/.test(key) || /[./]/.test(key);
}

/**
 * Validate the user's desired labels against the current ones.
 * @returns {{ labels, userLabels, diff: { added, changed, removed } }}
 *   labels: the full map to send (system labels preserved)
 */
function validateLabels(desired, current = {}) {
  if (!desired || typeof desired !== 'object' || Array.isArray(desired)) {
    throw badRequest('Labels must be an object of key/value pairs.');
  }
  const errors = [];
  const userLabels = {};
  for (const [rawKey, rawValue] of Object.entries(desired)) {
    const key = String(rawKey).trim();
    const value = rawValue == null ? '' : String(rawValue).trim();
    if (isSystemLabel(key)) { errors.push(`"${key}" is a system label and cannot be set.`); continue; }
    if (!LABEL_KEY.test(key)) errors.push(`Invalid key "${key}": lowercase letters, digits, "_" or "-", starting with a letter, max 63.`);
    if (!LABEL_VALUE.test(value)) errors.push(`Invalid value for "${key}": lowercase letters, digits, "_" or "-", max 63.`);
    userLabels[key] = value;
  }
  const system = Object.fromEntries(Object.entries(current || {}).filter(([k]) => isSystemLabel(k)));
  const labels = { ...system, ...userLabels };
  if (Object.keys(labels).length > MAX_LABELS) errors.push(`At most ${MAX_LABELS} labels are allowed.`);
  if (errors.length) throw badRequest(errors.join(' '));

  const currentUser = Object.fromEntries(Object.entries(current || {}).filter(([k]) => !isSystemLabel(k)));
  const diff = { added: {}, changed: {}, removed: [] };
  for (const [k, v] of Object.entries(userLabels)) {
    if (!(k in currentUser)) diff.added[k] = v;
    else if (currentUser[k] !== v) diff.changed[k] = { from: currentUser[k], to: v };
  }
  for (const k of Object.keys(currentUser)) if (!(k in userLabels)) diff.removed.push(k);
  return { labels, userLabels, diff };
}

function hasLabelChanges(diff) {
  return Object.keys(diff.added).length > 0 || Object.keys(diff.changed).length > 0 || diff.removed.length > 0;
}

// ── Compute Engine operations ────────────────────────────────────────────────
// @google-cloud/compute v4 returns operations whose `.promise()` is "not
// supported yet", so zone operations are awaited with ZoneOperationsClient.wait
// (each call blocks server side up to ~2 min or until DONE).

const COMPUTE_OP_DONE = new Set(['DONE', 2104194]);   // string or numeric enum

async function waitForZoneOperation(zoneOps, { project, zone, operation, timeoutMs = 5 * 60 * 1000, now = () => Date.now() }) {
  let op = operation?.latestResponse || operation;
  const name = op?.name;
  if (!name) throw new Error('Compute operation has no name to wait on');
  const deadline = now() + timeoutMs;
  while (!COMPUTE_OP_DONE.has(op?.status)) {
    if (now() > deadline) throw Object.assign(new Error(`Timed out waiting for Compute operation ${name}`), { code: 504 });
    [op] = await zoneOps.wait({ project, zone, operation: name });
  }
  const errors = op.error?.errors || [];
  if (errors.length) {
    throw Object.assign(new Error(errors.map(e => e.message || e.code).join('; ')), { code: 400 });
  }
  return op;
}

// ── Presets for the create forms ─────────────────────────────────────────────
// Curated choices so users pick from known-good options instead of typing
// machine types; prices come from the same table as the estimates. Labels are
// the English fallback: the frontend translates them by region / value.

const LOCATIONS = [
  { region: 'us-central1', label: 'Iowa (us-central1)', zones: ['a', 'b', 'c', 'f'] },
  { region: 'us-east1', label: 'South Carolina (us-east1)', zones: ['b', 'c', 'd'] },
  { region: 'us-east4', label: 'Virginia (us-east4)', zones: ['a', 'b', 'c'] },
  { region: 'us-west1', label: 'Oregon (us-west1)', zones: ['a', 'b', 'c'] },
  { region: 'southamerica-west1', label: 'Santiago (southamerica-west1)', zones: ['a', 'b', 'c'] },
  { region: 'southamerica-east1', label: 'São Paulo (southamerica-east1)', zones: ['a', 'b', 'c'] },
  { region: 'europe-west1', label: 'Belgium (europe-west1)', zones: ['b', 'c', 'd'] },
  { region: 'europe-southwest1', label: 'Madrid (europe-southwest1)', zones: ['a', 'b', 'c'] },
  { region: 'asia-east1', label: 'Taiwan (asia-east1)', zones: ['a', 'b', 'c'] },
];

const VM_PRESETS = [
  { value: 'e2-micro', label: 'Micro', specs: '2 shared vCPU · 1 GB', use: 'Tests and very light tasks' },
  { value: 'e2-small', label: 'Small', specs: '2 shared vCPU · 2 GB', use: 'Small sites, bots, dev' },
  { value: 'e2-medium', label: 'Medium', specs: '2 shared vCPU · 4 GB', use: 'Small apps, staging environments' },
  { value: 'e2-standard-2', label: 'Standard', specs: '2 vCPU · 8 GB', use: 'Light production apps' },
  { value: 'e2-standard-4', label: 'Standard+', specs: '4 vCPU · 16 GB', use: 'APIs and workers with more load' },
  { value: 'n2-standard-4', label: 'Performance', specs: '4 vCPU · 16 GB (N2)', use: 'Sustained CPU, self-managed databases' },
];

const SQL_PRESETS = [
  { value: 'db-f1-micro', label: 'Micro', specs: 'Shared vCPU · 0.6 GB', use: 'Development only (no SLA)' },
  { value: 'db-g1-small', label: 'Small', specs: 'Shared vCPU · 1.7 GB', use: 'Development and testing (no SLA)' },
  { value: 'db-custom-1-3840', label: 'Basic', specs: '1 vCPU · 3.75 GB', use: 'Low-traffic production' },
  { value: 'db-custom-2-7680', label: 'Standard', specs: '2 vCPU · 7.5 GB', use: 'General production' },
  { value: 'db-custom-4-15360', label: 'Large', specs: '4 vCPU · 15 GB', use: 'High loads' },
];

const VM_IMAGES = [
  { key: 'debian-12', label: 'Debian 12', project: 'debian-cloud', family: 'debian-12' },
  { key: 'ubuntu-2404', label: 'Ubuntu 24.04 LTS', project: 'ubuntu-os-cloud', family: 'ubuntu-2404-lts-amd64' },
  { key: 'ubuntu-2204', label: 'Ubuntu 22.04 LTS', project: 'ubuntu-os-cloud', family: 'ubuntu-2204-lts' },
  { key: 'rocky-9', label: 'Rocky Linux 9', project: 'rocky-linux-cloud', family: 'rocky-linux-9' },
];

/** Presets with the monthly price of the machine/instance alone (no disk, IP or storage). */
function createPresets() {
  const withPrice = (presets, price) => presets.map(p => ({ ...p, monthlyUsd: price(p.value) }));
  return {
    locations: LOCATIONS.map(l => ({ ...l, zones: l.zones.map(z => `${l.region}-${z}`) })),
    vm: withPrice(VM_PRESETS, value =>
      estimateVm({ machineType: value, diskSizeGb: 0, externalIp: false }).items[0]?.monthlyUsd ?? null),
    sql: withPrice(SQL_PRESETS, value =>
      estimateSql({ tier: value, storageGb: 0 }).items[0]?.monthlyUsd ?? null),
    vmImages: VM_IMAGES,
    sqlVersions: ['POSTGRES_16', 'POSTGRES_15', 'MYSQL_8_0', 'MYSQL_8_4'],
    cloudRun: { cpu: ['1', '2', '4'], memory: ['512Mi', '1Gi', '2Gi', '4Gi'] },
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

const NAME_RULES = {
  // Cloud Run: lowercase letters, digits, hyphens; start with a letter; max 49
  cloudrun: /^[a-z](?:[a-z0-9-]{0,47}[a-z0-9])?$/,
  // Compute: RFC 1035, max 63
  vm: /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  // Cloud SQL: lowercase letters, digits, hyphens; start with a letter; max 98
  sql: /^[a-z](?:[a-z0-9-]{0,96}[a-z0-9])?$/,
};
const LOCATION_RULE = /^[a-z]+-[a-z]+\d+(?:-[a-z])?$/;

function badRequest(message) {
  return Object.assign(new Error(message), { code: 400 });
}

/** Deleting always needs the resource name typed back. */
function assertDeleteConfirmed(name, body = {}) {
  if (!body.confirmName || body.confirmName !== name) {
    throw badRequest(`Type the resource name "${name}" to confirm the deletion.`);
  }
}

/**
 * Validate a create request and return the normalized spec plus its estimate.
 * Requires the typed name, the cost acknowledgement and, above the threshold,
 * a second high-cost acknowledgement.
 */
function validateCreate(kind, body = {}) {
  const rule = NAME_RULES[kind];
  if (!rule) throw badRequest(`Unknown resource kind: ${kind}`);
  const name = String(body.name || '').trim();
  if (!rule.test(name)) throw badRequest(`Invalid ${kind} name "${name}".`);

  let spec;
  if (kind === 'cloudrun') {
    if (!LOCATION_RULE.test(body.region || '')) throw badRequest('A valid region is required.');
    if (!body.image || !/^[\w.-]+(?::\d+)?(?:\/[\w.-]+)+(?::[\w.-]+|@sha256:[a-f0-9]{64})?$/.test(body.image)) {
      throw badRequest('A valid container image is required (e.g. us-docker.pkg.dev/cloudrun/container/hello).');
    }
    const minInstances = Number(body.minInstances ?? 0);
    const maxInstances = Number(body.maxInstances ?? 3);
    if (!Number.isInteger(minInstances) || minInstances < 0 || minInstances > 10) throw badRequest('Min instances must be 0-10.');
    if (!Number.isInteger(maxInstances) || maxInstances < Math.max(1, minInstances) || maxInstances > 100) throw badRequest('Max instances must be ≥ min and ≤ 100.');
    if (!/^(?:\d+|\d+m)$/.test(String(body.cpu || '1'))) throw badRequest('Invalid CPU value.');
    if (!/^\d+(?:Mi|Gi)$/.test(String(body.memory || '512Mi'))) throw badRequest('Invalid memory value.');
    spec = {
      name, region: body.region, image: body.image,
      cpu: String(body.cpu || '1'), memory: String(body.memory || '512Mi'),
      minInstances, maxInstances,
      allowUnauthenticated: body.allowUnauthenticated === true,
    };
  } else if (kind === 'vm') {
    if (!/^[a-z]+-[a-z]+\d+-[a-z]$/.test(body.zone || '')) throw badRequest('A valid zone is required (e.g. us-central1-a).');
    if (!/^[a-z0-9-]+$/.test(body.machineType || '')) throw badRequest('A valid machine type is required.');
    const diskSizeGb = Number(body.diskSizeGb ?? 10);
    if (!Number.isInteger(diskSizeGb) || diskSizeGb < 10 || diskSizeGb > 2000) throw badRequest('Disk size must be 10-2000 GB.');
    if (!PRICES.compute.disk[body.diskType || 'pd-balanced']) throw badRequest('Invalid disk type.');
    if (!/^[a-z0-9-]+$/.test(body.imageProject || 'debian-cloud') || !/^[a-z0-9-]+$/.test(body.imageFamily || 'debian-12')) {
      throw badRequest('Invalid image.');
    }
    spec = {
      name, zone: body.zone, machineType: body.machineType,
      diskSizeGb, diskType: body.diskType || 'pd-balanced',
      imageProject: body.imageProject || 'debian-cloud', imageFamily: body.imageFamily || 'debian-12',
      externalIp: body.externalIp !== false, spot: body.spot === true,
      deletionProtection: body.deletionProtection === true,
    };
  } else {
    if (!LOCATION_RULE.test(body.region || '')) throw badRequest('A valid region is required.');
    if (!/^(POSTGRES|MYSQL|SQLSERVER)_[A-Z0-9_]+$/.test(body.databaseVersion || '')) throw badRequest('A valid database version is required.');
    if (!/^db-[a-z0-9-]+$/.test(body.tier || '')) throw badRequest('A valid tier is required.');
    const storageGb = Number(body.storageGb ?? 10);
    if (!Number.isInteger(storageGb) || storageGb < 10 || storageGb > 65536) throw badRequest('Storage must be at least 10 GB.');
    if (!PRICES.sql.storage[body.storageType || 'PD_SSD']) throw badRequest('Invalid storage type.');
    if (!['ZONAL', 'REGIONAL'].includes(body.availabilityType || 'ZONAL')) throw badRequest('Invalid availability type.');
    if (!body.rootPassword || String(body.rootPassword).length < 12) throw badRequest('A root password of at least 12 characters is required.');
    spec = {
      name, region: body.region, databaseVersion: body.databaseVersion, tier: body.tier,
      storageGb, storageType: body.storageType || 'PD_SSD',
      availabilityType: body.availabilityType || 'ZONAL',
      backupEnabled: body.backupEnabled !== false,
      deletionProtection: body.deletionProtection !== false,
      rootPassword: String(body.rootPassword),
    };
  }

  const costEstimate = estimate(kind, spec);
  if (body.confirmName !== name) throw badRequest(`Type the resource name "${name}" to confirm the creation.`);
  if (body.acknowledgeCost !== true) throw badRequest('You must acknowledge that this resource generates costs.');
  if (costEstimate.highCost && body.acknowledgeHighCost !== true) {
    throw badRequest(`Estimated cost is about $${costEstimate.monthlyUsd}/month; confirm the high-cost acknowledgement.`);
  }
  return { spec, estimate: costEstimate };
}

module.exports = {
  HIGH_COST_THRESHOLD_USD,
  mapCloudRunService,
  mapVm,
  mapSqlInstance,
  sqlStatus,
  parseMachineType,
  parseSqlTier,
  estimate,
  estimateOverviewCosts,
  createPresets,
  waitForZoneOperation,
  validateLabels,
  hasLabelChanges,
  isSystemLabel,
  assertDeleteConfirmed,
  validateCreate,
};

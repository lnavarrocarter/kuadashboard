'use strict';

// Detail mappers for the GCP Info panels (Compute VM, Cloud Run, Cloud SQL).
// Pure functions over the raw API objects so they can be unit-tested.
// Never expose secret material: metadata values, env values backed by Secret
// Manager and SQL passwords are summarized, not returned.

function lastSegment(value) {
  return value ? String(value).split('/').pop() : null;
}

function toIso(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp === 'string') return timestamp;
  if (timestamp.seconds != null) return new Date(Number(timestamp.seconds) * 1000).toISOString();
  return null;
}

function durationSeconds(duration) {
  if (!duration) return null;
  if (typeof duration === 'string') return Number.parseFloat(duration) || null;   // "300s"
  if (duration.seconds != null) return Number(duration.seconds) + (duration.nanos ? duration.nanos / 1e9 : 0);
  return null;
}

// ── Compute Engine VM ────────────────────────────────────────────────────────

// Metadata keys whose values can contain credentials or scripts
const SENSITIVE_METADATA = /ssh-keys|sshKeys|startup-script|shutdown-script|user-data|windows-keys|password|token|secret|key$/i;

// Short name and access code ('full' | 'read' | 'write' | null) per OAuth scope;
// the frontend translates the access code.
const SCOPE_NAMES = {
  'https://www.googleapis.com/auth/cloud-platform': { name: 'cloud-platform', access: 'full' },
  'https://www.googleapis.com/auth/devstorage.read_only': { name: 'storage', access: 'read' },
  'https://www.googleapis.com/auth/logging.write': { name: 'logging', access: 'write' },
  'https://www.googleapis.com/auth/monitoring.write': { name: 'monitoring', access: 'write' },
  'https://www.googleapis.com/auth/servicecontrol': { name: 'service control', access: null },
  'https://www.googleapis.com/auth/service.management.readonly': { name: 'service management', access: 'read' },
  'https://www.googleapis.com/auth/trace.append': { name: 'trace', access: 'write' },
  'https://www.googleapis.com/auth/compute': { name: 'compute', access: null },
  'https://www.googleapis.com/auth/compute.readonly': { name: 'compute', access: 'read' },
};

function scopeName(scope) {
  return SCOPE_NAMES[scope] || { name: lastSegment(scope), access: null };
}

function osFromLicenses(licenses = []) {
  const name = lastSegment(licenses.find(l => /\/licenses\//.test(l)) || licenses[0]);
  return name ? name.replace(/-/g, ' ') : null;
}

/**
 * @param vm   raw Compute instance
 * @param disks raw Compute disk resources (disks.get) by name, optional
 */
function mapVmDetail(vm, disks = {}) {
  const metadataItems = vm.metadata?.items || [];
  const meta = Object.fromEntries(metadataItems.map(i => [i.key, i.value]));
  const scheduling = vm.scheduling || {};
  const shielded = vm.shieldedInstanceConfig || {};
  const bootDisk = (vm.disks || []).find(d => d.boot);

  return {
    name: vm.name,
    instanceId: vm.id?.toString() || null,
    zone: lastSegment(vm.zone),
    status: vm.status,
    statusMessage: vm.statusMessage || null,
    description: vm.description || null,
    hostname: vm.hostname || null,
    created: vm.creationTimestamp || null,
    lastStart: vm.lastStartTimestamp || null,
    lastStop: vm.lastStopTimestamp || null,
    lastSuspended: vm.lastSuspendedTimestamp || null,
    labels: vm.labels || {},
    tags: vm.tags?.items || [],
    machine: {
      type: lastSegment(vm.machineType),
      cpuPlatform: vm.cpuPlatform || null,
      minCpuPlatform: vm.minCpuPlatform || null,
      gpus: (vm.guestAccelerators || []).map(g => ({ type: lastSegment(g.acceleratorType), count: g.acceleratorCount })),
      os: osFromLicenses(bootDisk?.licenses),
    },
    scheduling: {
      provisioningModel: scheduling.provisioningModel || (scheduling.preemptible ? 'PREEMPTIBLE' : 'STANDARD'),
      automaticRestart: scheduling.automaticRestart ?? null,
      onHostMaintenance: scheduling.onHostMaintenance || null,
      terminationAction: scheduling.instanceTerminationAction || null,
      maxRunDurationSeconds: durationSeconds(scheduling.maxRunDuration),
    },
    security: {
      deletionProtection: !!vm.deletionProtection,
      secureBoot: !!shielded.enableSecureBoot,
      vtpm: !!shielded.enableVtpm,
      integrityMonitoring: !!shielded.enableIntegrityMonitoring,
      confidentialCompute: !!vm.confidentialInstanceConfig?.enableConfidentialCompute,
      canIpForward: !!vm.canIpForward,
      osLogin: meta['enable-oslogin'] ?? null,
      blockProjectSshKeys: String(meta['block-project-ssh-keys'] || '').toUpperCase() === 'TRUE',
      serialPortEnabled: String(meta['serial-port-enable'] || '').toUpperCase() === 'TRUE',
      serviceAccounts: (vm.serviceAccounts || []).map(sa => ({ email: sa.email, scopes: (sa.scopes || []).map(scopeName) })),
    },
    networks: (vm.networkInterfaces || []).map(n => ({
      name: n.name,
      network: lastSegment(n.network),
      subnetwork: lastSegment(n.subnetwork),
      internalIp: n.networkIP || null,
      externalIp: n.accessConfigs?.find(a => a.natIP)?.natIP || null,
      networkTier: n.accessConfigs?.[0]?.networkTier || null,
      stackType: n.stackType || null,
      ipv6: n.ipv6AccessConfigs?.[0]?.externalIpv6 || n.ipv6Address || null,
      aliasRanges: (n.aliasIpRanges || []).map(r => r.ipCidrRange),
    })),
    disks: (vm.disks || []).map(d => {
      const name = lastSegment(d.source);
      const res = disks[name] || {};
      return {
        name,
        deviceName: d.deviceName,
        boot: !!d.boot,
        kind: d.type || 'PERSISTENT',
        type: lastSegment(res.type) || null,
        mode: d.mode,
        interface: d.interface || null,
        sizeGb: Number(d.diskSizeGb || res.sizeGb || 0) || null,
        autoDelete: !!d.autoDelete,
        sourceImage: lastSegment(res.sourceImage) || null,
        encryption: d.diskEncryptionKey?.kmsKeyName || res.diskEncryptionKey?.kmsKeyName ? 'CMEK' : 'Google-managed',
        os: osFromLicenses(d.licenses),
      };
    }),
    // Keys only: values may hold keys or scripts
    metadata: metadataItems.map(i => ({
      key: i.key,
      sensitive: SENSITIVE_METADATA.test(i.key),
      value: SENSITIVE_METADATA.test(i.key) ? null : String(i.value ?? '').slice(0, 200),
      size: String(i.value ?? '').length,
    })),
  };
}

// ── Cloud Run ────────────────────────────────────────────────────────────────

function probe(p) {
  if (!p) return null;
  const kind = p.httpGet ? `HTTP ${p.httpGet.path || '/'}${p.httpGet.port ? `:${p.httpGet.port}` : ''}`
    : p.tcpSocket ? `TCP ${p.tcpSocket.port || ''}`.trim()
      : p.grpc ? 'gRPC' : 'custom';
  return { kind, periodSeconds: p.periodSeconds ?? null, failureThreshold: p.failureThreshold ?? null, initialDelaySeconds: p.initialDelaySeconds ?? null };
}

/**
 * @param svc        raw Cloud Run v2 Service
 * @param revisions  raw Revision list
 * @param opts.publicAccess  true/false when the IAM policy was read, null otherwise
 */
function mapCloudRunDetail(svc, revisions = [], { region, publicAccess = null } = {}) {
  const template = svc.template || {};
  const container = template.containers?.[0] || {};
  const traffic = (svc.trafficStatuses?.length ? svc.trafficStatuses : svc.traffic) || [];
  const trafficByRevision = {};
  for (const t of traffic) {
    const rev = t.revision || (String(t.type).includes('LATEST') ? lastSegment(svc.latestReadyRevision) : null);
    if (rev) trafficByRevision[rev] = (trafficByRevision[rev] || 0) + (t.percent || 0);
  }
  const vpc = template.vpcAccess || {};
  return {
    name: lastSegment(svc.name),
    region,
    uri: svc.uri || null,
    urls: svc.urls || [],
    status: svc.reconciling ? 'reconciling' : svc.terminalCondition?.state === 'CONDITION_FAILED' ? 'failed' : 'ready',
    statusMessage: svc.terminalCondition?.message || null,
    description: svc.description || null,
    labels: svc.labels || {},
    created: toIso(svc.createTime),
    updated: toIso(svc.updateTime),
    creator: svc.creator || null,
    lastModifier: svc.lastModifier || null,
    generation: svc.generation != null ? String(svc.generation) : null,
    ingress: svc.ingress ? String(svc.ingress).replace(/^INGRESS_TRAFFIC_/, '').toLowerCase() : null,
    publicAccess,
    container: {
      image: container.image || null,
      command: container.command || [],
      args: container.args || [],
      port: container.ports?.[0]?.containerPort || null,
      cpu: container.resources?.limits?.cpu || null,
      memory: container.resources?.limits?.memory || null,
      cpuAlwaysAllocated: container.resources?.cpuIdle === false,
      startupCpuBoost: !!container.resources?.startupCpuBoost,
      startupProbe: probe(container.startupProbe),
      livenessProbe: probe(container.livenessProbe),
    },
    scaling: {
      minInstances: template.scaling?.minInstanceCount ?? 0,
      maxInstances: template.scaling?.maxInstanceCount ?? null,
      concurrency: template.maxInstanceRequestConcurrency ?? null,
      timeoutSeconds: durationSeconds(template.timeout),
      executionEnvironment: template.executionEnvironment && !/UNSPECIFIED/.test(template.executionEnvironment)
        ? String(template.executionEnvironment).replace(/^EXECUTION_ENVIRONMENT_/, '').toLowerCase() : null,
      sessionAffinity: !!template.sessionAffinity,
    },
    networking: {
      vpcConnector: lastSegment(vpc.connector) || null,
      vpcEgress: vpc.egress ? String(vpc.egress).replace(/^VPC_EGRESS_/, '').toLowerCase() : null,
      directVpc: (vpc.networkInterfaces || []).map(n => ({ network: lastSegment(n.network), subnetwork: lastSegment(n.subnetwork) })),
    },
    serviceAccount: template.serviceAccount || null,
    cloudSqlInstances: (template.volumes || []).flatMap(v => v.cloudSqlInstance?.instances || []),
    envVars: (container.env || []).map(e => (e.valueSource?.secretKeyRef
      ? { name: e.name, secret: `${lastSegment(e.valueSource.secretKeyRef.secret)}:${e.valueSource.secretKeyRef.version || 'latest'}` }
      : { name: e.name, value: e.value ?? '' })),
    secretVolumes: (template.volumes || []).filter(v => v.secret).map(v => ({ name: v.name, secret: lastSegment(v.secret.secret) })),
    revisions: revisions.slice(0, 20).map(r => {
      const name = lastSegment(r.name);
      return {
        name,
        created: toIso(r.createTime),
        traffic: trafficByRevision[name] ?? null,
        ready: r.reconciling === false || r.conditions?.some?.(c => c.type === 'Ready' && c.state === 'CONDITION_SUCCEEDED') || false,
        image: r.containers?.[0]?.image || null,
      };
    }),
    traffic: traffic.map(t => ({
      revision: t.revision || null,
      latest: String(t.type || '').includes('LATEST'),
      percent: t.percent || 0,
      tag: t.tag || null,
      uri: t.uri || null,
    })),
    conditions: (svc.conditions || []).map(c => ({ type: c.type, state: c.state, message: c.message || null })),
  };
}

// ── Cloud SQL ────────────────────────────────────────────────────────────────

function mapSqlDetail(i) {
  const s = i.settings || {};
  const backup = s.backupConfiguration || {};
  const ip = s.ipConfiguration || {};
  const mw = s.maintenanceWindow || null;
  const running = i.state === 'RUNNABLE' && s.activationPolicy !== 'NEVER';
  return {
    name: i.name,
    database: i.databaseVersion,
    region: i.region,
    zone: i.gceZone || null,
    secondaryZone: i.secondaryGceZone || null,
    state: i.state,
    status: i.state === 'RUNNABLE' ? (running ? 'RUNNING' : 'STOPPED') : i.state,
    edition: s.edition || null,
    tier: s.tier || null,
    activationPolicy: s.activationPolicy || null,
    availabilityType: s.availabilityType || null,
    labels: s.userLabels || {},
    created: i.createTime || null,
    connectionName: i.connectionName || null,
    dnsName: i.dnsName || null,
    storage: {
      type: s.dataDiskType || null,
      sizeGb: s.dataDiskSizeGb ? Number(s.dataDiskSizeGb) : null,
      autoResize: !!s.storageAutoResize,
      autoResizeLimitGb: s.storageAutoResizeLimit ? Number(s.storageAutoResizeLimit) || null : null,
      dataCache: !!s.dataCacheConfig?.dataCacheEnabled,
      encryption: i.diskEncryptionConfiguration?.kmsKeyName ? 'CMEK' : 'Google-managed',
    },
    backups: {
      enabled: !!backup.enabled,
      startTime: backup.startTime || null,
      location: backup.location || null,
      pointInTimeRecovery: !!(backup.pointInTimeRecoveryEnabled || backup.binaryLogEnabled),
      retainedBackups: backup.backupRetentionSettings?.retainedBackups ?? null,
      logRetentionDays: backup.transactionLogRetentionDays ?? null,
    },
    maintenance: mw ? {
      day: mw.day || null,   // 1 = Monday … 7 = Sunday; null = any day (the frontend names it)
      hour: mw.hour ?? null,
      track: mw.updateTrack || null,
    } : null,
    network: {
      publicIp: (i.ipAddresses || []).find(a => a.type === 'PRIMARY')?.ipAddress || null,
      privateIp: (i.ipAddresses || []).find(a => a.type === 'PRIVATE')?.ipAddress || null,
      outgoingIp: (i.ipAddresses || []).find(a => a.type === 'OUTGOING')?.ipAddress || null,
      ipv4Enabled: !!ip.ipv4Enabled,
      privateNetwork: lastSegment(ip.privateNetwork) || null,
      sslMode: ip.sslMode || (ip.requireSsl ? 'REQUIRE_SSL' : null),
      authorizedNetworks: (ip.authorizedNetworks || []).map(n => ({ name: n.name || null, cidr: n.value })),
      pscEnabled: !!ip.pscConfig?.pscEnabled,
    },
    security: {
      deletionProtection: !!s.deletionProtectionEnabled,
      serverCaExpires: i.serverCaCert?.expirationTime || null,
      queryInsights: !!s.insightsConfig?.queryInsightsEnabled,
    },
    replication: {
      primary: i.masterInstanceName ? lastSegment(i.masterInstanceName) : null,
      replicas: i.replicaNames || [],
    },
    flags: (s.databaseFlags || []).map(f => ({ name: f.name, value: f.value })),
  };
}

module.exports = { mapVmDetail, mapCloudRunDetail, mapSqlDetail, SENSITIVE_METADATA };

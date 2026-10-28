'use strict';
/**
 * lib/proxmox/inventory.js
 * The inventory of a Proxmox VE cluster or a single node, read-only (#195): cluster and quorum,
 * nodes, QEMU VMs and LXC containers, storage, vzdump backup jobs and recent tasks.
 *
 * Every section is read on its own: a path the token cannot read (403) or a node that is down
 * leaves that section `available: false` with its reason, and the others are still shown. Reads go
 * to the Proxmox API on the local network: no cloud cost.
 */

const STORAGE_FULL_PERCENT = 85;
const TASK_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TASKS = 50;

const number = value => (Number.isFinite(Number(value)) ? Number(value) : null);
const percent = (used, total) => (number(total) > 0 && number(used) !== null ? Math.round((Number(used) / Number(total)) * 1000) / 10 : null);
const tagsOf = value => String(value || '').split(/[;,\s]+/).map(tag => tag.trim()).filter(Boolean);

/** The vmids a backup job covers, or 'all' (minus its exclusions). */
function jobCoverage(job) {
  const ids = value => new Set(String(value || '').split(/[,\s]+/).map(Number).filter(Number.isInteger));
  return job.all ? { all: true, exclude: ids(job.exclude) } : { all: false, vmids: ids(job.vmid) };
}

function normalizeGuest(item) {
  return {
    id: item.id || `${item.type}/${item.vmid}`,
    vmid: number(item.vmid),
    type: item.type === 'lxc' ? 'lxc' : 'qemu',
    name: item.name || String(item.vmid),
    node: item.node || '',
    status: item.status || 'unknown',
    template: item.template === 1 || item.template === true,
    cpu: number(item.cpu),
    maxcpu: number(item.maxcpu),
    mem: number(item.mem),
    maxmem: number(item.maxmem),
    disk: number(item.disk),
    maxdisk: number(item.maxdisk),
    uptime: number(item.uptime),
    tags: tagsOf(item.tags),
    haState: item.hastate || null,
    pool: item.pool || null,
  };
}

function normalizeStorage(item) {
  return {
    id: item.id || `storage/${item.node}/${item.storage}`,
    storage: item.storage,
    node: item.node || '',
    type: item.plugintype || null,
    shared: item.shared === 1 || item.shared === true,
    content: String(item.content || '').split(',').filter(Boolean),
    status: item.status || 'unknown',
    used: number(item.disk),
    total: number(item.maxdisk),
    usedPercent: percent(item.disk, item.maxdisk),
  };
}

function normalizeTask(item) {
  const ok = item.status === 'OK';
  return {
    upid: item.upid,
    node: item.node || '',
    type: item.type || '',
    target: item.id || '',
    user: item.user || '',
    startedAt: item.starttime ? new Date(item.starttime * 1000).toISOString() : null,
    endedAt: item.endtime ? new Date(item.endtime * 1000).toISOString() : null,
    // A task still running has no status; one that ended carries "OK" or its error text.
    state: item.status ? (ok ? 'ok' : 'error') : 'running',
    message: ok ? '' : String(item.status || '').slice(0, 300),
  };
}

async function section(read) {
  try { return { available: true, items: await read() }; } catch (error) {
    return { available: false, reason: error.kind || 'unreachable', error: String(error.message || error).slice(0, 300), ...(error.fingerprint ? { fingerprint: error.fingerprint } : {}), items: [] };
  }
}

/**
 * @param client   createProxmoxClient(...) or anything with get(path)
 * @returns        { scope, cluster, summary, sections: { nodes, guests, storage, backups, tasks } }
 */
async function readProxmoxInventory(client, { now = () => Date.now() } = {}) {
  const [status, nodes, guests, storage, backups, tasks] = await Promise.all([
    section(() => client.get('/cluster/status')),
    section(async () => (await client.get('/nodes')) || []),
    section(async () => ((await client.get('/cluster/resources?type=vm')) || []).map(normalizeGuest)),
    section(async () => ((await client.get('/cluster/resources?type=storage')) || []).map(normalizeStorage)),
    section(async () => (await client.get('/cluster/backup')) || []),
    section(async () => ((await client.get('/cluster/tasks')) || []).map(normalizeTask)),
  ]);

  const clusterEntry = status.items.find(item => item.type === 'cluster') || null;
  const statusNodes = new Map(status.items.filter(item => item.type === 'node').map(item => [item.name, item]));
  // Versions per online node, each read on its own; one that fails only loses its version.
  const nodeItems = await Promise.all(nodes.items.map(async node => {
    const online = node.status === 'online';
    let version = null;
    if (online) { try { version = (await client.get(`/nodes/${encodeURIComponent(node.node)}/version`))?.version || null; } catch { version = null; } }
    return {
      name: node.node,
      status: node.status || 'unknown',
      ip: statusNodes.get(node.node)?.ip || null,
      cpu: number(node.cpu),
      maxcpu: number(node.maxcpu),
      mem: number(node.mem),
      maxmem: number(node.maxmem),
      memPercent: percent(node.mem, node.maxmem),
      uptime: number(node.uptime),
      version,
    };
  }));

  const jobs = backups.items.map(job => ({
    id: job.id,
    enabled: job.enabled === undefined ? true : job.enabled === 1 || job.enabled === true,
    schedule: job.schedule || job.starttime || '',
    storage: job.storage || '',
    mode: job.mode || '',
    node: job.node || null,
    comment: job.comment || '',
    coverage: jobCoverage(job),
  }));
  const covered = guest => jobs.some(job => job.enabled && (job.coverage.all ? !job.coverage.exclude.has(guest.vmid) : job.coverage.vmids.has(guest.vmid)));
  const guestItems = guests.items.map(guest => ({ ...guest, backupJob: backups.available ? covered(guest) : null }));
  const jobItems = jobs.map(({ coverage, ...job }) => ({ ...job, all: coverage.all, vmids: coverage.all ? [] : [...coverage.vmids], exclude: coverage.all ? [...coverage.exclude] : [] }));

  const since = now() - TASK_WINDOW_MS;
  const taskItems = tasks.items.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, MAX_TASKS);
  const recent = taskItems.filter(task => task.startedAt && Date.parse(task.startedAt) >= since);

  const singleNode = !clusterEntry;
  const name = clusterEntry?.name || nodeItems[0]?.name || statusNodes.keys().next().value || null;
  const realGuests = guestItems.filter(guest => !guest.template);
  const known = (sectionValue, value) => (sectionValue.available ? value : null);

  return {
    scope: name ? { provider: 'proxmox', scopeId: name, label: name } : null,
    cluster: {
      name,
      singleNode,
      quorate: clusterEntry ? clusterEntry.quorate === 1 || clusterEntry.quorate === true : (status.available ? true : null),
      available: status.available,
      ...(status.available ? {} : { reason: status.reason }),
    },
    summary: {
      nodes: known(nodes, nodeItems.length),
      nodesOnline: known(nodes, nodeItems.filter(node => node.status === 'online').length),
      vms: known(guests, realGuests.filter(guest => guest.type === 'qemu').length),
      containers: known(guests, realGuests.filter(guest => guest.type === 'lxc').length),
      running: known(guests, realGuests.filter(guest => guest.status === 'running').length),
      storageFull: known(storage, storage.items.filter(item => item.usedPercent !== null && item.usedPercent >= STORAGE_FULL_PERCENT).length),
      backupJobs: known(backups, jobItems.length),
      guestsWithoutBackup: guests.available && backups.available ? realGuests.filter(guest => !guest.backupJob).length : null,
      failedTasks24h: known(tasks, recent.filter(task => task.state === 'error').length),
    },
    sections: {
      nodes: { ...nodes, items: nodeItems },
      guests: { ...guests, items: guestItems },
      storage,
      backups: { ...backups, items: jobItems },
      tasks: { ...tasks, items: taskItems },
    },
  };
}

module.exports = { STORAGE_FULL_PERCENT, readProxmoxInventory };

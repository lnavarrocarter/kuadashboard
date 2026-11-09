'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEFRAME_MS = Object.freeze({ hour: 60 * 60 * 1000, day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS });
const PERIOD_S = 300;
const METRICS = ['cpuPercent', 'memoryPercent', 'diskPercent', 'netIn', 'netOut'];

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const percent = (value, total) => finite(total) > 0 && finite(value) !== null
  ? Math.round((Number(value) / Number(total)) * 1000) / 10 : null;

function rrdPath(entity, timeframe) {
  const node = encodeURIComponent(entity.node);
  if (entity.type === 'node') return `/nodes/${node}/rrddata?timeframe=${timeframe}&cf=AVERAGE`;
  const kind = entity.type === 'lxc' ? 'lxc' : 'qemu';
  return `/nodes/${node}/${kind}/${encodeURIComponent(entity.vmid)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`;
}

function normalizeRrdRow(row) {
  return {
    t: finite(row.time) === null ? null : Number(row.time) * 1000,
    cpuPercent: finite(row.cpu) === null ? null : Math.round(Number(row.cpu) * 1000) / 10,
    memoryPercent: percent(row.mem, row.maxmem),
    diskPercent: percent(row.disk, row.maxdisk),
    netIn: finite(row.netin),
    netOut: finite(row.netout),
  };
}

function writeHistory(history, profileId, resourceId, points) {
  if (!history || !profileId || !points.length) return;
  const from = points[0].t;
  const to = points.at(-1).t + PERIOD_S * 1000;
  for (const metric of METRICS) {
    history.write({ provider: 'proxmox', profileId, region: '', resourceId, metric, periodS: PERIOD_S }, {
      from,
      to,
      points: points.filter(point => point[metric] !== null).map(point => ({ t: point.t, v: point[metric] })),
    });
  }
}

function readHistory(history, profileId, resourceId, timeframe, now) {
  if (!history || !profileId || typeof history.read !== 'function') return [];
  const from = now - TIMEFRAME_MS[timeframe];
  const to = now + 1;
  const byTime = new Map();
  for (const metric of METRICS) {
    const rows = history.read({ provider: 'proxmox', profileId, region: '', resourceId, metric, periodS: PERIOD_S }, { from, to });
    for (const row of rows) {
      if (!byTime.has(row.t)) byTime.set(row.t, { t: row.t });
      byTime.get(row.t)[metric] = row.v;
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Read Proxmox RRD data; failures stay local to that entity. No mutation API is called. */
async function readProxmoxTelemetry(client, inventory, { history = null, profileId = '', now = () => Date.now(), timeframe = 'day' } = {}) {
  if (!Object.hasOwn(TIMEFRAME_MS, timeframe)) throw Object.assign(new Error('Invalid RRD timeframe'), { kind: 'invalid_profile' });
  const nodes = inventory?.sections?.nodes?.available ? inventory.sections.nodes.items : [];
  const guests = inventory?.sections?.guests?.available ? inventory.sections.guests.items : [];
  const entities = [
    ...nodes.map(node => ({ id: `node/${node.name}`, name: node.name, node: node.name, type: 'node' })),
    ...guests.filter(guest => !guest.template).map(guest => ({ id: `${guest.type}/${guest.vmid}`, name: guest.name, node: guest.node, vmid: guest.vmid, type: guest.type, status: guest.status })),
  ];

  const results = await Promise.all(entities.map(async entity => {
    if (entity.type !== 'node' && entity.status && entity.status !== 'running') {
      return { ...entity, available: false, reason: 'no_data', points: [] };
    }
    try {
      const response = await client.get(rrdPath(entity, timeframe));
      const points = (Array.isArray(response) ? response : []).map(normalizeRrdRow).filter(point => point.t !== null).sort((a, b) => a.t - b.t);
      if (points.length) writeHistory(history, profileId, entity.id, points);
      const stored = readHistory(history, profileId, entity.id, timeframe, now());
      const displayed = stored.length ? stored : points;
      if (!displayed.length) return { ...entity, available: false, reason: 'no_data', points: [] };
      return { ...entity, available: true, stale: false, points: displayed };
    } catch (error) {
      const stored = readHistory(history, profileId, entity.id, timeframe, now());
      if (stored.length) return { ...entity, available: true, stale: true, reason: error.kind || 'unreachable', points: stored };
      return { ...entity, available: false, reason: error.kind || 'unreachable', error: String(error.message || error).slice(0, 300), points: [] };
    }
  }));

  return {
    readAt: new Date(now()).toISOString(),
    timeframe,
    retentionDays: history?.retentionDays || 30,
    entities: results,
  };
}

module.exports = { DAY_MS, METRICS, PERIOD_S, TIMEFRAME_MS, normalizeRrdRow, readHistory, readProxmoxTelemetry, rrdPath };

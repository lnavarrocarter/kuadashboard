'use strict';
/**
 * electron/trayStatus.js
 * What the tray panel shows (electron/trayPanel.html): whether the KUA backend
 * answers, the background tasks running now and the next ones scheduled, AI
 * agent access (MCP) and the state of the app update. Pure functions: main.js
 * reads the backend and passes the answers in.
 */

const ACTIVE_STATES = new Set(['running', 'pause_requested', 'cancellation_requested']);
const TASK_ACTIONS = new Set(['pause', 'resume', 'cancel']);
const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const UPCOMING_LIMIT = 6;

function taskView(task) {
  return {
    id: task.id,
    name: task.name || task.id,
    type: task.type || null,
    provider: task.provider || null,
    state: task.state,
    detail: task.detail || null,
    progress: Number.isFinite(task.progress) ? task.progress : null,
    nextRunAt: task.nextRunAt || null,
    lastFinishedAt: task.lastFinishedAt || null,
    lastRunStatus: task.lastRunStatus || null,
    errorCode: task.errorCode || null,
    actions: (Array.isArray(task.availableActions) ? task.availableActions : []).filter(action => TASK_ACTIONS.has(action)),
  };
}

/**
 * @param backend  { ready, managed, starting } of the backend process main.js runs
 * @param health   GET /api/health (null when it did not answer)
 * @param plan     GET /api/system/plan
 * @param tasks    GET /api/system/tasks → tasks
 * @param access   GET /api/kua-apps/agent-access
 * @param update   app update state kept by main.js
 */
function buildTrayStatus({ backend = {}, health = null, plan = null, tasks = [], access = null, update = null, port, appVersion = null, now = Date.now() } = {}) {
  const list = (Array.isArray(tasks) ? tasks : []).filter(task => task && task.id).map(taskView);
  const running = list.filter(task => ACTIVE_STATES.has(task.state));
  const upcoming = list
    .filter(task => task.state === 'scheduled' && task.nextRunAt && Number.isFinite(Date.parse(task.nextRunAt)))
    .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt))
    .slice(0, UPCOMING_LIMIT);
  const paused = list.filter(task => task.state === 'paused');
  const failed = list.filter(task => task.state === 'error');
  const answers = !!health?.ok;

  return {
    generatedAt: new Date(now).toISOString(),
    kua: {
      state: answers ? 'running' : backend.starting ? 'starting' : 'stopped',
      version: health?.version || appVersion,
      url: port ? `http://localhost:${port}` : null,
      plan: plan?.plan || null,
      // The backend can be restarted from the panel only when this app runs it.
      canRestart: backend.managed !== false,
      collections: health?.apmScheduler ? { running: !!health.apmScheduler.running, intervalMinutes: health.apmScheduler.intervalMinutes } : null,
    },
    tasks: {
      running,
      upcoming,
      paused,
      failed,
      total: list.length,
    },
    mcp: access ? {
      enabled: access.enabled !== false,
      writes: access.writes === true,
      lastRequestAt: access.lastRequestAt || null,
      // Agents need Pro or Team (lib/agentPlanGuard.js); the switch works on every plan.
      planAllows: plan?.features ? plan.features.agents === true : null,
    } : null,
    update: update ? { ...update } : { status: 'idle' },
  };
}

/** A tray action from the panel, validated before main.js runs it. Returns null when invalid. */
function parseTrayAction(input) {
  const type = String(input?.type || '');
  switch (type) {
    case 'open':
    case 'quit':
    case 'refresh':
    case 'restart-backend':
    case 'check-updates':
    case 'install-update':
      return { type };
    case 'mcp':
      return typeof input.enabled === 'boolean' ? { type, enabled: input.enabled } : null;
    case 'task':
      return TASK_ID.test(String(input.id || '')) && TASK_ACTIONS.has(input.action) ? { type, id: input.id, action: input.action } : null;
    default:
      return null;
  }
}

/**
 * Where the panel opens: next to the tray icon, inside the work area of its
 * display (above a bottom taskbar, below a top menu bar). Without icon bounds
 * (some Linux trays) it opens at the cursor.
 */
function panelPosition({ trayBounds, workArea, cursor, width, height, gap = 6 }) {
  const anchor = trayBounds && trayBounds.width > 0 && trayBounds.height > 0
    ? trayBounds
    : { x: cursor?.x ?? workArea.x + workArea.width, y: cursor?.y ?? workArea.y + workArea.height, width: 0, height: 0 };
  const below = anchor.y + anchor.height / 2 < workArea.y + workArea.height / 2;
  let x = Math.round(anchor.x + anchor.width / 2 - width / 2);
  let y = below ? Math.round(anchor.y + anchor.height + gap) : Math.round(anchor.y - height - gap);
  // A taskbar on the left or right: open beside it instead.
  if (anchor.x + anchor.width <= workArea.x) x = workArea.x + gap;
  if (anchor.x >= workArea.x + workArea.width) x = workArea.x + workArea.width - width - gap;
  x = Math.max(workArea.x + gap, Math.min(x, workArea.x + workArea.width - width - gap));
  y = Math.max(workArea.y + gap, Math.min(y, workArea.y + workArea.height - height - gap));
  return { x, y };
}

module.exports = { buildTrayStatus, parseTrayAction, panelPosition, ACTIVE_STATES };

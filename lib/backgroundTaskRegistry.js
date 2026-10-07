'use strict';

const TASK_STATES = new Set(['idle', 'scheduled', 'running', 'pause_requested', 'paused', 'cancellation_requested', 'cancelled', 'completed', 'error']);
const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const TASK_ACTIONS = new Set(['pause', 'resume', 'cancel']);
const TASK_PROVIDERS = new Set(['aws', 'gcp', 'kubernetes', 'vercel', 'mixed', 'kua', 'local']);

function createBackgroundTaskRegistry({
  now = () => Date.now(),
  uptime = () => process.uptime(),
  cpuUsage = () => process.cpuUsage(),
  memoryUsage = () => process.memoryUsage(),
} = {}) {
  const tasks = new Map();
  const handles = new Map();

  function timestamp(value = now()) {
    return new Date(value).toISOString();
  }

  function register({ id, name, type = 'background', provider = null, intervalMs = null, enabled = true, controls = {} }) {
    if (!TASK_ID.test(String(id || ''))) throw new TypeError('Invalid task id');
    if (tasks.has(id)) throw new Error(`Task already registered: ${id}`);
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Task name is required');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) intervalMs = null;

    const task = {
      id,
      name: name.trim().slice(0, 100),
      type: String(type).slice(0, 40),
      provider: TASK_PROVIDERS.has(provider) ? provider : null,
      state: enabled ? (intervalMs ? 'scheduled' : 'idle') : 'idle',
      intervalMs,
      startedAt: null,
      lastRunAt: null,
      lastFinishedAt: null,
      nextRunAt: enabled && intervalMs ? timestamp(now() + intervalMs) : null,
      lastRunStatus: null,
      progress: null,
      errorCode: null,
    };
    tasks.set(id, task);
    let currentRun = null;
    let paused = false;
    let controlHandlers = new Map();

    function setControls(nextControls = {}) {
      const next = new Map();
      for (const [action, control] of Object.entries(nextControls)) {
        if (!TASK_ACTIONS.has(action)) throw new TypeError(`Unsupported task action: ${action}`);
        const run = typeof control === 'function' ? control : control?.run;
        const available = typeof control === 'function' ? () => true : control?.available || (() => true);
        if (typeof run !== 'function' || typeof available !== 'function') throw new TypeError(`Invalid task action: ${action}`);
        next.set(action, { run, available });
      }
      controlHandlers = next;
    }

    function availableActions() {
      return [...controlHandlers].filter(([, control]) => {
        try { return control.available({ ...task }) === true; } catch { return false; }
      }).map(([action]) => action);
    }

    function update(fields = {}) {
      if (fields.state !== undefined) {
        if (!TASK_STATES.has(fields.state)) throw new TypeError('Invalid task state');
        task.state = fields.state;
      }
      for (const key of ['startedAt', 'lastRunAt', 'lastFinishedAt', 'nextRunAt']) {
        if (key in fields) task[key] = fields[key] == null ? null : String(fields[key]);
      }
      if ('progress' in fields) task.progress = Number.isFinite(fields.progress) ? Math.max(0, Math.min(1, fields.progress)) : null;
      if ('provider' in fields) task.provider = TASK_PROVIDERS.has(fields.provider) ? fields.provider : null;
      if ('lastRunStatus' in fields) task.lastRunStatus = fields.lastRunStatus == null ? null : String(fields.lastRunStatus).slice(0, 40);
      if ('errorCode' in fields) {
        const code = String(fields.errorCode || '');
        task.errorCode = /^[a-z0-9_-]{1,64}$/i.test(code) ? code : (code ? 'task_failed' : null);
      }
      return { ...task };
    }

    const handle = {
      setControls,
      update,
      availableActions,
      view: () => ({ ...task, supportedActions: [...controlHandlers.keys()], availableActions: availableActions() }),
      async control(action) {
        const control = controlHandlers.get(action);
        if (!control) throw Object.assign(new Error(`Action '${action}' is not supported for this task`), { statusCode: 400, code: 'TASK_ACTION_UNSUPPORTED' });
        const available = availableActions().includes(action);
        const alreadyApplied = (action === 'pause' && ['paused', 'pause_requested'].includes(task.state))
          || (action === 'resume' && ['scheduled', 'running'].includes(task.state))
          || (action === 'cancel' && ['cancelled', 'cancellation_requested', 'completed'].includes(task.state));
        if (!available && alreadyApplied) return { task: this.view(), changed: false };
        if (!available) throw Object.assign(new Error(`Action '${action}' is not available while task is ${task.state}`), { statusCode: 409, code: 'TASK_ACTION_CONFLICT' });
        await control.run();
        return { task: this.view(), changed: true };
      },
      schedule(nextRun = intervalMs ? now() + intervalMs : null) {
        if (task.state === 'running' || paused) return;
        task.state = 'scheduled';
        task.nextRunAt = nextRun == null ? null : timestamp(nextRun);
      },
      start() {
        task.state = 'running';
        task.startedAt = timestamp();
        task.lastRunAt = task.startedAt;
        task.nextRunAt = null;
        task.progress = null;
        task.errorCode = null;
      },
      run(operation) {
        if (paused) return Promise.resolve(undefined);
        if (currentRun) return currentRun;
        this.start();
        currentRun = Promise.resolve().then(operation).then(
          result => { this.complete(); return result; },
          error => { this.fail('task_failed'); throw error; },
        ).finally(() => { currentRun = null; });
        return currentRun;
      },
      setProgress(value) {
        task.progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
      },
      complete() {
        task.lastFinishedAt = timestamp();
        task.lastRunStatus = 'completed';
        task.progress = 1;
        task.errorCode = null;
        task.state = paused ? 'paused' : intervalMs ? 'scheduled' : 'completed';
        task.nextRunAt = !paused && intervalMs ? timestamp(now() + intervalMs) : null;
      },
      fail(errorCode) {
        task.lastFinishedAt = timestamp();
        task.lastRunStatus = 'error';
        task.progress = null;
        const safeCode = String(errorCode || '');
        task.errorCode = /^[a-z0-9_-]{1,64}$/i.test(safeCode) ? safeCode : 'task_failed';
        task.state = 'error';
        task.nextRunAt = intervalMs ? timestamp(now() + intervalMs) : null;
      },
      pause() {
        paused = true;
        if (task.state === 'scheduled') task.state = 'paused';
        else if (task.state === 'running') task.state = 'pause_requested';
        task.nextRunAt = null;
      },
      resume() {
        paused = false;
        if (['paused', 'error'].includes(task.state)) {
          task.state = 'scheduled';
          task.nextRunAt = intervalMs ? timestamp(now() + intervalMs) : null;
        } else if (task.state === 'pause_requested') {
          task.state = 'running';
        }
      },
      unregister() { tasks.delete(id); handles.delete(id); },
    };
    setControls(controls);
    handles.set(id, handle);
    return handle;
  }

  function snapshot() {
    const cpu = cpuUsage();
    const memory = memoryUsage();
    return {
      generatedAt: timestamp(),
      process: {
        uptimeSeconds: Math.max(0, Number(uptime()) || 0),
        cpuMicros: {
          user: Math.max(0, Number(cpu.user) || 0),
          system: Math.max(0, Number(cpu.system) || 0),
        },
        memoryBytes: {
          rss: Math.max(0, Number(memory.rss) || 0),
          heapUsed: Math.max(0, Number(memory.heapUsed) || 0),
          external: Math.max(0, Number(memory.external) || 0),
        },
      },
      tasks: [...tasks.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(task => handles.get(task.id).view()),
    };
  }

  function get(id) {
    const task = tasks.get(id);
    return task ? handles.get(id).view() : null;
  }

  async function control(id, action) {
    const handle = handles.get(id);
    if (!handle) throw Object.assign(new Error('Background task not found'), { statusCode: 404, code: 'TASK_NOT_FOUND' });
    return handle.control(action);
  }

  return { register, snapshot, get, control, states: [...TASK_STATES], actions: [...TASK_ACTIONS] };
}

function createPeriodicTaskControls(service, task) {
  return {
    pause: {
      run: () => { service.pause(); task.pause(); },
      available: () => service.health().running,
    },
    resume: {
      run: () => { service.resume(); task.resume(); },
      available: () => !service.health().running && ['paused', 'pause_requested', 'error'].includes(task.view().state),
    },
  };
}

module.exports = { createBackgroundTaskRegistry, createPeriodicTaskControls, TASK_STATES, TASK_PROVIDERS };
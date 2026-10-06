'use strict';

const TASK_STATES = new Set(['idle', 'scheduled', 'running', 'paused', 'completed', 'error']);
const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

function createBackgroundTaskRegistry({
  now = () => Date.now(),
  uptime = () => process.uptime(),
  cpuUsage = () => process.cpuUsage(),
  memoryUsage = () => process.memoryUsage(),
} = {}) {
  const tasks = new Map();

  function timestamp(value = now()) {
    return new Date(value).toISOString();
  }

  function register({ id, name, type = 'background', intervalMs = null, enabled = true }) {
    if (!TASK_ID.test(String(id || ''))) throw new TypeError('Invalid task id');
    if (tasks.has(id)) throw new Error(`Task already registered: ${id}`);
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Task name is required');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) intervalMs = null;

    const task = {
      id,
      name: name.trim().slice(0, 100),
      type: String(type).slice(0, 40),
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

    return {
      schedule(nextRun = intervalMs ? now() + intervalMs : null) {
        if (task.state === 'running' || task.state === 'paused') return;
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
        if (currentRun) return currentRun;
        this.start();
        currentRun = Promise.resolve().then(operation).then(
          result => { this.complete(); return result; },
          error => { this.fail(error?.code); throw error; },
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
        task.state = intervalMs ? 'scheduled' : 'completed';
        task.nextRunAt = intervalMs ? timestamp(now() + intervalMs) : null;
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
        if (task.state === 'scheduled') task.state = 'paused';
      },
      resume() {
        if (task.state === 'paused') {
          task.state = 'scheduled';
          task.nextRunAt = intervalMs ? timestamp(now() + intervalMs) : null;
        }
      },
      unregister() { tasks.delete(id); },
    };
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
        .map(task => ({ ...task })),
    };
  }

  function get(id) {
    const task = tasks.get(id);
    return task ? { ...task } : null;
  }

  return { register, snapshot, get, states: [...TASK_STATES] };
}

module.exports = { createBackgroundTaskRegistry, TASK_STATES };
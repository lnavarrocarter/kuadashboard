'use strict';

const ACTIVE_STATES = new Set(['running', 'pause_requested', 'cancellation_requested']);

function summarizeTaskProgress(tasks = []) {
  const active = (Array.isArray(tasks) ? tasks : []).filter(task => ACTIVE_STATES.has(task.state));
  if (!active.length) return { mode: 'none', progress: null, tooltip: 'KuaDashboard' };

  const work = active.filter(task => task.type !== 'scheduler');
  const visible = work.length ? work : active;
  const determinate = visible.every(task => Number.isFinite(task.progress));
  const progress = determinate
    ? visible.reduce((total, task) => total + Math.max(0, Math.min(1, task.progress)), 0) / visible.length
    : null;
  const names = visible.slice(0, 2).map(task => task.name || task.id || 'Background task').join(', ');
  const tooltip = `KuaDashboard - ${names}${visible.length > 2 ? ` +${visible.length - 2}` : ''} - ${progress === null ? 'running' : `${Math.round(progress * 100)}%`}`;

  return { mode: progress === null ? 'indeterminate' : 'determinate', progress, tooltip: tooltip.slice(0, 127) };
}

module.exports = { summarizeTaskProgress };
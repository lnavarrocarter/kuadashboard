'use strict';
/* Tray panel renderer (electron/trayPanel.html). Status comes from main.js (electron/trayStatus.js). */

const STRINGS = {
  en: {
    running: 'Running now', upcoming: 'Up next', mcp: 'AI agents', update: 'App update',
    open: 'Open KuaDashboard', quit: 'Quit', restart: 'Restart backend', restarting: 'Restarting…',
    'state.running': 'Running', 'state.starting': 'Starting', 'state.stopped': 'Stopped',
    stoppedText: 'The KUA backend is not answering. Background work and AI agents are paused.',
    noRunning: 'Nothing running', noUpcoming: 'Nothing scheduled',
    paused: 'Paused', failed: 'Failed', resume: 'Resume', pause: 'Pause', cancel: 'Cancel',
    mcpSwitch: 'AI agent access (MCP)',
    mcpOn: 'On · agents connected through the KUA MCP server can read KUA',
    mcpOff: 'Off · KUA refuses every agent request',
    mcpLast: 'last request {time}', mcpWrites: 'can change KUApps',
    mcpPlan: 'Agents need the Pro or Team plan (Help & Options → Account).',
    now: 'now', inMin: 'in {n} min', inHour: 'in {n} h', agoMin: '{n} min ago', agoHour: '{n} h ago', agoNow: 'just now',
    'update.checking': 'Checking for updates…', 'update.available': 'Version {version} found, downloading…',
    'update.downloading': 'Downloading {version}… {percent}%', 'update.downloaded': 'Version {version} is ready',
    'update.none': 'KuaDashboard is up to date', 'update.error': 'Update failed: {error}',
    install: 'Restart to update', check: 'Check',
  },
  es: {
    running: 'En ejecución', upcoming: 'Próximas', mcp: 'Agentes de IA', update: 'Actualización',
    open: 'Abrir KuaDashboard', quit: 'Salir', restart: 'Reiniciar backend', restarting: 'Reiniciando…',
    'state.running': 'Activo', 'state.starting': 'Iniciando', 'state.stopped': 'Detenido',
    stoppedText: 'El backend de KUA no responde. El trabajo en segundo plano y los agentes de IA están detenidos.',
    noRunning: 'Nada en ejecución', noUpcoming: 'Nada programado',
    paused: 'En pausa', failed: 'Con error', resume: 'Reanudar', pause: 'Pausar', cancel: 'Cancelar',
    mcpSwitch: 'Acceso de agentes de IA (MCP)',
    mcpOn: 'Encendido · los agentes conectados por el servidor MCP de KUA pueden leer KUA',
    mcpOff: 'Apagado · KUA rechaza toda petición de agentes',
    mcpLast: 'última petición {time}', mcpWrites: 'pueden cambiar KUApps',
    mcpPlan: 'Los agentes necesitan el plan Pro o Team (Ayuda y opciones → Cuenta).',
    now: 'ahora', inMin: 'en {n} min', inHour: 'en {n} h', agoMin: 'hace {n} min', agoHour: 'hace {n} h', agoNow: 'recién',
    'update.checking': 'Buscando actualizaciones…', 'update.available': 'Versión {version} encontrada, descargando…',
    'update.downloading': 'Descargando {version}… {percent}%', 'update.downloaded': 'La versión {version} está lista',
    'update.none': 'KuaDashboard está actualizado', 'update.error': 'Falló la actualización: {error}',
    install: 'Reiniciar y actualizar', check: 'Buscar',
  },
};

let lang = 'en';
let busy = false;

function t(key, params = {}) {
  const value = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function relative(iso, now) {
  const delta = Date.parse(iso) - now;
  const minutes = Math.round(Math.abs(delta) / 60000);
  if (delta >= 0) {
    if (minutes < 1) return t('now');
    return minutes < 60 ? t('inMin', { n: minutes }) : t('inHour', { n: Math.round(minutes / 60) });
  }
  if (minutes < 1) return t('agoNow');
  return minutes < 60 ? t('agoMin', { n: minutes }) : t('agoHour', { n: Math.round(minutes / 60) });
}

async function act(action) {
  if (busy) return;
  busy = true;
  if (action.type === 'restart-backend') {
    const restart = document.getElementById('restart');
    restart.textContent = t('restarting');
    restart.disabled = true;
  }
  try {
    const status = await window.kuaTray.action(action);
    if (status) render(status);
  } finally {
    busy = false;
  }
}

function taskButtons(task, allowed) {
  return task.actions.filter(action => allowed.includes(action)).map(action =>
    el('button', { class: 'link', text: t(action), onclick: () => act({ type: 'task', id: task.id, action }) }));
}

function renderTasks(status, now) {
  const running = document.getElementById('running');
  running.replaceChildren(...(status.tasks.running.length ? status.tasks.running.map(task => {
    const bar = el('div', { class: `bar${task.progress === null ? ' indeterminate' : ''}` }, [el('span')]);
    if (task.progress !== null) bar.firstChild.style.width = `${Math.round(task.progress * 100)}%`;
    return el('li', {}, [
      el('div', { class: 'row' }, [
        el('span', { class: 'name', text: task.name, title: task.name }),
        el('span', { class: 'meta', text: task.progress === null ? '' : `${Math.round(task.progress * 100)}%` }),
        ...taskButtons(task, ['pause', 'cancel']),
      ]),
      task.detail ? el('span', { class: 'detail', text: task.detail, title: task.detail }) : null,
      bar,
    ]);
  }) : [el('li', { class: 'empty', text: t('noRunning') })]));
  document.getElementById('running-count').textContent = status.tasks.running.length ? String(status.tasks.running.length) : '';

  const upcoming = document.getElementById('upcoming');
  upcoming.replaceChildren(...(status.tasks.upcoming.length ? status.tasks.upcoming.map(task => el('li', {}, [
    el('div', { class: 'row' }, [
      el('span', { class: 'name', text: task.name, title: task.detail || task.name }),
      el('span', { class: 'meta', text: relative(task.nextRunAt, now), title: new Date(task.nextRunAt).toLocaleString() }),
      ...taskButtons(task, ['pause']),
    ]),
  ])) : [el('li', { class: 'empty', text: t('noUpcoming') })]));

  const attention = document.getElementById('attention');
  attention.replaceChildren(...[
    ...status.tasks.paused.map(task => ({ task, dot: 'warn', label: t('paused') })),
    ...status.tasks.failed.map(task => ({ task, dot: 'err', label: task.errorCode ? `${t('failed')} · ${task.errorCode}` : t('failed') })),
  ].map(({ task, dot, label }) => el('li', {}, [
    el('div', { class: 'row' }, [
      el('span', { class: `dot ${dot}` }),
      el('span', { class: 'name', text: task.name }),
      el('span', { class: 'meta', text: label }),
      ...taskButtons(task, ['resume']),
    ]),
  ])));
}

function renderMcp(status, now) {
  const section = document.getElementById('mcp-section');
  section.hidden = !status.mcp;
  if (!status.mcp) return;
  const input = document.getElementById('mcp');
  input.checked = status.mcp.enabled;
  input.disabled = busy;
  const parts = [t(status.mcp.enabled ? 'mcpOn' : 'mcpOff')];
  if (status.mcp.enabled && status.mcp.writes) parts.push(t('mcpWrites'));
  if (status.mcp.lastRequestAt) parts.push(t('mcpLast', { time: relative(status.mcp.lastRequestAt, now) }));
  document.getElementById('mcp-detail').textContent = parts.join(' · ');
  const note = document.getElementById('mcp-note');
  note.hidden = !(status.mcp.enabled && status.mcp.planAllows === false);
  note.textContent = t('mcpPlan');
}

function renderUpdate(update) {
  const section = document.getElementById('update-section');
  const shown = update && update.status !== 'idle';
  section.hidden = !shown;
  if (!shown) return;
  const params = { version: update.version || '', percent: Math.round(update.percent || 0), error: update.error || '' };
  document.getElementById('update-text').textContent = t(`update.${update.status}`, params);
  const bar = document.getElementById('update-bar');
  bar.hidden = update.status !== 'downloading';
  bar.firstChild.style.width = `${params.percent}%`;
  const button = document.getElementById('update-action');
  button.hidden = !['downloaded', 'error', 'none'].includes(update.status);
  button.textContent = update.status === 'downloaded' ? t('install') : t('check');
  button.onclick = () => act({ type: update.status === 'downloaded' ? 'install-update' : 'check-updates' });
}

function render(status) {
  lang = status.lang === 'es' ? 'es' : 'en';
  document.documentElement.lang = lang;
  const now = Date.parse(status.generatedAt) || Date.now();
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);

  document.getElementById('version').textContent = status.kua.version ? `v${status.kua.version}` : '';
  const plan = document.getElementById('plan');
  plan.hidden = !status.kua.plan;
  plan.textContent = status.kua.plan || '';
  document.getElementById('state').textContent = t(`state.${status.kua.state}`);
  document.getElementById('state-dot').className = `dot ${{ running: 'ok', starting: 'warn', stopped: 'err' }[status.kua.state]}`;

  const stopped = document.getElementById('stopped');
  stopped.hidden = status.kua.state === 'running';
  document.getElementById('stopped-text').textContent = status.kua.state === 'starting' ? t('state.starting') + '…' : t('stoppedText');
  const restart = document.getElementById('restart');
  restart.hidden = !status.kua.canRestart || status.kua.state !== 'stopped';
  restart.textContent = busy ? t('restarting') : t('restart');
  restart.disabled = busy;

  renderTasks(status, now);
  renderMcp(status, now);
  renderUpdate(status.update);
}

document.getElementById('open').addEventListener('click', () => act({ type: 'open' }));
document.getElementById('quit').addEventListener('click', () => act({ type: 'quit' }));
document.getElementById('restart').addEventListener('click', () => act({ type: 'restart-backend' }));
document.getElementById('mcp').addEventListener('change', event => act({ type: 'mcp', enabled: event.target.checked }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });

window.kuaTray.onStatus(render);
window.kuaTray.getStatus().then(render);

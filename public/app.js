"use strict";

// State

const state = {
  resource: "pods",

  namespace: "all",

  rows: [],

  ws: null,

  wsTarget: null,

  pending: { delete: null, scale: null, drain: null },
};

//  API

async function api(method, path, body) {
  const opts = { method, headers: {} };

  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);

  const ct = res.headers.get("content-type") || "";

  if (!res.ok) {
    const err = ct.includes("json")
      ? (await res.json()).error
      : await res.text();

    throw new Error(err || `HTTP ${res.status}`);
  }

  return ct.includes("json") ? res.json() : res.text();
}

//  Helpers

function age(ts) {
  if (!ts) return "-";

  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);

  if (diff < 60) return `${diff}s`;

  if (diff < 3600) return `${Math.floor(diff / 60)}m`;

  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;

  return `${Math.floor(diff / 86400)}d`;
}

function badge(status) {
  const key = (status || "unknown").toLowerCase().replace(/[^a-z]/g, "");

  return `<span class="badge ${key}">${status}</span>`;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

//  Resource configs

const RESOURCES = {
  pods: {
    title: "Pods",

    cols: ["Name", "Namespace", "Status", "Ready", "Restarts", "Age", "Node"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      badge(r.status),

      escHtml(r.ready),
      String(r.restarts),
      age(r.age),
      escHtml(r.nodeName),
    ],

    actions: (r) => [
      btn(
        "scroll",
        "Logs",
        "blue",
        `viewLogs('${r.namespace}','${r.name}',${JSON.stringify(r.containers).replace(/"/g,'&quot;')})`,
      ),

      btn(
        "terminal",
        "Shell",
        "green",
        `openExec('${r.namespace}','${r.name}',${JSON.stringify(r.containers).replace(/"/g,'&quot;')})`,
      ),

      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('pods','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('pods','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  deployments: {
    title: "Deployments",

    cols: ["Name", "Namespace", "Ready", "Replicas", "Age"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      escHtml(r.ready),
      String(r.replicas),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "rotate-ccw",
        "Restart",
        "green",
        `restart('deployments','${r.namespace}','${r.name}')`,
      ),

      btn(
        "layers",
        "Scale",
        "blue",
        `openScale('deployments','${r.namespace}','${r.name}',${r.replicas})`,
      ),

      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('deployments','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('deployments','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  statefulsets: {
    title: "StatefulSets",

    cols: ["Name", "Namespace", "Ready", "Replicas", "Age"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      escHtml(r.ready),
      String(r.replicas),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "rotate-ccw",
        "Restart",
        "green",
        `restart('statefulsets','${r.namespace}','${r.name}')`,
      ),

      btn(
        "layers",
        "Scale",
        "blue",
        `openScale('statefulsets','${r.namespace}','${r.name}',${r.replicas})`,
      ),

      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('statefulsets','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('statefulsets','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  daemonsets: {
    title: "DaemonSets",

    cols: ["Name", "Namespace", "Desired", "Current", "Ready", "Age"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      String(r.desired),
      String(r.current),
      String(r.ready),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('daemonsets','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('daemonsets','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  services: {
    title: "Services",

    cols: [
      "Name",
      "Namespace",
      "Type",
      "Cluster IP",
      "External IP",
      "Ports",
      "Age",
    ],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      escHtml(r.type),
      escHtml(r.clusterIP),
      escHtml(r.externalIP),
      escHtml(r.ports),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "cable",
        "Port-Forward",
        "green",
        `openPortForward('${r.namespace}','${r.name}',${JSON.stringify(r.ports)})`,
      ),
      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('services','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('services','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  ingresses: {
    title: "Ingresses",

    cols: ["Name", "Namespace", "Hosts", "TLS", "Age"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      escHtml(r.hosts),
      escHtml(r.tls),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('ingresses','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('ingresses','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  configmaps: {
    title: "ConfigMaps",

    cols: ["Name", "Namespace", "Keys", "Age"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      String(r.keys),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('configmaps','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('configmaps','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  secrets: {
    title: "Secrets",

    cols: ["Name", "Namespace", "Type", "Keys", "Age"],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      escHtml(r.type),
      String(r.keys),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('secrets','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('secrets','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  pvcs: {
    title: "PersistentVolumeClaims",

    cols: [
      "Name",
      "Namespace",
      "Status",
      "Capacity",
      "Storage Class",
      "Access Modes",
      "Age",
    ],

    row: (r) => [
      escHtml(r.name),
      escHtml(r.namespace),
      badge(r.status),
      escHtml(r.capacity),
      escHtml(r.storageClass),
      escHtml(r.accessModes),
      age(r.age),
    ],

    actions: (r) => [
      btn(
        "file-code-2",
        "YAML",
        "blue",
        `viewYaml('pvcs','${r.namespace}','${r.name}')`,
      ),

      btn(
        "trash-2",
        "Delete",
        "red",
        `confirmDelete('pvcs','${r.namespace}','${r.name}')`,
      ),
    ],
  },

  nodes: {
    title: "Nodes",

    cols: ["Name", "Status", "Roles", "Version", "OS", "CPU", "Memory", "Age"],

    row: (r) => [
      escHtml(r.name),

      r.unschedulable ? badge("Cordoned") : badge(r.status),

      escHtml(r.roles),
      escHtml(r.version),
      escHtml(r.os),

      escHtml(r.cpu),
      escHtml(r.memory),
      age(r.age),
    ],

    actions: (r) => [
      r.unschedulable
        ? btn("unlock", "Uncordon", "green", `cordonNode('${r.name}',false)`)
        : btn("lock", "Cordon", "blue", `cordonNode('${r.name}',true)`),

      btn("arrow-down-to-line", "Drain", "blue", `confirmDrain('${r.name}')`),

      btn("file-code-2", "YAML", "blue", `viewYaml('nodes',null,'${r.name}')`),
    ],
  },

  events: {
    title: "Events",

    cols: ["Namespace", "Type", "Reason", "Object", "Count", "Message", "Age"],

    row: (r) => [
      escHtml(r.namespace),
      escHtml(r.type),
      escHtml(r.reason),

      escHtml(r.object),
      String(r.count),

      `<span title="${escHtml(r.message)}">${escHtml(r.message?.substring(0, 80) ?? "")}${r.message?.length > 80 ? "â€¦" : ""}</span>`,

      age(r.age),
    ],

    actions: () => [],
  },
};

function btn(iconName, title, cls, onclick) {
  return `<button class="action-btn icon-${iconName} ${cls}" title="${title}" onclick="${onclick}"></button>`;
}

//  DOM refs â”€â”€

const $ = (id) => document.getElementById(id);

const contextSelect = $("contextSelect");

const namespaceSelect = $("namespaceSelect");

const resourceTitle = $("resourceTitle");

const tableHead = $("tableHead");

const tableBody = $("tableBody");

const resourceTable = $("resourceTable");

const loadingState = $("loadingState");

const emptyState = $("emptyState");

const searchInput = $("searchInput");

const headerStatus = $("headerStatus");

//  Sidebar navigation â”€

document.querySelectorAll(".sidebar-item").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();

    document
      .querySelectorAll(".sidebar-item")
      .forEach((i) => i.classList.remove("active"));

    el.classList.add("active");

    state.resource = el.dataset.resource;

    loadResources();
  });
});

//  Context select â”€â”€

contextSelect.addEventListener("change", async () => {
  try {
    await api("POST", "/api/contexts/switch", { context: contextSelect.value });

    toast("Context switched to " + contextSelect.value, "success");

    await loadNamespaces();

    loadResources();
  } catch (e) {
    toast(e.message, "error");
  }
});

//  Namespace select

namespaceSelect.addEventListener("change", () => {
  state.namespace = namespaceSelect.value;

  loadResources();
});

//  Search filter

searchInput.addEventListener("input", renderTable);

//  Refresh button â”€â”€

$("refreshBtn").addEventListener("click", loadResources);
$("helpBtn").addEventListener("click", () => openModal("helpOverlay"));

//  Keyboard shortcut R â†’ refresh â”€

document.addEventListener("keydown", (e) => {
  if (
    e.key === "r" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  ) {
    loadResources();
  }

  if (e.key === "Escape") closeAllModals();
});

//  Load contexts

async function loadContexts() {
  try {
    const data = await api("GET", "/api/contexts");

    contextSelect.innerHTML = data.contexts
      .map(
        (c) =>
          `<option value="${escHtml(c.name)}" ${c.isCurrent ? "selected" : ""}>${escHtml(c.name)}</option>`,
      )
      .join("");

    headerStatus.textContent = data.current;
  } catch (e) {
    toast("Failed to load contexts: " + e.message, "error");
  }
}

//  Load namespaces â”€

async function loadNamespaces() {
  try {
    const list = await api("GET", "/api/namespaces");

    // Always pin "default" at top

    const names = list.map((n) => n.name);

    if (!names.includes("default")) names.unshift("default");
    else {
      names.splice(names.indexOf("default"), 1);
      names.unshift("default");
    }

    // Auto-select "default" on first load (if still at initial "all")

    if (state.namespace === "all" || !names.includes(state.namespace)) {
      state.namespace = "default";
    }

    namespaceSelect.innerHTML =
      '<option value="all">All namespaces</option>' +
      names
        .map(
          (n) =>
            `<option value="${escHtml(n)}"${n === state.namespace ? " selected" : ""}>${escHtml(n)}</option>`,
        )
        .join("");
  } catch (e) {
    toast("Failed to load namespaces: " + e.message, "error");
  }
}

//  Load resources â”€â”€

async function loadResources() {
  const cfg = RESOURCES[state.resource];

  resourceTitle.textContent = cfg.title;

  showLoading();

  try {
    let url;

    if (state.resource === "nodes") {
      url = "/api/nodes";
    } else if (state.resource === "events") {
      url = `/api/${state.namespace}/events`;
    } else {
      url = `/api/${state.namespace}/${state.resource}`;
    }

    state.rows = await api("GET", url);

    renderTable();
  } catch (e) {
    showEmpty();

    toast("Error loading " + cfg.title + ": " + e.message, "error");
  }
}

function renderTable() {
  const cfg = RESOURCES[state.resource];

  const filter = searchInput.value.toLowerCase();

  const rows = filter
    ? state.rows.filter((r) => JSON.stringify(r).toLowerCase().includes(filter))
    : state.rows;

  if (!rows.length) {
    showEmpty();
    return;
  }

  tableHead.innerHTML =
    "<tr>" +
    cfg.cols.map((c) => `<th>${c}</th>`).join("") +
    "<th>Actions</th></tr>";

  tableBody.innerHTML = rows
    .map((r) => {
      const cells = cfg
        .row(r)
        .map((c) => `<td>${c}</td>`)
        .join("");

      const actions = cfg.actions(r).join("");

      return `<tr>${cells}<td class="col-actions">${actions}</td></tr>`;
    })
    .join("");

  loadingState.style.display = "none";

  emptyState.style.display = "none";

  resourceTable.style.display = "";

  updateStatusBar();
}

function showLoading() {
  resourceTable.style.display = "none";

  emptyState.style.display = "none";

  loadingState.style.display = "";
}

function showEmpty() {
  resourceTable.style.display = "none";

  loadingState.style.display = "none";

  emptyState.style.display = "";
}

//  Actions

window.restart = async function (type, ns, name) {
  try {
    await api("POST", `/api/${ns}/${type}/${name}/restart`);

    toast(`Restarted ${name}`, "success");

    setTimeout(loadResources, 1000);
  } catch (e) {
    toast(e.message, "error");
  }
};

window.cordonNode = async function (name, cordon) {
  try {
    await api("POST", `/api/nodes/${name}/cordon`, { cordon });

    toast(`Node ${name} ${cordon ? "cordoned" : "uncordoned"}`, "success");

    setTimeout(loadResources, 800);
  } catch (e) {
    toast(e.message, "error");
  }
};

//  Delete â”€

window.confirmDelete = function (type, ns, name) {
  state.pending.delete = { type, ns, name };

  $("deleteMsg").textContent =
    `Delete ${type.slice(0, -1)} "${name}" in namespace "${ns}"? This cannot be undone.`;

  openModal("deleteOverlay");
};

$("confirmDeleteBtn").addEventListener("click", async () => {
  const { type, ns, name } = state.pending.delete;

  closeModal("deleteOverlay");

  try {
    if (type === "nodes") await api("DELETE", `/api/nodes/${name}`);
    else await api("DELETE", `/api/${ns}/${type}/${name}`);

    toast(`Deleted ${name}`, "success");

    setTimeout(loadResources, 600);
  } catch (e) {
    toast(e.message, "error");
  }
});

$("cancelDeleteBtn").addEventListener("click", () =>
  closeModal("deleteOverlay"),
);

$("closeDeleteModal").addEventListener("click", () =>
  closeModal("deleteOverlay"),
);

$("closeHelpModal").addEventListener("click", () => closeModal("helpOverlay"));

$('deleteContextBtn').addEventListener('click', () => {
  const name = contextSelect.value;
  if (name) window.confirmDeleteContext(name);
});


// --- Delete Context ----------------------------------------------------------

window.confirmDeleteContext = function(name) {
  state.pending.deleteContext = name;
  $('deleteContextName').textContent = 'Eliminar contexto "' + name + '"? Esta accion no puede deshacerse.';
  openModal('deleteContextOverlay');
};

$('confirmDeleteContextBtn').addEventListener('click', async () => {
  const name = state.pending.deleteContext;
  closeModal('deleteContextOverlay');
  try {
    await api('DELETE', '/api/contexts/' + encodeURIComponent(name));
    toast('Contexto "' + name + '" eliminado', 'success');
    await loadContexts();
  } catch(e) { toast(e.message, 'error'); }
});
$('cancelDeleteContextBtn').addEventListener('click', () => closeModal('deleteContextOverlay'));
$('closeDeleteContextModal').addEventListener('click', () => closeModal('deleteContextOverlay'));

// --- Port-Forward modal ------------------------------------------------------

window.openPortForward = function(namespace, name, ports) {
  const portList = Array.isArray(ports) ? ports : [];
  const firstPort = portList.length
    ? (typeof portList[0] === 'object' ? portList[0].port : portList[0])
    : '';
  $('pfServiceLabel').textContent = namespace + '/' + name;
  $('pfNamespace').value = namespace;
  $('pfService').value   = name;
  const svcRow = $('pfServiceNameRow');
  if (svcRow) svcRow.style.display = 'none';
  $('pfRemotePort').value  = firstPort || '';
  $('pfLocalPort').value   = firstPort || '';
  $('pfError').textContent = '';
  openModal('portForwardOverlay');
};

$('cancelPortForwardBtn').addEventListener('click', () => closeModal('portForwardOverlay'));
$('closePortForwardModal').addEventListener('click', () => closeModal('portForwardOverlay'));

$('confirmPortForwardBtn').addEventListener('click', async () => {
  const nsInput  = $('pfNsInput');
  const svcInput = $('pfSvcInput');
  const ns  = $('pfNamespace').value || (nsInput  ? nsInput.value.trim()  : '');
  const svc = $('pfService').value   || (svcInput ? svcInput.value.trim() : '');
  const lp  = parseInt($('pfLocalPort').value,  10);
  const rp  = parseInt($('pfRemotePort').value, 10);
  $('pfError').textContent = '';
  if (!ns || !svc) { $('pfError').textContent = 'Namespace y servicio son requeridos.'; return; }
  if (!lp || !rp)  { $('pfError').textContent = 'Ambos puertos son requeridos.'; return; }
  try {
    const r = await api('POST', '/api/' + ns + '/services/' + svc + '/portforward',
      { localPort: lp, remotePort: rp });
    closeModal('portForwardOverlay');
    toast('Port-forward activo: localhost:' + r.localPort + ' -> ' + r.remotePort, 'success');
    pfPanelRender();
    pfPersistSave();
  } catch(e) { $('pfError').textContent = e.message; }
});

// --- Port-Forward Panel ------------------------------------------------------

const pfPanel = $('pfPanel');
const PF_STORE_KEY = 'kuadashboard_pf_saved';

function pfPersistSave() {
  api('GET', '/api/portforwards').then(list => {
    localStorage.setItem(PF_STORE_KEY, JSON.stringify(list));
  }).catch(() => {});
}

async function pfAutoRestore() {
  const saved = JSON.parse(localStorage.getItem(PF_STORE_KEY) || '[]');
  for (const pf of saved) {
    try {
      await api('POST', '/api/' + pf.namespace + '/services/' + pf.name + '/portforward',
        { localPort: pf.localPort, remotePort: pf.remotePort });
    } catch(_) {}
  }
  pfPanelRender();
}

async function pfPanelRender() {
  let list = [];
  try { list = await api('GET', '/api/portforwards'); } catch(_) {}
  const body    = $('pfPanelBody');
  const emptyEl = $('pfEmpty');
  body.querySelectorAll('.pf-item').forEach(el => el.remove());
  if (!list.length) {
    if (emptyEl) emptyEl.style.display = '';
    const bar = $('pfBadgeBar');
    if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  list.forEach(pf => {
    const div = document.createElement('div');
    div.className = 'pf-item';
    div.innerHTML =
      '<div class="pf-item-info">' +
        '<span class="pf-item-ns">'   + escHtml(pf.namespace) + '</span>' +
        '<span class="pf-item-name">' + escHtml(pf.name) + '</span>' +
        '<span class="pf-item-ports">' +
          '<a href="http://localhost:' + pf.localPort + '" target="_blank" class="pf-open-link">' +
            'localhost:' + pf.localPort + '</a> &rarr; ' + pf.remotePort +
        '</span>' +
      '</div>' +
      '<button class="btn sm danger pf-stop-btn" title="Detener" onclick="pfStop(' + pf.localPort + ')">' +
        '<i data-lucide="x"></i>' +
      '</button>';
    body.insertBefore(div, emptyEl);
  });
  const bar = $('pfBadgeBar');
  if (bar) {
    bar.innerHTML = list.map(pf =>
      '<span class="pf-badge">' + escHtml(pf.name) + ':' + pf.localPort +
      '<button class="pf-badge-close" onclick="pfStop(' + pf.localPort + ')" title="Detener">&times;</button></span>'
    ).join('');
    bar.style.display = 'flex';
  }
  if (window.lucide) lucide.createIcons();
}

window.pfStop = async function(localPort) {
  try {
    await api('DELETE', '/api/portforward/' + localPort);
    toast('Port-forward :' + localPort + ' detenido', 'info');
    pfPanelRender();
    pfPersistSave();
  } catch(e) { toast(e.message, 'error'); }
};

$('pfPanelToggleBtn').addEventListener('click', () => {
  const open = pfPanel.style.display !== 'none';
  pfPanel.style.display = open ? 'none' : 'flex';
  if (!open) {
    pfPanelRender();
    if (window.lucide) lucide.createIcons({ nodes: [pfPanel] });
  }
  $('pfPanelToggleBtn').classList.toggle('primary', !open);
});

$('pfPanelCloseBtn').addEventListener('click', () => {
  pfPanel.style.display = 'none';
  $('pfPanelToggleBtn').classList.remove('primary');
});

$('pfPanelAddBtn').addEventListener('click', () => {
  $('pfServiceLabel').textContent = 'Manual';
  $('pfNamespace').value = '';
  $('pfService').value   = '';
  const svcRow = $('pfServiceNameRow');
  if (svcRow) svcRow.style.display = 'flex';
  const nsInput  = $('pfNsInput');
  const svcInput = $('pfSvcInput');
  if (nsInput)  nsInput.value  = state.namespace || 'default';
  if (svcInput) svcInput.value = '';
  $('pfRemotePort').value  = '';
  $('pfLocalPort').value   = '';
  $('pfError').textContent = '';
  openModal('portForwardOverlay');
});

//  Drain â”€â”€

window.confirmDrain = function (name) {
  state.pending.drain = name;

  $("drainMsg").textContent =
    `Drain node "${name}"? It will be cordoned and all eligible pods evicted.`;

  openModal("drainOverlay");
};

$("confirmDrainBtn").addEventListener("click", async () => {
  const name = state.pending.drain;

  closeModal("drainOverlay");

  try {
    const r = await api("POST", `/api/nodes/${name}/drain`);

    toast(
      `Node ${name} drained. Evicted: ${r.evicted}, Failed: ${r.failed}`,
      r.failed ? "warn" : "success",
    );

    setTimeout(loadResources, 800);
  } catch (e) {
    toast(e.message, "error");
  }
});

$("cancelDrainBtn").addEventListener("click", () => closeModal("drainOverlay"));

$("closeDrainModal").addEventListener("click", () =>
  closeModal("drainOverlay"),
);

//  Scale â”€â”€

window.openScale = function (type, ns, name, current) {
  state.pending.scale = { type, ns, name };

  $("scaleInput").value = current;

  openModal("scaleOverlay");
};

$("confirmScaleBtn").addEventListener("click", async () => {
  const { type, ns, name } = state.pending.scale;

  const replicas = parseInt($("scaleInput").value, 10);

  closeModal("scaleOverlay");

  try {
    await api("POST", `/api/${ns}/${type}/${name}/scale`, { replicas });

    toast(`Scaled ${name} to ${replicas}`, "success");

    setTimeout(loadResources, 800);
  } catch (e) {
    toast(e.message, "error");
  }
});

$("cancelScaleBtn").addEventListener("click", () => closeModal("scaleOverlay"));

$("closeScaleModal").addEventListener("click", () =>
  closeModal("scaleOverlay"),
);

//  YAML

window.viewYaml = async function (type, ns, name) {
  $("yamlTitle").textContent = `YAML â€” ${type}/${name}`;

  $("yamlEditor").value = "Loadingâ€¦";

  openModal("yamlOverlay");

  try {
    const url =
      type === "nodes"
        ? `/api/nodes/${name}/yaml`
        : `/api/${ns}/${type}/${name}/yaml`;

    const content = await api("GET", url);

    $("yamlEditor").value = content;

    $("applyYamlBtn").dataset.type = type;

    $("applyYamlBtn").dataset.ns = ns || "";

    $("applyYamlBtn").dataset.name = name;
  } catch (e) {
    $("yamlEditor").value = `# Error: ${e.message}`;
  }
};

$("applyYamlBtn").addEventListener("click", async () => {
  const yamlContent = $("yamlEditor").value;

  try {
    await api("PUT", "/api/apply", { yamlContent });

    toast("Applied successfully", "success");

    closeModal("yamlOverlay");

    setTimeout(loadResources, 800);
  } catch (e) {
    toast("Apply failed: " + e.message, "error");
  }
});

$("closeYamlModal").addEventListener("click", () => closeModal("yamlOverlay"));

//  Terminal Panel â”€â”€

// Multi-tab log viewer docked at the bottom, resizable, with timestamps.

// Lines are kept as HTML strings (tab.lines[]) â€” no detached DOM nodes.

const termState = {
  tabs: [], // [{ id, ns, pod, containers, container, ws, lines[], streaming }]

  activeId: null,

  wrap: false,
};

const termPanel = $("termPanel");

const termTabs = $("termTabs");

const termBody = $("termBody");

// â”€â”€ Open / create tab

window.viewLogs = function (ns, pod, containers) {
  const existing = termState.tabs.find((t) => t.pod === pod && t.ns === ns);

  if (existing) {
    activateTab(existing.id);
    return;
  }

  const id = `tab-${Date.now()}`;

  const tab = {
    id,
    ns,
    pod,

    containers: containers || [],

    container: containers?.[0] || null,

    ws: null,

    lines: [],

    lineCount: 0,

    streaming: false,
  };

  termState.tabs.push(tab);

  // Tab header element

  const tabEl = document.createElement("div");

  tabEl.className = "term-tab";

  tabEl.dataset.id = id;

  tabEl.innerHTML =
    `<span class="tab-dot streaming"></span>` +
    `<span class="tab-label" title="${escHtml(pod)}">${escHtml(pod)}</span>` +
    `<button class="tab-close" title="Close">âœ•</button>`;

  tabEl.addEventListener("click", (e) => {
    if (!e.target.classList.contains("tab-close")) activateTab(id);
  });

  tabEl.querySelector(".tab-close").addEventListener("click", (e) => {
    e.stopPropagation();

    closeTab(id);
  });

  termTabs.appendChild(tabEl);

  termPanel.style.display = "flex";

  activateTab(id);

  startTabStream(tab);
};

// â”€â”€ Activate tab â”€â”€

function activateTab(id) {
  termState.activeId = id;

  termTabs
    .querySelectorAll(".term-tab")
    .forEach((el) => el.classList.toggle("active", el.dataset.id === id));

  const tab = termState.tabs.find((t) => t.id === id);

  if (!tab) return;

  // Render stored lines into the visible body

  termBody.innerHTML = tab.lines.join("");

  termBody.scrollTop = termBody.scrollHeight;

  // Sync container selector

  const sel = $("termContainerSel");

  sel.innerHTML = tab.containers
    .map(
      (c) =>
        `<option value="${escHtml(c)}"${c === tab.container ? " selected" : ""}>${escHtml(c)}</option>`,
    )
    .join("");

  updateTermFooter(tab);
  if (typeof updateTermInputBar === 'function') updateTermInputBar();
}

// â”€â”€ Close tab â”€â”€

function closeTab(id) {
  const idx = termState.tabs.findIndex((t) => t.id === id);

  if (idx === -1) return;

  stopTabStream(termState.tabs[idx]);

  termState.tabs.splice(idx, 1);

  termTabs.querySelector(`[data-id="${id}"]`)?.remove();

  if (!termState.tabs.length) {
    termPanel.style.display = "none";

    termState.activeId = null;

    termBody.innerHTML = "";

    return;
  }

  activateTab(termState.tabs[Math.min(idx, termState.tabs.length - 1)].id);
}

// â”€â”€ Stream â”€â”€

function startTabStream(tab) {
  stopTabStream(tab);

  tab.streaming = true;

  updateTabDot(tab);

  const previous = $("termPrevious").checked;

  const proto = location.protocol === "https:" ? "wss:" : "ws:";

  const ws = new WebSocket(`${proto}//${location.host}/ws/logs`);

  tab.ws = ws;

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        action: "start",
        namespace: tab.ns,
        pod: tab.pod,

        container: tab.container || null,
        previous,
        tailLines: 500,
      }),
    );

    pushLine(
      tab,
      `â–¶ Streaming ${tab.pod}${tab.container ? " / " + tab.container : ""}`,
      "sys",
    );
  });

  ws.addEventListener("message", (e) => {
    let msg;

    try {
      msg = JSON.parse(e.data);
    } catch (_) {
      return;
    }

    if (msg.type === "log") {
      appendTabLog(tab, msg.data);
      return;
    }

    if (msg.type === "error") pushLine(tab, "âœ– " + msg.data, "err");

    if (msg.type === "done") {
      tab.streaming = false;

      updateTabDot(tab);

      pushLine(tab, "â–  Stream ended", "sys");
    }
  });

  ws.addEventListener("close", () => {
    if (tab.ws !== ws) return;

    tab.ws = null;

    if (tab.streaming) {
      tab.streaming = false;
      updateTabDot(tab);
    }
  });

  ws.addEventListener("error", () => {
    pushLine(tab, "âœ– WebSocket connection error", "err");

    tab.streaming = false;

    updateTabDot(tab);
  });
}

function stopTabStream(tab) {
  if (tab.ws) {
    try {
      tab.ws.send(JSON.stringify({ action: "stop" }));
    } catch (_) {}

    try {
      tab.ws.close();
    } catch (_) {}

    tab.ws = null;
  }

  tab.streaming = false;

  updateTabDot(tab);
}

// â”€â”€ Append lines â”€â”€

function appendTabLog(tab, raw) {
  raw.split("\n").forEach((line) => {
    if (!line.trim()) return;

    let cls = "";

    if (/error|exception|fatal|panic/i.test(line)) cls = "err";
    else if (/warn/i.test(line)) cls = "warn";
    else if (/\b(info|debug)\b/i.test(line)) cls = "info";

    pushLine(tab, line, cls);
  });
}

function pushLine(tab, text, cls) {
  const now = new Date();

  const ts = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, "0")}`;

  const html = `<div class="term-line${cls ? " " + cls : ""}"><span class="ts">${ts}</span>${escHtml(text)}</div>`;

  tab.lines.push(html);

  tab.lineCount++;

  // If this tab is active, append directly into the visible DOM

  if (termState.activeId === tab.id) {
    const atBot =
      termBody.scrollHeight - termBody.scrollTop <= termBody.clientHeight + 80;

    termBody.insertAdjacentHTML("beforeend", html);

    if (atBot) termBody.scrollTop = termBody.scrollHeight;

    updateTermFooter(tab);
  }
}

// â”€â”€ UI helpers â”€

function updateTabDot(tab) {
  const el = termTabs.querySelector(`[data-id="${tab.id}"] .tab-dot`);

  if (el) el.className = `tab-dot${tab.streaming ? " streaming" : " stopped"}`;
}

function updateTermFooter(tab) {
  if (!tab) tab = termState.tabs.find((t) => t.id === termState.activeId);

  if (!tab) return;

  $("termStatus").textContent = tab.streaming
    ? `â— Streaming  ${tab.pod}`
    : `â–  Stopped`;

  $("termLineCount").textContent = `${tab.lineCount} lines`;
}

// â”€â”€ Panel controls

$("termContainerSel").addEventListener("change", () => {
  const tab = termState.tabs.find((t) => t.id === termState.activeId);

  if (!tab) return;

  tab.container = $("termContainerSel").value;

  tab.lines = [];

  tab.lineCount = 0;

  termBody.innerHTML = "";

  startTabStream(tab);
});

$("termPrevious").addEventListener("change", () => {
  const tab = termState.tabs.find((t) => t.id === termState.activeId);

  if (!tab) return;

  tab.lines = [];
  tab.lineCount = 0;

  termBody.innerHTML = "";

  startTabStream(tab);
});

$("termClearBtn").addEventListener("click", () => {
  const tab = termState.tabs.find((t) => t.id === termState.activeId);

  if (!tab) return;

  tab.lines = [];
  tab.lineCount = 0;

  termBody.innerHTML = "";

  updateTermFooter(tab);
});

$("termWrapBtn").addEventListener("click", () => {
  termState.wrap = !termState.wrap;

  termBody.classList.toggle("wrap", termState.wrap);

  $("termWrapBtn").classList.toggle("primary", termState.wrap);
});

$("termScrollBtn").addEventListener("click", () => {
  termBody.scrollTop = termBody.scrollHeight;
});

$("termStopBtn").addEventListener("click", () => {
  const tab = termState.tabs.find((t) => t.id === termState.activeId);

  if (tab) stopTabStream(tab);
});

$("termMinBtn").addEventListener("click", () => {
  termPanel.classList.toggle("minimised");

  $("termMinBtn").textContent = termPanel.classList.contains("minimised")
    ? "â–¡"
    : "â”€";
});

$("termCloseBtn").addEventListener("click", () => {
  [...termState.tabs].forEach((t) => stopTabStream(t));

  termState.tabs.length = 0;

  termTabs.innerHTML = "";

  termBody.innerHTML = "";

  termPanel.style.display = "none";

  termState.activeId = null;
});

$("termNewWindowBtn").addEventListener("click", () => {
  const tab = termState.tabs.find((t) => t.id === termState.activeId);

  if (!tab) return;

  const text = tab.lines
    .map((html) => {
      const tmp = document.createElement("div");

      tmp.innerHTML = html;

      return tmp.textContent;
    })
    .join("\n");

  const win = window.open("", "_blank", "width=960,height=640");

  if (!win) {
    toast("Pop-up blocked", "warn");
    return;
  }

  win.document.write(
    `<html><head><title>Logs â€“ ${escHtml(tab.pod)}</title>` +
      `<style>body{background:#111;color:#ccc;font:12px/1.6 monospace;` +
      `white-space:pre-wrap;word-break:break-all;padding:14px;margin:0}</style>` +
      `</head><body>${escHtml(text)}</body></html>`,
  );

  win.document.close();
});

// â”€â”€ Resize handle â”€

(function initResize() {
  const handle = $("termResizeHandle");

  let startY = 0,
    startH = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();

    startY = e.clientY;

    startH = termPanel.offsetHeight;

    document.body.style.userSelect = "none";

    document.addEventListener("mousemove", onMove);

    document.addEventListener("mouseup", onUp);
  });

  function onMove(e) {
    const delta = startY - e.clientY;

    const newH = Math.max(
      120,
      Math.min(window.innerHeight * 0.8, startH + delta),
    );

    termPanel.style.height = newH + "px";
  }

  function onUp() {
    document.body.style.userSelect = "";

    document.removeEventListener("mousemove", onMove);

    document.removeEventListener("mouseup", onUp);
  }
})();


// --- Exec / Interactive Shell ------------------------------------------------

window.openExec = function(ns, pod, containers) {
  const existing = termState.tabs.find(t => t.pod === pod && t.ns === ns && t.type === 'exec');
  if (existing) { activateTab(existing.id); return; }
  const id  = 'tab-' + Date.now();
  const tab = {
    id, ns, pod, type: 'exec',
    containers: containers || [],
    container:  containers ? containers[0] : null,
    ws: null, lines: [], lineCount: 0, streaming: false,
  };
  termState.tabs.push(tab);
  const tabEl = document.createElement('div');
  tabEl.className = 'term-tab exec-tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML =
    '<span class="tab-dot streaming"></span>' +
    '<span class="tab-label" title="' + escHtml(pod) + '">\u2328 ' + escHtml(pod) + '</span>' +
    '<button class="tab-close" title="Close">\u2715</button>';
  tabEl.addEventListener('click', e => {
    if (!e.target.classList.contains('tab-close')) activateTab(id);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', e => {
    e.stopPropagation();
    closeTab(id);
  });
  termTabs.appendChild(tabEl);
  termPanel.style.display = 'flex';
  activateTab(id);
  startExecStream(tab);
};

function startExecStream(tab) {
  stopTabStream(tab);
  tab.streaming = true;
  updateTabDot(tab);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/exec');
  tab.ws = ws;
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      action: 'start',
      namespace: tab.ns, pod: tab.pod,
      container: tab.container || null,
      command: ['/bin/sh'],
    }));
    pushLine(tab, '\u25b6 Conectando shell: ' + tab.pod + (tab.container ? ' / ' + tab.container : ''), 'sys');
  });
  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch(_) { return; }
    if (msg.type === 'out') { appendExecOutput(tab, msg.data, '');    return; }
    if (msg.type === 'err') { appendExecOutput(tab, msg.data, 'err'); return; }
    if (msg.type === 'connected') { pushLine(tab, '\u25b6 Shell lista', 'sys'); updateTermInputBar(); return; }
    if (msg.type === 'error') { pushLine(tab, '\u2716 ' + msg.data, 'err'); }
    if (msg.type === 'done')  {
      tab.streaming = false; updateTabDot(tab);
      pushLine(tab, '\u25aa Sesion terminada', 'sys');
      updateTermInputBar();
    }
  });
  ws.addEventListener('close', () => {
    if (tab.ws !== ws) return;
    tab.ws = null;
    if (tab.streaming) { tab.streaming = false; updateTabDot(tab); }
    updateTermInputBar();
  });
  ws.addEventListener('error', () => {
    pushLine(tab, '\u2716 WebSocket error', 'err');
    tab.streaming = false; updateTabDot(tab); updateTermInputBar();
  });
}

function appendExecOutput(tab, raw, cls) {
  raw.split(/\r?\n/).forEach(line => {
    // Strip basic ANSI escape sequences
    const clean = line.replace(/\x1b\[[0-9;]*[mGKH]/g, '').replace(/\r/g, '');
    if (clean) pushLine(tab, clean, cls);
  });
}

function updateTermInputBar() {
  const tab      = termState.tabs.find(t => t.id === termState.activeId);
  const inputBar = $('termInputBar');
  if (!inputBar) return;
  const show = !!(tab && tab.type === 'exec' && tab.streaming);
  inputBar.style.display = show ? 'flex' : 'none';
  if (show) $('termInput').focus();
}

// Input bar – send on Enter
$('termInput').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const tab = termState.tabs.find(t => t.id === termState.activeId);
  if (!tab || !tab.ws || tab.ws.readyState !== 1) return;
  const val = $('termInput').value;
  tab.ws.send(JSON.stringify({ action: 'stdin', data: val + '\n' }));
  $('termInput').value = '';
});

// Ctrl+C button
$('termSendCtrlCBtn').addEventListener('click', () => {
  const tab = termState.tabs.find(t => t.id === termState.activeId);
  if (!tab || !tab.ws || tab.ws.readyState !== 1) return;
  tab.ws.send(JSON.stringify({ action: 'stdin', data: '\x03' }));
});

//  Kubeconfig Import â”€â”€

$("importKubeconfigBtn").addEventListener("click", () => {
  $("kubeconfigEditor").value = "";

  $("kubeconfigImportError").textContent = "";

  openModal("kubeconfigOverlay");
});

$("closeKubeconfigModal").addEventListener("click", () =>
  closeModal("kubeconfigOverlay"),
);

// Drag & drop a .yaml / .yml file onto the textarea

$("kubeconfigEditor").addEventListener("dragover", (e) => {
  e.preventDefault();

  $("kubeconfigEditor").classList.add("drag-over");
});

$("kubeconfigEditor").addEventListener("dragleave", () =>
  $("kubeconfigEditor").classList.remove("drag-over"),
);

$("kubeconfigEditor").addEventListener("drop", (e) => {
  e.preventDefault();

  $("kubeconfigEditor").classList.remove("drag-over");

  const file = e.dataTransfer.files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = (ev) => {
    $("kubeconfigEditor").value = ev.target.result;
  };

  reader.readAsText(file);
});

$("confirmImportKubeconfigBtn").addEventListener("click", async () => {
  const yamlContent = $("kubeconfigEditor").value.trim();

  const errEl = $("kubeconfigImportError");

  errEl.textContent = "";

  if (!yamlContent) {
    errEl.textContent = "Paste or drop a kubeconfig YAML first.";
    return;
  }

  try {
    const result = await api("POST", "/api/kubeconfig/import", { yamlContent });

    closeModal("kubeconfigOverlay");

    toast(
      `Imported ${result.added} context(s): ${result.contexts.join(", ")}`,
      "success",
    );

    await loadContexts();
  } catch (e) {
    errEl.textContent = e.message;
  }
});

//  Modal helpers

function openModal(id) {
  $(id).classList.add("open");
}

function closeModal(id) {
  $(id).classList.remove("open");
}

[
  "yamlOverlay",
  "scaleOverlay",
  "deleteOverlay",
  "drainOverlay",
  "kubeconfigOverlay",
].forEach((id) => {
  $(id)?.addEventListener("click", (e) => {
    if (e.target === $(id)) closeModal(id);
  });
});

//  Toast â”€â”€

function toast(msg, type = "info", duration = 4000) {
  const el = document.createElement("div");

  el.className = `toast ${type}`;

  el.textContent = msg;

  $("toasts").appendChild(el);

  setTimeout(() => el.remove(), duration);
}

//  Status bar clock

function updateClock() {
  $("sbClock").textContent = new Date().toLocaleTimeString("en-GB", {
    hour12: false,
  });
}

updateClock();

setInterval(updateClock, 1000);

function updateStatusBar() {
  $("sbContext").textContent = `âŽˆ ${$("contextSelect").value || "â€“"}`;

  $("sbNamespace").textContent = `ns: ${state.namespace}`;

  $("sbResource").textContent = state.resource;

  $("sbCount").textContent = `${state.rows.length} items`;
}

//  Auto-refresh every 30 s â”€â”€

setInterval(loadResources, 30000);

function closeAllModals() {
  [
    'yamlOverlay',
    'scaleOverlay',
    'deleteOverlay',
    'drainOverlay',
    'kubeconfigOverlay',
    'portForwardOverlay',
    'deleteContextOverlay',
  ].forEach(closeModal);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadContexts();

  await loadNamespaces();

  await loadResources();

  await pfAutoRestore();

  if (window.lucide) lucide.createIcons();
})();

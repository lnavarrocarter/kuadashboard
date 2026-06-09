<template>
  <div class="cloud-view">

    <!-- No profile -->
    <div v-if="!selectedProfileId" class="empty-state">
      Select a GCP credential profile in the top header to load resources.<br />
      <span class="text-dim">No profile? Use the <strong>Env Manager</strong> button (key icon) to create one.</span>
    </div>

    <template v-else>

      <!-- Toolbar -->
      <div class="aws-toolbar">
        <input v-model="search" class="ctrl-input aws-search" placeholder="Filter..." />
        <span class="text-dim" style="font-size:12px">
          <template v-if="currentTab.loading">Loading...</template>
          <template v-else>{{ filteredRows.length }} result{{ filteredRows.length !== 1 ? 's' : '' }}</template>
        </span>
        <button class="btn sm" @click="reloadActiveTab" :disabled="currentTab.loading" title="Refresh"><i data-lucide="refresh-cw"></i></button>
      </div>

      <!-- Permission denied banner -->
      <div v-if="currentTab.error" class="api-disabled-banner">
        <span>{{ currentTab.error }}</span>
        <a v-if="currentTab.enableUrl" :href="currentTab.enableUrl" target="_blank"
           class="btn sm" style="margin-left:12px;white-space:nowrap;flex-shrink:0">
          Enable API
        </a>
      </div>

      <!-- Cloud Run -->
      <div v-show="activeTab === 'cloudrun'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div v-if="gcpStore.tabs.cloudrun.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.cloudrun.error && !filteredCloudRun.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredCloudRun.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Run services found.' }}</div>
        <div v-else style="display:flex;flex:1;overflow:hidden">
          <!-- LEFT: service list -->
          <div style="width:260px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
            <div v-for="svc in filteredCloudRun" :key="svc.name"
              :class="['sidebar-item', crPanel.resource?.name === svc.name ? 'active' : '']"
              style="cursor:pointer" @click="selectCloudRun(svc)">
              <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ svc.name }}</div>
              <div class="text-dim" style="font-size:10px">{{ svc.region }}</div>
              <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                <span :class="statusClass(svc.status)" style="font-size:10px">{{ svc.status }}</span>
                <span class="text-dim" style="font-size:10px">min: {{ svc.minInstances }} / max: {{ svc.maxInstances ?? '∞' }}</span>
              </div>
            </div>
          </div>
          <!-- RIGHT: detail -->
          <div v-if="!crPanel.resource" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px">Select a service to see details</div>
          <div v-else style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <!-- Header -->
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ crPanel.resource.name }}</div>
                <span :class="statusClass(crPanel.resource.status)" style="font-size:11px">{{ crPanel.resource.status }}</span>
                <a v-if="crPanel.resource.uri" :href="crPanel.resource.uri" target="_blank" class="link" style="font-size:11px">↗ Open URL</a>
                <div style="margin-left:auto;display:flex;gap:6px">
                  <button class="btn sm" @click="startCloudRun(crPanel.resource)">▶ Start</button>
                  <button class="btn sm danger" @click="stopCloudRun(crPanel.resource)">■ Stop</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ crPanel.resource.region }}</div>
            </div>
            <!-- Tabs -->
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in [{id:'overview',label:'Overview'},{id:'revisions',label:'Revisions'},{id:'variables',label:'Variables'},{id:'logs',label:'Logs'},{id:'metrics',label:'Metrics'}]" :key="t.id"
                :class="['aws-tab-btn', crPanel.tab === t.id ? 'active' : '']" @click="crSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- OVERVIEW -->
            <div v-show="crPanel.tab === 'overview'" style="flex:1;overflow:auto;padding:16px">
              <div v-if="crPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="crPanel.detailError" class="alert-error">{{ crPanel.detailError }}</div>
              <div v-else-if="crPanel.detail" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Service</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">URL</span><a :href="crPanel.detail.uri" target="_blank" class="link mono-xs">{{ crPanel.detail.uri }}</a></div>
                    <div class="kv-row"><span class="kv-k">Region</span><span>{{ crPanel.detail.region }}</span></div>
                    <div class="kv-row"><span class="kv-k">Status</span><span :class="statusClass(crPanel.detail.status)">{{ crPanel.detail.status }}</span></div>
                    <div class="kv-row"><span class="kv-k">Ingress</span><span class="text-dim">{{ crPanel.detail.ingressTraffic || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Created</span><span class="text-dim">{{ crPanel.detail.created ? new Date(crPanel.detail.created).toLocaleString() : '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Updated</span><span class="text-dim">{{ crPanel.detail.updated ? new Date(crPanel.detail.updated).toLocaleString() : '--' }}</span></div>
                  </div>
                </div>
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Container</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Image</span><span class="mono-xs text-dim" style="word-break:break-all">{{ crPanel.detail.image || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">CPU</span><span class="text-dim">{{ crPanel.detail.cpu || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Memory</span><span class="text-dim">{{ crPanel.detail.memory || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Port</span><span class="text-dim">{{ crPanel.detail.port || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Min instances</span><span class="text-dim">{{ crPanel.detail.minInstances }}</span></div>
                    <div class="kv-row"><span class="kv-k">Max instances</span><span class="text-dim">{{ crPanel.detail.maxInstances ?? '∞' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Service Account</span><span class="mono-xs text-dim" style="word-break:break-all">{{ crPanel.detail.serviceAccount || '--' }}</span></div>
                  </div>
                </div>
              </div>
            </div>
            <!-- REVISIONS -->
            <div v-show="crPanel.tab === 'revisions'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="crPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="!crPanel.detail?.revisions?.length" class="empty-row">No revisions found.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Revision</th><th>Traffic</th><th>Created</th><th>Status</th></tr></thead>
                <tbody>
                  <tr v-for="r in crPanel.detail.revisions" :key="r.name">
                    <td class="mono-xs">{{ r.name }}</td>
                    <td>
                      <span v-if="r.traffic != null" style="font-size:12px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:1px 8px;color:#818cf8">{{ r.traffic }}%</span>
                      <span v-else class="text-dim">—</span>
                    </td>
                    <td class="text-dim" style="font-size:11px">{{ r.created ? new Date(r.created).toLocaleString() : '--' }}</td>
                    <td><span :class="r.ready ? 'status-ok' : 'status-warn'">{{ r.ready ? 'Ready' : 'Pending' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- VARIABLES -->
            <div v-show="crPanel.tab === 'variables'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="crPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="!crPanel.detail?.envVars?.length" class="empty-row">No environment variables configured.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Name</th><th>Value</th></tr></thead>
                <tbody>
                  <tr v-for="v in crPanel.detail.envVars" :key="v.name">
                    <td class="mono-xs" style="font-weight:600">{{ v.name }}</td>
                    <td class="mono-xs text-dim">{{ v.value || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- LOGS -->
            <div v-show="crPanel.tab === 'logs'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center">
                <select v-model="crPanel.logsHours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option><option :value="72">Last 3d</option>
                </select>
                <button class="btn sm" @click="crLoadLogs()" :disabled="crPanel.logsLoading">{{ crPanel.logsLoading ? 'Loading...' : 'Refresh' }}</button>
                <span class="text-dim" style="font-size:11px">{{ crPanel.logs.length }} entries</span>
              </div>
              <div v-if="crPanel.logsLoading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading logs...</div>
              <div v-else-if="crPanel.logsError" class="alert-error" style="margin:12px">{{ crPanel.logsError }}</div>
              <div v-else-if="!crPanel.logs.length" class="empty-row">No log entries in this time range.</div>
              <div v-else style="flex:1;overflow:auto;padding:0 8px">
                <div v-for="(e, i) in crPanel.logs" :key="i" style="display:flex;gap:8px;padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;font-family:monospace">
                  <span :style="`flex-shrink:0;width:58px;font-size:10px;${gcpLogColor(e.severity)}`">{{ (e.severity||'DEFAULT').slice(0,7) }}</span>
                  <span class="text-dim" style="flex-shrink:0;white-space:nowrap">{{ e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '' }}</span>
                  <span style="flex:1;word-break:break-all;white-space:pre-wrap">{{ e.message }}</span>
                </div>
              </div>
            </div>
            <!-- METRICS -->
            <div v-show="crPanel.tab === 'metrics'" style="flex:1;overflow:auto;padding:12px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
                <select v-model="crMetrics.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option>
                </select>
                <button class="btn sm" @click="loadMetrics(crMetrics, CR_METRICS, crPanel.resource)" :disabled="crMetrics.loading">{{ crMetrics.loading ? 'Loading...' : 'Refresh' }}</button>
              </div>
              <div v-if="crMetrics.loading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading metrics...</div>
              <div v-else-if="crMetrics.error" class="alert-error">{{ crMetrics.error }}</div>
              <div v-else style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <GcpMetricsChart v-for="m in CR_METRICS" :key="m.key" :label="m.label" :unit="m.unit" :points="crMetrics.data[m.key] || []" :color="m.color" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- GKE -->
      <div v-show="activeTab === 'gke'" class="tab-panel">
        <div v-if="gcpStore.tabs.gke.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.gke.error && !filteredGke.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredGke.length" class="empty-row">{{ search ? 'No matches.' : 'No GKE clusters found.' }}</div>
        <table v-else class="cloud-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Location</th>
              <th>Type</th>
              <th>Version</th>
              <th>Nodes / Pools</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in filteredGke" :key="c.name">
              <td class="gke-name">{{ c.name }}</td>
              <td class="text-dim">{{ c.location }}</td>
              <td>
                <span :class="c.autopilot ? 'badge-autopilot' : 'badge-standard'">
                  {{ c.autopilot ? 'Autopilot' : 'Standard' }}
                </span>
              </td>
              <td class="text-dim">{{ c.version ? c.version.split('-')[0] : '--' }}</td>
              <td class="text-dim">
                {{ c.autopilot ? '— (managed)' : `${c.nodeCount ?? 0} (${c.nodePoolCount ?? 0} pool${c.nodePoolCount !== 1 ? 's' : ''})` }}
              </td>
              <td class="text-dim">{{ c.releaseChannel ? c.releaseChannel.replace('_', ' ').toLowerCase() : '--' }}</td>
              <td><span :class="gkeStatusClass(c.status)">{{ c.status }}</span></td>
              <td>
                <button
                  class="btn sm primary gke-connect-btn"
                  :disabled="c.status !== 'RUNNING' || connectingCluster === c.name"
                  @click="connectGke(c)"
                  title="Import this cluster's kubeconfig and switch to it in KUA"
                >
                  <i data-lucide="plug"></i>
                  {{ connectingCluster === c.name ? 'Connecting…' : 'Connect' }}
                </button>
                <button class="btn sm" @click="openLogs('gke', c)"><i data-lucide="scroll-text"></i> Logs</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Compute VMs -->
      <div v-show="activeTab === 'vms'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div v-if="gcpStore.tabs.vms.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.vms.error && !filteredVms.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredVms.length" class="empty-row">{{ search ? 'No matches.' : 'No Compute Engine VMs found.' }}</div>
        <div v-else style="display:flex;flex:1;overflow:hidden">
          <!-- LEFT -->
          <div style="width:240px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
            <div v-for="vm in filteredVms" :key="`${vm.zone}/${vm.name}`"
              :class="['sidebar-item', vmPanel.resource?.name === vm.name && vmPanel.resource?.zone === vm.zone ? 'active' : '']"
              style="cursor:pointer" @click="selectVm(vm)">
              <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ vm.name }}</div>
              <div class="text-dim" style="font-size:10px">{{ vm.zone }}</div>
              <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
                <span :class="vmStatusClass(vm.status)" style="font-size:10px">{{ vm.status }}</span>
                <span class="text-dim" style="font-size:10px">{{ vm.machineType }}</span>
              </div>
            </div>
          </div>
          <!-- RIGHT -->
          <div v-if="!vmPanel.resource" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px">Select a VM to see details</div>
          <div v-else style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ vmPanel.resource.name }}</div>
                <span :class="vmStatusClass(vmPanel.resource.status)" style="font-size:11px">{{ vmPanel.resource.status }}</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                  <button class="btn sm" @click="startVM(vmPanel.resource)" :disabled="vmPanel.resource.status === 'RUNNING'">▶ Start</button>
                  <button class="btn sm danger" @click="stopVM(vmPanel.resource)" :disabled="vmPanel.resource.status === 'TERMINATED'">■ Stop</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ vmPanel.resource.zone }} · {{ vmPanel.resource.machineType }}</div>
            </div>
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in [{id:'overview',label:'Overview'},{id:'disks',label:'Disks'},{id:'network',label:'Network'},{id:'logs',label:'Logs'},{id:'metrics',label:'Metrics'}]" :key="t.id"
                :class="['aws-tab-btn', vmPanel.tab === t.id ? 'active' : '']" @click="vmSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- OVERVIEW -->
            <div v-show="vmPanel.tab === 'overview'" style="flex:1;overflow:auto;padding:16px">
              <div v-if="vmPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="vmPanel.detailError" class="alert-error">{{ vmPanel.detailError }}</div>
              <div v-else-if="vmPanel.detail" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Instance</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Status</span><span :class="vmStatusClass(vmPanel.detail.status)">{{ vmPanel.detail.status }}</span></div>
                    <div class="kv-row"><span class="kv-k">Zone</span><span class="text-dim">{{ vmPanel.detail.zone }}</span></div>
                    <div class="kv-row"><span class="kv-k">Machine Type</span><span class="text-dim">{{ vmPanel.detail.machineType }}</span></div>
                    <div class="kv-row"><span class="kv-k">CPU Platform</span><span class="text-dim">{{ vmPanel.detail.cpuPlatform || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Deletion Protection</span><span :class="vmPanel.detail.deletionProtection ? 'status-ok' : 'status-warn'">{{ vmPanel.detail.deletionProtection ? 'Enabled' : 'Disabled' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Created</span><span class="text-dim">{{ vmPanel.detail.created ? new Date(vmPanel.detail.created).toLocaleString() : '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Service Account</span><span class="mono-xs text-dim" style="word-break:break-all">{{ vmPanel.detail.serviceAccount || '--' }}</span></div>
                  </div>
                </div>
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Tags &amp; Labels</div>
                  <div v-if="vmPanel.detail.tags?.length" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
                    <span v-for="tag in vmPanel.detail.tags" :key="tag" style="font-size:10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:1px 7px;color:#818cf8">{{ tag }}</span>
                  </div>
                  <div v-else class="text-dim" style="font-size:12px;margin-bottom:8px">No tags</div>
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px;margin-top:4px">Labels</div>
                  <div v-if="Object.keys(vmPanel.detail.labels || {}).length" style="display:flex;flex-wrap:wrap;gap:4px">
                    <span v-for="(v, k) in vmPanel.detail.labels" :key="k" style="font-size:10px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);border-radius:10px;padding:1px 7px;color:#34d399">{{ k }}={{ v }}</span>
                  </div>
                  <div v-else class="text-dim" style="font-size:12px">No labels</div>
                </div>
              </div>
            </div>
            <!-- DISKS -->
            <div v-show="vmPanel.tab === 'disks'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="vmPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="!vmPanel.detail?.disks?.length" class="empty-row">No disks found.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Name</th><th>Type</th><th>Mode</th><th>Boot</th></tr></thead>
                <tbody>
                  <tr v-for="d in vmPanel.detail.disks" :key="d.source">
                    <td class="mono-xs">{{ d.source?.split('/').pop() || d.source }}</td>
                    <td class="text-dim">{{ d.type || '--' }}</td>
                    <td class="text-dim">{{ d.mode || '--' }}</td>
                    <td><span :class="d.boot ? 'status-ok' : 'text-dim'">{{ d.boot ? 'Yes' : 'No' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- NETWORK -->
            <div v-show="vmPanel.tab === 'network'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="vmPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="!vmPanel.detail?.networks?.length" class="empty-row">No network interfaces found.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Network</th><th>Subnetwork</th><th>Internal IP</th><th>External IP</th></tr></thead>
                <tbody>
                  <tr v-for="n in vmPanel.detail.networks" :key="n.network">
                    <td class="mono-xs">{{ n.network?.split('/').pop() || n.network }}</td>
                    <td class="mono-xs text-dim">{{ n.subnetwork?.split('/').pop() || n.subnetwork }}</td>
                    <td class="text-dim">{{ n.networkIP || '--' }}</td>
                    <td class="text-dim">{{ n.accessConfigs?.[0]?.natIP || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- LOGS -->
            <div v-show="vmPanel.tab === 'logs'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center">
                <select v-model="vmPanel.logsHours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option><option :value="72">Last 3d</option>
                </select>
                <button class="btn sm" @click="vmLoadLogs()" :disabled="vmPanel.logsLoading">{{ vmPanel.logsLoading ? 'Loading...' : 'Refresh' }}</button>
                <span class="text-dim" style="font-size:11px">{{ vmPanel.logs.length }} entries</span>
              </div>
              <div v-if="vmPanel.logsLoading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading logs...</div>
              <div v-else-if="vmPanel.logsError" class="alert-error" style="margin:12px">{{ vmPanel.logsError }}</div>
              <div v-else-if="!vmPanel.logs.length" class="empty-row">No log entries in this time range.</div>
              <div v-else style="flex:1;overflow:auto;padding:0 8px">
                <div v-for="(e, i) in vmPanel.logs" :key="i" style="display:flex;gap:8px;padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;font-family:monospace">
                  <span :style="`flex-shrink:0;width:58px;font-size:10px;${gcpLogColor(e.severity)}`">{{ (e.severity||'DEFAULT').slice(0,7) }}</span>
                  <span class="text-dim" style="flex-shrink:0;white-space:nowrap">{{ e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '' }}</span>
                  <span style="flex:1;word-break:break-all;white-space:pre-wrap">{{ e.message }}</span>
                </div>
              </div>
            </div>
            <!-- METRICS -->
            <div v-show="vmPanel.tab === 'metrics'" style="flex:1;overflow:auto;padding:12px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
                <select v-model="vmMetrics.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option>
                </select>
                <button class="btn sm" @click="vmSwitchTab('metrics')" :disabled="vmMetrics.loading">{{ vmMetrics.loading ? 'Loading...' : 'Refresh' }}</button>
                <span v-if="!vmPanel.detail?.instanceId" class="text-dim" style="font-size:11px">⚠ Load Overview tab first to get instance ID for metrics</span>
              </div>
              <div v-if="vmMetrics.loading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading metrics...</div>
              <div v-else-if="vmMetrics.error" class="alert-error">{{ vmMetrics.error }}</div>
              <div v-else style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <GcpMetricsChart v-for="m in VM_METRICS" :key="m.key" :label="m.label" :unit="m.unit" :points="vmMetrics.data[m.key] || []" :color="m.color" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cloud SQL -->
      <div v-show="activeTab === 'sql'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div v-if="gcpStore.tabs.sql.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.sql.error && !filteredSql.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredSql.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud SQL instances found.' }}</div>
        <div v-else style="display:flex;flex:1;overflow:hidden">
          <!-- LEFT -->
          <div style="width:240px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
            <div v-for="inst in filteredSql" :key="inst.name"
              :class="['sidebar-item', sqlPanel.resource?.name === inst.name ? 'active' : '']"
              style="cursor:pointer" @click="selectSql(inst)">
              <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ inst.name }}</div>
              <div class="text-dim" style="font-size:10px">{{ inst.database }} · {{ inst.region }}</div>
              <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
                <span :class="sqlStatusClass(inst.state)" style="font-size:10px">{{ inst.state }}</span>
                <span class="text-dim" style="font-size:10px">{{ inst.tier }}</span>
              </div>
            </div>
          </div>
          <!-- RIGHT -->
          <div v-if="!sqlPanel.resource" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px">Select an instance to see details</div>
          <div v-else style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ sqlPanel.resource.name }}</div>
                <span :class="sqlStatusClass(sqlPanel.resource.state)" style="font-size:11px">{{ sqlPanel.resource.state }}</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                  <button class="btn sm" @click="startSql(sqlPanel.resource)" :disabled="sqlPanel.resource.state === 'RUNNABLE'">▶ Start</button>
                  <button class="btn sm danger" @click="stopSql(sqlPanel.resource)" :disabled="sqlPanel.resource.state !== 'RUNNABLE'">■ Stop</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ sqlPanel.resource.database }} · {{ sqlPanel.resource.region }} · {{ sqlPanel.resource.tier }}</div>
            </div>
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in [{id:'overview',label:'Overview'},{id:'config',label:'Config'},{id:'connection',label:'Connection'},{id:'logs',label:'Logs'},{id:'metrics',label:'Metrics'}]" :key="t.id"
                :class="['aws-tab-btn', sqlPanel.tab === t.id ? 'active' : '']" @click="sqlSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- OVERVIEW -->
            <div v-show="sqlPanel.tab === 'overview'" style="flex:1;overflow:auto;padding:16px">
              <div v-if="sqlPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="sqlPanel.detailError" class="alert-error">{{ sqlPanel.detailError }}</div>
              <div v-else-if="sqlPanel.detail" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Instance</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Database</span><span class="text-dim">{{ sqlPanel.detail.database }}</span></div>
                    <div class="kv-row"><span class="kv-k">Region</span><span class="text-dim">{{ sqlPanel.detail.region }}</span></div>
                    <div class="kv-row"><span class="kv-k">Zone</span><span class="text-dim">{{ sqlPanel.detail.zone }}</span></div>
                    <div class="kv-row"><span class="kv-k">State</span><span :class="sqlStatusClass(sqlPanel.detail.state)">{{ sqlPanel.detail.state }}</span></div>
                    <div class="kv-row"><span class="kv-k">Availability</span><span class="text-dim">{{ sqlPanel.detail.availabilityType || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Created</span><span class="text-dim">{{ sqlPanel.detail.created ? new Date(sqlPanel.detail.created).toLocaleString() : '--' }}</span></div>
                  </div>
                </div>
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Backup</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Enabled</span><span :class="sqlPanel.detail.backupEnabled ? 'status-ok' : 'status-warn'">{{ sqlPanel.detail.backupEnabled ? 'Yes' : 'No' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Backup Time</span><span class="text-dim">{{ sqlPanel.detail.backupTime || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Maintenance</span><span class="text-dim">{{ sqlPanel.detail.maintenanceWindow || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Activation</span><span class="text-dim">{{ sqlPanel.detail.activationPolicy || '--' }}</span></div>
                  </div>
                </div>
              </div>
            </div>
            <!-- CONFIG -->
            <div v-show="sqlPanel.tab === 'config'" style="flex:1;overflow:auto;padding:16px">
              <div v-if="sqlPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="sqlPanel.detail" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Storage</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Tier</span><span class="text-dim">{{ sqlPanel.detail.tier }}</span></div>
                    <div class="kv-row"><span class="kv-k">Storage Type</span><span class="text-dim">{{ sqlPanel.detail.storageType }}</span></div>
                    <div class="kv-row"><span class="kv-k">Storage GB</span><span class="text-dim">{{ sqlPanel.detail.storageGb }}</span></div>
                    <div class="kv-row"><span class="kv-k">Auto Resize</span><span :class="sqlPanel.detail.storageAutoResize ? 'status-ok' : 'text-dim'">{{ sqlPanel.detail.storageAutoResize ? 'Enabled' : 'Disabled' }}</span></div>
                  </div>
                </div>
                <div v-if="sqlPanel.detail.flags?.length" style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Database Flags</div>
                  <div class="kv-list">
                    <div class="kv-row" v-for="f in sqlPanel.detail.flags" :key="f.name"><span class="kv-k mono-xs">{{ f.name }}</span><span class="text-dim">{{ f.value || 'on' }}</span></div>
                  </div>
                </div>
              </div>
            </div>
            <!-- CONNECTION -->
            <div v-show="sqlPanel.tab === 'connection'" style="flex:1;overflow:auto;padding:16px">
              <div v-if="sqlPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="sqlPanel.detail" style="display:grid;gap:16px">
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Connection</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Connection Name</span><span class="mono-xs text-dim">{{ sqlPanel.detail.connectionName || '--' }}</span></div>
                  </div>
                </div>
                <div v-if="sqlPanel.detail.ipAddresses?.length" style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">IP Addresses</div>
                  <table class="cloud-table">
                    <thead><tr><th>Type</th><th>IP Address</th></tr></thead>
                    <tbody>
                      <tr v-for="ip in sqlPanel.detail.ipAddresses" :key="ip.ipAddress">
                        <td class="text-dim">{{ ip.type || '--' }}</td>
                        <td class="mono-xs">{{ ip.ipAddress }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <!-- LOGS -->
            <div v-show="sqlPanel.tab === 'logs'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center">
                <select v-model="sqlPanel.logsHours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option><option :value="72">Last 3d</option>
                </select>
                <button class="btn sm" @click="sqlLoadLogs()" :disabled="sqlPanel.logsLoading">{{ sqlPanel.logsLoading ? 'Loading...' : 'Refresh' }}</button>
                <span class="text-dim" style="font-size:11px">{{ sqlPanel.logs.length }} entries</span>
              </div>
              <div v-if="sqlPanel.logsLoading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading logs...</div>
              <div v-else-if="sqlPanel.logsError" class="alert-error" style="margin:12px">{{ sqlPanel.logsError }}</div>
              <div v-else-if="!sqlPanel.logs.length" class="empty-row">No log entries in this time range.</div>
              <div v-else style="flex:1;overflow:auto;padding:0 8px">
                <div v-for="(e, i) in sqlPanel.logs" :key="i" style="display:flex;gap:8px;padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;font-family:monospace">
                  <span :style="`flex-shrink:0;width:58px;font-size:10px;${gcpLogColor(e.severity)}`">{{ (e.severity||'DEFAULT').slice(0,7) }}</span>
                  <span class="text-dim" style="flex-shrink:0;white-space:nowrap">{{ e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '' }}</span>
                  <span style="flex:1;word-break:break-all;white-space:pre-wrap">{{ e.message }}</span>
                </div>
              </div>
            </div>
            <!-- METRICS -->
            <div v-show="sqlPanel.tab === 'metrics'" style="flex:1;overflow:auto;padding:12px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
                <select v-model="sqlMetrics.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option>
                </select>
                <button class="btn sm" @click="loadMetrics(sqlMetrics, SQL_METRICS, sqlPanel.resource)" :disabled="sqlMetrics.loading">{{ sqlMetrics.loading ? 'Loading...' : 'Refresh' }}</button>
              </div>
              <div v-if="sqlMetrics.loading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading metrics...</div>
              <div v-else-if="sqlMetrics.error" class="alert-error">{{ sqlMetrics.error }}</div>
              <div v-else style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <GcpMetricsChart v-for="m in SQL_METRICS" :key="m.key" :label="m.label" :unit="m.unit" :points="sqlMetrics.data[m.key] || []" :color="m.color" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cloud Storage -->
      <div v-show="activeTab === 'storage'" class="tab-panel">
        <div v-if="gcpStore.tabs.storage.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.storage.error && !filteredStorage.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredStorage.length" class="empty-row">{{ search ? 'No matches.' : 'No GCS buckets found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>Storage Class</th><th>Public</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="b in filteredStorage" :key="b.name">
              <td>{{ b.name }}</td>
              <td class="text-dim">{{ b.location }}</td>
              <td class="text-dim">{{ b.storageClass }}</td>
              <td><span :class="b.publicAccess ? 'status-warn' : 'status-ok'">{{ b.publicAccess ? 'Public' : 'Private' }}</span></td>
              <td class="text-dim">{{ b.created ? new Date(b.created).toLocaleDateString() : '--' }}</td>
              <td>
                <button class="btn sm" @click="openGcsBrowser(b.name)">
                  <i data-lucide="folder-open"></i> Browse
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Functions -->
      <div v-show="activeTab === 'functions'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div v-if="gcpStore.tabs.functions.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.functions.error && !filteredFunctions.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredFunctions.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Functions found.' }}</div>
        <div v-else style="display:flex;flex:1;overflow:hidden">
          <!-- LEFT -->
          <div style="width:240px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
            <div v-for="fn in filteredFunctions" :key="fn.name"
              :class="['sidebar-item', fnPanel.resource?.name === fn.name ? 'active' : '']"
              style="cursor:pointer" @click="selectFn(fn)">
              <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ fn.name }}</div>
              <div class="text-dim" style="font-size:10px">{{ fn.location }}</div>
              <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                <span :class="fnStatusClass(fn.state)" style="font-size:10px">{{ fn.state }}</span>
                <span class="text-dim" style="font-size:10px">{{ fn.runtime }}</span>
                <span v-if="fn.trigger === 'HTTPS'" style="font-size:9px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);color:#4ade80;border-radius:8px;padding:0 5px">HTTPS</span>
              </div>
            </div>
          </div>
          <!-- RIGHT -->
          <div v-if="!fnPanel.resource" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px">Select a function to see details</div>
          <div v-else style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ fnPanel.resource.name }}</div>
                <span :class="fnStatusClass(fnPanel.resource.state)" style="font-size:11px">{{ fnPanel.resource.state }}</span>
                <a v-if="fnPanel.resource.url" :href="fnPanel.resource.url" target="_blank" class="link" style="font-size:11px">↗ URL</a>
                <div style="margin-left:auto">
                  <button class="btn sm primary" :disabled="fnPanel.resource.trigger !== 'HTTPS'" @click="fnPanelInvoke()">▶ Invoke</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ fnPanel.resource.location }} · {{ fnPanel.resource.runtime }} · {{ fnPanel.resource.trigger }}</div>
            </div>
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in [{id:'overview',label:'Overview'},{id:'variables',label:'Variables'},{id:'logs',label:'Logs'},{id:'invoke',label:'Invoke'},{id:'metrics',label:'Metrics'}]" :key="t.id"
                :class="['aws-tab-btn', fnPanel.tab === t.id ? 'active' : '']" @click="fnSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- OVERVIEW -->
            <div v-show="fnPanel.tab === 'overview'" style="flex:1;overflow:auto;padding:16px">
              <div v-if="fnPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="fnPanel.detailError" class="alert-error">{{ fnPanel.detailError }}</div>
              <div v-else-if="fnPanel.detail" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Function</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">State</span><span :class="fnStatusClass(fnPanel.detail.state)">{{ fnPanel.detail.state }}</span></div>
                    <div class="kv-row"><span class="kv-k">Runtime</span><span class="text-dim">{{ fnPanel.detail.runtime }}</span></div>
                    <div class="kv-row"><span class="kv-k">Trigger</span><span class="text-dim">{{ fnPanel.detail.trigger }}</span></div>
                    <div class="kv-row"><span class="kv-k">Entry Point</span><span class="mono-xs text-dim">{{ fnPanel.detail.entryPoint || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Service Account</span><span class="mono-xs text-dim" style="word-break:break-all">{{ fnPanel.detail.serviceAccount || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Ingress</span><span class="text-dim">{{ fnPanel.detail.ingressSettings || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Updated</span><span class="text-dim">{{ fnPanel.detail.updated ? new Date(fnPanel.detail.updated).toLocaleString() : '--' }}</span></div>
                  </div>
                </div>
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                  <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Resources</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Memory</span><span class="text-dim">{{ fnPanel.detail.memory || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">CPU</span><span class="text-dim">{{ fnPanel.detail.cpu || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Timeout</span><span class="text-dim">{{ fnPanel.detail.timeout || '--' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Min Instances</span><span class="text-dim">{{ fnPanel.detail.minInstances ?? '0' }}</span></div>
                    <div class="kv-row"><span class="kv-k">Max Instances</span><span class="text-dim">{{ fnPanel.detail.maxInstances ?? '∞' }}</span></div>
                    <div class="kv-row"><span class="kv-k">URL</span><a v-if="fnPanel.detail.url" :href="fnPanel.detail.url" target="_blank" class="link mono-xs" style="word-break:break-all">{{ fnPanel.detail.url }}</a><span v-else class="text-dim">--</span></div>
                  </div>
                </div>
              </div>
            </div>
            <!-- VARIABLES -->
            <div v-show="fnPanel.tab === 'variables'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="fnPanel.detailLoading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading...</div>
              <div v-else-if="!fnPanel.detail?.envVars?.length" class="empty-row">No environment variables configured.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Name</th><th>Value</th></tr></thead>
                <tbody>
                  <tr v-for="v in fnPanel.detail.envVars" :key="v.name">
                    <td class="mono-xs" style="font-weight:600">{{ v.name }}</td>
                    <td class="mono-xs text-dim">{{ v.value || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- LOGS -->
            <div v-show="fnPanel.tab === 'logs'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center">
                <select v-model="fnPanel.logsHours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option><option :value="72">Last 3d</option>
                </select>
                <button class="btn sm" @click="fnLoadLogs()" :disabled="fnPanel.logsLoading">{{ fnPanel.logsLoading ? 'Loading...' : 'Refresh' }}</button>
                <span class="text-dim" style="font-size:11px">{{ fnPanel.logs.length }} entries</span>
              </div>
              <div v-if="fnPanel.logsLoading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading logs...</div>
              <div v-else-if="fnPanel.logsError" class="alert-error" style="margin:12px">{{ fnPanel.logsError }}</div>
              <div v-else-if="!fnPanel.logs.length" class="empty-row">No log entries in this time range.</div>
              <div v-else style="flex:1;overflow:auto;padding:0 8px">
                <div v-for="(e, i) in fnPanel.logs" :key="i" style="display:flex;gap:8px;padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;font-family:monospace">
                  <span :style="`flex-shrink:0;width:58px;font-size:10px;${gcpLogColor(e.severity)}`">{{ (e.severity||'DEFAULT').slice(0,7) }}</span>
                  <span class="text-dim" style="flex-shrink:0;white-space:nowrap">{{ e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '' }}</span>
                  <span style="flex:1;word-break:break-all;white-space:pre-wrap">{{ e.message }}</span>
                </div>
              </div>
            </div>
            <!-- INVOKE -->
            <div v-show="fnPanel.tab === 'invoke'" style="flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px">
              <div>
                <div style="font-size:12px;font-weight:600;margin-bottom:6px">JSON Payload</div>
                <textarea v-model="fnPanel.invokePayload" rows="8" placeholder='{"key": "value"}' style="width:100%;font-family:monospace;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);resize:vertical"></textarea>
              </div>
              <div>
                <button class="btn primary" @click="fnPanelDoInvoke()" :disabled="fnPanel.invoking || fnPanel.resource?.trigger !== 'HTTPS'">
                  {{ fnPanel.invoking ? 'Invoking...' : '▶ Invoke' }}
                </button>
                <span v-if="fnPanel.resource?.trigger !== 'HTTPS'" class="text-dim" style="font-size:11px;margin-left:8px">Only HTTPS trigger functions can be invoked here.</span>
              </div>
              <div v-if="fnPanel.invokeResult !== null">
                <div style="font-size:12px;font-weight:600;margin-bottom:6px">Response</div>
                <pre style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:11px;overflow:auto;max-height:300px;white-space:pre-wrap;word-break:break-all">{{ fnPanel.invokeResult }}</pre>
              </div>
            </div>
            <!-- METRICS -->
            <div v-show="fnPanel.tab === 'metrics'" style="flex:1;overflow:auto;padding:12px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
                <select v-model="fnMetrics.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option>
                </select>
                <button class="btn sm" @click="loadMetrics(fnMetrics, FN_METRICS, fnPanel.resource)" :disabled="fnMetrics.loading">{{ fnMetrics.loading ? 'Loading...' : 'Refresh' }}</button>
              </div>
              <div v-if="fnMetrics.loading" style="text-align:center;padding:32px;color:var(--text-dim)">Loading metrics...</div>
              <div v-else-if="fnMetrics.error" class="alert-error">{{ fnMetrics.error }}</div>
              <div v-else style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <GcpMetricsChart v-for="m in FN_METRICS" :key="m.key" :label="m.label" :unit="m.unit" :points="fnMetrics.data[m.key] || []" :color="m.color" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pub/Sub -->
      <div v-show="activeTab === 'pubsub'" class="tab-panel">
        <div v-if="gcpStore.tabs.pubsub.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.pubsub.error && !filteredPubSub.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredPubSub.length" class="empty-row">{{ search ? 'No matches.' : 'No Pub/Sub topics found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Topic Name</th><th>Labels</th></tr></thead>
          <tbody>
            <tr v-for="t in filteredPubSub" :key="t.name">
              <td>{{ t.name }}</td>
              <td class="text-dim">{{ t.labels || '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Secret Manager -->
      <div v-show="activeTab === 'secrets'" class="tab-panel">
        <div v-if="gcpStore.tabs.secrets.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.secrets.error && !filteredSecrets.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredSecrets.length" class="empty-row">{{ search ? 'No matches.' : 'No secrets found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Replication</th><th>Created</th><th>Labels</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="s in filteredSecrets" :key="s.name">
              <td>{{ s.name }}</td>
              <td class="text-dim">{{ s.replication }}</td>
              <td class="text-dim">{{ s.created ? new Date(s.created).toLocaleDateString() : '--' }}</td>
              <td class="text-dim">
                <span v-if="Object.keys(s.labels).length">{{ Object.entries(s.labels).map(([k,v]) => `${k}=${v}`).join(', ') }}</span>
                <span v-else>--</span>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openSecretPreview(s)">
                    <i data-lucide="key"></i> Preview &amp; Import
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Artifact Registry -->
      <div v-show="activeTab === 'artifact'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div v-if="gcpStore.tabs.artifact.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.artifact.error && !filteredArtifact.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredArtifact.length" class="empty-row">{{ search ? 'No matches.' : 'No Artifact Registry repositories found.' }}</div>
        <div v-else style="display:flex;flex:1;overflow:hidden">
          <!-- LEFT: repo list -->
          <div style="width:220px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
            <div v-for="r in filteredArtifact" :key="r.name"
              :class="['sidebar-item', arPanel.repo?.name === r.name ? 'active' : '']"
              style="cursor:pointer" @click="selectArtifactRepo(r)">
              <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.name }}</div>
              <div class="text-dim" style="font-size:10px">{{ r.location }}</div>
              <div style="margin-top:4px">
                <span class="badge-format" style="font-size:10px">{{ r.format }}</span>
              </div>
            </div>
          </div>
          <!-- RIGHT -->
          <div v-if="!arPanel.repo" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px">Select a repository</div>
          <div v-else style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <!-- Header -->
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="font-weight:700;font-size:15px">{{ arPanel.repo.name }}</div>
                <span class="badge-format">{{ arPanel.repo.format }}</span>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">
                {{ arPanel.repo.location }}
                <span v-if="arPanel.info?.imagePrefix"> · <span class="mono-xs">{{ arPanel.info.imagePrefix }}</span></span>
              </div>
            </div>
            <!-- Tabs -->
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in [{id:'packages',label:'Packages & Tags'},{id:'deploy',label:'🚀 Deploy to K8s'}]" :key="t.id"
                :class="['aws-tab-btn', arPanel.tab === t.id ? 'active' : '']" @click="arSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- PACKAGES & TAGS -->
            <div v-show="arPanel.tab === 'packages'" style="flex:1;display:flex;overflow:hidden">
              <!-- Package list -->
              <div style="width:200px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
                <div v-if="arPanel.pkgsLoading" style="padding:16px;text-align:center;color:var(--text-dim);font-size:12px">Loading...</div>
                <div v-else-if="!arPanel.pkgs.length" style="padding:16px;text-align:center;color:var(--text-dim);font-size:12px">No packages</div>
                <div v-for="pkg in arPanel.pkgs" :key="pkg.name"
                  :class="['sidebar-item', arPanel.selectedPkg?.name === pkg.name ? 'active' : '']"
                  style="cursor:pointer;padding:8px 12px" @click="selectArtifactPkg(pkg)">
                  <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ pkg.displayName }}</div>
                  <div class="text-dim" style="font-size:10px">{{ pkg.updated ? new Date(pkg.updated).toLocaleDateString() : '' }}</div>
                </div>
              </div>
              <!-- Tag list -->
              <div style="flex:1;overflow-y:auto">
                <div v-if="!arPanel.selectedPkg" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:13px">Select a package</div>
                <div v-else-if="arPanel.tagsLoading" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim)">Loading tags...</div>
                <div v-else-if="!arPanel.tags.length" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:12px">No tags found</div>
                <div v-else>
                  <div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;font-weight:600;color:var(--text-dim);background:var(--surface)">
                    {{ arPanel.tags.length }} tag(s) — {{ arPanel.selectedPkg.displayName }}
                  </div>
                  <table class="cloud-table">
                    <thead><tr><th>Tag</th><th>Digest</th><th>Updated</th><th>Actions</th></tr></thead>
                    <tbody>
                      <tr v-for="tag in arPanel.tags" :key="tag.name">
                        <td><span style="font-size:12px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:8px;padding:1px 8px;color:#818cf8">{{ tag.name }}</span></td>
                        <td class="mono-xs text-dim" style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis">{{ tag.version?.slice(0, 19) || '--' }}</td>
                        <td class="text-dim" style="font-size:11px">{{ tag.updated ? new Date(tag.updated).toLocaleDateString() : '--' }}</td>
                        <td>
                          <button v-if="arPanel.repo.format === 'DOCKER'" class="btn sm primary" @click="arStartDeploy(tag)">🚀 Deploy</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <!-- DEPLOY TO K8S -->
            <div v-show="arPanel.tab === 'deploy'" style="flex:1;overflow:auto;padding:20px">
              <div v-if="!arPanel.deployImage" class="empty-row" style="padding:40px">
                Click <strong>Deploy</strong> on a tag in the Packages tab to pre-fill the image here.
              </div>
              <div v-else style="max-width:560px">
                <div style="font-size:14px;font-weight:700;margin-bottom:16px">🚀 Deploy image to Kubernetes</div>
                <!-- Image -->
                <div style="margin-bottom:14px">
                  <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Image</label>
                  <input v-model="arPanel.deployImage" style="width:100%;font-family:monospace;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:6px 10px;color:var(--text)" />
                </div>
                <!-- Namespace -->
                <div style="margin-bottom:14px">
                  <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Namespace</label>
                  <div style="display:flex;gap:6px">
                    <select v-model="arPanel.deployNs" @change="arLoadDeployments()" style="flex:1;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text)">
                      <option value="">— select namespace —</option>
                      <option v-for="ns in arPanel.namespaces" :key="ns" :value="ns">{{ ns }}</option>
                    </select>
                    <button class="btn sm" @click="arLoadNamespaces()" :disabled="arPanel.nsLoading">{{ arPanel.nsLoading ? '...' : '↺' }}</button>
                  </div>
                </div>
                <!-- Deployment -->
                <div style="margin-bottom:14px">
                  <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Deployment</label>
                  <select v-model="arPanel.deployDeployment" @change="arOnDeploymentSelect()" style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text)">
                    <option value="">— select deployment —</option>
                    <option v-for="d in arPanel.deployments" :key="d.name" :value="d">{{ d.name }}</option>
                  </select>
                </div>
                <!-- Container -->
                <div style="margin-bottom:20px">
                  <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Container</label>
                  <select v-model="arPanel.deployContainer" style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text)">
                    <option value="">— select container —</option>
                    <option v-for="c in arPanel.deployContainers" :key="c" :value="c">{{ c }}</option>
                  </select>
                  <div v-if="arPanel.deployDeployment && arPanel.deployContainers.length === 1" class="text-dim" style="font-size:10px;margin-top:3px">
                    Current image: <span class="mono-xs">{{ arPanel.deployDeployment?.images?.[0] }}</span>
                  </div>
                </div>
                <!-- Summary box -->
                <div v-if="arPanel.deployImage && arPanel.deployNs && arPanel.deployDeployment && arPanel.deployContainer" style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.3);border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px">
                  <div style="font-weight:600;margin-bottom:6px">Deploy summary</div>
                  <div class="kv-list">
                    <div class="kv-row"><span class="kv-k">Deployment</span><span>{{ arPanel.deployNs }}/{{ arPanel.deployDeployment?.name }}</span></div>
                    <div class="kv-row"><span class="kv-k">Container</span><span class="mono-xs">{{ arPanel.deployContainer }}</span></div>
                    <div class="kv-row"><span class="kv-k">New image</span><span class="mono-xs" style="color:#818cf8">{{ arPanel.deployImage }}</span></div>
                  </div>
                </div>
                <!-- Actions -->
                <div style="display:flex;gap:8px;align-items:center">
                  <button class="btn primary" :disabled="!arPanel.deployImage || !arPanel.deployNs || !arPanel.deployDeployment || !arPanel.deployContainer || arPanel.deploying"
                    @click="arApplyDeploy()">
                    {{ arPanel.deploying ? 'Deploying...' : '🚀 Apply' }}
                  </button>
                  <span v-if="arPanel.deployResult" :class="arPanel.deployResult.ok ? 'status-ok' : 'status-err'" style="font-size:12px">
                    {{ arPanel.deployResult.msg }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- BigQuery -->
      <div v-show="activeTab === 'bigquery'" class="tab-panel">
        <div v-if="gcpStore.tabs.bigquery.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.bigquery.error && !filteredBigQuery.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredBigQuery.length" class="empty-row">{{ search ? 'No matches.' : 'No BigQuery datasets found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Dataset</th><th>Location</th><th>Labels</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="ds in filteredBigQuery" :key="ds.id">
              <td>{{ ds.friendlyName || ds.id }}</td>
              <td class="text-dim">{{ ds.location }}</td>
              <td class="text-dim">
                <span v-if="Object.keys(ds.labels).length">{{ Object.entries(ds.labels).map(([k,v]) => `${k}=${v}`).join(', ') }}</span>
                <span v-else>--</span>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openBqTables(ds)"><i data-lucide="table-2"></i> Tables</button>
                  <button class="btn sm accent" @click="openBqQuery(ds)"><i data-lucide="terminal"></i> Query</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Workflows -->
      <div v-show="activeTab === 'workflows'" class="tab-panel">
        <div v-if="gcpStore.tabs.workflows.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.workflows.error && !filteredWorkflows.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredWorkflows.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Workflows found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>State</th><th>Description</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="wf in filteredWorkflows" :key="`${wf.location}/${wf.name}`">
              <td>{{ wf.name }}</td>
              <td class="text-dim">{{ wf.location }}</td>
              <td><span :class="wfStateClass(wf.state)">{{ wf.state }}</span></td>
              <td class="text-dim">{{ wf.description || '--' }}</td>
              <td class="text-dim">{{ wf.updated ? new Date(wf.updated).toLocaleDateString() : '--' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openWfExecutions(wf)"><i data-lucide="play-circle"></i> Executions</button>
                  <button class="btn sm" @click="openWfDefinition(wf)"><i data-lucide="file-code-2"></i> Definition</button>
                  <button class="btn sm" @click="openLogs('workflows', wf)"><i data-lucide="scroll-text"></i> Logs</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud DNS -->
      <div v-show="activeTab === 'dns'" class="tab-panel">
        <div v-if="gcpStore.tabs.dns.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.dns.error && !filteredDns.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredDns.length" class="empty-row">{{ search ? 'No matches.' : 'No DNS zones found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Zone Name</th><th>DNS Name</th><th>Visibility</th><th>Description</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="z in filteredDns" :key="z.name">
              <td>{{ z.name }}</td>
              <td class="text-dim">{{ z.dnsName }}</td>
              <td>
                <span :class="z.visibility === 'public' ? 'status-warn' : 'status-ok'">{{ z.visibility }}</span>
              </td>
              <td class="text-dim">{{ z.description || '--' }}</td>
              <td class="text-dim">{{ z.created ? new Date(z.created).toLocaleDateString() : '--' }}</td>
              <td>
                <button class="btn sm" @click="openDnsRecords(z)"><i data-lucide="list"></i> Records</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Firestore -->
      <div v-show="activeTab === 'firestore'" class="tab-panel">
        <div v-if="gcpStore.tabs.firestore.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.firestore.error && !filteredFirestore.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredFirestore.length" class="empty-row">{{ search ? 'No matches.' : 'No Firestore databases found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Database</th><th>Location</th><th>Type</th><th>State</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="db in filteredFirestore" :key="db.name">
              <td>{{ db.name }}</td>
              <td class="text-dim">{{ db.location }}</td>
              <td class="text-dim">
                <span class="badge-format">{{ db.type === 'FIRESTORE_NATIVE' ? 'Native' : db.type === 'DATASTORE_MODE' ? 'Datastore' : db.type }}</span>
              </td>
              <td><span :class="db.state === 'READY' ? 'status-ok' : 'status-warn'">{{ db.state }}</span></td>
              <td class="text-dim">{{ db.created ? new Date(db.created).toLocaleDateString() : '--' }}</td>
              <td>
                <button class="btn sm" @click="openFsCollections(db)"><i data-lucide="database"></i> Collections</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Spanner -->
      <div v-show="activeTab === 'spanner'" class="tab-panel">
        <div v-if="gcpStore.tabs.spanner.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.spanner.error && !filteredSpanner.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredSpanner.length" class="empty-row">{{ search ? 'No matches.' : 'No Spanner instances found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Instance</th><th>Config</th><th>State</th><th>Nodes / PUs</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="inst in filteredSpanner" :key="inst.name">
              <td>{{ inst.displayName || inst.name }}</td>
              <td class="text-dim">{{ inst.config }}</td>
              <td><span :class="inst.state === 'READY' ? 'status-ok' : 'status-warn'">{{ inst.state }}</span></td>
              <td class="text-dim">{{ inst.nodes ?? '--' }} / {{ inst.processingUnits ?? '--' }}</td>
              <td>
                <button class="btn sm" @click="openSpannerDbs(inst)"><i data-lucide="database"></i> Databases</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Memorystore -->
      <div v-show="activeTab === 'memorystore'" class="tab-panel">
        <div v-if="gcpStore.tabs.memorystore.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.memorystore.error && !filteredMemory.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredMemory.length" class="empty-row">{{ search ? 'No matches.' : 'No Memorystore instances found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>Version</th><th>Tier</th><th>Size</th><th>Host:Port</th><th>Auth</th><th>State</th></tr></thead>
          <tbody>
            <tr v-for="m in filteredMemory" :key="m.name">
              <td>{{ m.displayName || m.name }}</td>
              <td class="text-dim">{{ m.location }}</td>
              <td class="text-dim">{{ m.redisVersion }}</td>
              <td class="text-dim">{{ m.tier }}</td>
              <td class="text-dim">{{ m.memorySizeGb }} GB</td>
              <td class="text-dim font-mono">{{ m.host }}:{{ m.port }}</td>
              <td class="text-dim">
                <span v-if="m.authEnabled" class="status-ok">On</span>
                <span v-else class="status-warn">Off</span>
              </td>
              <td><span :class="m.state === 'READY' ? 'status-ok' : 'status-warn'">{{ m.state }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Tasks -->
      <div v-show="activeTab === 'tasks'" class="tab-panel">
        <div v-if="gcpStore.tabs.tasks.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.tasks.error && !filteredTasks.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredTasks.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Tasks queues found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Queue</th><th>Location</th><th>State</th><th>Max/s</th><th>Max Concurrent</th><th>Max Retries</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="q in filteredTasks" :key="`${q.location}/${q.name}`">
              <td>{{ q.name }}</td>
              <td class="text-dim">{{ q.location }}</td>
              <td><span :class="q.state === 'RUNNING' ? 'status-ok' : q.state === 'PAUSED' ? 'status-warn' : 'status-err'">{{ q.state }}</span></td>
              <td class="text-dim">{{ q.rateLimits?.maxDispatchesPerSecond ?? '--' }}</td>
              <td class="text-dim">{{ q.rateLimits?.maxConcurrentDispatches ?? '--' }}</td>
              <td class="text-dim">{{ q.retryConfig?.maxAttempts ?? '--' }}</td>
              <td>
                <button class="btn sm" @click="openTasksList(q)"><i data-lucide="list"></i> Tasks</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Scheduler -->
      <div v-show="activeTab === 'scheduler'" class="tab-panel">
        <div v-if="gcpStore.tabs.scheduler.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.scheduler.error && !filteredScheduler.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredScheduler.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Scheduler jobs found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Job</th><th>Location</th><th>Schedule</th><th>Timezone</th><th>Target</th><th>State</th><th>Last Run</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="j in filteredScheduler" :key="`${j.location}/${j.name}`">
              <td>{{ j.name }}</td>
              <td class="text-dim">{{ j.location }}</td>
              <td class="text-dim font-mono">{{ j.schedule }}</td>
              <td class="text-dim">{{ j.timeZone }}</td>
              <td class="text-dim"><span class="badge-format">{{ j.targetType }}</span></td>
              <td><span :class="schedulerStateClass(j.state)">{{ j.state }}</span></td>
              <td class="text-dim">{{ j.lastAttemptTime ? new Date(j.lastAttemptTime).toLocaleString() : '--' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm accent" :disabled="schedulerActionLoading === j.name" @click="schedulerRun(j)">
                    <i data-lucide="play"></i> Run
                  </button>
                  <button v-if="j.state === 'ENABLED'" class="btn sm warn" :disabled="schedulerActionLoading === j.name" @click="schedulerPause(j)">
                    <i data-lucide="pause"></i> Pause
                  </button>
                  <button v-else-if="j.state === 'PAUSED'" class="btn sm" :disabled="schedulerActionLoading === j.name" @click="schedulerResume(j)">
                    <i data-lucide="play-circle"></i> Resume
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Build -->
      <div v-show="activeTab === 'build'" class="tab-panel">
        <div v-if="gcpStore.tabs.build.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.build.error && !filteredBuild.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredBuild.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Build builds found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>ID</th><th>Status</th><th>Trigger</th><th>Branch</th><th>Commit</th><th>Duration</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="b in filteredBuild" :key="b.id">
              <td class="font-mono text-dim" style="font-size:11px">{{ b.id.slice(0,8) }}…</td>
              <td><span :class="buildStatusClass(b.status)">{{ b.status }}</span></td>
              <td class="text-dim">{{ b.triggerName || '--' }}</td>
              <td class="text-dim">{{ b.branch || '--' }}</td>
              <td class="text-dim font-mono">{{ b.commit || '--' }}</td>
              <td class="text-dim">{{ buildDuration(b.durationMs) }}</td>
              <td class="text-dim">{{ b.createTime ? new Date(b.createTime).toLocaleString() : '--' }}</td>
              <td>
                <button class="btn sm" @click="openBuildLogs(b)"><i data-lucide="file-text"></i> Logs</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="gcpStore.tabs.build.nextPageToken && !search" class="load-more-row">
          <button class="btn sm" :disabled="gcpStore.tabs.build.loadingMore" @click="gcpStore.fetchMoreBuilds()">
            {{ gcpStore.tabs.build.loadingMore ? 'Loading…' : 'Load more builds' }}
          </button>
        </div>
      </div>

      <!-- IAM Service Accounts -->
      <div v-show="activeTab === 'iam'" class="tab-panel">
        <div v-if="gcpStore.tabs.iam.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.iam.error && !filteredIam.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredIam.length" class="empty-row">{{ search ? 'No matches.' : 'No service accounts found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Email</th><th>Display Name</th><th>Description</th><th>Disabled</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="sa in filteredIam" :key="sa.email">
              <td class="font-mono" style="font-size:11px">{{ sa.email }}</td>
              <td>{{ sa.displayName || '--' }}</td>
              <td class="text-dim">{{ sa.description || '--' }}</td>
              <td>
                <span v-if="sa.disabled" class="status-err">Disabled</span>
                <span v-else class="status-ok">Active</span>
              </td>
              <td>
                <button class="btn sm" @click="openIamKeys(sa)"><i data-lucide="key"></i> Keys</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="gcpStore.tabs.iam.nextPageToken && !search" class="load-more-row">
          <button class="btn sm" :disabled="gcpStore.tabs.iam.loadingMore" @click="gcpStore.fetchMoreIamServiceAccounts()">
            {{ gcpStore.tabs.iam.loadingMore ? 'Loading…' : 'Load more accounts' }}
          </button>
        </div>
      </div>

      <!-- Cloud Run Jobs -->
      <div v-show="activeTab === 'cloudrunJobs'" class="tab-panel">
        <div v-if="gcpStore.tabs.cloudrunJobs.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.cloudrunJobs.error && !filteredCloudRunJobs.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredCloudRunJobs.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Run Jobs found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Region</th><th>Last Run</th><th>Last Status</th><th>Tasks</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="j in filteredCloudRunJobs" :key="j.name + j.location">
              <td>{{ j.name }}</td>
              <td class="text-dim">{{ j.location }}</td>
              <td class="text-dim">{{ j.lastRun ? new Date(j.lastRun).toLocaleString() : '--' }}</td>
              <td>
                <span v-if="j.lastStatus === 'EXECUTION_SUCCEEDED'" class="status-ok">Succeeded</span>
                <span v-else-if="j.lastStatus === 'EXECUTION_FAILED'" class="status-err">Failed</span>
                <span v-else-if="j.lastStatus" class="status-warn">{{ j.lastStatus }}</span>
                <span v-else class="text-dim">--</span>
              </td>
              <td class="text-dim">{{ j.taskCount }}</td>
              <td><div class="row-actions">
                <button class="btn sm primary" @click="runJob(j)" title="Run job"><i data-lucide="play"></i></button>
                <button class="btn sm" @click="openJobExecutions(j)" title="Executions"><i data-lucide="list"></i></button>
              </div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pub/Sub Subscriptions -->
      <div v-show="activeTab === 'pubsubSubs'" class="tab-panel">
        <div v-if="gcpStore.tabs.pubsubSubs.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.pubsubSubs.error && !filteredPubSubSubs.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredPubSubSubs.length" class="empty-row">{{ search ? 'No matches.' : 'No Pub/Sub subscriptions found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Topic</th><th>Type</th><th>Ack Deadline</th><th>Filter</th></tr></thead>
          <tbody>
            <tr v-for="s in filteredPubSubSubs" :key="s.name">
              <td>{{ s.name }}</td>
              <td class="text-dim">{{ s.topic || '--' }}</td>
              <td><span class="status-ok">{{ s.type }}</span></td>
              <td class="text-dim">{{ s.ackDeadlineSecs }}s</td>
              <td class="text-dim font-mono" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis">{{ s.filter || '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- VPC Networks -->
      <div v-show="activeTab === 'vpc'" class="tab-panel">
        <div v-if="gcpStore.tabs.vpc.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.vpc.error && !filteredVpc.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredVpc.length" class="empty-row">{{ search ? 'No matches.' : 'No VPC networks found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Mode</th><th>Routing</th><th>Subnets</th><th>MTU</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="n in filteredVpc" :key="n.name">
              <td>{{ n.name }}</td>
              <td><span class="status-ok">{{ n.autoSubnet ? 'Auto' : 'Custom' }}</span></td>
              <td class="text-dim">{{ n.routingMode }}</td>
              <td class="text-dim">{{ n.subnetCount }}</td>
              <td class="text-dim">{{ n.mtu || '--' }}</td>
              <td>
                <button class="btn sm" @click="openVpcSubnets(n)"><i data-lucide="network"></i> Subnets</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cloud Monitoring -->
      <div v-show="activeTab === 'monitoring'" class="tab-panel">
        <div v-if="gcpStore.tabs.monitoring.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.monitoring.error && !filteredMonitoring.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredMonitoring.length" class="empty-row">{{ search ? 'No matches.' : 'No alert policies found.' }}</div>
        <div class="monitoring-row">
          <div class="monitoring-section">
            <div class="monitoring-title">Alert Policies</div>
            <table v-if="filteredMonitoring.length" class="cloud-table">
              <thead><tr><th>Name</th><th>State</th><th>Conditions</th><th>Notification Channels</th></tr></thead>
              <tbody>
                <tr v-for="p in filteredMonitoring" :key="p.name">
                  <td>{{ p.displayName }}</td>
                  <td><span :class="p.enabled ? 'status-ok' : 'status-warn'">{{ p.state }}</span></td>
                  <td class="text-dim" style="max-width:250px;overflow:hidden;text-overflow:ellipsis">{{ p.conditions || '--' }}</td>
                  <td class="text-dim">{{ p.notificationChannels }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Cloud Logging -->
      <div v-show="activeTab === 'logging'" class="tab-panel">
        <div class="logging-query-bar">
          <input v-model="logFilter" class="ctrl-input" style="flex:1" placeholder='filter e.g. resource.type="gce_instance" severity>=ERROR' />
          <select v-model="logHours" class="ctrl-input" style="width:100px">
            <option value="1">Last 1h</option>
            <option value="3">Last 3h</option>
            <option value="12">Last 12h</option>
            <option value="24">Last 24h</option>
            <option value="48">Last 48h</option>
          </select>
          <button class="btn sm primary" :disabled="gcpStore.tabs.logging.loading" @click="runLogQuery">
            {{ gcpStore.tabs.logging.loading ? 'Querying…' : 'Query' }}
          </button>
        </div>
        <div v-if="gcpStore.tabs.logging.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.logging.error" class="empty-row text-dim">{{ gcpStore.tabs.logging.error }}</div>
        <div v-else-if="!gcpStore.tabs.logging.data.length" class="empty-row">Run a query to see log entries.</div>
        <div v-else class="gcp-log-list">
          <div v-for="(e, i) in gcpStore.tabs.logging.data" :key="i" class="gcp-log-entry">
            <span class="gcp-log-ts">{{ e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '' }}</span>
            <span :class="['gcp-log-sev', logSevClass(e.severity)]">{{ e.severity?.slice(0,4) || '??' }}</span>
            <span class="text-dim" style="flex-shrink:0;font-size:10px;width:90px;overflow:hidden;text-overflow:ellipsis">{{ e.logName }}</span>
            <span class="gcp-log-msg">{{ e.message }}</span>
          </div>
        </div>
      </div>

      <!-- Cloud KMS -->
      <div v-show="activeTab === 'kms'" class="tab-panel">
        <div v-if="gcpStore.tabs.kms.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.kms.error && !filteredKms.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredKms.length" class="empty-row">{{ search ? 'No matches.' : 'No KMS key rings found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Key Ring</th><th>Location</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="k in filteredKms" :key="k.name + k.location">
              <td>{{ k.name }}</td>
              <td class="text-dim">{{ k.location }}</td>
              <td class="text-dim">{{ k.created ? new Date(k.created).toLocaleDateString() : '--' }}</td>
              <td>
                <button class="btn sm" @click="openKmsKeys(k)"><i data-lucide="key-round"></i> Keys</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </template>

    <!-- ══ GCS Browser ══════════════════════════════════════════════════════════ -->
    <GcsBrowser
      :open="gcsBrowserOpen"
      :bucket="gcsBrowserBucket"
      :profile-id="selectedProfileId"
      @close="gcsBrowserOpen = false"
    />

    <!-- ══ Function Invoke Modal ════════════════════════════════════════════════ -->
    <Teleport to="body">
    <div v-if="fnInvokeOpen" class="gcp-modal-backdrop" @mousedown.self="fnInvokeOpen = false">
      <div class="gcp-modal">
        <div class="gcp-modal-header">
          <span>&#x25B6; Invoke: {{ fnInvokeTarget?.name }}</span>
          <button class="s3b-close" @click="fnInvokeOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <label class="gcp-label">JSON Payload</label>
          <textarea v-model="fnInvokePayload" class="gcp-code-input" rows="6" placeholder="{}"></textarea>
          <div class="gcp-modal-actions">
            <button class="btn sm primary" :disabled="fnInvoking" @click="doInvokeFunction">
              {{ fnInvoking ? 'Invoking…' : 'Invoke' }}
            </button>
          </div>
          <template v-if="fnInvokeResult">
            <div class="gcp-label" style="margin-top:12px">
              Response
              <span :class="fnInvokeResult.statusCode < 300 ? 'status-ok' : 'status-err'"> ({{ fnInvokeResult.statusCode }})</span>
            </div>
            <pre class="gcp-code-result">{{ typeof fnInvokeResult.body === 'string' ? fnInvokeResult.body : JSON.stringify(fnInvokeResult.body, null, 2) }}</pre>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Function Logs Modal ══════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="fnLogsOpen" class="gcp-modal-backdrop" @mousedown.self="fnLogsOpen = false">
      <div class="gcp-modal gcp-modal-wide">
        <div class="gcp-modal-header">
          <span>&#x1F4DC; Logs: {{ fnLogsTarget?.name }}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn sm" :disabled="fnLogsLoading" @click="loadFnLogs(fnLogsTarget)">&#x21BA; Refresh</button>
            <button class="s3b-close" @click="fnLogsOpen = false">&#x2715;</button>
          </div>
        </div>
        <div class="gcp-modal-body gcp-logs-body">
          <div v-if="fnLogsLoading" class="empty-row">Loading logs…</div>
          <div v-else-if="fnLogsError" class="s3b-error">{{ fnLogsError }}</div>
          <div v-else-if="!fnLogsEntries.length" class="empty-row">No log entries in the last 3 hours.</div>
          <div v-else class="gcp-log-list">
            <div v-for="(entry, i) in fnLogsEntries" :key="i" class="gcp-log-entry">
              <span class="gcp-log-ts">{{ entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '--' }}</span>
              <span :class="['gcp-log-sev', logSeverityClass(entry.severity)]">{{ (entry.severity || 'DEFAULT').slice(0,3) }}</span>
              <span class="gcp-log-msg">{{ entry.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Resource Logs Modal (cloudrun, gke, vms, sql, workflows) ═══════════ -->
  <Teleport to="body">
    <div v-if="resLogsOpen" class="gcp-modal-backdrop" @mousedown.self="resLogsOpen = false">
      <div class="gcp-modal gcp-modal-wide">
        <div class="gcp-modal-header">
          <span>&#x1F4DC; {{ resLogsType }} Logs: {{ resLogsTarget?.name || resLogsTarget?.service }}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn sm" :disabled="resLogsLoading" @click="reloadResLogs()">&#x21BA; Refresh</button>
            <button class="s3b-close" @click="resLogsOpen = false">&#x2715;</button>
          </div>
        </div>
        <div class="gcp-modal-body gcp-logs-body">
          <div v-if="resLogsLoading" class="empty-row">Loading logs…</div>
          <div v-else-if="resLogsError" class="s3b-error">{{ resLogsError }}</div>
          <div v-else-if="!resLogsEntries.length" class="empty-row">No log entries in the last 3 hours.</div>
          <div v-else class="gcp-log-list">
            <div v-for="(entry, i) in resLogsEntries" :key="i" class="gcp-log-entry">
              <span class="gcp-log-ts">{{ entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '--' }}</span>
              <span :class="['gcp-log-sev', logSeverityClass(entry.severity)]">{{ (entry.severity || 'DEFAULT').slice(0,3) }}</span>
              <span class="gcp-log-msg">{{ entry.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Secret Preview & Import Modal ═══════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="secretPreviewOpen" class="gcp-modal-backdrop" @mousedown.self="secretPreviewOpen = false">
      <div class="gcp-modal">
        <div class="gcp-modal-header">
          <span>&#x1F511; Secret: {{ secretPreviewName }}</span>
          <button class="s3b-close" @click="secretPreviewOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="secretPreviewLoading" class="empty-row">Loading…</div>
          <div v-else-if="secretPreviewError" class="s3b-error">{{ secretPreviewError }}</div>
          <template v-else>
            <label class="gcp-label">Keys found in secret (select to import)</label>
            <div v-if="!secretPreviewKeys.length" class="empty-row">No key=value pairs detected in this secret.</div>
            <div v-else class="gcp-key-list">
              <label v-for="k in secretPreviewKeys" :key="k.original" class="gcp-key-row">
                <input type="checkbox" :checked="isSecretKeySelected(k)" @change="toggleSecretKey(k)" />
                <span class="gcp-key-name">{{ k.sanitized }}</span>
                <span class="gcp-key-preview text-dim">{{ k.preview }}</span>
              </label>
            </div>
            <template v-if="secretSelectedKeys.length">
              <hr class="gcp-sep" />
              <label class="gcp-label">Import to profile</label>
              <select v-model="secretImportProfile" class="ctrl-input" style="width:100%;margin-bottom:6px">
                <option value="">— Create new profile —</option>
                <option v-for="p in envStore.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <input v-if="!secretImportProfile" v-model="secretImportName" class="ctrl-input" style="width:100%;margin-bottom:10px" placeholder="New profile name" />
              <div class="gcp-modal-actions">
                <button class="btn sm primary" :disabled="secretImporting" @click="doImportSecretKeys">
                  {{ secretImporting ? 'Importing…' : `Import ${secretSelectedKeys.length} key(s)` }}
                </button>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Artifact Packages Modal ══════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="artifactPkgOpen" class="gcp-modal-backdrop" @mousedown.self="artifactPkgOpen = false">
      <div class="gcp-modal">
        <div class="gcp-modal-header">
          <span>&#x1F4E6; Packages: {{ artifactPkgRepo?.name }}</span>
          <button class="s3b-close" @click="artifactPkgOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="artifactPkgLoading" class="empty-row">Loading…</div>
          <div v-else-if="artifactPkgError" class="s3b-error">{{ artifactPkgError }}</div>
          <div v-else-if="!artifactPkgList.length" class="empty-row">No packages found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Package</th><th>Updated</th></tr></thead>
            <tbody>
              <tr v-for="pkg in artifactPkgList" :key="pkg.name">
                <td>{{ pkg.displayName }}</td>
                <td class="text-dim">{{ pkg.updated ? new Date(pkg.updated).toLocaleDateString() : '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </Teleport>

  <!-- ══ BigQuery Tables Modal ═════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="bqTablesOpen" class="gcp-modal-backdrop" @mousedown.self="bqTablesOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F5C4; Tables: {{ bqTablesDataset?.id }}</span>
          <button class="s3b-close" @click="bqTablesOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="bqTablesLoading" class="empty-row">Loading…</div>
          <div v-else-if="bqTablesError" class="s3b-error">{{ bqTablesError }}</div>
          <div v-else-if="!bqTablesList.length" class="empty-row">No tables found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Table ID</th><th>Type</th><th>Rows</th><th>Size</th><th>Created</th></tr></thead>
            <tbody>
              <tr v-for="t in bqTablesList" :key="t.id">
                <td>{{ t.id }}</td>
                <td class="text-dim">{{ t.type }}</td>
                <td class="text-dim">{{ t.rowCount != null ? Number(t.rowCount).toLocaleString() : '--' }}</td>
                <td class="text-dim">{{ bqFormatSize(t.sizeBytes) }}</td>
                <td class="text-dim">{{ t.created ? new Date(t.created).toLocaleDateString() : '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ BigQuery Query Modal ══════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="bqQueryOpen" class="gcp-modal-backdrop" @mousedown.self="bqQueryOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F50D; Query BigQuery — {{ bqQueryDataset?.id }}</span>
          <button class="s3b-close" @click="bqQueryOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <textarea v-model="bqQueryText" class="bq-query-editor" rows="6" placeholder="Enter SQL query…" spellcheck="false" />
          <div class="bq-query-run">
            <button class="btn accent" :disabled="bqQueryRunning" @click="runBqQuery">
              <span v-if="bqQueryRunning">Running…</span>
              <span v-else><i data-lucide="play"></i> Run Query</span>
            </button>
          </div>
          <div v-if="bqQueryError" class="s3b-error">{{ bqQueryError }}</div>
          <div v-if="bqQueryResult">
            <div class="text-dim bq-row-count">{{ Number(bqQueryResult.totalRows).toLocaleString() }} rows</div>
            <div class="bq-results-scroll">
              <table class="cloud-table">
                <thead>
                  <tr><th v-for="col in bqQueryResult.schema" :key="col.name">{{ col.name }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in bqQueryResult.rows" :key="idx">
                    <td v-for="col in bqQueryResult.schema" :key="col.name" class="text-dim">{{ row[col.name] ?? '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Workflow Executions Modal ═════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="wfExecOpen" class="gcp-modal-backdrop" @mousedown.self="wfExecOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x25B6; Executions: {{ wfExecTarget?.name }}</span>
          <button class="s3b-close" @click="wfExecOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="wfExecLoading" class="empty-row">Loading…</div>
          <div v-else-if="wfExecError" class="s3b-error">{{ wfExecError }}</div>
          <div v-else-if="!wfExecList.length" class="empty-row">No recent executions.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>State</th><th>Start</th><th>End</th><th>Duration</th><th>Error</th></tr></thead>
            <tbody>
              <tr v-for="ex in wfExecList" :key="ex.name">
                <td><span :class="wfStateClass(ex.state)">{{ ex.state }}</span></td>
                <td class="text-dim">{{ ex.startTime ? new Date(ex.startTime).toLocaleString() : '--' }}</td>
                <td class="text-dim">{{ ex.endTime   ? new Date(ex.endTime).toLocaleString()   : '--' }}</td>
                <td class="text-dim">{{ ex.duration  || '--' }}</td>
                <td class="text-dim">{{ ex.error?.message || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Workflow Definition Modal ═════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="wfDefOpen" class="gcp-modal-backdrop" @mousedown.self="wfDefOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F4C4; Definition: {{ wfDefTarget?.name }}</span>
          <button class="s3b-close" @click="wfDefOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="wfDefLoading" class="empty-row">Loading…</div>
          <div v-else-if="wfDefError" class="s3b-error">{{ wfDefError }}</div>
          <pre v-else class="wf-def-source">{{ wfDefSource }}</pre>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ DNS Records Modal ══════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="dnsRecordsOpen" class="gcp-modal-backdrop" @mousedown.self="dnsRecordsOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F310; Records: {{ dnsRecordsZone?.dnsName }}</span>
          <button class="s3b-close" @click="dnsRecordsOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="dnsRecordsLoading" class="empty-row">Loading…</div>
          <template v-else-if="dnsRecordsList.length">
            <input v-model="dnsRecordsSearch" class="search-bar" placeholder="Filter records…" style="margin-bottom:8px;width:100%;" />
            <table class="cloud-table">
              <thead><tr><th>Name</th><th>Type</th><th>TTL</th><th>Data</th></tr></thead>
              <tbody>
                <tr v-for="rec in filteredDnsRecords" :key="`${rec.name}-${rec.type}`">
                  <td>{{ rec.name }}</td>
                  <td><span class="badge-format">{{ rec.type }}</span></td>
                  <td class="text-dim">{{ rec.ttl }}s</td>
                  <td class="text-dim">{{ rec.data }}</td>
                </tr>
              </tbody>
            </table>
          </template>
          <div v-else-if="dnsRecordsError" class="s3b-error">{{ dnsRecordsError }}</div>
          <div v-else class="empty-row">No records found.</div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Firestore Collections Modal ═══════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="fsColOpen" class="gcp-modal-backdrop" @mousedown.self="fsColOpen = false">
      <div class="gcp-modal">
        <div class="gcp-modal-header">
          <span>&#x1F5C3; Collections: {{ fsColDb?.name }}</span>
          <button class="s3b-close" @click="fsColOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="fsColLoading" class="empty-row">Loading…</div>
          <div v-else-if="fsColError" class="s3b-error">{{ fsColError }}</div>
          <div v-else-if="!fsColList.length" class="empty-row">No collections found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Collection ID</th><th>Est. Docs</th><th>Actions</th></tr></thead>
            <tbody>
              <tr v-for="col in fsColList" :key="col.id">
                <td>{{ col.id }}</td>
                <td class="text-dim">{{ col.count != null ? col.count.toLocaleString() : '--' }}</td>
                <td>
                  <button class="btn sm" @click="openFsDocuments(fsColDb, col)"><i data-lucide="file-text"></i> Browse</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Firestore Documents Modal ═════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="fsDocsOpen" class="gcp-modal-backdrop" @mousedown.self="fsDocsOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F4C4; Docs: {{ fsDocsDb?.name }}/{{ fsDocsCol?.id }}</span>
          <button class="s3b-close" @click="fsDocsOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="!fsDocsList.length && fsDocsLoading" class="empty-row">Loading…</div>
          <div v-else-if="fsDocsError" class="s3b-error">{{ fsDocsError }}</div>
          <div v-else-if="!fsDocsList.length" class="empty-row">No documents found.</div>
          <template v-else>
            <table class="cloud-table">
              <thead><tr><th>ID</th><th>Fields</th><th>Created</th><th>Updated</th></tr></thead>
              <tbody>
                <tr v-for="doc in fsDocsList" :key="doc.id">
                  <td>{{ doc.id }}</td>
                  <td class="text-dim fs-doc-fields">
                    <span v-for="(val, key) in doc.fields" :key="key" class="fs-field-chip">
                      <b>{{ key }}</b>: {{ fsFieldValue(val) }}
                    </span>
                  </td>
                  <td class="text-dim">{{ doc.created ? new Date(doc.created).toLocaleString() : '--' }}</td>
                  <td class="text-dim">{{ doc.updated ? new Date(doc.updated).toLocaleString() : '--' }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="fsDocsLoading" class="empty-row">Loading…</div>
            <div v-else-if="fsDocsNext" class="fs-load-more">
              <button class="btn sm" @click="openFsDocuments(fsDocsDb, fsDocsCol, fsDocsNext)">Load more</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Spanner Databases Modal ════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="spannerDbOpen" class="gcp-modal-backdrop" @mousedown.self="spannerDbOpen = false">
      <div class="gcp-modal">
        <div class="gcp-modal-header">
          <span>&#x1F5C4; Databases: {{ spannerInst?.displayName || spannerInst?.name }}</span>
          <button class="s3b-close" @click="spannerDbOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="spannerDbLoading" class="empty-row">Loading…</div>
          <div v-else-if="spannerDbError" class="s3b-error">{{ spannerDbError }}</div>
          <div v-else-if="!spannerDbList.length" class="empty-row">No databases found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Name</th><th>Dialect</th><th>State</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              <tr v-for="db in spannerDbList" :key="db.name">
                <td>{{ db.name }}</td>
                <td class="text-dim"><span class="badge-format">{{ db.dialect === 'GOOGLE_STANDARD_SQL' ? 'GSQL' : 'PG' }}</span></td>
                <td><span :class="db.state === 'READY' ? 'status-ok' : 'status-warn'">{{ db.state }}</span></td>
                <td class="text-dim">{{ db.created ? new Date(db.created).toLocaleDateString() : '--' }}</td>
                <td>
                  <button class="btn sm accent" @click="openSpannerQuery(spannerInst, db)"><i data-lucide="terminal"></i> Query</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Spanner Query Modal ════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="spannerQOpen" class="gcp-modal-backdrop" @mousedown.self="spannerQOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F50D; Query: {{ spannerQInst?.name }}/{{ spannerQDb?.name }}</span>
          <button class="s3b-close" @click="spannerQOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <textarea v-model="spannerQSql" class="bq-query-editor" rows="5" placeholder="Enter SQL…" spellcheck="false" />
          <div class="bq-query-run">
            <button class="btn accent" :disabled="spannerQRunning" @click="runSpannerQuery">
              <span v-if="spannerQRunning">Running…</span>
              <span v-else><i data-lucide="play"></i> Run Query</span>
            </button>
          </div>
          <div v-if="spannerQError" class="s3b-error">{{ spannerQError }}</div>
          <div v-if="spannerQResult">
            <div class="bq-results-scroll">
              <table class="cloud-table">
                <thead><tr><th v-for="f in spannerQResult.fields" :key="f.name">{{ f.name }}</th></tr></thead>
                <tbody>
                  <tr v-for="(row, idx) in spannerQResult.rows" :key="idx">
                    <td v-for="f in spannerQResult.fields" :key="f.name" class="text-dim">{{ row[f.name] ?? '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Cloud Tasks Modal ══════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="tasksOpen" class="gcp-modal-backdrop" @mousedown.self="tasksOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x23F1; Tasks: {{ tasksQueue?.name }}</span>
          <button class="s3b-close" @click="tasksOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="tasksLoading" class="empty-row">Loading…</div>
          <div v-else-if="tasksError" class="s3b-error">{{ tasksError }}</div>
          <div v-else-if="!tasksList.length" class="empty-row">No tasks in queue.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Task ID</th><th>Scheduled</th><th>Created</th><th>Dispatches</th><th>Responses</th></tr></thead>
            <tbody>
              <tr v-for="t in tasksList" :key="t.name">
                <td class="font-mono" style="font-size:11px">{{ t.name }}</td>
                <td class="text-dim">{{ t.scheduleTime ? new Date(t.scheduleTime).toLocaleString() : '--' }}</td>
                <td class="text-dim">{{ t.createTime  ? new Date(t.createTime).toLocaleString()  : '--' }}</td>
                <td class="text-dim">{{ t.dispatchCount ?? 0 }}</td>
                <td class="text-dim">{{ t.responseCount ?? 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Cloud Build Logs Modal ════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="buildLogsOpen" class="gcp-modal-backdrop" @mousedown.self="buildLogsOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F4CB; Build Logs: {{ buildLogsBuild?.id?.slice(0,8) }}…</span>
          <button class="s3b-close" @click="buildLogsOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body gcp-logs-body">
          <div v-if="buildLogsLoading" class="empty-row">Loading…</div>
          <div v-else-if="buildLogsError" class="s3b-error">{{ buildLogsError }}</div>
          <div v-else-if="!buildLogsList.length" class="empty-row">No log lines available.</div>
          <div v-else class="gcp-log-list">
            <div v-for="(line, idx) in buildLogsList" :key="idx" class="gcp-log-entry">
              <span class="gcp-log-msg">{{ line }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ IAM Keys Modal ════════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="iamKeysOpen" class="gcp-modal-backdrop" @mousedown.self="iamKeysOpen = false">
      <div class="gcp-modal">
        <div class="gcp-modal-header">
          <span>&#x1F511; Keys: {{ iamKeysSa?.email }}</span>
          <button class="s3b-close" @click="iamKeysOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="iamKeysLoading" class="empty-row">Loading…</div>
          <div v-else-if="iamKeysError" class="s3b-error">{{ iamKeysError }}</div>
          <div v-else-if="!iamKeysList.length" class="empty-row">No keys found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Key ID</th><th>Type</th><th>Origin</th><th>Algorithm</th><th>Valid After</th><th>Valid Before</th></tr></thead>
            <tbody>
              <tr v-for="k in iamKeysList" :key="k.name">
                <td class="font-mono" style="font-size:11px">{{ k.name?.slice(0,16) }}…</td>
                <td class="text-dim">{{ k.keyType }}</td>
                <td class="text-dim">{{ k.keyOrigin }}</td>
                <td class="text-dim">{{ k.keyAlgorithm }}</td>
                <td class="text-dim">{{ k.validAfter  ? new Date(k.validAfter).toLocaleDateString()  : '--' }}</td>
                <td class="text-dim">{{ k.validBefore ? new Date(k.validBefore).toLocaleDateString() : '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ Job Executions Modal ═══════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="jobExecOpen" class="gcp-modal-backdrop" @mousedown.self="jobExecOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x25B6; Executions: {{ jobExecTarget?.name }}</span>
          <button class="s3b-close" @click="jobExecOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="jobExecLoading" class="empty-row">Loading…</div>
          <div v-else-if="jobExecError" class="s3b-error">{{ jobExecError }}</div>
          <div v-else-if="!jobExecList.length" class="empty-row">No executions found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Execution</th><th>State</th><th>Succeeded</th><th>Failed</th><th>Created</th><th>Completed</th></tr></thead>
            <tbody>
              <tr v-for="e in jobExecList" :key="e.name">
                <td class="font-mono" style="font-size:11px">{{ e.name }}</td>
                <td>
                  <span v-if="e.state === 'EXECUTION_SUCCEEDED'" class="status-ok">Succeeded</span>
                  <span v-else-if="e.state === 'EXECUTION_FAILED'" class="status-err">Failed</span>
                  <span v-else class="status-warn">{{ e.state }}</span>
                </td>
                <td class="text-dim">{{ e.succeeded ?? '--' }}</td>
                <td class="text-dim">{{ e.failed ?? '--' }}</td>
                <td class="text-dim">{{ e.created ? new Date(e.created).toLocaleString() : '--' }}</td>
                <td class="text-dim">{{ e.completed ? new Date(e.completed).toLocaleString() : '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ VPC Subnets Modal ══════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="vpcSubnetsOpen" class="gcp-modal-backdrop" @mousedown.self="vpcSubnetsOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F5A7; Subnets: {{ vpcSubnetsNetwork?.name }}</span>
          <button class="s3b-close" @click="vpcSubnetsOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="vpcSubnetsLoading" class="empty-row">Loading…</div>
          <div v-else-if="vpcSubnetsError" class="s3b-error">{{ vpcSubnetsError }}</div>
          <div v-else-if="!vpcSubnetsList.length" class="empty-row">No subnets found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Name</th><th>Region</th><th>CIDR</th><th>Gateway</th><th>Private Access</th><th>Flow Logs</th></tr></thead>
            <tbody>
              <tr v-for="s in vpcSubnetsList" :key="s.name + s.region">
                <td>{{ s.name }}</td>
                <td class="text-dim">{{ s.region }}</td>
                <td class="font-mono">{{ s.ipRange }}</td>
                <td class="text-dim font-mono">{{ s.gateway }}</td>
                <td><span :class="s.privateAccess ? 'status-ok' : 'text-dim'">{{ s.privateAccess ? 'Yes' : 'No' }}</span></td>
                <td><span :class="s.flowLogs ? 'status-ok' : 'text-dim'">{{ s.flowLogs ? 'Yes' : 'No' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ══ KMS Keys Modal ════════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="kmsKeysOpen" class="gcp-modal-backdrop" @mousedown.self="kmsKeysOpen = false">
      <div class="gcp-modal gcp-modal--wide">
        <div class="gcp-modal-header">
          <span>&#x1F511; Keys: {{ kmsKeysRing?.name }}</span>
          <button class="s3b-close" @click="kmsKeysOpen = false">&#x2715;</button>
        </div>
        <div class="gcp-modal-body">
          <div v-if="kmsKeysLoading" class="empty-row">Loading…</div>
          <div v-else-if="kmsKeysError" class="s3b-error">{{ kmsKeysError }}</div>
          <div v-else-if="!kmsKeysList.length" class="empty-row">No crypto keys found.</div>
          <table v-else class="cloud-table">
            <thead><tr><th>Key Name</th><th>Purpose</th><th>Algorithm</th><th>State</th><th>Next Rotation</th><th>Created</th></tr></thead>
            <tbody>
              <tr v-for="k in kmsKeysList" :key="k.name">
                <td>{{ k.name }}</td>
                <td class="text-dim">{{ k.purpose }}</td>
                <td class="text-dim font-mono" style="font-size:10px">{{ k.algorithm || '--' }}</td>
                <td><span :class="k.state === 'ENABLED' ? 'status-ok' : 'status-warn'">{{ k.state }}</span></td>
                <td class="text-dim">{{ k.nextRotation ? new Date(k.nextRotation).toLocaleDateString() : '--' }}</td>
                <td class="text-dim">{{ k.created ? new Date(k.created).toLocaleDateString() : '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, nextTick, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useEnvStore } from '../../stores/useEnvStore'
import { useGcpStore } from '../../stores/useGcpStore'
import { useToast }    from '../../composables/useToast'
import { useApi }      from '../../composables/useApi'
import GcsBrowser       from './GcsBrowser.vue'
import GcpMetricsChart  from './GcpMetricsChart.vue'

const props = defineProps({
  activeService: { type: String, default: 'cloudrun' },
})

const emit = defineEmits(['connect-gke'])

const envStore = useEnvStore()
const gcpStore = useGcpStore()
const { toast }    = useToast()
const { apiFetch } = useApi()

const selectedProfileId  = ref(gcpStore.activeProfileId || '')
const localConfigs       = ref([])
const connectingCluster  = ref(null)

onMounted(async () => {
  envStore.fetchProfiles()
  try { localConfigs.value = await apiFetch('/api/cloud/gcp/gcloud-configs') } catch { /* gcloud not installed */ }
  if (selectedProfileId.value) loadAllTabs()
  nextTick(() => createIcons({ icons }))
})

watch(() => gcpStore.activeProfileId, (newId) => {
  if ((newId || '') !== selectedProfileId.value) {
    selectedProfileId.value = newId || ''
    if (newId) loadAllTabs()
  }
})

function onProfileChange() {
  gcpStore.setActiveProfile(selectedProfileId.value || null)
  if (selectedProfileId.value) loadAllTabs()
}

const TABS = [
  { id: 'cloudrun',    label: 'Cloud Run' },
  { id: 'gke',         label: 'GKE' },
  { id: 'vms',         label: 'Compute VMs' },
  { id: 'sql',         label: 'Cloud SQL' },
  { id: 'storage',     label: 'Storage' },
  { id: 'functions',   label: 'Functions' },
  { id: 'pubsub',      label: 'Pub/Sub' },
  { id: 'secrets',     label: 'Secret Manager' },
  { id: 'artifact',    label: 'Artifact Registry' },
  { id: 'bigquery',    label: 'BigQuery' },
  { id: 'workflows',   label: 'Workflows' },
  { id: 'dns',         label: 'Cloud DNS' },
  { id: 'firestore',   label: 'Firestore' },
  { id: 'spanner',     label: 'Spanner' },
  { id: 'memorystore', label: 'Memorystore' },
  { id: 'tasks',       label: 'Cloud Tasks' },
  { id: 'scheduler',   label: 'Cloud Scheduler' },
  { id: 'build',       label: 'Cloud Build' },
  { id: 'iam',         label: 'IAM' },
  // Fase 4
  { id: 'cloudrunJobs', label: 'Cloud Run Jobs' },
  { id: 'pubsubSubs',   label: 'Pub/Sub Subs' },
  { id: 'vpc',          label: 'VPC Networks' },
  { id: 'monitoring',   label: 'Monitoring' },
  { id: 'logging',      label: 'Logging' },
  { id: 'kms',          label: 'Cloud KMS' },
]

const activeTab = ref('cloudrun')
const loaded    = reactive({ cloudrun: false, gke: false, vms: false, sql: false, storage: false, functions: false, pubsub: false, secrets: false, artifact: false, bigquery: false, workflows: false, dns: false, firestore: false, spanner: false, memorystore: false, tasks: false, scheduler: false, build: false, iam: false, cloudrunJobs: false, pubsubSubs: false, vpc: false, monitoring: false, logging: false, kms: false })
const search    = ref('')

const fetchMap = {
  cloudrun:    () => gcpStore.fetchCloudRunServices(),
  gke:         () => gcpStore.fetchGkeClusters(),
  vms:         () => gcpStore.fetchVMs(),
  sql:         () => gcpStore.fetchSqlInstances(),
  storage:     () => gcpStore.fetchBuckets(),
  functions:   () => gcpStore.fetchFunctions(),
  pubsub:      () => gcpStore.fetchPubSubTopics(),
  secrets:     () => gcpStore.fetchSecrets(),
  artifact:    () => gcpStore.fetchArtifactRegistry(),
  bigquery:    () => gcpStore.fetchBigQueryDatasets(),
  workflows:   () => gcpStore.fetchWorkflows(),
  dns:         () => gcpStore.fetchDnsZones(),
  firestore:   () => gcpStore.fetchFirestoreDbs(),
  spanner:     () => gcpStore.fetchSpannerInstances(),
  memorystore: () => gcpStore.fetchMemorystore(),
  tasks:       () => gcpStore.fetchTaskQueues(),
  scheduler:   () => gcpStore.fetchSchedulerJobs(),
  build:       () => gcpStore.fetchBuilds(),
  iam:         () => gcpStore.fetchIamServiceAccounts(),
  // Fase 4
  cloudrunJobs: () => gcpStore.fetchCloudRunJobs(),
  pubsubSubs:   () => gcpStore.fetchPubSubSubscriptions(),
  vpc:          () => gcpStore.fetchVpcNetworks(),
  monitoring:   () => gcpStore.fetchAlertPolicies(),
  logging:      () => Promise.resolve(), // query-driven
  kms:          () => gcpStore.fetchKmsKeyrings(),
}

async function loadTab(id) {
  if (loaded[id]) return
  await fetchMap[id]?.()
  loaded[id] = true
}

async function reloadActiveTab(options = {}) {
  loaded[activeTab.value] = false
  if (!options.preserveSearch) search.value = ''
  await loadTab(activeTab.value)
}

defineExpose({ reloadActiveTab })

async function loadAllTabs() {
  gcpStore.setActiveProfile(selectedProfileId.value)
  Object.keys(loaded).forEach(k => { loaded[k] = false })
  await Promise.allSettled(TABS.map(t => loadTab(t.id)))
}

function switchTab(id) {
  activeTab.value = id
  search.value = ''
  loadTab(id)
}

watch(() => props.activeService, (newTab) => {
  if (newTab && newTab !== activeTab.value) switchTab(newTab)
}, { immediate: true })

const currentTab = computed(() => gcpStore.tabs[activeTab.value])
function tabCount(id)    { return gcpStore.tabs[id]?.data?.length ?? 0 }
function tabHasError(id) { return !!gcpStore.tabs[id]?.error }

function filterRows(rows) {
  if (!search.value) return rows
  const q = search.value.toLowerCase()
  return rows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)))
}

const filteredCloudRun   = computed(() => filterRows(gcpStore.tabs.cloudrun.data))
const filteredGke        = computed(() => filterRows(gcpStore.tabs.gke.data))
const filteredVms        = computed(() => filterRows(gcpStore.tabs.vms.data))
const filteredSql        = computed(() => filterRows(gcpStore.tabs.sql.data))
const filteredStorage    = computed(() => filterRows(gcpStore.tabs.storage.data))
const filteredFunctions  = computed(() => filterRows(gcpStore.tabs.functions.data))
const filteredPubSub     = computed(() => filterRows(gcpStore.tabs.pubsub.data))
const filteredSecrets    = computed(() => filterRows(gcpStore.tabs.secrets.data))
const filteredArtifact   = computed(() => filterRows(gcpStore.tabs.artifact.data))
const filteredBigQuery   = computed(() => filterRows(gcpStore.tabs.bigquery.data))
const filteredWorkflows  = computed(() => filterRows(gcpStore.tabs.workflows.data))
const filteredDns        = computed(() => filterRows(gcpStore.tabs.dns.data))
const filteredFirestore  = computed(() => filterRows(gcpStore.tabs.firestore.data))
const filteredSpanner    = computed(() => filterRows(gcpStore.tabs.spanner.data))
const filteredMemory     = computed(() => filterRows(gcpStore.tabs.memorystore.data))
const filteredTasks      = computed(() => filterRows(gcpStore.tabs.tasks.data))
const filteredScheduler  = computed(() => filterRows(gcpStore.tabs.scheduler.data))
const filteredBuild      = computed(() => filterRows(gcpStore.tabs.build.data))
const filteredIam        = computed(() => filterRows(gcpStore.tabs.iam.data))
const filteredCloudRunJobs = computed(() => filterRows(gcpStore.tabs.cloudrunJobs.data))
const filteredPubSubSubs   = computed(() => filterRows(gcpStore.tabs.pubsubSubs.data))
const filteredVpc          = computed(() => filterRows(gcpStore.tabs.vpc.data))
const filteredMonitoring   = computed(() => filterRows(gcpStore.tabs.monitoring.data))
const filteredKms          = computed(() => filterRows(gcpStore.tabs.kms.data))

const filteredRows = computed(() => {
  if (activeTab.value === 'cloudrun')    return filteredCloudRun.value
  if (activeTab.value === 'gke')         return filteredGke.value
  if (activeTab.value === 'vms')         return filteredVms.value
  if (activeTab.value === 'sql')         return filteredSql.value
  if (activeTab.value === 'storage')     return filteredStorage.value
  if (activeTab.value === 'functions')   return filteredFunctions.value
  if (activeTab.value === 'pubsub')      return filteredPubSub.value
  if (activeTab.value === 'secrets')     return filteredSecrets.value
  if (activeTab.value === 'artifact')    return filteredArtifact.value
  if (activeTab.value === 'bigquery')    return filteredBigQuery.value
  if (activeTab.value === 'workflows')   return filteredWorkflows.value
  if (activeTab.value === 'dns')         return filteredDns.value
  if (activeTab.value === 'firestore')   return filteredFirestore.value
  if (activeTab.value === 'spanner')     return filteredSpanner.value
  if (activeTab.value === 'memorystore') return filteredMemory.value
  if (activeTab.value === 'tasks')       return filteredTasks.value
  if (activeTab.value === 'scheduler')   return filteredScheduler.value
  if (activeTab.value === 'build')       return filteredBuild.value
  if (activeTab.value === 'iam')         return filteredIam.value
  if (activeTab.value === 'cloudrunJobs') return filteredCloudRunJobs.value
  if (activeTab.value === 'pubsubSubs')   return filteredPubSubSubs.value
  if (activeTab.value === 'vpc')          return filteredVpc.value
  if (activeTab.value === 'monitoring')   return filteredMonitoring.value
  if (activeTab.value === 'logging')      return gcpStore.tabs.logging.data
  if (activeTab.value === 'kms')          return filteredKms.value
  return []
})

// ─── Fase 4 — reactive state & action functions ───────────────────────────────

// Cloud Run Jobs
const jobExecOpen    = ref(false)
const jobExecTarget  = ref(null)
const jobExecLoading = ref(false)
const jobExecError   = ref(null)
const jobExecList    = ref([])

async function runJob(j) {
  try {
    await gcpStore.runCloudRunJob(j.location, j.name)
    toast(`Job ${j.name} triggered`, 'success')
    loaded.cloudrunJobs = false; loadTab('cloudrunJobs')
  } catch (e) { toast(e.message || 'Error running job', 'error') }
}

async function openJobExecutions(j) {
  jobExecOpen.value   = true
  jobExecTarget.value = j
  jobExecLoading.value = true
  jobExecError.value  = null
  jobExecList.value   = []
  try {
    jobExecList.value = await gcpStore.fetchJobExecutions(j.location, j.name)
  } catch (e) { jobExecError.value = e.message }
  finally { jobExecLoading.value = false }
}

// VPC Networks
const vpcSubnetsOpen    = ref(false)
const vpcSubnetsNetwork = ref(null)
const vpcSubnetsLoading = ref(false)
const vpcSubnetsError   = ref(null)
const vpcSubnetsList    = ref([])

async function openVpcSubnets(n) {
  vpcSubnetsOpen.value    = true
  vpcSubnetsNetwork.value = n
  vpcSubnetsLoading.value = true
  vpcSubnetsError.value   = null
  vpcSubnetsList.value    = []
  try {
    vpcSubnetsList.value = await gcpStore.fetchVpcSubnets(n.name)
  } catch (e) { vpcSubnetsError.value = e.message }
  finally { vpcSubnetsLoading.value = false }
}

// Cloud Logging
const logFilter = ref('')
const logHours  = ref('3')

async function runLogQuery() {
  await gcpStore.queryLogs(logFilter.value, 200, parseInt(logHours.value))
}

function logSevClass(sev) {
  if (!sev) return 'log-default'
  const s = sev.toUpperCase()
  if (s === 'ERROR' || s === 'CRITICAL' || s === 'ALERT' || s === 'EMERGENCY') return 'log-err'
  if (s === 'WARNING') return 'log-warn'
  if (s === 'INFO' || s === 'NOTICE') return 'log-info'
  return 'log-default'
}

// Cloud KMS
const kmsKeysOpen    = ref(false)
const kmsKeysRing    = ref(null)
const kmsKeysLoading = ref(false)
const kmsKeysError   = ref(null)
const kmsKeysList    = ref([])

async function openKmsKeys(k) {
  kmsKeysOpen.value    = true
  kmsKeysRing.value    = k
  kmsKeysLoading.value = true
  kmsKeysError.value   = null
  kmsKeysList.value    = []
  try {
    kmsKeysList.value = await gcpStore.fetchKmsKeys(k.location, k.name)
  } catch (e) { kmsKeysError.value = e.message }
  finally { kmsKeysLoading.value = false }
}

// ─── End Fase 4 ────────────────────────────────────────────────────────────────

async function startCloudRun(svc) {
  const res = await gcpStore.startCloudRunService(svc.region, svc.name)
  if (res) { toast(`Started ${svc.name}`, 'success'); loaded.cloudrun = false; loadTab('cloudrun') }
  else      toast(gcpStore.tabs.cloudrun.error || 'Error', 'error')
}
async function stopCloudRun(svc) {
  const res = await gcpStore.stopCloudRunService(svc.region, svc.name)
  if (res) { toast(`Stopped ${svc.name}`, 'success'); loaded.cloudrun = false; loadTab('cloudrun') }
  else      toast(gcpStore.tabs.cloudrun.error || 'Error', 'error')
}
async function startVM(vm) {
  const res = await gcpStore.startVM(vm.zone, vm.name)
  if (res) { toast(`Starting ${vm.name}`, 'success'); setTimeout(() => { loaded.vms = false; loadTab('vms') }, 3000) }
  else      toast(gcpStore.tabs.vms.error || 'Error', 'error')
}
async function stopVM(vm) {
  const res = await gcpStore.stopVM(vm.zone, vm.name)
  if (res) { toast(`Stopping ${vm.name}`, 'success'); setTimeout(() => { loaded.vms = false; loadTab('vms') }, 3000) }
  else      toast(gcpStore.tabs.vms.error || 'Error', 'error')
}
async function startSql(inst) {
  const res = await gcpStore.startSqlInstance(inst.name)
  if (res) { toast(`Starting ${inst.name}`, 'success'); loaded.sql = false; loadTab('sql') }
  else      toast(gcpStore.tabs.sql.error || 'Error', 'error')
}
async function stopSql(inst) {
  const res = await gcpStore.stopSqlInstance(inst.name)
  if (res) { toast(`Stopping ${inst.name}`, 'success'); loaded.sql = false; loadTab('sql') }
  else      toast(gcpStore.tabs.sql.error || 'Error', 'error')
}

function statusClass(s) {
  if (!s) return ''
  const l = s.toLowerCase()
  if (l === 'ready' || l === 'running') return 'status-ok'
  if (l === 'reconciling')              return 'status-warn'
  return 'status-err'
}
function gkeStatusClass(s) {
  if (!s) return ''
  if (s === 'RUNNING')                              return 'status-ok'
  if (s === 'PROVISIONING' || s === 'RECONCILING') return 'status-warn'
  return 'status-err'
}
async function connectGke(cluster) {
  connectingCluster.value = cluster.name
  try {
    // 1. Get a kubeconfig for this cluster from the GCP backend
    const result = await apiFetch(
      `/api/cloud/gcp/gke/${encodeURIComponent(cluster.location)}/${encodeURIComponent(cluster.name)}/connect`,
      { method: 'POST', headers: { 'X-Profile-Id': selectedProfileId.value } },
    )
    // 2. Import the kubeconfig into KUA
    await apiFetch('/api/kubeconfig/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yamlContent: result.kubeconfig }),
    })
    toast(`Cluster "${cluster.name}" conectado. Contexto: ${result.contextName}`, 'success')
    emit('connect-gke', result.contextName)
  } catch (e) {
    toast(e.message || 'Error al conectar con el cluster', 'error')
  } finally {
    connectingCluster.value = null
  }
}
function vmStatusClass(s) {
  if (!s) return ''
  return s === 'RUNNING' ? 'status-ok' : s === 'STAGING' ? 'status-warn' : 'status-err'
}
function sqlStatusClass(s) {
  if (!s) return ''
  return s === 'RUNNABLE' ? 'status-ok' : s === 'SUSPENDED' ? 'status-warn' : 'status-err'
}
function fnStatusClass(s) {
  if (!s) return ''
  return s === 'ACTIVE' ? 'status-ok' : s === 'DEPLOY_IN_PROGRESS' ? 'status-warn' : 'status-err'
}

// ── GCS Browser ──────────────────────────────────────────────────────────────
const gcsBrowserOpen   = ref(false)
const gcsBrowserBucket = ref('')
function openGcsBrowser(bucket) {
  gcsBrowserBucket.value = bucket
  gcsBrowserOpen.value   = true
}

// ── GCP Log color helper ──────────────────────────────────────────────────────
function gcpLogColor(severity) {
  const s = (severity || '').toUpperCase()
  if (['ERROR','CRITICAL','ALERT','EMERGENCY'].includes(s)) return 'color:#f87171'
  if (s === 'WARNING') return 'color:#fbbf24'
  if (['INFO','NOTICE'].includes(s)) return 'color:#4ade80'
  return 'color:var(--text-dim)'
}

// ── Cloud Run master-detail panel ─────────────────────────────────────────────
const crPanel = reactive({
  resource: null, tab: 'overview',
  detail: null, detailLoading: false, detailError: null,
  logs: [], logsLoading: false, logsError: null, logsHours: 3
})
function selectCloudRun(svc) {
  const same = crPanel.resource?.name === svc.name
  crPanel.resource = svc
  if (!same) { crPanel.tab = 'overview'; crPanel.detail = null; crPanel.logs = [] }
  crSwitchTab(crPanel.tab)
}
async function crSwitchTab(tab) {
  crPanel.tab = tab
  const svc = crPanel.resource; if (!svc) return
  if (tab === 'overview' || tab === 'revisions' || tab === 'variables') {
    if (crPanel.detail && crPanel.detail._svc === svc.name) return
    crPanel.detailLoading = true; crPanel.detailError = null
    try {
      const d = await gcpStore.fetchCloudRunDetail(svc.region, svc.name)
      crPanel.detail = { ...d, _svc: svc.name }
    } catch (e) { crPanel.detailError = e.message }
    finally { crPanel.detailLoading = false }
  } else if (tab === 'logs') {
    crPanel.logsLoading = true; crPanel.logsError = null
    try {
      const r = await gcpStore.fetchCloudRunLogs(svc.region, svc.name, { hours: crPanel.logsHours })
      crPanel.logs = r?.entries || []
    } catch (e) { crPanel.logsError = e.message }
    finally { crPanel.logsLoading = false }
  } else if (tab === 'metrics') {
    await loadMetrics(crMetrics, CR_METRICS, svc)
  }
}
async function crLoadLogs() {
  const svc = crPanel.resource; if (!svc) return
  crPanel.logsLoading = true; crPanel.logsError = null
  try {
    const r = await gcpStore.fetchCloudRunLogs(svc.region, svc.name, { hours: crPanel.logsHours })
    crPanel.logs = r?.entries || []
  } catch (e) { crPanel.logsError = e.message }
  finally { crPanel.logsLoading = false }
}

// ── Compute VMs master-detail panel ──────────────────────────────────────────
const vmPanel = reactive({
  resource: null, tab: 'overview',
  detail: null, detailLoading: false, detailError: null,
  logs: [], logsLoading: false, logsError: null, logsHours: 3
})
function selectVm(vm) {
  const same = vmPanel.resource?.name === vm.name && vmPanel.resource?.zone === vm.zone
  vmPanel.resource = vm
  if (!same) { vmPanel.tab = 'overview'; vmPanel.detail = null; vmPanel.logs = [] }
  vmSwitchTab(vmPanel.tab)
}
async function vmSwitchTab(tab) {
  vmPanel.tab = tab
  const vm = vmPanel.resource; if (!vm) return
  if (tab === 'overview' || tab === 'disks' || tab === 'network') {
    if (vmPanel.detail && vmPanel.detail._key === `${vm.zone}/${vm.name}`) return
    vmPanel.detailLoading = true; vmPanel.detailError = null
    try {
      const d = await gcpStore.fetchVmDetail(vm.zone, vm.name)
      vmPanel.detail = { ...d, _key: `${vm.zone}/${vm.name}` }
    } catch (e) { vmPanel.detailError = e.message }
    finally { vmPanel.detailLoading = false }
  } else if (tab === 'logs') {
    await vmLoadLogs()
  } else if (tab === 'metrics') {
    const target = { ...vm, instanceId: vmPanel.detail?.instanceId }
    await loadMetrics(vmMetrics, VM_METRICS, target)
  }
}
async function vmLoadLogs() {
  const vm = vmPanel.resource; if (!vm) return
  vmPanel.logsLoading = true; vmPanel.logsError = null
  try {
    const r = await gcpStore.fetchVmLogs(vm.zone, vm.name, { hours: vmPanel.logsHours })
    vmPanel.logs = r?.entries || []
  } catch (e) { vmPanel.logsError = e.message }
  finally { vmPanel.logsLoading = false }
}

// ── Cloud SQL master-detail panel ─────────────────────────────────────────────
const sqlPanel = reactive({
  resource: null, tab: 'overview',
  detail: null, detailLoading: false, detailError: null,
  logs: [], logsLoading: false, logsError: null, logsHours: 3
})
function selectSql(inst) {
  const same = sqlPanel.resource?.name === inst.name
  sqlPanel.resource = inst
  if (!same) { sqlPanel.tab = 'overview'; sqlPanel.detail = null; sqlPanel.logs = [] }
  sqlSwitchTab(sqlPanel.tab)
}
async function sqlSwitchTab(tab) {
  sqlPanel.tab = tab
  const inst = sqlPanel.resource; if (!inst) return
  if (tab === 'overview' || tab === 'config' || tab === 'connection') {
    if (sqlPanel.detail && sqlPanel.detail._inst === inst.name) return
    sqlPanel.detailLoading = true; sqlPanel.detailError = null
    try {
      const d = await gcpStore.fetchSqlDetail(inst.name)
      sqlPanel.detail = { ...d, _inst: inst.name }
    } catch (e) { sqlPanel.detailError = e.message }
    finally { sqlPanel.detailLoading = false }
  } else if (tab === 'logs') {
    await sqlLoadLogs()
  } else if (tab === 'metrics') {
    await loadMetrics(sqlMetrics, SQL_METRICS, inst)
  }
}
async function sqlLoadLogs() {
  const inst = sqlPanel.resource; if (!inst) return
  sqlPanel.logsLoading = true; sqlPanel.logsError = null
  try {
    const r = await gcpStore.fetchSqlLogs(inst.name, { hours: sqlPanel.logsHours })
    sqlPanel.logs = r?.entries || []
  } catch (e) { sqlPanel.logsError = e.message }
  finally { sqlPanel.logsLoading = false }
}

// ── Cloud Functions master-detail panel ───────────────────────────────────────
const fnPanel = reactive({
  resource: null, tab: 'overview',
  detail: null, detailLoading: false, detailError: null,
  logs: [], logsLoading: false, logsError: null, logsHours: 3,
  invokePayload: '{}', invokeResult: null, invoking: false
})
function selectFn(fn) {
  const same = fnPanel.resource?.name === fn.name
  fnPanel.resource = fn
  if (!same) { fnPanel.tab = 'overview'; fnPanel.detail = null; fnPanel.logs = []; fnPanel.invokeResult = null }
  fnSwitchTab(fnPanel.tab)
}
async function fnSwitchTab(tab) {
  fnPanel.tab = tab
  const fn = fnPanel.resource; if (!fn) return
  if (tab === 'overview' || tab === 'variables') {
    if (fnPanel.detail && fnPanel.detail._fn === fn.name) return
    fnPanel.detailLoading = true; fnPanel.detailError = null
    try {
      const d = await gcpStore.fetchFunctionDetail(fn.location, fn.name)
      fnPanel.detail = { ...d, _fn: fn.name }
    } catch (e) { fnPanel.detailError = e.message }
    finally { fnPanel.detailLoading = false }
  } else if (tab === 'logs') {
    await fnLoadLogs()
  } else if (tab === 'metrics') {
    await loadMetrics(fnMetrics, FN_METRICS, fn)
  }
}
async function fnLoadLogs() {
  const fn = fnPanel.resource; if (!fn) return
  fnPanel.logsLoading = true; fnPanel.logsError = null
  try {
    const r = await gcpStore.fetchFunctionLogs(fn.location, fn.name, { hours: fnPanel.logsHours })
    fnPanel.logs = r?.entries || []
  } catch (e) { fnPanel.logsError = e.message }
  finally { fnPanel.logsLoading = false }
}
function fnPanelInvoke() { fnPanel.tab = 'invoke' }
async function fnPanelDoInvoke() {
  const fn = fnPanel.resource; if (!fn) return
  fnPanel.invoking = true; fnPanel.invokeResult = null
  try {
    let payload = {}
    try { payload = JSON.parse(fnPanel.invokePayload || '{}') } catch { toast('Invalid JSON payload', 'error'); return }
    const res = await gcpStore.invokeFunction(fn.location, fn.name, payload)
    fnPanel.invokeResult = typeof res === 'string' ? res : JSON.stringify(res, null, 2)
  } catch (e) { toast(e.message, 'error') }
  finally { fnPanel.invoking = false }
}

// ── Artifact Registry master-detail panel ─────────────────────────────────────
const arPanel = reactive({
  repo: null, tab: 'packages', info: null,
  pkgs: [], pkgsLoading: false,
  selectedPkg: null, tags: [], tagsLoading: false,
  // Deploy state
  deployImage: '', deployNs: '', deployDeployment: null, deployContainer: '',
  deployContainers: [], deployments: [], namespaces: [],
  nsLoading: false, depsLoading: false, deploying: false, deployResult: null,
})

async function selectArtifactRepo(repo) {
  const same = arPanel.repo?.name === repo.name
  arPanel.repo = repo
  if (!same) {
    arPanel.tab = 'packages'; arPanel.info = null
    arPanel.pkgs = []; arPanel.selectedPkg = null; arPanel.tags = []
    arPanel.deployImage = ''; arPanel.deployResult = null
    // Load packages + repo info in parallel
    arPanel.pkgsLoading = true
    const [pkgs, info] = await Promise.all([
      gcpStore.fetchArtifactPackages(repo.location, repo.name).catch(() => []),
      gcpStore.fetchArtifactRepoInfo(repo.location, repo.name).catch(() => null),
    ])
    arPanel.pkgs = pkgs || []
    arPanel.info = info
    arPanel.pkgsLoading = false
  }
}

function arSwitchTab(tab) {
  arPanel.tab = tab
  if (tab === 'deploy' && !arPanel.namespaces.length) arLoadNamespaces()
}

async function selectArtifactPkg(pkg) {
  arPanel.selectedPkg = pkg
  arPanel.tags = []; arPanel.tagsLoading = true
  try {
    const tags = await gcpStore.fetchArtifactTags(arPanel.repo.location, arPanel.repo.name, pkg.name)
    arPanel.tags = tags || []
  } catch (e) { toast(e.message, 'error') }
  finally { arPanel.tagsLoading = false }
}

function arStartDeploy(tag) {
  // Build full image reference
  const prefix = arPanel.info?.imagePrefix || `${arPanel.repo.location}-docker.pkg.dev`
  const pkgName = arPanel.selectedPkg?.displayName || arPanel.selectedPkg?.name || ''
  arPanel.deployImage = `${prefix}/${pkgName}:${tag.name}`
  arPanel.deployResult = null
  arPanel.tab = 'deploy'
  if (!arPanel.namespaces.length) arLoadNamespaces()
}

async function arLoadNamespaces() {
  arPanel.nsLoading = true
  try {
    const resp = await fetch('/api/namespaces')
    const data = await resp.json()
    arPanel.namespaces = (data || []).map(ns => ns.name || ns).filter(Boolean)
  } catch (e) { toast('Could not load namespaces: ' + e.message, 'error') }
  finally { arPanel.nsLoading = false }
}

async function arLoadDeployments() {
  if (!arPanel.deployNs) { arPanel.deployments = []; return }
  arPanel.depsLoading = true; arPanel.deployDeployment = null; arPanel.deployContainer = ''; arPanel.deployContainers = []
  try {
    const resp = await fetch(`/api/${encodeURIComponent(arPanel.deployNs)}/deployments`)
    const data = await resp.json()
    arPanel.deployments = data || []
  } catch (e) { toast('Could not load deployments: ' + e.message, 'error') }
  finally { arPanel.depsLoading = false }
}

function arOnDeploymentSelect() {
  const d = arPanel.deployDeployment
  arPanel.deployContainers = d?.containers || []
  arPanel.deployContainer = arPanel.deployContainers.length === 1 ? arPanel.deployContainers[0] : ''
}

async function arApplyDeploy() {
  if (!arPanel.deployImage || !arPanel.deployNs || !arPanel.deployDeployment || !arPanel.deployContainer) return
  arPanel.deploying = true; arPanel.deployResult = null
  const ns   = arPanel.deployNs
  const name = arPanel.deployDeployment.name
  const container = arPanel.deployContainer
  const image = arPanel.deployImage
  try {
    const resp = await fetch(`/api/${encodeURIComponent(ns)}/deployments/${encodeURIComponent(name)}/set-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container, image }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || resp.statusText)
    arPanel.deployResult = { ok: true, msg: `✓ ${name}/${container} → ${image.split('/').pop()}` }
    toast(`Deployed ${image.split('/').pop()} to ${name}`, 'success')
  } catch (e) {
    arPanel.deployResult = { ok: false, msg: `✗ ${e.message}` }
    toast(e.message, 'error')
  } finally { arPanel.deploying = false }
}

// ── Cloud Monitoring metrics ──────────────────────────────────────────────────
const crMetrics  = reactive({ loading: false, error: null, hours: 1, data: {} })
const vmMetrics  = reactive({ loading: false, error: null, hours: 1, data: {} })
const sqlMetrics = reactive({ loading: false, error: null, hours: 1, data: {} })
const fnMetrics  = reactive({ loading: false, error: null, hours: 1, data: {} })

async function loadMetrics(panel, metrics, target) {
  panel.loading = true; panel.error = null; panel.data = {}
  try {
    const results = await Promise.all(
      metrics.map(m => gcpStore.fetchMonitoringTimeSeries(m.metric, m.filter(target), {
        hours: panel.hours, aligner: m.aligner || 'ALIGN_MEAN', period: m.period || '60', reducer: m.reducer || 'REDUCE_MEAN'
      }).catch(() => ({ points: [] })))
    )
    const data = {}
    metrics.forEach((m, i) => { data[m.key] = results[i]?.points || [] })
    panel.data = data
  } catch (e) { panel.error = e.message }
  finally { panel.loading = false }
}

const CR_METRICS = [
  { key: 'requests', metric: 'run.googleapis.com/request_count',
    filter: s => `resource.type="cloud_run_revision" AND resource.labels.service_name="${s.name}"`,
    aligner: 'ALIGN_RATE', label: 'Request Rate', unit: 'req/s', color: '#818cf8' },
  { key: 'latency', metric: 'run.googleapis.com/request_latencies',
    filter: s => `resource.type="cloud_run_revision" AND resource.labels.service_name="${s.name}"`,
    aligner: 'ALIGN_PERCENTILE_99', label: 'Latency p99', unit: 'ms', color: '#f59e0b' },
  { key: 'instances', metric: 'run.googleapis.com/container/instance_count',
    filter: s => `resource.type="cloud_run_revision" AND resource.labels.service_name="${s.name}"`,
    aligner: 'ALIGN_MEAN', label: 'Instances', unit: '', color: '#34d399' },
]

const VM_METRICS = [
  { key: 'cpu', metric: 'compute.googleapis.com/instance/cpu/utilization',
    filter: s => `resource.type="gce_instance" AND resource.labels.instance_id="${s.instanceId || s.name}"`,
    aligner: 'ALIGN_MEAN', label: 'CPU Utilization', unit: '%',
    color: '#f87171', fmt: v => (v * 100).toFixed(1) + '%' },
  { key: 'netIn', metric: 'compute.googleapis.com/instance/network/received_bytes_count',
    filter: s => `resource.type="gce_instance" AND resource.labels.instance_id="${s.instanceId || s.name}"`,
    aligner: 'ALIGN_RATE', label: 'Network In', unit: 'B/s', color: '#818cf8' },
  { key: 'diskRead', metric: 'compute.googleapis.com/instance/disk/read_bytes_count',
    filter: s => `resource.type="gce_instance" AND resource.labels.instance_id="${s.instanceId || s.name}"`,
    aligner: 'ALIGN_RATE', label: 'Disk Read', unit: 'B/s', color: '#34d399' },
]

const SQL_METRICS = [
  { key: 'cpu', metric: 'cloudsql.googleapis.com/database/cpu/utilization',
    filter: s => `resource.type="cloudsql_database" AND resource.labels.database_id=ends_with("${s.name}")`,
    aligner: 'ALIGN_MEAN', label: 'CPU Utilization', unit: '%',
    color: '#f87171', fmt: v => (v * 100).toFixed(1) + '%' },
  { key: 'connections', metric: 'cloudsql.googleapis.com/database/network/connections',
    filter: s => `resource.type="cloudsql_database" AND resource.labels.database_id=ends_with("${s.name}")`,
    aligner: 'ALIGN_MEAN', label: 'Connections', unit: '', color: '#818cf8' },
  { key: 'diskBytes', metric: 'cloudsql.googleapis.com/database/disk/bytes_used',
    filter: s => `resource.type="cloudsql_database" AND resource.labels.database_id=ends_with("${s.name}")`,
    aligner: 'ALIGN_MEAN', label: 'Disk Used', unit: 'B', color: '#34d399' },
]

const FN_METRICS = [
  { key: 'executions', metric: 'cloudfunctions.googleapis.com/function/execution_count',
    filter: f => `resource.type="cloud_function" AND resource.labels.function_name="${f.name}"`,
    aligner: 'ALIGN_RATE', label: 'Executions', unit: 'req/s', color: '#818cf8' },
  { key: 'duration', metric: 'cloudfunctions.googleapis.com/function/execution_times',
    filter: f => `resource.type="cloud_function" AND resource.labels.function_name="${f.name}"`,
    aligner: 'ALIGN_PERCENTILE_99', label: 'Duration p99', unit: 'ns', color: '#f59e0b' },
  { key: 'active', metric: 'cloudfunctions.googleapis.com/function/active_instances',
    filter: f => `resource.type="cloud_function" AND resource.labels.function_name="${f.name}"`,
    aligner: 'ALIGN_MEAN', label: 'Active Instances', unit: '', color: '#34d399' },
]

// ── Function Invoke ──────────────────────────────────────────────────────────
const fnInvokeOpen    = ref(false)
const fnInvokeTarget  = ref(null)
const fnInvokePayload = ref('')
const fnInvokeResult  = ref(null)
const fnInvoking      = ref(false)
function openFnInvoke(fn) {
  fnInvokeTarget.value  = fn
  fnInvokePayload.value = '{}'
  fnInvokeResult.value  = null
  fnInvokeOpen.value    = true
}
async function doInvokeFunction() {
  if (!fnInvokeTarget.value) return
  fnInvoking.value = true
  fnInvokeResult.value = null
  try {
    let payload = {}
    try { payload = JSON.parse(fnInvokePayload.value || '{}') } catch { toast('Invalid JSON payload', 'error'); return }
    const res = await gcpStore.invokeFunction(fnInvokeTarget.value.location, fnInvokeTarget.value.name, payload)
    fnInvokeResult.value = res
  } catch (e) { toast(e.message, 'error') }
  finally { fnInvoking.value = false }
}

// ── Function Logs ─────────────────────────────────────────────────────────────
const fnLogsOpen    = ref(false)
const fnLogsTarget  = ref(null)
const fnLogsEntries = ref([])
const fnLogsLoading = ref(false)
const fnLogsError   = ref(null)
function openFnLogs(fn) {
  fnLogsTarget.value  = fn
  fnLogsEntries.value = []
  fnLogsError.value   = null
  fnLogsOpen.value    = true
  loadFnLogs(fn)
}
async function loadFnLogs(fn) {
  fnLogsLoading.value = true
  try {
    const res = await gcpStore.fetchFunctionLogs(fn.location, fn.name)
    fnLogsEntries.value = res?.entries || []
  } catch (e) { fnLogsError.value = e.message }
  finally { fnLogsLoading.value = false }
}
function logSeverityClass(s) {
  if (!s) return ''
  if (s === 'ERROR' || s === 'CRITICAL' || s === 'ALERT' || s === 'EMERGENCY') return 'log-err'
  if (s === 'WARNING') return 'log-warn'
  if (s === 'INFO') return 'log-info'
  return 'log-default'
}

// ── Resource Logs (cloudrun, gke, vms, sql, workflows) ──────────────────────
const resLogsOpen    = ref(false)
const resLogsType    = ref('')
const resLogsTarget  = ref(null)
const resLogsEntries = ref([])
const resLogsLoading = ref(false)
const resLogsError   = ref(null)

async function openLogs(type, target) {
  resLogsType.value   = type
  resLogsTarget.value = target
  resLogsEntries.value = []
  resLogsError.value   = null
  resLogsOpen.value    = true
  await reloadResLogs()
}

async function reloadResLogs() {
  const type   = resLogsType.value
  const target = resLogsTarget.value
  if (!target) return
  resLogsLoading.value = true
  resLogsError.value   = null
  try {
    let res
    switch (type) {
      case 'cloudrun':
        res = await gcpStore.fetchCloudRunLogs(target.region, target.name)
        break
      case 'gke':
        res = await gcpStore.fetchGkeLogs(target.location, target.name)
        break
      case 'vms':
        res = await gcpStore.fetchVmSerialLog(target.zone, target.name)
        break
      case 'sql':
        res = await gcpStore.fetchSqlLogs(target.name)
        break
      case 'workflows':
        res = await gcpStore.fetchWorkflowLogs(target.location || target.region, target.name)
        break
      default:
        resLogsError.value = `Unknown log type: ${type}`
        return
    }
    resLogsEntries.value = res?.entries || []
  } catch (e) { resLogsError.value = e.message }
  finally { resLogsLoading.value = false }
}

// ── Secret Manager ───────────────────────────────────────────────────────────
const secretPreviewOpen  = ref(false)
const secretPreviewName  = ref('')
const secretPreviewKeys  = ref([])
const secretPreviewLoading = ref(false)
const secretPreviewError = ref(null)
const secretSelectedKeys = ref([])
const secretImportProfile = ref('')
const secretImportName   = ref('')
const secretImporting    = ref(false)

function toggleSecretKey(k) {
  const idx = secretSelectedKeys.value.findIndex(s => s.original === k.original)
  if (idx >= 0) secretSelectedKeys.value.splice(idx, 1)
  else          secretSelectedKeys.value.push(k)
}
function isSecretKeySelected(k) {
  return secretSelectedKeys.value.some(s => s.original === k.original)
}

async function openSecretPreview(s) {
  secretPreviewName.value    = s.name
  secretPreviewKeys.value    = []
  secretPreviewError.value   = null
  secretSelectedKeys.value   = []
  secretImportProfile.value  = ''
  secretImportName.value     = `Secret: ${s.name}`
  secretPreviewOpen.value    = true
  secretPreviewLoading.value = true
  try {
    const res = await gcpStore.previewSecretKeys(s.name)
    secretPreviewKeys.value = res?.keys || []
  } catch (e) { secretPreviewError.value = e.message }
  finally { secretPreviewLoading.value = false }
}

async function doImportSecretKeys() {
  if (!secretSelectedKeys.value.length) { toast('Select at least one key', 'warn'); return }
  secretImporting.value = true
  try {
    const body = {
      selectedKeys: secretSelectedKeys.value,
      ...(secretImportProfile.value ? { targetProfileId: secretImportProfile.value } : { targetProfileName: secretImportName.value }),
    }
    const res = await gcpStore.importSecretKeys(secretPreviewName.value, body)
    toast(`Imported ${res.keysImported} key(s) to "${secretImportName.value}"`, 'success')
    secretPreviewOpen.value = false
  } catch (e) { toast(e.message, 'error') }
  finally { secretImporting.value = false }
}

// ── Artifact Registry ────────────────────────────────────────────────────────
const artifactPkgOpen    = ref(false)
const artifactPkgRepo    = ref(null)
const artifactPkgList    = ref([])
const artifactPkgLoading = ref(false)
const artifactPkgError   = ref(null)

async function openArtifactPackages(repo) {
  artifactPkgRepo.value    = repo
  artifactPkgList.value    = []
  artifactPkgError.value   = null
  artifactPkgOpen.value    = true
  artifactPkgLoading.value = true
  try {
    const res = await gcpStore.fetchArtifactPackages(repo.location, repo.name)
    artifactPkgList.value = res || []
  } catch (e) { artifactPkgError.value = e.message }
  finally { artifactPkgLoading.value = false }
}
// ── BigQuery ────────────────────────────────────────────────────────────────
const bqTablesOpen    = ref(false)
const bqTablesDataset = ref(null)
const bqTablesList    = ref([])
const bqTablesLoading = ref(false)
const bqTablesError   = ref(null)

const bqQueryOpen     = ref(false)
const bqQueryDataset  = ref(null)
const bqQueryText     = ref('')
const bqQueryResult   = ref(null)
const bqQueryRunning  = ref(false)
const bqQueryError    = ref(null)

async function openBqTables(dataset) {
  bqTablesDataset.value  = dataset
  bqTablesList.value     = []
  bqTablesError.value    = null
  bqTablesOpen.value     = true
  bqTablesLoading.value  = true
  try {
    bqTablesList.value = await gcpStore.fetchBigQueryTables(dataset.id)
  } catch (e) { bqTablesError.value = e.message }
  finally { bqTablesLoading.value = false }
}

function openBqQuery(dataset) {
  bqQueryDataset.value = dataset
  bqQueryText.value    = `SELECT * FROM \`${dataset.id}\`.\`\` LIMIT 100`
  bqQueryResult.value  = null
  bqQueryError.value   = null
  bqQueryOpen.value    = true
}

async function runBqQuery() {
  if (!bqQueryText.value.trim()) return
  bqQueryRunning.value = true
  bqQueryError.value   = null
  bqQueryResult.value  = null
  try {
    let res = await gcpStore.runBigQuery(bqQueryText.value)
    // Poll if not immediately complete (max 5 retries × 2s)
    let tries = 0
    while (res?.pending && tries < 5) {
      await new Promise(r => setTimeout(r, 2000))
      res = await gcpStore.pollBigQueryJob(res.jobId)
      tries++
    }
    if (res?.pending) {
      bqQueryError.value = `Query still running (jobId: ${res.jobId}). Try again in a few seconds.`
    } else {
      bqQueryResult.value = res
    }
  } catch (e) { bqQueryError.value = e.message }
  finally { bqQueryRunning.value = false }
}

function bqFormatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

// ── Cloud Workflows ─────────────────────────────────────────────────────────
const wfExecOpen    = ref(false)
const wfExecTarget  = ref(null)
const wfExecList    = ref([])
const wfExecLoading = ref(false)
const wfExecError   = ref(null)

const wfDefOpen     = ref(false)
const wfDefTarget   = ref(null)
const wfDefSource   = ref('')
const wfDefLoading  = ref(false)
const wfDefError    = ref(null)

async function openWfExecutions(wf) {
  wfExecTarget.value  = wf
  wfExecList.value    = []
  wfExecError.value   = null
  wfExecOpen.value    = true
  wfExecLoading.value = true
  try {
    wfExecList.value = await gcpStore.fetchWorkflowExecutions(wf.location, wf.name)
  } catch (e) { wfExecError.value = e.message }
  finally { wfExecLoading.value = false }
}

async function openWfDefinition(wf) {
  wfDefTarget.value  = wf
  wfDefSource.value  = ''
  wfDefError.value   = null
  wfDefOpen.value    = true
  wfDefLoading.value = true
  try {
    const res = await gcpStore.fetchWorkflowDefinition(wf.location, wf.name)
    wfDefSource.value = res?.sourceContents || ''
  } catch (e) { wfDefError.value = e.message }
  finally { wfDefLoading.value = false }
}

function wfStateClass(s) {
  if (!s) return ''
  if (s === 'SUCCEEDED') return 'status-ok'
  if (s === 'ACTIVE')    return 'status-ok'
  if (s === 'RUNNING')   return 'status-warn'
  if (s === 'FAILED' || s === 'CANCELLED') return 'status-err'
  return ''
}

// ── Cloud DNS ───────────────────────────────────────────────────────────────
const dnsRecordsOpen    = ref(false)
const dnsRecordsZone    = ref(null)
const dnsRecordsList    = ref([])
const dnsRecordsLoading = ref(false)
const dnsRecordsError   = ref(null)
const dnsRecordsSearch  = ref('')

const filteredDnsRecords = computed(() => {
  const q = dnsRecordsSearch.value.trim().toLowerCase()
  if (!q) return dnsRecordsList.value
  return dnsRecordsList.value.filter(r =>
    r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q) || r.data.toLowerCase().includes(q)
  )
})

async function openDnsRecords(zone) {
  dnsRecordsZone.value    = zone
  dnsRecordsList.value    = []
  dnsRecordsError.value   = null
  dnsRecordsSearch.value  = ''
  dnsRecordsOpen.value    = true
  dnsRecordsLoading.value = true
  try {
    dnsRecordsList.value = await gcpStore.fetchDnsRecords(zone.name)
  } catch (e) { dnsRecordsError.value = e.message }
  finally { dnsRecordsLoading.value = false }
}

// ── Firestore ───────────────────────────────────────────────────────────────
const fsColOpen     = ref(false)
const fsColDb       = ref(null)
const fsColList     = ref([])
const fsColLoading  = ref(false)
const fsColError    = ref(null)

const fsDocsOpen    = ref(false)
const fsDocsDb      = ref(null)
const fsDocsCol     = ref(null)
const fsDocsList    = ref([])
const fsDocsLoading = ref(false)
const fsDocsError   = ref(null)
const fsDocsNext    = ref(null)

async function openFsCollections(db) {
  fsColDb.value      = db
  fsColList.value    = []
  fsColError.value   = null
  fsColOpen.value    = true
  fsColLoading.value = true
  try {
    fsColList.value = await gcpStore.fetchFirestoreCollections(db.name)
  } catch (e) { fsColError.value = e.message }
  finally { fsColLoading.value = false }
}

async function openFsDocuments(db, col, pageToken = null) {
  if (!pageToken) {
    fsDocsDb.value      = db
    fsDocsCol.value     = col
    fsDocsList.value    = []
    fsDocsError.value   = null
    fsDocsNext.value    = null
    fsDocsOpen.value    = true
  }
  fsDocsLoading.value = true
  try {
    const res = await gcpStore.fetchFirestoreDocuments(db.name, col.id, pageToken ? { pageToken } : {})
    fsDocsList.value.push(...(res.docs || []))
    fsDocsNext.value = res.nextPageToken || null
  } catch (e) { fsDocsError.value = e.message }
  finally { fsDocsLoading.value = false }
}

function fsFieldValue(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ── Cloud Spanner ────────────────────────────────────────────────────────────
const spannerDbOpen    = ref(false)
const spannerInst      = ref(null)
const spannerDbList    = ref([])
const spannerDbLoading = ref(false)
const spannerDbError   = ref(null)

const spannerQOpen    = ref(false)
const spannerQInst    = ref(null)
const spannerQDb      = ref(null)
const spannerQSql     = ref('')
const spannerQResult  = ref(null)
const spannerQRunning = ref(false)
const spannerQError   = ref(null)

async function openSpannerDbs(inst) {
  spannerInst.value      = inst
  spannerDbList.value    = []
  spannerDbError.value   = null
  spannerDbOpen.value    = true
  spannerDbLoading.value = true
  try {
    spannerDbList.value = await gcpStore.fetchSpannerDatabases(inst.name)
  } catch (e) { spannerDbError.value = e.message }
  finally { spannerDbLoading.value = false }
}

function openSpannerQuery(inst, db) {
  spannerQInst.value   = inst
  spannerQDb.value     = db
  spannerQSql.value    = 'SELECT * FROM INFORMATION_SCHEMA.TABLES LIMIT 20'
  spannerQResult.value = null
  spannerQError.value  = null
  spannerQOpen.value   = true
}

async function runSpannerQuery() {
  if (!spannerQSql.value.trim()) return
  spannerQRunning.value = true
  spannerQError.value   = null
  spannerQResult.value  = null
  try {
    spannerQResult.value = await gcpStore.querySpanner(spannerQInst.value.name, spannerQDb.value.name, spannerQSql.value)
  } catch (e) { spannerQError.value = e.message }
  finally { spannerQRunning.value = false }
}

// ── Cloud Tasks ──────────────────────────────────────────────────────────────
const tasksOpen    = ref(false)
const tasksQueue   = ref(null)
const tasksList    = ref([])
const tasksLoading = ref(false)
const tasksError   = ref(null)

async function openTasksList(queue) {
  tasksQueue.value   = queue
  tasksList.value    = []
  tasksError.value   = null
  tasksOpen.value    = true
  tasksLoading.value = true
  try {
    tasksList.value = await gcpStore.fetchQueueTasks(queue.location, queue.name)
  } catch (e) { tasksError.value = e.message }
  finally { tasksLoading.value = false }
}

// ── Cloud Scheduler ──────────────────────────────────────────────────────────
const schedulerActionLoading = ref(null)  // holds job name while action is in progress

async function schedulerRun(job) {
  schedulerActionLoading.value = job.name
  try {
    await gcpStore.runSchedulerJob(job.location, job.name)
    toast(`Job ${job.name} triggered`, 'success')
  } catch (e) { toast(e.message, 'error') }
  finally { schedulerActionLoading.value = null }
}

async function schedulerPause(job) {
  schedulerActionLoading.value = job.name
  try {
    await gcpStore.pauseSchedulerJob(job.location, job.name)
    toast(`Job ${job.name} paused`, 'success')
    await gcpStore.fetchSchedulerJobs()
  } catch (e) { toast(e.message, 'error') }
  finally { schedulerActionLoading.value = null }
}

async function schedulerResume(job) {
  schedulerActionLoading.value = job.name
  try {
    await gcpStore.resumeSchedulerJob(job.location, job.name)
    toast(`Job ${job.name} resumed`, 'success')
    await gcpStore.fetchSchedulerJobs()
  } catch (e) { toast(e.message, 'error') }
  finally { schedulerActionLoading.value = null }
}

function schedulerStateClass(s) {
  if (!s) return ''
  if (s === 'ENABLED') return 'status-ok'
  if (s === 'PAUSED')  return 'status-warn'
  if (s === 'DISABLED') return 'status-err'
  return ''
}

// ── Cloud Build ──────────────────────────────────────────────────────────────
const buildLogsOpen    = ref(false)
const buildLogsBuild   = ref(null)
const buildLogsList    = ref([])
const buildLogsLoading = ref(false)
const buildLogsError   = ref(null)

async function openBuildLogs(build) {
  buildLogsBuild.value   = build
  buildLogsList.value    = []
  buildLogsError.value   = null
  buildLogsOpen.value    = true
  buildLogsLoading.value = true
  try {
    const res = await gcpStore.fetchBuildLogs(build.id)
    buildLogsList.value = res.lines || []
  } catch (e) { buildLogsError.value = e.message }
  finally { buildLogsLoading.value = false }
}

function buildStatusClass(s) {
  if (!s) return ''
  if (s === 'SUCCESS')  return 'status-ok'
  if (s === 'FAILURE' || s === 'INTERNAL_ERROR' || s === 'TIMEOUT' || s === 'CANCELLED') return 'status-err'
  if (s === 'WORKING')  return 'status-warn'
  return ''
}

function buildDuration(ms) {
  if (!ms) return '--'
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// ── IAM Service Accounts ─────────────────────────────────────────────────────
const iamKeysOpen    = ref(false)
const iamKeysSa      = ref(null)
const iamKeysList    = ref([])
const iamKeysLoading = ref(false)
const iamKeysError   = ref(null)

async function openIamKeys(sa) {
  iamKeysSa.value      = sa
  iamKeysList.value    = []
  iamKeysError.value   = null
  iamKeysOpen.value    = true
  iamKeysLoading.value = true
  try {
    iamKeysList.value = await gcpStore.fetchIamKeys(sa.email)
  } catch (e) { iamKeysError.value = e.message }
  finally { iamKeysLoading.value = false }
}</script>

<style scoped>
.api-disabled-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 6px;
  font-size: 12px;
  color: #fca5a5;
  flex-wrap: wrap;
  word-break: break-word;
}
.tab-badge-err {
  background: rgba(239, 68, 68, 0.75) !important;
}
.tab-panel { margin-top: 8px; }
.row-actions { display: flex; gap: 4px; }
.gke-name { font-weight: 500; }
.gke-connect-btn { display: inline-flex; align-items: center; gap: 4px; }
.gke-connect-btn i { width: 13px; height: 13px; }
.badge-autopilot {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
  white-space: nowrap;
}
.badge-standard {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(107, 114, 128, 0.18);
  color: #9ca3af;
  white-space: nowrap;
}
.badge-format {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(124, 169, 248, 0.15);
  color: #7ca9f8;
}

/* ── GCP Modals (Invoke, Logs, Secrets, Artifact) ── */
.gcp-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 800;
}
.gcp-modal {
  background: #0d1117; border: 1px solid #30363d; border-radius: 10px;
  width: min(94vw, 640px); max-height: 80vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 50px rgba(0,0,0,.6);
}
.gcp-modal--wide { width: min(98vw, 960px); }
.gcp-modal-wide { width: min(98vw, 860px); }
.gcp-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; background: #161b22; border-bottom: 1px solid #21262d;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
}
.gcp-modal-body { padding: 14px 16px; overflow-y: auto; }
.gcp-modal-actions { display: flex; gap: 8px; margin-top: 8px; }
.gcp-label { font-size: 11px; color: #8b949e; margin-bottom: 4px; display: block; }
.gcp-code-input {
  width: 100%; box-sizing: border-box;
  background: #161b22; border: 1px solid #30363d; border-radius: 6px;
  color: #e6edf3; font-family: monospace; font-size: 12px; padding: 8px;
  resize: vertical; outline: none;
}
.gcp-code-input:focus { border-color: #58a6ff; }
.gcp-code-result {
  font-size: 11px; font-family: monospace; background: #161b22;
  border: 1px solid #21262d; border-radius: 6px; padding: 10px;
  overflow: auto; max-height: 260px; white-space: pre-wrap; word-break: break-all;
  color: #e6edf3; margin: 6px 0 0; display: block;
}
/* Logs */
.gcp-logs-body { padding: 0; }
.gcp-log-list { font-family: monospace; font-size: 11px; }
.gcp-log-entry {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 4px 12px; border-bottom: 1px solid #0d1117;
}
.gcp-log-entry:hover { background: #161b22; }
.gcp-log-ts      { color: #8b949e; flex-shrink: 0; width: 80px; }
.gcp-log-sev     { flex-shrink: 0; width: 30px; font-weight: 700; }
.gcp-log-msg     { flex: 1; white-space: pre-wrap; word-break: break-all; color: #e6edf3; }
.log-err     { color: #f85149; }
.log-warn    { color: #d29922; }
.log-info    { color: #58a6ff; }
.log-default { color: #8b949e; }
/* Secrets */
.gcp-key-list  { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; max-height: 260px; overflow-y: auto; }
.gcp-key-row   { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.gcp-key-row:hover { background: #161b22; }
.gcp-key-name  { font-family: monospace; flex: 1; }
.gcp-key-preview { font-family: monospace; font-size: 11px; }
.gcp-sep       { border: none; border-top: 1px solid #21262d; margin: 12px 0; }
/* BigQuery */
.bq-query-editor {
  width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px;
  background: #161b22; border: 1px solid #30363d; border-radius: 6px;
  color: #e6edf3; padding: 8px; resize: vertical; outline: none;
}
.bq-query-editor:focus { border-color: #58a6ff; }
.bq-query-run { display: flex; justify-content: flex-end; margin: 6px 0; }
.bq-row-count { font-size: 11px; margin-bottom: 6px; }
.bq-results-scroll { overflow-x: auto; }
/* Workflows definition */
.wf-def-source {
  font-family: monospace; font-size: 11px; background: #161b22;
  border: 1px solid #21262d; border-radius: 6px; padding: 12px;
  overflow: auto; max-height: 500px; white-space: pre; color: #e6edf3;
  margin: 0;
}
/* Firestore */
.fs-doc-fields { max-width: 480px; white-space: normal; }
.fs-field-chip {
  display: inline-block; background: #161b22; border: 1px solid #21262d;
  border-radius: 4px; padding: 1px 5px; font-size: 10px; margin: 2px 2px 2px 0;
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fs-load-more { text-align: center; padding: 10px 0; }
.font-mono { font-family: monospace; }
/* Fase 4 – Monitoring */
.monitoring-row { display: flex; flex-direction: column; gap: 16px; padding: 8px; }
.monitoring-section { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.monitoring-title { padding: 6px 12px; font-size: 12px; font-weight: 600; background: #161b22; border-bottom: 1px solid var(--border); }
/* Fase 4 – Logging */
.logging-query-bar { display: flex; gap: 8px; padding: 8px; background: var(--bg-panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
</style>

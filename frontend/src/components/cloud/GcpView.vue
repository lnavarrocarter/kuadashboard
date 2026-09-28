<template>
  <div class="cloud-view">

    <!-- No profile -->
    <div v-if="!selectedProfileId" class="empty-state">
      Select a GCP credential profile in the top header to load resources.<br />
      <span class="text-dim">No profile? Use the <strong>Env Manager</strong> button (key icon) to create one.</span>
    </div>

    <template v-else>

      <ApmObservabilityView
        v-show="activeTab === 'apm'"
        ref="apmViewRef"
        provider="gcp"
        :profile-id="selectedProfileId"
        :application-id="applicationId"
        :focus-resource="apmFocusResource"
        :platform-resources="apmPlatformResources"
        @open-architecture="context => emit('open-architecture', context)"
      />

      <!-- Toolbar -->
      <div v-if="activeTab !== 'apm'" class="aws-toolbar">
        <input v-model="search" class="ctrl-input aws-search" placeholder="Filter..." />
        <span class="text-dim" style="font-size:12px">
          <template v-if="currentTab.loading">Loading...</template>
          <template v-else>{{ filteredRows.length }} result{{ filteredRows.length !== 1 ? 's' : '' }}</template>
        </span>
        <button class="btn sm" @click="reloadActiveTab" :disabled="currentTab.loading" title="Refresh"><i data-lucide="refresh-cw"></i></button>
      </div>

      <!-- Permission denied banner -->
      <div v-if="activeTab !== 'apm' && currentTab.error" class="api-disabled-banner">
        <span>{{ currentTab.error }}</span>
        <a v-if="currentTab.enableUrl" :href="currentTab.enableUrl" target="_blank"
           class="btn sm" style="margin-left:12px;white-space:nowrap;flex-shrink:0">
          Enable API
        </a>
      </div>

      <!-- Cloud Run -->
      <div v-show="activeTab === 'cloudrun'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div class="gcp-list-toolbar">
          <span class="text-dim">{{ filteredCloudRun.length }} servicio(s)</span>
          <span class="gcp-toolbar-actions">
            <button class="btn sm" :title="pollingTitle" @click="pollingModal.open = true">⏱ Historial: {{ pollingBadge }}</button>
            <button class="btn sm primary" data-test="create-cloudrun" @click="openCreate('cloudrun')">＋ Nuevo servicio</button>
          </span>
        </div>
        <div v-if="gcpStore.tabs.cloudrun.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.cloudrun.error && !filteredCloudRun.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredCloudRun.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud Run services found.' }}</div>
        <SplitPane v-else :split="!!crPanel.resource" storage-key="gcp-cloudrun">
          <template #top>
  <div class="gcp-list-table">
            <table class="cloud-table gcp-table" data-test="cloudrun-table">
              <thead><tr>
                <th>Servicio</th><th>Estado</th><th>Imagen</th><th>CPU / Mem</th><th>Instancias</th><th>Ingress</th><th>Revisión</th><th>Actualizado</th><th>Acciones</th>
              </tr></thead>
              <tbody>
                <tr v-for="svc in filteredCloudRun" :key="`${svc.region}/${svc.name}`"
                  :class="{ 'row-selected': crPanel.resource?.name === svc.name && crPanel.resource?.region === svc.region }"
                  @click="selectCloudRun(svc)">
                  <td>
                    <div class="fw-medium">{{ svc.name }}</div>
                    <div class="text-dim mono-xs">{{ svc.region }}</div>
                  </td>
                  <td>
                    <span :class="statusClass(svc.status)">{{ svc.status }}</span>
                    <div v-if="svc.statusMessage && svc.status === 'failed'" class="text-dim mono-xs gcp-ellipsis" :title="svc.statusMessage">{{ svc.statusMessage }}</div>
                  </td>
                  <td class="mono-xs text-dim gcp-ellipsis" :title="svc.image">{{ shortImage(svc.image) }}</td>
                  <td class="text-dim">{{ svc.cpu || '—' }} / {{ svc.memory || '—' }}</td>
                  <td>
                    <span :class="svc.minInstances > 0 ? 'gcp-chip warm' : 'gcp-chip'" :title="svc.minInstances > 0 ? 'Instancias siempre encendidas: facturan 24/7' : 'Escala a cero'">{{ svc.minInstances }}–{{ svc.maxInstances ?? '∞' }}</span>
                  </td>
                  <td class="text-dim">{{ svc.ingress || '—' }}</td>
                  <td class="mono-xs text-dim">
                    {{ svc.latestRevision || '—' }}
                    <span v-if="svc.revisionPending" class="status-warn" title="Hay una revisión más nueva que aún no recibe tráfico"> ●</span>
                  </td>
                  <td class="text-dim" style="white-space:nowrap">{{ svc.updatedAt ? new Date(svc.updatedAt).toLocaleString() : '—' }}</td>
                  <td @click.stop>
                    <div class="row-actions">
                      <button class="btn sm" data-test="start" @click="requestAction('cloudrun', 'start', svc)" :title="'Fijar min instances = 1'">▶ Start</button>
                      <button class="btn sm" data-test="stop" :disabled="svc.minInstances === 0" @click="requestAction('cloudrun', 'stop', svc)" :title="'Fijar min instances = 0'">■ Stop</button>
                      <button class="btn sm danger" data-test="delete" @click="requestAction('cloudrun', 'delete', svc)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </template>
          <template #bottom>
          <!-- detail -->
          <div v-if="crPanel.resource" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <!-- Header -->
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ crPanel.resource.name }}</div>
                <span :class="statusClass(crPanel.resource.status)" style="font-size:11px">{{ crPanel.resource.status }}</span>
                <a v-if="crPanel.resource.uri" :href="crPanel.resource.uri" target="_blank" class="link" style="font-size:11px">↗ Open URL</a>
                <div style="margin-left:auto;display:flex;gap:6px">
                  <button class="btn sm" @click="requestAction('cloudrun', 'start', crPanel.resource)">▶ Start</button>
                  <button class="btn sm" @click="requestAction('cloudrun', 'stop', crPanel.resource)">■ Stop</button>
                  <button class="btn sm danger" @click="requestAction('cloudrun', 'delete', crPanel.resource)">🗑 Eliminar</button>
                  <button class="btn sm" title="Cerrar detalle" @click="crPanel.resource = null">✕</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ crPanel.resource.region }}</div>
            </div>
            <!-- Tabs -->
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in CR_TABS" :key="t.id"
                :class="['aws-tab-btn', crPanel.tab === t.id ? 'active' : '']" @click="crSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- DETAIL SECTIONS -->
            <div v-show="['overview','revisions','variables'].includes(crPanel.tab)" style="flex:1;overflow:auto;padding:14px 16px">
              <div v-if="crPanel.detailLoading" class="gi-empty" style="text-align:center;padding:32px">Cargando detalle…</div>
              <div v-else-if="crPanel.detailError" class="alert-error">{{ crPanel.detailError }}</div>
              <GcpCloudRunInfo v-else-if="crPanel.detail" :detail="crPanel.detail" :section="crPanel.tab" />
            </div>
            <!-- LABELS -->
            <div v-show="crPanel.tab === 'labels'" style="flex:1;overflow:auto;padding:14px 16px">
              <div v-if="crPanel.detailLoading" class="gi-empty">Cargando detalle…</div>
              <div v-else-if="crPanel.detailError" class="alert-error">{{ crPanel.detailError }}</div>
              <GcpLabelsEditor v-else-if="crPanel.detail" :labels="crPanel.detail.labels" :busy="labelsState.busy" :error="labelsState.kind === 'cloudrun' ? labelsState.error : ''"
                @save="saveLabels('cloudrun', crPanel.resource, $event)" />
            </div>
            <!-- HISTORY -->
            <div v-show="crPanel.tab === 'history'" style="flex:1;overflow:auto;padding:14px 16px">
              <GcpStateTimeline v-if="crPanel.resource" resource-type="gcp-cloud-run" :resource-key="`${crPanel.resource.region}/${crPanel.resource.name}`"
                :active="crPanel.tab === 'history'" :reload-token="historyToken" @configure="pollingModal.open = true" />
            </div>
            <!-- LOGS -->
            <div v-show="crPanel.tab === 'logs'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center">
                <select v-model="crPanel.logsHours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">Last 1h</option><option :value="3">Last 3h</option><option :value="6">Last 6h</option><option :value="24">Last 24h</option><option :value="72">Last 3d</option>
                </select>
                <button class="btn sm" @click="crLoadLogs()" :disabled="crPanel.logsLoading">{{ crPanel.logsLoading ? 'Loading...' : 'Refresh' }}</button>
                <button class="btn sm" @click="openCloudRunConsole(crPanel.resource)">Open in Console</button>
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
          </template>
        </SplitPane>
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
        <div class="gcp-list-toolbar">
          <span class="text-dim">{{ filteredVms.length }} VM(s)</span>
          <span class="gcp-toolbar-actions">
            <button class="btn sm" :title="pollingTitle" data-test="polling-open" @click="pollingModal.open = true">⏱ Historial: {{ pollingBadge }}</button>
            <button class="btn sm primary" data-test="create-vm" @click="openCreate('vm')">＋ Nueva VM</button>
          </span>
        </div>
        <div v-if="gcpStore.tabs.vms.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.vms.error && !filteredVms.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredVms.length" class="empty-row">{{ search ? 'No matches.' : 'No Compute Engine VMs found.' }}</div>
        <SplitPane v-else :split="!!vmPanel.resource" storage-key="gcp-vms">
          <template #top>
  <div class="gcp-list-table">
            <table class="cloud-table gcp-table" data-test="vm-table">
              <thead><tr>
                <th>VM</th><th>Estado</th><th>Tipo</th><th>IP interna</th><th>IP externa</th><th>Red</th><th>Discos</th><th>Protección</th><th>Creada</th><th>Acciones</th>
              </tr></thead>
              <tbody>
                <tr v-for="vm in filteredVms" :key="`${vm.zone}/${vm.name}`"
                  :class="{ 'row-selected': vmPanel.resource?.name === vm.name && vmPanel.resource?.zone === vm.zone }"
                  @click="selectVm(vm)">
                  <td>
                    <div class="fw-medium">{{ vm.name }}</div>
                    <div class="text-dim mono-xs">{{ vm.zone }}</div>
                  </td>
                  <td><span :class="vmStatusClass(vm.status)">{{ vm.status }}</span></td>
                  <td>
                    <span class="mono-xs">{{ vm.machineType }}</span>
                    <span v-if="vm.provisioningModel === 'SPOT' || vm.provisioningModel === 'PREEMPTIBLE'" class="gcp-chip warm" title="Puede ser detenida por Google">{{ vm.provisioningModel === 'SPOT' ? 'Spot' : 'Preemptible' }}</span>
                  </td>
                  <td class="mono-xs">{{ vm.internalIp || '—' }}</td>
                  <td class="mono-xs">{{ vm.externalIp || '—' }}</td>
                  <td class="text-dim mono-xs">{{ vm.network || '—' }}<template v-if="vm.subnetwork && vm.subnetwork !== vm.network"> / {{ vm.subnetwork }}</template></td>
                  <td class="text-dim">{{ vm.diskCount ?? '—' }}<template v-if="vm.diskSizeGb"> · {{ vm.diskSizeGb }} GB</template></td>
                  <td><span v-if="vm.deletionProtection" class="gcp-chip ok" title="Protección contra eliminación">🔒</span><span v-else class="text-dim">—</span></td>
                  <td class="text-dim" style="white-space:nowrap">{{ vm.createdAt ? new Date(vm.createdAt).toLocaleDateString() : '—' }}</td>
                  <td @click.stop>
                    <div class="row-actions">
                      <button class="btn sm" data-test="start" :disabled="vm.status !== 'TERMINATED' && vm.status !== 'SUSPENDED'" @click="requestAction('vm', 'start', vm)">▶ Start</button>
                      <button class="btn sm" data-test="ssh" :disabled="vm.status !== 'RUNNING'" title="Abrir una sesión SSH en la consola" @click="requestAction('vm', 'ssh', vm)">⌨ SSH</button>
                      <button class="btn sm" data-test="stop" :disabled="vm.status !== 'RUNNING'" @click="requestAction('vm', 'stop', vm)">■ Stop</button>
                      <button class="btn sm danger" data-test="delete" @click="requestAction('vm', 'delete', vm)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </template>
          <template #bottom>
          <!-- detail -->
          <div v-if="vmPanel.resource" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ vmPanel.resource.name }}</div>
                <span :class="vmStatusClass(vmPanel.resource.status)" style="font-size:11px">{{ vmPanel.resource.status }}</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                  <button class="btn sm" @click="requestAction('vm', 'start', vmPanel.resource)" :disabled="vmPanel.resource.status !== 'TERMINATED' && vmPanel.resource.status !== 'SUSPENDED'">▶ Start</button>
                  <button class="btn sm" @click="requestAction('vm', 'ssh', vmPanel.resource)" :disabled="vmPanel.resource.status !== 'RUNNING'">⌨ SSH</button>
                  <button class="btn sm" @click="requestAction('vm', 'stop', vmPanel.resource)" :disabled="vmPanel.resource.status !== 'RUNNING'">■ Stop</button>
                  <button class="btn sm danger" @click="requestAction('vm', 'delete', vmPanel.resource)">🗑 Eliminar</button>
                  <button class="btn sm" title="Cerrar detalle" @click="vmPanel.resource = null">✕</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ vmPanel.resource.zone }} · {{ vmPanel.resource.machineType }}</div>
            </div>
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in VM_TABS" :key="t.id"
                :class="['aws-tab-btn', vmPanel.tab === t.id ? 'active' : '']" @click="vmSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- DETAIL SECTIONS -->
            <div v-show="['overview','disks','network'].includes(vmPanel.tab)" style="flex:1;overflow:auto;padding:14px 16px">
              <div v-if="vmPanel.detailLoading" class="gi-empty" style="text-align:center;padding:32px">Cargando detalle…</div>
              <div v-else-if="vmPanel.detailError" class="alert-error">{{ vmPanel.detailError }}</div>
              <GcpVmInfo v-else-if="vmPanel.detail" :detail="vmPanel.detail" :section="vmPanel.tab" />
            </div>
            <!-- LABELS -->
            <div v-show="vmPanel.tab === 'labels'" style="flex:1;overflow:auto;padding:14px 16px">
              <div v-if="vmPanel.detailLoading" class="gi-empty">Cargando detalle…</div>
              <div v-else-if="vmPanel.detailError" class="alert-error">{{ vmPanel.detailError }}</div>
              <GcpLabelsEditor v-else-if="vmPanel.detail" :labels="vmPanel.detail.labels" :busy="labelsState.busy" :error="labelsState.kind === 'vm' ? labelsState.error : ''"
                @save="saveLabels('vm', vmPanel.resource, $event)" />
            </div>
            <!-- HISTORY -->
            <div v-show="vmPanel.tab === 'history'" style="flex:1;overflow:auto;padding:14px 16px">
              <GcpStateTimeline v-if="vmPanel.resource" resource-type="gcp-vm" :resource-key="`${vmPanel.resource.zone}/${vmPanel.resource.name}`"
                :active="vmPanel.tab === 'history'" :reload-token="historyToken" @configure="pollingModal.open = true" />
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
          </template>
        </SplitPane>
      </div>

      <!-- Cloud SQL -->
      <div v-show="activeTab === 'sql'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div class="gcp-list-toolbar">
          <span class="text-dim">{{ filteredSql.length }} instancia(s)</span>
          <span class="gcp-toolbar-actions">
            <button class="btn sm" :title="pollingTitle" @click="pollingModal.open = true">⏱ Historial: {{ pollingBadge }}</button>
            <button class="btn sm primary" data-test="create-sql" @click="openCreate('sql')">＋ Nueva instancia</button>
          </span>
        </div>
        <div v-if="gcpStore.tabs.sql.loading" class="empty-row">Loading...</div>
        <div v-else-if="gcpStore.tabs.sql.error && !filteredSql.length" class="empty-row text-dim">API not available — see banner above.</div>
        <div v-else-if="!filteredSql.length" class="empty-row">{{ search ? 'No matches.' : 'No Cloud SQL instances found.' }}</div>
        <SplitPane v-else :split="!!sqlPanel.resource" storage-key="gcp-sql">
          <template #top>
  <div class="gcp-list-table">
            <table class="cloud-table gcp-table" data-test="sql-table">
              <thead><tr>
                <th>Instancia</th><th>Estado</th><th>Motor</th><th>Tier</th><th>Disponibilidad</th><th>Almacenamiento</th><th>Backups</th><th>IP pública</th><th>IP privada</th><th>Acciones</th>
              </tr></thead>
              <tbody>
                <tr v-for="inst in filteredSql" :key="inst.name"
                  :class="{ 'row-selected': sqlPanel.resource?.name === inst.name }"
                  @click="selectSql(inst)">
                  <td>
                    <div class="fw-medium">{{ inst.name }}</div>
                    <div class="text-dim mono-xs">{{ inst.zone || inst.region }}</div>
                  </td>
                  <td>
                    <span :class="sqlStatusClass(inst.status || inst.state)" :title="`state: ${inst.state} · activationPolicy: ${inst.activationPolicy || '—'}`">{{ inst.status || inst.state }}</span>
                    <span v-if="inst.deletionProtection" class="gcp-chip ok" title="Protección contra eliminación">🔒</span>
                  </td>
                  <td class="mono-xs">{{ inst.database }}</td>
                  <td class="mono-xs">{{ inst.tier }}<div v-if="inst.edition" class="text-dim">{{ inst.edition }}</div></td>
                  <td><span :class="inst.availabilityType === 'REGIONAL' ? 'gcp-chip ok' : 'text-dim'">{{ inst.availabilityType === 'REGIONAL' ? 'HA' : (inst.availabilityType ? 'Zonal' : '—') }}</span></td>
                  <td class="text-dim">{{ inst.storageGb ? `${inst.storageGb} GB` : '—' }} <span class="mono-xs">{{ inst.storageType || '' }}</span></td>
                  <td><span :class="inst.backupEnabled ? 'status-ok' : 'status-warn'">{{ inst.backupEnabled ? 'Sí' : 'No' }}</span></td>
                  <td class="mono-xs">{{ inst.publicIp || '—' }}</td>
                  <td class="mono-xs">{{ inst.privateIp || '—' }}</td>
                  <td @click.stop>
                    <div class="row-actions">
                      <button class="btn sm" data-test="start" :disabled="inst.status !== 'STOPPED'" @click="requestAction('sql', 'start', inst)">▶ Start</button>
                      <button class="btn sm" data-test="stop" :disabled="inst.status !== 'RUNNING'" @click="requestAction('sql', 'stop', inst)">■ Stop</button>
                      <button class="btn sm danger" data-test="delete" @click="requestAction('sql', 'delete', inst)">🗑</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </template>
          <template #bottom>
          <!-- detail -->
          <div v-if="sqlPanel.resource" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-weight:700;font-size:15px">{{ sqlPanel.resource.name }}</div>
                <span :class="sqlStatusClass(sqlPanel.resource.status || sqlPanel.resource.state)" style="font-size:11px">{{ sqlPanel.resource.status || sqlPanel.resource.state }}</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                  <button class="btn sm" @click="requestAction('sql', 'start', sqlPanel.resource)" :disabled="sqlPanel.resource.status !== 'STOPPED'">▶ Start</button>
                  <button class="btn sm" @click="requestAction('sql', 'stop', sqlPanel.resource)" :disabled="sqlPanel.resource.status !== 'RUNNING'">■ Stop</button>
                  <button class="btn sm danger" @click="requestAction('sql', 'delete', sqlPanel.resource)">🗑 Eliminar</button>
                  <button class="btn sm" title="Cerrar detalle" @click="sqlPanel.resource = null">✕</button>
                </div>
              </div>
              <div class="text-dim" style="font-size:11px;margin-top:3px">{{ sqlPanel.resource.database }} · {{ sqlPanel.resource.region }} · {{ sqlPanel.resource.tier }}</div>
            </div>
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
              <button v-for="t in SQL_TABS" :key="t.id"
                :class="['aws-tab-btn', sqlPanel.tab === t.id ? 'active' : '']" @click="sqlSwitchTab(t.id)">{{ t.label }}</button>
            </div>
            <!-- DETAIL SECTIONS -->
            <div v-show="['overview','config','connection'].includes(sqlPanel.tab)" style="flex:1;overflow:auto;padding:14px 16px">
              <div v-if="sqlPanel.detailLoading" class="gi-empty" style="text-align:center;padding:32px">Cargando detalle…</div>
              <div v-else-if="sqlPanel.detailError" class="alert-error">{{ sqlPanel.detailError }}</div>
              <GcpSqlInfo v-else-if="sqlPanel.detail" :detail="sqlPanel.detail" :section="sqlPanel.tab" />
            </div>
            <!-- LABELS -->
            <div v-show="sqlPanel.tab === 'labels'" style="flex:1;overflow:auto;padding:14px 16px">
              <div v-if="sqlPanel.detailLoading" class="gi-empty">Cargando detalle…</div>
              <div v-else-if="sqlPanel.detailError" class="alert-error">{{ sqlPanel.detailError }}</div>
              <GcpLabelsEditor v-else-if="sqlPanel.detail" :labels="sqlPanel.detail.labels" :busy="labelsState.busy" :error="labelsState.kind === 'sql' ? labelsState.error : ''"
                @save="saveLabels('sql', sqlPanel.resource, $event)" />
            </div>
            <!-- HISTORY -->
            <div v-show="sqlPanel.tab === 'history'" style="flex:1;overflow:auto;padding:14px 16px">
              <GcpStateTimeline v-if="sqlPanel.resource" resource-type="gcp-sql" :resource-key="sqlPanel.resource.name"
                :active="sqlPanel.tab === 'history'" :reload-token="historyToken" @configure="pollingModal.open = true" />
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
          </template>
        </SplitPane>
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

  <!-- ══ Create / confirm modals (Cloud Run, VM, Cloud SQL) ═══════════════════ -->
  <GcpPollingSettings :open="pollingModal.open" :profile-id="selectedProfileId" @close="pollingModal.open = false" @saved="onPollingSaved" />
  <GcpCreateModal :open="createModal.open" :kind="createModal.kind" :default-region="defaultGcpRegion"
    @close="createModal.open = false" @created="onCreated" />
  <GcpConfirmModal
    :open="actionModal.open" :title="actionModal.title" :message="actionModal.message" :lines="actionModal.lines"
    :tone="actionModal.tone" :confirm-label="actionModal.confirmLabel" :require-name="actionModal.requireName"
    :cost-ack="actionModal.costAck" :estimate="actionModal.estimate" :estimate-loading="actionModal.estimateLoading"
    :busy="actionModal.busy" :error="actionModal.error" :blocked="actionModal.blocked"
    @cancel="actionModal.open = false" @confirm="runAction" />

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
import { settings as appSettings } from '../../composables/useSettings'
import { createRefreshGate } from '../../composables/refreshGate'
import GcsBrowser       from './GcsBrowser.vue'
import GcpCreateModal   from './GcpCreateModal.vue'
import GcpConfirmModal  from './GcpConfirmModal.vue'
import GcpVmInfo        from './GcpVmInfo.vue'
import SplitPane        from '../SplitPane.vue'
import GcpCloudRunInfo  from './GcpCloudRunInfo.vue'
import GcpSqlInfo       from './GcpSqlInfo.vue'
import GcpLabelsEditor  from './GcpLabelsEditor.vue'
import GcpStateTimeline from './GcpStateTimeline.vue'
import GcpPollingSettings from './GcpPollingSettings.vue'
import './gcpInfo.css'
import { gcpActionConfig } from './gcpActions'
import GcpMetricsChart  from './GcpMetricsChart.vue'
import ApmObservabilityView from './apm/ApmObservabilityView.vue'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useTerminalStreams } from '../../composables/useTerminalStreams'

const props = defineProps({
  activeService: { type: String, default: 'cloudrun' },
  applicationId: { type: String, default: '' },
  environment: { type: String, default: '' },
  apmFocusResource: { type: Object, default: null },
})

const emit = defineEmits(['connect-gke', 'open-architecture'])

const envStore = useEnvStore()
const gcpStore = useGcpStore()
const termStore = useTerminalStore()
const { startSshStream } = useTerminalStreams()
const { toast }    = useToast()
const { apiFetch } = useApi()

const selectedProfileId  = ref(gcpStore.activeProfileId || '')
const localConfigs       = ref([])
const connectingCluster  = ref(null)
const apmViewRef          = ref(null)

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
  { id: 'apm',         label: 'Applications' },
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
const loaded    = reactive({ apm: false, cloudrun: false, gke: false, vms: false, sql: false, storage: false, functions: false, pubsub: false, secrets: false, artifact: false, bigquery: false, workflows: false, dns: false, firestore: false, spanner: false, memorystore: false, tasks: false, scheduler: false, build: false, iam: false, cloudrunJobs: false, pubsubSubs: false, vpc: false, monitoring: false, logging: false, kms: false })
const search    = ref('')

const fetchMap = {
  apm:         async () => {
    await Promise.allSettled([gcpStore.fetchCloudRunServices(), gcpStore.fetchFunctions()])
    await apmViewRef.value?.refreshLocal?.()
  },
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

// Auto-refresh reloads a table at most every `gcpListRefreshSec` (Options);
// the refresh button and tab switches always load.
const refreshGate = createRefreshGate()

async function loadTab(id, options = {}) {
  if (loaded[id]) return
  const load = () => fetchMap[id]?.()
  refreshGate.mark(`${selectedProfileId.value}|${id}`)
  await (options.background ? gcpStore.runInBackground(load) : load())
  loaded[id] = true
}

async function reloadActiveTab(options = {}) {
  if (options.background && refreshGate.fresh(`${selectedProfileId.value}|${activeTab.value}`, appSettings.gcpListRefreshSec)) return
  loaded[activeTab.value] = false
  if (!options.preserveSearch) search.value = ''
  await loadTab(activeTab.value, options)
}

defineExpose({ reloadActiveTab })

async function loadAllTabs() {
  gcpStore.setActiveProfile(selectedProfileId.value)
  Object.keys(loaded).forEach(k => { loaded[k] = false })
  await loadTab(activeTab.value)
}

function switchTab(id) {
  activeTab.value = id
  search.value = ''
  loadTab(id)
}

watch(() => props.activeService, (newTab) => {
  if (newTab && newTab !== activeTab.value) switchTab(newTab)
}, { immediate: true })

const currentTab = computed(() => gcpStore.tabs[activeTab.value] || { data: [], loading: false, error: null })
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
const apmPlatformResources = computed(() => [
  ...gcpStore.tabs.cloudrun.data.map(service => ({
    type: 'gcp-cloud-run', key: `${service.region}/${service.name}`, name: service.name,
    service: service.region, kind: 'Cloud Run Service',
  })),
  ...gcpStore.tabs.functions.data.map(fn => ({
    type: 'gcp-function', key: `${fn.location}/${fn.name}`, name: fn.name,
    service: fn.location, kind: `Cloud Function ${fn.runtime || ''}`.trim(),
  })),
])
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

// ── Start / stop / delete / create with confirmation (Cloud Run, VM, Cloud SQL) ──
// Every action goes through GcpConfirmModal; see gcpActions.js for the warnings,
// cost estimates and typed-name requirements per action.
const TAB_BY_KIND = { cloudrun: 'cloudrun', vm: 'vms', sql: 'sql' }
// Resolved lazily: the detail panels are declared further down in this script
const panelFor = kind => ({ cloudrun: crPanel, vm: vmPanel, sql: sqlPanel })[kind]

const actionModal = reactive({
  open: false, kind: '', action: '', resource: null,
  title: '', message: '', lines: [], tone: 'info', confirmLabel: 'Confirmar',
  requireName: '', costAck: false, blocked: '',
  estimate: null, estimateLoading: false, busy: false, error: '',
})

async function requestAction(kind, action, resource) {
  const cfg = gcpActionConfig(kind, action, resource)
  Object.assign(actionModal, {
    open: true, kind, action, resource,
    title: cfg.title, message: cfg.message || '', lines: cfg.lines || [], tone: cfg.tone,
    confirmLabel: cfg.confirmLabel, requireName: cfg.requireName || '', costAck: !!cfg.costAck,
    blocked: cfg.blocked || '', estimate: null, estimateLoading: !!cfg.estimateSpec, busy: false, error: '',
  })
  if (cfg.estimateSpec) {
    try { actionModal.estimate = await gcpStore.estimateResource(cfg.estimateKind, cfg.estimateSpec) }
    catch (e) { actionModal.estimate = null }
    finally { actionModal.estimateLoading = false }
  }
}

const ACTION_CALLS = {
  cloudrun: { start: r => gcpStore.startCloudRunService(r.region, r.name), stop: r => gcpStore.stopCloudRunService(r.region, r.name) },
  vm:       { start: r => gcpStore.startVM(r.zone, r.name),                stop: r => gcpStore.stopVM(r.zone, r.name) },
  sql:      { start: r => gcpStore.startSqlInstance(r.name),               stop: r => gcpStore.stopSqlInstance(r.name) },
}

async function runAction(acks) {
  const { kind, action, resource } = actionModal
  const tab = TAB_BY_KIND[kind]
  actionModal.busy = true
  actionModal.error = ''
  try {
    if (action === 'ssh') {
      openVmSsh(resource, gcpActionConfig(kind, action, resource).addressType)
      actionModal.open = false
      return
    }
    if (action === 'delete') {
      await gcpStore.deleteResource(kind, resource, acks.confirmName)
      const panel = panelFor(kind)
      if (panel.resource?.name === resource.name) panel.resource = null
      toast(kind === 'sql' ? `Eliminando ${resource.name}…` : `${resource.name} eliminado`, 'success')
    } else {
      const res = await ACTION_CALLS[kind][action](resource)
      if (!res) throw new Error(gcpStore.tabs[tab].error || 'Error')
      toast(`${action === 'start' ? 'Iniciando' : 'Deteniendo'} ${resource.name}`, 'success')
    }
    actionModal.open = false
    historyToken.value++
    refreshTab(tab, kind === 'vm' ? 3000 : 0)
  } catch (e) {
    actionModal.error = e.message
  } finally {
    actionModal.busy = false
  }
}

function refreshTab(tab, delay = 0) {
  const run = () => { loaded[tab] = false; loadTab(tab) }
  if (delay) setTimeout(run, delay)
  else run()
}

// Opens the SSH session as a console tab (same console as EC2 SSH / SSM)
function openVmSsh(vm, addressType) {
  const tab = termStore.openCloudTab('gcp-ssh', `${vm.name} (${vm.zone})`, {
    profileId: selectedProfileId.value,
    environment: props.environment,
    applicationId: props.applicationId,
    target: { name: vm.name, zone: vm.zone, addressType },
  })
  if (!tab.ws) startSshStream(tab)
}

// ── Detail tabs (#81): structured Info sections + labels + history ──────────
const CR_TABS  = [{ id: 'overview', label: 'Resumen' }, { id: 'revisions', label: 'Revisiones' }, { id: 'variables', label: 'Variables' }, { id: 'labels', label: 'Etiquetas' }, { id: 'history', label: 'Historial' }, { id: 'logs', label: 'Logs' }, { id: 'metrics', label: 'Métricas' }]
const VM_TABS  = [{ id: 'overview', label: 'Resumen' }, { id: 'disks', label: 'Discos' }, { id: 'network', label: 'Red' }, { id: 'labels', label: 'Etiquetas' }, { id: 'history', label: 'Historial' }, { id: 'logs', label: 'Logs' }, { id: 'metrics', label: 'Métricas' }]
const SQL_TABS = [{ id: 'overview', label: 'Resumen' }, { id: 'config', label: 'Flags' }, { id: 'connection', label: 'Conexión' }, { id: 'labels', label: 'Etiquetas' }, { id: 'history', label: 'Historial' }, { id: 'logs', label: 'Logs' }, { id: 'metrics', label: 'Métricas' }]

// Bumped after actions so an open history timeline reloads
const historyToken = ref(0)

const labelsState = reactive({ busy: false, error: '', kind: '' })
async function saveLabels(kind, resource, labels) {
  Object.assign(labelsState, { busy: true, error: '', kind })
  try {
    await gcpStore.updateLabels(kind, resource, labels)
    toast(`Etiquetas de ${resource.name} actualizadas`, 'success')
    const panel = panelFor(kind)
    panel.detail = null                      // force a fresh detail (labels come from it)
    if (kind === 'cloudrun') crSwitchTab('labels')
    else if (kind === 'vm') vmSwitchTab('labels')
    else sqlSwitchTab('labels')
    historyToken.value++
    refreshTab(TAB_BY_KIND[kind])
  } catch (e) {
    labelsState.error = e.message
  } finally {
    labelsState.busy = false
  }
}

// Background polling settings for the history (per profile, off by default)
const pollingModal = reactive({ open: false })
const pollingSettings = ref(null)
async function loadPollingSettings() {
  try { pollingSettings.value = await gcpStore.fetchPollSettings() } catch { pollingSettings.value = null }
}
function onPollingSaved(settings) {
  pollingSettings.value = settings
  historyToken.value++
  toast(settings.enabled ? `Sondeo activado cada ${settings.intervalMinutes} min` : 'Sondeo desactivado', 'success')
}
const pollingBadge = computed(() => {
  const s = pollingSettings.value
  if (!s) return '—'
  return s.enabled ? `cada ${s.intervalMinutes < 60 ? `${s.intervalMinutes} min` : `${s.intervalMinutes / 60} h`}` : 'sin sondeo'
})
const pollingTitle = computed(() => 'Historial de estados: configurar el sondeo en segundo plano')
watch(selectedProfileId, id => { if (id) loadPollingSettings() }, { immediate: true })

const createModal = reactive({ open: false, kind: 'cloudrun' })
function openCreate(kind) {
  createModal.kind = kind
  createModal.open = true
}
function onCreated({ kind, name }) {
  createModal.open = false
  toast(kind === 'sql' ? `Creando ${name}… (tarda varios minutos)` : `${name} creado`, 'success')
  refreshTab(TAB_BY_KIND[kind])
}
// Default region for create forms: the first region seen in the current lists
const defaultGcpRegion = computed(() =>
  gcpStore.tabs.cloudrun.data[0]?.region
  || gcpStore.tabs.sql.data[0]?.region
  || gcpStore.tabs.vms.data[0]?.zone?.replace(/-[a-z]$/, '')
  || 'us-central1')

function shortImage(image) {
  if (!image) return '—'
  const last = image.split('/').pop()
  return last.length > 40 ? `${last.slice(0, 40)}…` : last
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
  if (s === 'RUNNABLE' || s === 'RUNNING') return 'status-ok'
  if (s === 'STOPPED') return 'text-dim'
  if (s === 'SUSPENDED' || s === 'PENDING_CREATE' || s === 'MAINTENANCE') return 'status-warn'
  return 'status-err'
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
  if (tab === 'overview' || tab === 'revisions' || tab === 'variables' || tab === 'labels') {
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
  if (tab === 'overview' || tab === 'disks' || tab === 'network' || tab === 'labels') {
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
  if (tab === 'overview' || tab === 'config' || tab === 'connection' || tab === 'labels') {
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

// Cloud Run's inline Logs tab already fetches a snapshot; this opens the same
// service's live tail in the shared Console session instead. `project` is left
// blank — resolveGcpAuth resolves it from the profile server-side, same as the
// snapshot call above never needed a project id from the client either.
function openCloudRunConsole(resource) {
  if (!resource) return
  termStore.openCloudTab('gcp-logs', resource.name, {
    profileId: selectedProfileId.value,
    environment: props.environment,
    applicationId: props.applicationId,
    project: '',
    region: resource.region,
    target: { name: resource.name },
  })
}

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
/* ── Cloud Run / VM / Cloud SQL tables (list above, detail below) ── */
.gcp-toolbar-actions { display: flex; gap: 6px; align-items: center; }
.gcp-list-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; font-size: 12px; }
.gcp-list-table { height: 100%; overflow: auto; }
.gcp-table tbody tr { cursor: pointer; }
.gcp-table tbody tr.row-selected td { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.gcp-table td { vertical-align: top; }
.gcp-ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gcp-chip { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 10px; font-size: 11px; border: 1px solid var(--border); color: var(--text-dim); }
.gcp-chip.warm { border-color: var(--yellow); color: var(--yellow); }
.gcp-chip.ok { border-color: var(--green); color: var(--green); }
.fw-medium { font-weight: 600; }
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

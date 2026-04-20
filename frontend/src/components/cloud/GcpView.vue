<template>
  <div class="cloud-view">
    <div class="cloud-view-header">
      <h2 class="cloud-view-title">Google Cloud Platform</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select v-model="selectedProfileId" class="ctrl-select" @change="onProfileChange">
          <option value="">— Select GCP profile —</option>
          <option v-for="p in envStore.gcpProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button v-if="selectedProfileId" class="btn" @click="refreshAll" :disabled="gcpStore.loading">
          Refresh
        </button>
      </div>
    </div>

    <div v-if="!selectedProfileId" class="empty-state">
      Select a GCP credential profile above to load resources.<br />
      <span class="text-dim">No profile? Go to <strong>Env Manager</strong> to create one.</span>
    </div>

    <template v-else>
      <div v-if="gcpStore.error" class="alert-error">{{ gcpStore.error }}</div>

      <!-- ── Cloud Run ──────────────────────────────────────────────────── -->
      <section class="cloud-section">
        <div class="cloud-section-header">
          <span>Cloud Run Services</span>
          <button class="btn sm" @click="gcpStore.fetchCloudRunServices()">Reload</button>
        </div>
        <div v-if="gcpStore.loading" class="loading-row">Loading…</div>
        <div v-else-if="!gcpStore.cloudRunServices.length" class="empty-row">No Cloud Run services found.</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Region</th><th>Status</th><th>Min</th><th>Max</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="svc in gcpStore.cloudRunServices" :key="svc.name">
              <td><a :href="svc.uri" target="_blank" class="link">{{ svc.name }}</a></td>
              <td>{{ svc.region }}</td>
              <td><span :class="statusClass(svc.status)">{{ svc.status }}</span></td>
              <td>{{ svc.minInstances }}</td>
              <td>{{ svc.maxInstances ?? '—' }}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="btn sm" @click="startCloudRun(svc)">Start</button>
                  <button class="btn sm danger" @click="stopCloudRun(svc)">Stop</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── Compute VMs ────────────────────────────────────────────────── -->
      <section class="cloud-section">
        <div class="cloud-section-header">
          <span>Compute Engine VMs</span>
          <button class="btn sm" @click="gcpStore.fetchVMs()">Reload</button>
        </div>
        <div v-if="gcpStore.loading" class="loading-row">Loading…</div>
        <div v-else-if="!gcpStore.vms.length" class="empty-row">No VMs found.</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Zone</th><th>Machine</th><th>Status</th><th>External IP</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="vm in gcpStore.vms" :key="`${vm.zone}/${vm.name}`">
              <td>{{ vm.name }}</td>
              <td class="text-dim">{{ vm.zone }}</td>
              <td class="text-dim">{{ vm.machineType }}</td>
              <td><span :class="vmStatusClass(vm.status)">{{ vm.status }}</span></td>
              <td class="text-dim">{{ vm.externalIp || '—' }}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="btn sm" @click="gcpStore.startVM(vm.zone, vm.name)">Start</button>
                  <button class="btn sm danger" @click="gcpStore.stopVM(vm.zone, vm.name)">Stop</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── GKE Clusters ───────────────────────────────────────────────── -->
      <section class="cloud-section">
        <div class="cloud-section-header">
          <span>GKE Clusters</span>
          <button class="btn sm" @click="gcpStore.fetchGkeClusters()">Reload</button>
        </div>
        <div v-if="gcpStore.loading" class="loading-row">Loading…</div>
        <div v-else-if="!gcpStore.gkeClusters.length" class="empty-row">No GKE clusters found.</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Location</th><th>Version</th><th>Nodes</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="c in gcpStore.gkeClusters" :key="c.name">
              <td>{{ c.name }}</td>
              <td class="text-dim">{{ c.location }}</td>
              <td class="text-dim">{{ c.version }}</td>
              <td>{{ c.nodeCount }}</td>
              <td><span :class="statusClass(c.status?.toLowerCase())">{{ c.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useEnvStore } from '../../stores/useEnvStore'
import { useGcpStore } from '../../stores/useGcpStore'
import { useToast }    from '../../composables/useToast'

const envStore = useEnvStore()
const gcpStore = useGcpStore()
const { toast } = useToast()

const selectedProfileId = ref(gcpStore.activeProfileId || '')

onMounted(() => {
  envStore.fetchProfiles()
  if (selectedProfileId.value) refreshAll()
})

function onProfileChange() {
  gcpStore.setActiveProfile(selectedProfileId.value || null)
  if (selectedProfileId.value) refreshAll()
}

async function refreshAll() {
  gcpStore.setActiveProfile(selectedProfileId.value)
  await Promise.allSettled([
    gcpStore.fetchCloudRunServices(),
    gcpStore.fetchVMs(),
    gcpStore.fetchGkeClusters(),
  ])
}

async function startCloudRun(svc) {
  const res = await gcpStore.startCloudRunService(svc.region, svc.name)
  if (res) { toast(`Started ${svc.name}`, 'success'); gcpStore.fetchCloudRunServices() }
  else      toast(gcpStore.error || 'Error', 'error')
}

async function stopCloudRun(svc) {
  const res = await gcpStore.stopCloudRunService(svc.region, svc.name)
  if (res) { toast(`Stopped ${svc.name}`, 'success'); gcpStore.fetchCloudRunServices() }
  else      toast(gcpStore.error || 'Error', 'error')
}

function statusClass(s) {
  if (!s) return ''
  const l = s.toLowerCase()
  if (l === 'ready' || l === 'running')   return 'status-ok'
  if (l === 'reconciling')                return 'status-warn'
  return 'status-err'
}
function vmStatusClass(s) {
  if (!s) return ''
  return s === 'RUNNING' ? 'status-ok' : s === 'STAGING' ? 'status-warn' : 'status-err'
}
</script>

<template>
  <div class="cloud-view">
    <div class="cloud-view-header">
      <h2 class="cloud-view-title">Amazon Web Services</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select v-model="selectedProfileId" class="ctrl-select" @change="onProfileChange">
          <option value="">— Select AWS profile —</option>
          <!-- Stored credential profiles -->
          <optgroup v-if="envStore.awsProfiles.length" label="Stored profiles">
            <option v-for="p in envStore.awsProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </optgroup>
          <!-- Local ~/.aws/credentials profiles -->
          <optgroup v-if="localProfiles.length" label="~/.aws/credentials">
            <option v-for="p in localProfiles" :key="`local:${p.name}`" :value="`local:${p.name}`">
              {{ p.name }} ({{ p.region }})
            </option>
          </optgroup>
        </select>
        <button v-if="selectedProfileId" class="btn" @click="refreshAll" :disabled="awsStore.loading">
          Refresh
        </button>
      </div>
    </div>

    <div v-if="!selectedProfileId" class="empty-state">
      Select an AWS credential profile above to load resources.<br />
      <span class="text-dim">No profile? Go to <strong>Env Manager</strong> to create one.</span>
    </div>

    <template v-else>
      <div v-if="awsStore.error" class="alert-error">{{ awsStore.error }}</div>

      <!-- ── EC2 Instances ──────────────────────────────────────────────── -->
      <section class="cloud-section">
        <div class="cloud-section-header">
          <span>EC2 Instances</span>
          <button class="btn sm" @click="awsStore.fetchEc2Instances()">Reload</button>
        </div>
        <div v-if="awsStore.loading" class="loading-row">Loading…</div>
        <div v-else-if="!awsStore.ec2Instances.length" class="empty-row">No EC2 instances found.</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name / ID</th><th>Type</th><th>State</th><th>Public IP</th><th>AZ</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="i in awsStore.ec2Instances" :key="i.id">
              <td>
                <div>{{ i.name }}</div>
                <div class="text-dim" style="font-size:11px">{{ i.id }}</div>
              </td>
              <td class="text-dim">{{ i.type }}</td>
              <td><span :class="ec2StateClass(i.state)">{{ i.state }}</span></td>
              <td class="text-dim">{{ i.publicIp || '—' }}</td>
              <td class="text-dim">{{ i.az }}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="btn sm" @click="startEc2(i)" :disabled="i.state === 'running'">Start</button>
                  <button class="btn sm danger" @click="stopEc2(i)" :disabled="i.state === 'stopped'">Stop</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── ECS Services ───────────────────────────────────────────────── -->
      <section class="cloud-section">
        <div class="cloud-section-header">
          <span>ECS Services</span>
          <button class="btn sm" @click="awsStore.fetchEcsServices()">Reload</button>
        </div>
        <div v-if="awsStore.loading" class="loading-row">Loading…</div>
        <div v-else-if="!awsStore.ecsServices.length" class="empty-row">No ECS services found.</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Service</th><th>Cluster</th><th>Status</th><th>Desired</th><th>Running</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="svc in awsStore.ecsServices" :key="`${svc.cluster}/${svc.name}`">
              <td>{{ svc.name }}</td>
              <td class="text-dim">{{ svc.cluster }}</td>
              <td><span :class="ecsStatusClass(svc.status)">{{ svc.status }}</span></td>
              <td>{{ svc.desired }}</td>
              <td>{{ svc.running }}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="btn sm" @click="startEcs(svc)">Start</button>
                  <button class="btn sm danger" @click="stopEcs(svc)">Stop</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── EKS Clusters ───────────────────────────────────────────────── -->
      <section class="cloud-section">
        <div class="cloud-section-header">
          <span>EKS Clusters</span>
          <button class="btn sm" @click="awsStore.fetchEksClusters()">Reload</button>
        </div>
        <div v-if="awsStore.loading" class="loading-row">Loading…</div>
        <div v-else-if="!awsStore.eksClusters.length" class="empty-row">No EKS clusters found.</div>
        <table v-else class="cloud-table">
          <thead><tr><th>Name</th><th>Region</th><th>Version</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="c in awsStore.eksClusters" :key="c.name">
              <td>{{ c.name }}</td>
              <td class="text-dim">{{ c.region }}</td>
              <td class="text-dim">{{ c.version }}</td>
              <td><span :class="eksStatusClass(c.status)">{{ c.status }}</span></td>
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
import { useAwsStore } from '../../stores/useAwsStore'
import { useToast }    from '../../composables/useToast'
import { useApi }      from '../../composables/useApi'

const envStore = useEnvStore()
const awsStore = useAwsStore()
const { toast }    = useToast()
const { apiFetch } = useApi()

const selectedProfileId = ref(awsStore.activeProfileId || '')
const localProfiles     = ref([])   // [{ name, region }] from ~/.aws/credentials

onMounted(async () => {
  envStore.fetchProfiles()
  try { localProfiles.value = await apiFetch('/api/cloud/aws/local-profiles') } catch { /* ignore */ }
  if (selectedProfileId.value) refreshAll()
})

function onProfileChange() {
  awsStore.setActiveProfile(selectedProfileId.value || null)
  if (selectedProfileId.value) refreshAll()
}

async function refreshAll() {
  awsStore.setActiveProfile(selectedProfileId.value)
  await Promise.allSettled([
    awsStore.fetchEc2Instances(),
    awsStore.fetchEcsServices(),
    awsStore.fetchEksClusters(),
  ])
}

async function startEc2(i) {
  const res = await awsStore.startEc2Instance(i.id)
  if (res) { toast(`Starting ${i.name}`, 'success'); setTimeout(() => awsStore.fetchEc2Instances(), 2000) }
  else      toast(awsStore.error || 'Error', 'error')
}
async function stopEc2(i) {
  const res = await awsStore.stopEc2Instance(i.id)
  if (res) { toast(`Stopping ${i.name}`, 'success'); setTimeout(() => awsStore.fetchEc2Instances(), 2000) }
  else      toast(awsStore.error || 'Error', 'error')
}
async function startEcs(svc) {
  const res = await awsStore.startEcsService(svc.cluster, svc.name)
  if (res) { toast(`Started ${svc.name}`, 'success'); awsStore.fetchEcsServices() }
  else      toast(awsStore.error || 'Error', 'error')
}
async function stopEcs(svc) {
  const res = await awsStore.stopEcsService(svc.cluster, svc.name)
  if (res) { toast(`Stopped ${svc.name}`, 'success'); awsStore.fetchEcsServices() }
  else      toast(awsStore.error || 'Error', 'error')
}

function ec2StateClass(s) {
  if (s === 'running')  return 'status-ok'
  if (s === 'pending' || s === 'stopping') return 'status-warn'
  return 'status-err'
}
function ecsStatusClass(s) {
  return s === 'ACTIVE' ? 'status-ok' : s === 'DRAINING' ? 'status-warn' : 'status-err'
}
function eksStatusClass(s) {
  return s === 'ACTIVE' ? 'status-ok' : s === 'CREATING' || s === 'UPDATING' ? 'status-warn' : 'status-err'
}
</script>

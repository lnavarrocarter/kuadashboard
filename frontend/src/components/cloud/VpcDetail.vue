<template>
  <Teleport to="body">
    <div v-if="open" class="vpcd-backdrop" @mousedown.self="$emit('close')">
      <div class="vpcd-modal" v-dialog="() => $emit('close')">

        <!-- Header -->
        <div class="vpcd-header">
          <div class="vpcd-title">
            <span class="vpcd-icon">🌐</span>
            <span>{{ vpc?.name || vpc?.id }}</span>
            <span class="vpcd-id-badge">{{ vpc?.id }}</span>
            <span v-if="vpc?.state" :class="['vpcd-state', vpc.state]">{{ vpc.state }}</span>
            <span v-if="vpc?.default" class="badge-yellow">{{ t('vpcd.default') }}</span>
          </div>
          <button class="vpcd-close" :aria-label="t('action.close')" :title="t('action.close')" @click="$emit('close')">✕</button>
        </div>

        <!-- Tabs -->
        <div class="vpcd-tabs">
          <button v-for="tab in TABS" :key="tab.id"
            :class="['vpcd-tab', { active: activeTab === tab.id }]"
            @click="activeTab = tab.id">
            {{ t(tab.label) }}<span v-if="data && tab.count" class="vpcd-tab-count">{{ tab.count(data) }}</span>
          </button>
          <div class="vpcd-tabs-right">
            <button v-if="loaded" class="btn sm" @click="load" :disabled="loading" :title="t('action.refresh')" :aria-label="t('action.refresh')">↺</button>
          </div>
        </div>

        <!-- Body -->
        <div class="vpcd-body">

          <!-- Loading / Error -->
          <div v-if="loading" class="vpcd-spinner-wrap">
            <div class="vpcd-spinner"></div>
            <span>{{ t('res.loadingDetails') }}</span>
          </div>
          <div v-else-if="error" class="vpcd-error">{{ error }}</div>

          <template v-else-if="data">

            <!-- ══ OVERVIEW ═════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'overview'" class="vpcd-section" data-tab="overview">
              <div class="vpcd-grid">
                <div class="vpcd-card">
                  <div class="vpcd-card-title">VPC</div>
                  <dl>
                    <dt>VPC ID</dt>    <dd class="mono copyable">{{ data.vpc?.VpcId || '—' }}<button v-if="data.vpc?.VpcId" class="copy-btn" @click.stop="copyField(data.vpc.VpcId,'vpcid')" :title="copiedKey==='vpcid' ? t('res.copied') : t('action.copy')">{{ copiedKey==='vpcid' ? '✓' : '⧉' }}</button></dd>
                    <dt>CIDR</dt>      <dd class="mono copyable">{{ data.vpc?.CidrBlock || '—' }}<button v-if="data.vpc?.CidrBlock" class="copy-btn" @click.stop="copyField(data.vpc.CidrBlock,'cidr')" :title="copiedKey==='cidr' ? t('res.copied') : t('action.copy')">{{ copiedKey==='cidr' ? '✓' : '⧉' }}</button></dd>
                    <dt>{{ t('res.state') }}</dt>    <dd><span :class="['vpcd-state', data.vpc?.State]">{{ data.vpc?.State || '—' }}</span></dd>
                    <dt>{{ t('vpcd.defaultVpc') }}</dt>   <dd><span :class="data.vpc?.IsDefault ? 'badge-yellow' : 'badge-gray'">{{ yesNo(data.vpc?.IsDefault) }}</span></dd>
                    <dt>{{ t('ec2d.tenancy') }}</dt>  <dd>{{ data.vpc?.InstanceTenancy || '—' }}</dd>
                    <dt>{{ t('vpcd.dhcpOptions') }}</dt><dd class="mono copyable">{{ data.vpc?.DhcpOptionsId || '—' }}<button v-if="data.vpc?.DhcpOptionsId" class="copy-btn" @click.stop="copyField(data.vpc.DhcpOptionsId,'dhcp')" :title="copiedKey==='dhcp' ? t('res.copied') : t('action.copy')">{{ copiedKey==='dhcp' ? '✓' : '⧉' }}</button></dd>
                  </dl>
                </div>

                <div class="vpcd-card">
                  <div class="vpcd-card-title">{{ t('vpcd.summary') }}</div>
                  <dl>
                    <dt>{{ t('vpcd.tab.subnets') }}</dt>           <dd>{{ data.subnets?.length ?? 0 }}</dd>
                    <dt>{{ t('vpcd.tab.sgs') }}</dt>   <dd>{{ data.securityGroups?.length ?? 0 }}</dd>
                    <dt>{{ t('vpcd.tab.routes') }}</dt>      <dd>{{ data.routeTables?.length ?? 0 }}</dd>
                    <dt>{{ t('vpcd.internetGateways') }}</dt> <dd>{{ data.internetGateways?.length ?? 0 }}</dd>
                    <dt>{{ t('vpcd.natGateways') }}</dt>      <dd>{{ data.natGateways?.length ?? 0 }}</dd>
                  </dl>
                </div>
              </div>

              <!-- Tags -->
              <div class="vpcd-card" style="margin-top:12px">
                <div class="vpcd-card-title">{{ t('vpcd.tags', { n: data.vpc?.Tags?.length ?? 0 }) }}</div>
                <table class="vpcd-table" v-if="data.vpc?.Tags?.length">
                  <thead><tr><th>{{ t('res.key') }}</th><th>{{ t('res.value') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="t in data.vpc.Tags" :key="t.Key">
                      <td class="mono">{{ t.Key }}</td>
                      <td class="mono wrap">{{ t.Value }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">{{ t('res.noTags') }}</div>
              </div>
            </div>

            <!-- ══ SUBNETS ══════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'subnets'" class="vpcd-section" data-tab="subnets">
              <div v-if="!data.subnets?.length" class="vpcd-empty">{{ t('eksd.noSubnets') }}</div>
              <div v-else class="vpcd-card">
                <table class="vpcd-table">
                  <thead><tr><th>Subnet ID</th><th>CIDR</th><th>{{ t('res.zone') }}</th><th>{{ t('res.state') }}</th><th>{{ t('ec2d.publicIp') }}</th><th>{{ t('eksd.freeIps') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="s in data.subnets" :key="s.SubnetId">
                      <td class="mono copyable">{{ s.SubnetId }}<button class="copy-btn" @click.stop="copyField(s.SubnetId, s.SubnetId)" :title="copiedKey===s.SubnetId ? t('res.copied') : t('action.copy')">{{ copiedKey===s.SubnetId ? '✓' : '⧉' }}</button></td>
                      <td class="mono">{{ s.CidrBlock }}</td>
                      <td class="mono">{{ s.AvailabilityZone }}</td>
                      <td><span :class="['vpcd-state', s.State]">{{ s.State }}</span></td>
                      <td><span :class="s.MapPublicIpOnLaunch ? 'badge-yellow' : 'badge-gray'">{{ yesNo(s.MapPublicIpOnLaunch) }}</span></td>
                      <td>{{ s.AvailableIpAddressCount }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- ══ SECURITY GROUPS ══════════════════════════════════════════ -->
            <div v-show="activeTab === 'sgs'" class="vpcd-section" data-tab="sgs">
              <div v-if="!data.securityGroups?.length" class="vpcd-empty">{{ t('eksd.noSecurityGroups') }}</div>
              <template v-else>
                <div class="vpcd-sg-toolbar">
                  <input v-model="sgSearch" class="vpcd-sg-search" type="search" data-test="sg-search"
                    :placeholder="t('vpcd.sgSearch')" :aria-label="t('vpcd.sgSearch')" />
                  <span class="text-dim" data-test="sg-count">{{ t('vpcd.sgCount', { n: shownGroups.length, total: data.securityGroups.length }) }}</span>
                </div>
                <div class="text-dim vpcd-sg-note">{{ t('vpcd.sgExposureNote') }}</div>
                <div v-if="!shownGroups.length" class="vpcd-empty">{{ t('vpcd.sgNoMatches') }}</div>
              </template>
              <div v-for="sg in shownGroups" :key="sg.GroupId" class="vpcd-card" style="margin-bottom:12px" data-test="sg-card">
                <div class="vpcd-card-title">
                  🔒 {{ sg.GroupName }}
                  <span class="text-dim mono-xs">{{ sg.GroupId }}</span>
                  <span class="text-dim vpcd-card-desc">{{ sg.Description }}</span>
                </div>
                <template v-for="direction in SG_DIRECTIONS" :key="direction.id">
                  <div class="vpcd-sg-label">{{ t(direction.label, { n: sg[direction.field]?.length ?? 0 }) }}</div>
                  <table class="vpcd-table" v-if="sg[direction.field]?.length" :data-test="`sg-${direction.id}`">
                    <thead><tr><th>{{ t('ec2d.protocol') }}</th><th>{{ t('ec2d.ports') }}</th><th>{{ t(direction.peer) }}</th></tr></thead>
                    <tbody>
                      <tr v-for="(rule, i) in sg[direction.field]" :key="i">
                        <td class="mono">{{ fmtProtocol(rule) }}</td>
                        <td class="mono">{{ fmtPortRange(rule) }}</td>
                        <td>
                          <span v-for="peer in rulePeers(rule, groupNames)" :key="`${peer.kind}:${peer.value}`" class="vpcd-src-chip" :title="peer.description || t(`vpcd.peer.${peer.kind}`)">
                            <span class="vpcd-peer-kind">{{ t(`vpcd.peer.${peer.kind}`) }}</span>
                            {{ peer.value }}<template v-if="peer.name"> ({{ peer.name }})</template>
                          </span>
                          <span v-if="!rulePeers(rule, groupNames).length" class="text-dim">—</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-dim" style="font-size:.8rem">{{ t(direction.empty) }}</div>
                </template>
              </div>
            </div>

            <!-- ══ ROUTE TABLES ═════════════════════════════════════════════ -->
            <div v-show="activeTab === 'routes'" class="vpcd-section" data-tab="routes">
              <div v-if="!data.routeTables?.length" class="vpcd-empty">{{ t('vpcd.noRouteTables') }}</div>
              <div v-for="rt in (data.routeTables || [])" :key="rt.RouteTableId" class="vpcd-card" style="margin-bottom:12px">
                <div class="vpcd-card-title">
                  🧭 <span class="mono">{{ rt.RouteTableId }}</span>
                  <span v-if="rt.Associations?.some(a => a.Main)" class="badge-blue">{{ t('vpcd.mainRouteTable') }}</span>
                  <span class="text-dim vpcd-card-desc">{{ tagName(rt.Tags) }}</span>
                </div>
                <table class="vpcd-table">
                  <thead><tr><th>{{ t('ec2d.destination') }}</th><th>{{ t('vpcd.target') }}</th><th>{{ t('res.state') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(r, i) in (rt.Routes || [])" :key="i">
                      <td class="mono">{{ r.DestinationCidrBlock || r.DestinationIpv6CidrBlock || r.DestinationPrefixListId }}</td>
                      <td class="mono text-dim">{{ r.GatewayId || r.NatGatewayId || r.TransitGatewayId || r.InstanceId || 'local' }}</td>
                      <td><span :class="r.State === 'active' ? 'badge-green' : 'badge-yellow'">{{ r.State }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- ══ INTERNET GATEWAYS ════════════════════════════════════════ -->
            <div v-show="activeTab === 'igws'" class="vpcd-section" data-tab="igws">
              <div v-if="!data.internetGateways?.length" class="vpcd-empty">{{ t('vpcd.noInternetGateways') }}</div>
              <div v-else class="vpcd-card">
                <table class="vpcd-table">
                  <thead><tr><th>Gateway ID</th><th>{{ t('res.state') }}</th><th>{{ t('res.name') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="igw in data.internetGateways" :key="igw.InternetGatewayId">
                      <td class="mono copyable">{{ igw.InternetGatewayId }}<button class="copy-btn" @click.stop="copyField(igw.InternetGatewayId, igw.InternetGatewayId)" :title="copiedKey===igw.InternetGatewayId ? t('res.copied') : t('action.copy')">{{ copiedKey===igw.InternetGatewayId ? '✓' : '⧉' }}</button></td>
                      <td><span :class="igw.Attachments?.[0]?.State === 'available' ? 'badge-green' : 'badge-yellow'">{{ igw.Attachments?.[0]?.State || '—' }}</span></td>
                      <td class="text-dim">{{ tagName(igw.Tags) || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- ══ NAT GATEWAYS ═════════════════════════════════════════════ -->
            <div v-show="activeTab === 'nats'" class="vpcd-section" data-tab="nats">
              <div v-if="!data.natGateways?.length" class="vpcd-empty">{{ t('vpcd.noNatGateways') }}</div>
              <div v-else class="vpcd-card">
                <table class="vpcd-table">
                  <thead><tr><th>NAT ID</th><th>{{ t('vpcd.subnet') }}</th><th>{{ t('ec2d.publicIp') }}</th><th>{{ t('ec2d.privateIp') }}</th><th>{{ t('res.state') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="nat in data.natGateways" :key="nat.NatGatewayId">
                      <td class="mono copyable">{{ nat.NatGatewayId }}<button class="copy-btn" @click.stop="copyField(nat.NatGatewayId, nat.NatGatewayId)" :title="copiedKey===nat.NatGatewayId ? t('res.copied') : t('action.copy')">{{ copiedKey===nat.NatGatewayId ? '✓' : '⧉' }}</button></td>
                      <td class="mono text-dim">{{ nat.SubnetId }}</td>
                      <td class="mono">{{ nat.NatGatewayAddresses?.[0]?.PublicIp || '—' }}</td>
                      <td class="mono">{{ nat.NatGatewayAddresses?.[0]?.PrivateIp || '—' }}</td>
                      <td><span :class="['vpcd-state', nat.State]">{{ nat.State }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { filterSecurityGroups, rulePeers } from './vpcSecurityGroups'
import { useAwsStore } from '../../stores/useAwsStore'
import { useI18n } from '../../composables/useI18n'
import { vDialog } from '../../composables/vDialog'

const props = defineProps({
  open: { type: Boolean, default: false },
  vpc:  { type: Object,  default: null  },
})
defineEmits(['close'])

const awsStore = useAwsStore()
const { t } = useI18n()
const yesNo = value => t(value ? 'common.yes' : 'common.no')

const TABS = [
  { id: 'overview', label: 'sidebar.overview' },
  { id: 'subnets',  label: 'vpcd.tab.subnets',  count: d => d.subnets?.length ?? 0 },
  { id: 'sgs',      label: 'vpcd.tab.sgs',      count: d => d.securityGroups?.length ?? 0 },
  { id: 'routes',   label: 'vpcd.tab.routes',   count: d => d.routeTables?.length ?? 0 },
  { id: 'igws',     label: 'vpcd.tab.igws',     count: d => d.internetGateways?.length ?? 0 },
  { id: 'nats',     label: 'vpcd.tab.nats',     count: d => d.natGateways?.length ?? 0 },
]
// Inbound and outbound rules share the table; only the field and the peer column change.
const SG_DIRECTIONS = [
  { id: 'inbound',  field: 'IpPermissions',       label: 'ec2d.inbound',  peer: 'ec2d.source',      empty: 'ec2d.noInbound' },
  { id: 'outbound', field: 'IpPermissionsEgress', label: 'ec2d.outbound', peer: 'ec2d.destination', empty: 'ec2d.noOutbound' },
]

const activeTab = ref('overview')
const sgSearch  = ref('')
const data      = ref(null)
const loading   = ref(false)
const loaded    = ref(false)
const error     = ref('')

watch(() => props.open, val => {
  if (val) {
    activeTab.value = 'overview'
    sgSearch.value = ''
    data.value   = null
    loaded.value = false
    error.value  = ''
    load()
  }
}, { immediate: true })

async function load() {
  if (!props.vpc?.id) return
  loading.value = true
  error.value   = ''
  try {
    const res = await awsStore.fetchResourceConfig('vpc', { id: props.vpc.id })
    if (res) {
      data.value   = res
      loaded.value = true
    } else {
      error.value = awsStore.error || t('vpcd.loadFailed')
    }
  } catch (e) {
    error.value = e?.message || 'Error'
  } finally {
    loading.value = false
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function tagName(tags) {
  return (tags || []).find(t => t.Key === 'Name')?.Value || ''
}

function fmtProtocol(rule) {
  return rule.IpProtocol === '-1' ? t('ec2d.allPorts') : rule.IpProtocol
}

function fmtPortRange(rule) {
  if (rule.IpProtocol === '-1' || rule.FromPort == null) return t('ec2d.allPorts')
  if (rule.FromPort === rule.ToPort) return String(rule.FromPort)
  return `${rule.FromPort}–${rule.ToPort}`
}

const shownGroups = computed(() => filterSecurityGroups(data.value?.securityGroups || [], sgSearch.value))
const groupNames  = computed(() => Object.fromEntries((data.value?.securityGroups || []).map(group => [group.GroupId, group.GroupName])))

// ── Copy helpers ─────────────────────────────────────────────────────────────
const copiedKey = ref(null)
function copyField(val, key) {
  if (!val || val === '—') return
  navigator.clipboard?.writeText(String(val)).catch(() => {})
  copiedKey.value = key
  setTimeout(() => { if (copiedKey.value === key) copiedKey.value = null }, 1500)
}
</script>

<style scoped>
.vpcd-sg-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.vpcd-sg-search { flex: 1; max-width: 420px; padding: 5px 10px; border: 1px solid #30363d; border-radius: 6px; background: #161b22; color: inherit; font-size: .8rem; }
.vpcd-sg-note { font-size: .72rem; margin-bottom: 10px; }
.vpcd-peer-kind { opacity: .65; margin-right: 4px; font-size: .68rem; text-transform: uppercase; }
.vpcd-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 800;
}
.vpcd-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(98vw, 1020px);
  max-height: 90vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.7);
}

/* Header */
.vpcd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0; gap: 8px;
}
.vpcd-title {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  font-weight: 600; color: #e6edf3; font-size: .95rem;
}
.vpcd-icon { font-size: 1.1rem; }
.vpcd-id-badge {
  background: rgba(88,166,255,.15); color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 4px; padding: 1px 7px;
  font-size: .75rem; font-family: monospace;
}
.vpcd-state {
  font-size: .75rem; padding: 2px 8px; border-radius: 12px; font-weight: 500;
  background: rgba(210,153,34,.2); color: #d29922;
}
.vpcd-state.available { background: rgba(63,185,80,.2); color: #3fb950; }
.vpcd-state.failed,.vpcd-state.deleted,.vpcd-state.deleting { background: rgba(248,81,73,.2); color: #f85149; }
.vpcd-close {
  background: none; border: none; color: #8b949e;
  cursor: pointer; font-size: 1rem; padding: 2px 5px; border-radius: 4px;
}
.vpcd-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Tabs */
.vpcd-tabs {
  display: flex; align-items: center;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0 8px; gap: 2px;
  flex-shrink: 0; overflow-x: auto;
}
.vpcd-tab {
  background: none; border: none;
  color: #8b949e; cursor: pointer;
  padding: 8px 13px; font-size: .82rem;
  border-bottom: 2px solid transparent;
  transition: all .15s; white-space: nowrap;
}
.vpcd-tab:hover { color: #e6edf3; }
.vpcd-tab.active { color: #58a6ff; border-bottom-color: #388bfd; }
.vpcd-tab-count {
  margin-left: 6px; font-size: .7rem;
  background: rgba(139,148,158,.15); color: #8b949e;
  border-radius: 10px; padding: 0 6px;
}
.vpcd-tabs-right { margin-left: auto; }

/* Body */
.vpcd-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
.vpcd-section { display: flex; flex-direction: column; }

.vpcd-spinner-wrap {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; padding: 48px;
  color: #8b949e; font-size: .9rem;
}
.vpcd-spinner {
  width: 28px; height: 28px;
  border: 3px solid #30363d;
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.vpcd-error {
  background: rgba(248,81,73,.1);
  border: 1px solid rgba(248,81,73,.3);
  border-radius: 6px; padding: 12px 16px;
  color: #f85149; font-size: .85rem;
}
.vpcd-empty {
  text-align: center; color: #8b949e;
  padding: 32px; font-size: .9rem;
}

/* Cards grid */
.vpcd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.vpcd-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
}
.vpcd-card-title {
  font-size: .8rem; color: #58a6ff;
  font-weight: 600; margin-bottom: 10px;
  letter-spacing: .03em; text-transform: uppercase;
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
}
.vpcd-card-desc { font-size: .75rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
dt { color: #8b949e; font-size: .8rem; align-self: start; padding-top: 2px; }
dd { color: #e6edf3; font-size: .83rem; margin: 0; word-break: break-word; }
dd.mono { font-family: monospace; }

/* Table */
.vpcd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: .8rem;
}
.vpcd-table th {
  color: #8b949e; text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid #21262d;
  white-space: nowrap;
}
.vpcd-table td {
  padding: 4px 8px; color: #e6edf3;
  border-bottom: 1px solid rgba(48,54,61,.5);
}
.vpcd-table tr:last-child td { border-bottom: none; }
.vpcd-table .mono { font-family: monospace; }
.vpcd-table .wrap { word-break: break-all; }
.vpcd-table td.copyable { display: table-cell; width: auto; }

/* SG rules */
.vpcd-sg-label { font-size: .75rem; color: #8b949e; margin-bottom: 4px; }
.vpcd-src-chip {
  display: inline-block;
  background: rgba(139,148,158,.12);
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: .75rem; font-family: monospace;
  margin: 2px 2px 2px 0;
}

/* Badges */
.badge-green { background: rgba(63,185,80,.2); color: #3fb950; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-yellow{ background: rgba(210,153,34,.2); color: #d29922; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-gray  { background: rgba(139,148,158,.15); color: #8b949e; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-blue  { background: rgba(88,166,255,.15); color: #58a6ff; border-radius: 4px; padding: 1px 7px; font-size: .72rem; text-transform: none; }

.text-dim  { color: #8b949e; }
.mono      { font-family: monospace; }
.mono-xs   { font-family: monospace; font-size: .75rem; text-transform: none; letter-spacing: 0; }

/* Buttons */
.btn { background: rgba(88,166,255,.15); border: 1px solid rgba(88,166,255,.4); color: #58a6ff; border-radius: 6px; padding: 4px 12px; font-size: .82rem; cursor: pointer; transition: all .15s; }
.btn:hover { background: rgba(88,166,255,.25); }
.btn.sm { padding: 3px 10px; font-size: .78rem; }

/* Copy buttons */
.copyable { display: inline-flex; align-items: flex-start; gap: 4px; width: 100%; min-width: 0; }
.copy-btn {
  background: none; border: none;
  color: #8b949e; cursor: pointer;
  font-size: .72rem; padding: 1px 3px;
  border-radius: 3px; opacity: 0;
  transition: opacity .15s, color .15s;
  flex-shrink: 0; line-height: 1.5;
}
.copyable:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: #58a6ff; background: rgba(88,166,255,.12); }

@media (max-width: 768px) {
  .vpcd-body { padding: 10px 12px; }
  .vpcd-grid { grid-template-columns: 1fr; }
}
</style>

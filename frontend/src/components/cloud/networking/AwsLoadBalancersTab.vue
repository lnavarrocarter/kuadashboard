<template>
  <div class="msg-tab" data-test="aws-elb">
    <div class="msg-hint">{{ t('elb.costHint') }}</div>
    <div v-for="item in awsStore.loadBalancersUnavailable" :key="item.source" class="activity-notice">
      <span>{{ t('elb.unavailable', { source: t(`elb.source.${item.source}`), error: item.error?.message || '' }) }}</span>
      <button v-if="item.access" class="btn sm" @click="emit('request-access', { text: item.error?.message, access: item.access })">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-if="awsStore.loadBalancersTruncated" class="activity-notice">{{ t('awsMsg.truncated') }}</div>

    <div v-if="awsStore.loading && !awsStore.loadBalancers.length" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="!rows.length" class="empty-row">{{ search ? t('awsMsg.noMatches') : t('elb.empty') }}</div>
    <template v-else>
      <div class="elb-summary">
        <span>{{ t('elb.summary', { n: rows.length, public: publicCount }) }}</span>
        <span v-if="attentionCount" class="status-warn">{{ t('elb.attention', { n: attentionCount }) }}</span>
      </div>
      <table class="cloud-table">
        <thead><tr>
          <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsMsg.name') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
          <th :class="thClass('healthRank')" :aria-sort="ariaSort('healthRank')"><button type="button" class="th-sort" @click="sortBy('healthRank')">{{ t('health.title') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('healthRank') }}</span></button></th>
          <th :class="thClass('typeLabel')" :aria-sort="ariaSort('typeLabel')"><button type="button" class="th-sort" @click="sortBy('typeLabel')">{{ t('elb.type') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('typeLabel') }}</span></button></th>
          <th>{{ t('elb.dnsName') }}</th>
          <th>{{ t('elb.listeners') }}</th>
          <th :class="thClass('healthyRatio')" :title="t('elb.targetsHint')" :aria-sort="ariaSort('healthyRatio')"><button type="button" class="th-sort" @click="sortBy('healthyRatio')">{{ t('elb.targets') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('healthyRatio') }}</span></button></th>
          <th></th>
        </tr></thead>
        <tbody>
          <template v-for="lb in sortRows(rows)" :key="lb.id">
            <tr :class="{ 'msg-selected': selected === lb.id }">
              <td>
                <span class="msg-name">{{ lb.name }}</span>
                <span :class="['msg-chip', lb.public ? 'warn' : '']" :title="t(lb.public ? 'elb.publicHint' : 'elb.internalHint')">{{ t(lb.public ? 'elb.public' : 'elb.internal') }}</span>
                <span v-if="lb.state && lb.state !== 'active'" class="msg-chip">{{ lb.state }}</span>
              </td>
              <td><HealthBadge :health="lb.health" /></td>
              <td>{{ lb.typeLabel }}</td>
              <td class="elb-dns">
                <span class="mono-xs" :title="lb.dnsName">{{ lb.dnsName }}</span>
                <button v-if="lb.dnsName" class="btn btn-icon sm" :title="t('elb.copyDns')" @click="copy(lb.dnsName)"><i data-lucide="copy"></i></button>
              </td>
              <td>
                <span v-for="listener in lb.listeners" :key="`${listener.protocol}:${listener.port}`" :class="['msg-chip', listenerTone(lb, listener)]" :title="listenerTitle(listener)">{{ listenerLabel(listener) }}</span>
                <span v-if="!lb.listeners.length" class="text-dim">—</span>
              </td>
              <td>
                <span :class="targetTone(lb)">{{ lb.targets.healthy }}/{{ lb.targets.total }}</span>
                <span v-if="lb.targets.unhealthy" class="text-dim"> · {{ t('elb.unhealthyCount', { n: lb.targets.unhealthy }) }}</span>
              </td>
              <td class="elb-actions">
                <button
                  v-if="props.applicationId && props.profileId && lb.arn"
                  class="btn sm"
                  :disabled="props.addingResourceId === lb.arn"
                  :title="t('apm.addToApplication')"
                  @click="emit('add-to-application', lb)"
                >
                  <i :data-lucide="props.addingResourceId === lb.arn ? 'loader-2' : 'plus'"></i>
                  {{ t('apm.addToApplication') }}
                </button>
                <button class="btn sm" :aria-expanded="selected === lb.id" @click="toggle(lb)">{{ selected === lb.id ? t('awsMsg.hide') : t('awsMsg.details') }}</button>
              </td>
            </tr>
            <tr v-if="selected === lb.id" class="msg-detail-row">
              <td colspan="7">
                <div class="msg-detail" data-test="aws-elb-detail">
                  <HealthBadge v-if="lb.health.reasons.length" :health="lb.health" list />
                  <dl class="msg-facts">
                    <div><dt>{{ t('elb.scheme') }}</dt><dd>{{ lb.scheme || '—' }}</dd></div>
                    <div v-if="lb.arn"><dt>ARN</dt><dd class="mono-xs">{{ lb.arn }}</dd></div>
                    <div><dt>VPC</dt><dd>{{ lb.vpcId || '—' }}</dd></div>
                    <div><dt>{{ t('elb.zones') }}</dt><dd>{{ lb.zones.join(', ') || '—' }}</dd></div>
                    <div><dt>{{ t('elb.securityGroups') }}</dt><dd>{{ lb.securityGroups.join(', ') || '—' }}</dd></div>
                    <div v-if="lb.ipAddressType"><dt>{{ t('elb.ipAddressType') }}</dt><dd>{{ lb.ipAddressType }}</dd></div>
                    <div><dt>{{ t('elb.created') }}</dt><dd>{{ lb.createdAt ? formatDate(lb.createdAt, settings.lang) : '—' }}</dd></div>
                    <template v-if="detail?.attributes">
                      <div v-if="detail.attributes.deletionProtection != null"><dt>{{ t('elb.deletionProtection') }}</dt><dd :class="detail.attributes.deletionProtection ? '' : 'status-warn'">{{ yesNo(detail.attributes.deletionProtection) }}</dd></div>
                      <div><dt>{{ t('elb.accessLogs') }}</dt><dd :class="detail.attributes.accessLogs ? '' : 'status-warn'">{{ detail.attributes.accessLogs ? (typeof detail.attributes.accessLogs === 'string' ? `s3://${detail.attributes.accessLogs}` : t('elb.yes')) : t('elb.no') }}</dd></div>
                      <div v-if="detail.attributes.dropInvalidHeaders != null"><dt>{{ t('elb.dropInvalidHeaders') }}</dt><dd>{{ yesNo(detail.attributes.dropInvalidHeaders) }}</dd></div>
                      <div v-if="detail.attributes.idleTimeoutSeconds != null"><dt>{{ t('elb.idleTimeout') }}</dt><dd>{{ detail.attributes.idleTimeoutSeconds }} s</dd></div>
                      <div v-if="detail.attributes.crossZone != null"><dt>{{ t('elb.crossZone') }}</dt><dd>{{ yesNo(detail.attributes.crossZone) }}</dd></div>
                    </template>
                  </dl>
                  <div v-if="detailLoading" class="text-dim">{{ t('elb.loadingDetail') }}</div>
                  <div v-else-if="detailError" class="activity-notice">{{ detailError }}</div>

                  <div class="msg-section">
                    <h5>{{ t('elb.listeners') }}</h5>
                    <table class="msg-subtable">
                      <thead><tr><th>{{ t('elb.listener') }}</th><th>{{ t('elb.defaultAction') }}</th><th>TLS</th><th>{{ t('elb.rules') }}</th></tr></thead>
                      <tbody>
                        <tr v-for="listener in detailListeners(lb)" :key="`${listener.protocol}:${listener.port}`">
                          <td>{{ listener.protocol }}:{{ listener.port }}</td>
                          <td>{{ actionText(listener.defaultAction) }}</td>
                          <td>
                            <span v-if="listener.sslPolicy" :class="listener.oldTls ? 'status-warn' : ''">{{ listener.sslPolicy }}</span>
                            <span v-else class="text-dim">—</span>
                            <span v-if="listener.certificates" class="text-dim"> · {{ t('elb.certificates', { n: listener.certificates }) }}</span>
                          </td>
                          <td>
                            <span v-if="listener.rules == null" class="text-dim">{{ detail ? '—' : '…' }}</span>
                            <span v-else-if="!listener.rules.length" class="text-dim">{{ t('elb.noRules') }}</span>
                            <ul v-else class="msg-list">
                              <li v-for="rule in listener.rules" :key="rule.priority">
                                <span class="msg-code">{{ rule.priority }}</span>
                                {{ rule.conditions.map(c => `${c.field}: ${c.values.join(', ')}`).join(' · ') }} → {{ actionText(rule.action) }}
                              </li>
                            </ul>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div class="msg-section">
                    <h5>{{ t('elb.targetGroups') }}</h5>
                    <table class="msg-subtable">
                      <thead><tr><th>{{ t('awsMsg.name') }}</th><th>{{ t('elb.protocol') }}</th><th>{{ t('elb.targetType') }}</th><th>{{ t('elb.healthCheck') }}</th><th>{{ t('elb.targets') }}</th></tr></thead>
                      <tbody>
                        <template v-for="group in lb.targetGroups" :key="group.arn || group.name">
                          <tr>
                            <td>{{ group.name }}</td>
                            <td>{{ group.protocol || '—' }}{{ group.port ? `:${group.port}` : '' }}</td>
                            <td>{{ group.targetType || '—' }}</td>
                            <td class="mono-xs">{{ group.healthCheck || '—' }}</td>
                            <td>
                              <span :class="group.targets.total && !group.targets.healthy ? 'status-err' : ''">{{ group.targets.healthy }}/{{ group.targets.total }}</span>
                              <span v-if="group.targets.unhealthy" class="text-dim"> · {{ t('elb.unhealthyCount', { n: group.targets.unhealthy }) }}</span>
                            </td>
                          </tr>
                          <tr v-for="target in group.unhealthyTargets" :key="`${group.name}:${target.id}:${target.port}`">
                            <td colspan="5" class="elb-unhealthy">
                              <span class="status-err">{{ target.id }}{{ target.port ? `:${target.port}` : '' }}</span> — {{ target.state }}<span v-if="target.reason"> ({{ target.reason }})</span><span v-if="target.description" class="text-dim"> · {{ target.description }}</span>
                            </td>
                          </tr>
                        </template>
                        <tr v-if="!lb.targetGroups.length"><td colspan="5" class="text-dim">{{ t('elb.noTargetGroups') }}</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div v-if="detail?.tags?.length" class="msg-section">
                    <h5>{{ t('elb.tags') }}</h5>
                    <div><span v-for="tag in detail.tags" :key="tag.key" class="msg-chip">{{ tag.key }}={{ tag.value }}</span></div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { useSortable } from '../../../composables/useSortable'
import { settings } from '../../../composables/useSettings'
import HealthBadge from '../messaging/HealthBadge.vue'
import { filterRows, formatDate, HEALTH_RANK } from '../messaging/messagingFormat'

const props = defineProps({
  search: { type: String, default: '' },
  // Overview incident focus: only load balancers that need attention.
  attentionOnly: { type: Boolean, default: false },
  applicationId: { type: String, default: '' },
  profileId: { type: String, default: '' },
  addingResourceId: { type: String, default: '' },
})
const emit = defineEmits(['request-access', 'add-to-application'])
const awsStore = useAwsStore()
const { t } = useI18n()
const { sortBy, sortRows, sortIcon, thClass, ariaSort } = useSortable()

const selected = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')

const TYPE_LABELS = { application: 'ALB', network: 'NLB', gateway: 'GWLB', classic: 'Classic' }

const rows = computed(() => filterRows(awsStore.loadBalancers, props.search)
  .filter(lb => !props.attentionOnly || ['warning', 'critical'].includes(lb.health?.status))
  .map(lb => {
  const targets = lb.targetGroups.reduce((sum, group) => ({
    total: sum.total + group.targets.total,
    healthy: sum.healthy + group.targets.healthy,
    unhealthy: sum.unhealthy + group.targets.unhealthy,
  }), { total: 0, healthy: 0, unhealthy: 0 })
  return {
    ...lb,
    targets,
    typeLabel: TYPE_LABELS[lb.type] || lb.type,
    healthRank: HEALTH_RANK[lb.health?.status] ?? -1,
    healthyRatio: targets.total ? targets.healthy / targets.total : -1,
  }
}))
const publicCount = computed(() => rows.value.filter(lb => lb.public).length)
const attentionCount = computed(() => rows.value.filter(lb => ['warning', 'critical'].includes(lb.health?.status)).length)

function listenerLabel(listener) {
  const base = `${listener.protocol}:${listener.port}`
  return listener.defaultAction?.toHttps ? `${base} → HTTPS` : base
}

function listenerTitle(listener) {
  return [actionText(listener.defaultAction), listener.sslPolicy].filter(Boolean).join(' · ')
}

function listenerTone(lb, listener) {
  if (listener.oldTls) return 'warn'
  if (lb.public && lb.type === 'application' && listener.protocol === 'HTTP' && !listener.defaultAction?.toHttps) return 'warn'
  return ['HTTPS', 'TLS'].includes(listener.protocol) ? 'ok' : ''
}

function targetTone(lb) {
  if (lb.targets.total && !lb.targets.healthy) return 'status-err'
  if (lb.targets.unhealthy) return 'status-warn'
  return ''
}

// Listener and rule actions by type (lib/awsLoadBalancers.js describeAction); other types show as is.
const ACTION_TEXT = {
  forward: action => (action.instance
    ? t('elb.action.forwardInstances', { target: action.instance })
    : t('elb.action.forward', { target: (action.targetGroups || []).join(', ') || '—' })),
  redirect: action => t('elb.action.redirect', { target: action.redirect, status: action.status || '' }),
  'fixed-response': action => t('elb.action.fixed', { status: action.status || '' }),
}

function actionText(action = {}) {
  return ACTION_TEXT[action.type]?.(action) || action.type || '—'
}

function yesNo(value) {
  return value ? t('elb.yes') : t('elb.no')
}

/** Listeners of the detail (with rules) once loaded, else those of the list. */
function detailListeners(lb) {
  if (detail.value?.listeners && selected.value === lb.id) return detail.value.listeners
  return lb.listeners.map(listener => ({ ...listener, rules: null }))
}

async function toggle(lb) {
  if (selected.value === lb.id) { selected.value = null; return }
  selected.value = lb.id
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  try {
    const data = await awsStore.fetchLoadBalancerDetail(lb)
    if (selected.value === lb.id) detail.value = data
  } catch (e) {
    if (selected.value === lb.id) detailError.value = e?.message || String(e)
  } finally {
    if (selected.value === lb.id) detailLoading.value = false
  }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
}
</script>

<style scoped>
.elb-summary { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--text-dim); }
.elb-actions { display: flex; gap: 6px; }
.elb-dns { max-width: 340px; }
.elb-dns .mono-xs { display: inline-block; max-width: 290px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.elb-unhealthy { padding-left: 18px !important; font-size: 11px; }
.mono-xs { font-family: monospace; font-size: 11px; }
</style>

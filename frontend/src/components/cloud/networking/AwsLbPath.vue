<template>
  <!-- Load balancer → subnets and routes → target groups → targets, with the security group
       verdicts that explain a Target.Timeout. Read on demand: Describe calls, no charge. -->
  <div class="msg-section lbp" data-test="elb-path">
    <h5>{{ t('lbPath.title') }}</h5>
    <p class="text-dim lbp-hint">{{ t('lbPath.hint') }}</p>
    <button v-if="!result && !loading" class="btn sm" data-test="elb-path-check" :disabled="!lb.arn" @click="load">
      <i data-lucide="route"></i> {{ t('lbPath.check') }}
    </button>
    <p v-if="!lb.arn" class="text-dim">{{ t('lbPath.classic') }}</p>
    <p v-if="loading" class="text-dim">{{ t('lbPath.loading') }}</p>
    <p v-else-if="error" class="activity-notice">{{ error }}</p>

    <template v-if="result">
      <ul v-if="result.findings.length" class="lbp-findings" data-test="elb-path-findings">
        <li v-for="(finding, i) in result.findings" :key="i" :class="finding.level === 'critical' ? 'status-err' : 'status-warn'">{{ t(`lbPath.finding.${finding.key}`, finding.params) }}</li>
      </ul>
      <p v-else class="status-ok" data-test="elb-path-ok">{{ t('lbPath.noFindings') }}</p>

      <h6>{{ t('lbPath.lbSubnets') }}</h6>
      <table class="msg-subtable">
        <thead><tr><th>{{ t('lbPath.subnet') }}</th><th>{{ t('elb.zones') }}</th><th>CIDR</th><th>{{ t('lbPath.defaultRoute') }}</th></tr></thead>
        <tbody>
          <tr v-for="subnet in result.loadBalancer.subnets" :key="subnet.id">
            <td class="mono-xs">{{ subnet.id }}</td>
            <td>{{ subnet.zone || '—' }}</td>
            <td class="mono-xs">{{ subnet.cidr || '—' }}</td>
            <td>{{ routeText(subnet) }}</td>
          </tr>
        </tbody>
      </table>

      <template v-for="group in result.groups" :key="group.arn">
        <h6>{{ group.name }} · {{ group.protocol }}:{{ group.port }} <span class="text-dim">· {{ t('lbPath.healthCheckOn', { port: group.healthCheck.port, path: group.healthCheck.path || '' }) }}</span></h6>
        <table class="msg-subtable">
          <thead><tr><th>{{ t('elb.targets') }}</th><th>{{ t('lbPath.health') }}</th><th>{{ t('lbPath.subnet') }}</th><th>{{ t('lbPath.defaultRoute') }}</th><th>{{ t('lbPath.traffic') }}</th><th>{{ t('lbPath.healthCheckCol') }}</th></tr></thead>
          <tbody>
            <tr v-for="target in group.targets" :key="`${target.id}:${target.port}`" data-test="elb-path-target">
              <td class="mono-xs">{{ target.instance?.name ? `${target.instance.name} · ` : '' }}{{ target.id }}:{{ target.port }}</td>
              <td :class="target.state === 'healthy' ? 'status-ok' : 'status-err'">{{ target.state || '—' }}<span v-if="target.reason" class="text-dim"> ({{ target.reason }})</span></td>
              <td class="mono-xs">{{ target.subnet ? `${target.subnet.id} ${target.subnet.cidr || ''}` : '—' }}</td>
              <td>{{ target.subnet ? routeText(target.subnet) : '—' }}</td>
              <td :class="VERDICT_CLASS[target.traffic.verdict]" :title="ruleText(target.traffic.rule)" data-test="elb-path-traffic">{{ t(`lbPath.verdict.${target.traffic.verdict}`, { port: target.port }) }}</td>
              <td :class="VERDICT_CLASS[target.healthCheck.verdict]" :title="ruleText(target.healthCheck.rule)">{{ t(`lbPath.verdict.${target.healthCheck.verdict}`, { port: target.healthCheckPort }) }}</td>
            </tr>
            <tr v-if="!group.targets.length"><td colspan="6" class="text-dim">{{ t('lbPath.noTargets') }}</td></tr>
          </tbody>
        </table>
      </template>
      <ul class="lbp-notes text-dim">
        <li v-for="note in result.notes" :key="note">{{ t(`lbPath.note.${note}`) }}</li>
      </ul>
      <button class="btn sm" @click="load"><i data-lucide="refresh-cw"></i> {{ t('lbPath.recheck') }}</button>
    </template>
  </div>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({ lb: { type: Object, required: true } })
const { t } = useI18n()
const awsStore = useAwsStore()
const VERDICT_CLASS = { allowed: 'status-ok', blocked: 'status-err', unknown: 'text-dim' }

const result = ref(null)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await awsStore.fetchLoadBalancerPath(props.lb)
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function routeText(subnet) {
  const route = subnet.defaultRoute || { kind: 'none' }
  return t(`lbPath.route.${route.kind}`, { target: route.target || '' })
}

function ruleText(rule) {
  if (!rule) return ''
  return rule.via === 'group'
    ? t('lbPath.ruleGroup', { group: rule.groupId, source: rule.source })
    : t('lbPath.ruleCidr', { group: rule.groupId, source: rule.source })
}
</script>

<style scoped>
.lbp-hint { font-size: 11px; margin: 0 0 6px; }
.lbp h6 { margin: 10px 0 4px; font-size: 12px; }
.lbp-findings, .lbp-notes { margin: 6px 0; padding-left: 18px; font-size: 12px; }
.lbp-notes { font-size: 11px; }
.mono-xs { font-family: monospace; font-size: 11px; }
</style>

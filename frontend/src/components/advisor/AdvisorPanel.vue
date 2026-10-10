<template>
  <section class="adv" :class="lens" data-test="advisor">
    <header class="adv-head">
      <div class="adv-title">
        <i :data-lucide="lens === 'product' ? 'target' : 'shield-check'"></i>
        <div>
          <h3>{{ t(lens === 'product' ? 'advisor.titleProduct' : 'advisor.title') }}</h3>
          <p>{{ t(lens === 'product' ? 'advisor.subtitleProduct' : 'advisor.subtitle') }}</p>
        </div>
      </div>
      <div class="adv-head-side">
        <span v-if="report && totals.checks" class="adv-score" :class="scoreLevel" :title="t('advisor.passedHint')" data-test="advisor-score">
          {{ t('advisor.passed', { passed: totals.passed, checks: totals.checks }) }}<template v-if="totals.accepted"> · {{ t('advisor.acceptedCount', { n: totals.accepted }) }}</template><template v-if="report.unavailable?.length"> · {{ t('advisor.notCheckedCount', { n: report.unavailable.length }) }}</template>
        </span>
        <button
          v-if="canDecide" class="btn btn-icon" :class="{ active: showHistory }" :title="t('advisor.history.title')"
          :aria-pressed="showHistory" data-test="advisor-history-toggle" @click="toggleHistory"
        >
          <i data-lucide="chart-no-axes-combined"></i>
        </button>
        <AgentBriefActions
          v-if="report?.findings?.length" compact
          :build="buildBrief" :subject="briefSubject"
        />
        <button v-if="refreshable" class="btn btn-icon" :class="{ refreshing: loading }" :disabled="loading" :title="t('advisor.rescan')" @click="$emit('refresh')">
          <i data-lucide="refresh-cw"></i>
        </button>
        <button class="btn btn-icon" :title="t(collapsed ? 'advisor.expand' : 'advisor.collapse')" :aria-expanded="!collapsed" @click="toggleCollapsed">
          <i :data-lucide="collapsed ? 'chevron-down' : 'chevron-up'"></i>
        </button>
      </div>
    </header>

    <p v-if="collapsed && report?.locked" class="adv-foot">
      <i data-lucide="lock"></i>{{ t('advisor.collapsedSummary', { n: report.totals.findings, high: report.totals.high }) }} · {{ t('plan.name_pro') }}
    </p>
    <p v-else-if="collapsed && report?.findings?.length" class="adv-foot">
      {{ t('advisor.collapsedSummary', { n: report.findings.length, high: report.findings.filter(f => f.severity === 'high').length }) }}
    </p>

    <template v-if="!collapsed">
      <p v-if="loading && !report" class="adv-empty">{{ t('advisor.loading') }}</p>
      <p v-else-if="error && !report" class="adv-notice"><i data-lucide="alert-triangle"></i>{{ error }}</p>
      <!-- Free plan: the Advisor is a Pro feature; the counts show what it found -->
      <div v-else-if="report?.locked" class="adv-locked" data-test="advisor-locked">
        <i data-lucide="lock"></i>
        <div>
          <p class="adv-locked-title">{{ t('advisor.lockedTitle') }}</p>
          <p>{{ t('advisor.lockedBody', { n: report.totals.findings, high: report.totals.high, medium: report.totals.medium, low: report.totals.low }) }}</p>
          <div v-if="categories.length > 1" class="adv-cats">
            <span v-for="cat in categories" :key="cat" class="adv-cat">
              <i :data-lucide="CATEGORY_ICONS[cat]"></i>{{ t(`advisor.cat.${cat}`) }} <b :class="{ high: report.summary[cat]?.high }">{{ report.summary[cat]?.findings ?? 0 }}</b>
            </span>
          </div>
          <button class="btn sm primary" data-test="advisor-see-plans" @click="openPlans">{{ t('advisor.seePlans') }}</button>
        </div>
      </div>
      <p v-else-if="report?.error" class="adv-notice"><i data-lucide="alert-triangle"></i>{{ report.error }}</p>
      <template v-else-if="report">
        <!-- Posture over time: one point per analysis (lib/advisor/posture.js) -->
        <div v-if="showHistory" class="adv-history" data-test="advisor-history">
          <p v-if="historyLoading" class="adv-dim">{{ t('advisor.loading') }}</p>
          <p v-else-if="historyError" class="adv-notice"><i data-lucide="alert-triangle"></i>{{ historyError }}</p>
          <p v-else-if="historySeries.passed.length < 2" class="adv-dim">{{ t('advisor.history.notEnough') }}</p>
          <template v-else>
            <p class="adv-dim">{{ t('advisor.history.hint', { category: t(`advisor.cat.${category}`), n: historySeries.passed.length }) }}</p>
            <div class="adv-history-charts">
              <CloudMetricChart :label="t('advisor.history.passed')" unit="%" :points="historySeries.passed" color="#3fb950" show-date />
              <CloudMetricChart :label="t('advisor.history.high')" unit="count" :points="historySeries.high" color="#f85149" show-date />
            </div>
          </template>
        </div>

        <p v-if="report.posture?.expired" class="adv-foot adv-warn" data-test="advisor-expired">
          <i data-lucide="clock-alert"></i>{{ t('advisor.acceptance.expiredNotice', { n: report.posture.expired }) }}
        </p>
        <p v-if="report.posture?.expiringSoon" class="adv-foot" data-test="advisor-expiring">
          <i data-lucide="clock"></i>{{ t('advisor.acceptance.expiringNotice', { n: report.posture.expiringSoon }) }}
        </p>

        <section v-if="lens === 'product' && report.errorBudget?.objectives?.length" class="adv-budget" data-test="advisor-error-budget">
          <h4>{{ t('advisor.errorBudget.title') }}</h4>
          <div v-for="objective in report.errorBudget.objectives" :key="objective.source" class="adv-budget-row">
            <strong>{{ t(`advisor.errorBudget.source.${objective.source}`) }}</strong>
            <span>{{ t('advisor.errorBudget.measure', { rate: objective.errorRatePercent.toFixed(2), target: objective.targetPercent.toFixed(2) }) }}</span>
            <span>{{ t('advisor.errorBudget.usage', { consumed: objective.consumedPercent.toFixed(1), remaining: objective.remainingPercent.toFixed(1), burn: objective.burnRate.toFixed(2) }) }}</span>
          </div>
        </section>

        <section v-if="lens === 'product' && report.technical" class="adv-product-insights" data-test="advisor-technical">
          <h4>{{ t('advisor.technical.title') }}</h4>
          <p v-if="report.technical.analyzedAt" class="adv-dim">{{ t('advisor.technical.analyzedAt', { date: when(report.technical.analyzedAt) }) }}</p>
          <p v-else class="adv-dim">{{ t('advisor.technical.empty') }}</p>
          <ul v-if="report.technical.findings?.length" class="adv-insight-list">
            <li v-for="finding in report.technical.findings" :key="finding.id">
              <span>{{ t(`advisor.rule.${finding.id}.title`, { count: finding.count }) }}</span>
              <span class="adv-dim">{{ finding.resources.map(resource => resource.name).join(', ') }}</span>
            </li>
          </ul>
          <h4>{{ t('advisor.dora.title') }}</h4>
          <p class="adv-dim">{{ t(`advisor.dora.${report.technical.dora?.reason || 'unavailable'}`) }}</p>
          <ul v-if="report.recommendations?.length" class="adv-insight-list" data-test="advisor-cross-recommendations">
            <li v-for="recommendation in report.recommendations" :key="recommendation.id">
              {{ t(`advisor.recommendation.${recommendation.id}`, { resources: recommendation.resources?.join(', ') || '', sources: recommendation.sources?.join(', ') || '' }) }}
            </li>
          </ul>
        </section>

        <div v-if="categories.length > 1" class="adv-cats" role="tablist">
          <button
            :class="['adv-cat', { active: category === 'all' }]" role="tab" :aria-selected="category === 'all'"
            @click="category = 'all'"
          >{{ t('advisor.cat.all') }} <b>{{ report.findings.length }}</b></button>
          <button
            v-for="cat in categories" :key="cat"
            :class="['adv-cat', { active: category === cat }]" role="tab" :aria-selected="category === cat"
            :data-test="`advisor-cat-${cat}`"
            @click="category = cat"
          >
            <i :data-lucide="CATEGORY_ICONS[cat]"></i>{{ t(`advisor.cat.${cat}`) }}
            <b :class="{ high: report.summary[cat]?.high }">{{ report.summary[cat]?.findings ?? 0 }}</b>
          </button>
        </div>

        <p v-if="!visible.length" class="adv-ok">
          <i data-lucide="check-circle-2"></i>
          {{ category === 'all' ? t('advisor.allGood') : t('advisor.categoryGood', { category: t(`advisor.cat.${category}`) }) }}
        </p>

        <p v-else class="adv-sev-summary" data-test="advisor-severity-summary">
          <template v-for="(sev, index) in SEVERITIES.filter(level => severityCounts[level])" :key="sev">
            <span v-if="index" class="adv-dim" aria-hidden="true">·</span>
            <span :class="['adv-sev', sev]">{{ severityCounts[sev] }} {{ t(`advisor.severity.${sev}`) }}</span>
          </template>
        </p>

        <ul v-if="visible.length" class="adv-list">
          <li v-for="finding in shown" :key="finding.id" :class="['adv-item', finding.severity]" :data-test="`advisor-finding-${finding.id}`">
            <button class="adv-row" :aria-expanded="open === finding.id" @click="open = open === finding.id ? null : finding.id">
              <span :class="['adv-sev', finding.severity]">{{ t(`advisor.severity.${finding.severity}`) }}</span>
              <span class="adv-row-title">{{ t(`advisor.rule.${finding.id}.title`, { count: finding.count, ...finding.params }) }}</span>
              <span v-if="category === 'all' && categories.length > 1" class="adv-tag">{{ t(`advisor.cat.${finding.category}`) }}</span>
              <span class="adv-count">{{ finding.count }}</span>
              <i :data-lucide="open === finding.id ? 'chevron-up' : 'chevron-down'"></i>
            </button>
            <div v-if="open === finding.id" class="adv-detail">
              <p>{{ t(`advisor.rule.${finding.id}.body`, { count: finding.count, ...finding.params }) }}</p>
              <ul class="adv-resources">
                <li v-for="(resource, i) in finding.resources" :key="i">
                  <span class="adv-kind">{{ resource.kind }}</span>
                  <code>{{ resource.namespace ? `${resource.namespace}/` : '' }}{{ resource.name }}</code>
                  <span v-if="resource.detail" class="adv-dim">{{ resource.detail }}</span>
                </li>
                <li v-if="finding.truncated" class="adv-dim">{{ t('advisor.more', { n: finding.count - finding.resources.length }) }}</li>
              </ul>
              <!-- Resources of this rule already accepted or silenced -->
              <ul v-if="finding.acceptedResources?.length" class="adv-resources adv-accepted-resources">
                <li v-for="item in finding.acceptedResources" :key="item.acceptance.id">
                  <span class="adv-chip">{{ t(`advisor.acceptance.kind.${item.acceptance.kind}`) }}</span>
                  <code>{{ item.acceptance.resourceLabel }}</code>
                  <span class="adv-dim">{{ item.acceptance.reason }}</span>
                </li>
              </ul>
              <div class="adv-detail-actions">
                <a v-if="finding.docs" class="btn sm" :href="finding.docs" target="_blank" rel="noopener noreferrer">{{ t('advisor.docs') }} ↗</a>
                <template v-if="canDecide && decision?.findingId !== finding.id">
                  <button class="btn sm" :data-test="`advisor-accept-${finding.id}`" @click="startDecision(finding, 'accepted')">{{ t('advisor.acceptance.accept') }}</button>
                  <button class="btn sm" :data-test="`advisor-silence-${finding.id}`" @click="startDecision(finding, 'silenced')">{{ t('advisor.acceptance.silence') }}</button>
                </template>
              </div>
              <!-- Accept (a known, owned risk) or silence (does not apply): reason required, expiry optional -->
              <form v-if="decision?.findingId === finding.id" class="adv-decision" data-test="advisor-decision" @submit.prevent="submitDecision">
                <p class="adv-dim">{{ t(`advisor.acceptance.hint.${decision.kind}`) }}</p>
                <div v-if="finding.resources?.length" class="adv-decision-target">
                  <label><input v-model="decision.target" type="radio" value="rule" /> {{ t('advisor.acceptance.wholeRule') }}</label>
                  <label><input v-model="decision.target" type="radio" value="resources" data-test="advisor-decision-resources" /> {{ t('advisor.acceptance.someResources') }}</label>
                  <div v-if="decision.target === 'resources'" class="adv-decision-list">
                    <label v-for="(resource, i) in finding.resources" :key="i">
                      <input v-model="decision.selected" type="checkbox" :value="i" />
                      <code>{{ resource.namespace ? `${resource.namespace}/` : '' }}{{ resource.name }}</code>
                    </label>
                  </div>
                </div>
                <label class="adv-decision-field">
                  {{ t('advisor.acceptance.reason') }}
                  <textarea v-model="decision.reason" rows="2" maxlength="500" required :placeholder="t(`advisor.acceptance.reasonPlaceholder.${decision.kind}`)" data-test="advisor-decision-reason"></textarea>
                </label>
                <label class="adv-decision-field">
                  {{ t('advisor.acceptance.expires') }}
                  <select v-model="decision.days">
                    <option v-for="days in EXPIRY_CHOICES" :key="days" :value="days">{{ days ? t('advisor.acceptance.days', { n: days }) : t('advisor.acceptance.never') }}</option>
                  </select>
                </label>
                <!-- Team plan: an owner or admin decides once for every member analysing this cloud -->
                <label v-if="report.posture?.teamScope && report.posture?.teamCanDecide" class="adv-decision-share">
                  <input v-model="decision.share" type="checkbox" data-test="advisor-decision-share" />
                  <span>{{ t('advisor.acceptance.shareTeam') }} <span class="adv-dim">{{ t('advisor.acceptance.shareTeamHint') }}</span></span>
                </label>
                <p v-if="decision.error" class="adv-notice"><i data-lucide="alert-triangle"></i>{{ decision.error }}</p>
                <div class="adv-detail-actions">
                  <button type="submit" class="btn sm primary" :disabled="!decisionReady || decision.saving" data-test="advisor-decision-save">{{ t(`advisor.acceptance.confirm.${decision.kind}`) }}</button>
                  <button type="button" class="btn sm" @click="decision = null">{{ t('common.cancel') }}</button>
                </div>
              </form>
            </div>
          </li>
        </ul>

        <button
          v-if="visible.length > INITIAL_FINDINGS" class="adv-more" :aria-expanded="showAllFindings ? 'true' : 'false'"
          data-test="advisor-show-all" @click="showAllFindings = !showAllFindings"
        >{{ showAllFindings ? t('advisor.showFewer') : t('advisor.showAll', { n: visible.length }) }}</button>

        <!-- Accepted and silenced findings: listed apart, outside the score -->
        <div v-if="report.accepted?.length" class="adv-accepted" data-test="advisor-accepted">
          <button class="adv-accepted-toggle" :aria-expanded="showAccepted" @click="showAccepted = !showAccepted">
            <i :data-lucide="showAccepted ? 'chevron-up' : 'chevron-down'"></i>
            {{ t('advisor.acceptance.section', { n: report.accepted.length }) }}
          </button>
          <ul v-if="showAccepted" class="adv-list">
            <li v-for="finding in report.accepted" :key="finding.id" class="adv-item adv-accepted-item" :data-test="`advisor-accepted-${finding.id}`">
              <div class="adv-row adv-row-static">
                <span :class="['adv-sev', finding.severity]">{{ t(`advisor.severity.${finding.severity}`) }}</span>
                <span class="adv-row-title">{{ t(`advisor.rule.${finding.id}.title`, { count: finding.count, ...finding.params }) }}</span>
                <span class="adv-chip">{{ t(`advisor.acceptance.kind.${finding.acceptance.kind}`) }}</span>
                <span v-if="finding.acceptance.team" class="adv-chip adv-chip-team" :data-test="`advisor-team-${finding.id}`">{{ t('advisor.acceptance.teamChip') }}</span>
                <button v-if="!finding.acceptance.team || report.posture?.teamCanDecide" class="btn sm" :disabled="revoking === finding.id" :data-test="`advisor-revoke-${finding.id}`" @click="revoke(finding)">{{ t('advisor.acceptance.revoke') }}</button>
              </div>
              <p class="adv-accepted-why">
                “{{ finding.acceptance.reason }}” — {{ finding.acceptance.author }} · {{ when(finding.acceptance.createdAt) }} ·
                <span :class="{ 'adv-warn': finding.acceptance.expiringSoon }">{{ finding.acceptance.expiresAt ? t('advisor.acceptance.until', { date: when(finding.acceptance.expiresAt) }) : t('advisor.acceptance.never') }}</span>
              </p>
              <p v-if="finding.acceptedResources?.length" class="adv-dim">{{ finding.acceptedResources.map(item => item.acceptance.resourceLabel).join(', ') }}</p>
            </li>
          </ul>
        </div>

        <!-- Scheduled analysis (lib/advisor/scheduler.js): history and alerts move without the overview open -->
        <div v-if="canDecide && scopeKind" class="adv-schedule" data-test="advisor-schedule">
          <label>
            <i data-lucide="calendar-clock"></i>{{ t('advisor.schedule.label') }}
            <select :value="schedule?.intervalHours || 0" :disabled="scheduleBusy" data-test="advisor-schedule-select" @change="setSchedule(Number($event.target.value))">
              <option :value="0">{{ t('advisor.schedule.off') }}</option>
              <option v-for="hours in SCHEDULE_CHOICES" :key="hours" :value="hours" :disabled="hours < minScanHours">
                {{ t('advisor.schedule.every', { n: hours }) }}{{ hours < minScanHours ? ` · ${t('plan.name_team')}` : '' }}
              </option>
            </select>
          </label>
          <span class="adv-dim">{{ t(`advisor.schedule.cost.${scopeKind}`) }}</span>
          <span v-if="scheduleStatus" :class="['adv-schedule-status', { 'adv-warn': schedule.lastStatus !== 'ok' }]" data-test="advisor-schedule-status">{{ scheduleStatus }}</span>
          <span v-if="scheduleError" class="adv-warn">{{ scheduleError }}</span>
        </div>

        <p v-if="report.unavailable?.length" class="adv-foot">
          <i data-lucide="eye-off"></i>
          {{ t('advisor.unavailable', { list: report.unavailable.map(u => u.action || u.source).join(', ') }) }}
        </p>
        <p class="adv-foot adv-dim">
          {{ t(lens === 'product' ? 'advisor.footProduct' : 'advisor.foot') }}
          <template v-if="report.scope?.excludes"> {{ t('advisor.excludes', { pattern: report.scope.excludes }) }}</template>
        </p>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../composables/useI18n'
import { useApi } from '../../composables/useApi'
import { settings } from '../../composables/useSettings'
import { usePlan } from '../../composables/usePlan'
import { advisorBrief } from '../../shared/agentBrief.mjs'
import AgentBriefActions from './AgentBriefActions.vue'
// chart.js loads with the history, not with the overview that shows this panel.
const CloudMetricChart = defineAsyncComponent(() => import('../cloud/CloudMetricChart.vue'))

const props = defineProps({
  report: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // 'technical' (provider overviews) or 'product' (KUApps)
  lens: { type: String, default: 'technical' },
  refreshable: { type: Boolean, default: false },
  // Remembers the collapsed state per placement
  storageKey: { type: String, default: 'advisor' },
  defaultCollapsed: { type: Boolean, default: false },
  // Extra Context rows of the agent brief ({ label: value }), e.g. account or profile
  briefContext: { type: Object, default: () => ({}) },
})
// posture-changed: an acceptance was added or revoked; the parent reloads the report (no new scan).
const emit = defineEmits(['refresh', 'posture-changed'])

const { t } = useI18n()
const { apiFetch } = useApi()
const EXPIRY_CHOICES = [0, 30, 90, 180, 365]
const DAY_MS = 24 * 60 * 60 * 1000
const CATEGORY_ICONS = {
  security: 'shield', infrastructure: 'server', architecture: 'network', development: 'code-2', product: 'target',
}

const category = ref('all')
const open = ref(null)
const collapsed = ref(readCollapsed())

const categories = computed(() => props.report?.categories || [])
// Most severe first; only the first few until "Show all", so the panel does not
// push the rest of the page down (the Overview keeps incidents and inventory in reach).
const SEVERITIES = ['high', 'medium', 'low']
const INITIAL_FINDINGS = 3
const showAllFindings = ref(false)
const visible = computed(() => (props.report?.findings || [])
  .filter(finding => category.value === 'all' || finding.category === category.value)
  .map((finding, index) => ({ finding, index }))
  .sort((a, b) => (SEVERITIES.indexOf(a.finding.severity) - SEVERITIES.indexOf(b.finding.severity)) || a.index - b.index)
  .map(({ finding }) => finding))
const shown = computed(() => {
  if (showAllFindings.value || visible.value.length <= INITIAL_FINDINGS) return visible.value
  const first = visible.value.slice(0, INITIAL_FINDINGS)
  // Keep an opened finding visible when collapsing.
  const opened = visible.value.find(finding => finding.id === open.value)
  return opened && !first.includes(opened) ? [...first, opened] : first
})
const severityCounts = computed(() => visible.value.reduce((counts, finding) => {
  counts[finding.severity] = (counts[finding.severity] || 0) + 1
  return counts
}, {}))
watch(category, () => { showAllFindings.value = false })
const totals = computed(() => Object.values(props.report?.summary || {})
  .reduce((sum, bucket) => ({ passed: sum.passed + bucket.passed, checks: sum.checks + bucket.checks, accepted: sum.accepted + (bucket.accepted || 0) }), { passed: 0, checks: 0, accepted: 0 }))

// ── Acceptances (Pro: the report carries `posture` and is not locked) ─────────
const canDecide = computed(() => !!props.report?.posture && !props.report.locked && !props.report.error)
const decision = ref(null)
const showAccepted = ref(false)
const revoking = ref('')
const decisionReady = computed(() => !!decision.value?.reason.trim()
  && (decision.value.target === 'rule' || decision.value.selected.length > 0))

function startDecision(finding, kind) {
  decision.value = { findingId: finding.id, kind, target: 'rule', selected: [], reason: '', days: kind === 'accepted' ? 90 : 0, share: false, saving: false, error: '' }
}

const jsonPost = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function submitDecision() {
  const current = decision.value
  const finding = (props.report?.findings || []).find(item => item.id === current?.findingId)
  if (!current || !finding || !decisionReady.value) return
  current.saving = true
  current.error = ''
  try {
    await apiFetch('/api/advisor/acceptances', jsonPost({
      scope: props.report.posture.acceptanceScope,
      ruleId: finding.id,
      kind: current.kind,
      reason: current.reason.trim(),
      expiresAt: current.days ? new Date(Date.now() + current.days * DAY_MS).toISOString() : null,
      resources: current.target === 'resources' ? current.selected.map(index => finding.resources[index]) : [],
      ...(current.share ? { share: true, teamScope: props.report.posture.teamScope } : {}),
    }))
    decision.value = null
    emit('posture-changed')
  } catch (err) {
    current.error = err.message
  } finally { current.saving = false }
}

/** Revokes the acceptance of an accepted finding (or every accepted resource of it). */
async function revoke(finding) {
  const ids = finding.acceptedResources?.length ? finding.acceptedResources.map(item => item.acceptance.id) : [finding.acceptance.id]
  revoking.value = finding.id
  try {
    for (const id of [...new Set(ids)]) await apiFetch(`/api/advisor/acceptances/${encodeURIComponent(id)}`, { method: 'DELETE' })
    emit('posture-changed')
  } catch { /* the list stays as it was */ } finally { revoking.value = '' }
}

const when = iso => (iso ? new Date(iso).toLocaleDateString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'medium' }) : '')

// ── Scheduled analysis of this scope (Pro: every 6 h at most, Team: 1 h) ──────
const SCHEDULE_CHOICES = [1, 6, 12, 24]
const whenTime = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const { plan } = usePlan()
const minScanHours = computed(() => plan.value?.limits?.advisorScanMinHours || 6)
const schedule = ref(null)
const scheduleBusy = ref(false)
const scheduleError = ref('')
const scopeKind = computed(() => {
  const kind = String(props.report?.posture?.historyScope || '').split(':')[0]
  return ['aws', 'gcp', 'vercel', 'kubernetes', 'product'].includes(kind) ? kind : ''
})
const scheduleStatus = computed(() => {
  const current = schedule.value
  if (!current) return ''
  if (current.lastStatus === 'skipped') return t('advisor.schedule.skipped')
  if (current.lastStatus === 'error') return t('advisor.schedule.failed', { error: current.lastError })
  if (current.lastRunAt) return t('advisor.schedule.last', { date: whenTime(current.lastRunAt), next: whenTime(current.nextRunAt) })
  return t('advisor.schedule.pending')
})

async function loadSchedule() {
  const scope = props.report?.posture?.historyScope
  if (!scope || !canDecide.value) { schedule.value = null; return }
  try {
    schedule.value = (await apiFetch('/api/advisor/schedules')).find(item => item.scope === scope) || null
  } catch { schedule.value = null }
}

async function setSchedule(hours) {
  const scope = props.report.posture.historyScope
  scheduleBusy.value = true
  scheduleError.value = ''
  try {
    if (hours) schedule.value = await apiFetch('/api/advisor/schedules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, intervalHours: hours }) })
    else if (schedule.value) {
      await apiFetch(`/api/advisor/schedules?scope=${encodeURIComponent(scope)}`, { method: 'DELETE' })
      schedule.value = null
    }
  } catch (err) {
    scheduleError.value = err.message
  } finally { scheduleBusy.value = false }
}

// ── History: passed checks (%) and high findings per analysis ─────────────────
const showHistory = ref(false)
const history = ref([])
const historyLoading = ref(false)
const historyError = ref('')

async function loadHistory() {
  const scope = props.report?.posture?.historyScope
  if (!scope) return
  historyLoading.value = true
  historyError.value = ''
  try {
    history.value = await apiFetch(`/api/advisor/history?scope=${encodeURIComponent(scope)}&days=90`)
  } catch (err) {
    historyError.value = err.message
  } finally { historyLoading.value = false }
}

function toggleHistory() {
  showHistory.value = !showHistory.value
  if (showHistory.value) loadHistory()
}

/** Series of the selected category (or all of them). */
const historySeries = computed(() => {
  const passed = []
  const high = []
  for (const point of history.value) {
    const buckets = category.value === 'all' ? Object.values(point.summary || {}) : [point.summary?.[category.value]].filter(Boolean)
    const sum = buckets.reduce((total, bucket) => ({ passed: total.passed + bucket.passed, checks: total.checks + bucket.checks, high: total.high + bucket.high }), { passed: 0, checks: 0, high: 0 })
    if (!sum.checks) continue
    const t0 = Date.parse(point.capturedAt)
    passed.push({ t: t0, v: (sum.passed / sum.checks) * 100 })
    high.push({ t: t0, v: sum.high })
  }
  return { passed, high }
})
const scoreLevel = computed(() => {
  const findings = props.report?.findings || []
  if (findings.some(finding => finding.severity === 'high')) return 'bad'
  if (findings.some(finding => finding.severity === 'medium')) return 'warn'
  return 'good'
})

const briefSubject = computed(() => {
  const scope = props.report?.scope || {}
  return ['advisor', scope.provider, scope.region || scope.projectId || scope.namespace || scope.applicationId].filter(Boolean).join('-')
})

function buildBrief() {
  return advisorBrief(props.report, { t, lens: props.lens, context: props.briefContext })
}

/** Opens Help & Options on the Account tab, where plans are compared. */
function openPlans() {
  window.dispatchEvent(new CustomEvent('kua:open-help', { detail: { tab: 'account' } }))
}

function readCollapsed() {
  try {
    const stored = localStorage.getItem(`kua.${props.storageKey}.collapsed`)
    return stored === null ? props.defaultCollapsed : stored === '1'
  } catch { return props.defaultCollapsed }
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(`kua.${props.storageKey}.collapsed`, collapsed.value ? '1' : '0') } catch { /* per-viewer convenience only */ }
}

watch(() => props.report, (report, previous) => {
  if (category.value !== 'all' && !categories.value.includes(category.value)) category.value = 'all'
  // A new analysis adds a point: keep the open chart current.
  if (showHistory.value && report?.posture?.historyScope && report.generatedAt !== previous?.generatedAt) loadHistory()
  if (report?.posture?.historyScope !== previous?.posture?.historyScope) loadSchedule()
})

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { refreshIcons(); loadSchedule() })
onUpdated(refreshIcons)
</script>

<style scoped>
.adv { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel, var(--bg)); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.adv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.adv-title { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
.adv-title > svg { width: 20px; height: 20px; color: var(--accent); flex: none; margin-top: 2px; }
.adv-title h3 { margin: 0; font-size: 14px; }
.adv-title p { margin: 2px 0 0; font-size: 11px; color: var(--text-dim); }
.adv-head-side { display: flex; align-items: center; gap: 6px; flex: none; }
.adv-score { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border); white-space: nowrap; }
.adv-score.good { color: var(--green); border-color: var(--green); }
.adv-score.warn { color: var(--yellow); border-color: var(--yellow); }
.adv-score.bad { color: var(--red); border-color: var(--red); }
.adv-cats { display: flex; gap: 4px; flex-wrap: wrap; }
.adv-sev-summary { display: flex; gap: 6px; flex-wrap: wrap; margin: 0; font-size: 11px; }
.adv-more { align-self: flex-start; background: none; border: 0; padding: 2px 0; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; }
.adv-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.adv-budget, .adv-product-insights { display: flex; flex-direction: column; gap: 5px; padding: 8px 0; border-top: 1px solid var(--border); }
.adv-budget h4, .adv-product-insights h4 { margin: 0; font-size: 11px; color: var(--text-dim); }
.adv-budget-row { display: grid; grid-template-columns: minmax(70px, 0.35fr) minmax(0, 1fr) minmax(0, 1.1fr); gap: 8px; align-items: baseline; font-size: 11px; }
.adv-budget-row strong { color: var(--text); }
.adv-budget-row span { color: var(--text-dim); overflow-wrap: anywhere; }
.adv-insight-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.adv-insight-list li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; }
.adv-cat { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid var(--border); border-radius: 14px; background: transparent; color: var(--text-dim); font-size: 11px; cursor: pointer; }
.adv-cat svg { width: 12px; height: 12px; }
.adv-cat:hover { background: var(--bg-hover); color: var(--text); }
.adv-cat.active { border-color: var(--accent); color: var(--text); background: var(--bg-hover); }
.adv-cat b { font-weight: 600; color: var(--text); }
.adv-cat b.high { color: var(--red); }
.adv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.adv-item { border: 1px solid var(--border); border-left-width: 3px; border-radius: 6px; }
.adv-item.high { border-left-color: var(--red); }
.adv-item.medium { border-left-color: var(--yellow); }
.adv-item.low { border-left-color: var(--text-dim); }
.adv-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0; background: transparent; color: var(--text); font-size: 12px; text-align: left; cursor: pointer; }
.adv-row:hover { background: var(--bg-hover); }
.adv-row > svg { width: 14px; height: 14px; color: var(--text-dim); flex: none; }
.adv-row-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.adv-sev { font-size: 10px; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; flex: none; background: var(--bg-hover); color: var(--text-dim); }
.adv-sev.high { background: color-mix(in srgb, var(--red) 18%, transparent); color: var(--red); }
.adv-sev.medium { background: color-mix(in srgb, var(--yellow) 18%, transparent); color: var(--yellow); }
.adv-tag { font-size: 10px; color: var(--text-dim); border: 1px solid var(--border); border-radius: 3px; padding: 0 5px; flex: none; }
.adv-count { font-size: 11px; color: var(--text-dim); min-width: 18px; text-align: right; flex: none; }
.adv-detail { padding: 2px 12px 10px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.adv-detail p { margin: 0; font-size: 12px; line-height: 1.5; }
.adv-detail a.btn { text-decoration: none; }
.adv-resources { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; width: 100%; }
.adv-resources li { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.adv-resources code { font-size: 11px; overflow-wrap: anywhere; }
.adv-kind { color: var(--text-dim); min-width: 80px; }
.adv-dim { color: var(--text-dim); }
.adv-empty, .adv-ok, .adv-notice, .adv-foot { margin: 0; font-size: 12px; display: flex; gap: 6px; align-items: center; }
.adv-ok { color: var(--green); }
.adv-locked { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px dashed var(--border); border-radius: 6px; font-size: 12px; }
.adv-locked > svg { width: 18px; height: 18px; color: var(--accent); flex: none; margin-top: 2px; }
.adv-locked > div { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; min-width: 0; }
.adv-locked p { margin: 0; line-height: 1.5; }
.adv-locked-title { font-weight: 600; }
.adv-ok svg, .adv-notice svg, .adv-foot svg { width: 14px; height: 14px; flex: none; }
.adv-notice { color: var(--yellow); }
.adv-foot { font-size: 11px; color: var(--text-dim); }
.adv-warn { color: var(--yellow); }
.adv-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border); color: var(--text-dim); flex: none; }
.adv-detail-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.adv-decision { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.adv-decision-target { display: flex; flex-direction: column; gap: 4px; }
.adv-decision-target label, .adv-decision-list label { display: flex; gap: 6px; align-items: center; }
.adv-decision-list { display: flex; flex-direction: column; gap: 3px; padding-left: 20px; max-height: 160px; overflow-y: auto; }
.adv-decision-share { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; }
.adv-chip-team { color: var(--accent); border-color: var(--accent); }
.adv-decision-field { display: flex; flex-direction: column; gap: 4px; }
.adv-decision-field textarea, .adv-decision-field select { font: inherit; font-size: 12px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 5px 7px; }
.adv-decision-field textarea { resize: vertical; min-height: 44px; }
.adv-accepted-resources code { opacity: .8; }
.adv-accepted { display: flex; flex-direction: column; gap: 6px; }
.adv-accepted-toggle { align-self: flex-start; display: flex; gap: 4px; align-items: center; border: 0; background: transparent; color: var(--text-dim); font-size: 12px; cursor: pointer; padding: 2px 0; }
.adv-accepted-toggle:hover { color: var(--text); }
.adv-accepted-toggle svg { width: 14px; height: 14px; }
.adv-accepted-item { opacity: .85; }
.adv-row-static { cursor: default; }
.adv-accepted-why { margin: 0; padding: 0 12px 8px; font-size: 11px; color: var(--text-dim); line-height: 1.5; overflow-wrap: anywhere; }
.adv-schedule { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 11px; }
.adv-schedule label { display: flex; gap: 6px; align-items: center; color: var(--text); }
.adv-schedule label svg { width: 14px; height: 14px; color: var(--text-dim); }
.adv-schedule select { font: inherit; font-size: 11px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 2px 4px; }
.adv-history { display: flex; flex-direction: column; gap: 8px; }
.adv-history p { margin: 0; font-size: 12px; }
.adv-history-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
@media (max-width: 640px) {
  .adv-head { flex-direction: column; }
  .adv-tag { display: none; }
}
@media (max-width: 560px) { .adv-budget-row { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
</style>

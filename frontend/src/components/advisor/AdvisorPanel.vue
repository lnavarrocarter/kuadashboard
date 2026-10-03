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
        <span v-if="report && totals.checks" class="adv-score" :class="scoreLevel">
          {{ t('advisor.passed', { passed: totals.passed, checks: totals.checks }) }}
        </span>
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

        <ul v-else class="adv-list">
          <li v-for="finding in visible" :key="finding.id" :class="['adv-item', finding.severity]" :data-test="`advisor-finding-${finding.id}`">
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
              <a v-if="finding.docs" class="btn sm" :href="finding.docs" target="_blank" rel="noopener noreferrer">{{ t('advisor.docs') }} ↗</a>
            </div>
          </li>
        </ul>

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
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../composables/useI18n'
import { advisorBrief } from '../../shared/agentBrief.mjs'
import AgentBriefActions from './AgentBriefActions.vue'

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
defineEmits(['refresh'])

const { t } = useI18n()
const CATEGORY_ICONS = {
  security: 'shield', infrastructure: 'server', architecture: 'network', development: 'code-2', product: 'target',
}

const category = ref('all')
const open = ref(null)
const collapsed = ref(readCollapsed())

const categories = computed(() => props.report?.categories || [])
const visible = computed(() => (props.report?.findings || [])
  .filter(finding => category.value === 'all' || finding.category === category.value))
const totals = computed(() => Object.values(props.report?.summary || {})
  .reduce((sum, bucket) => ({ passed: sum.passed + bucket.passed, checks: sum.checks + bucket.checks }), { passed: 0, checks: 0 }))
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

watch(() => props.report, () => {
  if (category.value !== 'all' && !categories.value.includes(category.value)) category.value = 'all'
})

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(refreshIcons)
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
@media (max-width: 640px) {
  .adv-head { flex-direction: column; }
  .adv-tag { display: none; }
}
</style>

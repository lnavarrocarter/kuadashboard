<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title>{{ t('kuapps.import.title') }}</template>
    <div v-if="preview" class="kip" data-test="import-preview">
      <p class="text-dim kip-note">{{ t('kuapps.import.hint') }}</p>

      <section class="kip-section">
        <h4>{{ preview.application.importAs }}</h4>
        <small class="text-dim">{{ [preview.application.environment, preview.application.team].filter(Boolean).join(' · ') }}</small>
        <p v-if="preview.application.importAs !== preview.application.name" class="kip-note">{{ t('kuapps.import.renamed', { name: preview.application.name }) }}</p>
        <p v-if="preview.application.alreadyHere" class="kip-warn" data-test="import-already-here">{{ t('kuapps.import.alreadyHere') }}</p>
        <p v-else-if="preview.application.sameName.length" class="kip-warn" data-test="import-same-name">{{ t('kuapps.import.sameName', { count: preview.application.sameName.length }) }}</p>
        <p v-if="preview.application.legacy" class="kip-note text-dim">{{ t('kuapps.import.legacy', { provider: preview.application.legacy.provider, region: preview.application.legacy.region }) }}</p>
      </section>

      <section class="kip-section">
        <h4>{{ t('kuapps.import.scopes', { count: preview.scopes.length }) }}</h4>
        <ul v-if="preview.scopes.length" class="kip-list">
          <li v-for="scope in preview.scopes" :key="`${scope.provider}:${scope.scopeId}:${scope.location}`">
            <span><strong>{{ scope.provider }}</strong> {{ scope.label || scope.scopeId || t('kuapps.import.scopePending') }}<small v-if="scope.location" class="text-dim"> · {{ scope.location }}</small></span>
            <small :class="scope.supported ? 'text-dim' : 'kip-warn'">{{ t(scope.supported ? 'kuapps.import.bindAfter' : 'kuapps.import.unsupportedProvider') }}</small>
          </li>
        </ul>
        <p v-else class="kip-note text-dim">{{ t('kuapps.import.noScopes') }}</p>
      </section>

      <section class="kip-section">
        <h4>{{ t('kuapps.import.views', { count: preview.views.length }) }}</h4>
        <ul v-if="preview.views.length" class="kip-list">
          <li v-for="view in preview.views" :key="view.importAs">
            <span>{{ view.importAs }}</span>
            <small class="text-dim">{{ t('kuapps.import.viewCounts', { nodes: view.nodes, edges: view.edges, snapshots: view.snapshots }) }}</small>
          </li>
        </ul>
      </section>

      <section class="kip-section" data-test="import-resources">
        <h4>{{ t('kuapps.import.resources', { count: preview.resources.total }) }}</h4>
        <p class="kip-note">{{ t('kuapps.import.resourceCounts', { members: preview.resources.members, views: preview.resources.fromViews, skipped: preview.resources.skipped.length }) }}</p>
        <p class="kip-note text-dim">{{ t('kuapps.import.noCollection') }}</p>
        <details v-if="preview.resources.existing.length" class="kip-details">
          <summary>{{ t('kuapps.import.existing', { count: preview.resources.existing.length }) }}</summary>
          <ul class="kip-list">
            <li v-for="item in preview.resources.existing" :key="item.id">
              <span>{{ item.displayName }}</span>
              <small class="text-dim">{{ item.applications.map(application => application.name).join(', ') }}</small>
            </li>
          </ul>
        </details>
        <details v-if="preview.resources.skipped.length" class="kip-details" open>
          <summary class="kip-warn">{{ t('kuapps.import.skipped', { count: preview.resources.skipped.length }) }}</summary>
          <ul class="kip-list">
            <li v-for="item in preview.resources.skipped" :key="item.id">
              <span>{{ item.displayName }} <small class="text-dim">{{ item.resourceType }}</small></span>
              <small class="text-dim">{{ t(`kuapps.import.reason.${item.reason}`) }}</small>
            </li>
          </ul>
        </details>
        <details v-if="preview.resources.outsideScopes.length" class="kip-details">
          <summary class="kip-warn">{{ t('kuapps.import.outsideScopes', { count: preview.resources.outsideScopes.length }) }}</summary>
          <ul class="kip-list">
            <li v-for="item in preview.resources.outsideScopes" :key="item.id"><span>{{ item.displayName }}</span><small class="text-dim">{{ item.provider }}</small></li>
          </ul>
        </details>
      </section>

      <section class="kip-section">
        <h4>{{ t('kuapps.import.relationships', { count: preview.relationships.total }) }}</h4>
        <p class="kip-note text-dim">{{ t('kuapps.import.relationshipCounts', { confirmed: preview.relationships.confirmed, rejected: preview.relationships.rejected, suggested: preview.relationships.suggested, detached: preview.detachments, acceptances: preview.acceptances }) }}</p>
      </section>

      <section v-if="preview.issues.length" class="kip-section kip-issues" data-test="import-issues">
        <h4 class="kip-warn">{{ t('kuapps.import.issues') }}</h4>
        <ul class="kip-plain">
          <li v-for="(issue, index) in preview.issues" :key="index">{{ t(`kuapps.import.issue.${issue.kind}`, { count: issue.count || 0, version: issue.contentVersion || '' }) }}</li>
        </ul>
      </section>

      <footer class="kip-actions">
        <button class="btn sm" :disabled="busy" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn sm primary" :disabled="busy" data-test="import-confirm" @click="$emit('confirm')">{{ t('kuapps.import.confirm') }}</button>
      </footer>
    </div>
  </BaseModal>
</template>

<script setup>
import BaseModal from '../BaseModal.vue'
import { useI18n } from '../../composables/useI18n'

defineProps({
  show: { type: Boolean, default: false },
  preview: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})
defineEmits(['close', 'confirm'])

const { t } = useI18n()
</script>

<style scoped>
.kip { display: flex; flex-direction: column; gap: 12px; min-width: min(560px, 100%); max-width: 100%; }
.kip-note { margin: 0; font-size: 12px; }
.kip-warn { margin: 0; font-size: 12px; color: var(--warning, #d97706); }
.kip-section { display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 10px; min-width: 0; }
.kip-section h4 { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.kip-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kip-list li { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; }
.kip-list li span { overflow-wrap: anywhere; min-width: 0; }
.kip-plain { margin: 0; padding-left: 18px; font-size: 12px; }
.kip-details summary { cursor: pointer; font-size: 12px; }
.kip-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
</style>

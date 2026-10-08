<template>
  <div class="architecture-view">
    <header v-if="!props.workspaceMode" class="architecture-toolbar">
      <div class="architecture-title">
        <i data-lucide="network"></i>
        <span><strong>{{ t('archView.title') }}</strong><small>{{ t('archView.subtitle') }}</small></span>
      </div>
      <div class="architecture-actions">
        <input ref="bundleInput" class="bundle-file-input" type="file" accept=".kuaapp.json,application/json" @change="handleBundleFile" />
        <button class="btn sm" :disabled="!profileId || store.saving" :title="t('archView.importHint')" @click="openBundlePicker">
          <i data-lucide="upload"></i> {{ t('archView.importBackup') }}
        </button>
        <button v-if="activeApplication" class="btn sm" :disabled="store.saving" :title="t('archView.exportHint')" @click="exportKuaApp">
          <i data-lucide="download"></i> {{ t('archView.exportBackup') }}
        </button>
        <button v-if="teamInfo" class="btn sm" :disabled="!profileId" :title="t('teamSpace.hint')" data-test="open-team-space" @click="teamSpaceOpen = true">
          <i data-lucide="users"></i> {{ t('teamSpace.button', { name: teamInfo.name }) }}
        </button>
        <button class="btn sm" :disabled="!profileId" :title="t('cloudBackups.hint')" data-test="open-cloud-backups" @click="cloudBackupsOpen = true">
          <i data-lucide="cloud"></i> {{ t('cloudBackups.title') }}
        </button>
        <button class="btn sm btn-icon" :title="t('archView.refreshApplication')" :disabled="store.loading || !profileId" @click="refreshWorkspace">
          <i data-lucide="refresh-cw"></i>
        </button>
        <div v-if="store.selectedProject" class="resource-add-menu">
          <button class="btn sm" :disabled="store.loading" @click="resourceProvider = resourceProvider ? '' : 'aws'">
            <i data-lucide="plus"></i> {{ t('archView.addResources') }}
          </button>
          <div v-if="resourceProvider" class="resource-provider-options">
            <button :class="{ active: resourceProvider === 'aws' }" @click="resourceProvider = 'aws'"><i data-lucide="cloud"></i> AWS</button>
            <button :class="{ active: resourceProvider === 'kubernetes' }" @click="resourceProvider = 'kubernetes'"><i data-lucide="boxes"></i> Kubernetes</button>
            <button :class="{ active: resourceProvider === 'manual' }" @click="resourceProvider = 'manual'"><i data-lucide="square-plus"></i> {{ t('archView.manualResource') }}</button>
            <button :class="{ active: resourceProvider === 'gcp' }" @click="resourceProvider = 'gcp'"><i data-lucide="cloud-cog"></i> GCP</button>
            <button :class="{ active: resourceProvider === 'vercel' }" @click="resourceProvider = 'vercel'"><i data-lucide="triangle"></i> Vercel</button>
          </div>
        </div>
        <button class="btn sm primary" :disabled="!profileId" @click="creatingProject = true">
          <i data-lucide="plus"></i> {{ t('archView.newProject') }}
        </button>
      </div>
    </header>

    <TeamSpaceModal :show="teamSpaceOpen" :profile-id="profileId || ''" @close="teamSpaceOpen = false" />
    <CloudBackupsModal :show="cloudBackupsOpen" :profile-id="profileId || ''" :application-id="activeApplication?.id || ''" :application-name="activeApplication?.name || ''" @close="cloudBackupsOpen = false" />

    <div v-if="!profileId" class="architecture-empty architecture-application-picker">
      <i data-lucide="boxes"></i>
      <strong>{{ t('archView.selectApplication') }}</strong>
      <span>{{ t('archView.selectApplicationHint') }}</span>
      <div v-if="store.loading" class="architecture-empty compact">{{ t('archView.loadingApplications') }}</div>
      <div v-else-if="store.applications.length" class="architecture-first-access-list">
        <button
          v-for="application in store.applications"
          :key="application.id"
          class="architecture-first-access-row"
          @click="selectApplication(application.id)"
        >
          <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
          <span><strong>{{ application.name }}</strong><small>{{ application.provider ? application.provider.toUpperCase() : t('kuapps.multiProvider') }}<template v-if="application.environment"> · {{ application.environment }}</template><template v-if="application.team"> · {{ application.team }}</template></small></span>
          <i data-lucide="arrow-right"></i>
        </button>
      </div>
      <template v-else-if="!store.error">
        <span>{{ t('archView.noApplications') }}</span>
        <button class="btn sm" @click="refreshApplicationCatalog"><i data-lucide="refresh-cw"></i> {{ t('action.refresh') }}</button>
      </template>
      <button v-if="store.error" class="btn sm" @click="refreshApplicationCatalog"><i data-lucide="refresh-cw"></i> {{ t('common.retry') }}</button>
      <div v-if="store.error" class="alert-error architecture-error">{{ store.error }}</div>
    </div>

    <div v-else-if="props.resourcePickerOnly" class="architecture-resource-picker-only">
      <div v-if="store.writeConflict" class="alert-error architecture-error" role="alert" data-test="picker-conflict">{{ t('archView.writeConflict') }}</div>
      <div v-else-if="store.error" class="alert-error architecture-error" role="alert" data-test="picker-error">{{ t('archView.writeFailed', { error: store.error }) }}</div>
      <ArchitectureDiscoveryPanel v-if="resourceProvider === 'aws'" @close="closePicker" @imported="pickerImported" />
      <ArchitectureKubernetesDiscoveryPanel v-if="resourceProvider === 'kubernetes'" @close="closePicker" @imported="pickerImported" />
      <ArchitectureManualResourcePanel v-if="resourceProvider === 'manual'" @close="closePicker" @imported="pickerImported" />
      <ArchitectureCloudDiscoveryPanel v-if="resourceProvider === 'gcp'" provider="gcp" @close="closePicker" @imported="pickerImported" />
      <ArchitectureCloudDiscoveryPanel v-if="resourceProvider === 'vercel'" provider="vercel" @close="closePicker" @imported="pickerImported" />
    </div>

    <div v-else-if="props.settingsOnly" class="architecture-settings-admin">
      <div v-if="store.error" class="alert-error architecture-error">{{ store.error }}</div>
      <section v-if="syncSourceMappings.length" class="architecture-sync-mapping" data-test="sync-source-mapping">
        <header>
          <div><strong>{{ t('archView.sync.mappingTitle') }}</strong><small>{{ t('archView.sync.mappingHint') }}</small></div>
          <span>{{ t('archView.sync.mappingCount', { n: syncSourceMappings.length }) }}</span>
        </header>
        <article v-for="mapping in syncSourceMappings" :key="mapping.id" class="architecture-sync-mapping-row" :data-source-type="mapping.type">
          <span class="architecture-sync-mapping-icon"><i :data-lucide="mapping.type === 'cloudformation' ? 'layers' : mapping.type === 'kubernetes' ? 'boxes' : 'box'"></i></span>
          <span class="architecture-sync-mapping-copy">
            <small>{{ t(`archView.sync.source.${mapping.type}`) }}</small>
            <strong>{{ mapping.name }}</strong>
            <small v-if="mapping.detail">{{ mapping.detail }}</small>
          </span>
          <details v-if="mapping.resources.length" class="architecture-sync-mapping-resources">
            <summary>{{ t('archView.sync.mappingResources', { n: mapping.resources.length }) }}</summary>
            <span v-for="resource in mapping.resources" :key="resource.id">{{ resource.name }} · {{ resource.resourceType || resource.kind }}</span>
          </details>
        </article>
      </section>
      <section v-if="syncSource" class="architecture-settings-sync">
        <header>
          <div><span class="architecture-kicker">{{ t('archView.cfnSyncPreview') }}</span><strong>{{ syncSource ? syncSourceLabel : t('archView.noCfnSource') }}</strong></div>
          <button class="btn sm" :disabled="currentSyncState.previewing || currentSyncState.applying" @click="previewSync">
            <i :data-lucide="currentSyncState.previewing ? 'loader-2' : 'refresh-cw'"></i>
            {{ currentSyncState.previewing ? t('archView.checking') : t('archView.syncPreview') }}
          </button>
        </header>
        <p v-if="currentSyncState.error" class="alert-error architecture-error" role="alert">{{ currentSyncState.error }}</p>
        <section v-if="currentSyncState.preview" class="sync-preview-panel">
          <header>
            <span><i data-lucide="refresh-cw"></i><strong>{{ t('archView.cfnSyncPreview') }}</strong><small>{{ syncSourceLabel }}</small></span>
            <strong>{{ t(currentSyncState.preview.summary.changeCount === 1 ? 'archView.change' : 'archView.changes', { n: currentSyncState.preview.summary.changeCount }) }}</strong>
            <button class="btn sm btn-icon" :title="t('archView.closeSyncPreview')" @click="store.clearProjectSyncPreview(store.selectedProjectId)"><i data-lucide="x"></i></button>
          </header>
          <div class="sync-preview-grid">
            <div v-for="item in resourceSyncCounts" :key="`resource:${item.key}`"><span>{{ item.label }}</span><strong>{{ item.count }}</strong></div>
          </div>
          <div class="sync-preview-grid relationship-grid">
            <div v-for="item in relationshipSyncCounts" :key="`relationship:${item.key}`"><span>{{ item.label }}</span><strong>{{ item.count }}</strong></div>
          </div>
          <div class="sync-review-lists">
            <details v-for="section in syncResourceSections" :key="section.key" v-show="section.items.length">
              <summary>{{ section.label }} <strong>{{ section.items.length }}</strong></summary>
              <span v-for="item in section.items" :key="syncItemId(item)" class="sync-review-item">{{ syncItemName(item) }}</span>
            </details>
            <details v-for="section in syncRelationshipSections" :key="section.key" v-show="section.items.length">
              <summary>{{ section.label }} <strong>{{ section.items.length }}</strong></summary>
              <span v-for="item in section.items" :key="syncItemId(item)" class="sync-review-item">{{ syncRelationshipName(item) }}</span>
            </details>
          </div>
          <footer>
            <span>{{ t('archView.willBecomeStale', { n: currentSyncState.preview.summary.resources.missing }) }}</span>
            <button class="btn sm primary" :disabled="currentSyncState.applying || currentSyncState.previewing" @click="applySync"><i data-lucide="check"></i> {{ t('archView.applySync') }}</button>
          </footer>
        </section>
      </section>
    </div>

    <template v-else>
      <div v-if="store.error" class="alert-error architecture-error">{{ store.error }}</div>
      <form v-if="creatingProject && !props.workspaceMode" class="architecture-create" @submit.prevent="submitProject">
        <input v-model.trim="projectDraft.name" class="ctrl-input" required maxlength="120" :placeholder="t('archView.projectName')" />
        <input v-model.trim="projectDraft.description" class="ctrl-input" maxlength="500" :placeholder="t('archView.description')" />
        <button class="btn sm primary" :disabled="store.saving"><i data-lucide="arrow-right"></i> {{ t('archView.createAndConfigure') }}</button>
        <button type="button" class="btn sm" @click="creatingProject = false">{{ t('action.cancel') }}</button>
      </form>

      <div :class="['architecture-layout', { 'architecture-layout--embedded': props.hideApplicationList }]">
        <aside v-if="!props.hideApplicationList" class="architecture-projects">
          <template v-if="!props.hideApplicationList && store.applications.length">
            <div class="architecture-list-heading"><span>{{ t('archView.kuaApplications') }}</span><strong>{{ store.applications.length }}</strong></div>
            <button
              v-for="application in store.applications"
              :key="application.id"
              :class="['architecture-application-row', { active: store.selectedApplicationId === application.id }]"
              @click="selectApplication(application.id)"
            >
              <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
              <span><strong>{{ application.name }}</strong><small>{{ [application.environment, application.team].filter(Boolean).join(' / ') || (application.provider ? application.provider.toUpperCase() : t('kuapps.multiProvider')) }}</small></span>
            </button>
          </template>
          <div class="architecture-list-heading"><span>{{ t('archView.projects') }}</span><strong>{{ store.projects.length }}</strong></div>
          <button
            v-for="project in store.projects"
            :key="project.id"
            :class="['architecture-project-row', { active: store.selectedProjectId === project.id }]"
            @click="store.selectProject(project.id)"
          >
            <span class="project-mark">{{ project.name.slice(0, 2).toUpperCase() }}</span>
            <span><strong>{{ project.name }}</strong><small>{{ project.description || t('archView.defaultProjectDescription') }}</small></span>
          </button>
          <button v-if="!store.projects.length && !store.loading" class="architecture-project-empty" @click="creatingProject = true">
            <i data-lucide="plus"></i> {{ t('archView.createFirstProject') }}
          </button>
        </aside>

        <main class="architecture-workspace">
          <div v-if="store.loading" class="architecture-empty compact">{{ t('archView.loadingArchitecture') }}</div>
          <div v-else-if="!store.selectedProject" class="architecture-empty">
            <i data-lucide="waypoints"></i>
            <strong>{{ store.selectedApplication ? t('archView.noViewFor', { name: store.selectedApplication.name }) : t('archView.noneSelected') }}</strong>
            <span>{{ props.workspaceMode ? t('kuapps.canvasEmptyHint') : store.selectedApplication ? t('archView.createViewHint') : t('archView.createProjectHint') }}</span>
            <button v-if="props.workspaceMode && store.selectedApplication" class="btn sm primary" @click="emit('request-resource-picker')"><i data-lucide="plus"></i> {{ t('archView.addResources') }}</button>
            <button v-else-if="store.selectedApplication" class="btn sm primary" @click="creatingProject = true"><i data-lucide="plus"></i> {{ t('archView.createApplicationView') }}</button>
          </div>
          <template v-else>
            <section v-if="!props.workspaceMode" class="architecture-project-header">
              <div>
                <span class="architecture-kicker">{{ applicationContextLabel }} / {{ t('archView.revision', { n: store.graph?.revision ?? 0 }) }}</span>
                <h2>{{ props.workspaceMode ? activeApplication?.name || store.selectedApplication?.name : store.selectedProject.name }}</h2>
                <p v-if="!props.workspaceMode">{{ store.selectedProject.description || t('archView.defaultWorkspaceDescription') }}</p>
              </div>
              <form class="snapshot-form" @submit.prevent="submitSnapshot">
                <input v-model.trim="snapshotName" class="ctrl-input" required maxlength="120" :placeholder="t('archView.snapshotName')" />
                <button class="btn sm" :disabled="store.saving"><i data-lucide="camera"></i> {{ t('archView.snapshot') }}</button>
                <button v-if="!props.workspaceMode" class="btn sm btn-icon danger" type="button" :disabled="store.saving" :title="t('archView.deleteProject')" @click="deleteProject">
                  <i data-lucide="trash-2"></i>
                </button>
              </form>
            </section>

            <section v-if="!props.workspaceMode && (store.selectedApplication || store.linkedApplications.length)" class="architecture-application-context">
              <span class="architecture-application-context-wide"><small>{{ t('archView.applications') }}</small><strong>{{ linkedApplicationLabel }}</strong></span>
              <span><small>{{ t('archView.provider') }}</small><strong>{{ activeApplication?.provider?.toUpperCase() || '—' }}</strong></span>
              <span><small>{{ t('archView.environment') }}</small><strong>{{ activeApplication?.environment || '—' }}</strong></span>
              <span><small>{{ t('archView.team') }}</small><strong>{{ activeApplication?.team || '—' }}</strong></span>
              <span><small>{{ t('archView.scopes') }}</small><strong>{{ store.graph?.document?.scopes?.length || 0 }}</strong></span>
              <span :class="(store.linkedApplications.length || activeApplication?.architectureProjectId) ? 'linked' : 'unlinked'"><small>{{ t('archView.title') }}</small><strong>{{ (store.linkedApplications.length || activeApplication?.architectureProjectId) ? t('archView.linked') : t('archView.notLinked') }}</strong></span>
            </section>

            <section v-if="!props.workspaceMode" class="architecture-stats">
              <div><span>{{ t('archView.nodes') }}</span><strong>{{ store.graph?.document.nodes.length || 0 }}</strong></div>
              <div><span>{{ t('archView.relations') }}</span><strong>{{ store.graph?.document.edges.length || 0 }}</strong></div>
              <div><span>{{ t('archView.sources') }}</span><strong>{{ store.graph?.document.sources.length || 0 }}</strong></div>
              <div><span>{{ t('archView.snapshots') }}</span><strong>{{ store.snapshots.length }}</strong></div>
            </section>

            <section v-if="!props.workspaceMode && staleResources.length" class="stale-resource-list">
              <header><span>{{ t('archView.staleResources') }}</span><small>{{ t('archView.needDecision', { n: staleResources.length }) }}</small></header>
              <div v-for="node in staleResources" :key="node.id" class="stale-resource-row">
                <span><strong>{{ node.name }}</strong><small>{{ node.kind || node.resourceType }}</small></span>
                <button class="btn sm" :disabled="store.saving" @click="restoreStaleResource(node)"><i data-lucide="undo-2"></i> {{ t('archView.restore') }}</button>
                <button class="btn sm danger" :disabled="store.saving" @click="removeStaleResource(node)"><i data-lucide="trash-2"></i> {{ t('archView.remove') }}</button>
              </div>
            </section>

            <ArchitectureDiscoveryPanel
              v-if="resourceProvider === 'aws'"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureKubernetesDiscoveryPanel
              v-if="resourceProvider === 'kubernetes'"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureManualResourcePanel
              v-if="resourceProvider === 'manual'"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureCloudDiscoveryPanel
              v-if="resourceProvider === 'gcp'"
              provider="gcp"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />
            <ArchitectureCloudDiscoveryPanel
              v-if="resourceProvider === 'vercel'"
              provider="vercel"
              @close="resourceProvider = ''"
              @imported="resourceProvider = ''"
            />

            <ArchitectureGraphAdvisor
              v-if="store.graph"
              :graph="store.graph"
              :saving="store.saving"
              @operation="applyCanvasOperation"
            />

            <nav v-if="!props.workspaceMode" class="architecture-view-tabs" role="tablist" :aria-label="t('archView.viewTabs')">
              <button type="button" role="tab" :aria-selected="activeView === 'routes'" :tabindex="activeView === 'routes' ? 0 : -1" :class="['architecture-view-tab', { active: activeView === 'routes' }]" @keydown="handleArchitectureTabKeydown" @click="activeView = 'routes'">
                <i data-lucide="route"></i> {{ t('archView.routes') }}
              </button>
              <button type="button" role="tab" :aria-selected="activeView === 'canvas'" :tabindex="activeView === 'canvas' ? 0 : -1" :class="['architecture-view-tab', { active: activeView === 'canvas' }]" @keydown="handleArchitectureTabKeydown" @click="activeView = 'canvas'">
                <i data-lucide="network"></i> {{ t('archView.canvas') }}
              </button>
              <button type="button" role="tab" :aria-selected="activeView === 'resources'" :tabindex="activeView === 'resources' ? 0 : -1" :class="['architecture-view-tab', { active: activeView === 'resources' }]" :disabled="!store.linkedApplication" @keydown="handleArchitectureTabKeydown" @click="selectResourcesView">
                <i data-lucide="database"></i> {{ t('archView.resources') }}
              </button>
            </nav>

            <section v-if="store.graph && activeView === 'routes'" class="architecture-view-panel" role="tabpanel" :aria-label="t('archView.routes')">
              <ArchitectureRoutes
                :graph="store.graph"
                @inspect-workflow="openWorkflow"
                @operation="applyCanvasOperation"
              />
            </section>

            <section v-if="store.graph && activeView === 'canvas'" class="architecture-view-panel" role="tabpanel" :aria-label="t('archView.canvas')">
              <ArchitectureCanvas
                :graph="store.graph"
                :saving="store.saving"
                :observability-enabled="Boolean(store.linkedApplication)"
                :metrics="metricsByNode"
                :metrics-loading="metricsLoading"
                :collection="collectionByNode"
                :collection-loading="metricsLoading"
                :trace-enabled="traceEnabled"
                :trace="traceOverlay"
                :trace-loading="traceLoading"
                :events="eventsByNode"
                :events-loading="eventsLoading"
                :rollouts="rolloutsByNode"
                :rollouts-loading="rolloutsLoading"
                :security="securityByNode"
                :security-loading="securityLoading"
                @operation="applyCanvasOperation"
                @inspect-workflow="openWorkflow"
                @resource-selected="emit('resource-selected', $event)"
                @node-action="handleNodeAction"
                @request-metrics="loadOperationalMetrics"
                @request-trace="loadOperationalTrace"
                @request-events="loadOperationalEvents"
                @request-rollouts="loadOperationalRollouts"
                @request-security="loadOperationalSecurity"
              />
            </section>

            <section v-if="activeView === 'resources'" class="architecture-view-panel" role="tabpanel" :aria-label="t('archView.resources')">
              <ArchitectureResources
                :graph="store.graph"
                :registry="store.registry"
                :loading="store.registryLoading"
                @refresh="store.loadRegistry"
                @operation="applyCanvasOperation"
              />
            </section>

            <StepFnDetail
              :open="Boolean(selectedWorkflow)"
              :sm="selectedWorkflow"
              :profile-id="profileId"
              initial-tab="diagram"
              @close="selectedWorkflow = null"
            />

            <BaseModal :show="Boolean(inlineNode)" wide @close="inlineNode = null">
              <template #title>{{ inlineNode?.name }} — {{ inlineMode === 'logs' ? t('archView.logs') : t('archView.metrics') }}</template>
              <ApmProviderMetrics
                v-if="inlineNode && inlineMode === 'metrics'"
                :provider="store.linkedApplication?.provider || 'generic'"
                :profile-id="store.linkedApplication?.profileId"
                :application="store.linkedApplication"
                :resources="inlineResources"
              />
              <ApmApplicationLogs
                v-else-if="inlineNode"
                :provider="store.linkedApplication?.provider || 'generic'"
                :profile-id="store.linkedApplication?.profileId"
                :application="store.linkedApplication"
                :resources="inlineResources"
                @open-kubernetes-logs="handleNodeAction({ action: 'kubernetes-logs', node: inlineNode })"
              />
            </BaseModal>

            <section v-if="store.snapshots.length" class="snapshot-list">
              <header><span>{{ t('archView.snapshots') }}</span><small>{{ t('archView.immutableHistory') }}</small></header>
              <div v-for="snapshot in store.snapshots" :key="snapshot.id" class="snapshot-row">
                <span class="snapshot-version">v{{ snapshot.version }}</span>
                <span><strong>{{ snapshot.name }}</strong><small>{{ t('archView.revisionLabel', { n: snapshot.sourceRevision }) }}</small></span>
                <time>{{ new Date(snapshot.createdAt).toLocaleString() }}</time>
                <button class="btn sm btn-icon" :title="t('archView.compareSnapshot')" @click="compareSnapshot(snapshot.id)">
                  <i data-lucide="git-compare-arrows"></i>
                </button>
                <button class="btn sm btn-icon" :title="t('archView.restoreSnapshot')" :disabled="store.saving" @click="restoreSnapshot(snapshot)">
                  <i data-lucide="history"></i>
                </button>
              </div>
            </section>

            <section v-if="store.snapshotDiff" class="architecture-diff">
              <span><i data-lucide="git-compare-arrows"></i> {{ t('archView.comparedWith', { n: store.snapshotDiff.snapshot.version }) }}</span>
              <strong>{{ t(store.snapshotDiff.diff.changeCount === 1 ? 'archView.change' : 'archView.changes', { n: store.snapshotDiff.diff.changeCount }) }}</strong>
              <button class="btn sm btn-icon" :title="t('archView.closeComparison')" @click="store.snapshotDiff = null"><i data-lucide="x"></i></button>
            </section>

            <section v-if="store.changes.length" class="change-list">
              <header><span>{{ t('archView.changeHistory') }}</span><small>{{ t('archView.latestRevisions', { n: store.changes.length }) }}</small></header>
              <div v-for="change in store.changes" :key="change.id" class="change-row">
                <span class="change-revision">r{{ change.revision }}</span>
                <span><strong>{{ changeLabel(change.type) }}</strong><small>{{ change.reason || change.subjectId || change.subjectType }}</small></span>
                <time>{{ new Date(change.createdAt).toLocaleString() }}</time>
              </div>
            </section>
          </template>
        </main>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useApmStore } from '../../stores/useApmStore'
import { useAwsStore } from '../../stores/useAwsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'
import { suggestGraphRelationships } from '../../lib/logRelationshipEvidence'
import StepFnDetail from '../StepFnDetail.vue'
import BaseModal from '../BaseModal.vue'
import CloudBackupsModal from './CloudBackupsModal.vue'
import TeamSpaceModal from './TeamSpaceModal.vue'
import { api, useApi } from '../../composables/useApi'
import ApmProviderMetrics from '../cloud/apm/ApmProviderMetrics.vue'
import ApmApplicationLogs from '../cloud/apm/ApmApplicationLogs.vue'
import ArchitectureCanvas from './ArchitectureCanvas.vue'
import ArchitectureDiscoveryPanel from './ArchitectureDiscoveryPanel.vue'
import ArchitectureKubernetesDiscoveryPanel from './ArchitectureKubernetesDiscoveryPanel.vue'
import ArchitectureCloudDiscoveryPanel from './ArchitectureCloudDiscoveryPanel.vue'
import ArchitectureManualResourcePanel from './ArchitectureManualResourcePanel.vue'
import ArchitectureResources from './ArchitectureResources.vue'
import ArchitectureRoutes from './ArchitectureRoutes.vue'
import ArchitectureGraphAdvisor from './ArchitectureGraphAdvisor.vue'
import { catalogFor } from '../cloud/apm/metricCatalog'
import { awsSecurityByNode, gcpSecurityByNode, kubernetesRolloutsByNode, kubernetesSecurityByNode, mergeNodeFindings } from '../../lib/architectureOverlayProjection'

const props = defineProps({
  profileId: { type: String, default: '' },
  projectId: { type: String, default: '' },
  applicationId: { type: String, default: '' },
  hideApplicationList: { type: Boolean, default: false },
  workspaceMode: { type: Boolean, default: false },
  workspaceSection: { type: String, default: 'routes' },
  settingsOnly: { type: Boolean, default: false },
  // Only the discovery panel of one provider: the KUApps Add resources panel hosts it (#151).
  resourcePickerOnly: { type: Boolean, default: false },
})
const emit = defineEmits([
  'open-observability', 'application-context', 'resource-selected', 'request-resource-picker',
  'open-kubernetes-logs', 'open-kubernetes-detail', 'open-kubernetes-pods',
  'open-aws-resource', 'open-aws-logs', 'resources-imported', 'picker-closed',
])
const store = useArchitectureStore()
const { apiFetch } = useApi()
const apmStore = useApmStore()
const awsStore = useAwsStore()
const terminalStore = useTerminalStore()
const { toast } = useToast()
const cloudBackupsOpen = ref(false)
const teamSpaceOpen = ref(false)
// The account's team (Team plan): the Team button shows only for members.
const teamInfo = ref(null)
api('GET', '/api/account').then(status => { teamInfo.value = status?.entitlements?.team || null }).catch(() => {})
const { t } = useI18n()
const creatingProject = ref(false)
const projectDraft = reactive({ name: '', description: '' })
const snapshotName = ref('')
const resourceProvider = ref('')
const activeView = ref(props.workspaceMode ? props.workspaceSection : 'routes')
const selectedWorkflow = ref(null)
const bundleInput = ref(null)
const activeApplication = computed(() => store.linkedApplication || store.selectedApplication)
const linkedApplicationLabel = computed(() => {
  const items = store.linkedApplications.length ? store.linkedApplications : (store.selectedApplication ? [store.selectedApplication] : [])
  return items.map(application => application.name).join(', ') || '—'
})
const applicationContextLabel = computed(() => store.linkedApplication
  ? `${store.linkedApplication.name} · ${String(store.linkedApplication.provider || 'application').toUpperCase()}`
  : t('archView.title'))
const currentSyncState = computed(() => store.syncStateForProject(store.selectedProjectId))
const syncSource = computed(() => {
  const sources = store.graph?.document?.sources?.filter(source => source.type === 'cloudformation') || []
  if (!sources.length) return null
  const first = sources[0]
  return {
    accountId: first.accountId || '',
    region: first.region || 'us-east-1',
    stackNames: sources
      .filter(source => source.accountId === first.accountId && source.region === first.region)
      .map(source => source.name),
  }
})
const syncSourceMappings = computed(() => {
  const nodes = store.graph?.document?.nodes || []
  const sources = store.graph?.document?.sources || []
  const mappedNodeIds = new Set()
  const mappings = []

  for (const source of sources.filter(item => item.type === 'cloudformation')) {
    const resources = nodes.filter(node => node.stackName === source.name || node.sourceId === source.id)
    resources.forEach(node => mappedNodeIds.add(node.id))
    mappings.push({
      id: source.id || `cloudformation:${source.accountId}:${source.region}:${source.name}`,
      type: 'cloudformation',
      name: source.name,
      detail: [source.accountId, source.region].filter(Boolean).join(' · '),
      resources,
    })
  }

  const namespaces = new Map()
  for (const node of nodes) {
    if (node.provider !== 'kubernetes' || !node.namespace) continue
    const key = `${node.kubeContext || ''}:${node.namespace}`
    const mapping = namespaces.get(key) || {
      id: `namespace:${key}`,
      type: 'kubernetes',
      name: node.namespace,
      detail: node.kubeContext || '',
      resources: [],
    }
    mapping.resources.push(node)
    mappedNodeIds.add(node.id)
    namespaces.set(key, mapping)
  }
  mappings.push(...namespaces.values())

  for (const node of nodes) {
    if (mappedNodeIds.has(node.id)) continue
    mappings.push({
      id: `resource:${node.id}`,
      type: 'resource',
      name: node.name || node.id,
      detail: [node.provider || '', node.resourceType || node.kind || ''].filter(Boolean).join(' · '),
      resources: [node],
    })
  }
  return mappings
})
const syncSourceLabel = computed(() => syncSource.value
  ? t('archView.stackCount', { n: syncSource.value.stackNames.length, region: syncSource.value.region })
  : t('archView.noCfnSource'))
const resourceSyncCounts = computed(() => syncCountItems(currentSyncState.value.preview?.summary?.resources, {
  new: t('archView.sync.new'), changed: t('archView.sync.changed'), unchanged: t('archView.sync.unchanged'), missing: t('archView.sync.missing'), stale: t('archView.sync.stale'), manual: t('archView.sync.manual'),
}))
const relationshipSyncCounts = computed(() => syncCountItems(currentSyncState.value.preview?.summary?.relationships, {
  new: t('archView.sync.newRelationships'), reinforced: t('archView.sync.reinforced'), unchanged: t('archView.sync.unchanged'), missingEvidence: t('archView.sync.missingEvidence'), rejected: t('archView.sync.rejected'), manual: t('archView.sync.manual'),
}))
const syncResourceSections = computed(() => [
  ['new', t('archView.sync.newResources')], ['changed', t('archView.sync.changedResources')], ['missing', t('archView.sync.missingResources')], ['stale', t('archView.sync.alreadyStale')], ['manual', t('archView.sync.manualResources')],
].map(([key, label]) => ({ key, label, items: currentSyncState.value.preview?.resources?.[key] || [] })))
const syncRelationshipSections = computed(() => [
  ['new', t('archView.sync.newRelationships')], ['reinforced', t('archView.sync.reinforcedRelationships')], ['missingEvidence', t('archView.sync.relationshipsMissingEvidence')], ['rejected', t('archView.sync.rejectedRelationships')], ['manual', t('archView.sync.manualRelationships')],
].map(([key, label]) => ({ key: `relationship:${key}`, label, items: currentSyncState.value.preview?.relationships?.[key] || [] })))
const staleResources = computed(() => store.graph?.document?.nodes?.filter(node => node.syncState === 'stale') || [])
const metricsByNode = ref({})
const metricsLoading = ref(false)
const collectionByNode = ref({})
const traceOverlay = ref(null)
const traceLoading = ref(false)
const traceEnabled = computed(() => Boolean(
  store.linkedApplication?.id && store.linkedApplication?.profileId &&
  store.linkedApplication?.provider === 'aws' &&
  store.graph?.document?.nodes?.some(node => node.resourceType === 'stepfunctions' && node.arn),
))
const eventsByNode = ref({})
const eventsLoading = ref(false)
const rolloutsByNode = ref({})
const rolloutsLoading = ref(false)
const securityByNode = ref({})
const securityLoading = ref(false)
const inlineNode = ref(null)
const inlineMode = ref('metrics')
const inlineResources = computed(() => {
  if (!inlineNode.value) return []
  const resource = (apmStore.topology.resources || []).find(candidate => sameApmResource(candidate, inlineNode.value))
  return resource ? [resource] : []
})

const METRIC_LABELS = {
  invocations_observed: 'archView.metric.invocations',
  errors_observed: 'archView.metric.errors',
  duration_ms: 'archView.metric.duration',
  memory_bytes: 'archView.metric.memory',
  log_bytes: 'archView.logs',
  pods_ready: 'archView.metric.readyPods',
}

function metricLabel(metric) {
  if (metric === 'cpu_cores') return 'CPU'
  return METRIC_LABELS[metric] ? t(METRIC_LABELS[metric]) : metric
}

function syncCountItems(counts = {}, labels) {
  return Object.entries(labels).map(([key, label]) => ({ key, label, count: counts?.[key] || 0 }))
}

async function loadProfile(profileId) {
  resourceProvider.value = ''
  selectedWorkflow.value = null
  traceOverlay.value = null
  store.setActiveProfile(profileId || null)
  awsStore.setActiveProfile(profileId || null)
  if (!profileId) {
    await store.loadApplicationCatalog()
    return nextTick(() => createIcons({ icons }))
  }
  const applications = await store.loadApplications()
  if (props.applicationId && applications.some(application => application.id === props.applicationId)) {
    await store.selectApplication(props.applicationId)
  } else if (props.projectId) {
    await store.loadProjects({ applicationId: '' })
  } else if (store.selectedApplicationId && applications.some(application => application.id === store.selectedApplicationId)) {
    await store.selectApplication(store.selectedApplicationId)
  } else if (applications.length) {
    await store.selectApplication(applications[0].id)
  } else {
    await store.loadProjects({ applicationId: '' })
  }
  if (props.projectId && store.projects.some(project => project.id === props.projectId)) {
    await store.selectProject(props.projectId)
  }
  nextTick(() => createIcons({ icons }))
}

async function refreshWorkspace() {
  const currentView = activeView.value
  const currentApplicationId = props.applicationId || store.selectedApplicationId || ''
  if (store.selectedProjectId) {
    await store.refreshSelectedProjectData()
    if (currentView === 'resources' && store.linkedApplication) await store.loadRegistry()
  } else if (currentApplicationId) {
    await store.loadApplications()
    await store.selectApplication(currentApplicationId)
  } else {
    await store.loadProjects({ applicationId: '' })
  }
  if (['routes', 'canvas', 'resources'].includes(currentView)) activeView.value = currentView
  nextTick(() => createIcons({ icons }))
}

function sameApmResource(resource, node) {
  const typeMatches = node.provider === 'kubernetes'
    ? resource.type === 'kubernetes' && (!node.kind || resource.kind === node.kind)
    : resource.type === node.resourceType
  if (!typeMatches) return false
  const identities = [node.arn, node.nativeId, node.discoveryKey].filter(Boolean)
  if (identities.some(identity => [resource.id, resource.arn, resource.key].includes(identity))) return true
  return resource.name === node.name
}

function formatMetricValue(value, unit) {
  if (value == null) return null
  if (unit === 'bytes') {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
    return `${Math.round(value)} B`
  }
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`
}

function collectionOverlay(run) {
  if (!run) return { status: 'unknown', label: t('archView.collection.notCollected'), icon: 'circle-help', detail: t('archView.collection.noneCompleted') }
  const status = run.status || 'unknown'
  const statusKey = `archView.collection.${status}`
  const label = status === 'budget_exhausted' ? t('archView.collection.budget')
    : t(statusKey) !== statusKey ? t(statusKey) : status.charAt(0).toUpperCase() + status.slice(1)
  const timestamp = run.finishedAt || run.startedAt
  return {
    status,
    label,
    icon: status === 'completed' ? 'check-circle-2' : status === 'partial' ? 'triangle-alert' : 'circle-alert',
    detail: timestamp ? `${label} · ${new Date(timestamp).toLocaleString()}` : label,
  }
}

async function loadOperationalMetrics() {
  const application = store.linkedApplication
  if (!application?.id || !application.profileId) return
  metricsLoading.value = true
  metricsByNode.value = {}
  collectionByNode.value = {}
  try {
    apmStore.setActiveProfile(application.profileId, application.provider || 'generic')
    await apmStore.selectApplication(application.id)
    const resources = apmStore.topology.resources || []
    const collectionStatus = collectionOverlay(apmStore.overview?.latestRun)
    const nextMetrics = {}
    const nextCollection = {}
    for (const node of store.graph?.document?.nodes || []) {
      const resource = resources.find(candidate => sameApmResource(candidate, node))
      if (!resource) continue
      nextCollection[node.id] = collectionStatus
      const charts = catalogFor(resource.type, resource.kind).charts || []
      const items = []
      for (const chart of charts) {
        const points = await apmStore.loadSeries(chart.metric, { resourceId: resource.id })
        const value = formatMetricValue(points.at(-1)?.v, chart.unit)
        if (value != null) items.push({ key: chart.metric, label: metricLabel(chart.metric), value })
      }
      nextMetrics[node.id] = { loading: false, items }
    }
    metricsByNode.value = nextMetrics
    collectionByNode.value = nextCollection
  } finally {
    metricsLoading.value = false
  }
}

function traceNodeForResource(resource, nodes) {
  if (!resource) return null
  return nodes.find(node => {
    const identities = [node.arn, node.nativeId, node.discoveryKey].filter(Boolean).map(String)
    return node.resourceType === resource.type &&
      (identities.includes(String(resource.resource || '')) || node.name === resource.name)
  }) || null
}

async function loadOperationalTrace() {
  const application = store.linkedApplication
  const workflowNode = store.graph?.document?.nodes?.find(node => node.resourceType === 'stepfunctions' && node.arn)
  if (!application?.id || !application.profileId || !workflowNode) return
  traceLoading.value = true
  traceOverlay.value = null
  try {
    apmStore.setActiveProfile(application.profileId, application.provider || 'generic')
    await apmStore.selectApplication(application.id)
    const result = await apmStore.traceProcess(application.id, workflowNode.arn)
    const trace = result?.traces?.[0]
    if (!trace) {
      toast(t('archView.noRecentTrace'), 'info')
      return
    }
    const graphNodes = store.graph?.document?.nodes || []
    const resources = apmStore.topology.resources || []
    const path = [workflowNode.id]
    for (const event of trace.timeline || []) {
      const resource = event.resource
      const apmResource = resources.find(candidate =>
        candidate.type === resource?.type &&
        [candidate.id, candidate.arn, candidate.key].filter(Boolean).map(String).includes(String(resource?.resource || '')))
      const node = apmResource
        ? graphNodes.find(candidate => sameApmResource(apmResource, candidate))
        : traceNodeForResource(resource, graphNodes)
      if (node && path[path.length - 1] !== node.id) path.push(node.id)
    }
    const edgeIds = []
    for (let index = 1; index < path.length; index += 1) {
      const edge = (store.graph?.document?.edges || []).find(candidate =>
        candidate.status !== 'rejected' &&
        ((candidate.sourceNodeId === path[index - 1] && candidate.targetNodeId === path[index]) ||
          (candidate.sourceNodeId === path[index] && candidate.targetNodeId === path[index - 1])))
      if (edge) edgeIds.push(edge.id)
    }
    traceOverlay.value = {
      executionName: trace.name || trace.executionArn || t('archView.latestTrace'),
      eventCount: (trace.timeline || []).length,
      nodeIds: [...new Set(path)],
      edgeIds: [...new Set(edgeIds)],
    }
  } finally {
    traceLoading.value = false
  }
}

async function loadOperationalEvents() {
  const contexts = [...new Set((store.graph?.document?.nodes || [])
    .filter(node => node.provider === 'kubernetes' && node.kubeContext)
    .map(node => node.kubeContext))]
  if (!contexts.length) return
  eventsLoading.value = true
  try {
    const preview = await store.previewKubernetesEvents({ contexts })
    if (!preview) return
    const next = {}
    for (const node of store.graph?.document?.nodes || []) {
      if (node.provider !== 'kubernetes') continue
      const warnings = (preview.health || [])
        .filter(entry => entry.context === node.kubeContext)
        .flatMap(entry => entry.warningEvents || [])
        .filter(event => event.regardingName === node.name &&
          (event.regardingNamespace || '') === (node.namespace || '') &&
          (!event.regardingKind || event.regardingKind.toLowerCase() === (node.kind || '').toLowerCase()))
      if (!warnings.length) continue
      const reasonCounts = new Map()
      for (const event of warnings) reasonCounts.set(event.reason, (reasonCounts.get(event.reason) || 0) + event.count)
      next[node.id] = {
        count: warnings.reduce((sum, event) => sum + event.count, 0),
        detail: [...reasonCounts.entries()].map(([reason, count]) => `${count}× ${reason}`).join(' · '),
      }
    }
    eventsByNode.value = next
  } finally {
    eventsLoading.value = false
  }
}

async function loadOperationalRollouts() {
  const nodes = store.graph?.document?.nodes || []
  const deployments = nodes.filter(node => node.provider === 'kubernetes' && node.kind === 'Deployment' && node.kubeContext)
  const contexts = [...new Set(deployments.map(node => node.kubeContext))]
  if (!contexts.length) return
  rolloutsLoading.value = true
  try {
    const history = await store.previewKubernetesRollouts({ contexts })
    if (!history) return
    const byNode = kubernetesRolloutsByNode(history.rollouts || [], deployments)
    rolloutsByNode.value = Object.fromEntries(Object.entries(byNode).map(([nodeId, rollout]) => {
      const createdAt = rollout.createdAt ? new Date(rollout.createdAt).toLocaleString() : t('archCanvas.rollout.unknownDate')
      return [nodeId, {
        ...rollout,
        detail: t('archCanvas.rollout.detail', {
          revision: rollout.revision, createdAt, ready: rollout.readyReplicas, replicas: rollout.replicas,
        }),
      }]
    }))
  } finally {
    rolloutsLoading.value = false
  }
}

async function loadOperationalSecurity() {
  const nodes = store.graph?.document?.nodes || []
  const contexts = [...new Set(nodes
    .filter(node => node.provider === 'kubernetes' && node.kubeContext)
    .map(node => node.kubeContext))]
  const awsNodes = nodes.filter(node => node.provider === 'aws')
  const gcpNodes = nodes.filter(node => node.provider === 'gcp')
  const profileId = activeApplication.value?.profileId || store.activeProfileId || props.profileId
  if (!contexts.length && ((!awsNodes.length && !gcpNodes.length) || !profileId)) return
  securityLoading.value = true
  try {
    let failed = false
    const kubernetesRequest = contexts.length
      ? store.previewKubernetesSecurity({ contexts }).then(result => { if (!result) failed = true; return result })
      : Promise.resolve(null)
    const awsRequest = awsNodes.length && profileId
      ? apiFetch('/api/cloud/aws/overview/advisor', { headers: { 'X-Profile-Id': profileId } })
        .catch(() => { failed = true; return null })
      : Promise.resolve(null)
    const gcpRequest = gcpNodes.length && profileId
      ? apiFetch('/api/cloud/gcp/overview', { headers: { 'X-Profile-Id': profileId } })
        .catch(() => { failed = true; return null })
      : Promise.resolve(null)
    const [kubernetesResult, awsReport, gcpOverview] = await Promise.all([kubernetesRequest, awsRequest, gcpRequest])
    securityByNode.value = mergeNodeFindings(
      kubernetesSecurityByNode(kubernetesResult?.reports || [], nodes),
      awsSecurityByNode(awsReport, nodes),
      gcpSecurityByNode(gcpOverview?.advisor, nodes),
    )
    if (failed) toast(t('archView.securityLoadFailed'), 'error')
  } finally {
    securityLoading.value = false
  }
}

async function selectApplication(applicationId) {
  if (!props.profileId) {
    const application = store.applications.find(item => item.id === applicationId)
    if (application) emit('application-context', application)
    return
  }
  await store.selectApplication(applicationId)
  nextTick(() => createIcons({ icons }))
}

async function refreshApplicationCatalog() {
  await store.loadApplicationCatalog()
  nextTick(() => createIcons({ icons }))
}

async function submitProject() {
  const project = await store.createProject({ ...projectDraft, applicationId: props.applicationId || store.selectedApplicationId || '' })
  if (!project) return
  projectDraft.name = ''
  projectDraft.description = ''
  creatingProject.value = false
  resourceProvider.value = 'aws'
  activeView.value = 'routes'
  nextTick(() => createIcons({ icons }))
}

async function submitSnapshot() {
  const snapshot = await store.createSnapshot({ name: snapshotName.value })
  if (snapshot) snapshotName.value = ''
  nextTick(() => createIcons({ icons }))
}

async function deleteProject() {
  const project = store.selectedProject
  if (!project || !window.confirm(t('archView.confirmDeleteProject', { name: project.name }))) return
  resourceProvider.value = ''
  selectedWorkflow.value = null
  await store.deleteProject(project.id)
  nextTick(() => createIcons({ icons }))
}

function openBundlePicker() {
  bundleInput.value?.click()
}

async function handleBundleFile(event) {
  const [file] = event.target.files || []
  event.target.value = ''
  if (!file) return
  const result = await store.importKuaApp(file)
  if (result) toast(t('archView.imported', { name: result.application.name }), 'success')
  nextTick(() => createIcons({ icons }))
}

async function exportKuaApp() {
  if (!activeApplication.value) return
  const downloaded = await store.downloadKuaApp(activeApplication.value.id)
  if (downloaded) toast(t('archView.exported', { name: activeApplication.value.name }), 'success')
}

async function previewSync() {
  if (!syncSource.value) return
  await store.previewAwsSync(syncSource.value)
  nextTick(() => createIcons({ icons }))
}

async function applySync() {
  if (!syncSource.value) return
  await store.applyAwsSync(syncSource.value)
  nextTick(() => createIcons({ icons }))
}

async function restoreStaleResource(node) {
  const { staleAt, ...restoredNode } = node
  await store.applyOperation({
    type: 'node.upsert',
    value: { ...restoredNode, manual: true, syncState: 'restored' },
  }, { reason: t('archView.reasonRestoreStale', { name: node.name }) })
  nextTick(() => createIcons({ icons }))
}

async function removeStaleResource(node) {
  if (!window.confirm(t('archView.confirmRemoveStale', { name: node.name }))) return
  await store.applyOperation({ type: 'node.remove', subjectId: node.id }, { reason: t('archView.reasonRemoveStale', { name: node.name }) })
  nextTick(() => createIcons({ icons }))
}

function syncItemName(item) {
  const node = item.preview || item.node
  return node?.name || item.edge?.relationType || t('archView.unknownResource')
}

function syncItemId(item) {
  const node = item.preview || item.node || item.edge
  return node?.id || JSON.stringify(item)
}

function syncRelationshipName(item) {
  const edge = item.preview || item.edge
  return edge
    ? t('archView.relationshipName', { type: edge.relationType, source: edge.sourceNodeId, target: edge.targetNodeId })
    : t('archView.unknownRelationship')
}

async function compareSnapshot(snapshotId) {
  await store.compareSnapshot(snapshotId)
  nextTick(() => createIcons({ icons }))
}

async function restoreSnapshot(snapshot) {
  if (!window.confirm(t('archView.confirmRestoreSnapshot', { n: snapshot.version, name: snapshot.name }))) return
  await store.revertSnapshot(snapshot.id, { reason: t('archView.reasonRestoreSnapshot', { n: snapshot.version }) })
  nextTick(() => createIcons({ icons }))
}

async function applyCanvasOperation(operation, reason) {
  await store.applyOperation(operation, { reason })
  nextTick(() => createIcons({ icons }))
}

function openWorkflow(node) {
  selectedWorkflow.value = node?.arn ? { name: node.name, arn: node.arn } : null
}

const NODE_ACTION_EVENTS = {
  'kubernetes-logs': 'open-kubernetes-logs',
  'kubernetes-detail': 'open-kubernetes-detail',
  'kubernetes-pods': 'open-kubernetes-pods',
  'aws-logs': 'open-aws-logs',
  'aws-detail': 'open-aws-resource',
}

// Kind -> the resourceType used by open Kubernetes log terminal tabs (see useTerminalStore.openLogsTab).
const KUBE_LOG_TAB_RESOURCE_TYPE = {
  Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Pod: 'pods',
}

function handleNodeAction({ action, node } = {}) {
  if (action === 'kubernetes-log-suggestions') return suggestRelationshipsFromLogs(node)
  if (['observability-metrics', 'observability-traces'].includes(action)) {
    if (!store.linkedApplication || !node) return
    emit('open-observability', store.linkedApplication, {
      view: action === 'observability-traces' ? 'traces' : 'metrics',
      node,
    })
    return
  }
  if (['inline-metrics', 'inline-logs'].includes(action)) {
    if (!store.linkedApplication || !node) return
    inlineNode.value = node
    inlineMode.value = action === 'inline-logs' ? 'logs' : 'metrics'
    return
  }
  const eventName = NODE_ACTION_EVENTS[action]
  if (eventName && node) emit(eventName, node)
}

// Deterministic, sanitized extraction over an already-open log stream; every candidate is added as a
// 'suggested' edge that still requires the existing accept/reject review before it counts as confirmed.
async function suggestRelationshipsFromLogs(node) {
  const resourceType = KUBE_LOG_TAB_RESOURCE_TYPE[node?.kind]
  if (!resourceType || !node?.namespace || !node?.name) return
  const tab = terminalStore.tabs.find(item =>
    item.type === 'log' && item.resourceType === resourceType && item.ns === node.namespace && item.pod === node.name)
  if (!tab?.entries?.length) {
    toast(t('archView.openLogsFirst'), 'error')
    return
  }
  const suggestions = suggestGraphRelationships({
    lines: tab.entries.map(entry => entry.text),
    sourceNode: node,
    nodes: store.graph?.document?.nodes || [],
  })
  if (!suggestions.length) {
    toast(t('archView.noLogEvidence'), 'info')
    return
  }
  for (const suggestion of suggestions) {
    await store.applyOperation({
      type: 'edge.upsert',
      value: {
        id: `log-suggestion:${node.id}:${suggestion.targetNodeId}`,
        sourceNodeId: node.id,
        targetNodeId: suggestion.targetNodeId,
        relationType: 'calls',
        status: 'suggested',
        confidence: suggestion.confidence,
        evidence: [{ type: 'log_reference', values: [suggestion.sample], occurrences: suggestion.occurrences }],
      },
    }, t('archView.reasonSuggestFromLogs', { source: node.name, target: suggestion.targetName }))
  }
  toast(t('archView.suggestionsAdded', { n: suggestions.length }), 'success')
  nextTick(() => createIcons({ icons }))
}

function changeLabel(type) {
  return String(type || '').split('.').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function selectResourcesView() {
  activeView.value = 'resources'
  if (store.linkedApplication) store.loadRegistry()
}

function handleArchitectureTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const tabs = [...event.currentTarget.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not(:disabled)')]
  const currentIndex = tabs.indexOf(event.currentTarget)
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[nextIndex]?.focus()
  tabs[nextIndex]?.click()
}

async function openResourcePicker(provider = 'aws') {
  if (props.workspaceMode && (store.activeProfileId !== props.profileId || store.selectedApplicationId !== props.applicationId)) {
    await loadProfile(props.profileId)
  }
  if (!store.selectedProjectId) {
    const applicationId = props.applicationId || store.selectedApplicationId
    const application = store.applications.find(item => item.id === applicationId)
    if (!application) return
    const project = await store.createProject({
      name: `${application.name} application map`,
      description: 'Application resources and routes',
      applicationId: application.id,
    })
    if (!project) return
  }
  resourceProvider.value = ['aws', 'kubernetes', 'gcp', 'vercel', 'manual'].includes(provider) ? provider : 'aws'
  nextTick(() => createIcons({ icons }))
}

watch(() => [props.workspaceMode, props.workspaceSection], ([workspaceMode, workspaceSection]) => {
  if (workspaceMode && ['routes', 'canvas', 'resources'].includes(workspaceSection)) activeView.value = workspaceSection
})
watch(() => props.profileId, loadProfile)
watch(() => props.applicationId, async () => loadProfile(props.profileId))
watch(() => props.projectId, async projectId => {
  if (projectId && store.projects.some(project => project.id === projectId)) {
    await store.selectProject(projectId)
    nextTick(() => createIcons({ icons }))
  }
})
watch(() => store.linkedApplication, application => {
  if (application) emit('application-context', application)
  if (application && activeView.value === 'resources') store.loadRegistry()
})
onMounted(() => loadProfile(props.profileId))
function closePicker() {
  resourceProvider.value = ''
  emit('picker-closed')
}

function pickerImported(result) {
  resourceProvider.value = ''
  emit('resources-imported', result)
}

defineExpose({ openResourcePicker, refreshWorkspace })
</script>

<style scoped>
.architecture-view { min-height: 100%; display: flex; flex-direction: column; color: var(--text); }
.architecture-application-picker { flex: 1; min-height: 260px; }
.architecture-first-access-list { width: min(520px, 100%); display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.architecture-first-access-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); color: inherit; text-align: left; cursor: pointer; }
.architecture-first-access-row:hover { border-color: #3fb950; background: var(--bg-hover); }
.architecture-first-access-row > span:nth-child(2) { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.architecture-first-access-row small { color: var(--text-dim); }
.architecture-first-access-row > svg { color: var(--text-dim); width: 15px; }
.bundle-file-input { display: none; }
.architecture-toolbar { min-height: 58px; padding: 10px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.architecture-title, .architecture-actions, .architecture-project-header, .snapshot-form { display: flex; align-items: center; gap: 10px; }
.resource-add-menu { position: relative; }
.resource-provider-options { position: absolute; top: calc(100% + 5px); right: 0; z-index: 12; min-width: 170px; padding: 4px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); box-shadow: 0 8px 20px rgba(0, 0, 0, .22); }
.resource-provider-options button { min-height: 31px; display: flex; align-items: center; gap: 7px; border: 0; border-radius: 4px; background: transparent; color: var(--text); padding: 5px 7px; cursor: pointer; text-align: left; }
.resource-provider-options button:hover, .resource-provider-options button.active { background: var(--bg-hover); }
.resource-provider-options button:disabled { color: var(--text-dim); cursor: not-allowed; }
.resource-provider-options svg { width: 14px; height: 14px; }
.architecture-title > i { width: 22px; color: #2f81f7; }
.architecture-title span, .architecture-project-row > span:last-child, .snapshot-row > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
.architecture-title small, .architecture-project-row small, .snapshot-row small { color: var(--text-dim); }
.architecture-create { padding: 10px 18px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: minmax(180px, 0.8fr) minmax(240px, 1.5fr) auto auto; gap: 8px; }
.architecture-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px minmax(0, 1fr); }
.architecture-layout--embedded { grid-template-columns: minmax(0, 1fr); }
.architecture-projects { border-right: 1px solid var(--border); padding: 10px; overflow: auto; }
.architecture-list-heading { padding: 5px 7px 10px; display: flex; justify-content: space-between; color: var(--text-dim); font-size: 12px; text-transform: uppercase; }
.architecture-project-row, .architecture-project-empty { width: 100%; border: 0; background: transparent; color: inherit; padding: 9px 8px; display: flex; align-items: center; gap: 9px; text-align: left; cursor: pointer; border-radius: 5px; }
.architecture-project-row:hover, .architecture-project-row.active { background: var(--bg-hover); }
.architecture-project-row.active { box-shadow: inset 2px 0 #2f81f7; }
.architecture-application-row { width: 100%; border: 0; background: transparent; color: inherit; padding: 8px; display: flex; align-items: center; gap: 9px; text-align: left; cursor: pointer; border-radius: 5px; }
.architecture-application-row:hover, .architecture-application-row.active { background: var(--bg-hover); }
.architecture-application-row.active { box-shadow: inset 2px 0 #3fb950; }
.architecture-application-row > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.architecture-application-row small { color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.application-mark { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; background: #238636; color: white; border-radius: 5px; font-size: 10px; font-weight: 700; }
.project-mark { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; background: #1f6feb; color: white; border-radius: 5px; font-size: 11px; font-weight: 700; }
.architecture-project-row small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.architecture-project-empty { color: var(--text-dim); justify-content: center; border: 1px dashed var(--border); }
.architecture-workspace { min-width: 0; padding: 18px; overflow: auto; }
.architecture-project-header { justify-content: space-between; align-items: flex-end; }
.architecture-project-header h2 { margin: 3px 0; font-size: 22px; letter-spacing: 0; }
.architecture-project-header p { margin: 0; color: var(--text-dim); }
.architecture-kicker { color: #2f81f7; font-size: 11px; text-transform: uppercase; font-weight: 700; }
.architecture-settings-admin { margin: 0 18px 18px; display: grid; align-content: start; gap: 16px; }
.architecture-sync-mapping { display: grid; gap: 0; border-bottom: 1px solid var(--border); }
.architecture-sync-mapping > header { padding: 0 0 8px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.architecture-sync-mapping > header > div, .architecture-sync-mapping-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.architecture-sync-mapping > header > div > small, .architecture-sync-mapping > header > span { color: var(--text-dim); font-size: 11px; }
.architecture-sync-mapping-row { min-height: 52px; padding: 8px 0; display: grid; grid-template-columns: 26px minmax(160px, 1fr) minmax(220px, 1.4fr); align-items: center; gap: 10px; border-top: 1px solid var(--border); }
.architecture-sync-mapping-icon { width: 25px; height: 25px; display: grid; place-items: center; color: var(--accent); }
.architecture-sync-mapping-icon :deep(svg) { width: 15px; height: 15px; }
.architecture-sync-mapping-copy > small { color: var(--text-dim); font-size: 10px; }
.architecture-sync-mapping-copy > strong { overflow-wrap: anywhere; font-size: 12px; }
.architecture-sync-mapping-resources { min-width: 0; color: var(--text-dim); font-size: 11px; }
.architecture-sync-mapping-resources summary { cursor: pointer; }
.architecture-sync-mapping-resources > span { display: block; padding: 4px 0 0 12px; overflow-wrap: anywhere; color: var(--text); }
.architecture-settings-sync { padding-bottom: 16px; display: grid; gap: 12px; border-bottom: 1px solid var(--border); }
.architecture-settings-sync > header, .architecture-settings-sync-result { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.architecture-settings-sync > header > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.architecture-settings-sync > header > div > strong { overflow-wrap: anywhere; }
.architecture-settings-resource-section { display: grid; gap: 10px; }
.architecture-settings-resource-section h3 { margin: 3px 0 0; font-size: 14px; }
.architecture-settings-resource-picker { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.architecture-application-context { margin: 12px 0; padding: 9px 12px; display: flex; flex-wrap: wrap; gap: 18px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); }
.architecture-application-context span { display: flex; flex-direction: column; gap: 2px; min-width: 70px; }
.architecture-application-context small { color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
.architecture-application-context strong { font-size: 12px; }
.architecture-application-context .linked strong { color: #3fb950; }
.architecture-application-context .unlinked strong { color: #d29922; }
.snapshot-form .ctrl-input { width: 180px; }
.architecture-stats { margin: 18px 0 12px; display: grid; grid-template-columns: repeat(4, minmax(100px, 1fr)); border: 1px solid var(--border); border-radius: 6px; }
.architecture-stats div { padding: 12px 14px; display: flex; justify-content: space-between; align-items: baseline; border-right: 1px solid var(--border); }
.architecture-stats div:last-child { border-right: 0; }
.architecture-stats span { color: var(--text-dim); font-size: 12px; }
.architecture-stats strong { font-size: 20px; }
.sync-preview-panel { margin: 12px 0; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.sync-preview-panel header { min-height: 48px; padding: 9px 12px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); background: var(--bg-hover); }
.sync-preview-panel header > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sync-preview-panel header > span > i { display: none; }
.sync-preview-panel header small { color: var(--text-dim); }
.sync-preview-panel header > strong { margin-left: auto; color: #e3b341; }
.sync-preview-grid { display: grid; grid-template-columns: repeat(6, minmax(80px, 1fr)); border-bottom: 1px solid var(--border); }
.sync-preview-grid:last-child { border-bottom: 0; }
.sync-preview-grid div { min-height: 54px; padding: 9px 10px; display: flex; flex-direction: column; gap: 3px; border-right: 1px solid var(--border); }
.sync-preview-grid div:last-child { border-right: 0; }
.sync-preview-grid span { color: var(--text-dim); font-size: 11px; }
.sync-preview-grid strong { font-size: 18px; }
.relationship-grid { background: color-mix(in srgb, #2f81f7 4%, transparent); }
.sync-review-lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); border-bottom: 1px solid var(--border); }
.sync-review-lists details { padding: 8px 10px; border-right: 1px solid var(--border); }
.sync-review-lists summary { cursor: pointer; color: var(--text-dim); font-size: 12px; }
.sync-review-lists summary strong { color: var(--text); margin-left: 4px; }
.sync-review-item { display: block; padding: 5px 0 0 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.sync-preview-panel footer { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--text-dim); font-size: 12px; }
.stale-resource-list { margin: 12px 0; border: 1px solid #d29922; border-radius: 6px; }
.stale-resource-list > header, .stale-resource-row { min-height: 42px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.stale-resource-list > header { justify-content: space-between; color: var(--text-dim); }
.stale-resource-row:last-child { border-bottom: 0; }
.stale-resource-row > span { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.stale-resource-row small { color: var(--text-dim); }
.architecture-view-tabs { margin-bottom: 10px; display: flex; gap: 2px; border-bottom: 1px solid var(--border); }
.architecture-view-tab { min-height: 36px; padding: 0 12px; display: inline-flex; align-items: center; gap: 7px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); font: inherit; font-size: 12px; cursor: pointer; }
.architecture-view-tab:hover:not(:disabled) { color: var(--text); }
.architecture-view-tab.active { border-bottom-color: var(--accent); color: var(--text); }
.architecture-view-tab:disabled { opacity: .45; cursor: not-allowed; }
.architecture-view-tab :deep(svg) { width: 14px; height: 14px; }
.architecture-view-panel { min-width: 0; }
.canvas-message, .architecture-empty { position: relative; min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; color: var(--text-dim); }
.canvas-message i, .architecture-empty i { width: 32px; height: 32px; color: #2f81f7; }
.canvas-message strong, .architecture-empty strong { color: var(--text); }
.architecture-empty.compact { min-height: 160px; }
.architecture-error { margin: 10px 18px 0; }
.snapshot-list, .change-list { margin-top: 14px; border-top: 1px solid var(--border); }
.snapshot-list > header, .snapshot-row, .change-list > header, .change-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
.snapshot-list > header, .change-list > header { justify-content: space-between; color: var(--text-dim); }
.snapshot-version { width: 38px; color: #2f81f7; font-weight: 700; }
.snapshot-row time, .change-row time { margin-left: auto; color: var(--text-dim); font-size: 12px; }
.architecture-diff { margin-top: 12px; min-height: 42px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; border: 1px solid #2f81f7; border-radius: 5px; background: color-mix(in srgb, #2f81f7 10%, transparent); }
.architecture-diff span { display: flex; align-items: center; gap: 7px; }
.architecture-diff strong { margin-left: auto; }
.change-revision { width: 38px; color: var(--text-dim); font-family: monospace; }
.change-row > span:nth-child(2) { display: flex; flex-direction: column; }
.change-row small { color: var(--text-dim); }
@media (max-width: 850px) {
  .architecture-toolbar { flex-wrap: wrap; }
  .architecture-title small { display: none; }
  .architecture-actions { margin-left: auto; }
  .architecture-create { grid-template-columns: 1fr; }
  .architecture-layout { grid-template-columns: 1fr; }
  .architecture-projects { border-right: 0; border-bottom: 1px solid var(--border); max-height: 180px; }
  .architecture-project-header { align-items: flex-start; flex-direction: column; }
  .architecture-stats { grid-template-columns: repeat(2, 1fr); }
  .sync-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sync-preview-panel footer { align-items: flex-start; flex-direction: column; }
  .architecture-sync-mapping-row { grid-template-columns: 26px minmax(0, 1fr); }
  .architecture-sync-mapping-resources { grid-column: 2; }
  .architecture-stats div:nth-child(2) { border-right: 0; }
  .architecture-stats div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
}
</style>

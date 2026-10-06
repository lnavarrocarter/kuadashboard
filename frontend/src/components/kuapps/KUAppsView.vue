<template>
  <div class="kuapps-view">
    <div class="kuapps-application-shell">
      <aside class="kuapps-applications">
        <div class="kuapps-list-heading">
          <span>{{ t('kuapps.applications') }}</span><strong>{{ applications.length }}</strong>
          <button class="btn btn-icon" :title="t('kuapps.createApplication')" @click="startCreate"><i data-lucide="plus"></i></button>
          <button class="btn btn-icon" :title="t('kuapps.refreshApplications')" :disabled="catalogLoading" @click="loadCatalog"><i data-lucide="refresh-cw"></i></button>
        </div>
        <div v-for="application in applications" :key="application.id" class="kuapps-application-item">
          <button
            :class="['kuapps-application-row', { active: selectedApplicationId === application.id }]"
            @click="selectApplication(application)"
          >
            <span class="application-mark">{{ application.name.slice(0, 2).toUpperCase() }}</span>
            <span><strong>{{ application.name }}</strong><small>{{ providerLabel(application) }}<template v-if="application.environment"> · {{ application.environment }}</template></small></span>
          </button>
        </div>
        <div v-if="catalogLoading" class="kuapps-empty-list">{{ t('kuapps.loading') }}</div>
        <template v-else-if="!applications.length">
          <div class="kuapps-empty-list">{{ t('kuapps.noApplications') }}</div>
          <button class="btn sm kuapps-create-btn" @click="startCreate"><i data-lucide="plus"></i> {{ t('kuapps.createApplication') }}</button>
        </template>
      </aside>

      <main class="kuapps-workspace">
        <form v-if="creating" class="kuapps-create-form" @submit.prevent="createApplication">
          <span class="kuapps-kicker">{{ t('kuapps.kicker') }}</span>
          <h2>{{ t('kuapps.create.title') }}</h2>
          <p>{{ t('kuapps.create.hint') }}</p>
          <label>{{ t('kuapps.create.name') }}<input v-model.trim="draft.name" required maxlength="120" /></label>
          <label>{{ t('kuapps.create.environment') }}<input v-model.trim="draft.environment" maxlength="60" :placeholder="t('kuapps.create.environmentHint')" /></label>
          <label>{{ t('kuapps.create.team') }}<input v-model.trim="draft.team" maxlength="80" /></label>
          <p v-if="createError" class="kuapps-create-error">{{ createError }}</p>
          <div class="kuapps-create-actions">
            <button class="btn sm primary" type="submit" :disabled="createBusy || !draft.name">{{ t('kuapps.create.submit') }}</button>
            <button class="btn sm" type="button" @click="creating = false">{{ t('kuapps.create.cancel') }}</button>
          </div>
        </form>

        <div v-else-if="!selectedApplication" class="kuapps-empty-state">
          <i data-lucide="boxes"></i>
          <strong>{{ t('kuapps.selectApplication') }}</strong>
          <span>{{ t('kuapps.selectApplicationHint') }}</span>
          <button class="btn sm primary" @click="startCreate"><i data-lucide="plus"></i> {{ t('kuapps.createApplication') }}</button>
        </div>

        <template v-else>
          <div v-if="selectedApplication" class="kuapps-application-header">
            <div>
              <span class="kuapps-kicker">{{ t('kuapps.kicker') }}</span>
              <h2>{{ selectedApplication.name }}</h2>
              <small>{{ providerLabel(selectedApplication) }}<template v-if="selectedApplication.environment"> · {{ selectedApplication.environment }}</template><template v-if="selectedApplication.team"> · {{ selectedApplication.team }}</template></small>
            </div>
            <div class="kuapps-header-actions">
              <button class="btn sm primary" data-test="kuapps-add-resources" :disabled="!canAddResources" :title="canAddResources ? '' : t('kuapps.add.needsProfile')" @click="openUnifiedResourcePicker"><i data-lucide="plus"></i>{{ t('archView.addResources') }}</button>
            </div>
          </div>

          <nav v-if="selectedApplication" class="kuapps-workspace-nav" role="tablist" :aria-label="t('kuapps.workspaceViews')">
            <button v-for="item in workspaceViews" :key="item.id" :class="['kuapps-workspace-tab', { active: workspaceView === item.id }]" role="tab" :aria-selected="workspaceView === item.id" @click="selectWorkspaceTab(item.id)">
              <i :data-lucide="item.icon"></i><span>{{ t(item.label) }}</span>
              <b v-if="item.id === 'resources'">{{ applicationRegistry.resources.length }}</b>
              <b v-else-if="item.id === 'review' && reviewCount" class="attention">{{ reviewCount }}</b>
            </button>
          </nav>

          <TeamSpaceModal v-if="selectedApplication" :show="teamSpaceOpen" :profile-id="selectedProfileId || ''" @close="teamSpaceOpen = false" />
          <CloudBackupsModal v-if="selectedApplication" :show="cloudBackupsOpen" :profile-id="selectedProfileId || ''" :application-id="selectedApplication.id" :application-name="selectedApplication.name" @close="cloudBackupsOpen = false" />

          <div v-if="workspaceView === 'overview'" class="kuapps-overview-content">
            <KUAppSummary
              :key="`summary:${selectedApplicationId}`"
              :application="selectedApplication"
              :provider="apmProvider"
              :registry="applicationRegistry"
              :scope-warnings="scopeWarnings"
              :review-count="reviewCount"
              @open-tab="selectWorkspaceTab"
              @collect="collectFromSummary"
              @suggestions="analysisSuggestionCount = $event"
            />
            <div v-if="registryError" class="kuapps-registry-error">{{ registryError }}</div>
            <div v-if="selectedApplication && !providerLess" class="kuapps-advisor">
              <AdvisorPanel
                lens="product"
                :report="productAdvisor"
                :loading="productAdvisorLoading"
                :error="productAdvisorError"
                refreshable
                storage-key="advisor.kuapps"
                @refresh="loadProductAdvisor"
                @posture-changed="loadProductAdvisor"
              />
            </div>
          </div>

          <section v-else-if="workspaceView === 'settings'" class="kuapps-settings-layout">
            <nav class="kuapps-settings-nav" :aria-label="t('kuapps.settings')">
              <button v-for="item in settingsSections" :key="item.id" :class="{ active: settingsSection === item.id, danger: item.id === 'danger' }" @click="settingsSection = item.id">
                <i :data-lucide="item.icon"></i>{{ t(item.label) }}
              </button>
            </nav>
            <div class="kuapps-settings-workspace">
              <template v-if="settingsSection === 'details'">
            <form class="kuapps-settings-section" @submit.prevent="saveApplicationSettings">
              <header><div><span class="kuapps-kicker">{{ t('kuapps.settings') }}</span><h3>{{ t('kuapps.settings.details') }}</h3><small>{{ t('kuapps.settings.detailsHint') }}</small></div></header>
              <div class="kuapps-settings-fields">
                <label>{{ t('kuapps.create.name') }}<input v-model.trim="settingsDraft.name" maxlength="120" required /></label>
                <label>{{ t('kuapps.create.environment') }}<input v-model.trim="settingsDraft.environment" maxlength="60" :placeholder="t('kuapps.create.environmentHint')" /></label>
                <label>{{ t('kuapps.create.team') }}<input v-model.trim="settingsDraft.team" maxlength="80" /></label>
              </div>
              <p v-if="settingsError" class="kuapps-settings-error" role="alert">{{ settingsError }}</p>
              <div class="kuapps-settings-footer">
                <span v-if="settingsSaved" role="status">{{ t('kuapps.settings.saved') }}</span>
                <button class="btn sm primary" type="submit" :disabled="settingsBusy || !settingsDraft.name">{{ settingsBusy ? t('kuapps.saving') : t('action.save') }}</button>
              </div>
            </form>
              </template>

              <KUAppScopes v-else-if="settingsSection === 'accounts'" :key="selectedApplication.id" :application-id="selectedApplication.id" @changed="handleScopesChanged" />

              <template v-else-if="settingsSection === 'sources'">
                <header class="kuapps-section-heading"><div><span class="kuapps-kicker">{{ t('kuapps.settings') }}</span><h3>{{ t('kuapps.sync.title') }}</h3><small>{{ t('kuapps.sync.hint') }}</small></div></header>
                <KUAppSync :application="selectedApplication" :provider="apmProvider" @open-tab="selectWorkspaceTab" @reconciled="loadApplicationRegistry()" />
                <section class="kuapp-cfn-sync">
                  <h4>{{ t('kuapps.sync.cfnTitle') }}</h4>
                  <p class="kuapps-add-explain"><i data-lucide="info"></i><span><strong>{{ t('kuapps.sync.what') }}</strong> {{ t('kuapps.sync.cfnExplain') }}</span></p>
                  <ArchitectureView
                    v-if="architectureProfileId"
                    ref="architectureRef"
                    :profile-id="architectureProfileId"
                    :application-id="selectedApplicationId"
                    hide-application-list
                    workspace-mode
                    settings-only
                    workspace-section="canvas"
                    @request-resource-picker="openUnifiedResourcePicker"
                  />
                  <p v-else class="kuapps-review-note">{{ t('kuapps.sync.unavailable') }}</p>
                </section>
              </template>

              <template v-else-if="settingsSection === 'backups'">
            <section class="kuapps-settings-section">
              <header><div><span class="kuapps-kicker">{{ t('kuapps.settings') }}</span><h3>{{ t('kuapps.settings.backups') }}</h3><small>{{ t('kuapps.settings.backupsHint') }}</small></div></header>
              <input ref="bundleInput" class="kuapps-bundle-input" type="file" accept=".kuaapp.json,application/json" @change="importApplicationBackup" />
              <div class="kuapps-settings-actions">
                <button class="btn sm" :disabled="!selectedProfileId || importBusy" :title="t('archView.importHint')" @click="bundleInput?.click()"><i data-lucide="upload"></i>{{ t('archView.importBackup') }}</button>
                <button class="btn sm" :disabled="!selectedProfileId || !selectedApplication" :title="t('archView.exportHint')" @click="exportApplicationBackup"><i data-lucide="download"></i>{{ t('archView.exportBackup') }}</button>
                <button v-if="teamInfo" class="btn sm" :disabled="!selectedProfileId" :title="t('teamSpace.hint')" @click="teamSpaceOpen = true"><i data-lucide="users"></i>{{ t('teamSpace.button', { name: teamInfo.name }) }}</button>
                <button class="btn sm" :disabled="!selectedProfileId" :title="t('cloudBackups.hint')" @click="cloudBackupsOpen = true"><i data-lucide="cloud"></i>{{ t('cloudBackups.title') }}</button>
                <button class="btn sm btn-icon" :title="t('archView.refreshApplication')" :disabled="registryLoading" @click="reloadActiveTab()"><i data-lucide="refresh-cw"></i></button>
              </div>
            </section>
              </template>

              <section v-else-if="settingsSection === 'danger'" class="kuapps-settings-section kuapps-danger-zone">
                <header><div><span class="kuapps-kicker">{{ t('kuapps.settings') }}</span><h3>{{ t('kuapps.delete.title') }}</h3><small>{{ t('kuapps.delete.hint') }}</small></div></header>
                <label class="kuapps-delete-confirm">{{ t('kuapps.delete.typeName', { name: selectedApplication.name }) }}
                  <input v-model="deleteConfirmation" :placeholder="selectedApplication.name" data-test="delete-confirmation" />
                </label>
                <p v-if="deleteError" class="kuapps-settings-error" role="alert">{{ deleteError }}</p>
                <div class="kuapps-settings-footer">
                  <button class="btn sm danger" data-test="delete-application" :disabled="deleteBusy || deleteConfirmation !== selectedApplication.name" @click="deleteApplication">
                    <i data-lucide="trash-2"></i>{{ t('kuapps.delete.submit') }}
                  </button>
                </div>
              </section>
            </div>
          </section>

          <section v-else-if="workspaceView === 'resources'" class="kuapps-registry-workspace">
            <header class="kuapps-section-heading">
              <div><span class="kuapps-kicker">{{ t('kuapps.workspace') }}</span><h3>{{ t('kuapps.resources') }}</h3></div>
              <span class="kuapps-section-actions">
                <button class="btn sm" data-test="kuapps-resources-add" :disabled="!canAddResources" @click="openUnifiedResourcePicker"><i data-lucide="plus"></i>{{ t('archView.addResources') }}</button>
                <button class="btn sm btn-icon" :title="t('kuapps.refreshRegistry')" :disabled="registryLoading" @click="loadApplicationRegistry()"><i data-lucide="refresh-cw"></i></button>
              </span>
            </header>
            <div v-if="registryLoading" class="kuapps-empty-state compact">{{ t('kuapps.loadingRegistry') }}</div>
            <div v-else-if="registryError" class="kuapps-empty-state compact"><strong>{{ t('kuapps.registryUnavailable') }}</strong><span>{{ registryError }}</span></div>
            <div v-else-if="!applicationRegistry.resources.length" class="kuapps-empty-state compact"><i data-lucide="boxes"></i><strong>{{ t('kuapps.noResources') }}</strong><span>{{ t('kuapps.noResourcesHint') }}</span></div>
            <div v-else class="kuapps-registry-split">
              <div class="kuapps-resource-list" role="list">
                <button v-for="resource in applicationRegistry.resources" :key="resource.id" :class="['kuapps-resource-row', { active: selectedResourceId === resource.id }]" @click="selectedResourceId = resource.id">
                  <span class="kuapps-resource-mark"><i :data-lucide="resource.provider === 'kubernetes' ? 'box' : 'cloud' "></i></span>
                  <span class="kuapps-resource-copy"><strong>{{ resource.displayName }}</strong><small>{{ resource.provider }} · {{ resource.resourceType }}</small></span>
                  <span class="kuapps-resource-scope">{{ resource.scopeId || resource.location || t('kuapps.scopeUnknown') }}</span>
                </button>
              </div>
              <aside v-if="selectedResource" class="kuapps-resource-inspector">
                <header><div><span class="kuapps-kicker">{{ t('kuapps.resourceInspector') }}</span><h3>{{ selectedResource.displayName }}</h3></div><button class="btn btn-icon" :title="t('action.close')" @click="selectedResourceId = ''"><i data-lucide="x"></i></button></header>
                <div class="kuapps-inspector-actions"><button class="btn sm primary" @click="workspaceView = 'map'"><i data-lucide="network"></i>{{ t('kuapps.openComplementary') }}</button><span>{{ canInspectSignals ? t('kuapps.signalsStatus.openInspector') : t('kuapps.signalsStatus.pending') }}</span></div>
              </aside>
            </div>
            <ArchitectureView
              v-if="architectureProfileId"
              ref="architectureRef"
              :profile-id="architectureProfileId"
              :application-id="selectedApplicationId"
              hide-application-list
              workspace-mode
              workspace-section="resources"
              @request-resource-picker="openUnifiedResourcePicker"
            />
          </section>

          <section v-else-if="workspaceView === 'review'" class="kuapps-review-workspace">
            <header class="kuapps-section-heading">
              <div><span class="kuapps-kicker">{{ t('kuapps.workspace') }}</span><h3>{{ t('kuapps.review.title') }}</h3><small>{{ t('kuapps.review.hint') }}</small></div>
              <button class="btn sm btn-icon" :title="t('kuapps.refreshRegistry')" :disabled="registryLoading" @click="loadApplicationRegistry()"><i data-lucide="refresh-cw"></i></button>
            </header>
            <div v-if="scopeWarnings.length" class="kuapps-review-group">
              <div class="kuapps-review-group-heading"><strong>{{ t('kuapps.review.scopes') }}</strong><span>{{ scopeWarnings.length }}</span></div>
              <div v-for="warning in scopeWarnings" :key="warning.scopeKey" class="kuapps-review-row">
                <span><strong>{{ scopeLabel(warning.scopeKey) }}</strong><small>{{ t(`kuapps.review.scopeWarning.${warning.kind}`) }}</small></span>
                <button class="btn sm" @click="selectWorkspaceTab('settings')">{{ t('kuapps.review.bindProfile') }}</button>
              </div>
            </div>
            <ApmObservabilityView
              v-if="canOpenApplicationObservability"
              :key="`review:${selectedApplicationId}:${apmProvider}:${apmProfileId}`"
              section="review"
              :provider="apmProvider"
              :profile-id="apmProfileId"
              :application-id="selectedApplicationId"
              :hide-application-list="true"
              @open-architecture="openArchitecture"
              @application-context="forwardApplicationContext"
            />
            <template v-else>
              <p class="kuapps-review-note">{{ t('kuapps.review.registryOnly') }}</p>
              <div v-if="!applicationRegistry.relationships.length && !scopeWarnings.length" class="kuapps-empty-state compact"><i data-lucide="check-circle-2"></i><strong>{{ t('kuapps.review.nothing') }}</strong></div>
              <div v-else-if="applicationRegistry.relationships.length" class="kuapps-relationship-list">
                <article v-for="relationship in applicationRegistry.relationships" :key="relationship.id" class="kuapps-relationship-row">
                  <button class="kuapps-relationship-endpoint" @click="selectRegistryResource(relationship.sourceResourceId)"><strong>{{ relationship.sourceName || relationship.sourceResourceId }}</strong><small>{{ relationship.sourceType || t('kuapps.resource') }}</small></button>
                  <span class="kuapps-relationship-type"><i data-lucide="arrow-right"></i>{{ relationship.relationType }}</span>
                  <button class="kuapps-relationship-endpoint" @click="selectRegistryResource(relationship.targetResourceId)"><strong>{{ relationship.targetName || relationship.targetResourceId }}</strong><small>{{ relationship.targetType || t('kuapps.resource') }}</small></button>
                  <span :class="['kuapps-relationship-status', relationship.status]">{{ t(`apm.relationshipStatus.${relationship.status}`) }}</span>
                </article>
              </div>
            </template>
          </section>

          <section v-else-if="workspaceView === 'signals'" class="kuapps-observability-workspace">
            <ApmObservabilityView
              v-if="canOpenApplicationObservability"
              ref="signalsRef"
              :key="`signals:${selectedApplicationId}:${apmProvider}:${apmProfileId}`"
              section="signals"
              :provider="apmProvider"
              :profile-id="apmProfileId"
              :application-id="selectedApplicationId"
              :hide-application-list="true"
              :focus-resource="selectedResource ? selectedResourceFocus : props.focusResource"
              @open-architecture="openArchitecture"
              @application-context="forwardApplicationContext"
              @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
            />
            <div v-else class="kuapps-observability-unavailable">
              <i data-lucide="square-activity"></i>
              <strong>{{ t('kuapps.signalsUnavailable') }}</strong>
              <span>{{ t('kuapps.signalsStatus.pending') }}</span>
            </div>
          </section>

          <div v-else-if="workspaceView === 'map'" class="kuapps-complementary-grid">
            <section class="kuapps-topology-pane">
              <div class="kuapps-map-toggle" role="group" :aria-label="t('kuapps.map.mode')">
                <button :class="['btn', 'sm', { primary: mapMode === 'canvas' }]" @click="mapMode = 'canvas'"><i data-lucide="network"></i>{{ t('kuapps.canvas') }}</button>
                <button :class="['btn', 'sm', { primary: mapMode === 'routes' }]" @click="mapMode = 'routes'"><i data-lucide="route"></i>{{ t('kuapps.routes') }}</button>
              </div>
              <div v-if="providerLess && !architectureProfileId" class="kuapps-empty-state">
                <i data-lucide="layers"></i><strong>{{ t('kuapps.providerLess.title') }}</strong><span>{{ t('kuapps.providerLess.hint') }}</span>
              </div>
              <ArchitectureView
                v-else
                ref="architectureRef"
                :profile-id="architectureProfileId"
                :application-id="selectedApplicationId"
                :key="`map:${mapMode}`"
                :hide-application-list="true"
                workspace-mode
                :workspace-section="mapMode"
                @request-resource-picker="openUnifiedResourcePicker"
                @open-observability="openObservability"
                @application-context="forwardApplicationContext"
                @resource-selected="handleCanvasResourceSelected"
                @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
                @open-kubernetes-detail="$emit('open-kubernetes-detail', $event)"
                @open-kubernetes-pods="$emit('open-kubernetes-pods', $event)"
                @open-aws-resource="$emit('open-aws-resource', $event)"
                @open-aws-logs="$emit('open-aws-logs', $event)"
              />
            </section>
            <aside class="kuapps-signals-inspector">
              <header><div><span class="kuapps-kicker">{{ t('kuapps.resourceInspector') }}</span><h3>{{ selectedResource?.displayName || t('kuapps.selectResourceForSignals') }}</h3></div><button v-if="selectedResource" class="btn btn-icon" :title="t('action.close')" @click="clearResourceSelection"><i data-lucide="x"></i></button></header>
              <template v-if="selectedResource">
                <div class="kuapps-inspector-tabs" role="tablist">
                  <button v-for="tab in inspectorTabs" :key="tab" :class="{ active: inspectorTab === tab }" role="tab" :aria-selected="inspectorTab === tab" @click="inspectorTab = tab">{{ t(`kuapps.inspector.${tab}`) }}</button>
                </div>
                <dl v-if="inspectorTab === 'detail'"><div><dt>{{ t('kuapps.provider') }}</dt><dd>{{ selectedResource.provider }}</dd></div><div><dt>{{ t('kuapps.type') }}</dt><dd>{{ selectedResource.resourceType }}</dd></div><div><dt>{{ t('kuapps.scope') }}</dt><dd>{{ selectedResource.scopeId || t('kuapps.scopeUnknown') }}</dd></div><div><dt>{{ t('kuapps.location') }}</dt><dd>{{ selectedResource.location || t('kuapps.scopeUnknown') }}</dd></div></dl>
                <div v-if="inspectorTab === 'relationships'" class="kuapps-inspector-relationships">
                  <p v-if="!selectedResourceRelationships.length" class="kuapps-review-note">{{ t('kuapps.inspector.noRelationships') }}</p>
                  <button v-for="relationship in selectedResourceRelationships" :key="relationship.id" class="kuapps-inspector-relationship" @click="selectRegistryResource(relationship.otherId)">
                    <span>{{ relationship.outgoing ? '→' : '←' }} <strong>{{ relationship.otherName }}</strong></span>
                    <small>{{ relationship.relationType }} · {{ t(`apm.relationshipStatus.${relationship.status}`) }}</small>
                  </button>
                </div>
                <div v-else-if="inspectorTab === 'signals' && canInspectSignals" class="kuapps-signal-panel">
                  <ApmObservabilityView
                    ref="observabilityRef"
                    section="signals"
                    :provider="apmProvider"
                    :profile-id="selectedApplication.profileId || apmProfileId"
                    :application-id="selectedApplicationId"
                    :hide-application-list="true"
                    :focus-resource="selectedResourceFocus"
                    @open-architecture="openArchitecture"
                    @application-context="forwardApplicationContext"
                    @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
                  />
                </div>
                <div v-else-if="inspectorTab === 'signals'" class="kuapps-signals-unavailable"><i data-lucide="circle-help"></i><strong>{{ t('kuapps.signalsUnavailable') }}</strong><span>{{ t('kuapps.signalsStatus.pending') }}</span></div>
              </template>
              <div v-else class="kuapps-inspector-empty"><i data-lucide="mouse-pointer-2"></i><span>{{ t('kuapps.selectResourceForSignalsHint') }}</span><button class="btn sm" @click="workspaceView = 'resources'">{{ t('kuapps.resources') }}</button></div>
            </aside>
          </div>
        </template>
        <aside v-if="addResourcesOpen && selectedApplication" class="kuapps-add-panel" role="dialog" :aria-label="t('archView.addResources')">
          <header>
            <div><span class="kuapps-kicker">{{ selectedApplication.name }}</span><h3>{{ t('archView.addResources') }}</h3></div>
            <button class="btn btn-icon" :title="t('action.close')" @click="closeAddResources"><i data-lucide="x"></i></button>
          </header>
          <ol class="kuapps-add-steps">
            <li :class="{ active: !addResourcesProvider, done: !!addResourcesProvider }">{{ t('kuapps.add.stepAccount') }}</li>
            <li :class="{ active: !!addResourcesProvider }">{{ t('kuapps.add.stepDiscover') }}</li>
            <li>{{ t('kuapps.add.stepConfirm') }}</li>
          </ol>
          <section class="kuapps-add-account">
            <label v-if="verifiedResourceScopes.length > 1">{{ t('kuapps.scopes.discoveryScope') }}
              <select v-model="activeResourceScopeKey" class="ctrl-select kuapps-scope-selector" :aria-label="t('kuapps.scopes.discoveryScope')">
                <option value="">{{ t('kuapps.scopes.chooseDiscoveryScope') }}</option>
                <option v-for="scope in verifiedResourceScopes" :key="scope.key" :value="scope.key">
                  {{ scope.provider.toUpperCase() }} · {{ scope.label || scope.scopeId || t('kuapps.scopes.pendingAccount') }}<template v-if="scope.location"> · {{ scope.location }}</template>
                </option>
              </select>
            </label>
            <p v-else-if="selectedProfileId" class="kuapps-add-using">{{ t('kuapps.add.using', { account: addResourcesAccountLabel }) }}</p>
            <div v-if="selectedProfileId" class="kuapps-add-providers" role="group" :aria-label="t('kuapps.add.source')">
              <button v-for="provider in addResourcesProviders" :key="provider" :class="['btn', 'sm', { primary: addResourcesProvider === provider }]" @click="chooseAddResourcesProvider(provider)">
                {{ provider === 'manual' ? t('archView.manualResource') : providerName(provider) }}
              </button>
            </div>
            <p v-else class="kuapps-add-using">{{ t('kuapps.add.chooseAccount') }}</p>
          </section>
          <p class="kuapps-add-explain"><i data-lucide="info"></i>{{ t('kuapps.add.explain') }}</p>
          <div class="kuapps-add-body">
            <ArchitectureView
              v-if="addResourcesProvider && selectedProfileId"
              ref="pickerRef"
              :key="`picker:${selectedApplicationId}:${selectedProfileId}`"
              :profile-id="selectedProfileId"
              :application-id="selectedApplicationId"
              hide-application-list
              workspace-mode
              resource-picker-only
              @resources-imported="handleResourcesImported"
              @picker-closed="addResourcesProvider = ''"
            />
          </div>
        </aside>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import ArchitectureView from '../architecture/ArchitectureView.vue'
import ApmObservabilityView from '../cloud/apm/ApmObservabilityView.vue'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import AdvisorPanel from '../advisor/AdvisorPanel.vue'
import KUAppScopes from './KUAppScopes.vue'
import KUAppSummary from './KUAppSummary.vue'
import KUAppSync from './KUAppSync.vue'
import { api } from '../../composables/useApi'
import CloudBackupsModal from '../architecture/CloudBackupsModal.vue'
import TeamSpaceModal from '../architecture/TeamSpaceModal.vue'

const props = defineProps({
  activeView: { type: String, default: 'architecture' },
  profileId: { type: String, default: '' },
  projectId: { type: String, default: '' },
  applicationId: { type: String, default: '' },
  observabilityProvider: { type: String, default: 'generic' },
  observabilityProfileId: { type: String, default: 'local' },
  focusResource: { type: Object, default: null },
  compactNavigation: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update-view', 'open-observability', 'open-architecture', 'application-context',
  'open-kubernetes-logs', 'open-kubernetes-detail', 'open-kubernetes-pods',
  'open-aws-resource', 'open-aws-logs',
])

const { t } = useI18n()
const { toast } = useToast()
const architectureRef = ref(null)
const observabilityRef = ref(null)
const bundleInput = ref(null)
const architectureStore = useArchitectureStore()
const catalogLoading = ref(false)
const importBusy = ref(false)
const teamInfo = ref(null)
const teamSpaceOpen = ref(false)
const cloudBackupsOpen = ref(false)
const settingsBusy = ref(false)
const settingsError = ref('')
const settingsSaved = ref(false)
const settingsDraft = reactive({ name: '', environment: '', team: '' })
const deleteConfirmation = ref('')
const deleteBusy = ref(false)
const deleteError = ref('')
const localApplicationId = ref(props.applicationId)
// KUApps keeps its own catalog: the Architecture views it hosts replace the shared store's
// list with the applications of one profile, which would hide the others from the sidebar.
const catalog = ref([])
const applications = computed(() => catalog.value)
// Overview first: it says how the application is and what is waiting for a decision.
const workspaceView = ref('overview')
const mapMode = ref('canvas')
const applicationRegistry = ref({ resources: [], relationships: [] })
const registryLoading = ref(false)
const registryError = ref('')
const selectedResourceId = ref('')
const selectedCanvasResource = ref(null)
const workspaceViews = [
  { id: 'overview', label: 'kuapps.overview', icon: 'layout-dashboard' },
  { id: 'resources', label: 'kuapps.resources', icon: 'boxes' },
  { id: 'map', label: 'kuapps.map.title', icon: 'network' },
  { id: 'signals', label: 'kuapps.signals', icon: 'square-activity' },
  { id: 'review', label: 'kuapps.review.title', icon: 'list-checks' },
  { id: 'settings', label: 'kuapps.settings', icon: 'settings' },
]
const scopeWarnings = computed(() => (selectedApplicationDetail.value?.warnings || []).filter(warning => warning.scopeKey))
const suggestedRelationships = computed(() => applicationRegistry.value.relationships.filter(relationship => relationship.status === 'suggested'))
// What the Review tab holds: relationships to decide and scopes without a usable profile.
const analysisSuggestionCount = ref(0)
const reviewCount = computed(() => suggestedRelationships.value.length + scopeWarnings.value.length + analysisSuggestionCount.value)

function scopeLabel(scopeKey) {
  const scope = (selectedApplicationDetail.value?.scopes || []).find(item => item.key === scopeKey)
  if (!scope) return scopeKey
  const provider = { aws: 'AWS', gcp: 'GCP', kubernetes: 'Kubernetes', vercel: 'Vercel' }[scope.provider] || scope.provider
  return [provider, scope.label || scope.scopeId || t('kuapps.scopes.pendingAccount'), scope.location].filter(Boolean).join(' · ')
}
const selectedApplicationId = computed(() => props.applicationId || localApplicationId.value)
const selectedApplication = computed(() => applications.value.find(application => application.id === selectedApplicationId.value) || null)
const selectedResource = computed(() => applicationRegistry.value.resources.find(resource => resource.id === selectedResourceId.value) || selectedCanvasResource.value)
const canInspectSignals = computed(() => !!selectedApplication.value?.profileId
  && selectedResource.value?.provider === selectedApplication.value.provider)
const selectedResourceFocus = computed(() => selectedResource.value ? {
  node: {
    registryResourceId: selectedResource.value.id,
    provider: selectedResource.value.provider,
    resourceType: selectedResource.value.resourceType,
    name: selectedResource.value.displayName,
    nativeId: selectedResource.value.nativeIdentifier || selectedResource.value.nativeId,
    arn: selectedResource.value.arn || (String(selectedResource.value.nativeIdentifier || selectedResource.value.nativeId || '').startsWith('arn:') ? selectedResource.value.nativeIdentifier || selectedResource.value.nativeId : ''),
    kind: selectedResource.value.provider === 'kubernetes' ? selectedResource.value.resourceType : '',
  },
} : props.focusResource)
const selectedApplicationDetail = ref(null)
const activeResourceScopeKey = ref('')
const verifiedResourceScopes = computed(() => {
  const scopes = selectedApplicationDetail.value?.scopes || []
  const bindings = selectedApplicationDetail.value?.local?.bindings || []
  return scopes.flatMap(scope => {
    const binding = bindings.find(item => item.scopeKey === scope.key)
    return binding?.status === 'verified' && binding.profileId ? [{ ...scope, profileId: binding.profileId }] : []
  })
})
const activeResourceScope = computed(() => verifiedResourceScopes.value.length === 1
  ? verifiedResourceScopes.value[0]
  : verifiedResourceScopes.value.find(scope => scope.key === activeResourceScopeKey.value) || null)
const architectureProfileId = computed(() => {
  if (!selectedApplication.value) return props.profileId || ''
  // A legacy application reaches its views through its own profile, even after the
  // migration gave it scopes whose bindings are not verified yet (#149).
  if (selectedApplication.value.profileId) return selectedApplication.value.profileId
  if (selectedApplicationDetail.value?.scopes?.length) return activeResourceScope.value?.profileId || ''
  const verifiedProfiles = [...new Set((selectedApplicationDetail.value?.local?.bindings || [])
    .filter(binding => binding.status === 'verified')
    .map(binding => binding.profileId)
    .filter(Boolean))]
  return verifiedProfiles.length === 1 ? verifiedProfiles[0] : ''
})
const selectedProfileId = computed(() => selectedApplication.value ? architectureProfileId.value : (props.profileId || ''))
function syncSettingsDraft(source = selectedApplication.value) {
  Object.assign(settingsDraft, {
    name: source?.name || '',
    environment: source?.environment || '',
    team: source?.team || '',
  })
}
watch(() => selectedApplicationId.value, () => {
  activeResourceScopeKey.value = ''
  deleteConfirmation.value = ''
  deleteError.value = ''
  syncSettingsDraft()
  settingsError.value = ''
  settingsSaved.value = false
}, { immediate: true })
watch(verifiedResourceScopes, scopes => {
  if (scopes.length === 1) activeResourceScopeKey.value = scopes[0].key
  else if (!scopes.some(scope => scope.key === activeResourceScopeKey.value)) activeResourceScopeKey.value = ''
}, { immediate: true, deep: true })
const apmProvider = computed(() => {
  const provider = selectedApplication.value?.provider || props.observabilityProvider
  return ['aws', 'gcp', 'vercel', 'generic'].includes(provider) ? provider : 'generic'
})
const apmProfileId = computed(() => selectedApplication.value?.profileId || props.observabilityProfileId || (apmProvider.value === 'generic' ? 'local' : ''))
const canOpenApplicationObservability = computed(() => !!selectedApplication.value?.profileId
  && ['aws', 'gcp', 'vercel', 'generic'].includes(apmProvider.value))
// Providerless applications use local scope bindings. APM collection must route by resource scope (#166).
const providerLess = computed(() => !!selectedApplication.value && !selectedApplication.value.profileId)
const creating = ref(false)
const createBusy = ref(false)
const createError = ref('')
const draft = ref({ name: '', environment: '', team: '' })

function providerLabel(application) {
  return application?.provider ? application.provider.toUpperCase() : t('kuapps.multiProvider')
}

// Product lens of the Advisor (the technical one lives in each provider overview).
const { apiFetch } = useApi()
const productAdvisor = ref(null)
const productAdvisorLoading = ref(false)
const productAdvisorError = ref('')
let productAdvisorRequest = 0
let registryRequest = 0
let detailRequest = 0

async function loadProductAdvisor() {
  const application = selectedApplication.value
  const id = ++productAdvisorRequest
  if (!application?.profileId) { productAdvisor.value = null; return }
  productAdvisorLoading.value = true
  try {
    const report = await apiFetch(`/api/architecture/applications/${encodeURIComponent(application.id)}/advisor`, {
      headers: { 'X-Profile-Id': application.profileId },
    })
    if (id === productAdvisorRequest) { productAdvisor.value = report; productAdvisorError.value = '' }
  } catch (error) {
    if (id === productAdvisorRequest) { productAdvisor.value = null; productAdvisorError.value = error.message }
  } finally {
    if (id === productAdvisorRequest) productAdvisorLoading.value = false
  }
}

function selectView(view) {
  workspaceView.value = view === 'observability' ? 'signals' : 'map'
  emit('update-view', view)
  nextTick(() => createIcons({ icons }))
}

function selectWorkspaceTab(view) {
  workspaceView.value = view
}

function selectRegistryResource(resourceId) {
  selectedCanvasResource.value = null
  selectedResourceId.value = resourceId
  workspaceView.value = 'resources'
}

function handleCanvasResourceSelected(node) {
  const identities = [node?.id, node?.nativeIdentifier, node?.nativeId, node?.arn, node?.registryResourceId].filter(Boolean).map(String)
  const registryResource = applicationRegistry.value.resources.find(resource => [resource.id, resource.nativeIdentifier, resource.nativeId, resource.arn]
    .filter(Boolean).some(identity => identities.includes(String(identity))))
  if (registryResource) {
    selectedCanvasResource.value = null
    selectedResourceId.value = registryResource.id
  } else {
    selectedResourceId.value = ''
    selectedCanvasResource.value = {
      ...node,
      id: node?.id || node?.nativeIdentifier || node?.nativeId || node?.arn || 'canvas-resource',
      provider: node?.provider || '',
      resourceType: node?.resourceType || node?.kind || 'resource',
      displayName: node?.name || node?.label || node?.id || t('kuapps.resource'),
      nativeIdentifier: node?.nativeIdentifier || node?.nativeId || node?.arn || '',
      scopeId: node?.scopeId || node?.accountId || '',
      location: node?.location || node?.region || '',
    }
  }
  workspaceView.value = 'map'
}

function clearResourceSelection() {
  selectedResourceId.value = ''
  selectedCanvasResource.value = null
}

async function loadCatalog() {
  catalogLoading.value = true
  try {
    catalog.value = await api('GET', '/api/architecture/applications/catalog').then(list => Array.isArray(list) ? list : []).catch(() => catalog.value)
  } finally { catalogLoading.value = false }
  await loadSelectedApplicationDetail()
  nextTick(() => createIcons({ icons }))
}

async function loadSelectedApplicationDetail(applicationId = selectedApplicationId.value) {
  const requestId = ++detailRequest
  if (!applicationId) {
    selectedApplicationDetail.value = null
    applicationRegistry.value = { resources: [], relationships: [] }
    selectedResourceId.value = ''
    return
  }
  try {
    const detail = await api('GET', `/api/kua-apps/applications/${encodeURIComponent(applicationId)}`)
    if (requestId !== detailRequest || applicationId !== selectedApplicationId.value) return
    selectedApplicationDetail.value = detail
    syncSettingsDraft(detail)
  } catch (_) {
    if (requestId !== detailRequest || applicationId !== selectedApplicationId.value) return
    selectedApplicationDetail.value = null
  }
  if (requestId === detailRequest) await loadApplicationRegistry(applicationId)
}

async function loadApplicationRegistry(applicationId = selectedApplicationId.value) {
  if (!applicationId) { applicationRegistry.value = { resources: [], relationships: [] }; return }
  const requestId = ++registryRequest
  registryLoading.value = true
  registryError.value = ''
  try {
    const result = await api('GET', `/api/kua-apps/applications/${encodeURIComponent(applicationId)}/registry`)
    if (requestId !== registryRequest || applicationId !== selectedApplicationId.value) return
    applicationRegistry.value = {
      resources: Array.isArray(result?.resources) ? result.resources : [],
      relationships: Array.isArray(result?.relationships) ? result.relationships : [],
    }
    if (!applicationRegistry.value.resources.some(resource => resource.id === selectedResourceId.value)) selectedResourceId.value = ''
  } catch (error) {
    if (requestId !== registryRequest || applicationId !== selectedApplicationId.value) return
    applicationRegistry.value = { resources: [], relationships: [] }
    registryError.value = error.message
  } finally {
    if (requestId === registryRequest) registryLoading.value = false
  }
}

function handleScopesChanged(view) {
  selectedApplicationDetail.value = view
  loadCatalog()
}

async function saveApplicationSettings() {
  const application = selectedApplication.value
  if (!application || !settingsDraft.name.trim()) return
  settingsBusy.value = true
  settingsError.value = ''
  settingsSaved.value = false
  try {
    const updated = await api('PATCH', `/api/kua-apps/applications/${encodeURIComponent(application.id)}`, {
      name: settingsDraft.name.trim(),
      environment: settingsDraft.environment.trim(),
      team: settingsDraft.team.trim(),
      expectedRevision: selectedApplicationDetail.value?.revision,
    })
    selectedApplicationDetail.value = updated
    catalog.value = catalog.value.map(item => item.id === application.id
      ? { ...item, name: updated.name, environment: updated.environment, team: updated.team }
      : item)
    syncSettingsDraft(updated)
    emit('application-context', { ...application, name: updated.name, environment: updated.environment, team: updated.team })
    settingsSaved.value = true
  } catch (error) {
    settingsError.value = error.message
    await loadSelectedApplicationDetail(application.id)
  } finally {
    settingsBusy.value = false
  }
}

function selectApplication(application) {
  localApplicationId.value = application.id
  selectedApplicationDetail.value = application.local ? application : null
  applicationRegistry.value = { resources: [], relationships: [] }
  selectedResourceId.value = ''
  selectedCanvasResource.value = null
  loadSelectedApplicationDetail(application.id)
  emit('application-context', application)
  nextTick(() => createIcons({ icons }))
}

async function importApplicationBackup(event) {
  const [file] = event.target.files || []
  event.target.value = ''
  if (!file || !selectedProfileId.value) return
  importBusy.value = true
  try {
    await activateSelectedProfile()
    const result = await architectureStore.importKuaApp(file)
    if (!result) throw new Error(architectureStore.error || t('common.error'))
    toast(t('archView.imported', { name: result.application.name }), 'success')
    await loadCatalog()
  } catch (error) {
    toast(error.message, 'error')
  } finally {
    importBusy.value = false
  }
}

async function exportApplicationBackup() {
  const application = selectedApplication.value
  if (!application || !selectedProfileId.value) return
  await activateSelectedProfile()
  const downloaded = await architectureStore.downloadKuaApp(application.id)
  if (downloaded) toast(t('archView.exported', { name: application.name }), 'success')
}

async function activateSelectedProfile() {
  if (!selectedProfileId.value) return false
  if (architectureStore.activeProfileId !== selectedProfileId.value) {
    architectureStore.setActiveProfile(selectedProfileId.value)
    await architectureStore.loadApplicationCatalog()
  }
  return true
}

async function openResourcePicker() {
  await nextTick()
  await architectureRef.value?.openResourcePicker?.()
}

// One Add resources panel for the header, Resources and the Map (#151). It does not change tab.
const addResourcesOpen = ref(false)
const addResourcesProvider = ref('')
const pickerRef = ref(null)
const canAddResources = computed(() => !!selectedApplication.value?.profileId || verifiedResourceScopes.value.length > 0)
const addResourcesProviders = computed(() => {
  const scopeProvider = activeResourceScope.value?.provider
  const own = scopeProvider || selectedApplication.value?.provider
  const providers = [own, selectedApplication.value?.profileId ? 'kubernetes' : null, 'manual']
  return [...new Set(providers.filter(provider => ['aws', 'kubernetes', 'gcp', 'vercel', 'manual'].includes(provider)))]
})
const addResourcesAccountLabel = computed(() => {
  const scope = activeResourceScope.value
  if (scope) return [providerName(scope.provider), scope.label || scope.scopeId, scope.location].filter(Boolean).join(' · ')
  const application = selectedApplication.value
  return [providerName(application?.provider), application?.region].filter(Boolean).join(' · ')
})

function providerName(provider) {
  return { aws: 'AWS', gcp: 'GCP', kubernetes: 'Kubernetes', vercel: 'Vercel', generic: 'Generic' }[provider] || provider || ''
}

async function openUnifiedResourcePicker() {
  if (!canAddResources.value) return
  addResourcesOpen.value = true
  addResourcesProvider.value = ''
  if (selectedProfileId.value && addResourcesProviders.value.length === 2) await chooseAddResourcesProvider(addResourcesProviders.value[0])
  nextTick(() => createIcons({ icons }))
}

async function chooseAddResourcesProvider(provider) {
  addResourcesProvider.value = provider
  await nextTick()
  await pickerRef.value?.openResourcePicker?.(provider)
  nextTick(() => createIcons({ icons }))
}

function closeAddResources() {
  addResourcesOpen.value = false
  addResourcesProvider.value = ''
}

async function handleResourcesImported() {
  closeAddResources()
  toast(t('kuapps.add.done'), 'success')
  await loadApplicationRegistry()
  await architectureRef.value?.refreshWorkspace?.()
}

function openObservability(application, focus = null) {
  emit('open-observability', application, focus)
  const node = focus?.node
  const match = applicationRegistry.value.resources.find(resource =>
    resource.id === node?.registryResourceId || resource.nativeIdentifier === node?.nativeId || resource.nativeIdentifier === node?.arn)
  if (match) selectedResourceId.value = match.id
  selectView('observability')
}

// Settings has its own navigation; Add resources is not here (#151).
const settingsSections = [
  { id: 'details', label: 'kuapps.settings.details', icon: 'file-text' },
  { id: 'accounts', label: 'kuapps.scopes.title', icon: 'key-round' },
  { id: 'sources', label: 'kuapps.sync.title', icon: 'git-merge' },
  { id: 'backups', label: 'kuapps.settings.backups', icon: 'archive' },
  { id: 'danger', label: 'kuapps.delete.title', icon: 'trash-2' },
]
const settingsSection = ref('details')

// Deleting removes the application and its local data. Architecture projects and live
// infrastructure stay; the name must be typed to confirm.
async function deleteApplication() {
  const application = selectedApplication.value
  if (!application || deleteConfirmation.value !== application.name) return
  deleteBusy.value = true
  deleteError.value = ''
  try {
    const revision = selectedApplicationDetail.value?.revision
    await api('DELETE', `/api/kua-apps/applications/${encodeURIComponent(application.id)}${revision != null ? `?expectedRevision=${revision}` : ''}`)
    toast(t('kuapps.delete.done', { name: application.name }), 'success')
    localApplicationId.value = ''
    deleteConfirmation.value = ''
    settingsSection.value = 'details'
    workspaceView.value = 'overview'
    await loadCatalog()
  } catch (error) {
    deleteError.value = error.message
  } finally {
    deleteBusy.value = false
  }
}

// The Map inspector shows one resource: its detail, its signals and its relationships.
const inspectorTabs = ['detail', 'signals', 'relationships']
const inspectorTab = ref('detail')
const selectedResourceRelationships = computed(() => {
  const resource = selectedResource.value
  if (!resource) return []
  const names = new Map(applicationRegistry.value.resources.map(item => [item.id, item.displayName]))
  return applicationRegistry.value.relationships
    .filter(relationship => relationship.sourceResourceId === resource.id || relationship.targetResourceId === resource.id)
    .map(relationship => {
      const outgoing = relationship.sourceResourceId === resource.id
      const otherId = outgoing ? relationship.targetResourceId : relationship.sourceResourceId
      return { ...relationship, outgoing, otherId, otherName: names.get(otherId) || (outgoing ? relationship.targetName : relationship.sourceName) || otherId }
    })
})

// Collect now keeps its cost confirmation: it opens Signals and asks there.
const signalsRef = ref(null)
async function collectFromSummary() {
  workspaceView.value = 'signals'
  for (let attempt = 0; attempt < 20 && !signalsRef.value?.requestCollect; attempt += 1) await nextTick()
  signalsRef.value?.requestCollect?.()
}

function startCreate() {
  draft.value = { name: '', environment: '', team: '' }
  createError.value = ''
  creating.value = true
  nextTick(() => createIcons({ icons }))
}

async function createApplication() {
  createBusy.value = true
  createError.value = ''
  try {
    const created = await api('POST', '/api/kua-apps/applications', { ...draft.value })
    creating.value = false
    await loadCatalog()
    const application = applications.value.find(item => item.id === created.id) || { id: created.id, name: created.name, provider: null, profileId: null }
    selectApplication(application)
    if (created.local) selectedApplicationDetail.value = created
  } catch (err) {
    createError.value = err.message
  } finally {
    createBusy.value = false
  }
}

function openArchitecture(payload) {
  emit('open-architecture', payload)
  selectView('architecture')
}

function forwardApplicationContext(application) {
  emit('application-context', application)
  if (application?.id && !applications.value.some(a => a.id === application.id)) loadCatalog()
}

async function reloadActiveTab(options = {}) {
  await Promise.all([
    loadProductAdvisor(),
    loadApplicationRegistry(),
    architectureRef.value?.refreshWorkspace?.(options),
    selectedResource.value ? observabilityRef.value?.refreshLocal?.(options) : null,
  ])
}

watch(() => props.applicationId, value => {
  localApplicationId.value = value || ''
  selectedResourceId.value = ''
  loadSelectedApplicationDetail(value || '')
})
watch(() => props.activeView, value => {
  if (value === 'observability') workspaceView.value = 'signals'
  else if (value === 'architecture') workspaceView.value = 'map'
})
watch(() => selectedApplication.value?.id, () => { productAdvisor.value = null; loadProductAdvisor() }, { immediate: true })
watch(() => [props.activeView, props.observabilityProvider], () => nextTick(() => createIcons({ icons })))
onMounted(async () => {
  await Promise.all([
    loadCatalog(),
    api('GET', '/api/account').then(status => { teamInfo.value = status?.entitlements?.team || null }).catch(() => {}),
  ])
  createIcons({ icons })
})

defineExpose({ reloadActiveTab })
</script>

<style scoped>
.kuapps-view { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
.kuapps-application-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 225px minmax(0, 1fr); }
.kuapps-applications { min-height: 0; overflow: auto; padding: 9px; border-right: 1px solid var(--border); background: var(--surface); }
.kuapps-list-heading { display: flex; align-items: center; gap: 7px; padding: 5px 7px 10px; color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
.kuapps-list-heading strong { color: var(--text); }
.kuapps-list-heading button { margin-left: auto; }
.kuapps-list-heading svg { width: 13px; }
.kuapps-application-row { width: 100%; display: grid; grid-template-columns: 29px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 7px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.kuapps-application-row:hover, .kuapps-application-row.active { background: var(--bg-hover); }
.kuapps-application-row.active { box-shadow: inset 2px 0 var(--accent); }
.kuapps-application-row > span:nth-child(2) { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.kuapps-application-row strong, .kuapps-application-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapps-application-row small { color: var(--text-dim); font-size: 9px; }
.kuapps-application-item { display: flex; flex-direction: column; gap: 3px; }
.kuapps-empty-list { padding: 24px 8px 8px; color: var(--text-dim); font-size: 10px; text-align: center; }
.kuapps-create-btn { display: flex; margin: 0 auto 16px; }
.kuapps-workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.kuapps-application-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--bg); }
.kuapps-application-header h2 { margin: 2px 0; font-size: 18px; }
.kuapps-application-header small { color: var(--text-dim); }
.kuapps-kicker { color: var(--accent); font-size: 9px; text-transform: uppercase; }
.kuapps-application-toolbar { min-height: 44px; padding: 6px 16px; display: flex; align-items: center; gap: 6px; overflow-x: auto; border-bottom: 1px solid var(--border); background: var(--bg); }
.kuapps-application-toolbar > button { flex: 0 0 auto; }
.kuapps-bundle-input { display: none; }
.kuapps-workspace-nav { display: flex; align-items: stretch; gap: 3px; padding: 8px 16px 0; border-bottom: 1px solid var(--border); background: var(--surface); }
.kuapps-workspace-tab { min-height: 38px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px 7px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; }
.kuapps-workspace-tab:hover, .kuapps-workspace-tab.active { color: var(--text); }
.kuapps-workspace-tab.active { border-bottom-color: var(--accent); }
.kuapps-workspace-tab svg { width: 15px; }
.kuapps-workspace-tab b { min-width: 19px; padding: 1px 5px; border-radius: 9px; background: var(--bg-hover); color: var(--text-dim); font-size: 10px; text-align: center; }
.kuapps-overview-content { min-height: 0; flex: 1; overflow: auto; padding-bottom: 18px; }
.kuapps-settings-layout { min-height: 0; flex: 1; display: grid; grid-template-columns: 210px minmax(0, 1fr); overflow: hidden; }
.kuapps-settings-nav { padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--border); background: var(--bg-panel); }
.kuapps-settings-nav button { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text-dim); text-align: left; cursor: pointer; }
.kuapps-settings-nav button:hover { background: var(--bg-hover); color: var(--text); }
.kuapps-settings-nav button.active { background: var(--bg-hover); color: var(--text); font-weight: 600; box-shadow: inset 2px 0 var(--accent); }
.kuapps-settings-nav button.danger { margin-top: auto; color: var(--red); }
.kuapps-settings-nav svg { width: 14px; }
.kuapps-settings-workspace { min-height: 0; display: grid; align-content: start; gap: 14px; overflow: auto; padding: 20px 22px; }
.kuapp-cfn-sync { display: grid; gap: 8px; }
.kuapp-cfn-sync h4 { margin: 4px 0 0; font-size: 13px; }
.kuapp-cfn-sync .kuapps-add-explain { margin: 0; }
.kuapps-delete-confirm { display: grid; gap: 5px; max-width: 420px; color: var(--text-dim); font-size: 11px; }
.kuapps-delete-confirm input { height: 32px; padding: 0 9px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-panel); color: var(--text); }
.kuapps-danger-zone { border: 1px solid var(--red); border-radius: 7px; padding: 14px; }
.kuapps-inspector-tabs { display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--border); }
.kuapps-inspector-tabs button { padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); font-size: 11px; cursor: pointer; }
.kuapps-inspector-tabs button.active { border-bottom-color: var(--accent); color: var(--text); }
.kuapps-inspector-relationships { padding: 8px 10px; display: grid; gap: 4px; overflow: auto; }
.kuapps-inspector-relationship { display: grid; gap: 2px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.kuapps-inspector-relationship small { color: var(--text-dim); font-size: 10px; }
.kuapps-settings-section { min-width: 0; margin: 0; padding: 0 0 18px; display: grid; gap: 12px; border: 0; border-bottom: 1px solid var(--border); }
.kuapps-settings-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.kuapps-settings-section > header h3 { margin: 3px 0 0; font-size: 15px; }
.kuapps-settings-section > header small { display: block; margin-top: 4px; color: var(--text-dim); font-size: 11px; }
.kuapps-settings-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.kuapps-settings-fields label { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 11px; }
.kuapps-settings-fields input { width: 100%; min-width: 0; height: 34px; padding: 0 9px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); }
.kuapps-settings-fields input:focus { border-color: var(--accent); outline: 1px solid var(--accent); }
.kuapps-settings-footer { min-height: 32px; display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.kuapps-settings-footer [role="status"] { margin-right: auto; color: var(--green); font-size: 11px; }
.kuapps-settings-error { margin: 0; color: var(--red); font-size: 11px; }
.kuapps-settings-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.kuapps-observability-workspace { min-height: 0; flex: 1; display: flex; overflow: hidden; }
.kuapps-observability-workspace > :deep(.apm-view) { width: 100%; min-height: 0; flex: 1; }
.kuapps-topology-pane { flex-direction: column; }
.kuapps-map-toggle { flex: none; display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.kuapps-map-toggle svg { width: 13px; }
.kuapps-review-workspace { min-height: 0; flex: 1; overflow: auto; padding: 16px 18px; display: grid; align-content: start; gap: 14px; }
.kuapps-review-workspace > :deep(.apm-view) { height: auto; min-height: 0; }
.kuapps-review-workspace :deep(.apm-layout) { min-height: 0; flex: initial; display: block; }
.kuapps-review-workspace :deep(.apm-main) { height: auto; min-height: 0; overflow: visible; padding: 0; }
.kuapps-section-heading small { display: block; margin-top: 3px; color: var(--text-dim); font-size: 11px; }
.kuapps-review-group { border: 1px solid var(--yellow); border-radius: 6px; }
.kuapps-review-group-heading { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
.kuapps-review-group-heading span { color: var(--text-dim); }
.kuapps-review-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.kuapps-review-row:last-child { border-bottom: 0; }
.kuapps-review-row > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.kuapps-review-row small, .kuapps-review-note { color: var(--text-dim); font-size: 11px; }
.kuapps-review-note { margin: 0; }
.kuapps-workspace-tab b.attention { background: var(--yellow); color: #fff; }
.kuapps-observability-unavailable { min-height: 220px; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 20px; color: var(--text-dim); text-align: center; }
.kuapps-observability-unavailable svg { width: 28px; color: var(--accent); }
.kuapps-observability-unavailable strong { color: var(--text); }
.kuapps-overview-strip { display: flex; align-items: center; gap: 0; margin: 12px 18px 0; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.kuapps-overview-strip > div { min-width: 118px; padding: 10px 14px; display: flex; flex-direction: column; gap: 3px; border-right: 1px solid var(--border); }
.kuapps-overview-strip span { color: var(--text-dim); font-size: 10px; }
.kuapps-overview-strip strong { font-size: 17px; }
.kuapps-overview-strip button { margin-left: auto; margin-right: 10px; }
.kuapps-observability-summary { margin: 12px 18px 0; border-top: 1px solid var(--border); }
.kuapps-observability-summary > header { padding: 12px 0 8px; }
.kuapps-observability-summary h3 { margin: 2px 0 0; font-size: 15px; }
.kuapps-observability-summary > :deep(.apm-view) { height: auto; min-height: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.kuapps-observability-summary :deep(.apm-layout) { min-height: 0; flex: initial; display: block; }
.kuapps-observability-summary :deep(.apm-main) { height: auto; min-height: 0; overflow: visible; padding: 12px; }
.kuapps-registry-workspace { min-height: 0; flex: 1; overflow: auto; padding: 16px 18px; }
.kuapps-registry-workspace > :deep(.architecture-view) { min-height: 420px; border-top: 1px solid var(--border); }
.kuapps-section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.kuapps-section-heading h3 { margin: 3px 0 0; font-size: 16px; }
.kuapps-section-actions { display: flex; align-items: center; gap: 6px; }
.kuapps-registry-error { padding: 8px 18px; color: var(--red); font-size: 11px; }
.kuapps-registry-split { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.kuapps-resource-list { min-width: 0; max-height: 100%; overflow: auto; }
.kuapps-resource-row { width: 100%; min-height: 52px; padding: 7px 10px; display: grid; grid-template-columns: 30px minmax(110px, 1fr) minmax(120px, .7fr); align-items: center; gap: 10px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.kuapps-resource-row:hover, .kuapps-resource-row.active { background: var(--bg-hover); }
.kuapps-resource-mark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 5px; background: var(--bg-hover); color: var(--accent); }
.kuapps-resource-mark svg { width: 15px; }
.kuapps-resource-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.kuapps-resource-copy strong, .kuapps-resource-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapps-resource-copy small, .kuapps-resource-scope { color: var(--text-dim); font-size: 10px; }
.kuapps-resource-scope { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapps-resource-inspector { min-width: 0; padding: 12px; border-left: 1px solid var(--border); background: var(--surface); }
.kuapps-resource-inspector header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.kuapps-resource-inspector h3 { margin: 3px 0 8px; overflow-wrap: anywhere; font-size: 14px; }
.kuapps-resource-inspector dl { margin: 0; display: grid; gap: 8px; }
.kuapps-resource-inspector dl > div { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 7px; font-size: 10px; }
.kuapps-resource-inspector dt { color: var(--text-dim); }
.kuapps-resource-inspector dd { margin: 0; overflow-wrap: anywhere; }
.kuapps-resource-inspector code { font-size: 9px; }
.kuapps-inspector-actions { margin-top: 12px; padding-top: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; border-top: 1px solid var(--border); }
.kuapps-inspector-actions > span { color: var(--text-dim); font-size: 10px; }
.kuapps-relationship-list { border-top: 1px solid var(--border); }
.kuapps-relationship-row { min-height: 58px; padding: 8px 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); }
.kuapps-relationship-endpoint { min-width: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.kuapps-relationship-endpoint strong, .kuapps-relationship-endpoint small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kuapps-relationship-endpoint small, .kuapps-relationship-type, .kuapps-relationship-status { color: var(--text-dim); font-size: 10px; }
.kuapps-relationship-type { display: flex; align-items: center; gap: 5px; }
.kuapps-relationship-type svg { width: 13px; }
.kuapps-relationship-status { padding: 3px 6px; border-radius: 4px; background: var(--bg-hover); }
.kuapps-relationship-status.suggested { color: var(--yellow); }
.kuapps-relationship-status.confirmed { color: var(--green); }
.kuapps-empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-dim); text-align: center; }
.kuapps-empty-state svg { width: 34px; color: var(--accent); }
.kuapps-empty-state strong { color: var(--text); }
.kuapps-create-form { max-width: 460px; margin: 28px auto; padding: 0 18px; display: flex; flex-direction: column; gap: 9px; }
.kuapps-create-form h2 { margin: 0; font-size: 18px; }
.kuapps-create-form p { margin: 0; color: var(--text-dim); font-size: 11px; }
.kuapps-create-form label { display: flex; flex-direction: column; gap: 4px; color: var(--text-dim); font-size: 11px; }
.kuapps-create-form input { height: 30px; padding: 0 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
.kuapps-create-form .kuapps-create-error { color: var(--red); }
.kuapps-create-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.kuapps-workspace { position: relative; }
.kuapps-add-panel { position: absolute; top: 0; right: 0; bottom: 0; z-index: 20; width: min(520px, 100%); display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--surface); box-shadow: -8px 0 24px rgba(0, 0, 0, .25); }
.kuapps-add-panel > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.kuapps-add-panel h3 { margin: 3px 0 0; font-size: 15px; }
.kuapps-add-steps { margin: 0; padding: 8px 14px; display: flex; gap: 6px; list-style: none; border-bottom: 1px solid var(--border); }
.kuapps-add-steps li { padding: 2px 9px; border-radius: 10px; background: var(--bg-hover); color: var(--text-dim); font-size: 10px; }
.kuapps-add-steps li.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
.kuapps-add-steps li.done { color: var(--green); }
.kuapps-add-account { padding: 10px 14px; display: grid; gap: 8px; }
.kuapps-add-account label { display: grid; gap: 4px; color: var(--text-dim); font-size: 11px; }
.kuapps-add-using { margin: 0; color: var(--text-dim); font-size: 11px; }
.kuapps-add-providers { display: flex; flex-wrap: wrap; gap: 6px; }
.kuapps-add-explain { margin: 0 14px; padding: 7px 10px; display: flex; gap: 7px; align-items: flex-start; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-dim); font-size: 11px; }
.kuapps-add-explain svg { width: 13px; flex: none; color: var(--accent); }
.kuapps-add-body { min-height: 0; flex: 1; overflow: auto; padding: 10px 14px; }
.kuapps-add-body > :deep(.architecture-view) { height: auto; }
.kuapps-advisor { flex: none; max-height: 42vh; overflow: auto; padding: 10px 18px 0; }
.kuapps-complementary-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(310px, 365px); overflow: hidden; }
.kuapps-topology-pane { min-width: 0; min-height: 0; display: flex; overflow: hidden; }
.kuapps-topology-pane > :deep(.architecture-view) { flex: 1; min-height: 0; }
.kuapps-signals-inspector { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-left: 1px solid var(--border); background: var(--surface); }
.kuapps-signals-inspector > header { min-height: 58px; padding: 10px 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--border); }
.kuapps-signals-inspector h3 { margin: 3px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.kuapps-signals-inspector dl { margin: 0; padding: 9px 12px; display: grid; gap: 5px; border-bottom: 1px solid var(--border); }
.kuapps-signals-inspector dl > div { display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 7px; font-size: 10px; }
.kuapps-signals-inspector dt { color: var(--text-dim); }
.kuapps-signals-inspector dd { margin: 0; overflow-wrap: anywhere; }
.kuapps-signal-panel { min-height: 0; flex: 1; overflow: hidden; }
.kuapps-signal-panel > :deep(.apm-view) { height: 100%; min-height: 0; overflow: hidden; }
.kuapps-signal-panel :deep(.apm-layout) { height: 100%; min-height: 0; display: flex; }
.kuapps-signal-panel :deep(.apm-main) { min-width: 0; min-height: 0; flex: 1; overflow: auto; padding: 8px; }
.kuapps-signal-panel :deep(.apm-resource-focus) { margin: 0 0 8px; }
.kuapps-signals-unavailable, .kuapps-inspector-empty { padding: 16px 12px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; color: var(--text-dim); font-size: 10px; }
.kuapps-signals-unavailable svg, .kuapps-inspector-empty svg { width: 17px; color: var(--accent); }
.kuapps-signals-unavailable strong { color: var(--text); font-size: 11px; }
.kuapps-inspector-empty { margin: auto; align-items: center; text-align: center; }
@media (max-width: 900px) { .kuapps-complementary-grid { grid-template-columns: minmax(0, 1fr) minmax(280px, 320px); } }
@media (max-width: 700px) { .kuapps-workspace-nav { overflow-x: auto; }.kuapps-workspace-tab { flex: 0 0 auto; }.kuapps-registry-split { grid-template-columns: minmax(0, 1fr); }.kuapps-resource-inspector { border-top: 1px solid var(--border); border-left: 0; }.kuapps-relationship-row { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }.kuapps-relationship-status { grid-column: 1 / -1; justify-self: end; }.kuapps-complementary-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(360px, 1fr) minmax(320px, 44vh); overflow: auto; }.kuapps-signals-inspector { border-top: 1px solid var(--border); border-left: 0; } }
@media (max-width: 760px) { .kuapps-settings-layout { grid-template-columns: minmax(0, 1fr); }.kuapps-settings-nav { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); } .kuapps-application-shell { grid-template-columns: 175px minmax(0, 1fr); }.kuapps-application-header { align-items: flex-start; flex-direction: column; }.kuapps-overview-strip { margin-inline: 10px; flex-wrap: wrap; }.kuapps-overview-strip > div { min-width: 90px; flex: 1; }.kuapps-observability-summary { margin-inline: 10px; }.kuapps-registry-workspace { padding: 12px 10px; }.kuapps-settings-workspace { padding: 14px 12px; }.kuapps-settings-fields { grid-template-columns: minmax(0, 1fr); } }
</style>

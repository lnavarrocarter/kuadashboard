<template>
  <div class="cloud-view">

    <div v-if="!selectedProfileId" class="empty-state">
      {{ t('awsv.selectAnAwsCredentialProfileIn') }}<br />
      <span class="text-dim">{{ t('awsv.noProfileUseThe') }} <strong>{{ t('nav.envManager') }}</strong> {{ t('awsv.buttonKeyIconToCreateOne') }}</span>
    </div>

    <template v-else>
      <div v-if="!SELF_LOADING_TABS.has(activeTab) && awsStore.error" class="alert-error">
        {{ awsStore.error }}
        <button v-if="awsStore.accessRequest" class="btn sm aws-access-btn" @click="accessModalOpen = true">
          <i data-lucide="key-round"></i> {{ t('awsAccess.requestAccess') }}
        </button>
      </div>
      <AwsAccessRequestModal
        :show="!!activityAccess"
        :access="activityAccess?.access || null"
        :message="activityAccess?.text || ''"
        :identity="awsStore.overview?.identity || null"
        @close="activityAccess = null"
      />
      <AwsAccessRequestModal
        :show="accessModalOpen"
        :access="awsStore.accessRequest"
        :message="awsStore.error || ''"
        :identity="awsStore.overview?.identity || null"
        @close="accessModalOpen = false"
      />

      <div v-if="!CONTEXT_HIDDEN_TABS.has(activeTab)" class="aws-context" data-test="aws-context">
        <span><span class="text-dim">{{ t('awsCtx.profile') }}</span> <strong>{{ selectedProfileName }}</strong></span>
        <span><span class="text-dim">{{ t('awsCtx.account') }}</span> <strong>{{ contextAccount ?? '…' }}</strong></span>
        <span><span class="text-dim">{{ t('awsCtx.region') }}</span> <strong>{{ awsStore.accountContext ? (awsStore.accountContext.region || t('awsv.op.unknown')) : '…' }}</strong></span>
        <span v-if="GLOBAL_TABS.has(activeTab)" class="aws-context-global" data-test="aws-context-global">{{ t(`awsCtx.global.${activeTab}`) }}</span>
      </div>
      <div v-if="incidentFocus && incidentFocus === activeTab" class="aws-incident-filter" data-test="incident-filter">
        <span>{{ t(`awsIncident.filter.${activeTab}`, { n: incidentCount }) }}</span>
        <button class="btn sm" @click="incidentFocus = null">{{ t('awsIncident.showAll') }}</button>
      </div>

      <div v-if="!SELF_LOADING_TABS.has(activeTab) && !(activeTab === 'cwdashboards' && dashboardView)" class="aws-toolbar">
        <input
          v-model="search[activeTab]"
          type="search"
          class="ctrl-input aws-search"
          :aria-label="t('awsv.searchResourcesLabel')"
          :placeholder="t('awsv.searchResourcesPlaceholder')"
        />
        <select
          v-for="facet in activeFacets" :key="`${activeTab}-${facet.id}`"
          v-model="facetState[activeTab][facet.id]" class="ctrl-select aws-facet" :aria-label="facet.label"
          :data-test="`facet-${facet.id}`"
        >
          <option value="">{{ t('awsFilter.any', { label: facet.label }) }}</option>
          <option v-for="option in facet.options" :key="option.value" :value="option.value">{{ option.label }} ({{ option.count }})</option>
        </select>
        <span class="text-dim" style="font-size:12px" data-test="row-count">
          <template v-if="awsStore.loading">{{ t('state.loading') }}</template>
          <template v-else-if="hasFilters(activeTab) && activeRowCount !== tabCount(activeTab)">{{ t('awsFilter.resultsOf', { n: activeRowCount, total: tabCount(activeTab) }) }}</template>
          <template v-else>{{ t('awsv.results', { n: activeRowCount }) }}</template>
        </span>
        <span v-if="readAt[activeTab] && !awsStore.loading" class="text-dim" style="font-size:12px" :title="t('awsFresh.tabHint')" data-test="read-at">· {{ t('awsFresh.readAgo', { ago: agoText(readAt[activeTab]) }) }}</span>
        <button v-if="hasFilters(activeTab)" class="btn sm" data-test="clear-filters" @click="clearFilters(activeTab)">{{ t('awsFilter.clear') }}</button>
        <button class="btn sm" @click="reloadActiveTab({ force: true })" :disabled="tabLoading" :title="t('awsActivity.refreshHint')"><i data-lucide="refresh-cw"></i></button>
      </div>

      <AwsOverview
        v-show="activeTab === 'overview'"
        ref="overviewRef"
        :profile-id="selectedProfileId"
        :profile-name="selectedProfileName"
        @open-tab="openTabFromOverview"
      />

      <ApmObservabilityView
        v-show="activeTab === 'apm'"
        ref="apmViewRef"
        :profile-id="selectedProfileId"
        :application-id="applicationId"
        :focus-resource="apmFocusResource"
        :lambdas="awsStore.lambdas"
        :load-balancers="awsStore.loadBalancers"
        :ecs-services="awsStore.ecsServices"
        :event-bridge-rules="awsStore.eventBridgeRules"
        :step-functions="awsStore.stepFunctions"
        :load-inventory="loadApmInventory"
        @open-lambda-logs="name => openLogs('lambda', name)"
        @open-kubernetes-logs="resource => emit('open-kubernetes-logs', resource)"
        @open-architecture="projectId => emit('open-architecture', projectId)"
      />

      <div v-show="activeTab === 'ec2'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!ec2TableRows.length" class="empty-row" data-test="empty-ec2">{{ hasFilters('ec2') ? t('awsv.lit.noMatches') : t('awsv.lit.noEc2') }} <button v-if="hasFilters('ec2')" class="btn sm" @click="clearFilters('ec2')">{{ t('awsFilter.clear') }}</button></div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.nameId') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('type')" :aria-sort="ariaSort('type')"><button type="button" class="th-sort" @click="sortBy('type')">{{ t('th.type') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('type') }}</span></button></th>
            <th :class="thClass('state')" :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortBy('state')">{{ t('th.state') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('state') }}</span></button></th>
            <th :class="thClass('publicIp')" :aria-sort="ariaSort('publicIp')"><button type="button" class="th-sort" @click="sortBy('publicIp')">{{ t('ec2d.publicIp') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('publicIp') }}</span></button></th>
            <th :class="thClass('az')" :aria-sort="ariaSort('az')"><button type="button" class="th-sort" @click="sortBy('az')">AZ <span class="sort-icon" aria-hidden="true">{{ sortIcon('az') }}</span></button></th>
            <th :class="thClass('launchTime')" :aria-sort="ariaSort('launchTime')"><button type="button" class="th-sort" @click="sortBy('launchTime')">{{ t('eksd.launched') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('launchTime') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="i in sortRows(ec2TableRows)" :key="i.id">
              <td>
                <div>{{ i.name }}</div>
                <div class="text-dim mono-xs">{{ i.id }}</div>
              </td>
              <td class="text-dim">{{ i.type }}</td>
              <td><span :class="ec2StateClass(i.state)">{{ i.state }}</span></td>
              <td class="text-dim">{{ i.publicIp || '-' }}</td>
              <td class="text-dim">{{ i.az }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ i.launchTime ? formatDate(i.launchTime) : '-' }}</td>
              <td>
                <TagList :tags="i.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openEc2Detail(i)">{{ t('awsv.act.details') }}</button>
                  <!-- Linux → SSH, Windows → RDP -->
                  <template v-if="i.platform !== 'windows'">
                    <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e"
                      @click="openEc2Shell(i)" :disabled="i.state !== 'running'">
                      🖥 SSH
                    </button>
                  </template>
                  <template v-else>
                    <button class="btn sm" style="background:rgba(88,166,255,.18);border-color:#58a6ff;color:#58a6ff"
                      @click="openEc2Rdp(i)" :disabled="i.state !== 'running'">
                      🪟 RDP
                    </button>
                  </template>
                  <button class="btn sm" style="background:rgba(249,168,37,.18);border-color:#f9a825;color:#f9a825"
                    @click="openEc2Ssm(i)" :disabled="i.state !== 'running'">
                    ⚡ SSM
                  </button>
                  <RowMenu :items="ec2MenuItems(i)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'ecs'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!ecsTableRows.length" class="empty-row" data-test="empty-ecs">{{ hasFilters('ecs') ? t('awsv.lit.noMatches') : t('awsv.lit.noEcs') }} <button v-if="hasFilters('ecs')" class="btn sm" @click="clearFilters('ecs')">{{ t('awsFilter.clear') }}</button></div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('pf.service') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('cluster')" :aria-sort="ariaSort('cluster')"><button type="button" class="th-sort" @click="sortBy('cluster')">{{ t('sidebar.cluster') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('cluster') }}</span></button></th>
            <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('th.status') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
            <th :class="thClass('desired')" :aria-sort="ariaSort('desired')"><button type="button" class="th-sort" @click="sortBy('desired')">{{ t('detail.desired') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('desired') }}</span></button></th>
            <th :class="thClass('running')" :aria-sort="ariaSort('running')"><button type="button" class="th-sort" @click="sortBy('running')">{{ t('apm.status.running') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('running') }}</span></button></th>
            <th :class="thClass('createdAt')" :aria-sort="ariaSort('createdAt')"><button type="button" class="th-sort" @click="sortBy('createdAt')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('createdAt') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="svc in sortRows(ecsTableRows)" :key="`${svc.cluster}/${svc.name}`">
              <td>
                <div>{{ svc.name }}</div>
                <div v-if="svc.taskDef" class="text-dim mono-xs">{{ svc.taskDef }}</div>
              </td>
              <td class="text-dim">{{ svc.cluster }}</td>
              <td><span :class="ecsStatusClass(svc.status)">{{ svc.status }}</span></td>
              <td>{{ svc.desired }}</td>
              <td>{{ svc.running }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ svc.createdAt ? formatDate(svc.createdAt) : '-' }}</td>
              <td>
                <TagList :tags="svc.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openLogs('ecs', svc.name, svc.cluster)">{{ t('awsv.act.viewLogs') }}</button>
                  <RowMenu :items="ecsMenuItems(svc)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'eks'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredEks.length" class="empty-row">{{ search.eks ? t('awsv.lit.noMatches') : t('awsv.lit.noEks') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('th.name') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('region')" :aria-sort="ariaSort('region')"><button type="button" class="th-sort" @click="sortBy('region')">{{ t('th.region') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('region') }}</span></button></th>
            <th :class="thClass('version')" :aria-sort="ariaSort('version')"><button type="button" class="th-sort" @click="sortBy('version')">{{ t('th.version') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('version') }}</span></button></th>
            <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('th.status') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
            <th>{{ t('eksd.sectionNodegroups') }}</th>
            <th :class="thClass('instanceCount')" :title="t('awsv.ec2InstancesRunningAsNodesOf')" :aria-sort="ariaSort('instanceCount')"><button type="button" class="th-sort" @click="sortBy('instanceCount')">EC2 <span class="sort-icon" aria-hidden="true">{{ sortIcon('instanceCount') }}</span></button></th>
            <th :class="thClass('createdAt')" :aria-sort="ariaSort('createdAt')"><button type="button" class="th-sort" @click="sortBy('createdAt')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('createdAt') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="c in sortRows(filteredEks)" :key="c.name">
              <td>
                <div style="font-weight:500">{{ c.name }}</div>
                <div v-if="c.endpoint" class="text-dim mono-xs" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="c.endpoint">{{ c.endpoint.replace(/^https:\/\//, '') }}</div>
              </td>
              <td class="text-dim">{{ c.region }}</td>
              <td><span class="tag-chip">v{{ c.version }}</span></td>
              <td><span :class="eksStatusClass(c.status)">{{ c.status }}</span></td>
              <td>
                <span v-if="c.nodegroups == null" class="text-dim" :title="t('awsv.couldNotListNodeGroupsCheck')">?</span>
                <span v-else-if="!c.nodegroups.length" class="text-dim" :title="t('awsv.noManagedNodeGroupsFargateKarpenter')">—</span>
                <div v-else class="tag-chips">
                  <span v-for="ng in c.nodegroups" :key="ng" class="tag-chip">{{ ng }}</span>
                </div>
              </td>
              <td>
                <span v-if="c.instanceCount == null" class="text-dim" :title="t('awsv.couldNotListEc2InstancesCheck')">?</span>
                <span v-else :class="c.instanceCount ? '' : 'text-dim'" style="font-weight:600">{{ c.instanceCount }}</span>
              </td>
              <td class="text-dim" style="white-space:nowrap">{{ c.createdAt ? formatDate(c.createdAt) : '-' }}</td>
              <td>
                <TagList :tags="c.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" :title="t('awsv.awsInfrastructureNetworkNodeGroupsEc2')" @click="openEksDetail(c)">{{ t('awsv.act.details') }}</button>
                  <button class="btn sm" :title="t('awsv.openContainerInsightsDashboard')" @click="openEksObservability(c)">
                    <i data-lucide="chart-no-axes-combined"></i> {{ t('detail.tabMetrics') }}
                  </button>
                  <button class="btn sm" @click="openConfig('eks', `EKS: ${c.name}`, c, { name: c.name })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" style="background:rgba(63,185,80,.18);border-color:#3fb950;color:#3fb950"
                    @click="addEksToKubeconfig(c)" :disabled="c.status !== 'ACTIVE'">{{ t('awsv.addToDashboard') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'lambda'" class="tab-panel">
        <div v-if="lambdaActivityNotice" class="activity-notice">
          <span>{{ lambdaActivityNotice.text }}</span>
          <button v-if="lambdaActivityNotice.access" class="btn sm" @click="activityAccess = lambdaActivityNotice">{{ t('awsAccess.requestAccess') }}</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!lambdaTableRows.length" class="empty-row" data-test="empty-lambda">{{ hasFilters('lambda') ? t('awsv.lit.noMatches') : t('awsv.lit.noLambda') }} <button v-if="hasFilters('lambda')" class="btn sm" @click="clearFilters('lambda')">{{ t('awsFilter.clear') }}</button></div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('th.name') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('runtime')" :aria-sort="ariaSort('runtime')"><button type="button" class="th-sort" @click="sortBy('runtime')">Runtime <span class="sort-icon" aria-hidden="true">{{ sortIcon('runtime') }}</span></button></th>
            <th :class="thClass('memory')" :aria-sort="ariaSort('memory')"><button type="button" class="th-sort" @click="sortBy('memory')">{{ t('lmd.memory') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('memory') }}</span></button></th>
            <th :class="thClass('timeout')" :aria-sort="ariaSort('timeout')"><button type="button" class="th-sort" @click="sortBy('timeout')">Timeout <span class="sort-icon" aria-hidden="true">{{ sortIcon('timeout') }}</span></button></th>
            <th :class="thClass('lastModified')" :aria-sort="ariaSort('lastModified')"><button type="button" class="th-sort" @click="sortBy('lastModified')">{{ t('lmd.modified') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('lastModified') }}</span></button></th>
            <th :class="thClass('invocations24h')" :title="t('awsActivity.invocationsHint')" :aria-sort="ariaSort('invocations24h')"><button type="button" class="th-sort" @click="sortBy('invocations24h')">{{ t('awsActivity.last24h') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('invocations24h') }}</span></button></th>
            <th :class="thClass('logStatusRank')" :title="t('awsActivity.logGroupHint')" :aria-sort="ariaSort('logStatusRank')"><button type="button" class="th-sort" @click="sortBy('logStatusRank')">{{ t('awsActivity.logGroup') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('logStatusRank') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="fn in sortRows(lambdaTableRows)" :key="fn.name">
              <td>
                <div>{{ fn.name }}</div>
                <div v-if="fn.description" class="text-dim mono-xs">{{ fn.description }}</div>
              </td>
              <td class="text-dim">{{ fn.runtime }}</td>
              <td class="text-dim">{{ fn.memory }} MB</td>
              <td class="text-dim">{{ fn.timeout }}s</td>
              <td class="text-dim" style="white-space:nowrap">{{ fn.lastModified ? formatDate(fn.lastModified) : '-' }}</td>
              <td class="activity-cell">
                <template v-if="fn.invocations24h == null"><span class="text-dim">{{ lambdaActivityLoading ? '…' : '—' }}</span></template>
                <template v-else>
                  <span :class="fn.invocations24h ? '' : 'text-dim'">{{ fn.invocations24h.toLocaleString() }}</span>
                  <span v-if="fn.errors24h" class="status-err activity-errors" :title="t('awsActivity.errorsHint', { n: fn.errors24h })">✗ {{ fn.errors24h.toLocaleString() }}</span>
                </template>
              </td>
              <td>
                <button
                  v-if="fn.logStatus" :class="['log-badge', fn.logStatus]" :title="lambdaLogTitle(fn)"
                  @click="fn.logStatus === 'missing' ? openLogging('lambda', fn) : openLogs('lambda', fn.name)"
                >{{ t(`awsActivity.log_${fn.logStatus}`) }}</button>
                <span v-else class="text-dim">{{ lambdaActivityLoading ? '…' : '—' }}</span>
              </td>
              <td data-test="lambda-tags">
                <span v-if="fn.tags === null || fn.tags === undefined" class="text-dim" :title="t('awsv.lambdaTagsNotReadHint')">{{ t('awsv.lambdaTagsNotRead') }}</span>
                <TagList v-else :tags="fn.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openLambdaDetail(fn)">{{ t('awsv.act.details') }}</button>
                  <button class="btn sm" @click="openLogs('lambda', fn.name)">{{ t('awsv.act.viewLogs') }}</button>
                  <RowMenu :items="lambdaMenuItems(fn)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'apigw'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredApigw.length" class="empty-row">{{ search.apigw ? t('awsv.lit.noMatches') : t('awsv.lit.noApis') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.nameId') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('type')" :aria-sort="ariaSort('type')"><button type="button" class="th-sort" @click="sortBy('type')">{{ t('th.type') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('type') }}</span></button></th>
            <th>{{ t('sns.endpoint') }}</th>
            <th :class="thClass('createdDate')" :aria-sort="ariaSort('createdDate')"><button type="button" class="th-sort" @click="sortBy('createdDate')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('createdDate') }}</span></button></th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="api in sortRows(filteredApigw)" :key="api.id">
              <td>
                <div>{{ api.name }}</div>
                <div class="text-dim mono-xs">{{ api.id }}</div>
              </td>
              <td><span class="status-ok">{{ api.type }}</span></td>
              <td style="max-width:260px">
                <a v-if="api.endpoint" :href="api.endpoint" target="_blank"
                  class="text-dim mono-xs" style="word-break:break-all">{{ api.endpoint }}</a>
              </td>
              <td class="text-dim" style="white-space:nowrap">{{ api.createdDate ? formatDate(api.createdDate) : '-' }}</td>
              <td>
                <button class="btn sm" @click="openConfig('apigateway', `API: ${api.name}`, api, { id: api.id, type: api.type })">{{ t('sidebar.config') }}</button>
                <button class="btn sm" style="background:rgba(163,113,247,.18);border-color:#a371f7;color:#a371f7"
                  @click="openApigwRoutes(api)">{{ t('awsv.routes') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 's3'" class="tab-panel">
        <div style="display:flex;justify-content:flex-end;padding:6px 8px 4px;flex-shrink:0">
          <button class="btn sm" style="background:rgba(80,200,120,.18);border-color:#50c878;color:#50c878" @click="openCreateS3Modal">{{ t('awsv.createBucket') }}</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!s3TableRows.length" class="empty-row" data-test="empty-s3">{{ hasFilters('s3') ? t('awsv.lit.noMatches') : t('awsv.lit.noS3') }} <button v-if="hasFilters('s3')" class="btn sm" @click="clearFilters('s3')">{{ t('awsFilter.clear') }}</button></div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">Bucket <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('region')" :aria-sort="ariaSort('region')"><button type="button" class="th-sort" @click="sortBy('region')">{{ t('th.region') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('region') }}</span></button></th>
            <th :class="thClass('creationDate')" :aria-sort="ariaSort('creationDate')"><button type="button" class="th-sort" @click="sortBy('creationDate')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('creationDate') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="b in sortRows(s3TableRows)" :key="b.name">
              <td class="mono-sm">{{ b.name }}</td>
              <td class="text-dim">{{ b.region }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ formatDate(b.creationDate) }}</td>
              <td>
                <TagList :tags="b.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('s3', `S3: ${b.name}`, b.name, b.tags)">{{ t('th.tags') }}</button>
                  <button class="btn sm" @click="openConfig('s3', `S3: ${b.name}`, b, { bucket: b.name })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" style="background:rgba(88,166,255,.18);border-color:#58a6ff;color:#58a6ff"
                    @click="openS3Browser(b)">{{ t('awsv.browse') }}</button>
                  <button class="btn sm" :disabled="s3TestState[b.name]?.loading"
                    @click="testS3Bucket(b.name)"
                    :style="s3TestState[b.name]?.ok === true ? 'border-color:#50c878;color:#50c878' : s3TestState[b.name]?.ok === false ? 'border-color:#f85149;color:#f85149' : ''"
                    :title="s3TestState[b.name]?.msg || t('awsv.act.checkAccessHint')">{{ s3TestState[b.name]?.loading ? '…' : t('awsv.act.checkAccess') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'ecr'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredEcr.length" class="empty-row">{{ search.ecr ? t('awsv.lit.noMatches') : t('awsv.lit.noEcr') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.repository') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th>URI</th>
            <th :class="thClass('imageTagMutability')" :aria-sort="ariaSort('imageTagMutability')"><button type="button" class="th-sort" @click="sortBy('imageTagMutability')">{{ t('awsv.mutability') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('imageTagMutability') }}</span></button></th>
            <th :class="thClass('scanOnPush')" :aria-sort="ariaSort('scanOnPush')"><button type="button" class="th-sort" @click="sortBy('scanOnPush')">{{ t('awsLogs.scan.button') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('scanOnPush') }}</span></button></th>
            <th :class="thClass('createdAt')" :aria-sort="ariaSort('createdAt')"><button type="button" class="th-sort" @click="sortBy('createdAt')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('createdAt') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in sortRows(filteredEcr)" :key="r.name">
              <td>
                <div>{{ r.name }}</div>
                <div class="text-dim mono-xs">{{ r.arn }}</div>
              </td>
              <td class="text-dim mono-xs" style="max-width:220px;word-break:break-all">{{ r.uri }}</td>
              <td>
                <span :class="r.imageTagMutability === 'IMMUTABLE' ? 'status-ok' : 'status-warn'">
                  {{ r.imageTagMutability }}
                </span>
              </td>
              <td><span :class="r.scanOnPush ? 'status-ok' : 'status-err'">{{ r.scanOnPush ? t('common.yes') : t('common.no') }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ r.createdAt ? formatDate(r.createdAt) : '-' }}</td>
              <td>
                <TagList :tags="r.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('ecr', `ECR: ${r.name}`, r.arn, r.tags)">{{ t('th.tags') }}</button>
                  <button class="btn sm" @click="openConfig('ecr', `ECR: ${r.name}`, r, { repo: r.name })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" style="background:rgba(124,158,248,.18);border-color:#7c9ef8;color:#7c9ef8"
                    @click="openEcrDeploy(r)">{{ t('awsv.deployToK8s') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'vpc'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredVpc.length" class="empty-row">{{ search.vpc ? t('awsv.lit.noMatches') : t('awsv.lit.noVpcs') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.nameId') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('cidr')" :aria-sort="ariaSort('cidr')"><button type="button" class="th-sort" @click="sortBy('cidr')">CIDR <span class="sort-icon" aria-hidden="true">{{ sortIcon('cidr') }}</span></button></th>
            <th :class="thClass('state')" :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortBy('state')">{{ t('th.state') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('state') }}</span></button></th>
            <th :class="thClass('default')" :aria-sort="ariaSort('default')"><button type="button" class="th-sort" @click="sortBy('default')">{{ t('gri.defaultValue') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('default') }}</span></button></th>
            <th>{{ t('eksd.sectionSubnets') }}</th><th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="v in sortRows(filteredVpc)" :key="v.id">
              <td>
                <div>{{ v.name }}</div>
                <div class="text-dim mono-xs">{{ v.id }}</div>
              </td>
              <td class="text-dim">{{ v.cidr }}</td>
              <td><span :class="v.state === 'available' ? 'status-ok' : 'status-warn'">{{ v.state }}</span></td>
              <td><span :class="v.default ? 'status-warn' : 'text-dim'">{{ v.default ? t('common.yes') : t('common.no') }}</span></td>
              <td class="text-dim">{{ v.subnets.length }}</td>
              <td>
                <TagList :tags="v.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('vpc', `VPC: ${v.name}`, v.id, v.tags)">{{ t('th.tags') }}</button>
                  <button class="btn sm" @click="openConfig('vpc', `VPC: ${v.name}`, v, { id: v.id })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" @click="openVpcDetail(v)">{{ t('awsv.act.details') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'eventbridge'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredEventBridge.length" class="empty-row">{{ search.eventbridge ? t('awsv.lit.noMatches') : t('awsv.lit.noEventBridge') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.ruleName') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('busName')" :aria-sort="ariaSort('busName')"><button type="button" class="th-sort" @click="sortBy('busName')">Bus <span class="sort-icon" aria-hidden="true">{{ sortIcon('busName') }}</span></button></th>
            <th :class="thClass('state')" :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortBy('state')">{{ t('th.state') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('state') }}</span></button></th>
            <th :class="thClass('scheduleExpr')" :aria-sort="ariaSort('scheduleExpr')"><button type="button" class="th-sort" @click="sortBy('scheduleExpr')">{{ t('awsv.schedulePattern') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('scheduleExpr') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in sortRows(filteredEventBridge)" :key="`${r.busName}/${r.name}`">
              <td>
                <div>{{ r.name }}</div>
                <div v-if="r.description" class="text-dim mono-xs">{{ r.description }}</div>
              </td>
              <td class="text-dim">{{ r.busName }}</td>
              <td><span :class="r.state === 'ENABLED' ? 'status-ok' : 'status-err'">{{ r.state }}</span></td>
              <td class="text-dim mono-xs">{{ r.scheduleExpr || (r.eventPattern ? 'pattern' : '-') }}</td>
              <td>
                <TagList :tags="r.tags" />
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('eventbridge', `Rule: ${r.name}`, r.arn, r.tags)">{{ t('th.tags') }}</button>
                  <button class="btn sm" @click="openConfig('eventbridge', `Rule: ${r.name}`, r, { bus: r.busName, name: r.name })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" style="background:rgba(99,102,241,0.2);border-color:#6366f1" @click="openEbDetails(r)">{{ t('audit.colDetails') }}</button>
                  <button class="btn sm" @click="openEbLogs(r)">{{ t('awsv.act.viewLogs') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'stepfn'" class="tab-panel">
        <div v-if="stepFnActivityNotice" class="activity-notice">
          <span>{{ stepFnActivityNotice.text }}</span>
          <button v-if="stepFnActivityNotice.access" class="btn sm" @click="activityAccess = stepFnActivityNotice">{{ t('awsAccess.requestAccess') }}</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!stepFnTableRows.length" class="empty-row" data-test="empty-stepfn">{{ hasFilters('stepfn') ? t('awsv.lit.noMatches') : t('awsv.lit.noStepFunctions') }} <button v-if="hasFilters('stepfn')" class="btn sm" @click="clearFilters('stepfn')">{{ t('awsFilter.clear') }}</button></div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('th.name') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('type')" :aria-sort="ariaSort('type')"><button type="button" class="th-sort" @click="sortBy('type')">{{ t('th.type') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('type') }}</span></button></th>
            <th :class="thClass('creationDate')" :aria-sort="ariaSort('creationDate')"><button type="button" class="th-sort" @click="sortBy('creationDate')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('creationDate') }}</span></button></th>
            <th :title="t('awsv.sfnCountsHint', { limit: '1000' })">{{ t('awsInsights.executions') }}</th>
            <th :class="thClass('started24h')" :title="t('awsActivity.sfnHint')" :aria-sort="ariaSort('started24h')"><button type="button" class="th-sort" @click="sortBy('started24h')">{{ t('awsActivity.last24h') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('started24h') }}</span></button></th>
            <th :class="thClass('loggingRank')" :aria-sort="ariaSort('loggingRank')"><button type="button" class="th-sort" @click="sortBy('loggingRank')">{{ t('awsActivity.logging') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('loggingRank') }}</span></button></th>
            <th>{{ t('th.tags') }}</th><th>ARN</th><th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="sm in sortRows(stepFnTableRows)" :key="sm.arn">
              <td>{{ sm.name }}</td>
              <td><span :class="sm.type === 'EXPRESS' ? 'status-warn' : 'status-ok'">{{ sm.type }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ formatDate(sm.creationDate) }}</td>
              <td style="white-space:nowrap;font-size:11px" data-test="sfn-counts">
                <template v-if="stepFnCountViews[sm.arn]?.state === 'ok'">
                  <span v-for="item in stepFnCountViews[sm.arn].items" :key="item.key" :class="item.cls" :title="item.title" style="margin-right:4px">{{ item.icon }} {{ item.label }}</span>
                  <span v-if="!stepFnCountViews[sm.arn].items.length && !stepFnCountViews[sm.arn].partial" class="text-dim" :title="t('awsv.sfnCountsNone')">0</span>
                  <span v-if="stepFnCountViews[sm.arn].partial" class="status-warn" :title="stepFnCountViews[sm.arn].partial">⚠ {{ t('awsv.sfnCountsPartialShort') }}</span>
                </template>
                <span v-else-if="stepFnCountViews[sm.arn]?.state === 'denied'" class="status-warn" :title="stepFnCountViews[sm.arn].title">⚠ {{ t('awsv.sfnCountsDenied') }}</span>
                <span v-else-if="stepFnCountViews[sm.arn]?.state === 'error'" class="status-warn" :title="stepFnCountViews[sm.arn].title">⚠ {{ t('awsv.sfnCountsError') }}</span>
                <span v-else-if="stepFnCountViews[sm.arn]?.state === 'unsupported'" class="text-dim" :title="t('awsv.sfnCountsExpressHint')">{{ t('awsv.sfnCountsExpress') }}</span>
                <span v-else class="text-dim">…</span>
              </td>
              <td class="activity-cell">
                <template v-if="sm.started24h == null"><span class="text-dim">{{ stepFnActivityLoading ? '…' : '—' }}</span></template>
                <template v-else>
                  <span :class="sm.started24h ? '' : 'text-dim'">{{ sm.started24h.toLocaleString() }}</span>
                  <span v-if="sm.failed24h" class="status-err activity-errors" :title="t('awsActivity.sfnFailedHint', { n: sm.failed24h })">✗ {{ sm.failed24h.toLocaleString() }}</span>
                </template>
              </td>
              <td>
                <span v-if="sm.logging" :class="['log-badge', sm.logging.level === 'OFF' ? 'missing' : 'ok']" :title="stepFnLoggingTitle(sm)">
                  {{ sm.logging.level === 'OFF' ? t('awsActivity.loggingOff') : sm.logging.level }}
                </span>
                <span v-else class="text-dim">{{ stepFnActivityLoading ? '…' : '—' }}</span>
              </td>
              <td>
                <TagList :tags="sm.tags" />
              </td>
              <td class="text-dim mono-xs" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="sm.arn">{{ sm.arn }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('stepfn', `SF: ${sm.name}`, sm.arn, sm.tags)">{{ t('th.tags') }}</button>
                  <button class="btn sm" @click="openConfig('stepfn', `SF: ${sm.name}`, sm, { arn: sm.arn })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" style="background:rgba(99,102,241,0.2);border-color:#6366f1" @click="openDiagram(sm)">{{ t('awsv.diagram') }}</button>
                  <button class="btn sm" style="background:rgba(96,165,250,0.15);border-color:#60a5fa;color:#60a5fa" @click="openStepFnDetail(sm)">{{ t('awsv.act.details') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ DynamoDB ══════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'sqs'" class="tab-panel">
        <AwsSqsTab :search="search.sqs" :activity-loading="sqsActivityLoading" @request-access="activityAccess = $event" />
      </div>
      <div v-show="activeTab === 'sns'" class="tab-panel">
        <AwsSnsTab :search="search.sns" :activity-loading="snsActivityLoading" @request-access="activityAccess = $event" />
      </div>
      <div v-show="activeTab === 'ses'" class="tab-panel">
        <AwsSesTab :search="search.ses" :metrics-loading="sesMetricsLoading" @request-access="activityAccess = $event" />
      </div>

      <div v-show="activeTab === 'dynamodb'" class="tab-panel">
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
          <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="openDynamoCreate">{{ t('awsv.createTable') }}</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredDynamo.length" class="empty-row">{{ search.dynamodb ? t('awsv.lit.noMatches') : t('awsv.lit.noDynamo') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('storage.table') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('th.status') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
            <th :class="thClass('billingMode')" :aria-sort="ariaSort('billingMode')"><button type="button" class="th-sort" @click="sortBy('billingMode')">{{ t('awsv.billing') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('billingMode') }}</span></button></th>
            <th :class="thClass('itemCount')" :aria-sort="ariaSort('itemCount')"><button type="button" class="th-sort" @click="sortBy('itemCount')">{{ t('vercel.edgeConfig.itemCount') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('itemCount') }}</span></button></th>
            <th :class="thClass('sizeBytes')" :aria-sort="ariaSort('sizeBytes')"><button type="button" class="th-sort" @click="sortBy('sizeBytes')">{{ t('th.size') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('sizeBytes') }}</span></button></th>
            <th :class="thClass('creationDateTime')" :aria-sort="ariaSort('creationDateTime')"><button type="button" class="th-sort" @click="sortBy('creationDateTime')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('creationDateTime') }}</span></button></th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="tableItem in sortRows(filteredDynamo)" :key="tableItem.name">
              <td>
                <div>{{ tableItem.name }}</div>
                <div class="text-dim mono-xs">{{ (tableItem.keySchema || []).map(k => `${k.name} (${k.type})`).join(', ') }}</div>
              </td>
              <td><span :class="tableItem.status === 'ACTIVE' ? 'status-ok' : 'status-warn'">{{ tableItem.status }}</span></td>
              <td class="text-dim">{{ tableItem.billingMode }}</td>
              <td>{{ tableItem.itemCount?.toLocaleString() ?? '-' }}</td>
              <td class="text-dim">{{ tableItem.sizeBytes ? formatBytes(tableItem.sizeBytes) : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ tableItem.creationDateTime ? formatDate(tableItem.creationDateTime) : '-' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openDynamoInfo(tableItem)">{{ t('awsv.act.details') }}</button>
                  <button class="btn sm" @click="openDynamoBrowse(tableItem)">{{ t('awsv.browse') }}</button>
                  <button class="btn sm" @click="openConfig('dynamodb', `DynamoDB: ${tableItem.name}`, tableItem, { table: tableItem.name })">{{ t('sidebar.config') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ RDS ═══════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'rds'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredRds.length" class="empty-row">{{ search.rds ? t('awsv.lit.noMatches') : t('awsv.lit.noRds') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('id')" :aria-sort="ariaSort('id')"><button type="button" class="th-sort" @click="sortBy('id')">{{ t('ec2d.instance') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('id') }}</span></button></th>
            <th :class="thClass('engine')" :aria-sort="ariaSort('engine')"><button type="button" class="th-sort" @click="sortBy('engine')">{{ t('gsi.engine') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('engine') }}</span></button></th>
            <th :class="thClass('class')" :aria-sort="ariaSort('class')"><button type="button" class="th-sort" @click="sortBy('class')">{{ t('detail.class') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('class') }}</span></button></th>
            <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('th.status') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
            <th :class="thClass('endpoint')" :aria-sort="ariaSort('endpoint')"><button type="button" class="th-sort" @click="sortBy('endpoint')">{{ t('sns.endpoint') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('endpoint') }}</span></button></th>
            <th :class="thClass('az')" :aria-sort="ariaSort('az')"><button type="button" class="th-sort" @click="sortBy('az')">AZ <span class="sort-icon" aria-hidden="true">{{ sortIcon('az') }}</span></button></th>
            <th :class="thClass('storageGb')" :aria-sort="ariaSort('storageGb')"><button type="button" class="th-sort" @click="sortBy('storageGb')">{{ t('sidebar.storage') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('storageGb') }}</span></button></th>
            <th :class="thClass('createdAt')" :aria-sort="ariaSort('createdAt')"><button type="button" class="th-sort" @click="sortBy('createdAt')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('createdAt') }}</span></button></th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="db in sortRows(filteredRds)" :key="db.id">
              <td>
                <div>{{ db.id }}</div>
                <div class="text-dim mono-xs">{{ db.arn }}</div>
              </td>
              <td class="text-dim">{{ db.engine }} {{ db.engineVersion || '' }}</td>
              <td class="text-dim mono-xs">{{ db.class }}</td>
              <td><span :class="db.status === 'available' ? 'status-ok' : 'status-warn'">{{ db.status }}</span></td>
              <td class="text-dim mono-xs" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="db.endpoint">
                {{ db.endpoint ? `${db.endpoint}:${db.port}` : '-' }}
              </td>
              <td class="text-dim">{{ db.az || '-' }}</td>
              <td class="text-dim">{{ db.storageGb ? `${db.storageGb} GiB` : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ db.createdAt ? formatDate(db.createdAt) : '-' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openRdsInfo(db)">{{ t('awsv.act.details') }}</button>
                  <button class="btn sm" @click="openConfig('rds', `RDS: ${db.id}`, db, { id: db.id })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" @click="openRdsConnect(db)">{{ t('console.connect') }}</button>
                  <button class="btn sm" @click="openRdsResetPwd(db)">{{ t('awsv.resetPwd') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Glue ══════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'glue'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredGlue.length" class="empty-row">{{ search.glue ? t('awsv.lit.noMatches') : t('awsv.lit.noGlue') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.jobName') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('command')" :aria-sort="ariaSort('command')"><button type="button" class="th-sort" @click="sortBy('command')">{{ t('th.type') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('command') }}</span></button></th>
            <th :class="thClass('glueVersion')" :aria-sort="ariaSort('glueVersion')"><button type="button" class="th-sort" @click="sortBy('glueVersion')">{{ t('awsv.glueVer') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('glueVersion') }}</span></button></th>
            <th :class="thClass('workerType')" :aria-sort="ariaSort('workerType')"><button type="button" class="th-sort" @click="sortBy('workerType')">Worker <span class="sort-icon" aria-hidden="true">{{ sortIcon('workerType') }}</span></button></th>
            <th :class="thClass('numWorkers')" :aria-sort="ariaSort('numWorkers')"><button type="button" class="th-sort" @click="sortBy('numWorkers')">Workers</button></th>
            <th :class="thClass('lastModified')" :aria-sort="ariaSort('lastModified')"><button type="button" class="th-sort" @click="sortBy('lastModified')">{{ t('lmd.modified') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('lastModified') }}</span></button></th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="j in sortRows(filteredGlue)" :key="j.name">
              <td>
                <div>{{ j.name }}</div>
                <div v-if="j.description" class="text-dim" style="font-size:11px">{{ j.description }}</div>
              </td>
              <td class="text-dim">{{ j.command }}</td>
              <td class="text-dim">{{ j.glueVersion || '-' }}</td>
              <td class="text-dim">{{ j.workerType || '-' }}</td>
              <td class="text-dim">{{ j.numWorkers ?? '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ j.lastModified ? formatDate(j.lastModified) : '-' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openGlueInfo(j)">{{ t('awsv.act.details') }}</button>
                  <button class="btn sm" @click="runGlueJob(j)">{{ t('awsLogs.q.run') }}</button>
                  <button class="btn sm" @click="openGlueRuns(j)">{{ t('awsv.runs') }}</button>
                  <button class="btn sm" @click="openGlueJobConfig(j)">{{ t('sidebar.config') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Athena ═════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'athena'" class="tab-panel" style="flex-direction:column;gap:0;overflow:hidden">

        <!-- ── Sub-nav ──────────────────────────────────────────────────── -->
        <div style="display:flex;align-items:center;gap:0;border-bottom:1px solid var(--border);padding:0 10px;flex-shrink:0;background:var(--bg-panel,inherit)">
          <button v-for="tabItem in athenaSubTabs" :key="tabItem.id"
            :class="['aws-tab-btn', { active: athenaSubTab === tabItem.id }]"
            style="margin-right:4px"
            @click="athenaSubTab = tabItem.id">{{ tabItem.label }}</button>
          <div style="flex:1"/>
          <input v-if="athenaSubTab !== 'editor'"
            v-model="search.athena" type="text"
            :placeholder="t('aws.search')" class="search-input"
            style="width:180px;font-size:12px;margin:4px 0" />
          <button class="btn sm" style="margin:4px 0 4px 6px" @click="reloadActiveTab" :title="t('awsLogs.refresh')">↺</button>
          <button v-if="athenaSubTab !== 'editor'" class="btn sm"
            style="margin:4px 0 4px 6px;background:rgba(88,166,255,.15);border-color:#58a6ff;color:#58a6ff"
            @click="athenaSubTab = 'editor'">{{ t('awsv.queryEditor') }}</button>
        </div>

        <!-- ── Workgroups sub-tab ──────────────────────────────────────── -->
        <div v-show="athenaSubTab === 'workgroups'" style="flex:1;overflow:auto">
          <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
          <div v-else-if="!filteredAthena.length" class="empty-row">
            {{ search.athena ? t('awsv.lit.noMatches') : t('awsv.lit.noAthena') }}
          </div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">Workgroup <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
              <th :class="thClass('state')" :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortBy('state')">{{ t('th.state') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('state') }}</span></button></th>
              <th>{{ t('awsv.engineVersion') }}</th>
              <th>{{ t('awsv.outputLocation') }}</th>
              <th :class="thClass('bytesScanned')" :aria-sort="ariaSort('bytesScanned')"><button type="button" class="th-sort" @click="sortBy('bytesScanned')">{{ t('awsv.bytesScanned') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('bytesScanned') }}</span></button></th>
              <th :class="thClass('queriesRun')" :aria-sort="ariaSort('queriesRun')"><button type="button" class="th-sort" @click="sortBy('queriesRun')">{{ t('awsv.queriesRun') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('queriesRun') }}</span></button></th>
              <th>{{ t('th.description') }}</th>
              <th>{{ t('th.actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="wg in sortRows(filteredAthena)" :key="wg.name">
                <td class="mono-xs">{{ wg.name }}</td>
                <td><span :class="wg.state === 'ENABLED' ? 'status-ok' : 'status-err'">{{ wg.state }}</span></td>
                <td class="text-dim" style="font-size:11px">{{ wg.engineVersion || '—' }}</td>
                <td class="text-dim mono-xs" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="wg.outputLocation">{{ wg.outputLocation || '—' }}</td>
                <td class="text-dim">{{ wg.bytesScanned ? formatBytes(wg.bytesScanned) : '—' }}</td>
                <td class="text-dim">{{ wg.queriesRun ?? '—' }}</td>
                <td class="text-dim" style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ wg.description || '—' }}</td>
                <td>
                  <div class="action-group">
                    <button class="btn sm" @click="openAthenaWgInfo(wg)" :title="t('awsv.configurationDetails')">ℹ Config</button>
                    <button class="btn sm" @click="openAthenaWgQuery(wg)" :title="t('awsv.runAQueryWithThisWorkgroup')">{{ t('awsLogs.q.modeQuery') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ── Data Sources sub-tab ───────────────────────────────────── -->
        <div v-show="athenaSubTab === 'datasources'" style="flex:1;overflow:auto">
          <div v-if="athenaEditor.catalogsLoading" class="empty-row">{{ t('state.loading') }}</div>
          <div v-else-if="!athenaEditor.catalogs.length" class="empty-row">{{ t('awsv.noDataSourcesFound') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('awsv.catalogDataSource') }}</th>
              <th>{{ t('th.type') }}</th>
              <th>{{ t('th.description') }}</th>
              <th>{{ t('awsv.databases') }}</th>
              <th>{{ t('th.actions') }}</th>
            </tr></thead>
            <tbody v-for="cat in athenaEditor.catalogs" :key="cat.name">
                <!-- Catalog row -->
                <tr class="athena-cat-row" @click="cat._open = !cat._open" style="cursor:pointer">
                  <td style="font-weight:600;display:flex;align-items:center;gap:6px">
                    <span style="font-size:9px;color:var(--text-dim)">{{ cat._open ? '▾' : '▸' }}</span>
                    🗄 {{ cat.name }}
                  </td>
                  <td><span class="tag-chip" style="font-size:10px">{{ cat.type }}</span></td>
                  <td class="text-dim" style="font-size:11px">{{ cat.description || '—' }}</td>
                  <td class="text-dim">{{ (cat.databases || []).length }}</td>
                  <td>
                    <div class="action-group">
                      <button class="btn sm" @click.stop="openAthenaCatalogInfo(cat)" :title="t('awsv.catalogDetails')">{{ t('awsv.act.details') }}</button>
                      <button class="btn sm" @click.stop="athenaSubTab = 'editor'; athenaEditor.selectedCatalog = cat.name" :title="t('awsv.openInQueryEditor')">⚡ Editor</button>
                    </div>
                  </td>
                </tr>
                <!-- Database rows (expanded) -->
                <template v-if="cat._open">
                  <tr v-for="db in (cat.databases || [])" :key="cat.name + '/' + db.name"
                    style="background:rgba(255,255,255,.02)">
                    <td style="padding-left:32px;display:flex;align-items:center;gap:6px">
                      <span style="font-size:10px">📁</span> {{ db.name }}
                    </td>
                    <td class="text-dim" style="font-size:11px">{{ t('sidebar.database') }}</td>
                    <td class="text-dim" style="font-size:11px">{{ db.description || '—' }}</td>
                    <td class="text-dim" style="font-size:11px">{{ t('awsv.tablesLoaded', { p0: db.tables?.length ?? '—' }) }}</td>
                    <td>
                      <div class="action-group">
                        <button class="btn sm" @click="athenaSubTab = 'editor'; selectAthenaDb(cat, db)" :title="t('awsv.queryThisDatabase')">⚡ Editor</button>
                        <button class="btn sm" @click="loadAthenaDatabaseTables(cat, db)" :disabled="db._loadingTables" :title="t('awsv.loadTables')">{{ db._loadingTables ? '...' : t('awsv.lit.tablesButton') }}</button>
                      </div>
                    </td>
                  </tr>
                </template>
            </tbody>
          </table>
        </div>

        <!-- ── Query Editor sub-tab ───────────────────────────────────── -->
        <div v-show="athenaSubTab === 'editor'" style="flex:1;display:flex;flex-direction:row;overflow:hidden">
          <!-- Left: Data sources tree -->
          <div class="athena-sidebar">
            <div class="athena-sidebar-header">
              <span>Data Sources</span>
              <button class="btn sm" @click="loadAthenaCatalogs" :disabled="athenaEditor.catalogsLoading" :title="t('action.refresh')">↺</button>
            </div>
            <div v-if="athenaEditor.catalogsLoading" class="empty-row" style="font-size:11px">{{ t('state.loading') }}</div>
            <div v-else-if="!athenaEditor.catalogs.length" class="empty-row" style="font-size:11px">{{ t('awsv.noCatalogsFound') }}</div>
            <div v-else class="athena-tree">
              <div v-for="cat in athenaEditor.catalogs" :key="cat.name" class="athena-tree-catalog">
                <div class="athena-tree-node catalog-node" @click="cat._open = !cat._open">
                  <span class="tree-icon">{{ cat._open ? '▾' : '▸' }}</span>
                  <span class="tree-icon-db">🗄</span>
                  <span class="tree-label">{{ cat.name }}</span>
                  <span class="tree-badge">{{ cat.type }}</span>
                </div>
                <div v-if="cat._open" class="athena-tree-databases">
                  <div v-for="db in (cat.databases || [])" :key="db.name" class="athena-tree-db">
                    <div class="athena-tree-node db-node" @click="toggleAthenaDb(cat, db)">
                      <span class="tree-icon">{{ db._open ? '▾' : '▸' }}</span>
                      <span class="tree-icon-db">📁</span>
                      <span class="tree-label" :class="{ active: athenaEditor.selectedCatalog === cat.name && athenaEditor.selectedDb === db.name }" @click.stop="selectAthenaDb(cat, db)">{{ db.name }}</span>
                    </div>
                    <div v-if="db._open" class="athena-tree-tables">
                      <div v-if="db._loadingTables" class="tree-loading">{{ t('awsv.loadingTables') }}</div>
                      <div v-else-if="!(db.tables || []).length" class="tree-loading">{{ t('awsv.noTables') }}</div>
                      <div v-for="tbl in (db.tables || [])" :key="tbl.name"
                        class="athena-tree-node table-node"
                        :class="{ active: athenaEditor.selectedTable === tbl.name }"
                        @click="selectAthenaTable(cat, db, tbl)">
                        <span class="tree-icon-db">🗒</span>
                        <span class="tree-label">{{ tbl.name }}</span>
                        <span class="tree-badge dim">{{ tbl.tableType }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Query editor -->
          <div class="athena-main">
            <!-- Toolbar -->
            <div class="athena-toolbar">
              <select v-model="athenaEditor.selectedWorkgroup" class="ctrl-select" style="min-width:130px;font-size:12px">
                <option value="">— Workgroup —</option>
                <option v-for="wg in awsStore.athenaWorkgroups" :key="wg.name" :value="wg.name">{{ wg.name }}</option>
              </select>
              <span v-if="athenaEditor.selectedDb" class="text-dim" style="font-size:11px">{{ athenaEditor.selectedCatalog }}.{{ athenaEditor.selectedDb }}</span>
              <input v-if="!athenaSelectedWgOutputLocation" v-model="athenaEditor.outputLocation" class="ctrl-input" type="text"
                :placeholder="t('awsv.s3BucketPathOutputLocationWorkgroup')"
                style="font-size:11px;min-width:280px" :title="t('awsv.thisWorkgroupHasNoQueryResult')" />
              <div style="flex:1"></div>
              <button class="btn sm" @click="loadAthenaHistory" :title="t('awsv.queryHistory')">{{ t('awsLogs.history.column') }}</button>
              <button class="btn" style="background:rgba(34,197,94,.2);border-color:#22c55e;color:#22c55e;font-size:12px"
                @click="runAthenaEditorQuery" :disabled="athenaEditor.running || !athenaEditor.sql.trim()">
                {{ athenaEditor.running ? t('awsv.lit.runningQuery') : t('awsv.lit.runButton') }}
              </button>
            </div>

            <!-- SQL editor -->
            <div class="athena-editor-wrap">
              <textarea
                v-model="athenaEditor.sql"
                class="athena-editor"
                placeholder="SELECT * FROM my_database.my_table LIMIT 10;"
                spellcheck="false"
                @keydown.ctrl.enter.prevent="runAthenaEditorQuery"
              ></textarea>
            </div>

            <!-- Status bar -->
            <div v-if="athenaEditor.queryId || athenaEditor.error" class="athena-status-bar">
              <span v-if="athenaEditor.running" class="status-warn">{{ t('apm.status.running') }}</span>
              <span v-else-if="athenaEditor.status === 'SUCCEEDED'" class="status-ok">{{ t('awsInsights.succeeded') }}</span>
              <span v-else-if="athenaEditor.status === 'FAILED'" class="status-err">{{ t('apm.status.failed') }}</span>
              <span v-else-if="athenaEditor.status === 'CANCELLED'" class="status-err">{{ t('awsLogs.scan.status_cancelled') }}</span>
              <span v-if="athenaEditor.queryId" class="text-dim mono-xs">ID: {{ athenaEditor.queryId }}</span>
              <span v-if="athenaEditor.execTimeMs" class="text-dim" style="font-size:11px">{{ (athenaEditor.execTimeMs/1000).toFixed(1) }}s · {{ athenaEditor.bytesScanned ? formatBytes(athenaEditor.bytesScanned) + ' scanned' : '' }}</span>
              <span v-if="athenaEditor.error" class="status-err" style="font-size:11px">{{ athenaEditor.error }}</span>
            </div>

            <!-- Results -->
            <div class="athena-results" v-if="athenaEditor.results">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;flex-shrink:0;font-size:11px;color:var(--text-dim)">
                <span>{{ t('awsv.rows', { p0: (athenaEditor.results.Rows || []).length - 1 }) }}</span>
                <button class="btn sm" @click="exportAthenaResults">{{ t('awsv.exportCsv') }}</button>
              </div>
              <div style="overflow:auto;flex:1">
                <table class="cloud-table" style="font-size:11px">
                  <thead>
                    <tr>
                      <th v-for="col in (athenaEditor.results.ResultSetMetadata?.ColumnInfo || [])" :key="col.Name">{{ col.Name }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in (athenaEditor.results.Rows || []).slice(1)" :key="ri">
                      <td v-for="(cell, ci) in (row.Data || [])" :key="ci" class="text-dim">{{ cell.VarCharValue ?? '' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- History panel -->
            <div v-if="athenaEditor.showHistory" class="athena-history-panel">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border);flex-shrink:0">
                <span style="font-size:12px;font-weight:600">{{ t('awsv.recentQueries') }}</span>
                <button class="btn sm" @click="athenaEditor.showHistory = false" :aria-label="t('action.close')" :title="t('action.close')">✕</button>
              </div>
              <div v-if="athenaEditor.historyLoading" class="empty-row">{{ t('state.loading') }}</div>
              <div v-else-if="!athenaEditor.history.length" class="empty-row" style="font-size:12px">{{ t('awsv.noHistoryFound') }}</div>
              <div v-else style="overflow-y:auto;flex:1">
                <div v-for="h in athenaEditor.history" :key="h.id"
                  class="athena-history-item"
                  @click="loadHistoryItem(h)">
                  <div style="display:flex;gap:6px;align-items:center">
                    <span :class="h.state === 'SUCCEEDED' ? 'status-ok' : h.state === 'FAILED' ? 'status-err' : 'status-warn'" style="font-size:10px">{{ h.state }}</span>
                    <span class="text-dim" style="font-size:10px">{{ h.submittedAt ? formatDate(h.submittedAt) : '' }}</span>
                    <span v-if="h.database" class="text-dim mono-xs" style="font-size:10px">{{ h.database }}</span>
                  </div>
                  <div class="mono-xs" style="font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">{{ h.query }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ Data Pipeline ══════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'datapipeline'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredPipelines.length" class="empty-row">{{ search.datapipeline ? t('awsv.lit.noMatches') : t('awsv.lit.noDataPipelines') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">Pipeline <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('state')" :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortBy('state')">{{ t('th.state') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('state') }}</span></button></th>
            <th :class="thClass('latestRunTime')" :aria-sort="ariaSort('latestRunTime')"><button type="button" class="th-sort" @click="sortBy('latestRunTime')">{{ t('awsv.lastRun') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('latestRunTime') }}</span></button></th>
            <th :class="thClass('nextRunTime')" :aria-sort="ariaSort('nextRunTime')"><button type="button" class="th-sort" @click="sortBy('nextRunTime')">{{ t('awsv.nextRun') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('nextRunTime') }}</span></button></th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="p in sortRows(filteredPipelines)" :key="p.id">
              <td>
                <div>{{ p.name }}</div>
                <div class="text-dim mono-xs">{{ p.id }}</div>
              </td>
              <td><span :class="p.state === 'SCHEDULED' ? 'status-ok' : p.state === 'PAUSED' ? 'status-warn' : 'text-dim'">{{ p.state }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ p.latestRunTime ? formatDate(p.latestRunTime) : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ p.nextRunTime ? formatDate(p.nextRunTime) : '-' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="activatePipeline(p)" :disabled="p.state === 'SCHEDULED'">{{ t('awsv.activate') }}</button>
                  <button class="btn sm danger" @click="deactivatePipeline(p)" :disabled="p.state === 'PAUSED'">{{ t('awsLogs.scan.pause') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Bedrock ═══════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'bedrock'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredBedrock.length" class="empty-row">{{ search.bedrock ? t('awsv.lit.noMatches') : t('awsv.lit.noBedrock') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('modelName')" :aria-sort="ariaSort('modelName')"><button type="button" class="th-sort" @click="sortBy('modelName')">{{ t('gvi.model') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('modelName') }}</span></button></th>
            <th :class="thClass('providerName')" :aria-sort="ariaSort('providerName')"><button type="button" class="th-sort" @click="sortBy('providerName')">{{ t('profile.providerLabel') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('providerName') }}</span></button></th>
            <th :class="thClass('inputModalities')" :aria-sort="ariaSort('inputModalities')"><button type="button" class="th-sort" @click="sortBy('inputModalities')">{{ t('awsv.input') }}</button></th>
            <th :class="thClass('outputModalities')" :aria-sort="ariaSort('outputModalities')"><button type="button" class="th-sort" @click="sortBy('outputModalities')">{{ t('awsv.output') }}</button></th>
            <th :class="thClass('responseStreamingSupported')" :aria-sort="ariaSort('responseStreamingSupported')"><button type="button" class="th-sort" @click="sortBy('responseStreamingSupported')">Streaming</button></th>
            <th :class="thClass('lifecycleStatus')" :aria-sort="ariaSort('lifecycleStatus')"><button type="button" class="th-sort" @click="sortBy('lifecycleStatus')">{{ t('eksd.lifecycle') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('lifecycleStatus') }}</span></button></th>
          </tr></thead>
          <tbody>
            <tr v-for="m in sortRows(filteredBedrock)" :key="m.modelId">
              <td>
                <div>{{ m.modelName || m.modelId }}</div>
                <div class="text-dim mono-xs">{{ m.modelId }}</div>
              </td>
              <td class="text-dim">{{ m.providerName || '-' }}</td>
              <td class="text-dim">{{ (m.inputModalities || []).join(', ') || '-' }}</td>
              <td class="text-dim">{{ (m.outputModalities || []).join(', ') || '-' }}</td>
              <td><span :class="m.responseStreamingSupported ? 'status-ok' : 'text-dim'">{{ m.responseStreamingSupported ? t('common.yes') : t('common.no') }}</span></td>
              <td><span :class="m.lifecycleStatus === 'ACTIVE' ? 'status-ok' : 'status-warn'">{{ m.lifecycleStatus || '-' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Amazon Lex ════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'lex'" class="tab-panel" style="display:flex;flex-direction:column;overflow:hidden;padding:0">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredLex.length" class="empty-row">{{ search.lex ? t('awsv.lit.noMatches') : t('awsv.lit.noLex') }}</div>
        <div v-else style="display:flex;flex:1;overflow:hidden">
          <!-- LEFT: bot list -->
          <div style="width:260px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0">
            <div v-for="b in sortRows(filteredLex)" :key="b.id"
              :class="['sidebar-item', lexPanel.bot?.id === b.id ? 'active' : '']"
              style="cursor:pointer" role="button" tabindex="0" :aria-current="lexPanel.bot?.id === b.id ? 'true' : undefined"
              @click="selectLexBot(b)" @keydown.enter.prevent="selectLexBot(b)" @keydown.space.prevent="selectLexBot(b)">
              <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ b.name }}</div>
              <div class="mono-xs text-dim" style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ b.id }}</div>
              <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
                <span :class="b.status === 'Available' ? 'status-ok' : 'status-warn'" style="font-size:10px">{{ b.status || '-' }}</span>
                <span class="text-dim" style="font-size:10px">v{{ b.latestVersion || '?' }}</span>
                <span class="text-dim" style="font-size:10px">{{ b.updatedDate ? formatDate(b.updatedDate) : '' }}</span>
              </div>
            </div>
          </div>
          <!-- RIGHT: detail panel -->
          <div v-if="!lexPanel.bot" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px">
            {{ t('awsv.selectABotToSeeDetails') }}
          </div>
          <div v-else style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <!-- Bot header -->
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
              <div style="font-weight:700;font-size:15px">{{ lexPanel.bot.name }}</div>
              <div style="display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;align-items:center">
                <span :class="lexPanel.bot.status === 'Available' ? 'status-ok' : 'status-warn'" style="font-size:11px">{{ lexPanel.bot.status }}</span>
                <span class="text-dim" style="font-size:11px">v{{ lexPanel.bot.latestVersion || '-' }}</span>
                <span class="mono-xs text-dim" style="font-size:10px">{{ lexPanel.bot.id }}</span>
                <span v-if="lexPanel.bot.description" class="text-dim" style="font-size:11px">{{ lexPanel.bot.description }}</span>
              </div>
            </div>
            <!-- Inner tabs -->
            <div style="display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap">
              <button v-for="tab in lexInnerTabs" :key="tab.id"
                :class="['aws-tab-btn', lexPanel.innerTab === tab.id ? 'active' : '']"
                @click="lexPanelSwitchTab(tab.id)">{{ tab.label }}</button>
            </div>
            <!-- ── INTENTS tab ─────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'intents'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div v-if="lexIntentsModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('awsv.loadingIntents') }}</div>
              <div v-else-if="lexIntentsModal.error" class="alert-error" style="margin:12px">{{ lexIntentsModal.error }}</div>
              <div v-else style="flex:1;overflow:hidden;display:flex;flex-direction:column">
                <div style="display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
                  <span class="text-dim" style="font-size:11px">{{ t('th.version') }}</span>
                  <select v-model="lexIntentsModal.botVersion" @change="reloadLexIntents()" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                    <option v-for="version in lexVersionOptions" :key="version" :value="version">{{ version }}</option>
                  </select>
                  <button class="btn sm" @click="reloadLexIntents(true)" :disabled="lexIntentsModal.loading">{{ t('action.refresh') }}</button>
                </div>
                <div v-if="lexIntentsModal.locales.length > 1" style="display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--border);flex-shrink:0">
                  <button v-for="loc in lexIntentsModal.locales" :key="loc.localeId"
                    :class="['btn','xs', lexIntentsModal.activeLocale === loc.localeId ? 'active' : '']"
                    @click="lexIntentsModal.activeLocale = loc.localeId; lexIntentsModal.activeIntent = null; lexIntentsModal.activeView = 'list'">
                    {{ loc.localeName }} <span class="text-dim">({{ loc.intents.length }})</span>
                  </button>
                </div>
                <div style="display:flex;gap:4px;padding:8px 12px 0;flex-shrink:0">
                  <button :class="['btn','xs', lexIntentsModal.activeView === 'list' ? 'active' : '']"
                    @click="lexIntentsModal.activeView = 'list'; lexIntentsModal.activeIntent = null">{{ t('awsv.intentList') }}</button>
                  <button :class="['btn','xs', lexIntentsModal.activeView === 'flow' ? 'active' : '']"
                    @click="lexIntentsModal.activeView = 'flow'">{{ t('awsv.conversationFlow') }}</button>
                </div>
                <div style="flex:1;overflow:auto;padding:12px">
                  <div v-if="lexIntentsModal.activeView === 'list'">
                    <div v-if="!lexCurrentLocale || !lexCurrentLocale.intents.length" class="text-dim" style="padding:16px">{{ t('awsv.noIntentsFoundForThisLocale') }}</div>
                    <div v-else>
                      <div v-for="intent in lexCurrentLocale.intents" :key="intent.id"
                        style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden">
                        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;background:var(--surface)"
                          @click="lexIntentsModal.activeIntent = lexIntentsModal.activeIntent === intent.id ? null : intent.id">
                          <span style="font-weight:600;flex:1">{{ intent.name }}</span>
                          <span class="text-dim" style="font-size:11px">{{ t('awsv.slotCount', { n: intent.slots.length }) }}</span>
                          <span class="text-dim" style="font-size:11px">{{ t('awsv.utteranceCount', { n: intent.sampleUtterances.length }) }}</span>
                          <span style="font-size:11px;color:var(--text-dim)">{{ lexIntentsModal.activeIntent === intent.id ? '▲' : '▼' }}</span>
                        </div>
                        <div v-if="lexIntentsModal.activeIntent === intent.id" style="padding:12px;border-top:1px solid var(--border)">
                          <div v-if="intent.description" class="text-dim" style="font-size:12px;margin-bottom:8px">{{ intent.description }}</div>
                          <div style="margin-bottom:12px">
                            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">{{ t('awsv.sampleUtterances') }}</div>
                            <div v-if="!intent.sampleUtterances.length" class="text-dim" style="font-size:12px">{{ t('awsv.noneDefined') }}</div>
                            <div style="display:flex;flex-wrap:wrap;gap:4px">
                              <span v-for="(u, i) in intent.sampleUtterances" :key="i"
                                style="background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:12px;padding:2px 8px;font-size:11px">{{ u }}</span>
                            </div>
                          </div>
                          <div>
                            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Slots</div>
                            <div v-if="!intent.slots.length" class="text-dim" style="font-size:12px">{{ t('awsv.noSlotsDefined') }}</div>
                            <table v-else class="cloud-table" style="font-size:12px">
                              <thead><tr><th>{{ t('awsv.slotName') }}</th><th>{{ t('th.type') }}</th><th>{{ t('awsv.required') }}</th><th>{{ t('th.description') }}</th></tr></thead>
                              <tbody>
                                <tr v-for="s in intent.slots" :key="s.id">
                                  <td style="font-weight:600">{{ s.name }}</td>
                                  <td class="mono-xs">{{ s.typeName || '-' }}</td>
                                  <td><span :class="s.required ? 'status-ok' : 'status-warn'">{{ s.required ? t('awsv.required') : t('awsv.optional') }}</span></td>
                                  <td class="text-dim">{{ s.description || '-' }}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-if="lexIntentsModal.activeView === 'flow'">
                    <div v-if="!lexCurrentLocale || !lexCurrentLocale.intents.length" class="text-dim" style="padding:16px">{{ t('awsv.noIntentsToRenderFlow') }}</div>
                    <div v-else style="display:flex;flex-wrap:wrap;gap:16px">
                      <div v-for="intent in lexCurrentLocale.intents" :key="intent.id"
                        style="border:1px solid rgba(139,92,246,.4);border-radius:8px;min-width:220px;max-width:300px;overflow:hidden;background:var(--surface)">
                        <div style="background:rgba(139,92,246,.2);padding:8px 12px;border-bottom:1px solid rgba(139,92,246,.3)">
                          <div style="font-weight:600;font-size:13px">🎯 {{ intent.name }}</div>
                          <div v-if="intent.description" class="text-dim" style="font-size:11px">{{ intent.description }}</div>
                        </div>
                        <div style="padding:8px 12px;border-bottom:1px solid var(--border)">
                          <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Triggers</div>
                          <div style="display:flex;flex-direction:column;gap:2px">
                            <div v-for="(u, i) in intent.sampleUtterances.slice(0,3)" :key="i"
                              style="font-size:11px;color:var(--text-dim);font-style:italic">"{{ u }}"</div>
                            <div v-if="intent.sampleUtterances.length > 3" class="text-dim" style="font-size:10px">{{ t('awsv.more', { p0: intent.sampleUtterances.length - 3 }) }}</div>
                          </div>
                        </div>
                        <div v-if="intent.slots.length" style="padding:8px 12px">
                          <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px">{{ t('awsv.slotCollection') }}</div>
                          <div style="display:flex;flex-direction:column;gap:4px">
                            <div v-for="(s, si) in intent.slots" :key="s.id" style="display:flex;align-items:center;gap:6px">
                              <div style="width:16px;text-align:center;font-size:10px;color:var(--text-dim)">{{ si + 1 }}</div>
                              <div :style="`flex:1;border:1px solid ${s.required ? 'rgba(34,197,94,.4)' : 'rgba(250,204,21,.4)'};border-radius:4px;padding:3px 7px;font-size:11px;background:${s.required ? 'rgba(34,197,94,.08)' : 'rgba(250,204,21,.08)'}`">
                                <span style="font-weight:600">{{ s.name }}</span>
                                <span class="text-dim" style="font-size:10px;margin-left:4px">{{ s.typeName }}</span>
                              </div>
                              <span :class="s.required ? 'status-ok' : 'status-warn'" style="font-size:9px;padding:1px 4px">{{ s.required ? 'REQ' : 'OPT' }}</span>
                            </div>
                          </div>
                        </div>
                        <div v-else style="padding:8px 12px;color:var(--text-dim);font-size:11px">{{ t('awsv.noSlotsImmediateFulfillment') }}</div>
                        <div style="background:rgba(34,197,94,.1);padding:6px 12px;border-top:1px solid var(--border);font-size:11px;color:#22c55e;text-align:center">✓ Fulfillment</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <!-- ── ALIASES tab ─────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'aliases'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center">
                <button class="btn sm" style="background:rgba(20,184,166,.15);border-color:#14b8a6;color:#14b8a6"
                  @click="lexAliasesModal.showCreate = !lexAliasesModal.showCreate">
                  {{ lexAliasesModal.showCreate ? t('awsv.lit.cancelButton') : t('awsv.lit.newAlias') }}
                </button>
                <div v-if="lexAliasesModal.botArn" class="mono-xs text-dim" style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" :title="lexAliasesModal.botArn">
                  ARN: {{ lexAliasesModal.botArn }}
                </div>
              </div>
              <div v-if="lexAliasesModal.showCreate" style="padding:14px 16px;border-bottom:1px solid var(--border);background:rgba(20,184,166,.05);flex-shrink:0">
                <div style="font-size:12px;font-weight:600;margin-bottom:10px;color:#2dd4bf">{{ t('awsv.createNewAlias') }}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
                  <div>
                    <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">{{ t('awsv.name') }}</label>
                    <input v-model="lexAliasesModal.createForm.name" type="text" placeholder="my-alias"
                      style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text)" />
                  </div>
                  <div>
                    <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">{{ t('awsv.botVersion') }}</label>
                    <input v-model="lexAliasesModal.createForm.botVersion" type="text" placeholder="1, 2, DRAFT…"
                      style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text)" />
                  </div>
                  <div>
                    <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">{{ t('th.description') }}</label>
                    <input v-model="lexAliasesModal.createForm.description" type="text" :placeholder="t('awsv.optional')"
                      style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text)" />
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <button class="btn sm" style="background:rgba(20,184,166,.2);border-color:#14b8a6;color:#2dd4bf"
                    :disabled="lexAliasesModal.creating || !lexAliasesModal.createForm.name || !lexAliasesModal.createForm.botVersion"
                    @click="doCreateLexAlias">
                    {{ lexAliasesModal.creating ? t('awsv.lit.creating') : t('awsv.lit.createAlias') }}
                  </button>
                  <span v-if="lexAliasesModal.createError" style="font-size:12px;color:#f87171">{{ lexAliasesModal.createError }}</span>
                </div>
              </div>
              <div v-if="lexAliasesModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('awsv.loadingAliases') }}</div>
              <div v-else-if="lexAliasesModal.error" class="alert-error" style="margin:12px">{{ lexAliasesModal.error }}</div>
              <div v-else style="flex:1;overflow:auto;padding:12px">
                <div v-if="!lexAliasesModal.aliases.length" class="text-dim" style="text-align:center;padding:32px">{{ t('vercel.aliases.none') }}</div>
                <div v-for="alias in lexAliasesModal.aliases" :key="alias.id"
                  style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
                  <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--surface)">
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600;font-size:14px">{{ alias.name }}</div>
                      <div class="mono-xs text-dim" style="font-size:10px">ID: {{ alias.id }}</div>
                      <div v-if="alias.arn" class="mono-xs text-dim" style="font-size:10px;word-break:break-all" :title="alias.arn">ARN: {{ alias.arn }}</div>
                      <div v-if="alias.description" class="text-dim" style="font-size:11px;margin-top:2px">{{ alias.description }}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                      <span :class="alias.status === 'Available' ? 'status-ok' : 'status-warn'">{{ alias.status }}</span>
                      <span style="font-size:11px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:1px 7px;color:#818cf8">v{{ alias.botVersion }}</span>
                    </div>
                  </div>
                  <div style="padding:10px 14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--border)">
                    <div>
                      <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Fulfillment Lambdas</div>
                      <div v-if="!alias.lambdaArns.length" class="text-dim" style="font-size:12px">{{ t('awsv.noneConfigured') }}</div>
                      <div v-for="l in alias.lambdaArns" :key="l.localeId" style="font-size:11px;margin-bottom:2px">
                        <span class="mono-xs" style="background:rgba(245,158,11,.1);border-radius:3px;padding:0 3px;color:#fbbf24">{{ l.localeId }}</span>
                        <span class="mono-xs text-dim" :title="l.arn" style="margin-left:4px">{{ l.arn.split(':').pop() }}</span>
                      </div>
                    </div>
                    <div>
                      <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">{{ t('awsv.conversationLogs') }}</div>
                      <div style="display:flex;flex-direction:column;gap:3px">
                        <span v-if="alias.textLogs" style="font-size:11px;color:#4ade80">{{ t('awsv.textLogs') }}</span>
                        <span v-else style="font-size:11px;color:var(--text-dim)">{{ t('awsv.textLogs2') }}</span>
                        <span v-if="alias.audioLogs" style="font-size:11px;color:#4ade80">{{ t('awsv.audioLogs') }}</span>
                        <span v-else style="font-size:11px;color:var(--text-dim)">{{ t('awsv.audioLogs2') }}</span>
                        <span v-if="alias.logsGroup" class="mono-xs text-dim" style="font-size:10px" :title="alias.logsGroup">{{ alias.logsGroup.split(':').pop() }}</span>
                      </div>
                    </div>
                    <div>
                      <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">{{ t('awsv.dates') }}</div>
                      <div v-if="alias.createdDate" style="font-size:11px;color:var(--text-dim)">{{ t('awsv.created', { p0: new Date(alias.createdDate).toLocaleString() }) }}</div>
                      <div v-if="alias.updatedDate" style="font-size:11px;color:var(--text-dim)">{{ t('awsv.updated', { p0: new Date(alias.updatedDate).toLocaleString() }) }}</div>
                    </div>
                  </div>
                  <div style="padding:8px 14px 10px;display:flex;gap:6px;border-top:1px solid var(--border)">
                    <button class="btn xs" style="background:rgba(245,158,11,.15);border-color:#f59e0b;color:#f59e0b"
                      @click="openLexChatFromAlias(lexPanel.bot, alias)">💬 Chat</button>
                    <button class="btn xs" style="background:rgba(99,102,241,.15);border-color:#6366f1;color:#6366f1"
                      @click="openLexBuildFromAlias(lexPanel.bot, alias)">⚒ Build</button>
                    <button class="btn xs" style="background:rgba(15,23,42,.3);border-color:var(--border);color:var(--text-dim)"
                      :title="alias.arn || alias.id" @click="navigator.clipboard.writeText(alias.arn || alias.id)">{{ t('awsv.copyArn') }}</button>
                  </div>
                </div>
              </div>
            </div>
            <!-- ── SLOT TYPES tab ──────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'slottypes'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="lexSlotTypesModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('awsv.loadingSlotTypes') }}</div>
              <div v-else-if="lexSlotTypesModal.error" class="alert-error" style="margin:12px">{{ lexSlotTypesModal.error }}</div>
              <div v-else>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
                  <span class="text-dim" style="font-size:11px">{{ t('th.version') }}</span>
                  <select v-model="lexSlotTypesModal.botVersion" @change="reloadLexSlotTypes()" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                    <option v-for="version in lexVersionOptions" :key="version" :value="version">{{ version }}</option>
                  </select>
                  <button class="btn sm" @click="reloadLexSlotTypes(true)" :disabled="lexSlotTypesModal.loading">{{ t('action.refresh') }}</button>
                </div>
                <div v-if="lexSlotTypesModal.locales.length > 1" style="display:flex;gap:4px;margin-bottom:10px">
                  <button v-for="loc in lexSlotTypesModal.locales" :key="loc.localeId"
                    :class="['btn','xs', lexSlotTypesModal.activeLocale === loc.localeId ? 'active' : '']"
                    @click="lexSlotTypesModal.activeLocale = loc.localeId">{{ loc.localeName }}</button>
                </div>
                <div v-for="locale in lexSlotTypesModal.locales.filter(l => l.localeId === lexSlotTypesModal.activeLocale)" :key="locale.localeId">
                  <div v-if="!locale.types.length" class="text-dim" style="text-align:center;padding:32px">{{ t('awsv.noCustomSlotTypesDefinedFor') }}</div>
                  <div v-for="st in locale.types" :key="st.id"
                    style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
                    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface)">
                      <div style="flex:1">
                        <span style="font-weight:600">{{ st.name }}</span>
                        <span class="mono-xs text-dim" style="font-size:10px;margin-left:6px">{{ st.id }}</span>
                      </div>
                      <span style="font-size:11px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);border-radius:10px;padding:1px 7px;color:#c084fc">{{ st.strategy }}</span>
                      <span class="text-dim" style="font-size:11px">{{ t('awsv.valueCount', { n: st.values.length }) }}</span>
                    </div>
                    <div style="padding:8px 14px;display:flex;flex-wrap:wrap;gap:6px">
                      <div v-for="val in st.values" :key="val.value"
                        style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px">
                        <span style="font-weight:600">{{ val.value }}</span>
                        <span v-if="val.synonyms.length" class="text-dim" style="font-size:11px"> — {{ val.synonyms.join(', ') }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="!lexSlotTypesModal.locales.length" class="text-dim" style="text-align:center;padding:32px">{{ t('awsv.noCustomSlotTypesFound') }}</div>
              </div>
            </div>
            <!-- ── CHAT tab ────────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'chat'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <select v-model="lexChatModal.aliasId" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option value="TSTALIASID">DRAFT (TestBotAlias)</option>
                  <option v-for="a in lexChatModal.aliases" :key="a.id" :value="a.id">{{ a.name }} ({{ a.botVersion }})</option>
                </select>
                <select v-model="lexChatModal.localeId" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option v-if="!lexChatModal.locales.length" value="">{{ t('state.loading') }}</option>
                  <option v-for="loc in lexChatModal.locales" :key="loc.localeId" :value="loc.localeId">{{ loc.localeName || loc.localeId }}</option>
                </select>
                <button class="btn sm" @click="lexChatReset">{{ t('cfn.ops.reset') }}</button>
              </div>
              <div ref="lexChatScrollRef" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
                <div v-if="!lexChatModal.messages.length" style="text-align:center;color:var(--text-dim);padding:40px 0;font-size:13px">
                  {{ t('awsv.typeAMessageToStartThe') }}
                </div>
                <div v-for="(msg, i) in lexChatModal.messages" :key="i"
                  :style="`display:flex;flex-direction:column;align-items:${msg.role === 'user' ? 'flex-end' : 'flex-start'};gap:4px`">
                  <div :style="`max-width:80%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;${msg.role === 'user' ? 'background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3)' : 'background:var(--surface);border:1px solid var(--border)'}`">
                    {{ msg.role === 'user' ? msg.text : msg.content }}
                  </div>
                  <div v-if="msg.role === 'bot' && msg.intent" style="display:flex;gap:4px;flex-wrap:wrap">
                    <span style="font-size:10px;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:10px;padding:1px 6px;color:#a78bfa">🎯 {{ msg.intent }}</span>
                    <span v-if="msg.confidence != null" style="font-size:10px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:1px 6px;color:#4ade80">{{ (msg.confidence * 100).toFixed(0) }}%</span>
                    <span v-for="(v, k) in msg.slots" :key="k" style="font-size:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:1px 6px;color:#fbbf24">{{ k }}: {{ v }}</span>
                  </div>
                  <details v-if="msg.role === 'bot' && msg.interpretations && msg.interpretations.length > 1" style="font-size:10px;color:var(--text-dim);margin-top:2px">
                    <summary style="cursor:pointer">{{ t('awsv.allInterpretations') }}</summary>
                    <div v-for="int in msg.interpretations" :key="int.intent" style="padding:1px 4px">{{ int.intent }}: {{ int.confidence != null ? (int.confidence*100).toFixed(0)+'%' : '' }}</div>
                  </details>
                </div>
                <div v-if="lexChatModal.sending" style="display:flex;align-items:flex-start;gap:4px">
                  <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 12px;font-size:13px;color:var(--text-dim)">...</div>
                </div>
              </div>
              <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:8px;flex-shrink:0">
                <input v-model="lexChatModal.input" type="text" :placeholder="t('awsv.typeAMessage')"
                  style="flex:1;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text)"
                  @keydown.enter="lexChatSend" :disabled="lexChatModal.sending" />
                <button class="btn sm" style="background:rgba(99,102,241,.2);border-color:#6366f1;color:#6366f1"
                  @click="lexChatSend" :disabled="!lexChatModal.input.trim() || lexChatModal.sending">{{ t('awsv.send') }}</button>
              </div>
            </div>
            <!-- ── LOGS tab ────────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'logs'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <select v-model="lexLogsModal.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="1">{{ t('awsv.last1h') }}</option>
                  <option :value="6">{{ t('awsv.last6h') }}</option>
                  <option :value="24">{{ t('awsv.last24h') }}</option>
                  <option :value="72">{{ t('awsv.last3d') }}</option>
                  <option :value="168">{{ t('awsv.last7d') }}</option>
                </select>
                <select v-model="lexLogsModal.aliasId" @change="reloadLexLogs()" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option value="">{{ t('awsv.allAliases') }}</option>
                  <option v-for="alias in lexLogsModal.aliases" :key="alias.aliasId" :value="alias.aliasId">{{ alias.aliasName || alias.aliasId }} ({{ alias.botVersion }})</option>
                </select>
                <select v-model="lexLogsModal.localeId" @change="reloadLexLogs()" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option value="">{{ t('awsv.allLocales') }}</option>
                  <option v-for="locale in lexLogLocales" :key="locale" :value="locale">{{ locale }}</option>
                </select>
                <button class="btn sm" @click="reloadLexLogs(true)" :disabled="lexLogsModal.loading">{{ lexLogsModal.loading ? t('common.loading') : t('action.refresh') }}</button>
              </div>
              <div v-if="lexLogsModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('awsv.loadingLogs') }}</div>
              <div v-else-if="lexLogsModal.error" class="alert-error" style="margin:12px">{{ lexLogsModal.error }}</div>
              <div v-else-if="!lexLogsModal.configured" style="padding:24px;text-align:center">
                <div style="font-size:32px;margin-bottom:8px">📋</div>
                <div style="font-weight:600;margin-bottom:4px">{{ t('awsv.conversationLogsNotConfigured') }}</div>
                <div class="text-dim" style="font-size:12px">{{ t('awsv.noCloudwatchLogGroupFoundFor') }}</div>
              </div>
              <div v-else style="flex:1;overflow:hidden;display:flex;flex-direction:column">
                <div style="padding:6px 12px;font-size:11px;color:var(--text-dim);flex-shrink:0;border-bottom:1px solid var(--border)">
                  Log group: <span class="mono-xs">{{ (lexLogsModal.groups || []).join(', ') }}</span>
                  {{ t('awsv.events', { p0: lexLogsModal.events.length }) }}
                </div>
                <div v-if="!lexLogsModal.events.length" class="empty-row">{{ t('awsv.noLogEventsInThisTime') }}</div>
                <div v-else style="flex:1;overflow:auto;padding:8px">
                  <div v-for="(ev, idx) in lexLogsModal.events" :key="idx"
                    style="border:1px solid var(--border);border-radius:4px;margin-bottom:6px;overflow:hidden">
                    <div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--surface);cursor:pointer"
                      @click="ev._expanded = !ev._expanded; lexLogsModal.events = [...lexLogsModal.events]">
                      <span class="text-dim mono-xs" style="flex-shrink:0">{{ new Date(ev.timestamp).toLocaleString() }}</span>
                      <span class="mono-xs text-dim" style="font-size:10px;flex-shrink:0">{{ ev.stream }}</span>
                      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">
                        {{ ev.parsed ? (ev.parsed.inputTranscript || ev.parsed.sessionId || JSON.stringify(ev.parsed).slice(0,80)) : ev.message.slice(0,100) }}
                      </span>
                      <span style="font-size:10px;color:var(--text-dim)">{{ ev._expanded ? '▲' : '▼' }}</span>
                    </div>
                    <div v-if="ev._expanded" style="padding:10px;border-top:1px solid var(--border);font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.15)">{{ ev.parsed ? JSON.stringify(ev.parsed, null, 2) : ev.message }}</div>
                  </div>
                </div>
              </div>
            </div>
            <!-- ── MISSED tab ──────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'missed'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <select v-model="lexMissedModal.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option :value="6">{{ t('awsv.last6h') }}</option>
                  <option :value="24">{{ t('awsv.last24h') }}</option>
                  <option :value="72">{{ t('awsv.last3d') }}</option>
                  <option :value="168">{{ t('awsv.last7d') }}</option>
                </select>
                <select v-model="lexMissedModal.aliasId" @change="reloadLexMissed()" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option value="">{{ t('awsv.allAliases') }}</option>
                  <option v-for="alias in lexMissedModal.aliases" :key="alias.aliasId" :value="alias.aliasId">{{ alias.aliasName || alias.aliasId }} ({{ alias.botVersion }})</option>
                </select>
                <select v-model="lexMissedModal.localeId" @change="reloadLexMissed()" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                  <option value="">{{ t('awsv.allLocales') }}</option>
                  <option v-for="locale in lexMissedLocales" :key="locale" :value="locale">{{ locale }}</option>
                </select>
                <button class="btn sm" @click="reloadLexMissed(true)" :disabled="lexMissedModal.loading">{{ lexMissedModal.loading ? t('common.loading') : t('action.refresh') }}</button>
              </div>
              <div v-if="lexMissedModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('state.loading') }}</div>
              <div v-else-if="lexMissedModal.error" class="alert-error" style="margin:12px">{{ lexMissedModal.error }}</div>
              <div v-else-if="!lexMissedModal.configured" style="padding:32px;text-align:center">
                <div style="font-size:28px;margin-bottom:8px">🔇</div>
                <div style="font-weight:600;margin-bottom:4px">{{ t('awsv.conversationLogsNotConfigured') }}</div>
                <div class="text-dim" style="font-size:12px">{{ t('awsv.enableConversationLogsInTheBot') }}</div>
              </div>
              <div v-else style="flex:1;overflow:hidden;display:flex;flex-direction:column">
                <div style="padding:6px 12px;font-size:11px;color:var(--text-dim);border-bottom:1px solid var(--border);flex-shrink:0">
                  <span class="mono-xs">{{ lexMissedModal.logGroupName }}</span> {{ t('awsv.missedCount', { n: lexMissedModal.utterances.length }) }}
                </div>
                <div v-if="!lexMissedModal.utterances.length" class="empty-row">{{ t('awsv.noMissedUtterancesInThisTime') }}</div>
                <div v-else style="flex:1;overflow:auto">
                  <table class="cloud-table">
                    <thead><tr><th>{{ t('awsLogs.chart.time') }}</th><th>Utterance</th><th>{{ t('awsv.session') }}</th><th>Locale</th></tr></thead>
                    <tbody>
                      <tr v-for="(u, i) in lexMissedModal.utterances" :key="i">
                        <td class="text-dim mono-xs" style="white-space:nowrap">{{ new Date(u.timestamp).toLocaleString() }}</td>
                        <td style="font-style:italic">"{{ u.text }}"</td>
                        <td class="mono-xs text-dim" style="font-size:10px">{{ u.sessionId || '-' }}</td>
                        <td class="text-dim">{{ u.localeId || '-' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <!-- ── METRICS tab ─────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'metrics'" style="flex:1;overflow:auto;padding:12px">
              <div v-if="lexMetricsModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('detail.loadingMetrics') }}</div>
              <div v-else-if="lexMetricsModal.error" class="alert-error" style="margin:12px">{{ lexMetricsModal.error }}</div>
              <div v-else>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                  <select v-model="lexMetricsModal.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                    <option :value="6">{{ t('awsv.last6h') }}</option>
                    <option :value="24">{{ t('awsv.last24h') }}</option>
                    <option :value="72">{{ t('awsv.last3d') }}</option>
                    <option :value="168">{{ t('awsv.last7d') }}</option>
                  </select>
                  <select v-model="lexMetricsModal.localeId" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
                    <option value="">{{ t('awsv.allLocales') }}</option>
                    <option v-for="locale in lexMetricsModal.locales" :key="locale.localeId" :value="locale.localeId">{{ locale.localeName || locale.localeId }}</option>
                  </select>
                  <button class="btn sm" @click="reloadLexMetrics(true)" :disabled="lexMetricsModal.loading">{{ t('action.refresh') }}</button>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                    <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">{{ t('awsv.runtimeRequests') }}</div>
                    <div v-if="!lexMetricsModal.metrics.RuntimeRequestCount?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">{{ t('state.empty') }}</div>
                    <div v-else>
                      <div style="font-size:28px;font-weight:700;margin-bottom:4px">{{ lexMetricsTotal('RuntimeRequestCount') }}</div>
                      <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                        <div v-for="(p, i) in lexMetricsSparkline('RuntimeRequestCount')" :key="i"
                          :style="`flex:1;background:#6366f1;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                      </div>
                    </div>
                  </div>
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                    <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">{{ t('awsv.missedUtterances') }}</div>
                    <div v-if="!lexMetricsModal.metrics.MissedUtteranceCount?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">{{ t('state.empty') }}</div>
                    <div v-else>
                      <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#f87171">{{ lexMetricsTotal('MissedUtteranceCount') }}</div>
                      <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                        <div v-for="(p, i) in lexMetricsSparkline('MissedUtteranceCount')" :key="i"
                          :style="`flex:1;background:#ef4444;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                      </div>
                    </div>
                  </div>
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                    <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">{{ t('awsv.avgLatencyMs') }}</div>
                    <div v-if="!lexMetricsModal.metrics.RuntimeSuccessfulRequestLatency?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">{{ t('state.empty') }}</div>
                    <div v-else>
                      <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#4ade80">{{ lexMetricsAvg('RuntimeSuccessfulRequestLatency') }}ms</div>
                      <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                        <div v-for="(p, i) in lexMetricsSparkline('RuntimeSuccessfulRequestLatency')" :key="i"
                          :style="`flex:1;background:#22c55e;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                      </div>
                    </div>
                  </div>
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
                    <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">{{ t('awsv.pollyTtsErrors') }}</div>
                    <div v-if="!lexMetricsModal.metrics.RuntimePollyErrors?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">{{ t('state.empty') }}</div>
                    <div v-else>
                      <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#fb923c">{{ lexMetricsTotal('RuntimePollyErrors') }}</div>
                      <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                        <div v-for="(p, i) in lexMetricsSparkline('RuntimePollyErrors')" :key="i"
                          :style="`flex:1;background:#f97316;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:12px">
                  <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">{{ t('awsv.buildBot') }}</div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <select v-model="lexMetricsModal.buildLocale" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text)">
                      <option v-for="loc in lexMetricsModal.locales" :key="loc.localeId" :value="loc.localeId">{{ loc.localeName || loc.localeId }}</option>
                    </select>
                    <button class="btn sm" style="background:rgba(99,102,241,.18);border-color:#6366f1;color:#6366f1"
                      :disabled="lexMetricsModal.building || !lexMetricsModal.buildLocale"
                      @click="doBuildLexBot">{{ lexMetricsModal.building ? t('awsv.lit.building') : t('awsv.lit.buildButton') }}</button>
                    <span v-if="lexMetricsModal.buildResult" :class="lexMetricsModal.buildResult.status === 'Built' ? 'status-ok' : 'status-err'">
                      {{ lexMetricsModal.buildResult.status }}
                      <span v-if="lexMetricsModal.buildResult.failureReasons?.length" class="text-dim" style="font-size:11px"> — {{ lexMetricsModal.buildResult.failureReasons.join('; ') }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <!-- ── TEST SET tab ────────────────────────────────────────── -->
            <div v-show="lexPanel.innerTab === 'testset'" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
              <div style="display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
                <button :class="['btn','xs', lexTestSetModal.activeView === 'existing' ? 'active' : '']" @click="lexTestSetModal.activeView = 'existing'">{{ t('awsv.existingTestSets') }}</button>
                <button :class="['btn','xs', lexTestSetModal.activeView === 'generate' ? 'active' : '']" @click="lexTestSetModal.activeView = 'generate'">{{ t('awsv.generateFromIntents') }}</button>
              </div>
              <div v-if="lexTestSetModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">{{ t('state.loading') }}</div>
              <div v-else-if="lexTestSetModal.error" class="alert-error" style="margin:12px">{{ lexTestSetModal.error }}</div>
              <div v-else style="flex:1;overflow:auto;padding:12px">
                <div v-if="lexTestSetModal.activeView === 'existing'">
                  <div v-if="!lexTestSetModal.testSets.length" style="text-align:center;padding:32px;color:var(--text-dim)">
                    <div style="font-size:28px;margin-bottom:8px">📂</div>
                    <div>{{ t('awsv.noTestSetsFoundForThis') }}</div>
                    <div style="font-size:12px;margin-top:4px">{{ t('awsv.useTheGenerateFromIntentsTab') }}</div>
                  </div>
                  <table v-else class="cloud-table">
                    <thead><tr><th>{{ t('th.name') }}</th><th>{{ t('th.status') }}</th><th>Turns</th><th>{{ t('awsv.modality') }}</th><th>{{ t('awsv.lastUpdated') }}</th></tr></thead>
                    <tbody>
                      <tr v-for="ts in lexTestSetModal.testSets" :key="ts.id">
                        <td>
                          <div style="font-weight:600">{{ ts.name }}</div>
                          <div v-if="ts.description" class="text-dim" style="font-size:11px">{{ ts.description }}</div>
                          <div class="mono-xs text-dim">{{ ts.id }}</div>
                        </td>
                        <td><span :class="/READY|COMPLETED/.test(ts.status) ? 'status-ok' : /FAILED/.test(ts.status) ? 'status-err' : 'status-warn'">{{ ts.status }}</span></td>
                        <td class="text-dim">{{ ts.numTurns || '-' }}</td>
                        <td class="text-dim">{{ ts.modality || '-' }}</td>
                        <td class="text-dim" style="white-space:nowrap">{{ ts.lastUpdated ? formatDate(ts.lastUpdated) : '-' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="lexTestSetModal.activeView === 'generate'">
                  <div v-if="!lexTestSetModal.intentsLoaded" style="text-align:center;padding:24px">
                    <button class="btn sm" style="background:rgba(139,92,246,.18);border-color:#8b5cf6;color:#8b5cf6"
                      @click="lexLoadIntentsForTestSet" :disabled="lexTestSetModal.loadingIntents">
                      {{ lexTestSetModal.loadingIntents ? t('awsv.loadingIntents') : t('awsv.lit.loadIntentsForTests') }}
                    </button>
                  </div>
                  <div v-else>
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                      <span style="font-size:12px;color:var(--text-dim)">{{ t('awsv.testCasesGenerated', { p0: lexTestSetModal.generatedCases.length }) }}</span>
                      <button class="btn xs" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="downloadLexTestSetCsv">{{ t('awsv.downloadCsv') }}</button>
                      <button class="btn xs" style="background:rgba(59,130,246,.18);border-color:#3b82f6;color:#3b82f6" @click="downloadLexTestSetJson">{{ t('awsv.downloadJson') }}</button>
                    </div>
                    <table class="cloud-table" style="font-size:12px">
                      <thead><tr><th>#</th><th>Intent</th><th>Utterance</th><th>{{ t('awsv.expectedSlots') }}</th></tr></thead>
                      <tbody>
                        <tr v-for="(tc, i) in lexTestSetModal.generatedCases" :key="i">
                          <td class="text-dim">{{ i + 1 }}</td>
                          <td style="font-weight:600">{{ tc.intent }}</td>
                          <td style="font-style:italic;color:var(--text-dim)">"{{ tc.utterance }}"</td>
                          <td>
                            <div class="tag-chips">
                              <span v-for="s in tc.expectedSlots" :key="s" class="tag-chip">{{ s }}</span>
                              <span v-if="!tc.expectedSlots.length" class="text-dim">—</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ AgentCore CloudFormation ══════════════════════════════════════ -->
      <div v-show="activeTab === 'agentcorecfn'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredAgentCoreCfn.length" class="empty-row">{{ search.agentcorecfn ? t('awsv.lit.noMatches') : t('awsv.lit.noAgentCore') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('cfn.colStack') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('th.status') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
            <th :class="thClass('createdTime')" :aria-sort="ariaSort('createdTime')"><button type="button" class="th-sort" @click="sortBy('createdTime')">{{ t('th.created') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('createdTime') }}</span></button></th>
            <th :class="thClass('updatedTime')" :aria-sort="ariaSort('updatedTime')"><button type="button" class="th-sort" @click="sortBy('updatedTime')">{{ t('th.updated') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('updatedTime') }}</span></button></th>
            <th>Stack ID</th>
          </tr></thead>
          <tbody>
            <tr v-for="s in sortRows(filteredAgentCoreCfn)" :key="s.id">
              <td>
                <div>{{ s.name }}</div>
                <div v-if="s.templateDescription" class="text-dim" style="font-size:11px">{{ s.templateDescription }}</div>
              </td>
              <td><span :class="/COMPLETE$/.test(s.status) ? 'status-ok' : /FAILED|ROLLBACK/.test(s.status) ? 'status-err' : 'status-warn'">{{ s.status }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ s.createdTime ? formatDate(s.createdTime) : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ s.updatedTime ? formatDate(s.updatedTime) : '-' }}</td>
              <td class="text-dim mono-xs" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="s.id">{{ s.id }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ CloudFront ═════════════════════════════════════════════════════ -->
      <!-- ══ Elastic Load Balancing ═════════════════════════════════════════ -->
      <div v-show="activeTab === 'elb'" class="tab-panel">
        <AwsLoadBalancersTab
          :search="search.elb"
          :attention-only="incidentFocus === 'elb'"
          :application-id="applicationId"
          :profile-id="selectedProfileId"
          :adding-resource-id="addingLoadBalancerId"
          @request-access="activityAccess = $event"
          @add-to-application="addLoadBalancerToApplication"
        />
      </div>

      <div v-show="activeTab === 'cloudfront'" class="tab-panel">
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
          <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="cfCreateModal.open = true; cfCreateModal.result = null; cfCreateModal.error = null">{{ t('awsv.createFromS3') }}</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredCloudfront.length" class="empty-row">{{ search.cloudfront ? t('awsv.lit.noMatches') : t('awsv.lit.noCloudfront') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('domainName')" :aria-sort="ariaSort('domainName')"><button type="button" class="th-sort" @click="sortBy('domainName')">{{ t('vercel.col.domain') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('domainName') }}</span></button></th>
            <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('th.status') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
            <th :class="thClass('enabled')" :aria-sort="ariaSort('enabled')"><button type="button" class="th-sort" @click="sortBy('enabled')">{{ t('apm.enabled') }}</button></th>
            <th :class="thClass('priceClass')" :aria-sort="ariaSort('priceClass')"><button type="button" class="th-sort" @click="sortBy('priceClass')">Price Class <span class="sort-icon" aria-hidden="true">{{ sortIcon('priceClass') }}</span></button></th>
            <th>Aliases</th>
            <th>{{ t('awsv.origins') }}</th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="d in sortRows(filteredCloudfront)" :key="d.id">
              <td>
                <div class="mono-xs">{{ d.domainName }}</div>
                <div v-if="d.comment" class="text-dim" style="font-size:11px">{{ d.comment }}</div>
              </td>
              <td><span :class="d.status === 'Deployed' ? 'status-ok' : 'status-warn'">{{ d.status }}</span></td>
              <td><span :class="d.enabled ? 'status-ok' : 'status-err'">{{ d.enabled ? t('common.yes') : t('common.no') }}</span></td>
              <td class="text-dim">{{ d.priceClass }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="a in (d.aliases || [])" :key="a" class="tag-chip">{{ a }}</span>
                  <span v-if="!(d.aliases || []).length" class="text-dim">-</span>
                </div>
              </td>
              <td class="text-dim">
                <div v-for="o in (d.origins || [])" :key="o.id" class="mono-xs" style="font-size:11px">{{ o.domain }}</div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openInvalidateModal(d)">{{ t('awsv.invalidate') }}</button>
                  <button class="btn sm" @click="openConfig('cloudfront', `CF: ${d.domainName}`, d, { id: d.id })">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" style="background:rgba(99,102,241,0.2);border-color:#6366f1" @click="openCfStats(d)">{{ t('awsv.stats') }}</button>
                  <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="openSiteUrl('https://' + (d.aliases?.[0] || d.domainName))" :title="t('awsv.openSite')">{{ t('aws.visitSite') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Route 53 ═══════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'route53'" class="tab-panel">
        <div style="display:flex;gap:8px;height:100%;overflow:hidden">
          <!-- Zones list -->
          <div style="width:320px;flex-shrink:0;overflow:auto;border-right:1px solid var(--border)">
            <div class="text-dim" style="padding:6px 10px;font-size:11px;font-weight:600;text-transform:uppercase">Hosted Zones</div>
            <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
            <div v-else-if="!filteredRoute53.length" class="empty-row">{{ t('awsv.noZones') }}</div>
            <div v-for="z in filteredRoute53" :key="z.id"
              :class="['sidebar-item', { active: route53State.selectedZoneId === z.id }]"
              style="cursor:pointer;padding:6px 12px" role="button" tabindex="0" :aria-current="route53State.selectedZoneId === z.id ? 'true' : undefined"
              @click="loadRoute53Records(z)" @keydown.enter.prevent="loadRoute53Records(z)" @keydown.space.prevent="loadRoute53Records(z)">
              <div>{{ z.name }}</div>
              <div class="text-dim mono-xs">{{ t('awsv.zoneRecords', { n: z.recordCount, kind: z.private ? t('awsv.zonePrivate') : t('awsv.zonePublic') }) }}</div>
            </div>
          </div>
          <!-- Records -->
          <div style="flex:1;overflow:auto;display:flex;flex-direction:column">
            <!-- Toolbar: Search + Filter + Export -->
            <div v-if="route53State.selectedZoneId && route53State.records.length" style="flex-shrink:0;padding:8px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <input v-model="route53State.search" type="text" :placeholder="t('awsv.searchByNameOrValue')" style="flex:1;min-width:180px;padding:4px 8px;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:inherit;font-size:.85rem" />
              <select v-model="route53State.selectedRecordType" style="padding:4px 8px;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:inherit;font-size:.85rem">
                <option :value="null">{{ t('awsv.allTypes') }}</option>
                <option v-for="type in route53RecordTypes" :key="type" :value="type">{{ type }}</option>
              </select>
              <button v-if="filteredRoute53Records.length" @click="selectAllVisibleRecords" style="padding:4px 10px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:.85rem" :title="t('awsv.selectAllVisible')">{{ t('awsv.selectAll') }}</button>
              <button v-if="route53State.selectedRecords.size" @click="clearRecordSelection" style="padding:4px 10px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:.85rem" :title="t('table.clearSelection')">{{ t('term.clear') }}</button>
              <button v-if="route53State.selectedRecords.size || filteredRoute53Records.length" @click="exportRoute53Records" style="padding:4px 10px;background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.35);border-radius:4px;cursor:pointer;font-size:.85rem;color:#58a6ff" :title="t('awsv.exportSelectedRecordsAsCsv')">{{ t('action.export') }}</button>
              <span v-if="route53State.selectedRecords.size" style="font-size:.8rem;color:#8b949e">{{ t('awsv.selected', { p0: route53State.selectedRecords.size }) }}</span>
            </div>
            <!-- Records Table -->
            <div style="flex:1;overflow:auto">
              <div v-if="route53State.loadingRecords" class="empty-row">{{ t('awsv.loadingRecords') }}</div>
              <div v-else-if="!route53State.selectedZoneId" class="empty-row">{{ t('awsv.selectAZoneToViewIts') }}</div>
              <div v-else-if="!route53State.records.length" class="empty-row">{{ t('awsv.noRecordsInThisZone') }}</div>
              <div v-else-if="!filteredRoute53Records.length" class="empty-row">{{ t('awsv.noRecordsMatchTheSearchOr') }}</div>
              <table v-else class="cloud-table">
                <thead><tr>
                  <th style="width:30px"><input type="checkbox" :title="t('awsv.selectAllVisible')" :checked="allVisibleRoute53Selected" @change="e => e.target.checked ? selectAllVisibleRecords() : clearVisibleRecordSelection()"></th>
                  <th>{{ t('th.name') }}</th><th>{{ t('th.type') }}</th><th>TTL</th><th>{{ t('awsv.valueAlias') }}</th><th>{{ t('awsv.dnsTest') }}</th>
                </tr></thead>
                <tbody>
                  <tr v-for="r in filteredRoute53Records" :key="route53RecordKey(r)">
                    <td><input type="checkbox" :checked="route53State.selectedRecords.has(route53RecordKey(r))" @change="toggleRecordSelection(r)"></td>
                    <td class="mono-xs">
                      {{ route53DisplayName(r.name) }}
                      <span v-if="r.setIdentifier" class="text-dim" style="font-size:.72rem;margin-left:4px" :title="'Set ID: ' + r.setIdentifier">[{{ r.setIdentifier }}]</span>
                    </td>
                    <td><span class="tag-chip">{{ r.type }}</span></td>
                    <td class="text-dim">{{ r.ttl ?? '-' }}</td>
                    <td class="text-dim mono-xs" style="word-break:break-all">
                      <span v-if="r.alias">{{ r.alias.dnsName }}</span>
                      <span v-else>{{ (r.records || []).join(', ') }}</span>
                    </td>
                    <td style="min-width:150px;max-width:280px">
                      <span v-if="!route53TestsFor(r).length" class="text-dim" style="font-size:.75rem">—</span>
                      <div v-for="testItem in route53TestsFor(r)" :key="testItem.id" style="margin:2px 0">
                        <span v-if="route53State.testing[route53TestKey(r, testItem)]" style="font-size:.78rem;color:#8b949e">{{ t('awsv.testing', { p0: testItem.label }) }}</span>
                        <template v-else-if="route53State.testResults[route53TestKey(r, testItem)]">
                          <button :title="route53ResultTitle(testItem, route53State.testResults[route53TestKey(r, testItem)])"
                            :style="{ padding: '1px 7px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '.75rem', fontWeight: 600, ...route53StatusStyle(route53State.testResults[route53TestKey(r, testItem)].status) }"
                            @click="testRoute53Record(r, testItem)">{{ testItem.label }}: {{ route53State.testResults[route53TestKey(r, testItem)].status }} ↺</button>
                          <div style="font-size:.72rem;color:#8b949e;margin-top:2px;word-break:break-word">{{ route53State.testResults[route53TestKey(r, testItem)].message }}</div>
                        </template>
                        <button v-else @click="testRoute53Record(r, testItem)" style="padding:2px 8px;background:transparent;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:.78rem;color:#58a6ff">{{ t('awsv.test', { p0: testItem.label }) }}</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ Cognito ════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'cognito'" class="tab-panel">
        <div style="display:flex;gap:0;height:100%;overflow:hidden">
          <!-- User Pool list -->
          <div style="width:280px;flex-shrink:0;overflow:auto;border-right:1px solid var(--border);display:flex;flex-direction:column">
            <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
              <span class="text-dim" style="font-size:11px;font-weight:600;text-transform:uppercase">User Pools</span>
            </div>
            <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
            <div v-else-if="!filteredCognito.length" class="empty-row">{{ t('awsv.noUserPools') }}</div>
            <div v-for="p in filteredCognito" :key="p.id"
              :class="['sidebar-item', { active: cognitoState.selectedPool?.id === p.id }]"
              style="cursor:pointer;padding:8px 12px" role="button" tabindex="0" :aria-current="cognitoState.selectedPool?.id === p.id ? 'true' : undefined"
              @click="loadCognitoPool(p)" @keydown.enter.prevent="loadCognitoPool(p)" @keydown.space.prevent="loadCognitoPool(p)">
              <div style="font-weight:500">{{ p.name }}</div>
              <div class="text-dim mono-xs">{{ t('awsv.usersMfa', { p0: p.userCount?.toLocaleString() ?? '?', p1: p.mfaConfig }) }}</div>
              <div class="text-dim mono-xs" style="font-size:10px">{{ p.id }}</div>
            </div>
          </div>
          <!-- Right panel: tabbed detail for selected pool -->
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div v-if="!cognitoState.selectedPool" class="empty-row" style="align-self:center;margin-top:60px">{{ t('awsv.selectAUserPool') }}</div>
            <template v-else>
              <!-- Inner tab bar -->
              <div style="display:flex;gap:0;border-bottom:1px solid var(--border);padding:0 12px;flex-shrink:0;align-items:center">
                <button v-for="tabItem in cognitoInnerTabs" :key="tabItem.id"
                  :class="['aws-tab-btn', { active: cognitoState.innerTab === tabItem.id }]"
                  style="margin-right:4px"
                  @click="cognitoState.innerTab = tabItem.id">{{ tabItem.label }}</button>
                <div style="flex:1"/>
                <button class="btn sm" style="margin:4px 0" @click="openCreateCognitoUser">{{ t('awsv.createUser') }}</button>
              </div>
              <!-- ── Users tab ─────────────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'users'" style="flex:1;overflow:auto;padding:8px">
                <!-- Search + filter bar -->
                <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
                  <input class="search-input" v-model="cognitoState.userFilter"
                    :placeholder="t('awsv.filterByEmailUsername')" style="flex:1"
                    @keydown.enter="applyUserFilter" />
                  <button class="btn sm" @click="applyUserFilter">{{ t('aws.search') }}</button>
                  <button class="btn sm" v-if="cognitoState.userFilter" @click="clearUserFilter">{{ t('term.clear') }}</button>
                </div>
                <div v-if="cognitoState.loadingUsers" class="empty-row">{{ t('awsv.loadingUsers') }}</div>
                <div v-else-if="!cognitoState.users.length" class="empty-row">{{ t('awsv.noUsersFound') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>{{ t('awsv.username') }}</th><th>{{ t('ses.type_email') }}</th><th>{{ t('th.status') }}</th><th>MFA</th><th>{{ t('apm.enabled') }}</th><th>{{ t('th.created') }}</th><th>{{ t('th.actions') }}</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="u in cognitoState.users" :key="u.username">
                      <td class="mono-xs" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">
                        <span style="cursor:pointer;color:var(--accent)" @click="openUserDetail(u)">{{ u.username }}</span>
                      </td>
                      <td class="text-dim">{{ u.email || '-' }}</td>
                      <td><span :class="u.status === 'CONFIRMED' ? 'status-ok' : 'status-warn'">{{ u.status }}</span></td>
                      <td>
                        <span :class="u.mfaEnabled ? 'status-ok' : 'text-dim'">{{ u.mfaEnabled ? 'ON' : 'off' }}</span>
                      </td>
                      <td><span :class="u.enabled ? 'status-ok' : 'status-err'">{{ u.enabled ? t('common.yes') : t('common.no') }}</span></td>
                      <td class="text-dim" style="white-space:nowrap">{{ u.created ? formatDate(u.created) : '-' }}</td>
                      <td>
                        <div class="row-actions">
                          <button class="btn sm" @click="openUserDetail(u)" :title="t('action.view')">{{ t('awsv.detail') }}</button>
                          <button class="btn sm" @click="doCognitoResetPassword(u)" :title="t('awsv.sendResetEmail')">{{ t('awsv.resetPwd2') }}</button>
                          <button class="btn sm" v-if="u.enabled" @click="doCognitoDisable(u)">{{ t('awsv.disable') }}</button>
                          <button class="btn sm" v-else @click="doCognitoEnable(u)">{{ t('awsv.enable') }}</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <!-- Pagination -->
                <div v-if="cognitoState.paginationToken || cognitoState.prevTokens?.length" style="display:flex;gap:8px;margin-top:8px;justify-content:center">
                  <button class="btn sm" :disabled="!cognitoState.prevTokens?.length" @click="cognitoPrevPage">{{ t('awsv.prev') }}</button>
                  <span class="text-dim" style="line-height:28px;font-size:12px">{{ t('awsv.page', { p0: (cognitoState.prevTokens?.length || 0) + 1 }) }}</span>
                  <button class="btn sm" :disabled="!cognitoState.paginationToken" @click="cognitoNextPage">{{ t('awsv.next') }}</button>
                </div>
              </div>
              <!-- ── App Clients tab ───────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'clients'" style="flex:1;overflow:auto;padding:8px">
                <div v-if="cognitoState.loadingClients" class="empty-row">{{ t('awsv.loadingClients') }}</div>
                <div v-else-if="!cognitoState.clients.length" class="empty-row">{{ t('awsv.noAppClients') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>{{ t('awsv.clientName') }}</th><th>Client ID</th><th>Auth Flows</th><th>OAuth Flows</th><th>Callback URLs</th><th>{{ t('awsv.tokenValidity') }}</th><th>{{ t('detail.secret') }}</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="c in cognitoState.clients" :key="c.clientId">
                      <td style="font-weight:500">{{ c.clientName }}</td>
                      <td class="mono-xs text-dim">{{ c.clientId }}</td>
                      <td class="text-dim" style="font-size:11px">{{ (c.explicitAuthFlows || []).join(', ') || '-' }}</td>
                      <td class="text-dim" style="font-size:11px">{{ (c.allowedOAuthFlows || []).join(', ') || '-' }}</td>
                      <td class="text-dim" style="font-size:11px;max-width:200px;word-break:break-all">{{ (c.callbackURLs || []).join(', ') || '-' }}</td>
                      <td class="text-dim" style="font-size:11px">
                        <div v-if="c.accessTokenValidity">{{ t('awsv.accessH', { p0: c.accessTokenValidity }) }}</div>
                        <div v-if="c.refreshTokenValidity">{{ t('awsv.refreshD', { p0: c.refreshTokenValidity }) }}</div>
                      </td>
                      <td><span :class="c.hasSecret ? 'status-warn' : 'text-dim'">{{ c.hasSecret ? t('common.yes') : t('common.no') }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- ── Identity Providers tab ───────────────────── -->
              <div v-show="cognitoState.innerTab === 'idps'" style="flex:1;overflow:auto;padding:8px">
                <div v-if="cognitoState.loadingIdps" class="empty-row">{{ t('awsv.loadingIdentityProviders') }}</div>
                <div v-else-if="!cognitoState.idps.length" class="empty-row">{{ t('awsv.noFederatedIdentityProvidersConfigured') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>{{ t('awsv.providerName') }}</th><th>{{ t('th.type') }}</th><th>{{ t('awsv.issuerMetadata') }}</th><th>{{ t('awsv.attributeMapping') }}</th><th>{{ t('awsDashboards.colModified') }}</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="p in cognitoState.idps" :key="p.providerName">
                      <td style="font-weight:500">{{ p.providerName }}</td>
                      <td class="text-dim">{{ p.providerType }}</td>
                      <td class="text-dim mono-xs" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="p.issuer || p.metadataURL">{{ p.issuer || p.metadataURL || '-' }}</td>
                      <td class="text-dim" style="font-size:11px">{{ Object.entries(p.attributeMapping || {}).map(([k,v]) => `${k}→${v}`).join(', ') || '-' }}</td>
                      <td class="text-dim" style="white-space:nowrap">{{ p.lastModifiedDate ? formatDate(p.lastModifiedDate) : '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- ── Groups tab ──────────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'groups'" style="flex:1;overflow:auto;padding:8px">
                <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
                  <button class="btn sm" style="margin:4px 0" @click="openCreateCognitoGroup">{{ t('awsv.createGroup') }}</button>
                </div>
                <div v-if="cognitoState.loadingGroups" class="empty-row">{{ t('awsv.loadingGroups') }}</div>
                <div v-else-if="!cognitoState.groups.length" class="empty-row">{{ t('awsv.noGroupsInThisUserPool') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>{{ t('awsv.groupName') }}</th><th>{{ t('th.description') }}</th><th>{{ t('awsv.precedence') }}</th><th>Role ARN</th><th>{{ t('awsDashboards.colModified') }}</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="g in cognitoState.groups" :key="g.name">
                      <td style="font-weight:500">{{ g.name }}</td>
                      <td class="text-dim">{{ g.description || '-' }}</td>
                      <td class="text-dim">{{ g.precedence ?? '-' }}</td>
                      <td class="text-dim mono-xs" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="g.roleArn">{{ g.roleArn || '-' }}</td>
                      <td class="text-dim" style="white-space:nowrap">{{ g.lastModified ? formatDate(g.lastModified) : '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- ── Pool Config tab ─────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'config'" style="flex:1;overflow:auto;padding:12px">
                <div v-if="cognitoState.loadingConfig" class="empty-row">{{ t('awsv.loadingConfiguration') }}</div>
                <div v-else-if="!cognitoState.poolConfig" class="empty-row">{{ t('awsv.noConfigurationLoaded') }}</div>
                <div v-else style="display:flex;flex-direction:column;gap:14px">

                  <!-- Header badges -->
                  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                    <span style="font-size:13px;font-weight:600">{{ cognitoState.poolConfig.Name }}</span>
                    <span class="mono-xs text-dim" style="font-size:10px">{{ cognitoState.poolConfig.Id }}</span>
                    <span :class="cognitoState.poolConfig.Status === 'Active' ? 'status-ok' : 'status-warn'" style="font-size:11px">{{ cognitoState.poolConfig.Status }}</span>
                    <span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);color:var(--text-dim)">MFA: {{ cognitoState.poolConfig.MfaConfiguration }}</span>
                    <span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);color:var(--text-dim)">{{ t('awsv.users', { p0: cognitoState.poolConfig.EstimatedNumberOfUsers?.toLocaleString() }) }}</span>
                    <span v-if="cognitoState.poolConfig.Domain" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(124,158,248,.12);color:var(--accent)">{{ t('awsv.domain', { p0: cognitoState.poolConfig.Domain }) }}</span>
                  </div>

                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                    <!-- Password Policy -->
                    <div class="config-section">
                      <div class="config-title">{{ t('awsv.passwordPolicy') }}</div>
                      <template v-if="cognitoState.poolConfig.Policies?.PasswordPolicy">
                        <div class="config-row">
                          <span>{{ t('awsv.minimumLength') }}</span>
                          <span style="font-weight:600">{{ cognitoState.poolConfig.Policies.PasswordPolicy.MinimumLength }}</span>
                        </div>
                        <div class="config-row">
                          <span>{{ t('awsv.requirements') }}</span>
                          <div style="display:flex;gap:4px;flex-wrap:wrap">
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireUppercase" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">A-Z</span>
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireLowercase" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">a-z</span>
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireNumbers" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">0-9</span>
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireSymbols" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">!@#</span>
                          </div>
                        </div>
                        <div class="config-row"><span>{{ t('awsv.temporaryPasswordValidDays') }}</span><span>{{ cognitoState.poolConfig.Policies.PasswordPolicy.TemporaryPasswordValidityDays }}</span></div>
                      </template>
                    </div>

                    <!-- Auto-verified + Dates -->
                    <div class="config-section">
                      <div class="config-title">{{ t('awsv.verificationDates') }}</div>
                      <div class="config-row"><span>{{ t('awsv.verifiedAttributes') }}</span><span class="text-dim">{{ (cognitoState.poolConfig.AutoVerifiedAttributes || []).join(', ') || 'none' }}</span></div>
                      <div class="config-row"><span>{{ t('awsv.allowedAliases') }}</span><span class="text-dim">{{ (cognitoState.poolConfig.AliasAttributes || []).join(', ') || '-' }}</span></div>
                      <div class="config-row"><span>{{ t('res.created') }}</span><span class="text-dim">{{ cognitoState.poolConfig.CreationDate ? formatDate(cognitoState.poolConfig.CreationDate) : '-' }}</span></div>
                      <div class="config-row"><span>{{ t('lmd.modified') }}</span><span class="text-dim">{{ cognitoState.poolConfig.LastModifiedDate ? formatDate(cognitoState.poolConfig.LastModifiedDate) : '-' }}</span></div>
                    </div>
                  </div>

                  <!-- Schema Attributes -->
                  <div class="config-section">
                    <div class="config-title">{{ t('awsv.schemaAttributes', { p0: (cognitoState.poolConfig.SchemaAttributes || []).length }) }}</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;margin-top:4px">
                      <div v-for="attr in (cognitoState.poolConfig.SchemaAttributes || [])" :key="attr.Name"
                        style="border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:11px">
                        <div style="font-weight:600;margin-bottom:2px">{{ attr.Name }}</div>
                        <div class="text-dim" style="font-size:10px">{{ attr.AttributeDataType }}{{ attr.Required ? t('awsv.lit.requiredSuffix') : '' }}{{ attr.Mutable === false ? t('awsv.lit.immutableSuffix') : '' }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Lambda Triggers -->
                  <div class="config-section">
                    <div class="config-title">Lambda Triggers</div>
                    <div v-if="!cognitoState.poolConfig.LambdaConfig || !Object.keys(cognitoState.poolConfig.LambdaConfig).length" class="text-dim" style="padding:4px 0;font-size:12px">{{ t('awsv.noTriggersConfigured') }}</div>
                    <div v-else style="display:flex;flex-direction:column;gap:4px">
                      <div v-for="(arn, trigger) in cognitoState.poolConfig.LambdaConfig" :key="trigger"
                        style="display:flex;gap:10px;align-items:center;padding:4px 6px;border-radius:4px;background:var(--bg-row)">
                        <span style="font-size:11px;color:var(--accent);font-weight:500;min-width:160px">{{ trigger }}</span>
                        <span class="mono-xs text-dim" style="word-break:break-all;font-size:10px">{{ arn }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- ══ Secrets Manager ════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'secrets'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!filteredSecrets.length" class="empty-row">{{ search.secrets ? t('awsv.lit.noMatches') : t('awsv.lit.noSecrets') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsv.secretName') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('rotationEnabled')" :aria-sort="ariaSort('rotationEnabled')"><button type="button" class="th-sort" @click="sortBy('rotationEnabled')">{{ t('awsv.rotation') }}</button></th>
            <th :class="thClass('lastChanged')" :aria-sort="ariaSort('lastChanged')"><button type="button" class="th-sort" @click="sortBy('lastChanged')">{{ t('awsv.lastChanged') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('lastChanged') }}</span></button></th>
            <th>ARN</th>
            <th>{{ t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="s in sortRows(filteredSecrets)" :key="s.arn">
              <td>
                <div style="font-weight:500">{{ s.name.split('/').pop() }}</div>
                <div v-if="s.name.includes('/')" class="text-dim mono-xs" style="font-size:10px">{{ s.name }}</div>
                <div v-if="s.description" class="text-dim" style="font-size:11px;margin-top:1px">{{ s.description }}</div>
              </td>
              <td><span :class="s.rotationEnabled ? 'status-ok' : 'text-dim'">{{ s.rotationEnabled ? t('res.enabled') : t('awsv.lit.off') }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ s.lastChanged ? formatDate(s.lastChanged) : '-' }}</td>
              <td class="mono-xs text-dim" style="font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="s.arn">{{ s.arn }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openSecretConfig(s)">{{ t('sidebar.config') }}</button>
                  <button class="btn sm" @click="openSecretIntegration(s)">{{ t('awsv.integrate') }}</button>
                  <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e"
                    @click="openImportSecret(s)">{{ t('awsv.importToEnv') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="activeTab === 'cloudformation'" class="tab-panel">
        <AwsCfnTab :key="selectedProfileId" :profile-id="selectedProfileId" @request-access="activityAccess = $event" @open-resource="openResourceFromStack" @open-application="emit('open-observability', $event)" />
      </div>

      <div v-if="activeTab === 'cwlogs'" class="tab-panel">
        <AwsLogsTab :key="selectedProfileId" :profile-id="selectedProfileId" @request-access="activityAccess = $event" />
      </div>

      <div v-show="activeTab === 'cwdashboards'" class="tab-panel">
        <CloudWatchDashboardView v-if="dashboardView" :name="dashboardView" @back="dashboardView = null" />
        <template v-else>
        <div v-if="awsStore.loading" class="empty-row">{{ t('common.loading') }}</div>
        <div v-else-if="!filteredCwDashboards.length" class="empty-row">{{ search.cwdashboards ? t('awsDashboards.noMatches') : t('awsDashboards.empty') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('awsDashboards.colName') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
            <th :class="thClass('lastModified')" :aria-sort="ariaSort('lastModified')"><button type="button" class="th-sort" @click="sortBy('lastModified')">{{ t('awsDashboards.colModified') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('lastModified') }}</span></button></th>
            <th :class="thClass('size')" :aria-sort="ariaSort('size')"><button type="button" class="th-sort" @click="sortBy('size')">{{ t('awsDashboards.colSize') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('size') }}</span></button></th>
            <th>{{ t('awsDashboards.colActions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="d in sortRows(filteredCwDashboards)" :key="d.arn || d.name">
              <td><a class="cw-dash-name" href="#" @click.prevent="dashboardView = d.name">{{ d.name }}</a></td>
              <td class="text-dim" style="white-space:nowrap">{{ d.lastModified ? formatDate(d.lastModified) : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ d.size != null ? `${(d.size / 1024).toFixed(1)} KB` : '-' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm primary" @click="dashboardView = d.name">{{ t('awsDashboards.view') }}</button>
                  <button class="btn sm" @click="dashboardDetail = d.name">{{ t('awsDashboards.details') }}</button>
                  <a class="btn sm" :href="d.consoleUrl" target="_blank" rel="noopener noreferrer">{{ t('awsDashboards.openConsole') }}</a>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <CloudWatchDashboardDetail :show="!!dashboardDetail" :name="dashboardDetail || ''" @close="dashboardDetail = null" />
        </template>
      </div>

    </template>

    <!-- ── Create S3 Bucket Modal ─────────────────────────────────────────── -->
    <div v-if="createS3Modal.open" class="modal-overlay" @click.self="createS3Modal.open = false">
      <div class="modal" v-dialog="() => (createS3Modal.open = false)" style="width:480px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">{{ t('awsv.createS3Bucket') }}</span>
          <button class="btn sm" @click="createS3Modal.open = false" :aria-label="t('action.close')" :title="t('action.close')">✕</button>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.bucketName') }} <span style="color:#f85149">*</span></label>
            <input v-model="createS3Modal.name" type="text" placeholder="my-bucket-name"
              style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:13px;box-sizing:border-box" />
            <div style="font-size:11px;color:var(--text-dim);margin-top:3px">{{ t('awsv.363CharsLowercaseLettersNumbers') }}</div>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('th.region') }}</label>
            <select v-model="createS3Modal.region"
              style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:13px">
              <option value="us-east-1">us-east-1 (N. Virginia)</option>
              <option value="us-east-2">us-east-2 (Ohio)</option>
              <option value="us-west-1">us-west-1 (N. California)</option>
              <option value="us-west-2">us-west-2 (Oregon)</option>
              <option value="eu-west-1">{{ t('awsv.euWest1Ireland') }}</option>
              <option value="eu-west-2">{{ t('awsv.euWest2London') }}</option>
              <option value="eu-west-3">{{ t('awsv.euWest3Paris') }}</option>
              <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
              <option value="eu-north-1">{{ t('awsv.euNorth1Stockholm') }}</option>
              <option value="ap-southeast-1">{{ t('awsv.apSoutheast1Singapore') }}</option>
              <option value="ap-southeast-2">{{ t('awsv.apSoutheast2Sydney') }}</option>
              <option value="ap-northeast-1">{{ t('awsv.apNortheast1Tokyo') }}</option>
              <option value="ap-northeast-2">{{ t('awsv.apNortheast2Seoul') }}</option>
              <option value="ap-south-1">ap-south-1 (Mumbai)</option>
              <option value="sa-east-1">sa-east-1 (São Paulo)</option>
              <option value="ca-central-1">{{ t('awsv.caCentral1Canada') }}</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="s3BlockPublic" v-model="createS3Modal.blockPublicAccess" />
            <label for="s3BlockPublic" style="font-size:12px;cursor:pointer">{{ t('awsv.blockAllPublicAccess') }} <span style="color:var(--text-dim)">{{ t('awsv.recommended') }}</span></label>
          </div>
          <div v-if="createS3Modal.error" class="alert-error" style="margin:0">{{ createS3Modal.error }}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
            <button class="btn sm" @click="createS3Modal.open = false">{{ t('action.cancel') }}</button>
            <button class="btn sm" :disabled="createS3Modal.loading || !createS3Modal.name.trim()"
              style="background:rgba(80,200,120,.2);border-color:#50c878;color:#50c878"
              @click="doCreateS3Bucket">{{ createS3Modal.loading ? t('awsv.lit.creating') : t('awsv.lit.createBucket') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── ECR Deploy to K8s Modal ────────────────────────────────────────── -->
    <div v-if="ecrDeployModal.open" class="modal-overlay" @click.self="ecrDeployModal.open = false">
      <div class="modal" v-dialog="() => (ecrDeployModal.open = false)" style="width:760px;max-width:97vw;max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">{{ t('awsv.deployToKubernetes', { p0: ecrDeployModal.repoName }) }}</span>
          <button class="btn sm" @click="ecrDeployModal.open = false" :aria-label="t('action.close')" :title="t('action.close')">✕</button>
        </div>
        <div style="padding:12px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px">
          <!-- Image tag selector -->
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.imageTag') }}</label>
            <div v-if="ecrDeployModal.loadingImages" style="font-size:12px;color:var(--text-dim)">{{ t('awsv.loadingImages') }}</div>
            <select v-else v-model="ecrDeployModal.selectedTag"
              style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:13px">
              <option value="">{{ t('awsv.selectATag') }}</option>
              <optgroup v-for="img in ecrDeployModal.images" :key="img.digest" :label="img.digest.slice(7,19)">
                <option v-for="tag in (img.tags.length ? img.tags : ['<untagged>'])" :key="tag" :value="tag === '<untagged>' ? img.digest : tag">
                  {{ tag }} {{ img.pushedAt ? `· ${formatDate(img.pushedAt)}` : '' }}
                </option>
              </optgroup>
            </select>
          </div>
          <!-- Deployment params -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.appName') }} <span style="color:#f85149">*</span></label>
              <input v-model="ecrDeployModal.appName" type="text" placeholder="my-app"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('th.namespace') }}</label>
              <input v-model="ecrDeployModal.namespace" type="text" :placeholder="t('gri.defaultValue')"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('th.replicas') }}</label>
              <input v-model.number="ecrDeployModal.replicas" type="number" min="1" max="20"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.containerPort') }}</label>
              <input v-model.number="ecrDeployModal.port" type="number" min="1" max="65535" placeholder="8080"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.k8sContext') }} <span style="color:var(--text-dim)">{{ t('conn.optional') }}</span></label>
              <input v-model="ecrDeployModal.context" type="text" :placeholder="t('awsv.useCurrentContext')"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Image Pull Secret <span style="color:var(--text-dim)">{{ t('conn.optional') }}</span></label>
              <input v-model="ecrDeployModal.pullSecret" type="text" placeholder="ecr-secret"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
          </div>
          <!-- Service creation option -->
          <div style="display:flex;align-items:center;gap:12px;padding:8px 10px;background:rgba(88,166,255,.06);border:1px solid rgba(88,166,255,.2);border-radius:6px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text,#ccc);user-select:none">
              <input type="checkbox" v-model="ecrDeployModal.createService" style="cursor:pointer" />
              {{ t('awsv.alsoCreateA') }} <strong>{{ t('pf.service') }}</strong>
            </label>
            <template v-if="ecrDeployModal.createService">
              <span style="font-size:12px;color:var(--text-dim)">{{ t('awsv.type') }}</span>
              <select v-model="ecrDeployModal.serviceType"
                style="background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:4px 8px;font-size:12px">
                <option>ClusterIP</option>
                <option>NodePort</option>
                <option>{{ t('quick.loadBalancer') }}</option>
              </select>
              <span v-if="!ecrDeployModal.port" style="font-size:11px;color:#f85149">{{ t('awsv.requiresAContainerPort') }}</span>
            </template>
          </div>
          <!-- YAML Preview -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label style="font-size:12px;color:var(--text-dim)">{{ t('awsv.generatedManifest') }}</label>
              <button class="btn sm" @click="copyEcrManifest">{{ t('awsv.copyYaml') }}</button>
            </div>
            <pre style="background:var(--bg-input,#161b22);border:1px solid var(--border,#444);border-radius:4px;padding:10px;font-size:11px;overflow:auto;max-height:220px;margin:0;white-space:pre;color:var(--text,#ccc)">{{ ecrDeployYaml }}</pre>
          </div>
          <!-- Apply result -->
          <div v-if="ecrDeployModal.applyResult" :class="ecrDeployModal.applyResult.success ? 'alert-success' : 'alert-error'" style="margin:0;white-space:pre-wrap;font-size:11px;font-family:monospace">{{ ecrDeployModal.applyResult.stdout || ecrDeployModal.applyResult.stderr }}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
            <button class="btn sm" @click="ecrDeployModal.open = false">{{ t('action.close') }}</button>
            <button class="btn sm" :disabled="!ecrDeployModal.appName || !ecrDeployModal.selectedTag || ecrDeployModal.applying"
              style="background:rgba(124,158,248,.2);border-color:#7c9ef8;color:#7c9ef8"
              @click="doApplyEcrToK8s">{{ ecrDeployModal.applying ? t('awsv.lit.applying') : t('awsv.lit.applyToK8s') }}</button>
          </div>
        </div>
      </div>
    </div>


    <div v-if="configModal.open" class="modal-overlay" @click.self="configModal.open = false">
      <div class="modal" v-dialog="() => (configModal.open = false)" style="width:900px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
            {{ configModal.title }}
          </span>
          <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
            <div class="btn-toggle-group">
              <button :class="['btn','sm', configModal.view === 'json' ? 'active' : '']" @click="configModal.view = 'json'">JSON</button>
              <button :class="['btn','sm', configModal.view === 'yaml' ? 'active' : '']" @click="configModal.view = 'yaml'">YAML</button>
            </div>
            <button class="btn sm" @click="fetchFullConfig" :disabled="configModal.loading">
              {{ configModal.fullLoaded ? t('awsv.lit.refetch') : t('awsv.lit.fullConfig') }}
            </button>
            <button class="btn sm" @click="copyConfig">{{ t('action.copy') }}</button>
          </div>
        </div>
        <div v-if="configModal.error" class="alert-error" style="margin:0;flex-shrink:0">{{ configModal.error }}</div>
        <pre class="config-pre">{{ configDisplay }}</pre>
      </div>
    </div>

    <div v-if="logsModal.open" class="modal-overlay" @click.self="logsModal.open = false">
      <div class="modal" v-dialog="() => (logsModal.open = false)" style="width:860px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
            <span v-if="logsModal.logGroupName" class="text-dim mono-xs" style="margin-left:8px">{{ logsModal.logGroupName }}</span>
          </span>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            <select v-model="logsModal.minutes" class="ctrl-select" @change="reloadLogs" style="font-size:12px;padding:2px 6px">
              <option :value="15">{{ t('awsv.last15Min') }}</option>
              <option :value="60">{{ t('awsv.last1H') }}</option>
              <option :value="360">{{ t('awsLogs.history.6h') }}</option>
              <option :value="1440">{{ t('awsLogs.history.24h') }}</option>
            </select>
            <button class="btn sm" @click="reloadLogs">{{ t('action.refresh') }}</button>
          </div>
        </div>
        <div v-if="logsModal.loading" class="empty-row">{{ t('awsv.loadingLogs') }}</div>
        <div v-else-if="logsModal.error" class="alert-error">{{ logsModal.error }}</div>
        <div v-else-if="!logsModal.events.length" class="empty-row">{{ t('awsv.noLogEventsInSelectedRange') }}</div>
        <div v-else class="logs-viewer">
          <div v-for="(ev, idx) in logsModal.events" :key="idx" class="log-line">
            <span class="log-ts">{{ formatTs(ev.timestamp) }}</span>
            <span class="log-msg">{{ ev.message }}</span>
          </div>
        </div>
      </div>
    </div>

    <GcpConfirmModal
      :open="opConfirm.open"
      :title="opConfirm.title"
      :message="opConfirm.message"
      :lines="opConfirmLines"
      :tone="opConfirm.tone"
      :confirm-label="opConfirm.confirmLabel"
      :busy="opConfirm.busy"
      :error="opConfirm.error"
      @confirm="confirmOperation"
      @cancel="opConfirm.open = false"
    />

    <div v-if="invokeModal.open" class="modal-overlay" @click.self="invokeModal.open = false">
      <div class="modal" v-dialog="() => (invokeModal.open = false)" style="width:600px;max-width:95vw" role="dialog" aria-modal="true" aria-labelledby="aws-invoke-title">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span id="aws-invoke-title" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            {{ t('awsv.invokeTitle', { name: invokeModal.name }) }}
          </span>
          <button class="btn sm" :aria-label="t('action.close')" :title="t('action.close')" @click="invokeModal.open = false">✕</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div class="alert-warn" style="margin:0;font-size:12px">{{ t('awsv.invokeWarning', { profile: selectedProfileName, account: contextAccount ?? '…', region: awsStore.accountContext ? (awsStore.accountContext.region || t('awsv.op.unknown')) : '…' }) }}</div>
          <label for="aws-invoke-payload" style="font-size:12px;color:var(--text-dim)">{{ t('awsv.jsonPayloadOptional') }}</label>
          <textarea id="aws-invoke-payload" v-model="invokeModal.payload" rows="6"
            style="font-family:monospace;font-size:12px;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:8px;resize:vertical"
            placeholder="{}"></textarea>
          <div v-if="invokeModal.result" class="logs-viewer" style="max-height:220px">
            <div v-if="invokeModal.result.functionError" class="alert-error" style="margin:0 0 4px 0">
              FunctionError: {{ invokeModal.result.functionError }}
            </div>
            <pre style="margin:0;font-size:11px;white-space:pre-wrap">{{ JSON.stringify(invokeModal.result.payload, null, 2) }}</pre>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitInvoke" :disabled="invokeModal.loading">
              {{ invokeModal.loading ? t('awsv.invoking') : t('awsv.invokeAction') }}
            </button>
            <button class="btn sm" @click="invokeModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- EventBridge Rule Logs Modal -->
    <div v-if="ebLogsModal.open" class="modal-overlay" @click.self="ebLogsModal.open = false">
      <div class="modal" v-dialog="() => (ebLogsModal.open = false)" style="width:min(840px,96vw);max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            {{ t('awsv.logsMetrics', { p0: ebLogsModal.ruleName }) }}
          </span>
          <div style="display:flex;gap:6px;align-items:center">
            <select v-model.number="ebLogsModal.minutes" class="ctrl-select" style="font-size:12px" @change="reloadEbLogs">
              <option :value="15">{{ t('awsv.last15Min') }}</option>
              <option :value="60">{{ t('awsv.last1H') }}</option>
              <option :value="360">{{ t('awsLogs.history.6h') }}</option>
              <option :value="1440">{{ t('awsLogs.history.24h') }}</option>
              <option :value="4320">{{ t('awsv.last3D') }}</option>
              <option :value="10080">{{ t('awsv.last7D') }}</option>
            </select>
            <button class="btn sm" @click="reloadEbLogs" :disabled="ebLogsModal.loading">{{ t('action.refresh') }}</button>
            <button class="btn sm" @click="ebLogsModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div style="flex:1;min-height:0;overflow-y:auto;padding:14px">
          <EventBridgeLogs
            :data="ebLogsModal.data"
            :loading="ebLogsModal.loading"
            :error="ebLogsModal.error"
            :minutes="ebLogsModal.minutes"
            :bus-name="ebLogsModal.busName"
            :rule-name="ebLogsModal.ruleName"
          />
        </div>
      </div>
    </div>

    <!-- EventBridge Rule Details Modal -->
    <div v-if="ebDetailsModal.open" class="modal-overlay" @click.self="ebDetailsModal.open = false">
      <div class="modal" v-dialog="() => (ebDetailsModal.open = false)" style="width:min(860px,96vw);max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            EventBridge &mdash; {{ ebDetailsModal.name }}
          </span>
          <div style="display:flex;gap:6px;align-items:center">
            <span v-if="ebDetailsModal.state" :class="ebDetailsModal.state === 'ENABLED' ? 'status-ok' : 'status-err'" style="font-size:11px;font-weight:600">{{ ebDetailsModal.state }}</span>
            <button class="btn sm" @click="ebDetailsModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div style="flex:1;min-height:0;overflow-y:auto;padding:14px">
          <EventBridgeDetail
            :rule="ebDetailsModal.rule"
            :targets="ebDetailsModal.targets"
            :loading="ebDetailsModal.loading"
            :error="ebDetailsModal.error"
          />
        </div>
      </div>
    </div>

    <!-- Step Functions Diagram Modal -->
    <div v-if="diagramModal.open" class="modal-overlay" @click.self="diagramModal.open = false">
      <div class="modal" v-dialog="() => (diagramModal.open = false)" style="width:min(900px,96vw);height:min(680px,90vh);display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            {{ t('awsv.stepFunctionDiagram', { p0: diagramModal.name }) }}
          </span>
          <div style="display:flex;gap:6px;align-items:center">
            <span v-if="diagramModal.type" class="tag-chip" style="font-size:11px;padding:2px 8px">{{ diagramModal.type }}</span>
            <button class="btn sm" @click="diagramModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div style="flex:1;min-height:0;padding:10px;display:flex;flex-direction:column">
          <div v-if="diagramModal.loading" class="empty-row">{{ t('awsv.loadingDefinition') }}</div>
          <div v-else-if="diagramModal.error" class="alert-error">{{ diagramModal.error }}</div>
          <StepFnDiagram v-else :definition="diagramModal.definition" style="flex:1;min-height:0" />
        </div>
      </div>
    </div>

    <div v-if="remoteSessions.length" class="remote-session-dock">
      <div
        v-for="session in remoteSessions"
        :key="session.id"
        :class="['remote-session-tab', session.type, { active: session.open }]"
        role="button"
        tabindex="0"
        :title="sessionTitle(session)"
        @click="showRemoteSession(session.id)"
        @keydown.enter.prevent="showRemoteSession(session.id)"
        @keydown.space.prevent="showRemoteSession(session.id)"
      >
        <span class="remote-session-dot"></span>
        <span class="remote-session-kind">{{ session.type.toUpperCase() }}</span>
        <span class="remote-session-name">{{ session.instance?.name || session.instance?.id }}</span>
        <button class="remote-session-close" :title="t('awsv.closeConnection')" @click.stop="removeRemoteSession(session.id)">x</button>
      </div>
    </div>

    <!-- EC2 remote sessions stay mounted so hiding a tab does not close SSH/RDP -->
    <Ec2Shell
      v-for="session in sshSessions"
      :key="session.id"
      :open="session.open"
      :instance="session.instance"
      :environment="props.environment"
      :application-id="props.applicationId"
      @close="session.open = false"
    />
    <Ec2Rdp
      v-for="session in rdpSessions"
      :key="session.id"
      :open="session.open"
      :instance="session.instance"
      @close="session.open = false"
    />
    <Ec2Detail    :open="ec2DetailModal.open" :instance="ec2DetailModal.instance" :profile-id="selectedProfileId" @close="ec2DetailModal.open = false" />
    <LambdaDetail :open="lambdaDetailModal.open" :fn="lambdaDetailModal.fn" :profile-id="selectedProfileId" @close="lambdaDetailModal.open = false" />
    <VpcDetail    :open="vpcDetailModal.open" :vpc="vpcDetailModal.vpc" @close="vpcDetailModal.open = false" />
    <EksDetail    :open="eksDetailModal.open" :cluster="eksDetailModal.cluster" @close="eksDetailModal.open = false" />
    <StepFnDetail :open="stepFnDetailModal.open" :sm="stepFnDetailModal.sm" :profile-id="selectedProfileId" @close="stepFnDetailModal.open = false" />

    <!-- API Gateway Routes & Integrations Modal -->
    <ApiGwIntegrations
      :open="apigwRoutesModal.open"
      :api-name="apigwRoutesModal.name"
      :api-type="apigwRoutesModal.apiType"
      :loading="apigwRoutesModal.loading"
      :error="apigwRoutesModal.error"
      :integrations="apigwRoutesModal.integrations"
      @close="apigwRoutesModal.open = false"
    />

    <!-- S3 Browser Modal -->
    <S3Browser
      :open="s3BrowserModal.open"
      :bucket="s3BrowserModal.bucket"
      :profile-id="selectedProfileId"
      :region="s3BrowserModal.region"
      @close="s3BrowserModal.open = false"
    />

    <!-- Tags Modal -->
    <div v-if="tagsModal.open" class="modal-overlay" @click.self="tagsModal.open = false">
      <div class="modal" v-dialog="() => (tagsModal.open = false)" style="width:620px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">Tags — {{ tagsModal.title }}</span>
          <button class="btn sm" @click="tagsModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div v-if="tagsModal.loading" class="empty-row">{{ t('state.loading') }}</div>
          <div v-else>
            <table class="cloud-table" style="margin-bottom:8px">
              <thead><tr><th>{{ t('vercel.col.key') }}</th><th>{{ t('vercel.col.value') }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(tag, idx) in tagsModal.tags" :key="idx">
                  <td><input v-model="tag.Key" class="ctrl-input" style="width:100%;font-size:12px" /></td>
                  <td><input v-model="tag.Value" class="ctrl-input" style="width:100%;font-size:12px" /></td>
                  <td>
                    <button class="btn sm danger" @click="removeTagRow(idx)">x</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <button class="btn sm" @click="addTagRow">{{ t('awsv.addTag') }}</button>
          </div>
          <div v-if="tagsModal.error" class="alert-error">{{ tagsModal.error }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="saveTags" :disabled="tagsModal.saving">{{ t('awsv.saveTags') }}</button>
            <button class="btn sm" @click="tagsModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- CloudWatch Logging Modal -->
    <div v-if="loggingModal.open" class="modal-overlay" @click.self="loggingModal.open = false">
      <div class="modal" v-dialog="() => (loggingModal.open = false)" style="width:500px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">{{ t('awsv.enableCloudwatchLogs', { p0: loggingModal.title }) }}</span>
          <button class="btn sm" @click="loggingModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:12px">
          <div v-if="loggingModal.service === 'lambda'" style="display:flex;flex-direction:column;gap:8px">
            <label style="font-size:12px;color:var(--text-dim)">{{ t('awsv.logFormat') }}</label>
            <div class="btn-toggle-group">
              <button :class="['btn','sm', loggingModal.logFormat === 'Text' ? 'active' : '']"
                @click="loggingModal.logFormat = 'Text'">{{ t('awsDashboards.typeText') }}</button>
              <button :class="['btn','sm', loggingModal.logFormat === 'JSON' ? 'active' : '']"
                @click="loggingModal.logFormat = 'JSON'">JSON</button>
            </div>
            <div class="text-dim mono-xs" style="margin-top:2px">
              Log group: /aws/lambda/{{ loggingModal.name }}
            </div>
          </div>
          <div v-if="loggingModal.service === 'ecs'" style="display:flex;flex-direction:column;gap:8px">
            <label style="font-size:12px;color:var(--text-dim)">{{ t('awsv.logPrefixContainerStreamPrefix') }}</label>
            <input v-model="loggingModal.logPrefix" class="ctrl-input" style="font-size:12px" />
            <div class="text-dim mono-xs">Log group: /ecs/{{ loggingModal.cluster }}/{{ loggingModal.logPrefix }}</div>
            <div class="alert-error" style="font-size:11px;margin:0">
              {{ t('awsv.thisWillRegisterANewTask') }} <strong>awslogs</strong> {{ t('awsv.driverAndUpdateTheService') }}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label style="font-size:12px;color:var(--text-dim)">{{ t('awsv.logRetentionDays') }}</label>
            <select v-model.number="loggingModal.retentionDays" class="ctrl-select" style="font-size:12px">
              <option :value="7">{{ t('awsv.7Days') }}</option>
              <option :value="14">{{ t('awsv.14Days') }}</option>
              <option :value="30">{{ t('awsv.30Days') }}</option>
              <option :value="60">{{ t('awsv.60Days') }}</option>
              <option :value="90">{{ t('awsv.90Days') }}</option>
              <option :value="180">{{ t('awsv.180Days') }}</option>
              <option :value="365">{{ t('awsv.1Year') }}</option>
            </select>
          </div>
          <div v-if="loggingModal.error" class="alert-error">{{ loggingModal.error }}</div>
          <div v-if="loggingModal.result" class="alert-success">
            {{ t('awsv.loggingEnabledLogGroup') }} <span class="mono-xs">{{ loggingModal.result.logGroup }}</span>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitLogging" :disabled="loggingModal.loading">
              {{ loggingModal.loading ? t('awsv.lit.enabling') : t('awsv.lit.enableLogging') }}
            </button>
            <button class="btn sm" @click="loggingModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Glue Job Runs Modal -->
    <div v-if="glueRunsModal.open" class="modal-overlay" @click.self="glueRunsModal.open = false">
      <div class="modal" v-dialog="() => (glueRunsModal.open = false)" style="width:720px;max-width:96vw;max-height:82vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">{{ t('awsv.recentRuns', { p0: glueRunsModal.job?.name }) }}</span>
          <button class="btn sm" @click="glueRunsModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div v-if="glueRunsModal.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="!glueRunsModal.runs.length" class="empty-row">{{ t('awsv.noRecentRunsFound') }}</div>
        <table v-else class="cloud-table" style="overflow:auto;flex:1">
          <thead><tr><th>Run ID</th><th>{{ t('th.status') }}</th><th>{{ t('awsv.started') }}</th><th>{{ t('vercel.col.completedAt') }}</th><th>{{ t('awsv.durationS') }}</th><th>{{ t('awsLogs.sync_error') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in glueRunsModal.runs" :key="r.id">
              <td class="mono-xs">{{ r.id }}</td>
              <td><span :class="r.status === 'SUCCEEDED' ? 'status-ok' : r.status === 'RUNNING' ? 'status-warn' : 'status-err'">{{ r.status }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ r.startedOn ? formatDate(r.startedOn) : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ r.completedOn ? formatDate(r.completedOn) : '-' }}</td>
              <td class="text-dim">{{ r.executionTime ?? '-' }}</td>
              <td class="text-dim" style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.errorMessage">{{ r.errorMessage || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- CloudFront Invalidation Modal -->
    <div v-if="invalidateModal.open" class="modal-overlay" @click.self="invalidateModal.open = false">
      <div class="modal" v-dialog="() => (invalidateModal.open = false)" style="width:500px;max-width:96vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">{{ t('awsv.createInvalidation', { p0: invalidateModal.dist?.domainName }) }}</span>
          <button class="btn sm" @click="invalidateModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <label style="font-size:12px;color:var(--text-dim)">{{ t('awsv.pathsToInvalidateOnePerLine') }}</label>
          <textarea v-model="invalidateModal.paths" rows="4" class="ctrl-input"
            style="font-family:monospace;font-size:12px" placeholder="/*" />
          <div v-if="invalidateModal.error" class="alert-error">{{ invalidateModal.error }}</div>
          <div v-if="invalidateModal.result" class="alert-success">{{ invalidateModal.result }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitInvalidation" :disabled="invalidateModal.loading">
              {{ invalidateModal.loading ? t('awsv.lit.creating') : t('awsv.invalidate') }}
            </button>
            <button class="btn sm" @click="invalidateModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- CloudFront Stats Modal -->
    <div v-if="cfStatsModal.open" class="modal-overlay" @click.self="cfStatsModal.open = false">
      <div class="modal" v-dialog="() => (cfStatsModal.open = false)" style="width:min(740px,96vw);max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">{{ t('awsv.cloudfrontStats', { p0: cfStatsModal.domainName }) }}</span>
          <button class="btn sm" @click="cfStatsModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="flex:1;min-height:0;overflow-y:auto;padding:14px">
          <div v-if="cfStatsModal.loading" class="empty-row">{{ t('awsv.loadingStatsFromCloudwatch') }}</div>
          <div v-else-if="cfStatsModal.error" class="alert-error">{{ cfStatsModal.error }}</div>
          <div v-else-if="cfStatsModal.data" style="display:flex;flex-direction:column;gap:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">{{ t('awsv.requestsLast7Days') }}</div>
                <div v-if="!cfStatsModal.data.requests.length" class="text-dim" style="font-size:12px;padding:8px">{{ t('state.empty') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>{{ t('awsv.date') }}</th><th>{{ t('awsInsights.requests') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="pt in cfStatsModal.data.requests" :key="pt.date">
                      <td class="text-dim mono-xs">{{ formatDate(pt.date) }}</td>
                      <td>{{ pt.value?.toLocaleString() }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="config-section">
                <div class="config-title">{{ t('awsv.bytesDownloadedLast7Days') }}</div>
                <div v-if="!cfStatsModal.data.bytesDownloaded.length" class="text-dim" style="font-size:12px;padding:8px">{{ t('state.empty') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>{{ t('awsv.date') }}</th><th>Bytes</th></tr></thead>
                  <tbody>
                    <tr v-for="pt in cfStatsModal.data.bytesDownloaded" :key="pt.date">
                      <td class="text-dim mono-xs">{{ formatDate(pt.date) }}</td>
                      <td>{{ formatBytes(pt.value) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">{{ t('awsv.4xxErrorRate') }}</div>
                <div v-if="!cfStatsModal.data.errorRate4xx.length" class="text-dim" style="font-size:12px;padding:8px">{{ t('state.empty') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>{{ t('awsv.date') }}</th><th>{{ t('awsv.rate') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="pt in cfStatsModal.data.errorRate4xx" :key="pt.date">
                      <td class="text-dim mono-xs">{{ formatDate(pt.date) }}</td>
                      <td :style="pt.value > 5 ? 'color:#f87171' : ''">{{ pt.value?.toFixed(2) }}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="config-section">
                <div class="config-title">{{ t('awsv.5xxErrorRate') }}</div>
                <div v-if="!cfStatsModal.data.errorRate5xx.length" class="text-dim" style="font-size:12px;padding:8px">{{ t('state.empty') }}</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>{{ t('awsv.date') }}</th><th>{{ t('awsv.rate') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="pt in cfStatsModal.data.errorRate5xx" :key="pt.date">
                      <td class="text-dim mono-xs">{{ formatDate(pt.date) }}</td>
                      <td :style="pt.value > 1 ? 'color:#f87171' : ''">{{ pt.value?.toFixed(2) }}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div v-else class="text-dim" style="padding:16px">{{ t('awsv.noStatsAvailable') }}</div>
        </div>
      </div>
    </div>

    <!-- CloudFront Create from S3 Modal -->
    <div v-if="cfCreateModal.open" class="modal-overlay" @click.self="cfCreateModal.open = false">
      <div class="modal" v-dialog="() => (cfCreateModal.open = false)" style="width:540px;max-width:96vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">{{ t('awsv.createCloudfrontDistributionFromS3') }}</span>
          <button class="btn sm" @click="cfCreateModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.s3Bucket') }}</label>
            <select v-model="cfCreateModal.bucketName" class="ctrl-select" style="width:100%">
              <option value="">{{ t('awsv.selectBucket') }}</option>
              <option v-for="b in awsStore.s3Buckets" :key="b.name" :value="b.name">{{ b.name }} ({{ b.region }})</option>
            </select>
          </div>
          <div v-if="cfCreateModal.bucketName">
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.bucketRegion') }}</label>
            <input v-model="cfCreateModal.region" class="ctrl-input" style="width:100%" placeholder="us-east-1" />
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.commentOptional') }}</label>
            <input v-model="cfCreateModal.comment" class="ctrl-input" style="width:100%" :placeholder="t('awsv.myDistribution')" />
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Price Class</label>
            <select v-model="cfCreateModal.priceClass" class="ctrl-select" style="width:100%">
              <option value="PriceClass_100">PriceClass_100 (US, CA, EU)</option>
              <option value="PriceClass_200">{{ t('awsv.priceclass200AsiaAfricaMe') }}</option>
              <option value="PriceClass_All">{{ t('awsv.priceclassAllAllEdgeLocations') }}</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">{{ t('awsv.customAliasesOnePerLineOptional') }}</label>
            <textarea v-model="cfCreateModal.aliases" rows="3" class="ctrl-input"
              style="font-family:monospace;font-size:12px;width:100%" placeholder="www.example.com" />
          </div>
          <div v-if="cfCreateModal.error" class="alert-error">{{ cfCreateModal.error }}</div>
          <div v-if="cfCreateModal.result" class="alert-success">
            {{ t('awsv.createdDomain') }} <span class="mono-xs">{{ cfCreateModal.result.domainName }}</span>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitCfCreate" :disabled="cfCreateModal.loading || !cfCreateModal.bucketName">
              {{ cfCreateModal.loading ? t('awsv.lit.creating') : t('awsv.lit.createDistribution') }}
            </button>
            <button class="btn sm" @click="cfCreateModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Secret Config Modal ═══════════════════════════════════════════════ -->
    <div v-if="secretConfigModal.open" class="modal-overlay" @click.self="secretConfigModal.open = false">
      <div class="modal-box" v-dialog="() => (secretConfigModal.open = false)" style="width:640px;max-width:98vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:14px">{{ secretConfigModal.secret?.name?.split('/').pop() }}</div>
            <div class="text-dim mono-xs" style="font-size:10px">{{ secretConfigModal.secret?.name }}</div>
          </div>
          <button class="btn sm" @click="secretConfigModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div v-if="secretConfigModal.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="secretConfigModal.error" class="alert-error">{{ secretConfigModal.error }}</div>
        <div v-else-if="secretConfigModal.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="config-section">
              <div class="config-title">{{ t('observability.general') }}</div>
              <div class="config-row"><span>{{ t('awsv.rotation') }}</span>
                <span :class="secretConfigModal.data.rotationEnabled ? 'status-ok' : 'text-dim'">{{ secretConfigModal.data.rotationEnabled ? t('res.enabled') : t('awsv.lit.off') }}</span>
              </div>
              <div class="config-row"><span>KMS Key</span><span class="mono-xs text-dim" style="font-size:10px;word-break:break-all">{{ secretConfigModal.data.kmsKeyId || t('awsv.lit.defaultSecretsKey') }}</span></div>
              <div class="config-row"><span>{{ t('awsv.lastRotation') }}</span><span class="text-dim">{{ secretConfigModal.data.lastRotatedDate ? formatDate(secretConfigModal.data.lastRotatedDate) : '-' }}</span></div>
              <div class="config-row"><span>{{ t('awsv.lastChange') }}</span><span class="text-dim">{{ secretConfigModal.data.lastChangedDate ? formatDate(secretConfigModal.data.lastChangedDate) : '-' }}</span></div>
            </div>
            <div class="config-section">
              <div class="config-title">{{ t('awsv.versions', { p0: (secretConfigModal.data.versionIds || []).length }) }}</div>
              <div v-for="v in (secretConfigModal.data.versionIds || []).slice(0, 8)" :key="v"
                class="mono-xs text-dim" style="font-size:10px;padding:2px 0;border-bottom:1px solid var(--border)">{{ v }}</div>
            </div>
          </div>
          <div v-if="secretConfigModal.data.rotationLambdaArn" class="config-section">
            <div class="config-title">{{ t('awsv.rotationLambda') }}</div>
            <div class="config-row"><span>ARN</span><span class="mono-xs text-dim" style="font-size:10px;word-break:break-all">{{ secretConfigModal.data.rotationLambdaArn }}</span></div>
          </div>
          <div v-if="secretConfigModal.data.tags?.length" class="config-section">
            <div class="config-title">Tags ({{ secretConfigModal.data.tags.length }})</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
              <span v-for="tagEntry in secretConfigModal.data.tags" :key="tagEntry.Key"
                style="font-size:10px;padding:1px 8px;border-radius:4px;background:var(--bg-row);border:1px solid var(--border)">
                {{ tagEntry.Key }}: <span style="color:var(--accent)">{{ tagEntry.Value }}</span>
              </span>
            </div>
          </div>
          <div class="config-section">
            <div class="config-title">{{ t('awsv.fullArn') }}</div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
              <span class="mono-xs text-dim" style="font-size:10px;word-break:break-all;flex:1">{{ secretConfigModal.data.arn }}</span>
              <button class="btn sm" @click="copyText(secretConfigModal.data.arn)">{{ t('action.copy') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Secret Integration Examples Modal ═════════════════════════════════ -->
    <div v-if="secretIntegrationModal.open" class="modal-overlay" @click.self="secretIntegrationModal.open = false">
      <div class="modal-box" v-dialog="() => (secretIntegrationModal.open = false)" style="width:780px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:14px">{{ t('awsv.integrationExamples') }}</div>
            <div class="text-dim" style="font-size:11px">{{ secretIntegrationModal.secret?.name }}</div>
          </div>
          <button class="btn sm" @click="secretIntegrationModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <!-- Tabs -->
          <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:8px">
            <button v-for="tab in ['boto3','nodejs','cli','env']" :key="tab"
              :class="['btn','sm', secretIntegrationModal.tab === tab ? 'active' : '']"
              @click="secretIntegrationModal.tab = tab" style="text-transform:uppercase;font-size:11px">
              {{ tab === 'boto3' ? 'Python (boto3)' : tab === 'nodejs' ? 'Node.js' : tab === 'cli' ? 'AWS CLI' : '.env / Docker' }}
            </button>
          </div>

          <!-- Python boto3 -->
          <template v-if="secretIntegrationModal.tab === 'boto3'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">{{ t('awsv.getTheSecretInPython') }}</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.boto3 }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.boto3)">{{ t('action.copy') }}</button>
            </div>
          </template>

          <!-- Node.js -->
          <template v-if="secretIntegrationModal.tab === 'nodejs'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">{{ t('awsv.awsSdkV3ForNodeJs') }}</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.nodejs }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.nodejs)">{{ t('action.copy') }}</button>
            </div>
          </template>

          <!-- CLI -->
          <template v-if="secretIntegrationModal.tab === 'cli'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">AWS CLI:</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.cli }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.cli)">{{ t('action.copy') }}</button>
            </div>
          </template>

          <!-- .env / Docker -->
          <template v-if="secretIntegrationModal.tab === 'env'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">{{ t('awsv.injectAsEnvironmentVariablesDockerEcs') }}</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.env }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.env)">{{ t('action.copy') }}</button>
            </div>
          </template>

          <!-- Nota de IAM -->
          <div style="border-left:3px solid var(--accent);padding:8px 12px;background:rgba(124,158,248,.07);border-radius:0 4px 4px 0;font-size:11px;color:var(--text-dim)">
            <div style="font-weight:600;margin-bottom:4px;color:var(--text)">{{ t('awsv.requiredIamPermissions') }}</div>
            <div>{{ t('awsv.theAccessingIdentityNeeds') }} <code style="color:var(--accent)">secretsmanager:GetSecretValue</code> {{ t('awsv.onTheSecretArn') }}</div>
            <div style="margin-top:4px;font-size:10px;word-break:break-all">ARN: {{ secretIntegrationModal.secret?.arn }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Import Secret to Env Manager Modal (con selección de variables) ══ -->
    <div v-if="importSecretModal.open" class="modal-overlay" @click.self="importSecretModal.open = false">
      <div class="modal-box" v-dialog="() => (importSecretModal.open = false)" style="width:600px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:13px">{{ t('awsv.importToEnvManager') }}</div>
            <div class="text-dim" style="font-size:11px">{{ importSecretModal.secret?.name }}</div>
          </div>
          <button class="btn sm" @click="importSecretModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px">

          <!-- Step 1: destino -->
          <div class="config-section" style="margin:0">
            <div class="config-title">{{ t('awsv.envManagerDestination') }}</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <button :class="['btn','sm', importSecretModal.mode === 'new' ? 'active' : '']" @click="importSecretModal.mode = 'new'">{{ t('awsv.newProfile') }}</button>
              <button :class="['btn','sm', importSecretModal.mode === 'existing' ? 'active' : '']" @click="importSecretModal.mode = 'existing'">{{ t('awsv.existingProfile') }}</button>
            </div>
            <div v-if="importSecretModal.mode === 'new'">
              <label class="field-label">{{ t('awsv.profileName') }}
                <input v-model="importSecretModal.profileName" class="ctrl-input" :placeholder="t('awsv.myProfile')" />
              </label>
            </div>
            <div v-else>
              <label class="field-label">{{ t('awsv.targetProfile') }}
                <select v-model="importSecretModal.targetProfileId" class="ctrl-input ctrl-select">
                  <option value="">{{ t('awsv.selectAProfile') }}</option>
                  <option v-for="p in envProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
            </div>
          </div>

          <!-- Step 2: selección de variables -->
          <div class="config-section" style="margin:0">
            <div class="config-title" style="display:flex;align-items:center;justify-content:space-between">
              <span>{{ t('awsv.secretVariables') }}</span>
              <div style="display:flex;gap:4px">
                <button class="btn sm" @click="importSecretModal.selectedKeys = [...(importSecretModal.previewKeys || [])]" style="font-size:10px">{{ t('awsv.selectAll2') }}</button>
                <button class="btn sm" @click="importSecretModal.selectedKeys = []" style="font-size:10px">{{ t('awsv.none') }}</button>
              </div>
            </div>
            <div v-if="importSecretModal.loadingKeys" class="empty-row" style="border:none;border-radius:0">{{ t('awsv.loadingVariables') }}</div>
            <div v-else-if="importSecretModal.keysError" class="alert-error" style="margin-top:6px">{{ importSecretModal.keysError }}</div>
            <div v-else-if="!(importSecretModal.previewKeys || []).length" class="text-dim" style="font-size:12px;padding:6px 0">{{ t('awsv.noVariablesFoundInThisSecret') }}</div>
            <div v-else style="display:flex;flex-direction:column;gap:4px;margin-top:8px">
              <div v-for="k in importSecretModal.previewKeys" :key="k.original"
                :style="{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: '5px', border: '1px solid var(--border)', background: importSecretModal.selectedKeys.some(s => s.original === k.original) ? 'rgba(124,158,248,.08)' : 'transparent', cursor: 'pointer' }"
                @click="toggleSecretKey(k)">
                <input type="checkbox" :checked="importSecretModal.selectedKeys.some(s => s.original === k.original)" @click.stop="toggleSecretKey(k)" style="flex-shrink:0" />
                <div style="flex:1;min-width:0">
                  <div class="mono-xs" style="font-size:11px;font-weight:500">{{ k.sanitized }}</div>
                  <div v-if="k.original !== k.sanitized" class="text-dim mono-xs" style="font-size:9px">original: {{ k.original }}</div>
                </div>
                <div class="mono-xs text-dim" style="font-size:10px;flex-shrink:0">{{ k.preview }}</div>
              </div>
            </div>
          </div>

          <div v-if="importSecretModal.error" class="alert-error">{{ importSecretModal.error }}</div>
          <div v-if="importSecretModal.result" style="color:#a6e3a1;font-size:12px;padding:8px;border-radius:4px;background:rgba(166,227,161,.1)">{{ importSecretModal.result }}</div>

          <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:10px">
            <button class="btn sm" @click="importSecretModal.open = false">{{ t('action.cancel') }}</button>
            <button class="btn sm"
              :disabled="importSecretModal.loading || !importSecretModal.selectedKeys.length"
              @click="() => submitImportSecret()">
              {{ importSecretModal.loading ? t('awsv.lit.importing') : `Importar ${importSecretModal.selectedKeys.length} variable(s)` }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Athena Workgroup Config Modal ════════════════════════════════════ -->
    <div v-if="athenaWgInfo.open" class="modal-overlay" @click.self="athenaWgInfo.open = false">
      <div class="modal" v-dialog="() => (athenaWgInfo.open = false)" style="width:660px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Athena Workgroup — {{ athenaWgInfo.wg?.name }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" style="background:rgba(34,197,94,.2);border-color:#22c55e;color:#22c55e" @click="athenaWgInfo.open=false; openAthenaWgQuery(athenaWgInfo.wg)">{{ t('awsLogs.q.modeQuery') }}</button>
            <button class="btn sm" @click="athenaWgInfo.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div v-if="athenaWgInfo.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="athenaWgInfo.error" class="alert-error">{{ athenaWgInfo.error }}</div>
        <div v-else-if="athenaWgInfo.data" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <!-- Status & engine -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            <div class="config-section">
              <div class="config-title">{{ t('res.state') }}</div>
              <span :class="athenaWgInfo.data.state === 'ENABLED' ? 'status-ok' : 'status-err'">{{ athenaWgInfo.data.state }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">{{ t('awsv.engineVersion') }}</div>
              <span class="text-dim">{{ athenaWgInfo.data.effectiveEngineVersion || athenaWgInfo.data.selectedEngineVersion || '—' }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">{{ t('res.created') }}</div>
              <span class="text-dim" style="font-size:11px">{{ athenaWgInfo.data.creationTime ? formatDate(athenaWgInfo.data.creationTime) : '—' }}</span>
            </div>
          </div>
          <!-- Stats -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="config-section">
              <div class="config-title">{{ t('awsv.usageStatistics') }}</div>
              <div class="config-row"><span>{{ t('awsv.totalQueries') }}</span><span class="mono-xs">{{ (athenaWgInfo.data.totalQueryCount || 0).toLocaleString() }}</span></div>
              <div class="config-row"><span>{{ t('awsv.totalBytesScanned') }}</span><span class="mono-xs">{{ athenaWgInfo.data.totalBytesScanned ? formatBytes(athenaWgInfo.data.totalBytesScanned) : '—' }}</span></div>
            </div>
            <div class="config-section">
              <div class="config-title">{{ t('awsv.limits') }}</div>
              <div class="config-row"><span>{{ t('awsv.bytesScannedCutoff') }}</span><span class="mono-xs">{{ athenaWgInfo.data.bytesScannedCutoff ? formatBytes(athenaWgInfo.data.bytesScannedCutoff) : t('lmd.unlimited') }}</span></div>
              <div class="config-row"><span>Requester Pays</span><span :class="athenaWgInfo.data.requesterPays ? 'status-warn' : 'text-dim'">{{ athenaWgInfo.data.requesterPays ? t('common.yes') : t('common.no') }}</span></div>
            </div>
          </div>
          <!-- Output / Encryption -->
          <div class="config-section">
            <div class="config-title">{{ t('awsv.resultsEncryption') }}</div>
            <div class="config-row"><span>{{ t('awsv.outputLocationS3') }}</span><span class="mono-xs" style="font-size:11px;word-break:break-all">{{ athenaWgInfo.data.outputLocation || '—' }}</span></div>
            <div class="config-row"><span>{{ t('sqs.encryption') }}</span><span class="mono-xs">{{ athenaWgInfo.data.encryptionOption || t('awsv.lit.sseS3Default') }}</span></div>
            <div v-if="athenaWgInfo.data.kmsKey" class="config-row"><span>KMS Key</span><span class="mono-xs" style="font-size:10px;word-break:break-all">{{ athenaWgInfo.data.kmsKey }}</span></div>
          </div>
          <!-- Policies -->
          <div class="config-section">
            <div class="config-title">{{ t('awsv.policies') }}</div>
            <div class="config-row"><span>{{ t('awsv.enforceWorkgroupConfig') }}</span><span :class="athenaWgInfo.data.enforceWorkGroupConfig ? 'status-ok' : 'text-dim'">{{ athenaWgInfo.data.enforceWorkGroupConfig ? t('common.yes') : t('common.no') }}</span></div>
            <div class="config-row"><span>{{ t('awsv.publishCloudwatchMetrics') }}</span><span :class="athenaWgInfo.data.publishCloudWatchMetrics ? 'status-ok' : 'text-dim'">{{ athenaWgInfo.data.publishCloudWatchMetrics ? t('common.yes') : t('common.no') }}</span></div>
          </div>
          <!-- Execution Role -->
          <div v-if="athenaWgInfo.data.executionRole" class="config-section">
            <div class="config-title">{{ t('awsv.iamExecutionRole') }}</div>
            <span class="mono-xs" style="font-size:11px;word-break:break-all">{{ athenaWgInfo.data.executionRole }}</span>
          </div>
          <!-- Description -->
          <div v-if="athenaWgInfo.data.description" class="config-section">
            <div class="config-title">{{ t('res.description') }}</div>
            <span class="text-dim">{{ athenaWgInfo.data.description }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Athena Workgroup Query Modal ══════════════════════════════════════ -->
    <div v-if="athenaModal.open" class="modal-overlay" @click.self="athenaModal.open = false">
      <div class="modal" v-dialog="() => (athenaModal.open = false)" style="width:700px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">{{ t('awsv.queryWorkgroup', { p0: athenaModal.workgroup?.name }) }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" @click="athenaModal.open=false; athenaSubTab='editor'; if(athenaModal.workgroup) athenaEditor.selectedWorkgroup = athenaModal.workgroup.name">{{ t('awsv.openInEditor') }}</button>
            <button class="btn sm" @click="athenaModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div style="padding:10px 14px;display:flex;flex-direction:column;gap:10px;flex:1;overflow:hidden">
          <textarea v-model="athenaModal.query" rows="5" class="ctrl-input"
            style="font-family:monospace;font-size:12px;resize:vertical"
            placeholder="SELECT * FROM my_database.my_table LIMIT 10;"></textarea>
          <input v-if="!athenaModal.workgroup?.outputLocation" v-model="athenaModal.outputLocation" class="ctrl-input" type="text"
            :placeholder="t('awsv.s3BucketPathOutputLocationWorkgroup')"
            :title="t('awsv.thisWorkgroupHasNoQueryResult')" />
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn" @click="submitAthenaQuery" :disabled="athenaModal.loading || !athenaModal.query.trim()">
              {{ athenaModal.loading ? t('awsv.lit.running') : t('awsv.lit.runQuery') }}
            </button>
            <span v-if="athenaModal.status" :class="athenaModal.status === 'SUCCEEDED' ? 'status-ok' : athenaModal.status === 'FAILED' ? 'status-err' : 'status-warn'">
              {{ athenaModal.status }}
            </span>
            <span v-if="athenaModal.queryId" class="text-dim mono-xs">ID: {{ athenaModal.queryId }}</span>
          </div>
          <div v-if="athenaModal.error" class="alert-error">{{ athenaModal.error }}</div>
          <div v-if="athenaModal.results" style="overflow:auto;flex:1">
            <table class="cloud-table" style="font-size:11px">
              <thead v-if="athenaModal.results.ResultSetMetadata?.ColumnInfo">
                <tr><th v-for="col in athenaModal.results.ResultSetMetadata.ColumnInfo" :key="col.Name">{{ col.Name }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in (athenaModal.results.Rows || []).slice(1)" :key="ri">
                  <td v-for="(cell, ci) in (row.Data || [])" :key="ci" class="text-dim">{{ cell.VarCharValue ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Athena Catalog Info Modal ════════════════════════════════════════ -->
    <div v-if="athenaCatInfo.open" class="modal-overlay" @click.self="athenaCatInfo.open = false">
      <div class="modal" v-dialog="() => (athenaCatInfo.open = false)" style="width:560px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Data Source — {{ athenaCatInfo.cat?.name }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" style="background:rgba(88,166,255,.15);border-color:#58a6ff;color:#58a6ff"
              @click="athenaCatInfo.open=false; athenaSubTab='editor'; athenaEditor.selectedCatalog = athenaCatInfo.cat?.name || ''">⚡ Editor</button>
            <button class="btn sm" @click="athenaCatInfo.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div v-if="athenaCatInfo.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="athenaCatInfo.error" class="alert-error">{{ athenaCatInfo.error }}</div>
        <div v-else-if="athenaCatInfo.data" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="config-section">
              <div class="config-title">{{ t('res.type') }}</div>
              <span class="tag-chip">{{ athenaCatInfo.data.type }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">{{ t('res.description') }}</div>
              <span class="text-dim">{{ athenaCatInfo.data.description || '—' }}</span>
            </div>
          </div>
          <div v-if="Object.keys(athenaCatInfo.data.parameters || {}).length" class="config-section">
            <div class="config-title">{{ t('awsv.connectionParameters') }}</div>
            <div v-for="(v, k) in athenaCatInfo.data.parameters" :key="k" class="config-row">
              <span class="mono-xs" style="color:var(--text-dim)">{{ k }}</span>
              <span class="mono-xs" style="word-break:break-all;font-size:11px">{{ v }}</span>
            </div>
          </div>
          <div class="config-section">
            <div class="config-title">{{ t('awsv.databases') }}</div>
            <div v-if="!athenaCatInfo.cat?.databases?.length" class="text-dim" style="font-size:11px">—</div>
            <div v-for="db in (athenaCatInfo.cat?.databases || [])" :key="db.name" class="config-row">
              <span class="mono-xs">📁 {{ db.name }}</span>
              <span v-if="db.description" class="text-dim" style="font-size:11px">{{ db.description }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ DynamoDB Create Table Modal ═══════════════════════════════════════ -->
    <div v-if="dynamoCreate.open" class="modal-overlay" @click.self="dynamoCreate.open = false">
      <div class="modal-box" v-dialog="() => (dynamoCreate.open = false)" style="width:560px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">{{ t('awsv.createDynamodbTable') }}</span>
          <button class="btn sm" @click="dynamoCreate.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
          <div>
            <label class="ctrl-label">{{ t('awsv.tableName') }}</label>
            <input v-model="dynamoCreate.tableName" class="ctrl-input" placeholder="my-table" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 100px;gap:8px">
            <div>
              <label class="ctrl-label">Partition Key</label>
              <input v-model="dynamoCreate.partitionKey" class="ctrl-input" placeholder="pk" />
            </div>
            <div>
              <label class="ctrl-label">{{ t('th.type') }}</label>
              <select v-model="dynamoCreate.partitionKeyType" class="ctrl-select">
                <option value="S">S</option>
                <option value="N">N</option>
                <option value="B">B</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 100px;gap:8px">
            <div>
              <label class="ctrl-label">{{ t('awsv.sortKeyOptional') }}</label>
              <input v-model="dynamoCreate.sortKey" class="ctrl-input" placeholder="sk" />
            </div>
            <div>
              <label class="ctrl-label">{{ t('th.type') }}</label>
              <select v-model="dynamoCreate.sortKeyType" class="ctrl-select" style="width:70px">
                <option value="S">S (String)</option>
                <option value="N">N (Number)</option>
                <option value="B">B (Binary)</option>
              </select>
            </div>
          </div>
          <div>
            <label class="ctrl-label">{{ t('awsv.billingMode') }}</label>
            <select v-model="dynamoCreate.billingMode" class="ctrl-select">
              <option value="PAY_PER_REQUEST">PAY_PER_REQUEST (On-demand)</option>
              <option value="PROVISIONED">PROVISIONED</option>
            </select>
          </div>
          <div v-if="dynamoCreate.billingMode === 'PROVISIONED'" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label class="ctrl-label">{{ t('awsv.readCapacityUnits') }}</label>
              <input v-model.number="dynamoCreate.readCapacity" class="ctrl-input" type="number" min="1" />
            </div>
            <div>
              <label class="ctrl-label">{{ t('awsv.writeCapacityUnits') }}</label>
              <input v-model.number="dynamoCreate.writeCapacity" class="ctrl-input" type="number" min="1" />
            </div>
          </div>
          <div v-if="dynamoCreate.error" class="alert-error">{{ dynamoCreate.error }}</div>
          <div v-if="dynamoCreate.result" class="alert-success">{{ dynamoCreate.result }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
            <button class="btn" @click="submitDynamoCreate" :disabled="dynamoCreate.loading">{{ dynamoCreate.loading ? t('awsv.lit.creating') : t('awsv.lit.createTable') }}</button>
            <button class="btn sm" @click="dynamoCreate.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Glue Job Info Modal ════════════════════════════════════════════════ -->
    <div v-if="glueInfo.open" class="modal-overlay" @click.self="glueInfo.open = false">
      <div class="modal" v-dialog="() => (glueInfo.open = false)" style="width:700px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Glue Job — {{ glueInfo.job?.name }}</span>
          <button class="btn sm" @click="glueInfo.open = false">{{ t('action.close') }}</button>
        </div>
        <div v-if="glueInfo.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="glueInfo.error" class="alert-error">{{ glueInfo.error }}</div>
        <div v-else-if="glueInfo.data" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <!-- Summary cards -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
            <div class="config-section">
              <div class="config-title">{{ t('res.type') }}</div>
              <span class="text-dim">{{ glueInfo.data.command || '-' }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">{{ t('awsv.glueVersion') }}</div>
              <span class="text-dim">{{ glueInfo.data.glueVersion || '-' }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">Worker</div>
              <span class="text-dim">{{ glueInfo.data.workerType || '-' }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">Workers</div>
              <span class="text-dim">{{ glueInfo.data.numWorkers ?? '-' }}</span>
            </div>
          </div>
          <!-- Execution settings -->
          <div class="config-section">
            <div class="config-title">{{ t('awsv.runConfiguration') }}</div>
            <div class="config-row"><span>Timeout</span><span class="mono-xs">{{ glueInfo.data.timeout ? glueInfo.data.timeout + ' min' : '-' }}</span></div>
            <div class="config-row"><span>{{ t('awsv.maxRetries') }}</span><span class="mono-xs">{{ glueInfo.data.maxRetries ?? '-' }}</span></div>
            <div class="config-row"><span>{{ t('awsv.maxConcurrentRuns') }}</span><span class="mono-xs">{{ glueInfo.data.maxConcurrentRuns ?? '-' }}</span></div>
            <div class="config-row"><span>{{ t('awsv.pythonVersion') }}</span><span class="mono-xs">{{ glueInfo.data.pythonVersion || '-' }}</span></div>
            <div class="config-row"><span>Runtime</span><span class="mono-xs">{{ glueInfo.data.runtime || '-' }}</span></div>
          </div>
          <!-- IAM / Role -->
          <div class="config-section">
            <div class="config-title">{{ t('eksd.iamRole') }}</div>
            <span class="mono-xs" style="word-break:break-all;font-size:11px">{{ glueInfo.data.role || '-' }}</span>
          </div>
          <!-- Script -->
          <div v-if="glueInfo.data.scriptLocation" class="config-section">
            <div class="config-title">Script</div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="mono-xs" style="font-size:11px;word-break:break-all;flex:1">{{ glueInfo.data.scriptLocation }}</span>
              <a :href="glueS3ConsoleUrl(glueInfo.data.scriptLocation)" target="_blank" class="btn sm">{{ t('awsv.openInS3') }}</a>
            </div>
          </div>
          <!-- CW Log Group -->
          <div class="config-section">
            <div class="config-title">CloudWatch Log Group</div>
            <span class="mono-xs" style="font-size:11px">{{ glueInfo.data.cloudWatchLogGroup || `/aws-glue/jobs/${glueInfo.job?.name}` }}</span>
          </div>
          <!-- Connections -->
          <div v-if="(glueInfo.data.connections || []).length" class="config-section">
            <div class="config-title">{{ t('awsv.connections', { p0: glueInfo.data.connections.length }) }}</div>
            <div v-for="c in glueInfo.data.connections" :key="c" class="config-row">
              <span>{{ c }}</span>
            </div>
          </div>
          <!-- Catalog database -->
          <div v-if="glueInfo.data.databaseName" class="config-section">
            <div class="config-title">{{ t('awsv.dataCatalogDatabase') }}</div>
            <span class="mono-xs">{{ glueInfo.data.databaseName }}</span>
          </div>
          <!-- Default Arguments -->
          <div v-if="Object.keys(glueInfo.data.defaultArguments || {}).length" class="config-section">
            <div class="config-title">{{ t('awsv.defaultArguments', { p0: Object.keys(glueInfo.data.defaultArguments).length }) }}</div>
            <div v-for="(v, k) in glueInfo.data.defaultArguments" :key="k" class="config-row">
              <span class="mono-xs" style="color:var(--text-dim)">{{ k }}</span>
              <span class="mono-xs" style="word-break:break-all;font-size:11px">{{ v }}</span>
            </div>
          </div>
          <!-- Tags -->
          <div v-if="Object.keys(glueInfo.data.tags || {}).length" class="config-section">
            <div class="config-title">{{ t('th.tags') }}</div>
            <div class="tag-chips">
              <span v-for="(v, k) in glueInfo.data.tags" :key="k" class="tag-chip">{{ k }}={{ v }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ DynamoDB Browse Modal ══════════════════════════════════════════════ -->
    <div v-if="dynamoBrowse.open" class="modal-overlay" @click.self="dynamoBrowse.open = false">
      <div class="modal-box" v-dialog="() => (dynamoBrowse.open = false)" style="width:900px;max-width:98vw;height:80vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600">{{ t('awsv.browse2', { p0: dynamoBrowse.table }) }}</span>
          <button class="btn sm" @click="dynamoBrowse.open = false">{{ t('action.close') }}</button>
        </div>
        <!-- Query builder -->
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:2px">
            <label style="font-size:11px;color:var(--text-muted)">{{ t('vercel.col.mode') }}</label>
            <select v-model="dynamoBrowse.mode" class="ctrl-select">
              <option value="scan">{{ t('awsLogs.scan.button') }}</option>
              <option value="query">{{ t('awsLogs.q.modeQuery') }}</option>
            </select>
          </div>
          <template v-if="dynamoBrowse.mode === 'query'">
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">{{ t('awsv.partitionKeyName') }}</label>
              <input v-model="dynamoBrowse.keyName" class="ctrl-input" :placeholder="t('awsv.eGUserid')" style="width:140px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">{{ t('vercel.col.value') }}</label>
              <input v-model="dynamoBrowse.keyValue" class="ctrl-input" :placeholder="t('awsv.keyValue')" style="width:160px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">{{ t('th.type') }}</label>
              <select v-model="dynamoBrowse.keyType" class="ctrl-select">
                <option value="S">String</option>
                <option value="N">{{ t('awsv.number') }}</option>
                <option value="B">{{ t('awsv.binary') }}</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">{{ t('awsv.indexOptional') }}</label>
              <input v-model="dynamoBrowse.indexName" class="ctrl-input" :placeholder="t('awsv.gsiName')" style="width:120px" />
            </div>
          </template>
          <div style="display:flex;flex-direction:column;gap:2px">
            <label style="font-size:11px;color:var(--text-muted)">{{ t('awsLogs.q.limit') }}</label>
            <input v-model.number="dynamoBrowse.limit" type="number" min="1" max="200" class="ctrl-input" style="width:70px" />
          </div>
          <button class="btn" @click="() => executeDynamoBrowse()" :disabled="dynamoBrowse.loading">
            {{ dynamoBrowse.loading ? t('common.loading') : t('awsv.lit.execute') }}
          </button>
          <button class="btn sm" style="margin-left:auto" @click="openDynamoNewItem">{{ t('awsv.newItem') }}</button>
        </div>
        <!-- Results -->
        <div style="flex:1;overflow:auto;padding:8px">
          <div v-if="dynamoBrowse.loading" class="empty-row">{{ t('state.loading') }}</div>
          <div v-else-if="dynamoBrowse.error" class="alert-error">{{ dynamoBrowse.error }}</div>
          <div v-else-if="!dynamoBrowse.items" class="empty-row">{{ t('awsv.runAScanOrQueryTo') }}</div>
          <div v-else-if="!dynamoBrowse.items.length" class="empty-row">{{ t('awsv.noItemsReturned') }}</div>
          <div v-else>
            <div class="text-dim" style="font-size:11px;margin-bottom:6px">
              {{ t('awsv.itemsShownTotalScanned', { p0: dynamoBrowse.items.length, p1: dynamoBrowse.scannedCount }) }}
            </div>
            <table class="cloud-table" style="font-size:11px">
              <thead><tr>
                <th v-for="col in dynamoBrowse.columns" :key="col">{{ col }}</th>
                <th style="width:76px;position:sticky;right:0;background:var(--bg-card, #1e1e1e);z-index:2;box-shadow:-2px 0 4px rgba(0,0,0,.3)"></th>
              </tr></thead>
              <tbody>
                <tr v-for="(item, idx) in dynamoBrowse.items" :key="idx">
                  <td v-for="col in dynamoBrowse.columns" :key="col" class="mono-xs"
                    style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:relative">
                    <span :title="JSON.stringify(item[col])">{{ formatDynamoValue(item[col]) }}</span>
                    <button
                      v-if="isDynamoCellLong(item[col])"
                      class="dynamo-cell-expand-btn"
                      @click="openDynamoCellModal(col, item[col])"
                      :title="t('awsv.seeFullContent')">🔍</button>
                  </td>
                  <td style="white-space:nowrap;padding:2px 6px;position:sticky;right:0;background:var(--bg-card, #1e1e1e);z-index:1;box-shadow:-2px 0 4px rgba(0,0,0,.3)">
                    <button class="btn sm" style="padding:1px 6px;font-size:10px" @click="openDynamoEdit(item)" :title="t('awsv.editItem')">✏️</button>
                    <button class="btn sm danger" style="padding:1px 6px;font-size:10px;margin-left:2px" @click="deleteDynamoItemFromRow(item)" :title="t('awsv.deleteItem')">🗑</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <!-- Pagination -->
        <div v-if="dynamoBrowse.lastEvaluatedKey || dynamoBrowse.prevKeys?.length" style="padding:8px 12px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
          <button class="btn sm" :disabled="!dynamoBrowse.prevKeys?.length" @click="dynamoPrevPage">{{ t('awsv.prev') }}</button>
          <span class="text-dim" style="line-height:28px;font-size:12px">{{ t('awsv.page', { p0: (dynamoBrowse.prevKeys?.length || 0) + 1 }) }}</span>
          <button class="btn sm" :disabled="!dynamoBrowse.lastEvaluatedKey" @click="dynamoNextPage">{{ t('awsv.next') }}</button>
        </div>
      </div>
    </div>

    <!-- ══ DynamoDB Cell Expand Modal ══════════════════════════════════════════ -->
    <div v-if="dynamoCellModal.open" class="modal-overlay" @click.self="dynamoCellModal.open = false" style="z-index:3000">
      <div class="modal-box" v-dialog="() => (dynamoCellModal.open = false)" style="width:660px;max-width:98vw;max-height:85vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600;font-size:13px">{{ dynamoCellModal.column }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" @click="copyText(dynamoCellModal.raw)">{{ t('action.copy') }}</button>
            <button class="btn sm" @click="dynamoCellModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div style="flex:1;overflow:auto;padding:14px">
          <pre class="code-block" style="white-space:pre-wrap;word-break:break-all;margin:0;max-height:none;font-size:12px">{{ dynamoCellModal.formatted }}</pre>
        </div>
      </div>
    </div>

    <!-- ══ DynamoDB Edit Item Modal ════════════════════════════════════════════ -->
    <div v-if="dynamoEdit.open" class="modal-overlay" @click.self="dynamoEdit.open = false" style="z-index:3000">
      <div class="modal-box" v-dialog="() => (dynamoEdit.open = false)" style="width:660px;max-width:98vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600;font-size:13px">{{ t('awsv.editItem2', { p0: dynamoEdit.table }) }}</span>
          <button class="btn sm" @click="dynamoEdit.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:10px 14px;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">
          {{ t('awsv.keys') }} <span class="mono-xs" style="color:var(--text)">{{ dynamoEdit.keySchema.map(k => k.name).join(', ') }}</span>
          {{ t('awsv.editTheJsonBelowAndSave') }}
        </div>
        <div style="flex:1;overflow:auto;padding:12px 14px">
          <textarea
            v-model="dynamoEdit.jsonText"
            @input="validateDynamoEditJson"
            spellcheck="false"
            class="ctrl-input code-block"
            style="width:100%;min-height:340px;resize:vertical;font-family:monospace;font-size:12px;line-height:1.5;tab-size:2"
          ></textarea>
          <div v-if="dynamoEdit.parseError" class="alert-error" style="margin-top:6px">{{ t('awsv.jsonError', { p0: dynamoEdit.parseError }) }}</div>
          <div v-if="dynamoEdit.error" class="alert-error" style="margin-top:6px">{{ dynamoEdit.error }}</div>
        </div>
        <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
          <button class="btn sm" @click="dynamoEdit.open = false">{{ t('action.cancel') }}</button>
          <button class="btn" @click="submitDynamoEdit" :disabled="dynamoEdit.loading || !!dynamoEdit.parseError">
            {{ dynamoEdit.loading ? t('awsv.lit.saving') : t('awsv.lit.saveItem') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ══ RDS Info Modal ══════════════════════════════════════════════════════ -->
    <div v-if="rdsInfoModal.open" class="modal-overlay" @click.self="rdsInfoModal.open = false">
      <div class="modal-box" v-dialog="() => (rdsInfoModal.open = false)" style="width:900px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <span style="font-weight:600">{{ t('awsv.rdsInfo', { p0: rdsInfoModal.id }) }}</span>
            <span v-if="rdsInfoModal.data" class="text-dim" style="font-size:11px">{{ rdsInfoModal.data.engine }} {{ rdsInfoModal.data.engineVersion || '' }} · {{ rdsInfoModal.data.status }}</span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn sm" @click="openRdsConnect({ id: rdsInfoModal.id })">{{ t('conn.connect') }}</button>
            <button class="btn sm" @click="openRdsResetPwd({ id: rdsInfoModal.id })">{{ t('awsv.resetPassword') }}</button>
            <button class="btn sm" @click="rdsInfoModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div v-if="rdsInfoModal.loading" class="empty-row">{{ t('common.loading') }}</div>
        <div v-else-if="rdsInfoModal.error" class="alert-error">{{ rdsInfoModal.error }}</div>
        <div v-else-if="rdsInfoModal.data" style="padding:12px;display:flex;flex-direction:column;gap:12px;overflow:hidden;flex:1">
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;flex-wrap:wrap">
            <button
              v-for="tabItem in rdsInfoTabs"
              :key="tabItem.id"
              class="btn sm"
              :style="rdsInfoTab === tabItem.id ? 'background:var(--accent);border-color:var(--accent);color:#fff' : ''"
              @click="rdsInfoTab = tabItem.id"
            >{{ tabItem.label }}</button>
          </div>

          <div style="overflow:auto;display:flex;flex-direction:column;gap:12px;flex:1;padding-right:2px">
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
              <div v-for="card in rdsInfoHighlights" :key="card.label" class="config-section" style="margin:0;padding:10px 12px">
                <div class="config-title" style="margin-bottom:4px">{{ card.label }}</div>
                <div class="mono-xs" :class="card.tone" style="font-size:12px;word-break:break-word">{{ card.value }}</div>
              </div>
            </div>

            <div v-if="rdsInfoTab === 'connectivity'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">{{ t('awsv.connectivityAndSecurity') }}</div>
                <div class="config-row"><span>{{ t('sns.endpoint') }}</span><span class="mono-xs text-dim">{{ rdsInfoModal.data.endpoint ? `${rdsInfoModal.data.endpoint}:${rdsInfoModal.data.port}` : '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.publicAccess') }}</span><span :class="rdsInfoModal.data.public ? 'status-warn' : 'status-ok'">{{ rdsInfoModal.data.public ? t('common.yes') : t('common.no') }}</span></div>
                <div class="config-row"><span>{{ t('awsv.subnetGroup') }}</span><span class="text-dim">{{ rdsInfoModal.data.subnetGroup || '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.networkType') }}</span><span class="text-dim">{{ rdsInfoModal.data.networkType || '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.iamDbAuthentication') }}</span><span :class="rdsInfoModal.data.iamDatabaseAuthenticationEnabled ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.iamDatabaseAuthenticationEnabled ? t('res.enabled') : t('res.disabled') }}</span></div>
                <div class="config-row"><span>{{ t('gsi.caCertificate') }}</span><span class="text-dim mono-xs">{{ rdsInfoModal.data.caCertificateIdentifier || '-' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">{{ t('awsv.securityGroups', { p0: (rdsInfoModal.data.vpcSecurityGroups || []).length }) }}</div>
                <div v-if="!rdsInfoModal.data.vpcSecurityGroups?.length" class="text-dim" style="font-size:12px">{{ t('eksd.noSecurityGroups') }}</div>
                <div v-for="sg in rdsInfoModal.data.vpcSecurityGroups" :key="sg.id" class="config-row">
                  <span class="mono-xs">{{ sg.id }}</span>
                  <span :class="sg.status === 'active' ? 'status-ok' : 'text-dim'">{{ sg.status }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'monitoring'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">{{ t('awsv.monitoring') }}</div>
                <div class="config-row"><span>{{ t('awsv.enhancedMonitoring') }}</span><span :class="rdsInfoModal.data.monitoringInterval ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.monitoringInterval ? `Cada ${rdsInfoModal.data.monitoringInterval}s` : t('res.disabled') }}</span></div>
                <div class="config-row"><span>{{ t('awsv.monitoringRole') }}</span><span class="mono-xs text-dim" style="font-size:10px">{{ rdsInfoModal.data.monitoringRoleArn || '-' }}</span></div>
                <div class="config-row"><span>Performance Insights</span><span :class="rdsInfoModal.data.performanceInsightsEnabled ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.performanceInsightsEnabled ? t('res.enabled') : t('res.disabled') }}</span></div>
                <div class="config-row"><span>{{ t('awsv.piRetention') }}</span><span class="text-dim">{{ rdsInfoModal.data.performanceInsightsRetentionPeriod || '-' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">{{ t('awsv.exportedLogs') }}</div>
                <div v-if="!(rdsInfoModal.data.enabledCloudwatchLogsExports || []).length" class="text-dim" style="font-size:12px">{{ t('awsv.noExportsToCloudwatchLogs') }}</div>
                <div v-for="logName in (rdsInfoModal.data.enabledCloudwatchLogsExports || [])" :key="logName" class="config-row">
                  <span class="mono-xs">{{ logName }}</span>
                  <span class="status-ok">{{ t('res.enabled') }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'configuration'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">{{ t('lmd.tabConfig') }}</div>
                <div class="config-row"><span>{{ t('gsi.engine') }}</span><span class="text-dim">{{ rdsInfoModal.data.engine }} {{ rdsInfoModal.data.engineVersion || '' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.instanceClass') }}</span><span class="text-dim">{{ rdsInfoModal.data.class || '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.masterUser') }}</span><span class="text-dim">{{ rdsInfoModal.data.masterUsername || '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.databaseName') }}</span><span class="text-dim">{{ rdsInfoModal.data.dbName || '-' }}</span></div>
                <div class="config-row"><span>{{ t('ec2d.tabStorage') }}</span><span class="text-dim">{{ rdsInfoModal.data.storageGb || '-' }} GiB ({{ rdsInfoModal.data.storageType || '-' }})</span></div>
                <div class="config-row"><span>{{ t('awsv.storageEncryption') }}</span><span :class="rdsInfoModal.data.storageEncrypted ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.storageEncrypted ? t('common.yes') : t('common.no') }}</span></div>
                <div class="config-row"><span>{{ t('awsv.maxAutoscalingStorage') }}</span><span class="text-dim">{{ rdsInfoModal.data.maxAllocatedStorage || '-' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">{{ t('awsv.parametersAndOptions') }}</div>
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">{{ t('awsv.parameterGroups') }}</div>
                <div v-if="!(rdsInfoModal.data.parameterGroups || []).length" class="text-dim" style="font-size:12px">{{ t('awsv.notAssigned') }}</div>
                <div v-for="pg in (rdsInfoModal.data.parameterGroups || [])" :key="pg.name" class="config-row">
                  <span class="mono-xs">{{ pg.name }}</span>
                  <span class="text-dim">{{ pg.status }}</span>
                </div>
                <div style="font-size:11px;color:var(--text-dim);margin:10px 0 6px">{{ t('awsv.optionGroups') }}</div>
                <div v-if="!(rdsInfoModal.data.optionGroups || []).length" class="text-dim" style="font-size:12px">{{ t('awsv.notAssigned') }}</div>
                <div v-for="og in (rdsInfoModal.data.optionGroups || [])" :key="og.name" class="config-row">
                  <span class="mono-xs">{{ og.name }}</span>
                  <span class="text-dim">{{ og.status }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'maintenance'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">{{ t('awsv.maintenance') }}</div>
                <div class="config-row"><span>{{ t('awsv.autoMinorVersionUpgrade') }}</span><span :class="rdsInfoModal.data.autoMinorVersionUpgrade ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.autoMinorVersionUpgrade ? t('res.enabled') : t('res.disabled') }}</span></div>
                <div class="config-row"><span>{{ t('awsv.maintenanceWindow') }}</span><span class="text-dim mono-xs">{{ rdsInfoModal.data.preferredMaintenanceWindow || '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.deletionProtection') }}</span><span :class="rdsInfoModal.data.deletionProtection ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.deletionProtection ? t('res.enabled') : t('res.disabled') }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">{{ t('awsv.backups') }}</div>
                <div class="config-row"><span>{{ t('awsv.retentionDays') }}</span><span class="text-dim">{{ rdsInfoModal.data.backupRetention ?? '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.backupWindow') }}</span><span class="text-dim mono-xs">{{ rdsInfoModal.data.preferredBackupWindow || '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.latestRestorableTime') }}</span><span class="text-dim">{{ rdsInfoModal.data.latestRestorableTime ? formatDate(rdsInfoModal.data.latestRestorableTime) : '-' }}</span></div>
                <div class="config-row"><span>{{ t('awsv.copyTagsToSnapshot') }}</span><span :class="rdsInfoModal.data.copyTagsToSnapshot ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.copyTagsToSnapshot ? t('common.yes') : t('common.no') }}</span></div>
                <div class="config-row"><span>{{ t('awsv.backupTarget') }}</span><span class="text-dim">{{ rdsInfoModal.data.backupTarget || '-' }}</span></div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'migration'" class="config-section">
              <div class="config-title">{{ t('awsv.migrationAndReplication') }}</div>
              <div class="config-row"><span>{{ t('awsv.sourceInstance') }}</span><span class="mono-xs text-dim">{{ rdsInfoModal.data.readReplicaSourceDBInstanceIdentifier || '-' }}</span></div>
              <div class="config-row"><span>{{ t('awsv.replicaMode') }}</span><span class="text-dim">{{ rdsInfoModal.data.replicaMode || '-' }}</span></div>
              <div class="config-row" style="align-items:flex-start">
                <span>{{ t('awsv.readReplicasInstances') }}</span>
                <span class="text-dim mono-xs" style="font-size:10px;word-break:break-all">{{ (rdsInfoModal.data.readReplicaDBInstanceIdentifiers || []).join(', ') || '-' }}</span>
              </div>
              <div class="config-row" style="align-items:flex-start">
                <span>{{ t('awsv.readReplicasClusters') }}</span>
                <span class="text-dim mono-xs" style="font-size:10px;word-break:break-all">{{ (rdsInfoModal.data.readReplicaDBClusterIdentifiers || []).join(', ') || '-' }}</span>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'tags'" class="config-section">
              <div class="config-title">{{ t('awsv.tags') }}</div>
              <div v-if="!(rdsInfoModal.data.tags || []).length" class="text-dim" style="font-size:12px">{{ t('res.noTags') }}</div>
              <div v-for="tag in (rdsInfoModal.data.tags || [])" :key="tag.key" class="config-row">
                <span class="mono-xs">{{ tag.key }}</span>
                <span class="mono-xs text-dim" style="word-break:break-all">{{ tag.value }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ RDS Connect Modal ═══════════════════════════════════════════════════ -->
    <div v-if="rdsConnectModal.open" class="modal-overlay" @click.self="rdsConnectModal.open = false">
      <div class="modal-box" v-dialog="() => (rdsConnectModal.open = false)" style="width:760px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">{{ t('awsv.rdsConnection', { p0: rdsConnectModal.id }) }}</span>
          <button class="btn sm" @click="rdsConnectModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div v-if="rdsConnectModal.loading" class="empty-row">{{ t('common.loading') }}</div>
        <div v-else-if="rdsConnectModal.error" class="alert-error">{{ rdsConnectModal.error }}</div>
        <div v-else-if="rdsConnectModal.data" style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:6px;align-items:center">
            <label style="font-size:12px;color:var(--text-muted);white-space:nowrap">{{ t('awsv.passwordForTheUri') }}</label>
            <input v-model="rdsConnectModal.password" type="password" class="ctrl-input" :placeholder="t('awsv.masterUserPassword')" style="flex:1" />
          </div>
          <div v-for="entry in rdsConnectionEntries" :key="entry.key">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text-muted)">{{ entry.label }}</div>
            <div style="position:relative">
              <pre class="code-block" style="user-select:all;overflow-x:auto">{{ entry.value }}</pre>
              <button class="btn sm" style="position:absolute;top:4px;right:4px" @click="copyText(entry.value)">{{ t('action.copy') }}</button>
            </div>
          </div>
          <div v-if="rdsConnectModal.data.templates?.notes?.length" style="background:var(--bg-alt,#1e1e2e);border-radius:6px;padding:10px 12px">
            <div style="font-size:11px;font-weight:600;margin-bottom:6px">{{ t('awsv.notes') }}</div>
            <div v-for="n in rdsConnectModal.data.templates.notes" :key="n" style="font-size:11px;color:var(--text-muted);margin-bottom:4px">• {{ n }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ RDS Reset Password Modal ═══════════════════════════════════════════ -->
    <div v-if="rdsResetPwdModal.open" class="modal-overlay" @click.self="rdsResetPwdModal.open = false">
      <div class="modal-box" v-dialog="() => (rdsResetPwdModal.open = false)" style="width:460px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">{{ t('awsv.resetMasterPassword', { p0: rdsResetPwdModal.id }) }}</span>
          <button class="btn sm" @click="rdsResetPwdModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
          <label class="field-label">
            {{ t('awsv.newPassword') }}
            <input v-model="rdsResetPwdModal.newPassword" type="password" class="ctrl-input" :placeholder="t('awsv.atLeast8Characters')" autocomplete="new-password" />
          </label>
          <label class="field-label">
            {{ t('awsv.confirmPassword') }}
            <input v-model="rdsResetPwdModal.confirmPassword" type="password" class="ctrl-input" :placeholder="t('awsv.repeatPassword')" autocomplete="new-password" />
          </label>
          <div v-if="rdsResetPwdModal.error" class="alert-error">{{ rdsResetPwdModal.error }}</div>
          <div v-if="rdsResetPwdModal.success" style="color:#a6e3a1;font-size:12px;padding:8px;border-radius:4px;background:rgba(166,227,161,.1)">{{ rdsResetPwdModal.success }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn sm" @click="rdsResetPwdModal.open = false">{{ t('action.cancel') }}</button>
            <button class="btn sm" :disabled="rdsResetPwdModal.loading" @click="doRdsResetPassword">
              {{ rdsResetPwdModal.loading ? t('awsv.lit.applying') : t('awsv.resetPassword') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Glue Job Config Modal ═══════════════════════════════════════════════ -->
    <div v-if="glueConfigModal.open" class="modal-overlay" @click.self="glueConfigModal.open = false">
      <div class="modal-box" v-dialog="() => (glueConfigModal.open = false)" style="width:860px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="font-weight:600;font-size:14px">{{ glueConfigModal.job?.name }}</span>
            <span class="text-dim" style="font-size:11px">{{ glueConfigModal.data?.description || 'AWS Glue Job' }}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn sm" @click="openGlueLogs(glueConfigModal.job)">{{ t('awsv.viewLogs') }}</button>
            <button class="btn sm" @click="glueConfigModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div v-if="glueConfigModal.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="glueConfigModal.error" class="alert-error">{{ glueConfigModal.error }}</div>
        <div v-else-if="glueConfigModal.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">

          <!-- ── Última ejecución ── -->
          <div v-if="glueConfigModal.lastRun" style="border-radius:8px;padding:12px 14px;border:1px solid var(--border);display:flex;gap:20px;flex-wrap:wrap;align-items:center">
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">{{ t('awsv.lastRun2') }}</span>
              <span :class="glueConfigModal.lastRun.status === 'SUCCEEDED' ? 'status-ok' : glueConfigModal.lastRun.status === 'RUNNING' ? 'status-warn' : 'status-err'" style="font-weight:600;font-size:13px">{{ glueConfigModal.lastRun.status }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Run ID</span>
              <span class="mono-xs text-dim">{{ glueConfigModal.lastRun.id }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">{{ t('awsv.started') }}</span>
              <span class="text-dim" style="font-size:12px">{{ glueConfigModal.lastRun.startedOn ? formatDate(glueConfigModal.lastRun.startedOn) : '-' }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">{{ t('awsv.completed') }}</span>
              <span class="text-dim" style="font-size:12px">{{ glueConfigModal.lastRun.completedOn ? formatDate(glueConfigModal.lastRun.completedOn) : '-' }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">{{ t('awsv.duration') }}</span>
              <span class="text-dim" style="font-size:12px">{{ glueConfigModal.lastRun.executionTime ? glueConfigModal.lastRun.executionTime + 's' : '-' }}</span>
            </div>
            <div v-if="glueConfigModal.lastRun.errorMessage" style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">{{ t('awsLogs.sync_error') }}</span>
              <span style="font-size:11px;color:#f38ba8;word-break:break-word">{{ glueConfigModal.lastRun.errorMessage }}</span>
            </div>
          </div>
          <div v-else-if="!glueConfigModal.loadingRuns" style="font-size:12px;color:var(--text-dim);border:1px dashed var(--border);border-radius:6px;padding:8px 12px">{{ t('awsv.noRecordedRuns') }}</div>

          <!-- ── Script & Script Link ── -->
          <div class="config-section">
            <div class="config-title" style="display:flex;align-items:center;justify-content:space-between">
              <span>Script</span>
              <a v-if="glueConfigModal.data.command?.ScriptLocation"
                :href="glueS3ConsoleUrl(glueConfigModal.data.command.ScriptLocation)"
                target="_blank" rel="noopener"
                class="btn sm" style="font-size:11px;text-decoration:none">{{ t('awsv.openInS32') }}</a>
            </div>
            <div class="config-row"><span>{{ t('res.type') }}</span><span class="text-dim">{{ glueConfigModal.data.command?.Name }}</span></div>
            <div class="config-row"><span>Runtime Python</span><span class="text-dim">{{ glueConfigModal.data.command?.PythonVersion ? 'Python ' + glueConfigModal.data.command.PythonVersion : 'N/A' }}</span></div>
            <div class="config-row" style="align-items:flex-start">
              <span style="flex-shrink:0">{{ t('gsi.location') }}</span>
              <div style="display:flex;gap:6px;align-items:center;min-width:0;flex:1">
                <span class="text-dim mono-xs" style="word-break:break-all;flex:1">{{ glueConfigModal.data.command?.ScriptLocation }}</span>
                <button class="btn sm" style="flex-shrink:0" @click="copyText(glueConfigModal.data.command?.ScriptLocation)">{{ t('action.copy') }}</button>
              </div>
            </div>
            <div class="config-row"><span>CW Log Group</span><span class="text-dim mono-xs">{{ glueConfigModal.data.cloudWatchLogGroup }}</span></div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <!-- ── General ── -->
            <div class="config-section">
              <div class="config-title">{{ t('observability.general') }}</div>
              <div class="config-row"><span>{{ t('awsv.glueVersion') }}</span><span class="text-dim">{{ glueConfigModal.data.glueVersion || '-' }}</span></div>
              <div class="config-row"><span>Worker Type</span><span class="text-dim">{{ glueConfigModal.data.workerType || '-' }}</span></div>
              <div class="config-row"><span>Workers</span><span class="text-dim">{{ glueConfigModal.data.numberOfWorkers ?? '-' }}</span></div>
              <div class="config-row"><span>{{ t('awsv.maxRetries') }}</span><span class="text-dim">{{ glueConfigModal.data.maxRetries ?? '-' }}</span></div>
              <div class="config-row"><span>Timeout (min)</span><span class="text-dim">{{ glueConfigModal.data.timeout ?? '-' }}</span></div>
              <div class="config-row" style="align-items:flex-start">
                <span style="flex-shrink:0">{{ t('eksd.iamRole') }}</span>
                <span class="text-dim mono-xs" style="word-break:break-all;font-size:10px">{{ glueConfigModal.data.role }}</span>
              </div>
            </div>

            <!-- ── Conexiones ── -->
            <div class="config-section">
              <div class="config-title">{{ t('awsv.connections', { p0: (glueConfigModal.data.connections || []).length }) }}</div>
              <div v-if="!glueConfigModal.data.connections?.length" class="text-dim" style="font-size:12px;padding:6px 0">{{ t('awsv.noConnectionsAssigned') }}</div>
              <div v-for="conn in glueConfigModal.data.connections" :key="conn"
                style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
                <span class="mono-xs">{{ conn }}</span>
              </div>
            </div>
          </div>

          <!-- ── Argumentos ── -->
          <div class="config-section">
            <div class="config-title">{{ t('awsv.defaultArguments', { p0: Object.keys(glueConfigModal.data.defaultArguments || {}).length }) }}</div>
            <div v-if="!Object.keys(glueConfigModal.data.defaultArguments || {}).length" class="text-dim" style="font-size:12px;padding:6px 0">{{ t('awsv.none2') }}</div>
            <div v-for="(v, k) in glueConfigModal.data.defaultArguments" :key="k"
              style="display:grid;grid-template-columns:200px 1fr;gap:8px;padding:3px 0;border-bottom:1px solid var(--border);font-size:11px">
              <span class="mono-xs" style="color:var(--accent)">{{ k }}</span>
              <span class="mono-xs text-dim" style="word-break:break-all">{{ v }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Glue Logs Modal ════════════════════════════════════════════════════ -->
    <div v-if="glueLogsModal.open" class="modal-overlay" @click.self="glueLogsModal.open = false">
      <div class="modal-box" v-dialog="() => (glueLogsModal.open = false)" style="width:900px;max-width:98vw;height:80vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600">Logs — {{ glueLogsModal.job?.name }}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <select v-model.number="glueLogsModal.minutes" class="ctrl-select" style="font-size:12px">
              <option :value="15">15 min</option>
              <option :value="60">{{ t('awsv.1Hour') }}</option>
              <option :value="360">{{ t('awsv.6Hours') }}</option>
              <option :value="1440">{{ t('awsv.24Hours') }}</option>
            </select>
            <button class="btn sm" @click="loadGlueLogs">{{ t('action.refresh') }}</button>
            <button class="btn sm" @click="glueLogsModal.open = false">{{ t('action.close') }}</button>
          </div>
        </div>
        <div v-if="glueLogsModal.loading" class="empty-row">{{ t('awsv.loadingLogs') }}</div>
        <div v-else-if="glueLogsModal.error" class="alert-error">{{ glueLogsModal.error }}</div>
        <div v-else-if="!glueLogsModal.events?.length" class="empty-row">{{ t('awsv.noLogEventsFoundForThe') }}</div>
        <div v-else style="flex:1;overflow:auto;padding:10px;font-family:monospace;font-size:11px;line-height:1.6">
          <div v-for="(ev, i) in glueLogsModal.events" :key="i" style="display:flex;gap:10px;border-bottom:1px solid var(--border)">
            <span class="text-dim" style="white-space:nowrap;flex-shrink:0">{{ formatDate(ev.timestamp) }}</span>
            <span style="word-break:break-all">{{ ev.message }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Cognito Create User Modal ══════════════════════════════════════════ -->
    <div v-if="cognitoCreateModal.open" class="modal-overlay" @click.self="cognitoCreateModal.open = false">
      <div class="modal-box" v-dialog="() => (cognitoCreateModal.open = false)" style="width:460px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">{{ t('awsv.createUser2', { p0: cognitoState.selectedPool?.name }) }}</span>
          <button class="btn sm" @click="cognitoCreateModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">{{ t('awsv.username2') }}</label>
            <input v-model="cognitoCreateModal.username" class="ctrl-input" :placeholder="t('awsv.usernameOrEmail')" />
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">{{ t('ses.type_email') }}</label>
            <input v-model="cognitoCreateModal.email" type="email" class="ctrl-input" placeholder="user@example.com" />
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">{{ t('awsv.temporaryPasswordOptional') }}</label>
            <input v-model="cognitoCreateModal.temporaryPassword" type="password" class="ctrl-input" :placeholder="t('awsv.leaveBlankToAutoGenerate')" />
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" v-model="cognitoCreateModal.suppressMessage" id="suppressMsg" />
            <label for="suppressMsg" style="font-size:12px">{{ t('awsv.suppressWelcomeMessage') }}</label>
          </div>
          <div v-if="cognitoCreateModal.error" class="alert-error">{{ cognitoCreateModal.error }}</div>
          <div v-if="cognitoCreateModal.result" class="alert-success">{{ t('awsv.userCreated', { p0: cognitoCreateModal.result }) }}</div>
          <div style="display:flex;gap:8px">
            <button class="btn" @click="submitCreateCognitoUser" :disabled="cognitoCreateModal.loading">
              {{ cognitoCreateModal.loading ? t('awsv.lit.creating') : t('awsv.lit.createUser') }}
            </button>
            <button class="btn sm" @click="cognitoCreateModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Cognito Create Group Modal ═════════════════════════════════════════ -->
    <div v-if="cognitoGroupModal.open" class="modal-overlay" @click.self="cognitoGroupModal.open = false">
      <div class="modal-box" v-dialog="() => (cognitoGroupModal.open = false)" style="width:460px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">{{ t('awsv.createGroup2', { p0: cognitoState.selectedPool?.name }) }}</span>
          <button class="btn sm" @click="cognitoGroupModal.open = false">{{ t('action.close') }}</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">{{ t('awsv.groupName2') }}</label>
            <input v-model="cognitoGroupModal.groupName" class="ctrl-input" placeholder="developers" />
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">{{ t('th.description') }}</label>
            <textarea v-model="cognitoGroupModal.description" class="ctrl-input" rows="3" :placeholder="t('awsv.shortDescriptionForThisGroup')"></textarea>
          </div>
          <div v-if="cognitoGroupModal.error" class="alert-error">{{ cognitoGroupModal.error }}</div>
          <div v-if="cognitoGroupModal.result" class="alert-success">{{ cognitoGroupModal.result }}</div>
          <div style="display:flex;gap:8px">
            <button class="btn" @click="submitCreateCognitoGroup" :disabled="cognitoGroupModal.loading">
              {{ cognitoGroupModal.loading ? t('awsv.lit.creating') : t('awsv.lit.createGroup') }}
            </button>
            <button class="btn sm" @click="cognitoGroupModal.open = false">{{ t('action.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Cognito User Detail Slide-over ═════════════════════════════════════ -->
    <div v-if="cognitoUserDetail.open" class="modal-overlay" @click.self="cognitoUserDetail.open = false">
      <div class="modal-box" v-dialog="() => (cognitoUserDetail.open = false)" style="width:760px;max-width:98vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:13px">{{ cognitoUserDetail.username }}</div>
            <div v-if="cognitoUserDetail.data" class="text-dim" style="font-size:11px">{{ cognitoUserDetail.data.attributes?.email || '' }}</div>
          </div>
          <button class="btn sm" @click="cognitoUserDetail.open = false">{{ t('action.close') }}</button>
        </div>
        <div v-if="cognitoUserDetail.loading" class="empty-row">{{ t('state.loading') }}</div>
        <div v-else-if="cognitoUserDetail.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">

          <!-- Status badges row -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span :class="cognitoUserDetail.data.status === 'CONFIRMED' ? 'status-ok' : 'status-warn'" style="font-size:12px;font-weight:600">{{ cognitoUserDetail.data.status }}</span>
            <span :class="cognitoUserDetail.data.enabled ? 'status-ok' : 'status-err'" style="font-size:12px">{{ cognitoUserDetail.data.enabled ? t('res.enabled') : t('res.disabled') }}</span>
            <span :class="cognitoUserDetail.data.mfaSettingList?.length ? 'status-ok' : 'text-dim'"
              style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid currentColor">
              MFA: {{ cognitoUserDetail.data.mfaSettingList?.join(', ') || t('awsv.lit.off') }}
            </span>
            <span v-if="cognitoUserDetail.data.preferredMfa" class="text-dim" style="font-size:11px">{{ t('awsv.preferred', { p0: cognitoUserDetail.data.preferredMfa }) }}</span>
          </div>

          <!-- Timestamps -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="config-section" style="margin:0">
              <div class="config-title">{{ t('awsv.accountCreated') }}</div>
              <div style="font-size:12px;color:var(--text-dim)">{{ cognitoUserDetail.data.created ? formatDate(cognitoUserDetail.data.created) : '-' }}</div>
            </div>
            <div class="config-section" style="margin:0">
              <div class="config-title">{{ t('awsv.lastModified') }}</div>
              <div style="font-size:12px;color:var(--text-dim)">{{ cognitoUserDetail.data.modified ? formatDate(cognitoUserDetail.data.modified) : '-' }}</div>
            </div>
          </div>

          <!-- MFA switch -->
          <div class="config-section">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div>
                <div class="config-title" style="margin:0">MFA</div>
                <div class="text-dim" style="font-size:11px;margin-top:4px">{{ t('awsv.enableOrDisableMfaForThis') }}</div>
              </div>
              <label v-if="!cognitoUserDetail.mfaEnabled" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input
                  type="checkbox"
                  v-model="cognitoUserDetail.mfaEnabled"
                  :disabled="cognitoUserDetail.savingMfa"
                  @change="onCognitoEnableMfaToggle"
                />
                <span class="text-dim" style="font-size:12px;font-weight:600">
                  {{ t('awsv.enableMfa') }}
                </span>
              </label>
              <div v-else style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="status-ok" style="font-size:12px;font-weight:600">{{ t('awsv.mfaEnabled') }}</span>
                <button class="btn sm danger" :disabled="cognitoUserDetail.savingMfa" @click="disableCognitoUserMfa">
                  {{ cognitoUserDetail.savingMfa ? t('awsv.lit.processing') : t('awsv.lit.turnOff') }}
                </button>
              </div>
            </div>
            <div v-if="cognitoUserDetail.mfaEnabled" style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
              <span class="text-dim" style="font-size:11px">{{ t('awsv.preferredMethod') }}</span>
              <select
                v-model="cognitoUserDetail.mfaMethod"
                class="ctrl-input"
                style="min-width:220px"
                :disabled="cognitoUserDetail.savingMfa"
              >
                <option value="SMS_MFA">SMS</option>
                <option value="SOFTWARE_TOKEN_MFA">Software Token (TOTP)</option>
              </select>
              <button
                class="btn sm"
                :disabled="cognitoUserDetail.savingMfa"
                @click="applyCognitoUserMfaMethod"
              >
                {{ cognitoUserDetail.savingMfa ? t('awsv.lit.applying') : t('awsv.lit.changeMethod') }}
              </button>
            </div>
          </div>

          <!-- Editable attributes -->
          <div class="config-section">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div class="config-title" style="margin:0">{{ t('awsv.editableAttributes') }}</div>
              <button class="btn sm" :disabled="cognitoUserDetail.savingAttributes" @click="saveCognitoUserAttributes">
                {{ cognitoUserDetail.savingAttributes ? t('awsv.lit.saving') : t('awsv.lit.saveAttributes') }}
              </button>
            </div>
            <div v-if="!cognitoUserDetail.editFields.length" class="text-dim" style="font-size:12px;padding:6px 0">{{ t('awsv.noEditableFieldsAvailableForThis') }}</div>
            <div v-else style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:8px">
              <div v-for="field in cognitoUserDetail.editFields" :key="field.name" style="border:1px solid var(--border);border-radius:6px;padding:8px 10px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
                  <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;font-weight:600">{{ field.label }}</div>
                  <span class="text-dim" style="font-size:10px">{{ field.description }}</span>
                </div>
                <input v-if="field.type === 'text'" v-model="cognitoUserDetail.editValues[field.name]" class="ctrl-input" style="width:100%" />
                <label v-else style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim)">
                  <input v-model="cognitoUserDetail.editValues[field.name]" type="checkbox" />
                  <span>{{ cognitoUserDetail.editValues[field.name] ? 'true' : 'false' }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Groups membership -->
          <div class="config-section">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div class="config-title" style="margin:0">{{ t('ec2d.groups') }}</div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <select v-model="cognitoUserDetail.selectedGroup" class="ctrl-input" style="min-width:220px">
                  <option value="">{{ t('awsv.selectGroupToAdd') }}</option>
                  <option v-for="g in cognitoUserAvailableGroups()" :key="g.name" :value="g.name">{{ g.name }}</option>
                </select>
                <button class="btn sm" :disabled="cognitoUserDetail.savingGroup || !cognitoUserDetail.selectedGroup" @click="addCognitoUserGroup">
                  {{ cognitoUserDetail.savingGroup ? t('awsv.lit.updating') : t('awsv.lit.addToGroup') }}
                </button>
              </div>
            </div>
            <div v-if="cognitoUserDetail.groupsLoading" class="text-dim" style="font-size:12px;padding:6px 0">{{ t('awsv.loadingGroups') }}</div>
            <div v-else-if="!cognitoUserDetail.groups.length" class="text-dim" style="font-size:12px;padding:6px 0">{{ t('awsv.thisUserIsNotAssignedTo') }}</div>
            <div v-else style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
              <div v-for="g in cognitoUserDetail.groups" :key="g.name" style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border);border-radius:6px;padding:8px 10px">
                <div>
                  <div style="font-weight:600">{{ g.name }}</div>
                  <div class="text-dim" style="font-size:11px">{{ g.description || '-' }}</div>
                </div>
                <button class="btn sm danger" :disabled="cognitoUserDetail.savingGroup" @click="removeCognitoUserGroup(g.name)">{{ t('awsLogs.remove') }}</button>
              </div>
            </div>
          </div>

          <!-- MFA Options detail -->
          <div v-if="cognitoUserDetail.data.mfaOptions?.length" class="config-section">
            <div class="config-title">{{ t('awsv.mfaOptions') }}</div>
            <div v-for="opt in cognitoUserDetail.data.mfaOptions" :key="opt.DeliveryMedium" class="config-row">
              <span>{{ opt.DeliveryMedium }}</span><span class="text-dim mono-xs">{{ opt.AttributeName }}</span>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border)">
            <button class="btn sm" @click="doCognitoResetPassword(cognitoUserDetail.data)">{{ t('awsv.sendPasswordReset') }}</button>
            <button class="btn sm" v-if="cognitoUserDetail.data.enabled" @click="doCognitoDisable(cognitoUserDetail.data)">{{ t('awsv.disable') }}</button>
            <button class="btn sm" v-else @click="doCognitoEnable(cognitoUserDetail.data)">{{ t('awsv.enable') }}</button>
          </div>
        </div>
      </div>
    </div>

    <EksObservabilityDashboard
      :open="eksObservabilityModal.open"
      :cluster="eksObservabilityModal.cluster"
      @close="eksObservabilityModal.open = false"
    />

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import jsYaml from 'js-yaml'
import { useEnvStore }  from '../../stores/useEnvStore'
import { useAwsStore }  from '../../stores/useAwsStore'
import { useApmStore } from '../../stores/useApmStore'
import { useToast }     from '../../composables/useToast'
import { useApi }       from '../../composables/useApi'
import { useSortable }  from '../../composables/useSortable'
import { settings as appSettings } from '../../composables/useSettings'
import { createRefreshGate } from '../../composables/refreshGate'
import AwsSqsTab from './messaging/AwsSqsTab.vue'
import AwsLoadBalancersTab from './networking/AwsLoadBalancersTab.vue'
import AwsSnsTab from './messaging/AwsSnsTab.vue'
import AwsSesTab from './messaging/AwsSesTab.vue'
import StepFnDiagram       from '../StepFnDiagram.vue'
import StepFnDetail        from '../StepFnDetail.vue'
import EventBridgeDetail   from '../EventBridgeDetail.vue'
import EventBridgeLogs     from '../EventBridgeLogs.vue'
import Ec2Shell            from './Ec2Shell.vue'
import Ec2Rdp              from './Ec2Rdp.vue'
import Ec2RdpInfo          from './Ec2RdpInfo.vue'
import Ec2Detail           from './Ec2Detail.vue'
import LambdaDetail        from './LambdaDetail.vue'
import VpcDetail           from './VpcDetail.vue'
import EksDetail           from './EksDetail.vue'
import EksObservabilityDashboard from './EksObservabilityDashboard.vue'
import ApiGwIntegrations   from './ApiGwIntegrations.vue'
import S3Browser           from './S3Browser.vue'
import GcpConfirmModal     from './GcpConfirmModal.vue'
import TagList             from './TagList.vue'
import RowMenu             from './RowMenu.vue'
import { vDialog }         from '../../composables/vDialog'
import {
  displayName, filterRecords, hostnameOf, recordKey, recordTypes,
  recordsForExport, recordsToCsv, testResultKey, testsForRecord,
} from './route53Records'
import ApmObservabilityView from './apm/ApmObservabilityView.vue'
import AwsOverview from './AwsOverview.vue'
import AwsAccessRequestModal from './AwsAccessRequestModal.vue'
import CloudWatchDashboardDetail from './CloudWatchDashboardDetail.vue'
import CloudWatchDashboardView from './dashboard/CloudWatchDashboardView.vue'
import AwsLogsTab from './logs/AwsLogsTab.vue'
import AwsCfnTab from './cfn/AwsCfnTab.vue'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import { useTerminalStore } from '../../stores/useTerminalStore'

const props = defineProps({
  activeService: { type: String, default: 'overview' },
  applicationId: { type: String, default: '' },
  environment: { type: String, default: '' },
  apmFocusResource: { type: Object, default: null },
})
const emit = defineEmits(['open-architecture', 'open-kubernetes-logs', 'navigate-tab', 'open-observability'])

const envStore = useEnvStore()
const awsStore = useAwsStore()
const apmStore = useApmStore()
const termStore = useTerminalStore()
const { toast }    = useToast()
const { apiFetch } = useApi()
const { sortBy, sortRows, sortIcon, thClass, resetSort, ariaSort } = useSortable()

const selectedProfileId = ref(awsStore.activeProfileId || '')
const localProfiles     = ref([])
const remoteSessions    = ref([])
const sshSessions       = computed(() => remoteSessions.value.filter(s => s.type === 'ssh'))
const rdpSessions       = computed(() => remoteSessions.value.filter(s => s.type === 'rdp'))

const TABS = [
  { id: 'overview',     label: 'Overview'       },
  { id: 'apm',          label: 'Applications'   },
  { id: 'ec2',          label: 'EC2'            },
  { id: 'ecs',          label: 'ECS'            },
  { id: 'eks',          label: 'EKS'            },
  { id: 'lambda',       label: 'Lambda'         },
  { id: 'apigw',        label: 'API Gateway'    },
  { id: 's3',           label: 'S3'             },
  { id: 'ecr',          label: 'ECR'            },
  { id: 'vpc',          label: 'VPC'            },
  { id: 'eventbridge',  label: 'EventBridge'    },
  { id: 'stepfn',       label: 'Step Functions' },
  { id: 'sqs',          label: 'SQS'            },
  { id: 'sns',          label: 'SNS'            },
  { id: 'ses',          label: 'SES'            },
  { id: 'dynamodb',     label: 'DynamoDB'       },
  { id: 'rds',          label: 'RDS'            },
  { id: 'glue',         label: 'Glue'           },
  { id: 'athena',       label: 'Athena'         },
  { id: 'datapipeline', label: 'Data Pipeline'  },
  { id: 'bedrock',      label: 'Bedrock'        },
  { id: 'lex',          label: 'Amazon Lex'     },
  { id: 'agentcorecfn', label: 'AgentCore CFN'  },
  { id: 'elb',          label: 'Load Balancers' },
  { id: 'cloudfront',   label: 'CloudFront'     },
  { id: 'route53',      label: 'Route 53'       },
  { id: 'cognito',      label: 'Cognito'        },
  { id: 'secrets',      label: 'Secrets Manager'},
  { id: 'cwdashboards', label: 'CloudWatch Dashboards' },
  { id: 'cwlogs',       label: 'CloudWatch Logs' },
  { id: 'cloudformation', label: 'CloudFormation' },
]

const activeTab  = ref('overview')
const apmViewRef = ref(null)
const overviewRef = ref(null)
const accessModalOpen = ref(false)
const addingLoadBalancerId = ref('')
const { t } = useI18n()
// Tabs that render their own header, loading and error states.
const SELF_LOADING_TABS = new Set(['apm', 'overview', 'cwlogs', 'cloudformation'])

const selectedProfileName = computed(() => {
  const id = selectedProfileId.value
  if (id.startsWith('local:')) return `${id.slice(6)} (local)`
  return envStore.findById(id)?.name || id
})

// Overview cards open the service tab; the parent keeps the sidebar in sync.
// A CloudFormation resource opens its own tab, filtered by its name.
function openResourceFromStack({ tab, name }) {
  focusResourceByName(tab, name)
  emit('navigate-tab', tab)
}

// Overview opens a tab, or ({ tab, incident }) a tab focused on the
// resources with failures in the last 24 h, worst first, until cleared.
const INCIDENT_SORT = { lambda: 'errors24h', stepfn: 'failed24h', elb: 'healthRank' }
const incidentFocus = ref(null)

function openTabFromOverview(target) {
  const { tab, incident } = typeof target === 'string' ? { tab: target, incident: false } : target
  switchTab(tab)
  if (incident && INCIDENT_SORT[tab]) {
    incidentFocus.value = tab
    if (tab !== 'elb') { sortBy(INCIDENT_SORT[tab]); sortBy(INCIDENT_SORT[tab]) } // descending
  }
  emit('navigate-tab', tab)
}
const tabLoading = ref(false)
const loaded     = reactive(Object.fromEntries(TABS.map(t => [t.id, false])))

const search = reactive(Object.fromEntries(TABS.map(t => [t.id, ''])))

function filterRows(rows, q) {
  if (!q) return rows
  const low = q.toLowerCase()
  return rows.filter(row =>
    Object.values(row).some(v => {
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
      return s.toLowerCase().includes(low)
    })
  )
}

const filteredEc2         = computed(() => filterRows(awsStore.ec2Instances,     search.ec2))
const filteredEcs         = computed(() => filterRows(awsStore.ecsServices,      search.ecs))
const filteredEks         = computed(() => filterRows(awsStore.eksClusters,      search.eks))
const filteredLambda      = computed(() => filterRows(awsStore.lambdas,          search.lambda))

// ── 24h activity and log state (loaded after the table) ──────────────────────
const lambdaActivityLoading = ref(false)
const stepFnActivityLoading = ref(false)
const sqsActivityLoading = ref(false)
const snsActivityLoading = ref(false)
const sesMetricsLoading = ref(false)
async function withFlag(flag, load) {
  flag.value = true
  try { await load() } finally { flag.value = false }
}
const activityAccess = ref(null)
const LOG_STATUS_RANK = { missing: 0, unknown: 1, empty: 2, ok: 3 }
const LOGGING_RANK = { OFF: 0, FATAL: 1, ERROR: 2, ALL: 3 }

async function loadLambdaActivity(options = {}) {
  lambdaActivityLoading.value = true
  try { await awsStore.fetchLambdaActivity(options) } finally { lambdaActivityLoading.value = false }
}
async function loadStepFnActivity(options = {}) {
  stepFnActivityLoading.value = true
  try { await awsStore.fetchStepFnActivity(options) } finally { stepFnActivityLoading.value = false }
}

const lambdaRows = computed(() => {
  const byName = awsStore.lambdaActivity?.functions || {}
  return filteredLambda.value.map(fn => {
    const a = byName[fn.name]
    return a
      ? { ...fn, invocations24h: a.invocations, errors24h: a.errors, logStatus: a.logStatus, logStatusRank: LOG_STATUS_RANK[a.logStatus], logInfo: a }
      : fn
  })
})

function activityNotice(activity, parts) {
  if (!activity) return null
  if (activity.failed) return { text: t('awsActivity.failed', { error: activity.failed }), access: activity.access }
  const failure = parts.map(key => activity[key]).find(Boolean)
  return failure ? { text: t('awsActivity.partial', { reason: failure.error?.message || '' }), access: failure.access } : null
}
const lambdaActivityNotice = computed(() => activityNotice(awsStore.lambdaActivity, ['metricsError', 'logsError']))
const stepFnActivityNotice = computed(() => activityNotice(awsStore.stepFnActivity, ['metricsError', 'loggingError']))

function lambdaLogTitle(fn) {
  const info = fn.logInfo || {}
  const retention = info.retentionInDays ? t('awsActivity.retentionDays', { n: info.retentionInDays }) : t('awsActivity.retentionNever')
  return `${info.logGroup || ''} · ${t(`awsActivity.logHint_${fn.logStatus}`)}${fn.logStatus === 'ok' || fn.logStatus === 'empty' ? ` · ${retention}` : ''}`
}
const filteredApigw       = computed(() => filterRows(awsStore.apiGateways,      search.apigw))
const filteredS3          = computed(() => filterRows(awsStore.s3Buckets,        search.s3))
const filteredEcr         = computed(() => filterRows(awsStore.ecrRepos,         search.ecr))
const filteredVpc         = computed(() => filterRows(awsStore.vpcs,             search.vpc))
const filteredEventBridge = computed(() => filterRows(awsStore.eventBridgeRules, search.eventbridge))
const filteredStepFn      = computed(() => filterRows(awsStore.stepFunctions,    search.stepfn))
const stepFnRows = computed(() => {
  const byArn = awsStore.stepFnActivity?.stateMachines || {}
  return filteredStepFn.value.map(sm => {
    const a = byArn[sm.arn]
    return a
      ? { ...sm, started24h: a.executions?.started ?? null, failed24h: a.executions ? a.executions.failed + a.executions.timedOut : null, logging: a.logging, loggingRank: LOGGING_RANK[a.logging?.level] ?? -1 }
      : sm
  })
})

// ─── Filters (facets) next to the search ─────────────────────────────────────
// Per service, values read from the rows themselves (with counts). Rows whose
// value is unknown (activity not loaded yet) never match a selected filter.
function activityBucket(total, failures) {
  if (total == null) return null
  if (failures > 0) return 'errors'
  return total > 0 ? 'active' : 'idle'
}
const ACTIVITY_ORDER = ['errors', 'active', 'idle']
const FACETS = {
  ec2: [{ id: 'state', label: () => t('th.state'), value: r => r.state || null }],
  ecs: [{ id: 'status', label: () => t('awsFilter.serviceState'), value: r => (r.desired > 0 ? 'running' : 'stopped'), option: v => t(`awsFilter.ecs_${v}`) }],
  lambda: [
    { id: 'runtime', label: () => 'Runtime', value: r => r.runtime || null },
    { id: 'activity', label: () => t('awsFilter.activity'), value: r => activityBucket(r.invocations24h, r.errors24h), option: v => t(`awsFilter.activity_${v}`), order: ACTIVITY_ORDER },
  ],
  stepfn: [
    { id: 'type', label: () => t('th.type'), value: r => r.type || null },
    { id: 'activity', label: () => t('awsFilter.activity'), value: r => activityBucket(r.started24h, r.failed24h), option: v => t(`awsFilter.activity_${v}`), order: ACTIVITY_ORDER },
  ],
  s3: [{ id: 'region', label: () => t('th.region'), value: r => r.region || null }],
}
const facetState = reactive(Object.fromEntries(Object.entries(FACETS).map(([tab, facets]) => [tab, Object.fromEntries(facets.map(f => [f.id, '']))])))

function applyFacets(tab, rows) {
  const selected = (FACETS[tab] || []).filter(f => facetState[tab][f.id])
  if (!selected.length) return rows
  return rows.filter(row => selected.every(f => f.value(row) === facetState[tab][f.id]))
}
function hasFilters(tab) {
  return !!search[tab] || Object.values(facetState[tab] || {}).some(Boolean) || incidentFocus.value === tab
}
function clearFilters(tab) {
  search[tab] = ''
  for (const id of Object.keys(facetState[tab] || {})) facetState[tab][id] = ''
  if (incidentFocus.value === tab) incidentFocus.value = null
}
watch(() => awsStore.activeProfileId, () => {
  for (const tab of Object.keys(facetState)) for (const id of Object.keys(facetState[tab])) facetState[tab][id] = ''
})

// Rows shown in the tables: search, then the Overview incident focus, then the filters.
const lambdaBaseRows = computed(() => (incidentFocus.value === 'lambda' ? lambdaRows.value.filter(fn => fn.errors24h > 0) : lambdaRows.value))
const stepFnBaseRows = computed(() => (incidentFocus.value === 'stepfn' ? stepFnRows.value.filter(sm => sm.failed24h > 0) : stepFnRows.value))
const facetBaseRows = { ec2: filteredEc2, ecs: filteredEcs, s3: filteredS3, lambda: lambdaBaseRows, stepfn: stepFnBaseRows }
const ec2TableRows = computed(() => applyFacets('ec2', filteredEc2.value))
const ecsTableRows = computed(() => applyFacets('ecs', filteredEcs.value))
const s3TableRows = computed(() => applyFacets('s3', filteredS3.value))
const lambdaTableRows = computed(() => applyFacets('lambda', lambdaBaseRows.value))
const stepFnTableRows = computed(() => applyFacets('stepfn', stepFnBaseRows.value))

// Options of the active tab's filters, counted on the rows the filters start from.
const activeFacets = computed(() => (FACETS[activeTab.value] || []).map(facet => {
  const counts = new Map()
  for (const row of facetBaseRows[activeTab.value]?.value || []) {
    const value = facet.value(row)
    if (value != null) counts.set(value, (counts.get(value) || 0) + 1)
  }
  const options = [...counts.entries()]
    .sort((a, b) => (facet.order ? facet.order.indexOf(a[0]) - facet.order.indexOf(b[0]) : String(a[0]).localeCompare(String(b[0]))))
    .map(([value, count]) => ({ value, count, label: facet.option ? facet.option(value) : value }))
  return { id: facet.id, label: facet.label(), options }
}))
const ELB_ATTENTION = ['warning', 'critical']
const incidentCount = computed(() => ({
  lambda: lambdaActivityLoading.value ? '…' : lambdaTableRows.value.length,
  stepfn: stepFnActivityLoading.value ? '…' : stepFnTableRows.value.length,
  elb: (awsStore.loadBalancers || []).filter(lb => ELB_ATTENTION.includes(lb.health?.status)).length,
}[incidentFocus.value] ?? 0))

function stepFnLoggingTitle(sm) {
  if (sm.logging.level === 'OFF') return t('awsActivity.loggingOffHint')
  return `${sm.logging.logGroup || ''} · ${sm.logging.includeExecutionData ? t('awsActivity.withExecutionData') : t('awsActivity.withoutExecutionData')}`
}
const filteredDynamo      = computed(() => filterRows(awsStore.dynamoTables,     search.dynamodb))
const filteredRds         = computed(() => filterRows(awsStore.rdsClusters,      search.rds))
const filteredGlue        = computed(() => filterRows(awsStore.glueJobs,         search.glue))
const filteredAthena      = computed(() => filterRows(awsStore.athenaWorkgroups, search.athena))
const filteredPipelines   = computed(() => filterRows(awsStore.dataPipelines,    search.datapipeline))
const filteredBedrock     = computed(() => filterRows(awsStore.bedrockModels,    search.bedrock))
const filteredLex         = computed(() => filterRows(awsStore.lexBots,          search.lex))

// ─── Lex Panel (master-detail) ────────────────────────────────────────────────
const lexPanel = reactive({ bot: null, innerTab: 'intents' })
const lexInnerTabs = computed(() => [
  { id: 'intents',  label: 'Intents' },
  { id: 'aliases',  label: 'Aliases' },
  { id: 'slottypes',label: 'Slot Types' },
  { id: 'chat',     label: 'Chat' },
  { id: 'logs',     label: 'Logs' },
  { id: 'missed',   label: t('awsv.tabMissed') },
  { id: 'metrics',  label: t('awsv.tabMetrics') },
  { id: 'testset',  label: 'Test Set' },
])
const lexVersionOptions = ref(['DRAFT'])

function selectLexBot(bot) {
  const sameBot = lexPanel.bot?.id === bot.id
  lexPanel.bot = bot
  if (!sameBot) lexPanel.innerTab = 'intents'
  lexPanelSwitchTab(lexPanel.innerTab)
}

async function lexPanelSwitchTab(tab) {
  lexPanel.innerTab = tab
  const bot = lexPanel.bot
  if (!bot) return
  const id = bot.id
  if (tab === 'intents') {
    if (lexIntentsModal.botId === id && lexIntentsModal.locales.length) return
    Object.assign(lexIntentsModal, { loading: true, error: null, botId: id, botName: bot.name, botVersion: 'DRAFT', locales: [], activeLocale: null, activeIntent: null, activeView: 'list' })
    try {
      await loadLexVersionOptions(id)
      await reloadLexIntents()
    } catch (e) { lexIntentsModal.error = e?.message || 'Error loading intents' }
    finally { lexIntentsModal.loading = false }
  } else if (tab === 'aliases') {
    if (lexAliasesModal.bot?.id === id && lexAliasesModal.aliases.length) return
    Object.assign(lexAliasesModal, { loading: true, error: null, bot, botName: bot.name, botArn: null, aliases: [], showCreate: false, creating: false, createError: null, createForm: { name: '', botVersion: 'DRAFT', description: '' } })
    try {
      const data = await awsStore.fetchLexAliases(id)
      lexAliasesModal.botArn  = data.botArn || null
      lexAliasesModal.aliases = data.aliases || data
    } catch (e) { lexAliasesModal.error = e?.message || 'Error loading aliases' }
    finally { lexAliasesModal.loading = false }
  } else if (tab === 'slottypes') {
    if (lexSlotTypesModal.botId === id && lexSlotTypesModal.locales.length) return
    Object.assign(lexSlotTypesModal, { loading: true, error: null, botId: id, botName: bot.name, botVersion: 'DRAFT', locales: [], activeLocale: null })
    try {
      await loadLexVersionOptions(id)
      await reloadLexSlotTypes()
    } catch (e) { lexSlotTypesModal.error = e?.message || 'Error loading slot types' }
    finally { lexSlotTypesModal.loading = false }
  } else if (tab === 'chat') {
    if (lexChatModal.botId === id) return
    Object.assign(lexChatModal, { sending: false, error: null, botId: id, botName: bot.name, aliasId: 'TSTALIASID', localeId: '', sessionId: `kua-${Date.now()}`, input: '', messages: [], aliases: [], locales: [] })
    try {
      const [intents, aliasData] = await Promise.all([
        awsStore.fetchLexIntents(id),
        awsStore.fetchLexAliases(id).catch(() => ({ aliases: [] })),
      ])
      lexChatModal.locales  = intents.map(l => ({ localeId: l.localeId, localeName: l.localeName }))
      lexChatModal.localeId = lexChatModal.locales[0]?.localeId || ''
      const rawAliases = aliasData.aliases || aliasData
      lexChatModal.aliases = rawAliases.filter(a => a.id !== 'TSTALIASID')
    } catch (_) {}
  } else if (tab === 'logs') {
    if (lexLogsModal.botId === id) return
    Object.assign(lexLogsModal, { loading: true, error: null, botId: id, botName: bot.name, hours: 24, aliasId: '', localeId: '', aliases: [], configured: false, groups: [], events: [] })
    await reloadLexLogs()
  } else if (tab === 'missed') {
    if (lexMissedModal.botId === id) return
    Object.assign(lexMissedModal, { loading: true, error: null, botId: id, botName: bot.name, hours: 24, aliasId: '', localeId: '', aliases: [], configured: false, logGroupName: '', utterances: [] })
    await reloadLexMissed()
  } else if (tab === 'metrics') {
    if (lexMetricsModal.botId === id) return
    Object.assign(lexMetricsModal, { loading: true, error: null, botId: id, botName: bot.name, hours: 24, localeId: '', metrics: {}, locales: [], buildLocale: null, building: false, buildResult: null })
    try {
      const intents = await awsStore.fetchLexIntents(id)
      lexMetricsModal.locales = intents.map(l => ({ localeId: l.localeId, localeName: l.localeName }))
      if (lexMetricsModal.locales.length) lexMetricsModal.buildLocale = lexMetricsModal.locales[0].localeId
    } catch (_) {}
    await reloadLexMetrics()
  } else if (tab === 'testset') {
    if (lexTestSetModal.botId === id && lexTestSetModal.testSets.length) return
    Object.assign(lexTestSetModal, { loading: true, error: null, botId: id, botName: bot.name, activeView: 'existing', testSets: [], intentsLoaded: false, loadingIntents: false, generatedCases: [] })
    try {
      lexTestSetModal.testSets = await awsStore.fetchLexTestSets(id)
    } catch (e) { lexTestSetModal.error = e?.message || 'Error loading test sets' }
    finally { lexTestSetModal.loading = false }
  }
}

const filteredAgentCoreCfn= computed(() => filterRows(awsStore.cfnStacks,        search.agentcorecfn))
const filteredCloudfront  = computed(() => filterRows(awsStore.cloudfrontDists,  search.cloudfront))
const filteredRoute53     = computed(() => filterRows(awsStore.route53Zones,     search.route53))
const filteredCognito     = computed(() => filterRows(awsStore.cognitoUserPools, search.cognito))
const filteredSecrets     = computed(() => filterRows(awsStore.secrets,          search.secrets))
const filteredCwDashboards = computed(() => filterRows(awsStore.cwDashboards,    search.cwdashboards))
const dashboardDetail     = ref(null)
const dashboardView       = ref(null)

const tabFilteredMap = {
  ec2: ec2TableRows, ecs: ecsTableRows, eks: filteredEks,
  lambda: lambdaTableRows, apigw: filteredApigw, s3: s3TableRows,
  ecr: filteredEcr, vpc: filteredVpc, eventbridge: filteredEventBridge, stepfn: stepFnTableRows,
  dynamodb: filteredDynamo, rds: filteredRds, glue: filteredGlue,
  athena: filteredAthena, datapipeline: filteredPipelines,
  bedrock: filteredBedrock, lex: filteredLex, agentcorecfn: filteredAgentCoreCfn,
  elb: computed(() => filterRows(awsStore.loadBalancers, search.elb)),
  cloudfront: filteredCloudfront, route53: filteredRoute53,
  cognito: filteredCognito, secrets: filteredSecrets,
  cwdashboards: filteredCwDashboards,
  sqs: computed(() => filterRows(awsStore.sqsQueues, search.sqs)),
  sns: computed(() => filterRows(awsStore.snsTopics, search.sns)),
  ses: computed(() => filterRows(awsStore.sesData?.identities || [], search.ses)),
}

const activeRowCount = computed(() => tabFilteredMap[activeTab.value]?.value?.length ?? 0)

function tabCount(id) {
  const map = {
    ec2: awsStore.ec2Instances, ecs: awsStore.ecsServices, eks: awsStore.eksClusters,
    lambda: awsStore.lambdas, apigw: awsStore.apiGateways, s3: awsStore.s3Buckets,
    ecr: awsStore.ecrRepos, vpc: awsStore.vpcs, eventbridge: awsStore.eventBridgeRules,
    stepfn: awsStore.stepFunctions,
    dynamodb: awsStore.dynamoTables,
    rds: awsStore.rdsClusters,
    glue: awsStore.glueJobs, athena: awsStore.athenaWorkgroups,
    datapipeline: awsStore.dataPipelines,
    bedrock: awsStore.bedrockModels, lex: awsStore.lexBots, agentcorecfn: awsStore.cfnStacks,
    elb: awsStore.loadBalancers,
    cloudfront: awsStore.cloudfrontDists,
    route53: awsStore.route53Zones, cognito: awsStore.cognitoUserPools,
    secrets: awsStore.secrets,
    cwdashboards: awsStore.cwDashboards,
    sqs: awsStore.sqsQueues, sns: awsStore.snsTopics, ses: awsStore.sesData?.identities,
  }
  return map[id]?.length ?? 0
}

const fetchMap = {
  // The overview mounts with the view; wait a tick so its ref exists on first load.
  overview:     async (o = {}) => { await nextTick(); return overviewRef.value?.load({ force: o.force }) },
  apm:          () => apmViewRef.value?.refreshLocal(),
  ec2:          () => awsStore.fetchEc2Instances(),
  ecs:          () => awsStore.fetchEcsServices(),
  eks:          () => awsStore.fetchEksClusters(),
  // Activity (billed CloudWatch metrics) is cached; auto-refresh reuses it, manual refresh forces it.
  lambda:       async (o = {}) => { await awsStore.fetchLambdas(); loadLambdaActivity({ force: o.force }) },
  apigw:        () => awsStore.fetchApiGateways(),
  s3:           () => awsStore.fetchS3Buckets(),
  ecr:          () => awsStore.fetchEcrRepos(),
  vpc:          () => awsStore.fetchVpcs(),
  eventbridge:  () => awsStore.fetchEventBridgeRules(),
  stepfn:       async (o = {}) => { await awsStore.fetchStepFunctions({ force: o.force }); loadStepFnActivity({ force: o.force }) },
  // SQS listing is billed per request; activity and SES metrics are cached (GetMetricData).
  sqs:          async (o = {}) => { await awsStore.fetchSqsQueues(); withFlag(sqsActivityLoading, () => awsStore.fetchSqsActivity({ force: o.force })) },
  sns:          async (o = {}) => { await awsStore.fetchSnsTopics(); withFlag(snsActivityLoading, () => awsStore.fetchSnsActivity({ force: o.force })) },
  ses:          async (o = {}) => { await awsStore.fetchSes(); withFlag(sesMetricsLoading, () => awsStore.fetchSesMetrics({ force: o.force })) },
  dynamodb:     () => awsStore.fetchDynamoTables(),
  rds:          () => awsStore.fetchRdsClusters(),
  glue:         () => awsStore.fetchGlueJobs(),
  athena:       () => Promise.all([awsStore.fetchAthenaWorkgroups(), loadAthenaCatalogs()]),
  datapipeline: () => awsStore.fetchDataPipelines(),
  bedrock:      () => awsStore.fetchBedrockModels(),
  lex:          () => awsStore.fetchLexBots(),
  agentcorecfn: () => awsStore.fetchCloudformationStacks(true),
  elb:          () => awsStore.fetchLoadBalancers(),
  cloudfront:   () => awsStore.fetchCloudfrontDists(),
  route53:      () => awsStore.fetchRoute53Zones(),
  cognito:      () => awsStore.fetchCognitoUserPools(),
  secrets:      () => awsStore.fetchSecrets(),
  cwdashboards: () => awsStore.fetchCwDashboards(),
}

async function loadApmInventory() {
  await Promise.all([
    awsStore.fetchLambdas(),
    awsStore.fetchLoadBalancers(),
    awsStore.fetchEcsServices(),
    awsStore.fetchEventBridgeRules(),
    awsStore.fetchStepFunctions(),
  ])
}

async function addLoadBalancerToApplication(loadBalancer) {
  if (!props.applicationId || !selectedProfileId.value || !loadBalancer?.arn || addingLoadBalancerId.value) return
  addingLoadBalancerId.value = loadBalancer.arn
  try {
    apmStore.setActiveProfile(selectedProfileId.value, 'aws')
    await apmStore.addResource(props.applicationId, {
      provider: 'aws',
      type: 'elb',
      key: loadBalancer.arn,
      arn: loadBalancer.arn,
      name: loadBalancer.name,
      service: loadBalancer.dnsName || '',
      kind: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
      metadata: { targetGroups: (loadBalancer.targetGroups || []).map(group => group.arn).filter(Boolean) },
      associationSource: 'manual',
    })
    await apmStore.selectApplication(props.applicationId)
    toast(t('kuapps.add.done'), 'success')
  } catch (error) {
    toast(error.message || String(error), 'error')
  } finally {
    addingLoadBalancerId.value = ''
  }
}

// When each tab's list was last read, shown next to its counter. A ticking
// clock keeps "read 3 min ago" current without reloading anything.
const readAt = reactive({})
const clockNow = ref(Date.now())
let freshnessClock = null
onMounted(() => { freshnessClock = setInterval(() => { clockNow.value = Date.now() }, 30000) })
onUnmounted(() => clearInterval(freshnessClock))
watch(() => awsStore.activeProfileId, () => { for (const id of Object.keys(readAt)) delete readAt[id] })
function agoText(ts) {
  const seconds = Math.max(0, Math.round((clockNow.value - ts) / 1000))
  if (seconds < 60) return t('awsFresh.justNow')
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? t('overview.agoMinutes', { n: minutes }) : t('awsFresh.agoHours', { n: Math.round(minutes / 60) })
}

async function loadTab(id, options = {}) {
  if (loaded[id]) return
  if (!options.background) tabLoading.value = true
  try {
    const load = () => fetchMap[id]?.(options)
    await (options.background ? awsStore.runInBackground(load) : load())
    loaded[id] = true
    readAt[id] = Date.now()
  } finally {
    if (!options.background) tabLoading.value = false
  }
}

// Auto-refresh reloads a table at most every `awsListRefreshSec` (Options):
// some list APIs are billed per call (SQS). Manual refreshes always load.
const refreshGate = createRefreshGate()

async function reloadActiveTab(options = {}) {
  const gateKey = `${selectedProfileId.value}|${activeTab.value}`
  if (options.background && refreshGate.fresh(gateKey, appSettings.awsListRefreshSec)) return
  refreshGate.mark(gateKey)
  loaded[activeTab.value] = false
  await loadTab(activeTab.value, options)
}

// Used by Architecture Canvas node actions to jump straight to a resource by name.
function focusResourceByName(tab, name) {
  if (activeTab.value !== tab) switchTab(tab)
  search[tab] = name || ''
}

function openLambdaLogsByName(name) {
  if (name) openLogs('lambda', name)
}

defineExpose({ reloadActiveTab, focusResourceByName, openLambdaLogsByName })

function switchTab(id) {
  activeTab.value = id
  incidentFocus.value = null
  resetSort()
  loadTab(id)
}

watch(() => props.activeService, (newTab) => {
  if (newTab && newTab !== activeTab.value) switchTab(newTab)
}, { immediate: true })

onMounted(async () => {
  envStore.fetchProfiles()
  try { localProfiles.value = await apiFetch('/api/cloud/aws/local-profiles') } catch { /* ignore */ }
  if (selectedProfileId.value) loadTab(activeTab.value)
  nextTick(() => createIcons({ icons }))
})

watch(() => awsStore.activeProfileId, (newId) => {
  if ((newId || '') !== selectedProfileId.value) {
    selectedProfileId.value = newId || ''
    if (newId) {
      Object.keys(loaded).forEach(k => { loaded[k] = false })
      loadTab(activeTab.value)
    }
  }
})

function onProfileChange() {
  awsStore.setActiveProfile(selectedProfileId.value || null)
  Object.keys(loaded).forEach(k => { loaded[k] = false })
  if (selectedProfileId.value) loadTab(activeTab.value)
}

// ─── Context band ────────────────────────────────────────────────────────────
// Profile, account and region stay visible on every service tab, so the
// destination is known without going back to Overview. Global services say
// that the selected region does not filter them.
const GLOBAL_TABS = new Set(['s3', 'cloudfront', 'route53'])
const CONTEXT_HIDDEN_TABS = new Set(['overview', 'apm']) // Overview shows the full identity

const contextAccount = computed(() => {
  const ctx = awsStore.accountContext
  if (!ctx) return null
  if (!ctx.account) return t('awsv.op.unknown')
  const alias = awsStore.overview?.identity?.account === ctx.account ? awsStore.overview.identity.alias : null
  return alias ? `${alias} (${ctx.account})` : ctx.account
})

watch(() => [awsStore.activeProfileId, activeTab.value], ([id, tab]) => {
  if (id && !CONTEXT_HIDDEN_TABS.has(tab)) awsStore.fetchAccountContext()
}, { immediate: true })

// ─── Confirmed operations (EC2/ECS start and stop) ───────────────────────────
// Each write first shows its destination (resource, account, profile, region)
// and impact. Cancelling sends nothing; the target is copied when the dialog
// opens, and the busy state blocks a second request.
const opConfirm = reactive({
  open: false, title: '', message: '', tone: 'info', confirmLabel: '',
  resourceLines: [], busy: false, error: '', run: null,
})

const opConfirmLines = computed(() => [
  ...opConfirm.resourceLines,
  t('awsv.op.destination', {
    account: contextAccount.value ?? t('state.loading'),
    profile: selectedProfileName.value,
    region: awsStore.accountContext ? (awsStore.accountContext.region || t('awsv.op.unknown')) : t('state.loading'),
  }),
])

function askOperation({ title, message, tone, confirmLabel, resourceLines, run }) {
  Object.assign(opConfirm, { open: true, title, message, tone, confirmLabel, resourceLines, run, busy: false, error: '' })
  awsStore.fetchAccountContext()
}

async function confirmOperation() {
  if (opConfirm.busy || !opConfirm.run) return
  opConfirm.busy = true
  opConfirm.error = ''
  try {
    const error = await opConfirm.run()
    if (error) opConfirm.error = error
    else opConfirm.open = false
  } finally {
    opConfirm.busy = false
  }
}

// EKS nodes and Auto Scaling members are replaced or drained by their owner.
function ec2ManagedLines(tags = []) {
  const value = key => tags.find(tag => tag.Key === key)?.Value
  const eks = value('eks:cluster-name')
    || tags.find(tag => tag.Key?.startsWith('kubernetes.io/cluster/'))?.Key.slice('kubernetes.io/cluster/'.length)
  const asg = value('aws:autoscaling:groupName')
  return [
    ...(eks ? [t('awsv.op.managedEks', { cluster: eks })] : []),
    ...(asg ? [t('awsv.op.managedAsg', { group: asg })] : []),
  ]
}

function ec2Operation(instance, action) {
  const i = { ...instance, tags: [...(instance.tags || [])] }
  const stop = action === 'stop'
  askOperation({
    title: t(stop ? 'awsv.op.stopEc2Title' : 'awsv.op.startEc2Title', { name: i.name || i.id }),
    message: t(stop ? 'awsv.op.stopEc2Impact' : 'awsv.op.startEc2Impact'),
    tone: stop ? 'danger' : 'warning',
    confirmLabel: t(stop ? 'awsv.op.stopEc2' : 'awsv.op.startEc2'),
    resourceLines: [
      t('awsv.op.instance', { name: i.name || '—', id: i.id }),
      t('awsv.op.currentState', { state: i.state || '?' }),
      ...ec2ManagedLines(i.tags),
    ],
    run: async () => {
      const r = stop ? await awsStore.stopEc2Instance(i.id) : await awsStore.startEc2Instance(i.id)
      if (!r) return awsStore.error || 'Error'
      toast(t(stop ? 'awsv.toastStopping' : 'awsv.toastStarting', { name: i.name || i.id }), 'success')
      setTimeout(() => { loaded.ec2 = false; loadTab('ec2') }, 2500)
    },
  })
}
const startEc2 = i => ec2Operation(i, 'start')
const stopEc2 = i => ec2Operation(i, 'stop')

// Start sets desiredCount to 1 and Stop to 0 (routes/aws.js).
function ecsOperation(service, action) {
  const svc = { ...service }
  const stop = action === 'stop'
  askOperation({
    title: t(stop ? 'awsv.op.stopEcsTitle' : 'awsv.op.startEcsTitle', { name: svc.name }),
    message: stop
      ? t('awsv.op.stopEcsImpact', { desired: svc.desired ?? '?', running: svc.running ?? '?' })
      : t('awsv.op.startEcsImpact', { desired: svc.desired ?? '?' }),
    tone: stop ? 'danger' : 'warning',
    confirmLabel: t(stop ? 'awsv.op.stopEcs' : 'awsv.op.startEcs'),
    resourceLines: [
      t('awsv.op.ecsService', { name: svc.name, cluster: svc.cluster }),
      t('awsv.op.ecsCounts', { desired: svc.desired ?? '?', running: svc.running ?? '?' }),
    ],
    run: async () => {
      const r = stop ? await awsStore.stopEcsService(svc.cluster, svc.name) : await awsStore.startEcsService(svc.cluster, svc.name)
      if (!r) return awsStore.error || 'Error'
      toast(t(stop ? 'awsv.toastStopped' : 'awsv.toastStarted', { name: svc.name }), 'success')
      loaded.ecs = false
      loadTab('ecs')
    },
  })
}
const startEcs = svc => ecsOperation(svc, 'start')
const stopEcs = svc => ecsOperation(svc, 'stop')

// Row "More" menus: secondary actions, then (after a separator) the ones that
// change or run the resource, so reading and diagnosing do not sit next to them.
function ec2MenuItems(i) {
  return [
    { id: 'tags', label: t('th.tags'), onSelect: () => openTags('ec2', `EC2: ${i.name}`, i.id, i.tags) },
    { id: 'config', label: t('sidebar.config'), onSelect: () => openConfig('ec2', `EC2: ${i.name}`, i, { id: i.id }) },
    { id: 'start', separator: true, label: t('awsv.op.startEc2'), disabled: i.state === 'running', onSelect: () => startEc2(i) },
    { id: 'stop', label: t('awsv.op.stopEc2'), danger: true, disabled: i.state === 'stopped', onSelect: () => stopEc2(i) },
  ]
}
function lambdaMenuItems(fn) {
  return [
    { id: 'tags', label: t('th.tags'), onSelect: () => openTags('lambda', `Lambda: ${fn.name}`, fn.arn, fn.tags) },
    { id: 'config', label: t('sidebar.config'), onSelect: () => openConfig('lambda', `Lambda: ${fn.name}`, fn, { name: fn.name }) },
    { id: 'logging', label: t('awsv.act.configureLogging'), title: t('awsv.act.configureLoggingHint'), onSelect: () => openLogging('lambda', fn) },
    { id: 'invoke', separator: true, label: t('awsv.act.invoke'), onSelect: () => openInvoke(fn) },
  ]
}
function ecsMenuItems(svc) {
  return [
    { id: 'config', label: t('sidebar.config'), onSelect: () => openConfig('ecs', `ECS: ${svc.name}`, svc, { cluster: svc.cluster, name: svc.name }) },
    { id: 'logging', label: t('awsv.act.configureLogging'), title: t('awsv.act.configureLoggingHint'), onSelect: () => openLogging('ecs', svc) },
    { id: 'start', separator: true, label: t('awsv.op.startEcs'), disabled: svc.desired > 0, title: svc.desired > 0 ? t('awsv.op.ecsAlreadyRunning') : '', onSelect: () => startEcs(svc) },
    { id: 'stop', label: t('awsv.op.stopEcs'), danger: true, disabled: svc.desired === 0, onSelect: () => stopEcs(svc) },
  ]
}

const configModal = reactive({
  open: false, loading: false, error: null, fullLoaded: false,
  title: '', view: 'json', service: '', params: null, data: null,
})

const configDisplay = computed(() => {
  if (!configModal.data) return '(empty)'
  if (configModal.view === 'yaml') {
    try { return jsYaml.dump(configModal.data, { indent: 2, lineWidth: 120 }) }
    catch { return JSON.stringify(configModal.data, null, 2) }
  }
  return JSON.stringify(configModal.data, null, 2)
})

function openConfig(service, title, item, params) {
  Object.assign(configModal, {
    service, title, params, data: item,
    fullLoaded: false, error: null, loading: false, open: true,
  })
}

async function fetchFullConfig() {
  configModal.loading = true; configModal.error = null
  try {
    const data = await awsStore.fetchResourceConfig(configModal.service, configModal.params)
    if (data) { configModal.data = data; configModal.fullLoaded = true }
    else configModal.error = awsStore.error || 'Failed to fetch config'
  } finally { configModal.loading = false }
}

function copyConfig() {
  navigator.clipboard?.writeText(configDisplay.value)
    .then(() => toast(t('res.copied'), 'success'))
    .catch(() => toast(t('term.copyFailed'), 'error'))
}

const logsModal = reactive({
  open: false, loading: false, error: null,
  type: '', name: '', cluster: null, minutes: 60,
  logGroupName: null, events: [],
})

async function openLogs(type, name, cluster = null) {
  Object.assign(logsModal, { type, name, cluster, minutes: 60, events: [], error: null, logGroupName: null, open: true })
  await reloadLogs()
}

async function reloadLogs() {
  logsModal.loading = true; logsModal.error = null
  try {
    const data = await awsStore.fetchLogs(logsModal.type, logsModal.name, logsModal.cluster, logsModal.minutes)
    if (!data) { logsModal.error = awsStore.error || 'Failed'; return }
    if (data.logGroupStatus === 'missing') logsModal.error = t('awsActivity.noLogGroup', { group: data.logGroupName })
    else if (data.message && !data.events?.length) logsModal.error = data.message
    logsModal.logGroupName = data.logGroupName ?? null
    logsModal.events       = data.events ?? []
  } catch (e) { logsModal.error = e.message }
  finally     { logsModal.loading = false }
}

const invokeModal = reactive({ open: false, loading: false, name: '', payload: '{}', result: null })

function openInvoke(fn) {
  Object.assign(invokeModal, { name: fn.name, payload: '{}', result: null, open: true })
  awsStore.fetchAccountContext()
}

async function submitInvoke() {
  invokeModal.loading = true; invokeModal.result = null
  try {
    let payload = {}
    try { payload = JSON.parse(invokeModal.payload) }
    catch { toast(t('awsv.toastInvalidJson'), 'error'); invokeModal.loading = false; return }
    const data = await awsStore.invokeLambda(invokeModal.name, payload)
    invokeModal.result = data
    if (data?.functionError) toast(t('awsv.toastLambdaError', { error: data.functionError }), 'error')
  } finally { invokeModal.loading = false }
}

// Dates follow the app language, not the operating system's locale.
const dateLocale = () => (settings.lang === 'es' ? 'es' : 'en-US')
// Missing or unreadable dates (e.g. {} in snapshots cached before the cloudHistory fix) render as '—'.
function toDate(value) {
  if (value === null || value === undefined || value === '' || (typeof value === 'object' && !(value instanceof Date))) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
function formatDate(d) {
  return toDate(d)?.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'short', day: '2-digit' }) ?? '—'
}
function formatTs(ts) {
  return toDate(ts)?.toLocaleString(dateLocale(), {
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) ?? '—'
}
function ec2StateClass(s) {
  return s === 'running' ? 'status-ok' : (s === 'pending' || s === 'stopping') ? 'status-warn' : 'status-err'
}
function ecsStatusClass(s) {
  return s === 'ACTIVE' ? 'status-ok' : s === 'DRAINING' ? 'status-warn' : 'status-err'
}
function eksStatusClass(s) {
  return s === 'ACTIVE' ? 'status-ok' : (s === 'CREATING' || s === 'UPDATING') ? 'status-warn' : 'status-err'
}
// ─── EC2 SSH Shell Modal ──────────────────────────────────────────────────────

function openEc2Shell(instance) {
  openRemoteSession('ssh', instance)
}

// ─── EC2 RDP Info Modal ───────────────────────────────────────────────────────

function openEc2Rdp(instance) {
  openRemoteSession('rdp', instance)
}

// ─── EC2 SSM (Session Manager) — opens directly in the shared Console session,
// no manual host/user form needed since SSM only needs the instance id ─────────

function openEc2Ssm(instance) {
  termStore.openCloudTab('ssm', instance.name || instance.id, {
    profileId: selectedProfileId.value,
    environment: props.environment,
    applicationId: props.applicationId,
    target: { instanceId: instance.id },
  })
}

function openRemoteSession(type, instance) {
  const id = `${type}:${instance.id}`
  let session = remoteSessions.value.find(s => s.id === id)
  if (!session) {
    session = { id, type, instance, open: true, createdAt: Date.now() }
    remoteSessions.value.push(session)
  } else {
    session.instance = instance
    session.open = true
  }
  nextTick(() => createIcons({ icons }))
}

function showRemoteSession(id) {
  const session = remoteSessions.value.find(s => s.id === id)
  if (session) session.open = true
}

function removeRemoteSession(id) {
  const idx = remoteSessions.value.findIndex(s => s.id === id)
  if (idx !== -1) remoteSessions.value.splice(idx, 1)
}

function sessionTitle(session) {
  const host = session.instance?.publicIp || session.instance?.privateIp || ''
  return `${session.type.toUpperCase()} ${session.instance?.name || session.instance?.id}${host ? ` - ${host}` : ''}`
}

// ─── EC2 Detail Modal ────────────────────────────────────────────────────────

const ec2DetailModal = reactive({ open: false, instance: null })
function openEc2Detail(instance) {
  Object.assign(ec2DetailModal, { open: true, instance })
}

// ─── Lambda Detail Modal ─────────────────────────────────────────────────────

const lambdaDetailModal = reactive({ open: false, fn: null })
function openLambdaDetail(fn) {
  Object.assign(lambdaDetailModal, { open: true, fn })
}

// ─── API Gateway Routes Modal ─────────────────────────────────────────────────

const apigwRoutesModal = reactive({
  open: false, loading: false, error: null,
  name: '', apiType: 'REST', integrations: [],
})

async function openApigwRoutes(api) {
  Object.assign(apigwRoutesModal, {
    open: true, loading: true, error: null,
    name: api.name, apiType: api.type || 'REST', integrations: [],
  })
  try {
    const data = await awsStore.fetchApigwIntegrations(api.id, api.type || 'REST')
    if (data) {
      apigwRoutesModal.integrations = data.integrations || []
    } else {
      apigwRoutesModal.error = awsStore.error || 'Failed to load integrations'
    }
  } catch (e) { apigwRoutesModal.error = e?.message || 'Error' }
  finally     { apigwRoutesModal.loading = false }
}

// ─── EKS Add to Dashboard ─────────────────────────────────────────────────────

const eksObservabilityModal = reactive({ open: false, cluster: null })

const eksDetailModal = reactive({ open: false, cluster: null })

function openEksDetail(cluster) {
  eksDetailModal.cluster = cluster
  eksDetailModal.open    = true
}

function openEksObservability(cluster) {
  Object.assign(eksObservabilityModal, { open: true, cluster })
}

async function addEksToKubeconfig(cluster) {
  try {
    toast(t('awsv.toastAddingKubeconfig', { name: cluster.name }), 'info')
    const data = await awsStore.addEksKubeconfig(cluster.name)
    if (data) {
      toast(data.message || `${cluster.name} added successfully!`, 'success')
    } else {
      toast(awsStore.error || 'Failed to add kubeconfig', 'error')
    }
  } catch (e) { toast(e?.message || 'Error', 'error') }
}

// ─── S3 Browser Modal ─────────────────────────────────────────────────────────

const s3BrowserModal = reactive({ open: false, bucket: '', region: '' })
function openS3Browser(b) {
  Object.assign(s3BrowserModal, { open: true, bucket: b.name, region: b.region || '' })
}

// ─── S3 Create Bucket ─────────────────────────────────────────────────────────

const createS3Modal = reactive({
  open: false, loading: false, error: null,
  name: '', region: 'us-east-1', blockPublicAccess: true,
})

function openCreateS3Modal() {
  Object.assign(createS3Modal, { open: true, loading: false, error: null, name: '', region: 'us-east-1', blockPublicAccess: true })
}

async function doCreateS3Bucket() {
  if (!createS3Modal.name.trim()) return
  createS3Modal.loading = true; createS3Modal.error = null
  try {
    const result = await awsStore.createS3Bucket(createS3Modal.name.trim(), createS3Modal.region, createS3Modal.blockPublicAccess)
    if (result?.created) {
      toast(t('awsv.toastBucketCreated', { name: result.name, region: result.region }), 'success')
      createS3Modal.open = false
      await awsStore.fetchS3Buckets()
    } else {
      createS3Modal.error = awsStore.error || result?.error || 'Failed to create bucket'
    }
  } catch (e) {
    createS3Modal.error = e?.message || 'Error'
  } finally {
    createS3Modal.loading = false
  }
}

// ─── S3 Endpoint Test ─────────────────────────────────────────────────────────

const s3TestState = reactive({}) // keyed by bucket name: { loading, ok, msg }

async function testS3Bucket(bucketName) {
  if (!s3TestState[bucketName]) s3TestState[bucketName] = {}
  s3TestState[bucketName].loading = true
  s3TestState[bucketName].ok = null
  try {
    const r = await awsStore.testS3Bucket(bucketName)
    if (r?.accessible) {
      s3TestState[bucketName].ok  = true
      s3TestState[bucketName].msg = `OK · ${r.latencyMs}ms · ${r.region}`
      toast(t('awsv.toastS3Accessible', { name: bucketName, ms: r.latencyMs, region: r.region }), 'success')
    } else {
      s3TestState[bucketName].ok  = false
      s3TestState[bucketName].msg = r?.reason || t('awsv.act.notAccessible')
      toast(`S3 "${bucketName}" — ${r?.reason || t('awsv.notAccessible')}`, 'error')
    }
  } catch (e) {
    s3TestState[bucketName].ok  = false
    s3TestState[bucketName].msg = e?.message || t('awsv.act.checkFailed')
  } finally {
    s3TestState[bucketName].loading = false
  }
}

// ─── VPC Info Modal ───────────────────────────────────────────────────────────

const vpcDetailModal = reactive({ open: false, vpc: null })

function openVpcDetail(v) {
  vpcDetailModal.vpc  = v
  vpcDetailModal.open = true
}

// ─── ECR Deploy to K8s Modal ─────────────────────────────────────────────────

const ecrDeployModal = reactive({
  open: false, loadingImages: false, applying: false,
  repoName: '', repoUri: '',
  images: [], selectedTag: '',
  appName: '', namespace: 'default', replicas: 1, port: 8080,
  context: '', pullSecret: '',
  createService: false, serviceType: 'ClusterIP',
  applyResult: null,
})

const ecrDeployYaml = computed(() => {
  if (!ecrDeployModal.appName || !ecrDeployModal.selectedTag) return '# Fill in App Name and select an image tag above'
  const imageUri = `${ecrDeployModal.repoUri}:${ecrDeployModal.selectedTag}`
  const name = ecrDeployModal.appName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const ns   = ecrDeployModal.namespace || 'default'
  const pullSecretBlock = ecrDeployModal.pullSecret
    ? `\n      imagePullSecrets:\n        - name: ${ecrDeployModal.pullSecret}`
    : ''
  // Fixed: 10 spaces for ports (inside container), 12 for - containerPort
  const portBlock = ecrDeployModal.port
    ? `\n          ports:\n            - containerPort: ${ecrDeployModal.port}`
    : ''
  const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app: ${name}
spec:
  replicas: ${ecrDeployModal.replicas || 1}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:${pullSecretBlock}
      containers:
        - name: ${name}
          image: ${imageUri}${portBlock}
          imagePullPolicy: Always`
  if (!ecrDeployModal.createService || !ecrDeployModal.port) return deployment
  const serviceYaml = `\n---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app: ${name}
spec:
  selector:
    app: ${name}
  ports:
    - port: ${ecrDeployModal.port}
      targetPort: ${ecrDeployModal.port}
      protocol: TCP
  type: ${ecrDeployModal.serviceType}`
  return deployment + serviceYaml
})

async function openEcrDeploy(r) {
  Object.assign(ecrDeployModal, {
    open: true, loadingImages: true, applying: false,
    repoName: r.name, repoUri: r.uri,
    images: [], selectedTag: '',
    appName: r.name.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    namespace: 'default', replicas: 1, port: 8080,
    context: '', pullSecret: '',
    createService: false, serviceType: 'ClusterIP',
    applyResult: null,
  })
  try {
    const imgs = await awsStore.fetchEcrImages(r.name)
    ecrDeployModal.images = imgs || []
    if (ecrDeployModal.images.length && ecrDeployModal.images[0].tags.length) {
      ecrDeployModal.selectedTag = ecrDeployModal.images[0].tags[0]
    }
  } catch (e) {
    toast(e?.message || 'Failed to load images', 'error')
  } finally {
    ecrDeployModal.loadingImages = false
  }
}

function copyEcrManifest() {
  navigator.clipboard?.writeText(ecrDeployYaml.value)
  toast(t('awsv.toastManifestCopied'), 'success')
}

async function doApplyEcrToK8s() {
  if (!ecrDeployModal.appName || !ecrDeployModal.selectedTag) return
  ecrDeployModal.applying = true; ecrDeployModal.applyResult = null
  try {
    const result = await awsStore.applyK8sManifest(ecrDeployYaml.value, ecrDeployModal.context || undefined)
    ecrDeployModal.applyResult = result
    if (result?.success) {
      toast(t('awsv.toastDeploymentApplied'), 'success')
    } else {
      toast(result?.stderr || 'kubectl apply failed', 'error')
    }
  } catch (e) {
    ecrDeployModal.applyResult = { success: false, stderr: e?.message || 'Error', stdout: '' }
    toast(e?.message || 'Error', 'error')
  } finally {
    ecrDeployModal.applying = false
  }
}

// ─── Lex Intents Modal ────────────────────────────────────────────────────────

const lexIntentsModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '', botVersion: 'DRAFT',
  locales: [], activeLocale: null, activeIntent: null, activeView: 'list',
})

const lexCurrentLocale = computed(() =>
  lexIntentsModal.locales.find(l => l.localeId === lexIntentsModal.activeLocale) || null
)

async function openLexIntents(bot) {
  Object.assign(lexIntentsModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name, botVersion: 'DRAFT',
    locales: [], activeLocale: null, activeIntent: null, activeView: 'list',
  })
  try {
    await loadLexVersionOptions(bot.id)
    await reloadLexIntents()
  } catch (e) {
    lexIntentsModal.error = e?.message || 'Error loading intents'
  } finally {
    lexIntentsModal.loading = false
  }
}

async function loadLexVersionOptions(botId) {
  try {
    const raw = await awsStore.fetchLexAliases(botId)
    const aliases = raw.aliases || raw || []
    lexVersionOptions.value = ['DRAFT', ...new Set(aliases.map(alias => alias.botVersion).filter(Boolean).filter(version => version !== 'DRAFT'))]
  } catch (_) {
    lexVersionOptions.value = ['DRAFT']
  }
}

async function reloadLexIntents(force = false) {
  if (!lexIntentsModal.botId) return
  lexIntentsModal.loading = true
  lexIntentsModal.error = null
  try {
    const data = await awsStore.fetchLexIntents(lexIntentsModal.botId, {
      botVersion: lexIntentsModal.botVersion,
      force,
    })
    lexIntentsModal.locales = data
    if (!data.some(locale => locale.localeId === lexIntentsModal.activeLocale)) lexIntentsModal.activeLocale = data[0]?.localeId || null
    lexIntentsModal.activeIntent = null
  } catch (e) {
    lexIntentsModal.error = e?.message || 'Error loading intents'
  } finally {
    lexIntentsModal.loading = false
  }
}

// ─── Lex Invocation Logs Modal ────────────────────────────────────────────────

const lexLogsModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '',
  hours: 24, aliasId: '', localeId: '', aliases: [], configured: false, groups: [], events: [],
})
const lexLogLocales = computed(() => [...new Set(lexLogsModal.events.map(event => event.parsed?.localeId).filter(Boolean))].sort())

async function openLexLogs(bot) {
  Object.assign(lexLogsModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    hours: 24, aliasId: '', localeId: '', aliases: [], configured: false, groups: [], events: [],
  })
  await reloadLexLogs()
}

async function reloadLexLogs(force = false) {
  lexLogsModal.loading = true; lexLogsModal.error = null
  try {
    const data = await awsStore.fetchLexLogs(lexLogsModal.botId, lexLogsModal.hours, 100, {
      aliasId: lexLogsModal.aliasId, localeId: lexLogsModal.localeId, force,
    })
    lexLogsModal.configured = data.configured
    lexLogsModal.groups     = data.groups || []
    lexLogsModal.aliases    = data.aliases || []
    lexLogsModal.events     = (data.events || []).map(e => ({ ...e, _expanded: false }))
  } catch (e) {
    lexLogsModal.error = e?.message || 'Error loading logs'
  } finally {
    lexLogsModal.loading = false
  }
}

// ─── Lex Test Set Modal ───────────────────────────────────────────────────────

const lexTestSetModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '',
  activeView: 'existing',
  testSets: [],
  intentsLoaded: false, loadingIntents: false,
  generatedCases: [],
})

async function openLexTestSet(bot) {
  Object.assign(lexTestSetModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    activeView: 'existing',
    testSets: [],
    intentsLoaded: false, loadingIntents: false,
    generatedCases: [],
  })
  try {
    lexTestSetModal.testSets = await awsStore.fetchLexTestSets(bot.id)
  } catch (e) {
    lexTestSetModal.error = e?.message || 'Error loading test sets'
  } finally {
    lexTestSetModal.loading = false
  }
}

async function lexLoadIntentsForTestSet() {
  lexTestSetModal.loadingIntents = true
  try {
    const locales = await awsStore.fetchLexIntents(lexTestSetModal.botId)
    const cases = []
    for (const locale of locales) {
      for (const intent of locale.intents) {
        const utterances = intent.sampleUtterances.length
          ? intent.sampleUtterances
          : [`[${intent.name}]`]
        const expectedSlots = intent.slots.filter(s => s.required).map(s => s.name)
        for (const utterance of utterances) {
          cases.push({ intent: intent.name, utterance, expectedSlots, localeId: locale.localeId })
        }
      }
    }
    lexTestSetModal.generatedCases = cases
    lexTestSetModal.intentsLoaded = true
  } catch (e) {
    toast(e?.message || 'Error loading intents', 'error')
  } finally {
    lexTestSetModal.loadingIntents = false
  }
}

function downloadLexTestSetCsv() {
  const header = 'intent,utterance,expected_slots,locale'
  const rows = lexTestSetModal.generatedCases.map(c =>
    `"${c.intent}","${c.utterance.replace(/"/g, '""')}","${c.expectedSlots.join('|')}","${c.localeId}"`
  )
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `lex-testset-${lexTestSetModal.botId}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function downloadLexTestSetJson() {
  const blob = new Blob([JSON.stringify(lexTestSetModal.generatedCases, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `lex-testset-${lexTestSetModal.botId}.json`; a.click()
  URL.revokeObjectURL(url)
}

// ─── Lex Chat Simulator ───────────────────────────────────────────────────────

const lexChatModal = reactive({
  open: false, sending: false, error: null,
  botId: '', botName: '',
  aliasId: 'TSTALIASID', localeId: '',
  sessionId: null, input: '',
  messages: [], aliases: [], locales: [],
})
const lexChatScrollRef = ref(null)

async function openLexChat(bot) {
  Object.assign(lexChatModal, {
    open: true, sending: false, error: null,
    botId: bot.id, botName: bot.name,
    aliasId: 'TSTALIASID', localeId: '',
    sessionId: `kua-${Date.now()}`,
    input: '', messages: [], aliases: [], locales: [],
  })
  // Load locales y aliases en paralelo
  try {
    const [intents, aliasData] = await Promise.all([
      awsStore.fetchLexIntents(bot.id),
      awsStore.fetchLexAliases(bot.id).catch(() => ({ aliases: [] })),
    ])
    lexChatModal.locales = intents.map(l => ({ localeId: l.localeId, localeName: l.localeName }))
    lexChatModal.localeId = lexChatModal.locales[0]?.localeId || ''
    const rawAliases = aliasData.aliases || aliasData
    lexChatModal.aliases = rawAliases.filter(a => a.id !== 'TSTALIASID')
  } catch (_) {}
}

function openLexChatFromAlias(bot, alias) {
  lexPanelSwitchTab('chat').then(() => {
    lexChatModal.aliasId = alias.id
  })
}

function lexChatReset() {
  lexChatModal.messages = []
  lexChatModal.sessionId = `kua-${Date.now()}`
  lexChatModal.input = ''
}

async function lexChatSend() {
  const text = lexChatModal.input.trim()
  if (!text || lexChatModal.sending) return
  lexChatModal.messages.push({ role: 'user', text })
  lexChatModal.input = ''
  lexChatModal.sending = true
  await nextTick()
  if (lexChatScrollRef.value) lexChatScrollRef.value.scrollTop = lexChatScrollRef.value.scrollHeight
  try {
    const resp = await awsStore.lexChat(
      lexChatModal.botId, text,
      lexChatModal.aliasId, lexChatModal.localeId, lexChatModal.sessionId
    )
    lexChatModal.sessionId = resp.sessionId
    const msgs = resp.messages?.length
      ? resp.messages
      : [{ content: '(No response message)' }]
    for (const m of msgs) {
      lexChatModal.messages.push({
        role: 'bot', content: m.content,
        intent: resp.intent, confidence: resp.confidence,
        slots: resp.slots, interpretations: resp.interpretations,
        dialogAction: resp.intentState,
      })
    }
  } catch (e) {
    lexChatModal.messages.push({ role: 'bot', content: `Error: ${e?.message || 'Unknown error'}` })
  } finally {
    lexChatModal.sending = false
    await nextTick()
    if (lexChatScrollRef.value) lexChatScrollRef.value.scrollTop = lexChatScrollRef.value.scrollHeight
  }
}

// ─── Lex Missed Utterances Modal ──────────────────────────────────────────────

const lexMissedModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '',
  hours: 24, aliasId: '', localeId: '', aliases: [], configured: false, logGroupName: '', utterances: [],
})
const lexMissedLocales = computed(() => [...new Set(lexMissedModal.utterances.map(utterance => utterance.localeId).filter(Boolean))].sort())

async function openLexMissed(bot) {
  Object.assign(lexMissedModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    hours: 24, aliasId: '', localeId: '', aliases: [], configured: false, logGroupName: '', utterances: [],
  })
  await reloadLexMissed()
}

async function reloadLexMissed(force = false) {
  lexMissedModal.loading = true; lexMissedModal.error = null
  try {
    const data = await awsStore.fetchLexMissedUtterances(lexMissedModal.botId, lexMissedModal.hours, {
      aliasId: lexMissedModal.aliasId, localeId: lexMissedModal.localeId, force,
    })
    lexMissedModal.configured   = data.configured
    lexMissedModal.logGroupName = data.logGroupName || ''
    lexMissedModal.aliases      = data.aliases || []
    lexMissedModal.utterances   = data.utterances || []
  } catch (e) {
    lexMissedModal.error = e?.message || 'Error loading missed utterances'
  } finally {
    lexMissedModal.loading = false
  }
}

// ─── Lex Aliases Modal ────────────────────────────────────────────────────────

const lexAliasesModal = reactive({
  open: false, loading: false, error: null,
  bot: null, botName: '', botArn: null, aliases: [],
  showCreate: false, creating: false, createError: null,
  createForm: { name: '', botVersion: 'DRAFT', description: '' },
})

async function openLexAliases(bot) {
  Object.assign(lexAliasesModal, {
    open: true, loading: true, error: null,
    bot, botName: bot.name, botArn: null, aliases: [],
    showCreate: false, creating: false, createError: null,
    createForm: { name: '', botVersion: 'DRAFT', description: '' },
  })
  try {
    const data = await awsStore.fetchLexAliases(bot.id)
    lexAliasesModal.botArn   = data.botArn || null
    lexAliasesModal.aliases  = data.aliases || data
  } catch (e) {
    lexAliasesModal.error = e?.message || 'Error loading aliases'
  } finally {
    lexAliasesModal.loading = false
  }
}

async function doCreateLexAlias() {
  lexAliasesModal.creating = true; lexAliasesModal.createError = null
  try {
    const alias = await awsStore.createLexAlias(lexAliasesModal.bot.id, lexAliasesModal.createForm)
    lexAliasesModal.aliases.unshift(alias)
    lexAliasesModal.showCreate = false
    Object.assign(lexAliasesModal.createForm, { name: '', botVersion: 'DRAFT', description: '' })
    toast(t('awsv.toastAliasCreated', { name: alias.name }), 'success')
  } catch (e) {
    lexAliasesModal.createError = e?.message || 'Error creating alias'
  } finally {
    lexAliasesModal.creating = false
  }
}

function openLexBuildFromAlias(bot, alias) {
  lexPanelSwitchTab('metrics')
}

// ─── Lex Slot Types Modal ─────────────────────────────────────────────────────

const lexSlotTypesModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '', botVersion: 'DRAFT',
  locales: [], activeLocale: null,
})

async function openLexSlotTypes(bot) {
  Object.assign(lexSlotTypesModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name, botVersion: 'DRAFT',
    locales: [], activeLocale: null,
  })
  try {
    await loadLexVersionOptions(bot.id)
    await reloadLexSlotTypes()
  } catch (e) {
    lexSlotTypesModal.error = e?.message || 'Error loading slot types'
  } finally {
    lexSlotTypesModal.loading = false
  }
}

async function reloadLexSlotTypes(force = false) {
  if (!lexSlotTypesModal.botId) return
  lexSlotTypesModal.loading = true
  lexSlotTypesModal.error = null
  try {
    const data = await awsStore.fetchLexSlotTypes(lexSlotTypesModal.botId, {
      botVersion: lexSlotTypesModal.botVersion,
      force,
    })
    lexSlotTypesModal.locales = data
    if (!data.some(locale => locale.localeId === lexSlotTypesModal.activeLocale)) lexSlotTypesModal.activeLocale = data[0]?.localeId || null
  } catch (e) {
    lexSlotTypesModal.error = e?.message || 'Error loading slot types'
  } finally {
    lexSlotTypesModal.loading = false
  }
}

// ─── Lex Metrics Modal ────────────────────────────────────────────────────────

const lexMetricsModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '',
  hours: 24, localeId: '', metrics: {},
  locales: [], buildLocale: null, building: false, buildResult: null,
})

async function openLexMetrics(bot) {
  Object.assign(lexMetricsModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    hours: 24, localeId: '', metrics: {},
    locales: [], buildLocale: null, building: false, buildResult: null,
  })
  // Load locales for the build selector
  try {
    const intents = await awsStore.fetchLexIntents(bot.id)
    lexMetricsModal.locales = intents.map(l => ({ localeId: l.localeId, localeName: l.localeName }))
    if (lexMetricsModal.locales.length) {
      lexMetricsModal.buildLocale = lexMetricsModal.locales[0].localeId
    }
  } catch (_) {}
  await reloadLexMetrics()
}

async function reloadLexMetrics(force = false) {
  lexMetricsModal.loading = true; lexMetricsModal.error = null
  try {
    const data = await awsStore.fetchLexMetrics(lexMetricsModal.botId, lexMetricsModal.hours, {
      botName: lexMetricsModal.botName, localeId: lexMetricsModal.localeId, force,
    })
    lexMetricsModal.metrics = data.metrics || {}
  } catch (e) {
    lexMetricsModal.error = e?.message || 'Error loading metrics'
  } finally {
    lexMetricsModal.loading = false
  }
}

function lexMetricsTotal(key) {
  const pts = lexMetricsModal.metrics[key] || []
  return pts.reduce((s, p) => s + (p.v || 0), 0).toLocaleString()
}

function lexMetricsAvg(key) {
  const pts = lexMetricsModal.metrics[key] || []
  if (!pts.length) return 0
  return Math.round(pts.reduce((s, p) => s + (p.v || 0), 0) / pts.length)
}

function lexMetricsSparkline(key) {
  const pts = lexMetricsModal.metrics[key] || []
  if (!pts.length) return []
  const max = Math.max(...pts.map(p => p.v || 0), 1)
  return pts.map(p => Math.round(((p.v || 0) / max) * 100))
}

async function doBuildLexBot() {
  if (!lexMetricsModal.buildLocale) return
  lexMetricsModal.building = true; lexMetricsModal.buildResult = null
  try {
    const result = await awsStore.buildLexBot(lexMetricsModal.botId, lexMetricsModal.buildLocale)
    lexMetricsModal.buildResult = result
    toast(`Build ${result.status}: ${lexMetricsModal.botName} (${result.localeId})`, result.status === 'Built' ? 'success' : 'error')
  } catch (e) {
    lexMetricsModal.buildResult = { status: 'Failed', failureReasons: [e?.message || 'Error'] }
    toast(e?.message || 'Build failed', 'error')
  } finally {
    lexMetricsModal.building = false
  }
}

// ─── EventBridge Logs Modal ───────────────────────────────────────────────────

const ebLogsModal = reactive({
  open: false, loading: false, error: null,
  ruleName: '', busName: '', minutes: 60, data: null,
})

async function openEbLogs(r) {
  Object.assign(ebLogsModal, {
    open: true, loading: true, error: null,
    ruleName: r.name, busName: r.busName, minutes: 60, data: null,
  })
  await reloadEbLogs()
}

async function reloadEbLogs() {
  ebLogsModal.loading = true; ebLogsModal.error = null
  try {
    const d = await awsStore.fetchEventBridgeLogs(ebLogsModal.busName, ebLogsModal.ruleName, ebLogsModal.minutes)
    if (d) { ebLogsModal.data = d }
    else    { ebLogsModal.error = awsStore.error || 'Failed to load metrics' }
  } catch (e) { ebLogsModal.error = e?.message || 'Error' }
  finally     { ebLogsModal.loading = false }
}

// ─── EventBridge Details Modal ────────────────────────────────────────────────

const ebDetailsModal = reactive({
  open: false, loading: false, error: null,
  name: '', state: '', busName: '',
  rule: null, targets: [],
})

async function openEbDetails(r) {
  Object.assign(ebDetailsModal, {
    open: true, loading: true, error: null,
    name: r.name, state: r.state, busName: r.busName,
    rule: null, targets: [],
  })
  try {
    const data = await awsStore.fetchEventBridgeConfig(r.busName, r.name)
    if (data) {
      ebDetailsModal.rule    = data.rule    || null
      ebDetailsModal.targets = data.targets || []
    } else {
      ebDetailsModal.error = awsStore.error || 'Failed to load rule details'
    }
  } catch (e) {
    ebDetailsModal.error = e?.message || 'Error loading details'
  } finally {
    ebDetailsModal.loading = false
  }
}

// ─── Step Functions Diagram Modal ─────────────────────────────────────────────
const diagramModal = reactive({
  open: false, loading: false, error: null,
  name: '', type: '', arn: '', definition: '',
})

async function openDiagram(sm) {
  Object.assign(diagramModal, {
    open: true, loading: true, error: null,
    name: sm.name, type: sm.type, arn: sm.arn, definition: '',
  })
  try {
    const data = await awsStore.fetchStepFnDiagram(sm.arn)
    if (data?.stateMachine?.definition) {
      diagramModal.definition = data.stateMachine.definition
    } else {
      diagramModal.error = data?.error || 'No definition returned from API'
    }
  } catch (e) {
    diagramModal.error = e?.message || 'Failed to load definition'
  } finally {
    diagramModal.loading = false
  }
}

// ─── Step Functions Detail Modal ──────────────────────────────────────────────
const stepFnDetailModal = reactive({ open: false, sm: null })

function openStepFnDetail(sm) {
  stepFnDetailModal.sm   = sm
  stepFnDetailModal.open = true
}

// ─── Step Functions Execution Counts ─────────────────────────────────────────
// Per state machine: { loading } | { unsupported } (Express) | { error } | { result }.
// A read that failed is shown as such, never as zero executions.
const stepFnCounts = reactive({})
const STEPFN_COUNT_STATUSES = [
  { key: 'running',  icon: '▶', cls: 'status-ok' },
  { key: 'failed',   icon: '✗', cls: 'status-err' },
  { key: 'timedOut', icon: '⏱', cls: 'status-warn' },
]

async function loadStepFnCounts() {
  const sms = awsStore.stepFunctions
  if (!sms?.length) return
  const unloaded = sms.filter(sm => !stepFnCounts[sm.arn])
  if (!unloaded.length) return
  const standard = []
  for (const sm of unloaded) {
    // ListExecutions does not support Express workflows.
    if (sm.type === 'EXPRESS') stepFnCounts[sm.arn] = { unsupported: true }
    else { stepFnCounts[sm.arn] = { loading: true }; standard.push(sm) }
  }
  await Promise.allSettled(standard.map(async sm => {
    try {
      stepFnCounts[sm.arn] = { result: await awsStore.fetchStepFnExecutionCount(sm.arn) }
    } catch (e) {
      stepFnCounts[sm.arn] = { error: { kind: 'error', message: e?.message || String(e) } }
    }
  }))
}

function stepFnErrorTitle(errors) {
  const lines = errors.map(e => (e.kind === 'denied'
    ? t('awsv.sfnCountsDeniedHint', { action: e.action || 'states:ListExecutions' })
    : e.message))
  return [...new Set(lines.filter(Boolean))].join('\n')
}

function stepFnCountView(c) {
  if (!c || c.loading) return { state: 'loading' }
  if (c.unsupported) return { state: 'unsupported' }
  if (c.error) return { state: 'error', title: stepFnErrorTitle([c.error]) }
  const items = []
  const errors = []
  for (const s of STEPFN_COUNT_STATUSES) {
    const entry = c.result?.[s.key]
    if (!entry || entry.error) { errors.push(entry?.error || { kind: 'error', message: '' }); continue }
    if (!entry.count) continue
    const label = entry.truncated ? `${entry.count.toLocaleString()}+` : entry.count.toLocaleString()
    items.push({ ...s, label, title: t(`awsv.sfnCount.${s.key}`, { n: label }) })
  }
  if (errors.length === STEPFN_COUNT_STATUSES.length) {
    return { state: errors.every(e => e.kind === 'denied') ? 'denied' : 'error', title: stepFnErrorTitle(errors) }
  }
  return { state: 'ok', items, partial: errors.length ? stepFnErrorTitle(errors) || t('awsv.sfnCountsPartial') : null }
}

const stepFnCountViews = computed(() =>
  Object.fromEntries(stepFnRows.value.map(sm => [sm.arn, stepFnCountView(stepFnCounts[sm.arn])])))

watch(activeTab, (tab) => {
  if (tab === 'stepfn') loadStepFnCounts()
})
watch(() => awsStore.stepFunctions, (sms) => {
  if (activeTab.value === 'stepfn' && sms?.length) loadStepFnCounts()
})

const tagsModal = reactive({
  open: false, loading: false, saving: false, error: null,
  service: '', title: '', arn: '', tags: [],
  originalKeys: [],
})

async function openTags(service, title, arn, initialTags = []) {
  Object.assign(tagsModal, { service, title, arn, error: null, saving: false, open: true, loading: true, tags: [] })
  try {
    const data = await awsStore.fetchTags(service, arn)
    tagsModal.tags = data?.tags
      ? data.tags.map(t => ({ Key: t.Key ?? t.key, Value: t.Value ?? t.value }))
      : (Array.isArray(initialTags)
          ? initialTags.map(t => ({ Key: t.Key ?? t.key, Value: t.Value ?? t.value }))
          : Object.entries(initialTags || {}).map(([Key, Value]) => ({ Key, Value })))
    tagsModal.originalKeys = tagsModal.tags.map(t => t.Key)
  } catch (e) {
    tagsModal.tags = Array.isArray(initialTags)
      ? initialTags.map(t => ({ Key: t.Key ?? t.key, Value: t.Value ?? t.value }))
      : Object.entries(initialTags || {}).map(([Key, Value]) => ({ Key, Value }))
  } finally {
    tagsModal.loading = false
  }
}

function addTagRow() { tagsModal.tags.push({ Key: '', Value: '' }) }

function removeTagRow(idx) { tagsModal.tags.splice(idx, 1) }

async function saveTags() {
  tagsModal.saving = true; tagsModal.error = null
  try {
    const currentKeys = tagsModal.tags.map(t => t.Key).filter(Boolean)
    const removedKeys = tagsModal.originalKeys.filter(k => !currentKeys.includes(k))
    const validTags   = tagsModal.tags.filter(t => t.Key && t.Key.trim())
    const r = await awsStore.saveTags(tagsModal.service, tagsModal.arn, validTags, removedKeys)
    if (r?.success) {
      toast(t('awsv.toastTagsSaved'), 'success')
      tagsModal.originalKeys = currentKeys
      tagsModal.open = false
    } else {
      tagsModal.error = awsStore.error || 'Failed to save tags'
    }
  } finally { tagsModal.saving = false }
}

// ─── CloudWatch Logging Modal ─────────────────────────────────────────────────

const loggingModal = reactive({
  open: false, loading: false, error: null, result: null,
  service: '', title: '', name: '', cluster: null,
  logFormat: 'Text', retentionDays: 30, logPrefix: '',
})

function openLogging(service, resource) {
  Object.assign(loggingModal, {
    service, open: true, loading: false, error: null, result: null,
    logFormat: 'Text', retentionDays: 30,
    name:    service === 'lambda' ? resource.name : resource.name,
    cluster: service === 'ecs'    ? resource.cluster : null,
    logPrefix: service === 'ecs'  ? resource.name : '',
    title:  service === 'lambda' ? `Lambda: ${resource.name}` : `ECS: ${resource.name} (${resource.cluster})`,
  })
}

async function submitLogging() {
  loggingModal.loading = true; loggingModal.error = null; loggingModal.result = null
  try {
    let r
    if (loggingModal.service === 'lambda') {
      r = await awsStore.enableLambdaLogging(loggingModal.name, loggingModal.logFormat, loggingModal.retentionDays)
    } else if (loggingModal.service === 'ecs') {
      r = await awsStore.enableEcsLogging(loggingModal.cluster, loggingModal.name, loggingModal.retentionDays, loggingModal.logPrefix)
    }
    if (r?.success) {
      loggingModal.result = r
      toast(t('awsv.toastLoggingEnabled'), 'success')
    } else {
      loggingModal.error = awsStore.error || 'Failed to enable logging'
    }
  } finally { loggingModal.loading = false }
}

// ─── Utility: formatBytes ──────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, n = Number(bytes)
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}

// ─── Glue Actions ─────────────────────────────────────────────────────────────

const glueRunsModal = reactive({ open: false, loading: false, job: null, runs: [] })

async function openGlueRuns(job) {
  Object.assign(glueRunsModal, { open: true, loading: true, job, runs: [] })
  try {
    const data = await awsStore.fetchGlueJobRuns(job.name)
    glueRunsModal.runs = data || []
  } finally { glueRunsModal.loading = false }
}

async function runGlueJob(job) {
  const r = await awsStore.runGlueJob(job.name)
  if (r?.jobRunId) toast(t('awsv.toastGlueStarted', { id: r.jobRunId }), 'success')
  else toast(awsStore.error || 'Failed to start job', 'error')
}

// ─── Athena Query Panel ───────────────────────────────────────────────────────

const athenaModal = reactive({
  open: false, loading: false, workgroup: null,
  query: '', outputLocation: '', queryId: null, status: null, results: null, error: null,
})

function openAthenaQuery(wg) {
  Object.assign(athenaModal, { open: true, workgroup: wg, query: '', outputLocation: '', queryId: null, status: null, results: null, error: null, loading: false })
}

async function submitAthenaQuery() {
  if (!athenaModal.query.trim()) return
  athenaModal.loading = true; athenaModal.error = null; athenaModal.results = null; athenaModal.status = null
  try {
    const outputLocation = athenaModal.workgroup?.outputLocation || athenaModal.outputLocation.trim() || undefined
    const r = await awsStore.startAthenaQuery(athenaModal.query, athenaModal.workgroup?.name, outputLocation)
    if (!r?.queryExecutionId) {
      const msg = awsStore.error || 'Failed to start query'
      athenaModal.error = !outputLocation && /output location/i.test(msg)
        ? `${msg} Enter an S3 path above and run again.`
        : msg
      return
    }
    athenaModal.queryId = r.queryExecutionId
    // Poll until done (max 30s)
    for (let i = 0; i < 30; i++) {
      await new Promise(res => setTimeout(res, 1000))
      const result = await awsStore.getAthenaQueryResult(athenaModal.queryId)
      athenaModal.status = result?.execution?.Status?.State
      if (athenaModal.status === 'SUCCEEDED') { athenaModal.results = result.results; break }
      if (athenaModal.status === 'FAILED' || athenaModal.status === 'CANCELLED') {
        athenaModal.error = result?.execution?.Status?.StateChangeReason || 'Query failed'; break
      }
    }
  } finally { athenaModal.loading = false }
}

// ─── Data Pipeline Actions ────────────────────────────────────────────────────

async function activatePipeline(p) {
  const r = await awsStore.activateDataPipeline(p.id)
  if (r?.success) { toast(t('awsv.toastActivated', { name: p.name }), 'success'); loaded.datapipeline = false; loadTab('datapipeline') }
  else toast(awsStore.error || 'Error', 'error')
}

async function deactivatePipeline(p) {
  const r = await awsStore.deactivateDataPipeline(p.id)
  if (r?.success) { toast(t('awsv.toastPaused', { name: p.name }), 'success'); loaded.datapipeline = false; loadTab('datapipeline') }
  else toast(awsStore.error || 'Error', 'error')
}

// ─── CloudFront Invalidation Modal ────────────────────────────────────────────

function openSiteUrl(url) {
  if (window.kuaElectron?.openExternal) {
    window.kuaElectron.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const invalidateModal = reactive({ open: false, loading: false, dist: null, paths: '/*', result: null, error: null })

function openInvalidateModal(d) {
  Object.assign(invalidateModal, { open: true, dist: d, paths: '/*', result: null, error: null, loading: false })
}

async function submitInvalidation() {
  invalidateModal.loading = true; invalidateModal.error = null; invalidateModal.result = null
  try {
    const paths = invalidateModal.paths.split('\n').map(s => s.trim()).filter(Boolean)
    const r = await awsStore.invalidateCloudfront(invalidateModal.dist.id, paths)
    if (r?.invalidationId) {
      invalidateModal.result = `Invalidation created: ${r.invalidationId} (${r.status})`
      toast(t('awsv.toastInvalidationCreated'), 'success')
    } else {
      invalidateModal.error = awsStore.error || 'Failed to create invalidation'
    }
  } finally { invalidateModal.loading = false }
}

// ─── CloudFront Stats Modal ───────────────────────────────────────────────────

const cfStatsModal = reactive({ open: false, loading: false, error: null, data: null, domainName: '' })

async function openCfStats(d) {
  Object.assign(cfStatsModal, { open: true, loading: true, error: null, data: null, domainName: d.domainName })
  try {
    const data = await awsStore.fetchCloudfrontStats(d.id)
    if (data) { cfStatsModal.data = data }
    else { cfStatsModal.error = awsStore.error || 'Failed to load stats' }
  } catch (e) { cfStatsModal.error = e?.message || 'Error' }
  finally { cfStatsModal.loading = false }
}

// ─── CloudFront Create from S3 Modal ─────────────────────────────────────────

const cfCreateModal = reactive({
  open: false, loading: false, error: null, result: null,
  bucketName: '', region: '', comment: '', priceClass: 'PriceClass_100', aliases: '',
})

watch(() => cfCreateModal.bucketName, (name) => {
  if (!name) return
  const bucket = awsStore.s3Buckets?.find(b => b.name === name)
  if (bucket?.region) cfCreateModal.region = bucket.region
})

async function submitCfCreate() {
  cfCreateModal.loading = true; cfCreateModal.error = null; cfCreateModal.result = null
  try {
    const aliases = cfCreateModal.aliases.split('\n').map(s => s.trim()).filter(Boolean)
    const r = await awsStore.createCloudfrontFromS3({
      bucketName: cfCreateModal.bucketName,
      region: cfCreateModal.region,
      comment: cfCreateModal.comment,
      priceClass: cfCreateModal.priceClass,
      aliases,
    })
    if (r?.domainName) {
      cfCreateModal.result = r
      toast(t('awsv.toastDistributionCreated', { domain: r.domainName }), 'success')
      loaded.cloudfront = false; loadTab('cloudfront')
    } else {
      cfCreateModal.error = awsStore.error || 'Failed to create distribution'
    }
  } finally { cfCreateModal.loading = false }
}

// ─── Route 53 Actions ─────────────────────────────────────────────────────────

const route53State = reactive({
  selectedZoneId: null,
  records: [],
  loadingRecords: false,
  search: '',
  selectedRecordType: null,
  selectedRecords: new Set(),
  testing: {},
  testResults: {},
})

const route53RecordKey   = recordKey
const route53DisplayName = displayName
const route53TestsFor    = testsForRecord
const route53TestKey     = testResultKey

const route53RecordTypes = computed(() => recordTypes(route53State.records))

const filteredRoute53Records = computed(() => filterRecords(route53State.records, {
  search: route53State.search,
  type:   route53State.selectedRecordType,
}))

const allVisibleRoute53Selected = computed(() =>
  filteredRoute53Records.value.length > 0
  && filteredRoute53Records.value.every(r => route53State.selectedRecords.has(recordKey(r))))

async function loadRoute53Records(zone) {
  route53State.selectedZoneId = zone.id
  route53State.records = []
  route53State.search = ''
  route53State.selectedRecordType = null
  route53State.selectedRecords.clear()
  route53State.testing = {}
  route53State.testResults = {}
  route53State.loadingRecords = true
  try {
    const data = await awsStore.fetchRoute53Records(zone.id)
    if (route53State.selectedZoneId === zone.id) route53State.records = data || []
  } finally {
    if (route53State.selectedZoneId === zone.id) route53State.loadingRecords = false
  }
}

function toggleRecordSelection(record) {
  const key = recordKey(record)
  if (route53State.selectedRecords.has(key)) route53State.selectedRecords.delete(key)
  else route53State.selectedRecords.add(key)
}

function selectAllVisibleRecords() {
  filteredRoute53Records.value.forEach(r => route53State.selectedRecords.add(recordKey(r)))
}

function clearVisibleRecordSelection() {
  filteredRoute53Records.value.forEach(r => route53State.selectedRecords.delete(recordKey(r)))
}

function clearRecordSelection() {
  route53State.selectedRecords.clear()
}

function exportRoute53Records() {
  const rows = recordsForExport(route53State.records, filteredRoute53Records.value, route53State.selectedRecords)
  if (!rows.length) return

  const zone = awsStore.route53Zones.find(z => z.id === route53State.selectedZoneId)
  const zoneName = (zone?.name || route53State.selectedZoneId || 'zone').replace(/\.$/, '')
  const blob = new Blob([recordsToCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `route53-${zoneName}-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function route53StatusStyle(status) {
  if (status === 'OK')      return { background: 'rgba(63,185,80,.18)',  color: '#3fb950' }
  if (status === 'WARNING') return { background: 'rgba(210,153,34,.18)', color: '#d29922' }
  return { background: 'rgba(248,81,73,.18)', color: '#f85149' }
}

function route53ResultTitle(test, result) {
  const values = result?.values?.length ? `\n${result.values.join('\n')}` : ''
  return `Re-run ${test.label}${values}`
}

async function testRoute53Record(record, test) {
  const key = testResultKey(record, test)
  route53State.testing[key] = true
  try {
    route53State.testResults[key] = await awsStore.validateRoute53Record({
      hostname: hostnameOf(record),
      type:     test.type,
      checkTcp: !!test.checkTcp,
    })
  } catch (err) {
    route53State.testResults[key] = { status: 'ERROR', message: err?.message || 'Error', values: [] }
  } finally {
    delete route53State.testing[key]
  }
}

// ─── Cognito Actions ──────────────────────────────────────────────────────────

const cognitoInnerTabs = computed(() => [
  { id: 'users',   label: t('awsv.tabUsers') },
  { id: 'clients', label: 'App Clients' },
  { id: 'idps',    label: t('awsv.tabIdentityProviders') },
  { id: 'groups',  label: t('ec2d.groups') },
  { id: 'config',  label: t('awsv.tabPoolConfig') },
])

const cognitoState = reactive({
  selectedPool:    null,
  innerTab:        'users',
  // Users
  users:           [],
  loadingUsers:    false,
  paginationToken: null,
  prevTokens:      [],
  userFilter:      '',
  activeFilter:    '',
  // Clients
  clients:         [],
  loadingClients:  false,
  // IdPs
  idps:            [],
  loadingIdps:     false,
  // Groups
  groups:          [],
  loadingGroups:   false,
  // Pool Config
  poolConfig:      null,
  loadingConfig:   false,
})

async function loadCognitoPool(pool) {
  cognitoState.selectedPool    = pool
  cognitoState.users           = []
  cognitoState.clients         = []
  cognitoState.idps            = []
  cognitoState.groups          = []
  cognitoState.poolConfig      = null
  cognitoState.paginationToken = null
  cognitoState.prevTokens      = []
  cognitoState.userFilter      = ''
  cognitoState.activeFilter    = ''
  cognitoState.innerTab        = 'users'
  await loadCognitoUsers()
  // Load remaining tabs in background
  loadCognitoClients()
  loadCognitoIdps()
  loadCognitoGroups()
  loadCognitoPoolConfig()
}

async function loadCognitoUsers(paginationToken) {
  cognitoState.loadingUsers = true
  try {
    const opts = { limit: 60 }
    if (paginationToken)              opts.paginationToken = paginationToken
    if (cognitoState.activeFilter)    opts.filter          = cognitoState.activeFilter
    const resp = await awsStore.fetchCognitoUsers(cognitoState.selectedPool.id, opts)
    cognitoState.users           = resp?.users || []
    cognitoState.paginationToken = resp?.paginationToken || null
  } finally { cognitoState.loadingUsers = false }
}

async function applyUserFilter() {
  cognitoState.activeFilter    = cognitoState.userFilter
  cognitoState.paginationToken = null
  cognitoState.prevTokens      = []
  await loadCognitoUsers()
}

async function clearUserFilter() {
  cognitoState.userFilter      = ''
  cognitoState.activeFilter    = ''
  cognitoState.paginationToken = null
  cognitoState.prevTokens      = []
  await loadCognitoUsers()
}

async function cognitoNextPage() {
  if (!cognitoState.paginationToken) return
  cognitoState.prevTokens.push(cognitoState.paginationToken)
  await loadCognitoUsers(cognitoState.paginationToken)
}

async function cognitoPrevPage() {
  if (!cognitoState.prevTokens.length) return
  const token = cognitoState.prevTokens.pop()
  const prevToken = cognitoState.prevTokens[cognitoState.prevTokens.length - 1] || undefined
  await loadCognitoUsers(prevToken)
}

async function loadCognitoClients() {
  cognitoState.loadingClients = true
  try {
    const data = await awsStore.fetchCognitoClients(cognitoState.selectedPool.id)
    cognitoState.clients = data || []
  } finally { cognitoState.loadingClients = false }
}

async function loadCognitoIdps() {
  cognitoState.loadingIdps = true
  try {
    const data = await awsStore.fetchCognitoIdentityProviders(cognitoState.selectedPool.id)
    cognitoState.idps = data || []
  } finally { cognitoState.loadingIdps = false }
}

async function loadCognitoGroups() {
  cognitoState.loadingGroups = true
  try {
    const data = await awsStore.fetchCognitoGroups(cognitoState.selectedPool.id)
    cognitoState.groups = data || []
  } finally { cognitoState.loadingGroups = false }
}

async function loadCognitoPoolConfig() {
  cognitoState.loadingConfig = true
  try {
    cognitoState.poolConfig = await awsStore.fetchCognitoPoolConfig(cognitoState.selectedPool.id)
  } finally { cognitoState.loadingConfig = false }
}

async function doCognitoResetPassword(user) {
  if (!confirm(t('awsv.confirmResetEmail', { user: user.username }))) return
  const r = await awsStore.resetCognitoUserPassword(cognitoState.selectedPool.id, user.username)
  if (r?.success) toast(t('awsv.toastResetSent'), 'success')
  else toast(awsStore.error || 'Failed', 'error')
}

async function doCognitoEnable(user) {
  const r = await awsStore.enableCognitoUser(cognitoState.selectedPool.id, user.username)
  if (r?.success) { toast(t('awsv.toastUserEnabled'), 'success'); user.enabled = true }
  else toast(awsStore.error || 'Failed', 'error')
}

async function doCognitoDisable(user) {
  const r = await awsStore.disableCognitoUser(cognitoState.selectedPool.id, user.username)
  if (r?.success) { toast(t('awsv.toastUserDisabled'), 'success'); user.enabled = false }
  else toast(awsStore.error || 'Failed', 'error')
}

// ─── Cognito Create User Modal ────────────────────────────────────────────────
const cognitoCreateModal = reactive({ open: false, loading: false, username: '', email: '', temporaryPassword: '', suppressMessage: false, error: null, result: null })

function openCreateCognitoUser() { Object.assign(cognitoCreateModal, { open: true, username: '', email: '', temporaryPassword: '', suppressMessage: false, error: null, result: null, loading: false }) }

async function submitCreateCognitoUser() {
  if (!cognitoCreateModal.username) { cognitoCreateModal.error = t('awsv.errUsernameRequired'); return }
  cognitoCreateModal.loading = true; cognitoCreateModal.error = null; cognitoCreateModal.result = null
  try {
    const r = await awsStore.createCognitoUser(cognitoState.selectedPool.id, {
      username:          cognitoCreateModal.username,
      email:             cognitoCreateModal.email || undefined,
      temporaryPassword: cognitoCreateModal.temporaryPassword || undefined,
      suppressMessage:   cognitoCreateModal.suppressMessage,
    })
    if (r?.username) {
      cognitoCreateModal.result = `User "${r.username}" created (status: ${r.status}).`
      await loadCognitoUsers()
    } else { cognitoCreateModal.error = awsStore.error || 'Failed to create user' }
  } finally { cognitoCreateModal.loading = false }
}

// ─── Cognito Create Group Modal ───────────────────────────────────────────────
const cognitoGroupModal = reactive({ open: false, loading: false, groupName: '', description: '', error: null, result: null })

function openCreateCognitoGroup() {
  Object.assign(cognitoGroupModal, { open: true, loading: false, groupName: '', description: '', error: null, result: null })
}

async function submitCreateCognitoGroup() {
  if (!cognitoGroupModal.groupName.trim()) {
    cognitoGroupModal.error = t('awsv.errGroupRequired')
    return
  }
  cognitoGroupModal.loading = true
  cognitoGroupModal.error = null
  cognitoGroupModal.result = null
  try {
    const payload = {
      groupName: cognitoGroupModal.groupName.trim(),
      description: cognitoGroupModal.description.trim() || undefined,
    }
    const r = typeof awsStore.createCognitoGroup === 'function'
      ? await awsStore.createCognitoGroup(cognitoState.selectedPool.id, payload)
      : await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(cognitoState.selectedPool.id)}/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': awsStore.activeProfileId,
        },
        body: JSON.stringify(payload),
      })
    if (r?.success) {
      cognitoGroupModal.result = `Group "${r.group?.name || cognitoGroupModal.groupName}" created.`
      toast(t('awsv.toastGroupCreated'), 'success')
      await loadCognitoGroups()
    } else {
      cognitoGroupModal.error = awsStore.error || 'Failed to create group'
    }
  } finally { cognitoGroupModal.loading = false }
}

// ─── Cognito User Detail ──────────────────────────────────────────────────────
const cognitoUserDetail = reactive({
  open: false,
  loading: false,
  savingAttributes: false,
  savingGroup: false,
  savingMfa: false,
  username: '',
  data: null,
  groups: [],
  groupsLoading: false,
  editFields: [],
  editValues: {},
  selectedGroup: '',
  mfaEnabled: false,
  mfaMethod: 'SMS_MFA',
})

function isEditableCognitoField(field) {
  return field?.Mutable !== false
}

function buildCognitoEditFields() {
  const schema = cognitoState.poolConfig?.SchemaAttributes || []
  const sourceFields = schema.length
    ? schema.filter(isEditableCognitoField)
    : Object.keys(cognitoUserDetail.data?.attributes || {}).map(name => ({ Name: name, AttributeDataType: 'String', Mutable: true }))
  const fields = sourceFields.map(field => {
    const name = field.Name
    const value = cognitoUserDetail.data?.attributes?.[name]
    const isBoolean = name === 'email_verified' || name === 'phone_number_verified'
    return {
      name,
      label: name,
      description: field.AttributeDataType || '',
      type: isBoolean ? 'checkbox' : 'text',
      value: isBoolean ? value === 'true' || value === true : (value ?? ''),
    }
  })
  cognitoUserDetail.editFields = fields
  const nextValues = {}
  for (const field of fields) nextValues[field.name] = field.value
  cognitoUserDetail.editValues = nextValues
}

async function loadCognitoUserGroups(username) {
  cognitoUserDetail.groupsLoading = true
  try {
    cognitoUserDetail.groups = await awsStore.fetchCognitoUserGroups(cognitoState.selectedPool.id, username) || []
    if (!cognitoUserDetail.selectedGroup) {
      const remaining = (cognitoState.groups || []).find(g => !cognitoUserDetail.groups.some(current => current.name === g.name))
      cognitoUserDetail.selectedGroup = remaining?.name || ''
    }
  } finally { cognitoUserDetail.groupsLoading = false }
}

async function openUserDetail(user) {
  Object.assign(cognitoUserDetail, {
    open: true,
    loading: true,
    savingAttributes: false,
    savingGroup: false,
    savingMfa: false,
    username: user.username,
    data: null,
    groups: [],
    groupsLoading: false,
    editFields: [],
    editValues: {},
    selectedGroup: '',
    mfaEnabled: false,
    mfaMethod: 'SMS_MFA',
  })
  try {
    cognitoUserDetail.data = await awsStore.fetchCognitoUserDetail(cognitoState.selectedPool.id, user.username)
    if (!cognitoState.poolConfig) {
      cognitoState.poolConfig = await awsStore.fetchCognitoPoolConfig(cognitoState.selectedPool.id)
    }
    buildCognitoEditFields()
    syncCognitoUserMfaState()
    await loadCognitoUserGroups(user.username)
  } finally { cognitoUserDetail.loading = false }
}

async function refreshCognitoUserDetail() {
  if (!cognitoUserDetail.username) return
  cognitoUserDetail.data = await awsStore.fetchCognitoUserDetail(cognitoState.selectedPool.id, cognitoUserDetail.username)
  buildCognitoEditFields()
  syncCognitoUserMfaState()
  await loadCognitoUserGroups(cognitoUserDetail.username)
}

function syncCognitoUserMfaState() {
  const settings = cognitoUserDetail.data?.mfaSettingList || []
  cognitoUserDetail.mfaEnabled = settings.length > 0
  const preferred = cognitoUserDetail.data?.preferredMfa
  if (preferred === 'SMS_MFA' || preferred === 'SOFTWARE_TOKEN_MFA') {
    cognitoUserDetail.mfaMethod = preferred
    return
  }
  if (settings.includes('SOFTWARE_TOKEN_MFA')) {
    cognitoUserDetail.mfaMethod = 'SOFTWARE_TOKEN_MFA'
  } else {
    cognitoUserDetail.mfaMethod = 'SMS_MFA'
  }
}

async function setCognitoUserMfaEnabled(nextEnabled) {
  if (!cognitoUserDetail.username) return false
  const previousEnabled = !nextEnabled
  cognitoUserDetail.savingMfa = true
  try {
    const payloadMethod = nextEnabled ? cognitoUserDetail.mfaMethod : null
    const r = await awsStore.setCognitoUserMfa(
      cognitoState.selectedPool.id,
      cognitoUserDetail.username,
      nextEnabled,
      payloadMethod,
    )
    if (r?.success) {
      toast(nextEnabled ? t('awsv.lit.mfaTurnedOn') : t('awsv.lit.mfaTurnedOff'), 'success')
      await loadCognitoUsers()
      await refreshCognitoUserDetail()
      return true
    } else {
      cognitoUserDetail.mfaEnabled = previousEnabled
      toast(awsStore.error || t('awsv.lit.mfaToggleFailed'), 'error')
      return false
    }
  } finally { cognitoUserDetail.savingMfa = false }
}

async function onCognitoEnableMfaToggle() {
  await setCognitoUserMfaEnabled(!!cognitoUserDetail.mfaEnabled)
}

async function disableCognitoUserMfa() {
  cognitoUserDetail.mfaEnabled = false
  await setCognitoUserMfaEnabled(false)
}

async function applyCognitoUserMfaMethod() {
  if (!cognitoUserDetail.mfaEnabled) return
  cognitoUserDetail.savingMfa = true
  try {
    const r = await awsStore.setCognitoUserMfa(
      cognitoState.selectedPool.id,
      cognitoUserDetail.username,
      true,
      cognitoUserDetail.mfaMethod,
    )
    if (r?.success) {
      toast(t('awsv.toastMfaUpdated'), 'success')
      await refreshCognitoUserDetail()
    } else {
      toast(awsStore.error || t('awsv.lit.mfaUpdateFailed'), 'error')
    }
  } finally { cognitoUserDetail.savingMfa = false }
}

function cognitoUserAvailableGroups() {
  return (cognitoState.groups || []).filter(group => !cognitoUserDetail.groups.some(current => current.name === group.name))
}

async function saveCognitoUserAttributes() {
  if (!cognitoUserDetail.username) return
  const attributes = {}
  for (const field of cognitoUserDetail.editFields) {
    const value = cognitoUserDetail.editValues[field.name]
    if (field.type === 'checkbox') {
      attributes[field.name] = !!value
      continue
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      attributes[field.name] = trimmed
      continue
    }
    if (value !== undefined && value !== null) attributes[field.name] = value
  }
  cognitoUserDetail.savingAttributes = true
  try {
    const r = await awsStore.updateCognitoUserAttributes(cognitoState.selectedPool.id, cognitoUserDetail.username, attributes)
    if (r?.success) {
      toast(t('awsv.toastAttributesUpdated'), 'success')
      await loadCognitoUsers()
      await refreshCognitoUserDetail()
    } else {
      toast(awsStore.error || t('awsv.lit.userUpdateFailed'), 'error')
    }
  } finally { cognitoUserDetail.savingAttributes = false }
}

async function addCognitoUserGroup() {
  if (!cognitoUserDetail.username || !cognitoUserDetail.selectedGroup) return
  cognitoUserDetail.savingGroup = true
  try {
    const r = await awsStore.addCognitoUserToGroup(cognitoState.selectedPool.id, cognitoUserDetail.username, cognitoUserDetail.selectedGroup)
    if (r?.success) {
      toast(t('awsv.toastGroupAssigned'), 'success')
      cognitoUserDetail.selectedGroup = ''
      await refreshCognitoUserDetail()
    } else {
      toast(awsStore.error || t('awsv.lit.groupAddFailed'), 'error')
    }
  } finally { cognitoUserDetail.savingGroup = false }
}

async function removeCognitoUserGroup(groupName) {
  if (!cognitoUserDetail.username) return
  if (!confirm(t('awsv.confirmRemoveFromGroup', { user: cognitoUserDetail.username, group: groupName }))) return
  cognitoUserDetail.savingGroup = true
  try {
    const r = await awsStore.removeCognitoUserFromGroup(cognitoState.selectedPool.id, cognitoUserDetail.username, groupName)
    if (r?.success) {
      toast(t('awsv.toastGroupRemoved'), 'success')
      await refreshCognitoUserDetail()
    } else {
      toast(awsStore.error || t('awsv.lit.groupRemoveFailed'), 'error')
    }
  } finally { cognitoUserDetail.savingGroup = false }
}

watch(() => cognitoState.poolConfig, () => {
  if (cognitoUserDetail.open && cognitoUserDetail.data) buildCognitoEditFields()
})

// ─── DynamoDB Info Modal ─────────────────────────────────────────────────────
const dynamoInfo = reactive({ open: false, loading: false, error: null, data: null, table: null })

async function openDynamoInfo(t) {
  Object.assign(dynamoInfo, { open: true, loading: true, error: null, data: null, table: t })
  try {
    dynamoInfo.data = await awsStore.fetchDynamoTableConfig(t.name)
    if (!dynamoInfo.data) dynamoInfo.error = awsStore.error || 'Failed to load table info'
  } finally { dynamoInfo.loading = false }
}

// ─── DynamoDB Create Modal ────────────────────────────────────────────────────
const dynamoCreate = reactive({
  open: false, loading: false, error: null, result: null,
  tableName: '', partitionKey: '', partitionKeyType: 'S',
  sortKey: '', sortKeyType: 'S', billingMode: 'PAY_PER_REQUEST',
  readCapacity: 5, writeCapacity: 5,
})

function openDynamoCreate() {
  Object.assign(dynamoCreate, { open: true, loading: false, error: null, result: null, tableName: '', partitionKey: '', partitionKeyType: 'S', sortKey: '', sortKeyType: 'S', billingMode: 'PAY_PER_REQUEST', readCapacity: 5, writeCapacity: 5 })
}

async function submitDynamoCreate() {
  if (!dynamoCreate.tableName.trim() || !dynamoCreate.partitionKey.trim()) {
    dynamoCreate.error = t('awsv.errTableRequired'); return
  }
  dynamoCreate.loading = true; dynamoCreate.error = null; dynamoCreate.result = null
  try {
    const r = await awsStore.createDynamoTable({
      tableName:        dynamoCreate.tableName.trim(),
      partitionKey:     dynamoCreate.partitionKey.trim(),
      partitionKeyType: dynamoCreate.partitionKeyType,
      sortKey:          dynamoCreate.sortKey.trim() || undefined,
      sortKeyType:      dynamoCreate.sortKeyType,
      billingMode:      dynamoCreate.billingMode,
      readCapacity:     dynamoCreate.readCapacity,
      writeCapacity:    dynamoCreate.writeCapacity,
    })
    if (r?.tableName) {
      dynamoCreate.result = `Table "${r.tableName}" created (${r.status})`
      toast(t('awsv.toastTableCreated', { name: r.tableName }), 'success')
      loaded.dynamodb = false; loadTab('dynamodb')
    } else {
      dynamoCreate.error = awsStore.error || 'Failed to create table'
    }
  } finally { dynamoCreate.loading = false }
}

// ─── Glue Info Modal ──────────────────────────────────────────────────────────
const glueInfo = reactive({ open: false, loading: false, error: null, data: null, job: null })

async function openGlueInfo(j) {
  Object.assign(glueInfo, { open: true, loading: true, error: null, data: null, job: j })
  try {
    glueInfo.data = await awsStore.fetchGlueJobConfig(j.name)
    if (!glueInfo.data) glueInfo.error = awsStore.error || 'Failed to load job info'
  } finally { glueInfo.loading = false }
}

// ─── Athena Sub-tabs ─────────────────────────────────────────────────────────
const athenaSubTabs = computed(() => [
  { id: 'workgroups',  label: 'Workgroups' },
  { id: 'datasources', label: 'Data Sources' },
  { id: 'editor',      label: t('awsv.queryEditor') },
])
const athenaSubTab = ref('workgroups')

// ─── Athena Workgroup Info Modal ──────────────────────────────────────────────
const athenaWgInfo = reactive({ open: false, loading: false, error: null, wg: null, data: null })

async function openAthenaWgInfo(wg) {
  Object.assign(athenaWgInfo, { open: true, loading: true, error: null, wg, data: null })
  try {
    athenaWgInfo.data = await awsStore.fetchAthenaWorkgroupConfig(wg.name)
    if (!athenaWgInfo.data) athenaWgInfo.error = awsStore.error || 'Failed to load workgroup config'
  } finally { athenaWgInfo.loading = false }
}

function openAthenaWgQuery(wg) {
  Object.assign(athenaModal, { open: true, workgroup: wg, query: '', outputLocation: '', queryId: null, status: null, results: null, error: null, loading: false })
}

// ─── Athena Catalog Info Modal ────────────────────────────────────────────────
const athenaCatInfo = reactive({ open: false, loading: false, error: null, cat: null, data: null })

async function openAthenaCatalogInfo(cat) {
  Object.assign(athenaCatInfo, { open: true, loading: true, error: null, cat, data: null })
  try {
    athenaCatInfo.data = await awsStore.fetchAthenaCatalogInfo(cat.name)
    if (!athenaCatInfo.data) athenaCatInfo.error = awsStore.error || 'Failed to load catalog info'
  } finally { athenaCatInfo.loading = false }
}

async function loadAthenaDatabaseTables(cat, db) {
  if (db._loadingTables) return
  db._loadingTables = true
  try {
    db.tables = await awsStore.fetchAthenaTables(cat.name, db.name) || []
  } finally { db._loadingTables = false }
}

// ─── Athena Advanced Editor ───────────────────────────────────────────────────
const athenaEditor = reactive({
  sql: '',
  selectedWorkgroup: 'primary',
  selectedCatalog: '',
  selectedDb: '',
  selectedTable: '',
  outputLocation: '',
  catalogs: [],
  catalogsLoading: false,
  running: false,
  queryId: null,
  status: null,
  results: null,
  error: null,
  execTimeMs: 0,
  bytesScanned: 0,
  showHistory: false,
  history: [],
  historyLoading: false,
})

// Workgroups created without a query result location need the user to supply
// one manually (AWS rejects StartQueryExecution otherwise); see athenaEditor.outputLocation.
const athenaSelectedWgOutputLocation = computed(() =>
  awsStore.athenaWorkgroups.find(w => w.name === athenaEditor.selectedWorkgroup)?.outputLocation
)

async function loadAthenaCatalogs() {
  athenaEditor.catalogsLoading = true
  try {
    const cats = await awsStore.fetchAthenaCatalogs() || []
    // Mark all closed by default
    athenaEditor.catalogs = cats.map(c => ({ ...c, _open: false, databases: (c.databases || []).map(d => ({ ...d, _open: false, tables: [], _loadingTables: false })) }))
  } finally { athenaEditor.catalogsLoading = false }
}

async function toggleAthenaDb(cat, db) {
  if (!db._open) {
    // Load tables on first open
    if (!db.tables?.length) {
      db._loadingTables = true
      db._open = true
      try {
        db.tables = await awsStore.fetchAthenaTables(cat.name, db.name) || []
      } finally { db._loadingTables = false }
    } else { db._open = true }
  } else { db._open = false }
}

function selectAthenaDb(cat, db) {
  athenaEditor.selectedCatalog = cat.name
  athenaEditor.selectedDb = db.name
  athenaEditor.selectedTable = ''
}

function selectAthenaTable(cat, db, tbl) {
  athenaEditor.selectedCatalog = cat.name
  athenaEditor.selectedDb = db.name
  athenaEditor.selectedTable = tbl.name
  // Insert a SELECT snippet into the editor
  const snippet = `SELECT *\nFROM "${db.name}"."${tbl.name}"\nLIMIT 10;`
  if (!athenaEditor.sql.trim()) athenaEditor.sql = snippet
}

async function runAthenaEditorQuery() {
  if (!athenaEditor.sql.trim() || athenaEditor.running) return
  athenaEditor.running = true; athenaEditor.error = null; athenaEditor.results = null; athenaEditor.status = null; athenaEditor.queryId = null
  try {
    const wg = athenaEditor.selectedWorkgroup || awsStore.athenaWorkgroups?.[0]?.name || 'primary'
    const outputLocation = athenaSelectedWgOutputLocation.value || athenaEditor.outputLocation.trim() || undefined
    const r = await awsStore.startAthenaQuery(athenaEditor.sql, wg, outputLocation)
    if (!r?.queryExecutionId) {
      const msg = awsStore.error || 'Failed to start query'
      athenaEditor.error = !outputLocation && /output location/i.test(msg)
        ? `${msg} Enter an S3 path in the field next to the workgroup selector and run again.`
        : msg
      return
    }
    athenaEditor.queryId = r.queryExecutionId
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 1000))
      const result = await awsStore.getAthenaQueryResult(athenaEditor.queryId)
      athenaEditor.status = result?.execution?.Status?.State
      if (athenaEditor.status === 'SUCCEEDED') {
        athenaEditor.results = result.results
        athenaEditor.execTimeMs = result.execution?.Statistics?.TotalExecutionTimeInMillis || 0
        athenaEditor.bytesScanned = result.execution?.Statistics?.DataScannedInBytes || 0
        break
      }
      if (athenaEditor.status === 'FAILED' || athenaEditor.status === 'CANCELLED') {
        athenaEditor.error = result?.execution?.Status?.StateChangeReason || 'Query failed'; break
      }
    }
  } finally { athenaEditor.running = false }
}

async function loadAthenaHistory() {
  athenaEditor.showHistory = !athenaEditor.showHistory
  if (athenaEditor.showHistory && !athenaEditor.history.length) {
    athenaEditor.historyLoading = true
    try {
      athenaEditor.history = await awsStore.fetchAthenaHistory(athenaEditor.selectedWorkgroup || 'primary') || []
    } finally { athenaEditor.historyLoading = false }
  }
}

function loadHistoryItem(h) {
  athenaEditor.sql = h.query || ''
  if (h.database) athenaEditor.selectedDb = h.database
  if (h.catalog)  athenaEditor.selectedCatalog = h.catalog
  athenaEditor.showHistory = false
}

function exportAthenaResults() {
  if (!athenaEditor.results) return
  const cols = (athenaEditor.results.ResultSetMetadata?.ColumnInfo || []).map(c => c.Name)
  const rows = (athenaEditor.results.Rows || []).slice(1)
  const csv = [cols.join(','), ...rows.map(r => (r.Data || []).map(c => `"${(c.VarCharValue ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `athena-${Date.now()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// ─── DynamoDB Browse Modal ────────────────────────────────────────────────────

const dynamoBrowse = reactive({
  open: false, loading: false, error: null,
  table: '', keySchema: [], mode: 'scan', limit: 50,
  keyName: '', keyValue: '', keyType: 'S', indexName: '',
  items: null, columns: [], count: 0, scannedCount: 0,
  lastEvaluatedKey: null, prevKeys: [],
})

function openDynamoBrowse(t) {
  const keyName = t.keySchema?.[0]?.name || ''
  Object.assign(dynamoBrowse, { open: true, loading: false, error: null, table: t.name, keySchema: t.keySchema || [], mode: 'scan', limit: 50, keyName, keyValue: '', keyType: 'S', indexName: '', items: null, columns: [], lastEvaluatedKey: null, prevKeys: [] })
}

async function executeDynamoBrowse(exclusiveStartKey) {
  dynamoBrowse.loading = true; dynamoBrowse.error = null
  try {
    let resp
    if (dynamoBrowse.mode === 'scan') {
      resp = await awsStore.scanDynamoTable(dynamoBrowse.table, { limit: dynamoBrowse.limit, exclusiveStartKey })
    } else {
      if (!dynamoBrowse.keyName || dynamoBrowse.keyValue === '') { dynamoBrowse.error = t('awsv.errPartitionRequired'); return }
      resp = await awsStore.queryDynamoTable(dynamoBrowse.table, {
        keyName: dynamoBrowse.keyName, keyValue: dynamoBrowse.keyValue,
        keyType: dynamoBrowse.keyType, indexName: dynamoBrowse.indexName || undefined,
        limit: dynamoBrowse.limit, exclusiveStartKey,
      })
    }
    if (!resp) { dynamoBrowse.error = awsStore.error || 'Failed'; return }
    dynamoBrowse.items            = resp.items || []
    dynamoBrowse.count            = resp.count
    dynamoBrowse.scannedCount     = resp.scannedCount
    dynamoBrowse.lastEvaluatedKey = resp.lastEvaluatedKey || null
    // Derive column list from all returned items
    const colSet = new Set()
    for (const item of dynamoBrowse.items) Object.keys(item).forEach(k => colSet.add(k))
    dynamoBrowse.columns = [...colSet].slice(0, 20) // cap at 20 columns
  } finally { dynamoBrowse.loading = false }
}

async function dynamoNextPage() {
  if (!dynamoBrowse.lastEvaluatedKey) return
  dynamoBrowse.prevKeys.push(dynamoBrowse.lastEvaluatedKey)
  await executeDynamoBrowse(dynamoBrowse.lastEvaluatedKey)
}

async function dynamoPrevPage() {
  if (!dynamoBrowse.prevKeys.length) return
  dynamoBrowse.prevKeys.pop()
  const key = dynamoBrowse.prevKeys[dynamoBrowse.prevKeys.length - 1] || undefined
  await executeDynamoBrowse(key)
}

function formatDynamoValue(val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function isDynamoCellLong(val) {
  if (val === null || val === undefined) return false
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
  return str.length > 40
}

const dynamoCellModal = reactive({ open: false, column: '', raw: '', formatted: '' })

function openDynamoCellModal(column, val) {
  const raw = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
  let formatted = raw
  try { formatted = JSON.stringify(JSON.parse(raw), null, 2) } catch {}
  Object.assign(dynamoCellModal, { open: true, column, raw, formatted })
}

function copyText(text) {
  navigator.clipboard?.writeText(text)
    .then(() => toast(t('res.copied'), 'success'))
    .catch(() => toast(t('term.copyFailed'), 'error'))
}

// ─── DynamoDB Edit Item Modal ─────────────────────────────────────────────────
const dynamoEdit = reactive({
  open: false, loading: false, error: null,
  table: '', keySchema: [],
  jsonText: '', parseError: null,
})

function openDynamoEdit(item) {
  const jsonText = JSON.stringify(item, null, 2)
  Object.assign(dynamoEdit, {
    open: true, loading: false, error: null,
    table: dynamoBrowse.table, keySchema: dynamoBrowse.keySchema,
    jsonText, parseError: null,
  })
}

function openDynamoNewItem() {
  const template = {}
  for (const k of dynamoBrowse.keySchema) template[k.name] = ''
  Object.assign(dynamoEdit, {
    open: true, loading: false, error: null,
    table: dynamoBrowse.table, keySchema: dynamoBrowse.keySchema,
    jsonText: JSON.stringify(template, null, 2), parseError: null,
  })
}

function validateDynamoEditJson() {
  try {
    JSON.parse(dynamoEdit.jsonText)
    dynamoEdit.parseError = null
    return true
  } catch (e) {
    dynamoEdit.parseError = e.message
    return false
  }
}

async function submitDynamoEdit() {
  if (!validateDynamoEditJson()) return
  dynamoEdit.loading = true; dynamoEdit.error = null
  try {
    const item = JSON.parse(dynamoEdit.jsonText)
    const result = await awsStore.putDynamoItem(dynamoEdit.table, item)
    if (!result) { dynamoEdit.error = awsStore.error || 'Failed to save item'; return }
    toast(t('awsv.toastItemSaved'), 'success')
    dynamoEdit.open = false
    await executeDynamoBrowse(dynamoBrowse.prevKeys[dynamoBrowse.prevKeys.length - 1])
  } catch (e) {
    dynamoEdit.error = e.message
  } finally {
    dynamoEdit.loading = false
  }
}

async function deleteDynamoItemFromRow(item) {
  const keyAttrs = {}
  for (const k of dynamoBrowse.keySchema) {
    if (item[k.name] === undefined) { toast(t('awsv.toastKeyMissing', { name: k.name }), 'error'); return }
    keyAttrs[k.name] = item[k.name]
  }
  if (!confirm(t('awsv.confirmDeleteItem', { key: JSON.stringify(keyAttrs) }))) return
  const result = await awsStore.deleteDynamoItem(dynamoBrowse.table, keyAttrs)
  if (!result) { toast(awsStore.error || 'Failed to delete item', 'error'); return }
  toast(t('awsv.toastItemDeleted'), 'success')
  await executeDynamoBrowse(dynamoBrowse.prevKeys[dynamoBrowse.prevKeys.length - 1])
}

// ─── RDS actions/modals ──────────────────────────────────────────────────────

const rdsInfoModal = reactive({ open: false, loading: false, error: null, id: '', data: null })
const rdsConnectModal = reactive({ open: false, loading: false, error: null, id: '', password: '', data: null })
const rdsResetPwdModal = reactive({ open: false, loading: false, error: null, success: null, id: '', newPassword: '', confirmPassword: '' })
const rdsInfoTabs = computed(() => [
  { id: 'connectivity', label: t('awsv.connectivityAndSecurity') },
  { id: 'monitoring', label: t('awsv.rdsTabMonitoring') },
  { id: 'configuration', label: t('lmd.tabConfig') },
  { id: 'maintenance', label: t('awsv.rdsTabMaintenance') },
  { id: 'migration', label: t('awsv.rdsTabMigration') },
  { id: 'tags', label: t('awsv.tags') },
])
const rdsInfoTab = ref('connectivity')

const rdsInfoHighlights = computed(() => {
  const d = rdsInfoModal.data || {}
  const sgCount = (d.vpcSecurityGroups || []).length
  const logCount = (d.enabledCloudwatchLogsExports || []).length
  const replicasCount = (d.readReplicaDBInstanceIdentifiers || []).length + (d.readReplicaDBClusterIdentifiers || []).length
  const tagCount = (d.tags || []).length

  switch (rdsInfoTab.value) {
    case 'connectivity':
      return [
        { label: 'Endpoint', value: d.endpoint ? `${d.endpoint}:${d.port || ''}` : '-', tone: 'text-dim' },
        { label: t('awsv.publicAccess'), value: d.public ? t('res.enabled') : t('eksd.private'), tone: d.public ? 'status-warn' : 'status-ok' },
        { label: t('awsv.securityGroupsLabel'), value: String(sgCount), tone: sgCount ? 'status-ok' : 'text-dim' },
      ]
    case 'monitoring':
      return [
        { label: t('awsv.enhancedMonitoring'), value: d.monitoringInterval ? t('gri.probeEvery', { n: d.monitoringInterval }) : t('res.disabled'), tone: d.monitoringInterval ? 'status-ok' : 'text-dim' },
        { label: 'Performance Insights', value: d.performanceInsightsEnabled ? t('res.enabled') : t('res.disabled'), tone: d.performanceInsightsEnabled ? 'status-ok' : 'text-dim' },
        { label: t('awsv.exportedLogs'), value: String(logCount), tone: logCount ? 'status-ok' : 'text-dim' },
      ]
    case 'configuration':
      return [
        { label: t('gsi.engine'), value: `${d.engine || '-'} ${d.engineVersion || ''}`.trim(), tone: 'text-dim' },
        { label: t('awsv.instanceClass'), value: d.class || '-', tone: 'text-dim' },
        { label: t('ec2d.tabStorage'), value: `${d.storageGb ?? '-'} GiB`, tone: 'text-dim' },
      ]
    case 'maintenance':
      return [
        { label: t('awsv.backupRetention'), value: d.backupRetention != null ? t('awsv.daysValue', { n: d.backupRetention }) : '-', tone: 'text-dim' },
        { label: t('awsv.deletionProtection'), value: d.deletionProtection ? t('res.enabled') : t('res.disabled'), tone: d.deletionProtection ? 'status-ok' : 'text-dim' },
        { label: t('res.state'), value: d.status || '-', tone: d.status === 'available' ? 'status-ok' : 'status-warn' },
      ]
    case 'migration':
      return [
        { label: t('awsv.sourceInstance'), value: d.readReplicaSourceDBInstanceIdentifier || '-', tone: 'text-dim' },
        { label: t('awsv.replicaMode'), value: d.replicaMode || '-', tone: 'text-dim' },
        { label: t('awsv.totalReplicas'), value: String(replicasCount), tone: replicasCount ? 'status-ok' : 'text-dim' },
      ]
    case 'tags':
      return [
        { label: t('awsv.tags'), value: String(tagCount), tone: tagCount ? 'status-ok' : 'text-dim' },
        { label: t('awsv.copyTagsToSnapshot'), value: t(d.copyTagsToSnapshot ? 'common.yes' : 'common.no'), tone: d.copyTagsToSnapshot ? 'status-ok' : 'text-dim' },
        { label: 'ARN', value: d.arn || '-', tone: 'text-dim' },
      ]
    default:
      return []
  }
})

const rdsConnectionEntries = computed(() => {
  const t = rdsConnectModal.data?.templates || {}
  const entries = []
  if (t.psql) entries.push({ key: 'psql', label: 'psql', value: String(t.psql).replace('<PASSWORD>', rdsConnectModal.password || '<PASSWORD>') })
  if (t.mysql) entries.push({ key: 'mysql', label: 'mysql', value: String(t.mysql).replace('<PASSWORD>', rdsConnectModal.password || '<PASSWORD>') })
  if (t.sqlcmd) entries.push({ key: 'sqlcmd', label: 'sqlcmd', value: String(t.sqlcmd).replace('<PASSWORD>', rdsConnectModal.password || '<PASSWORD>') })
  if (t.jdbc) entries.push({ key: 'jdbc', label: 'JDBC', value: t.jdbc })
  return entries
})

async function openRdsInfo(db) {
  rdsInfoTab.value = 'connectivity'
  Object.assign(rdsInfoModal, { open: true, loading: true, error: null, id: db.id, data: null })
  try {
    rdsInfoModal.data = await awsStore.fetchRdsConfig(db.id)
    if (!rdsInfoModal.data) rdsInfoModal.error = awsStore.error || t('awsv.lit.rdsInfoFailed')
  } catch (e) { rdsInfoModal.error = e.message }
  finally { rdsInfoModal.loading = false }
}

async function openRdsConnect(db) {
  Object.assign(rdsConnectModal, { open: true, loading: true, error: null, id: db.id, password: '', data: null })
  try {
    rdsConnectModal.data = await awsStore.fetchRdsConnectionStrings(db.id)
    if (!rdsConnectModal.data) rdsConnectModal.error = awsStore.error || t('awsv.lit.rdsConnectionFailed')
  } catch (e) { rdsConnectModal.error = e.message }
  finally { rdsConnectModal.loading = false }
}

function openRdsResetPwd(db) {
  Object.assign(rdsResetPwdModal, {
    open: true, loading: false, error: null, success: null,
    id: db.id, newPassword: '', confirmPassword: '',
  })
}

async function doRdsResetPassword() {
  rdsResetPwdModal.error = null
  rdsResetPwdModal.success = null
  if (!rdsResetPwdModal.newPassword || rdsResetPwdModal.newPassword.length < 8) {
    rdsResetPwdModal.error = t('awsv.errPasswordLength')
    return
  }
  if (rdsResetPwdModal.newPassword !== rdsResetPwdModal.confirmPassword) {
    rdsResetPwdModal.error = t('awsv.errPasswordMismatch')
    return
  }
  rdsResetPwdModal.loading = true
  try {
    const resp = await awsStore.resetRdsPassword(rdsResetPwdModal.id, rdsResetPwdModal.newPassword)
    if (resp?.ok) {
      rdsResetPwdModal.success = resp.message || t('awsv.lit.resetStarted')
      rdsResetPwdModal.newPassword = ''
      rdsResetPwdModal.confirmPassword = ''
    } else {
      rdsResetPwdModal.error = awsStore.error || t('awsv.lit.resetFailed')
    }
  } catch (e) { rdsResetPwdModal.error = e.message }
  finally { rdsResetPwdModal.loading = false }
}

// ─── Glue Job Config Modal ─────────────────────────────────────────────────────

const glueConfigModal = reactive({ open: false, loading: false, loadingRuns: false, error: null, job: null, data: null, lastRun: null })

async function openGlueJobConfig(job) {
  Object.assign(glueConfigModal, { open: true, loading: true, loadingRuns: true, error: null, job, data: null, lastRun: null })
  try {
    const [cfg, runs] = await Promise.allSettled([
      awsStore.fetchGlueJobConfig(job.name),
      awsStore.fetchGlueJobRuns(job.name)
    ])
    glueConfigModal.data = cfg.status === 'fulfilled' ? cfg.value : null
    if (!glueConfigModal.data) glueConfigModal.error = awsStore.error || 'Failed to load config'
    const runsList = runs.status === 'fulfilled' ? runs.value : []
    glueConfigModal.lastRun = Array.isArray(runsList) && runsList.length ? runsList[0] : null
  } finally { glueConfigModal.loading = false; glueConfigModal.loadingRuns = false }
}

function glueS3ConsoleUrl(scriptLocation) {
  if (!scriptLocation || !scriptLocation.startsWith('s3://')) return '#'
  const withoutScheme = scriptLocation.slice(5)
  const slashIdx = withoutScheme.indexOf('/')
  if (slashIdx === -1) return `https://s3.console.aws.amazon.com/s3/buckets/${withoutScheme}`
  const bucket = withoutScheme.slice(0, slashIdx)
  const key = withoutScheme.slice(slashIdx + 1)
  return `https://s3.console.aws.amazon.com/s3/object/${bucket}?prefix=${encodeURIComponent(key)}`
}

// ─── Glue Logs Modal ──────────────────────────────────────────────────────────

const glueLogsModal = reactive({ open: false, loading: false, error: null, job: null, minutes: 60, events: [] })

async function openGlueLogs(job) {
  Object.assign(glueLogsModal, { open: true, loading: true, error: null, job, minutes: 60, events: [] })
  await loadGlueLogs()
}

async function loadGlueLogs() {
  glueLogsModal.loading = true; glueLogsModal.error = null
  try {
    const data = await awsStore.fetchGlueLogs(glueLogsModal.job.name, { minutes: glueLogsModal.minutes })
    if (data) { glueLogsModal.events = data.events || [] }
    else { glueLogsModal.error = awsStore.error || 'Failed to load logs' }
  } finally { glueLogsModal.loading = false }
}

// ─── Secrets Manager → Import to Env Modal ────────────────────────────────────

const importSecretModal = reactive({
  open: false, loading: false, loadingKeys: false, secret: null,
  mode: 'new', targetProfileId: '', profileName: '',
  previewKeys: [], selectedKeys: [], keysError: null,
  result: null, error: null,
})

const envProfiles = computed(() => (envStore.profiles || []).filter(p => p.provider === 'generic' || p.provider === 'aws'))

async function openImportSecret(s) {
  Object.assign(importSecretModal, {
    open: true, secret: s, mode: 'new', targetProfileId: '', profileName: s.name.split('/').pop(),
    previewKeys: [], selectedKeys: [], keysError: null, result: null, error: null, loading: false, loadingKeys: true,
  })
  try {
    const resp = await awsStore.previewSecretKeys(s.name)
    if (resp?.keys) {
      importSecretModal.previewKeys  = resp.keys
      importSecretModal.selectedKeys = [...resp.keys]
    } else {
      importSecretModal.keysError = awsStore.error || t('awsv.lit.secretKeysFailed')
    }
  } catch (e) { importSecretModal.keysError = e.message }
  finally { importSecretModal.loadingKeys = false }
}

function toggleSecretKey(k) {
  const idx = importSecretModal.selectedKeys.findIndex(s => s.original === k.original)
  if (idx === -1) importSecretModal.selectedKeys.push(k)
  else importSecretModal.selectedKeys.splice(idx, 1)
}

async function submitImportSecret() {
  importSecretModal.loading = true; importSecretModal.error = null; importSecretModal.result = null
  try {
    const r = await awsStore.importSelectedSecretKeys(
      importSecretModal.secret.name,
      importSecretModal.selectedKeys,
      importSecretModal.mode === 'existing' ? importSecretModal.targetProfileId : null,
      importSecretModal.mode === 'new' ? importSecretModal.profileName : null,
    )
    if (r?.keysImported) {
      importSecretModal.result = `✓ ${r.keysImported} variable(s) importadas exitosamente al Env Manager.`
      toast(t('awsv.toastImported', { n: r.keysImported }), 'success')
      envStore.fetchProfiles()
    } else {
      importSecretModal.error = awsStore.error || 'Import fallido'
    }
  } finally { importSecretModal.loading = false }
}

// ─── Secret Config Modal ──────────────────────────────────────────────────────

const secretConfigModal = reactive({ open: false, loading: false, error: null, secret: null, data: null })

async function openSecretConfig(s) {
  Object.assign(secretConfigModal, { open: true, loading: true, error: null, secret: s, data: null })
  try {
    secretConfigModal.data = await awsStore.fetchSecretConfig(s.name)
    if (!secretConfigModal.data) secretConfigModal.error = awsStore.error || t('awsv.lit.secretConfigFailed')
  } catch (e) { secretConfigModal.error = e.message }
  finally { secretConfigModal.loading = false }
}

// ─── Secret Integration Examples Modal ───────────────────────────────────────

const secretIntegrationModal = reactive({ open: false, secret: null, tab: 'boto3', examples: {} })

function openSecretIntegration(s) {
  const name = s.name
  const arn  = s.arn
  const examples = {
    boto3: `import boto3, json

client = boto3.client('secretsmanager')

def get_secret(secret_name: str) -> dict:
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response['SecretString'])

secret = get_secret('${name}')
print(secret)`,

    nodejs: `import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

async function getSecret(secretName) {
  const resp = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  return JSON.parse(resp.SecretString);
}

const secret = await getSecret('${name}');
console.log(secret);`,

    cli: `# Obtener el valor del secreto
aws secretsmanager get-secret-value \\
  --secret-id '${name}' \\
  --query SecretString \\
  --output text | jq .

# Describir metadatos (sin valor)
aws secretsmanager describe-secret \\
  --secret-id '${name}'

# Listar versiones
aws secretsmanager list-secret-version-ids \\
  --secret-id '${name}'`,

    env: `# ECS Task Definition (valueFrom con ARN)
{
  "name": "MY_SECRET",
  "valueFrom": "${arn}:MY_KEY::"
}

# Docker Compose con aws-secretsmanager-env-injector
# https://github.com/coresolutions-ltd/docker-secret-injector

# Bash: inyectar en el entorno actual
export $(aws secretsmanager get-secret-value \\
  --secret-id '${name}' \\
  --query SecretString --output text | \\
  jq -r 'to_entries|map("\\(.key)=\\(.value|tostring)")|.[]')`,
  }
  Object.assign(secretIntegrationModal, { open: true, secret: s, tab: 'boto3', examples })
}
</script>

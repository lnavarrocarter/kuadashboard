<template>
  <div class="cloud-view">

    <div class="cloud-view-header">
      <h2 class="cloud-view-title">Amazon Web Services</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select v-model="selectedProfileId" class="ctrl-select" @change="onProfileChange">
          <optgroup v-if="envStore.awsProfiles.length" label="Stored profiles">
            <option v-for="p in envStore.awsProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </optgroup>
          <optgroup v-if="localProfiles.length" label="~/.aws/credentials">
            <option v-for="p in localProfiles" :key="`local:${p.name}`" :value="`local:${p.name}`">
              {{ p.name }} ({{ p.region }})
            </option>
          </optgroup>
        </select>
        <button v-if="selectedProfileId" class="btn" @click="reloadActiveTab" :disabled="tabLoading">
        </button>
      </div>
    </div>

    <div v-if="!selectedProfileId" class="empty-state">
      Select an AWS credential profile above to load resources.<br />
      <span class="text-dim">No profile? Go to <strong>Env Manager</strong> to create one.</span>
    </div>

    <template v-else>
      <div v-if="awsStore.error" class="alert-error">{{ awsStore.error }}</div>

      <div class="aws-tab-bar">
        <button
          v-for="tab in TABS" :key="tab.id"
          :class="['aws-tab-btn', { active: activeTab === tab.id }]"
          @click="switchTab(tab.id)"
        >
          {{ tab.label }}
          <span v-if="tabCount(tab.id) > 0" class="tab-badge">{{ tabCount(tab.id) }}</span>
        </button>
      </div>

      <div class="aws-toolbar">
        <input
          v-model="search[activeTab]"
          class="ctrl-input aws-search"
        />
        <span class="text-dim" style="font-size:12px">
          <template v-if="awsStore.loading">Loading...</template>
          <template v-else>{{ activeRowCount }} result{{ activeRowCount !== 1 ? 's' : '' }}</template>
        </span>
      </div>

           TAB PANELS

      <div v-show="activeTab === 'ec2'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredEc2.length" class="empty-row">{{ search.ec2 ? 'No matches.' : 'No EC2 instances found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"       @click="sortBy('name')">Name / ID <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('type')"       @click="sortBy('type')">Type <span class="sort-icon">{{ sortIcon('type') }}</span></th>
            <th :class="thClass('state')"      @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
            <th :class="thClass('publicIp')"   @click="sortBy('publicIp')">Public IP <span class="sort-icon">{{ sortIcon('publicIp') }}</span></th>
            <th :class="thClass('az')"         @click="sortBy('az')">AZ <span class="sort-icon">{{ sortIcon('az') }}</span></th>
            <th :class="thClass('launchTime')" @click="sortBy('launchTime')">Launched <span class="sort-icon">{{ sortIcon('launchTime') }}</span></th>
            <th>Tags</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="i in sortRows(filteredEc2)" :key="i.id">
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
                <div class="tag-chips">
                  <span v-for="t in (i.tags || []).filter(t => t.Key !== 'Name')"
                    :key="t.Key" class="tag-chip">{{ t.Key }}={{ t.Value }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="startEc2(i)" :disabled="i.state === 'running'">Start</button>
                  <button class="btn sm danger" @click="stopEc2(i)" :disabled="i.state === 'stopped'">Stop</button>
                  <button class="btn sm" @click="openTags('ec2', `EC2: ${i.name}`, i.id, i.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('ec2', `EC2: ${i.name}`, i, { id: i.id })">Config</button>
                  <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e"
                    @click="openEc2Shell(i)" :disabled="i.state !== 'running'">SSH</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'ecs'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredEcs.length" class="empty-row">{{ search.ecs ? 'No matches.' : 'No ECS services found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"      @click="sortBy('name')">Service <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('cluster')"   @click="sortBy('cluster')">Cluster <span class="sort-icon">{{ sortIcon('cluster') }}</span></th>
            <th :class="thClass('status')"    @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('desired')"   @click="sortBy('desired')">Desired <span class="sort-icon">{{ sortIcon('desired') }}</span></th>
            <th :class="thClass('running')"   @click="sortBy('running')">Running <span class="sort-icon">{{ sortIcon('running') }}</span></th>
            <th :class="thClass('createdAt')" @click="sortBy('createdAt')">Created <span class="sort-icon">{{ sortIcon('createdAt') }}</span></th>
            <th>Tags</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="svc in sortRows(filteredEcs)" :key="`${svc.cluster}/${svc.name}`">
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
                <div class="tag-chips">
                  <span v-for="t in (svc.tags || [])" :key="t.key || t.Key" class="tag-chip">{{ t.key || t.Key }}={{ t.value || t.Value }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="startEcs(svc)">Start</button>
                  <button class="btn sm danger" @click="stopEcs(svc)">Stop</button>
                  <button class="btn sm" @click="openLogs('ecs', svc.name, svc.cluster)">Logs</button>
                  <button class="btn sm" @click="openLogging('ecs', svc)">CW Logs</button>
                  <button class="btn sm" @click="openConfig('ecs', `ECS: ${svc.name}`, svc, { cluster: svc.cluster, name: svc.name })">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'eks'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredEks.length" class="empty-row">{{ search.eks ? 'No matches.' : 'No EKS clusters found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"      @click="sortBy('name')">Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('region')"    @click="sortBy('region')">Region <span class="sort-icon">{{ sortIcon('region') }}</span></th>
            <th :class="thClass('version')"   @click="sortBy('version')">Version <span class="sort-icon">{{ sortIcon('version') }}</span></th>
            <th :class="thClass('status')"    @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('createdAt')" @click="sortBy('createdAt')">Created <span class="sort-icon">{{ sortIcon('createdAt') }}</span></th>
            <th>Tags</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="c in sortRows(filteredEks)" :key="c.name">
              <td>{{ c.name }}</td>
              <td class="text-dim">{{ c.region }}</td>
              <td class="text-dim">{{ c.version }}</td>
              <td><span :class="eksStatusClass(c.status)">{{ c.status }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ c.createdAt ? formatDate(c.createdAt) : '-' }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="(v, k) in (c.tags || {})" :key="k" class="tag-chip">{{ k }}={{ v }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openConfig('eks', `EKS: ${c.name}`, c, { name: c.name })">Config</button>
                  <button class="btn sm" style="background:rgba(63,185,80,.18);border-color:#3fb950;color:#3fb950"
                    @click="addEksToKubeconfig(c)" :disabled="c.status !== 'ACTIVE'">Add to Dashboard</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'lambda'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredLambda.length" class="empty-row">{{ search.lambda ? 'No matches.' : 'No Lambda functions found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"         @click="sortBy('name')">Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('runtime')"      @click="sortBy('runtime')">Runtime <span class="sort-icon">{{ sortIcon('runtime') }}</span></th>
            <th :class="thClass('memory')"       @click="sortBy('memory')">Memory <span class="sort-icon">{{ sortIcon('memory') }}</span></th>
            <th :class="thClass('timeout')"      @click="sortBy('timeout')">Timeout <span class="sort-icon">{{ sortIcon('timeout') }}</span></th>
            <th :class="thClass('state')"        @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
            <th :class="thClass('lastModified')" @click="sortBy('lastModified')">Modified <span class="sort-icon">{{ sortIcon('lastModified') }}</span></th>
            <th>Tags</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="fn in sortRows(filteredLambda)" :key="fn.name">
              <td>
                <div>{{ fn.name }}</div>
                <div v-if="fn.description" class="text-dim mono-xs">{{ fn.description }}</div>
              </td>
              <td class="text-dim">{{ fn.runtime }}</td>
              <td class="text-dim">{{ fn.memory }} MB</td>
              <td class="text-dim">{{ fn.timeout }}s</td>
              <td><span :class="lambdaStateClass(fn.state)">{{ fn.state }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ fn.lastModified ? formatDate(fn.lastModified) : '-' }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="(v, k) in (fn.tags || {})" :key="k" class="tag-chip">{{ k }}={{ v }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openInvoke(fn)">Invoke</button>
                  <button class="btn sm" @click="openLogs('lambda', fn.name)">Logs</button>
                  <button class="btn sm" @click="openLogging('lambda', fn)">CW Logs</button>
                  <button class="btn sm" @click="openTags('lambda', `Lambda: ${fn.name}`, fn.arn, fn.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('lambda', `Lambda: ${fn.name}`, fn, { name: fn.name })">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'apigw'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredApigw.length" class="empty-row">{{ search.apigw ? 'No matches.' : 'No APIs found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"        @click="sortBy('name')">Name / ID <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('type')"        @click="sortBy('type')">Type <span class="sort-icon">{{ sortIcon('type') }}</span></th>
            <th>Endpoint</th>
            <th :class="thClass('createdDate')" @click="sortBy('createdDate')">Created <span class="sort-icon">{{ sortIcon('createdDate') }}</span></th>
            <th>Actions</th>
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
                <button class="btn sm" @click="openConfig('apigateway', `API: ${api.name}`, api, { id: api.id, type: api.type })">Config</button>
                <button class="btn sm" style="background:rgba(163,113,247,.18);border-color:#a371f7;color:#a371f7"
                  @click="openApigwRoutes(api)">Routes</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 's3'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredS3.length" class="empty-row">{{ search.s3 ? 'No matches.' : 'No S3 buckets found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"         @click="sortBy('name')">Bucket <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('region')"       @click="sortBy('region')">Region <span class="sort-icon">{{ sortIcon('region') }}</span></th>
            <th :class="thClass('creationDate')" @click="sortBy('creationDate')">Created <span class="sort-icon">{{ sortIcon('creationDate') }}</span></th>
            <th>Tags</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="b in sortRows(filteredS3)" :key="b.name">
              <td class="mono-sm">{{ b.name }}</td>
              <td class="text-dim">{{ b.region }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ formatDate(b.creationDate) }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="t in (b.tags || [])" :key="t.Key" class="tag-chip">{{ t.Key }}={{ t.Value }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('s3', `S3: ${b.name}`, b.name, b.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('s3', `S3: ${b.name}`, b, { bucket: b.name })">Config</button>
                  <button class="btn sm" style="background:rgba(88,166,255,.18);border-color:#58a6ff;color:#58a6ff"
                    @click="openS3Browser(b)">Browse</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'ecr'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredEcr.length" class="empty-row">{{ search.ecr ? 'No matches.' : 'No ECR repositories found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"               @click="sortBy('name')">Repository <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th>URI</th>
            <th :class="thClass('imageTagMutability')" @click="sortBy('imageTagMutability')">Mutability <span class="sort-icon">{{ sortIcon('imageTagMutability') }}</span></th>
            <th :class="thClass('scanOnPush')"         @click="sortBy('scanOnPush')">Scan <span class="sort-icon">{{ sortIcon('scanOnPush') }}</span></th>
            <th :class="thClass('createdAt')"          @click="sortBy('createdAt')">Created <span class="sort-icon">{{ sortIcon('createdAt') }}</span></th>
            <th>Tags</th><th>Actions</th>
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
              <td><span :class="r.scanOnPush ? 'status-ok' : 'status-err'">{{ r.scanOnPush ? 'Yes' : 'No' }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ r.createdAt ? formatDate(r.createdAt) : '-' }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="t in (r.tags || [])" :key="t.Key" class="tag-chip">{{ t.Key }}={{ t.Value }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('ecr', `ECR: ${r.name}`, r.arn, r.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('ecr', `ECR: ${r.name}`, r, { repo: r.name })">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'vpc'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredVpc.length" class="empty-row">{{ search.vpc ? 'No matches.' : 'No VPCs found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"    @click="sortBy('name')">Name / ID <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('cidr')"    @click="sortBy('cidr')">CIDR <span class="sort-icon">{{ sortIcon('cidr') }}</span></th>
            <th :class="thClass('state')"   @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
            <th :class="thClass('default')" @click="sortBy('default')">Default <span class="sort-icon">{{ sortIcon('default') }}</span></th>
            <th>Subnets</th><th>Tags</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="v in sortRows(filteredVpc)" :key="v.id">
              <td>
                <div>{{ v.name }}</div>
                <div class="text-dim mono-xs">{{ v.id }}</div>
              </td>
              <td class="text-dim">{{ v.cidr }}</td>
              <td><span :class="v.state === 'available' ? 'status-ok' : 'status-warn'">{{ v.state }}</span></td>
              <td><span :class="v.default ? 'status-warn' : 'text-dim'">{{ v.default ? 'Yes' : 'No' }}</span></td>
              <td class="text-dim">{{ v.subnets.length }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="t in (v.tags || []).filter(t => t.Key !== 'Name')"
                    :key="t.Key" class="tag-chip">{{ t.Key }}={{ t.Value }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('vpc', `VPC: ${v.name}`, v.id, v.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('vpc', `VPC: ${v.name}`, v, { id: v.id })">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'eventbridge'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredEventBridge.length" class="empty-row">{{ search.eventbridge ? 'No matches.' : 'No EventBridge rules found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"         @click="sortBy('name')">Rule Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('busName')"       @click="sortBy('busName')">Bus <span class="sort-icon">{{ sortIcon('busName') }}</span></th>
            <th :class="thClass('state')"         @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
            <th :class="thClass('scheduleExpr')"  @click="sortBy('scheduleExpr')">Schedule / Pattern <span class="sort-icon">{{ sortIcon('scheduleExpr') }}</span></th>
            <th>Tags</th><th>Actions</th>
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
                <div class="tag-chips">
                  <span v-for="t in (r.tags || [])" :key="t.Key" class="tag-chip">{{ t.Key }}={{ t.Value }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('eventbridge', `Rule: ${r.name}`, r.arn, r.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('eventbridge', `Rule: ${r.name}`, r, { bus: r.busName, name: r.name })">Config</button>
                  <button class="btn sm" style="background:rgba(99,102,241,0.2);border-color:#6366f1" @click="openEbDetails(r)">Details</button>
                  <button class="btn sm" @click="openEbLogs(r)">Logs</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-show="activeTab === 'stepfn'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredStepFn.length" class="empty-row">{{ search.stepfn ? 'No matches.' : 'No Step Functions found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"         @click="sortBy('name')">Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('type')"         @click="sortBy('type')">Type <span class="sort-icon">{{ sortIcon('type') }}</span></th>
            <th :class="thClass('creationDate')" @click="sortBy('creationDate')">Created <span class="sort-icon">{{ sortIcon('creationDate') }}</span></th>
            <th>Tags</th><th>ARN</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="sm in sortRows(filteredStepFn)" :key="sm.arn">
              <td>{{ sm.name }}</td>
              <td><span :class="sm.type === 'EXPRESS' ? 'status-warn' : 'status-ok'">{{ sm.type }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ formatDate(sm.creationDate) }}</td>
              <td>
                <div class="tag-chips">
                  <span v-for="t in (sm.tags || [])" :key="t.key" class="tag-chip">{{ t.key }}={{ t.value }}</span>
                </div>
              </td>
              <td class="text-dim mono-xs" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="sm.arn">{{ sm.arn }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openTags('stepfn', `SF: ${sm.name}`, sm.arn, sm.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('stepfn', `SF: ${sm.name}`, sm, { arn: sm.arn })">Config</button>
                  <button class="btn sm" style="background:rgba(99,102,241,0.2);border-color:#6366f1" @click="openDiagram(sm)">Diagram</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </template>

         MODALS

    <div v-if="configModal.open" class="modal-overlay" @click.self="configModal.open = false">
      <div class="modal" style="width:900px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
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
              {{ configModal.fullLoaded ? 'Re-fetch' : 'Full Config' }}
            </button>
            <button class="btn sm" @click="copyConfig">Copy</button>
          </div>
        </div>
        <div v-if="configModal.error" class="alert-error" style="margin:0;flex-shrink:0">{{ configModal.error }}</div>
        <pre class="config-pre">{{ configDisplay }}</pre>
      </div>
    </div>

    <div v-if="logsModal.open" class="modal-overlay" @click.self="logsModal.open = false">
      <div class="modal" style="width:860px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
            <span v-if="logsModal.logGroupName" class="text-dim mono-xs" style="margin-left:8px">{{ logsModal.logGroupName }}</span>
          </span>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            <select v-model="logsModal.minutes" class="ctrl-select" @change="reloadLogs" style="font-size:12px;padding:2px 6px">
              <option :value="15">Last 15 min</option>
              <option :value="60">Last 1 h</option>
              <option :value="360">Last 6 h</option>
              <option :value="1440">Last 24 h</option>
            </select>
            <button class="btn sm" @click="reloadLogs">Refresh</button>
          </div>
        </div>
        <div v-if="logsModal.loading" class="empty-row">Loading logs...</div>
        <div v-else-if="logsModal.error" class="alert-error">{{ logsModal.error }}</div>
        <div v-else-if="!logsModal.events.length" class="empty-row">No log events in selected range.</div>
        <div v-else class="logs-viewer">
          <div v-for="(ev, idx) in logsModal.events" :key="idx" class="log-line">
            <span class="log-ts">{{ formatTs(ev.timestamp) }}</span>
            <span class="log-msg">{{ ev.message }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="invokeModal.open" class="modal-overlay" @click.self="invokeModal.open = false">
      <div class="modal" style="width:600px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between">
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <label style="font-size:12px;color:var(--text-dim)">JSON Payload (optional)</label>
          <textarea v-model="invokeModal.payload" rows="6"
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
            </button>
            <button class="btn sm" @click="invokeModal.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- EventBridge Rule Logs Modal -->
    <div v-if="ebLogsModal.open" class="modal-overlay" @click.self="ebLogsModal.open = false">
      <div class="modal" style="width:min(840px,96vw);max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            Logs &amp; Metrics &mdash; {{ ebLogsModal.ruleName }}
          </span>
          <div style="display:flex;gap:6px;align-items:center">
            <select v-model.number="ebLogsModal.minutes" class="ctrl-select" style="font-size:12px" @change="reloadEbLogs">
              <option :value="15">Last 15 min</option>
              <option :value="60">Last 1 h</option>
              <option :value="360">Last 6 h</option>
              <option :value="1440">Last 24 h</option>
              <option :value="4320">Last 3 d</option>
              <option :value="10080">Last 7 d</option>
            </select>
            <button class="btn sm" @click="reloadEbLogs" :disabled="ebLogsModal.loading">Refresh</button>
            <button class="btn sm" @click="ebLogsModal.open = false">Close</button>
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
      <div class="modal" style="width:min(860px,96vw);max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            EventBridge &mdash; {{ ebDetailsModal.name }}
          </span>
          <div style="display:flex;gap:6px;align-items:center">
            <span v-if="ebDetailsModal.state" :class="ebDetailsModal.state === 'ENABLED' ? 'status-ok' : 'status-err'" style="font-size:11px;font-weight:600">{{ ebDetailsModal.state }}</span>
            <button class="btn sm" @click="ebDetailsModal.open = false">Close</button>
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
      <div class="modal" style="width:min(900px,96vw);height:min(680px,90vh);display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">
            Step Function Diagram &mdash; {{ diagramModal.name }}
          </span>
          <div style="display:flex;gap:6px;align-items:center">
            <span v-if="diagramModal.type" class="tag-chip" style="font-size:11px;padding:2px 8px">{{ diagramModal.type }}</span>
            <button class="btn sm" @click="diagramModal.open = false">Close</button>
          </div>
        </div>
        <div style="flex:1;min-height:0;padding:10px;display:flex;flex-direction:column">
          <div v-if="diagramModal.loading" class="empty-row">Loading definition...</div>
          <div v-else-if="diagramModal.error" class="alert-error">{{ diagramModal.error }}</div>
          <StepFnDiagram v-else :definition="diagramModal.definition" style="flex:1;min-height:0" />
        </div>
      </div>
    </div>

    <!-- EC2 SSH Shell Modal -->
    <Ec2Shell :open="ec2ShellModal.open" :instance="ec2ShellModal.instance" @close="ec2ShellModal.open = false" />

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
      <div class="modal" style="width:620px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">Tags — {{ tagsModal.title }}</span>
          <button class="btn sm" @click="tagsModal.open = false">Close</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div v-if="tagsModal.loading" class="empty-row">Loading...</div>
          <div v-else>
            <table class="cloud-table" style="margin-bottom:8px">
              <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
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
            <button class="btn sm" @click="addTagRow">+ Add tag</button>
          </div>
          <div v-if="tagsModal.error" class="alert-error">{{ tagsModal.error }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="saveTags" :disabled="tagsModal.saving">Save tags</button>
            <button class="btn sm" @click="tagsModal.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- CloudWatch Logging Modal -->
    <div v-if="loggingModal.open" class="modal-overlay" @click.self="loggingModal.open = false">
      <div class="modal" style="width:500px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Enable CloudWatch Logs — {{ loggingModal.title }}</span>
          <button class="btn sm" @click="loggingModal.open = false">Close</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:12px">
          <div v-if="loggingModal.service === 'lambda'" style="display:flex;flex-direction:column;gap:8px">
            <label style="font-size:12px;color:var(--text-dim)">Log Format</label>
            <div class="btn-toggle-group">
              <button :class="['btn','sm', loggingModal.logFormat === 'Text' ? 'active' : '']"
                @click="loggingModal.logFormat = 'Text'">Text</button>
              <button :class="['btn','sm', loggingModal.logFormat === 'JSON' ? 'active' : '']"
                @click="loggingModal.logFormat = 'JSON'">JSON</button>
            </div>
            <div class="text-dim mono-xs" style="margin-top:2px">
              Log group: /aws/lambda/{{ loggingModal.name }}
            </div>
          </div>
          <div v-if="loggingModal.service === 'ecs'" style="display:flex;flex-direction:column;gap:8px">
            <label style="font-size:12px;color:var(--text-dim)">Log Prefix (container stream prefix)</label>
            <input v-model="loggingModal.logPrefix" class="ctrl-input" style="font-size:12px" />
            <div class="text-dim mono-xs">Log group: /ecs/{{ loggingModal.cluster }}/{{ loggingModal.logPrefix }}</div>
            <div class="alert-error" style="font-size:11px;margin:0">
              This will register a new task definition revision with <strong>awslogs</strong> driver and update the service.
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label style="font-size:12px;color:var(--text-dim)">Log retention (days)</label>
            <select v-model.number="loggingModal.retentionDays" class="ctrl-select" style="font-size:12px">
              <option :value="7">7 days</option>
              <option :value="14">14 days</option>
              <option :value="30">30 days</option>
              <option :value="60">60 days</option>
              <option :value="90">90 days</option>
              <option :value="180">180 days</option>
              <option :value="365">1 year</option>
            </select>
          </div>
          <div v-if="loggingModal.error" class="alert-error">{{ loggingModal.error }}</div>
          <div v-if="loggingModal.result" class="alert-success">
            Logging enabled! Log group: <span class="mono-xs">{{ loggingModal.result.logGroup }}</span>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitLogging" :disabled="loggingModal.loading">
              {{ loggingModal.loading ? 'Enabling...' : 'Enable Logging' }}
            </button>
            <button class="btn sm" @click="loggingModal.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import jsYaml from 'js-yaml'
import { useEnvStore }  from '../../stores/useEnvStore'
import { useAwsStore }  from '../../stores/useAwsStore'
import { useToast }     from '../../composables/useToast'
import { useApi }       from '../../composables/useApi'
import { useSortable }  from '../../composables/useSortable'
import StepFnDiagram       from '../StepFnDiagram.vue'
import EventBridgeDetail   from '../EventBridgeDetail.vue'
import EventBridgeLogs     from '../EventBridgeLogs.vue'
import Ec2Shell            from './Ec2Shell.vue'
import ApiGwIntegrations   from './ApiGwIntegrations.vue'
import S3Browser           from './S3Browser.vue'

const envStore = useEnvStore()
const awsStore = useAwsStore()
const { toast }    = useToast()
const { apiFetch } = useApi()
const { sortBy, sortRows, sortIcon, thClass, resetSort } = useSortable()

const selectedProfileId = ref(awsStore.activeProfileId || '')
const localProfiles     = ref([])

const TABS = [
  { id: 'ec2',         label: 'EC2'            },
  { id: 'ecs',         label: 'ECS'            },
  { id: 'eks',         label: 'EKS'            },
  { id: 'lambda',      label: 'Lambda'         },
  { id: 'apigw',       label: 'API Gateway'    },
  { id: 's3',          label: 'S3'             },
  { id: 'ecr',         label: 'ECR'            },
  { id: 'vpc',         label: 'VPC'            },
  { id: 'eventbridge', label: 'EventBridge'    },
  { id: 'stepfn',      label: 'Step Functions' },
]

const activeTab  = ref('ec2')
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
const filteredApigw       = computed(() => filterRows(awsStore.apiGateways,      search.apigw))
const filteredS3          = computed(() => filterRows(awsStore.s3Buckets,        search.s3))
const filteredEcr         = computed(() => filterRows(awsStore.ecrRepos,         search.ecr))
const filteredVpc         = computed(() => filterRows(awsStore.vpcs,             search.vpc))
const filteredEventBridge = computed(() => filterRows(awsStore.eventBridgeRules, search.eventbridge))
const filteredStepFn      = computed(() => filterRows(awsStore.stepFunctions,    search.stepfn))

const tabFilteredMap = {
  ec2: filteredEc2, ecs: filteredEcs, eks: filteredEks,
  lambda: filteredLambda, apigw: filteredApigw, s3: filteredS3,
  ecr: filteredEcr, vpc: filteredVpc, eventbridge: filteredEventBridge, stepfn: filteredStepFn,
}

const activeRowCount = computed(() => tabFilteredMap[activeTab.value]?.value?.length ?? 0)

function tabCount(id) {
  const map = {
    ec2: awsStore.ec2Instances, ecs: awsStore.ecsServices, eks: awsStore.eksClusters,
    lambda: awsStore.lambdas, apigw: awsStore.apiGateways, s3: awsStore.s3Buckets,
    ecr: awsStore.ecrRepos, vpc: awsStore.vpcs, eventbridge: awsStore.eventBridgeRules,
    stepfn: awsStore.stepFunctions,
  }
  return map[id]?.length ?? 0
}

const fetchMap = {
  ec2:         () => awsStore.fetchEc2Instances(),
  ecs:         () => awsStore.fetchEcsServices(),
  eks:         () => awsStore.fetchEksClusters(),
  lambda:      () => awsStore.fetchLambdas(),
  apigw:       () => awsStore.fetchApiGateways(),
  s3:          () => awsStore.fetchS3Buckets(),
  ecr:         () => awsStore.fetchEcrRepos(),
  vpc:         () => awsStore.fetchVpcs(),
  eventbridge: () => awsStore.fetchEventBridgeRules(),
  stepfn:      () => awsStore.fetchStepFunctions(),
}

async function loadTab(id) {
  if (loaded[id]) return
  tabLoading.value = true
  try {
    await fetchMap[id]?.()
    loaded[id] = true
  } finally {
    tabLoading.value = false
  }
}

async function reloadActiveTab() {
  loaded[activeTab.value] = false
  await loadTab(activeTab.value)
}

function switchTab(id) {
  activeTab.value = id
  resetSort()
  loadTab(id)
}

onMounted(async () => {
  envStore.fetchProfiles()
  try { localProfiles.value = await apiFetch('/api/cloud/aws/local-profiles') } catch { /* ignore */ }
  if (selectedProfileId.value) loadTab(activeTab.value)
})

function onProfileChange() {
  awsStore.setActiveProfile(selectedProfileId.value || null)
  Object.keys(loaded).forEach(k => { loaded[k] = false })
  if (selectedProfileId.value) loadTab(activeTab.value)
}

async function startEc2(i) {
  const r = await awsStore.startEc2Instance(i.id)
  if (r) { toast(`Starting ${i.name}`, 'success'); setTimeout(() => { loaded.ec2 = false; loadTab('ec2') }, 2500) }
  else toast(awsStore.error || 'Error', 'error')
}
async function stopEc2(i) {
  const r = await awsStore.stopEc2Instance(i.id)
  if (r) { toast(`Stopping ${i.name}`, 'success'); setTimeout(() => { loaded.ec2 = false; loadTab('ec2') }, 2500) }
  else toast(awsStore.error || 'Error', 'error')
}

async function startEcs(svc) {
  const r = await awsStore.startEcsService(svc.cluster, svc.name)
  if (r) { toast(`Started ${svc.name}`, 'success'); loaded.ecs = false; loadTab('ecs') }
  else toast(awsStore.error || 'Error', 'error')
}
async function stopEcs(svc) {
  const r = await awsStore.stopEcsService(svc.cluster, svc.name)
  if (r) { toast(`Stopped ${svc.name}`, 'success'); loaded.ecs = false; loadTab('ecs') }
  else toast(awsStore.error || 'Error', 'error')
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
    .then(() => toast('Copied!', 'success'))
    .catch(() => toast('Copy failed', 'error'))
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
    if (data.message && !data.events?.length) logsModal.error = data.message
    logsModal.logGroupName = data.logGroupName ?? null
    logsModal.events       = data.events ?? []
  } catch (e) { logsModal.error = e.message }
  finally     { logsModal.loading = false }
}

const invokeModal = reactive({ open: false, loading: false, name: '', payload: '{}', result: null })

function openInvoke(fn) {
  Object.assign(invokeModal, { name: fn.name, payload: '{}', result: null, open: true })
}

async function submitInvoke() {
  invokeModal.loading = true; invokeModal.result = null
  try {
    let payload = {}
    try { payload = JSON.parse(invokeModal.payload) }
    catch { toast('Invalid JSON payload', 'error'); invokeModal.loading = false; return }
    const data = await awsStore.invokeLambda(invokeModal.name, payload)
    invokeModal.result = data
    if (data?.functionError) toast(`Lambda error: ${data.functionError}`, 'error')
  } finally { invokeModal.loading = false }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}
function formatTs(ts) {  return new Date(ts).toLocaleString(undefined, {
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
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
function lambdaStateClass(s) {
  return s === 'Active' ? 'status-ok' : s === 'Pending' ? 'status-warn' : 'status-err'
}

// ─── EC2 SSH Shell Modal ──────────────────────────────────────────────────────

const ec2ShellModal = reactive({ open: false, instance: null })
function openEc2Shell(instance) {
  Object.assign(ec2ShellModal, { open: true, instance })
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

async function addEksToKubeconfig(cluster) {
  try {
    toast(`Adding ${cluster.name} to ~/.kube/config...`, 'info')
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
      toast('Tags saved', 'success')
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
      toast('CloudWatch logging enabled', 'success')
    } else {
      loggingModal.error = awsStore.error || 'Failed to enable logging'
    }
  } finally { loggingModal.loading = false }
}
</script>

<template>
  <div class="cloud-view">

    <div v-if="!selectedProfileId" class="empty-state">
      Select an AWS credential profile in the top header to load resources.<br />
      <span class="text-dim">No profile? Use the <strong>Env Manager</strong> button (key icon) to create one.</span>
    </div>

    <template v-else>
      <div v-if="awsStore.error" class="alert-error">{{ awsStore.error }}</div>

      <div class="aws-toolbar">
        <input
          v-model="search[activeTab]"
          class="ctrl-input aws-search"
        />
        <span class="text-dim" style="font-size:12px">
          <template v-if="awsStore.loading">Loading...</template>
          <template v-else>{{ activeRowCount }} result{{ activeRowCount !== 1 ? 's' : '' }}</template>
        </span>
        <button class="btn sm" @click="reloadActiveTab" :disabled="tabLoading" title="Refresh"><i data-lucide="refresh-cw"></i></button>
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
                  <button class="btn sm" @click="openEc2Detail(i)">ℹ Info</button>
                  <button class="btn sm" @click="startEc2(i)" :disabled="i.state === 'running'">Start</button>
                  <button class="btn sm danger" @click="stopEc2(i)" :disabled="i.state === 'stopped'">Stop</button>
                  <button class="btn sm" @click="openTags('ec2', `EC2: ${i.name}`, i.id, i.tags)">Tags</button>
                  <button class="btn sm" @click="openConfig('ec2', `EC2: ${i.name}`, i, { id: i.id })">Config</button>
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
                  <button class="btn sm" @click="openLambdaDetail(fn)">ℹ Info</button>
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

      <!-- ══ DynamoDB ══════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'dynamodb'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredDynamo.length" class="empty-row">{{ search.dynamodb ? 'No matches.' : 'No DynamoDB tables found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"      @click="sortBy('name')">Table <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('status')"    @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('billingMode')" @click="sortBy('billingMode')">Billing <span class="sort-icon">{{ sortIcon('billingMode') }}</span></th>
            <th :class="thClass('itemCount')" @click="sortBy('itemCount')">Items <span class="sort-icon">{{ sortIcon('itemCount') }}</span></th>
            <th :class="thClass('sizeBytes')" @click="sortBy('sizeBytes')">Size <span class="sort-icon">{{ sortIcon('sizeBytes') }}</span></th>
            <th :class="thClass('creationDateTime')" @click="sortBy('creationDateTime')">Created <span class="sort-icon">{{ sortIcon('creationDateTime') }}</span></th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="t in sortRows(filteredDynamo)" :key="t.name">
              <td>
                <div>{{ t.name }}</div>
                <div class="text-dim mono-xs">{{ (t.keySchema || []).map(k => `${k.name} (${k.type})`).join(', ') }}</div>
              </td>
              <td><span :class="t.status === 'ACTIVE' ? 'status-ok' : 'status-warn'">{{ t.status }}</span></td>
              <td class="text-dim">{{ t.billingMode }}</td>
              <td>{{ t.itemCount?.toLocaleString() ?? '-' }}</td>
              <td class="text-dim">{{ t.sizeBytes ? formatBytes(t.sizeBytes) : '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ t.creationDateTime ? formatDate(t.creationDateTime) : '-' }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openDynamoBrowse(t)">Browse</button>
                  <button class="btn sm" @click="openConfig('dynamodb', `DynamoDB: ${t.name}`, t, { table: t.name })">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ DocumentDB ════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'docdb'" class="tab-panel">
        <div style="display:flex;justify-content:flex-end;padding:8px 0 6px">
          <button class="btn sm" @click="openDocdbCreate()">+ Nuevo Cluster</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredDocdb.length" class="empty-row">{{ search.docdb ? 'No matches.' : 'No DocumentDB clusters found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('id')"            @click="sortBy('id')">Cluster ID <span class="sort-icon">{{ sortIcon('id') }}</span></th>
            <th :class="thClass('status')"        @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('engineVersion')" @click="sortBy('engineVersion')">Engine <span class="sort-icon">{{ sortIcon('engineVersion') }}</span></th>
            <th :class="thClass('endpoint')"      @click="sortBy('endpoint')">Endpoint <span class="sort-icon">{{ sortIcon('endpoint') }}</span></th>
            <th :class="thClass('port')"          @click="sortBy('port')">Port</th>
            <th>Multi-AZ</th><th>Encrypted</th><th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="c in sortRows(filteredDocdb)" :key="c.id">
              <td>
                <div>{{ c.id }}</div>
                <div class="text-dim mono-xs">Master: {{ c.masterUsername }}</div>
              </td>
              <td><span :class="c.status === 'available' ? 'status-ok' : 'status-warn'">{{ c.status }}</span></td>
              <td class="text-dim">{{ c.engine }} {{ c.engineVersion }}</td>
              <td class="text-dim mono-xs" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="c.endpoint">{{ c.endpoint || '-' }}</td>
              <td class="text-dim">{{ c.port }}</td>
              <td><span :class="c.multiAZ ? 'status-ok' : 'text-dim'">{{ c.multiAZ ? 'Yes' : 'No' }}</span></td>
              <td><span :class="c.storageEncrypted ? 'status-ok' : 'text-dim'">{{ c.storageEncrypted ? 'Yes' : 'No' }}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openDocdbConnect(c)">Connect</button>
                  <button class="btn sm" @click="openDocdbConfig(c)">Config</button>
                  <button class="btn sm" @click="openDocdbResetPwd(c)">Reset Pwd</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Glue ══════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'glue'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredGlue.length" class="empty-row">{{ search.glue ? 'No matches.' : 'No Glue jobs found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"        @click="sortBy('name')">Job Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('command')"     @click="sortBy('command')">Type <span class="sort-icon">{{ sortIcon('command') }}</span></th>
            <th :class="thClass('glueVersion')" @click="sortBy('glueVersion')">Glue Ver <span class="sort-icon">{{ sortIcon('glueVersion') }}</span></th>
            <th :class="thClass('workerType')"  @click="sortBy('workerType')">Worker <span class="sort-icon">{{ sortIcon('workerType') }}</span></th>
            <th :class="thClass('numWorkers')"  @click="sortBy('numWorkers')">Workers</th>
            <th :class="thClass('lastModified')" @click="sortBy('lastModified')">Modified <span class="sort-icon">{{ sortIcon('lastModified') }}</span></th>
            <th>Actions</th>
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
                  <button class="btn sm" @click="runGlueJob(j)">Run</button>
                  <button class="btn sm" @click="openGlueRuns(j)">Runs</button>
                  <button class="btn sm" @click="openGlueJobConfig(j)">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Athena ═════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'athena'" class="tab-panel">
        <div style="display:flex;gap:8px;align-items:flex-start;height:100%;overflow:hidden">
          <!-- Workgroups list -->
          <div style="flex:1;overflow:auto">
            <div v-if="awsStore.loading" class="empty-row">Loading...</div>
            <div v-else-if="!filteredAthena.length" class="empty-row">{{ search.athena ? 'No matches.' : 'No Athena workgroups found.' }}</div>
            <table v-else class="cloud-table">
              <thead><tr>
                <th :class="thClass('name')"        @click="sortBy('name')">Workgroup <span class="sort-icon">{{ sortIcon('name') }}</span></th>
                <th :class="thClass('state')"       @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
                <th :class="thClass('queriesRun')"  @click="sortBy('queriesRun')">Queries <span class="sort-icon">{{ sortIcon('queriesRun') }}</span></th>
                <th :class="thClass('bytesScanned')" @click="sortBy('bytesScanned')">Scanned</th>
                <th>Output Location</th>
                <th>Actions</th>
              </tr></thead>
              <tbody>
                <tr v-for="wg in sortRows(filteredAthena)" :key="wg.name">
                  <td>
                    <div>{{ wg.name }}</div>
                    <div v-if="wg.description" class="text-dim" style="font-size:11px">{{ wg.description }}</div>
                  </td>
                  <td><span :class="wg.state === 'ENABLED' ? 'status-ok' : 'status-err'">{{ wg.state }}</span></td>
                  <td class="text-dim">{{ wg.queriesRun?.toLocaleString() ?? '-' }}</td>
                  <td class="text-dim">{{ wg.bytesScanned ? formatBytes(wg.bytesScanned) : '-' }}</td>
                  <td class="text-dim mono-xs" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="wg.outputLocation">{{ wg.outputLocation || '-' }}</td>
                  <td>
                    <div class="row-actions">
                      <button class="btn sm" @click="openAthenaQuery(wg)">Query</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ══ Data Pipeline ══════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'datapipeline'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredPipelines.length" class="empty-row">{{ search.datapipeline ? 'No matches.' : 'No Data Pipelines found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"          @click="sortBy('name')">Pipeline <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('state')"         @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
            <th :class="thClass('latestRunTime')" @click="sortBy('latestRunTime')">Last Run <span class="sort-icon">{{ sortIcon('latestRunTime') }}</span></th>
            <th :class="thClass('nextRunTime')"   @click="sortBy('nextRunTime')">Next Run <span class="sort-icon">{{ sortIcon('nextRunTime') }}</span></th>
            <th>Actions</th>
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
                  <button class="btn sm" @click="activatePipeline(p)" :disabled="p.state === 'SCHEDULED'">Activate</button>
                  <button class="btn sm danger" @click="deactivatePipeline(p)" :disabled="p.state === 'PAUSED'">Pause</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ CloudFront ═════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'cloudfront'" class="tab-panel">
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
          <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="cfCreateModal.open = true; cfCreateModal.result = null; cfCreateModal.error = null">+ Create from S3</button>
        </div>
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredCloudfront.length" class="empty-row">{{ search.cloudfront ? 'No matches.' : 'No CloudFront distributions found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('domainName')" @click="sortBy('domainName')">Domain <span class="sort-icon">{{ sortIcon('domainName') }}</span></th>
            <th :class="thClass('status')"     @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('enabled')"    @click="sortBy('enabled')">Enabled</th>
            <th :class="thClass('priceClass')" @click="sortBy('priceClass')">Price Class <span class="sort-icon">{{ sortIcon('priceClass') }}</span></th>
            <th>Aliases</th>
            <th>Origins</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="d in sortRows(filteredCloudfront)" :key="d.id">
              <td>
                <div class="mono-xs">{{ d.domainName }}</div>
                <div v-if="d.comment" class="text-dim" style="font-size:11px">{{ d.comment }}</div>
              </td>
              <td><span :class="d.status === 'Deployed' ? 'status-ok' : 'status-warn'">{{ d.status }}</span></td>
              <td><span :class="d.enabled ? 'status-ok' : 'status-err'">{{ d.enabled ? 'Yes' : 'No' }}</span></td>
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
                  <button class="btn sm" @click="openInvalidateModal(d)">Invalidate</button>
                  <button class="btn sm" @click="openConfig('cloudfront', `CF: ${d.domainName}`, d, { id: d.id })">Config</button>
                  <button class="btn sm" style="background:rgba(99,102,241,0.2);border-color:#6366f1" @click="openCfStats(d)">Stats</button>
                  <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="window.open('https://' + (d.aliases?.[0] || d.domainName), '_blank')" title="Open site">Visit Site</button>
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
            <div v-if="awsStore.loading" class="empty-row">Loading...</div>
            <div v-else-if="!filteredRoute53.length" class="empty-row">No zones.</div>
            <div v-for="z in filteredRoute53" :key="z.id"
              :class="['sidebar-item', { active: route53State.selectedZoneId === z.id }]"
              style="cursor:pointer;padding:6px 12px"
              @click="loadRoute53Records(z)">
              <div>{{ z.name }}</div>
              <div class="text-dim mono-xs">{{ z.recordCount }} records · {{ z.private ? 'Private' : 'Public' }}</div>
            </div>
          </div>
          <!-- Records -->
          <div style="flex:1;overflow:auto">
            <div v-if="route53State.loadingRecords" class="empty-row">Loading records...</div>
            <div v-else-if="!route53State.selectedZoneId" class="empty-row">Select a zone to view its records.</div>
            <div v-else-if="!route53State.records.length" class="empty-row">No records in this zone.</div>
            <table v-else class="cloud-table">
              <thead><tr>
                <th>Name</th><th>Type</th><th>TTL</th><th>Value / Alias</th>
              </tr></thead>
              <tbody>
                <tr v-for="(r, idx) in route53State.records" :key="idx">
                  <td class="mono-xs">{{ r.name }}</td>
                  <td><span class="tag-chip">{{ r.type }}</span></td>
                  <td class="text-dim">{{ r.ttl ?? '-' }}</td>
                  <td class="text-dim mono-xs" style="word-break:break-all">
                    <span v-if="r.alias">{{ r.alias.dnsName }}</span>
                    <span v-else>{{ (r.records || []).join(', ') }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
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
            <div v-if="awsStore.loading" class="empty-row">Loading...</div>
            <div v-else-if="!filteredCognito.length" class="empty-row">No user pools.</div>
            <div v-for="p in filteredCognito" :key="p.id"
              :class="['sidebar-item', { active: cognitoState.selectedPool?.id === p.id }]"
              style="cursor:pointer;padding:8px 12px"
              @click="loadCognitoPool(p)">
              <div style="font-weight:500">{{ p.name }}</div>
              <div class="text-dim mono-xs">{{ p.userCount?.toLocaleString() ?? '?' }} users · MFA: {{ p.mfaConfig }}</div>
              <div class="text-dim mono-xs" style="font-size:10px">{{ p.id }}</div>
            </div>
          </div>
          <!-- Right panel: tabbed detail for selected pool -->
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div v-if="!cognitoState.selectedPool" class="empty-row" style="align-self:center;margin-top:60px">Select a user pool</div>
            <template v-else>
              <!-- Inner tab bar -->
              <div style="display:flex;gap:0;border-bottom:1px solid var(--border);padding:0 12px;flex-shrink:0;align-items:center">
                <button v-for="t in cognitoInnerTabs" :key="t.id"
                  :class="['aws-tab-btn', { active: cognitoState.innerTab === t.id }]"
                  style="margin-right:4px"
                  @click="cognitoState.innerTab = t.id">{{ t.label }}</button>
                <div style="flex:1"/>
                <button class="btn sm" style="margin:4px 0" @click="openCreateCognitoUser">+ Create User</button>
              </div>
              <!-- ── Users tab ─────────────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'users'" style="flex:1;overflow:auto;padding:8px">
                <!-- Search + filter bar -->
                <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
                  <input class="search-input" v-model="cognitoState.userFilter"
                    placeholder="Filter by email / username…" style="flex:1"
                    @keydown.enter="applyUserFilter" />
                  <button class="btn sm" @click="applyUserFilter">Search</button>
                  <button class="btn sm" v-if="cognitoState.userFilter" @click="clearUserFilter">Clear</button>
                </div>
                <div v-if="cognitoState.loadingUsers" class="empty-row">Loading users...</div>
                <div v-else-if="!cognitoState.users.length" class="empty-row">No users found.</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>Username</th><th>Email</th><th>Status</th><th>MFA</th><th>Enabled</th><th>Created</th><th>Actions</th>
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
                      <td><span :class="u.enabled ? 'status-ok' : 'status-err'">{{ u.enabled ? 'Yes' : 'No' }}</span></td>
                      <td class="text-dim" style="white-space:nowrap">{{ u.created ? formatDate(u.created) : '-' }}</td>
                      <td>
                        <div class="row-actions">
                          <button class="btn sm" @click="openUserDetail(u)" title="View">Detail</button>
                          <button class="btn sm" @click="doCognitoResetPassword(u)" title="Send reset email">Reset pwd</button>
                          <button class="btn sm" v-if="u.enabled" @click="doCognitoDisable(u)">Disable</button>
                          <button class="btn sm" v-else @click="doCognitoEnable(u)">Enable</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <!-- Pagination -->
                <div v-if="cognitoState.paginationToken || cognitoState.prevTokens?.length" style="display:flex;gap:8px;margin-top:8px;justify-content:center">
                  <button class="btn sm" :disabled="!cognitoState.prevTokens?.length" @click="cognitoPrevPage">‹ Prev</button>
                  <span class="text-dim" style="line-height:28px;font-size:12px">Page {{ (cognitoState.prevTokens?.length || 0) + 1 }}</span>
                  <button class="btn sm" :disabled="!cognitoState.paginationToken" @click="cognitoNextPage">Next ›</button>
                </div>
              </div>
              <!-- ── App Clients tab ───────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'clients'" style="flex:1;overflow:auto;padding:8px">
                <div v-if="cognitoState.loadingClients" class="empty-row">Loading clients...</div>
                <div v-else-if="!cognitoState.clients.length" class="empty-row">No app clients.</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>Client Name</th><th>Client ID</th><th>Auth Flows</th><th>OAuth Flows</th><th>Callback URLs</th><th>Token Validity</th><th>Secret</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="c in cognitoState.clients" :key="c.clientId">
                      <td style="font-weight:500">{{ c.clientName }}</td>
                      <td class="mono-xs text-dim">{{ c.clientId }}</td>
                      <td class="text-dim" style="font-size:11px">{{ (c.explicitAuthFlows || []).join(', ') || '-' }}</td>
                      <td class="text-dim" style="font-size:11px">{{ (c.allowedOAuthFlows || []).join(', ') || '-' }}</td>
                      <td class="text-dim" style="font-size:11px;max-width:200px;word-break:break-all">{{ (c.callbackURLs || []).join(', ') || '-' }}</td>
                      <td class="text-dim" style="font-size:11px">
                        <div v-if="c.accessTokenValidity">Access: {{ c.accessTokenValidity }}h</div>
                        <div v-if="c.refreshTokenValidity">Refresh: {{ c.refreshTokenValidity }}d</div>
                      </td>
                      <td><span :class="c.hasSecret ? 'status-warn' : 'text-dim'">{{ c.hasSecret ? 'Yes' : 'No' }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- ── Identity Providers tab ───────────────────── -->
              <div v-show="cognitoState.innerTab === 'idps'" style="flex:1;overflow:auto;padding:8px">
                <div v-if="cognitoState.loadingIdps" class="empty-row">Loading identity providers...</div>
                <div v-else-if="!cognitoState.idps.length" class="empty-row">No federated identity providers configured.</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>Provider Name</th><th>Type</th><th>Issuer / Metadata</th><th>Attribute Mapping</th><th>Last Modified</th>
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
              <!-- ── Pool Config tab ─────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'config'" style="flex:1;overflow:auto;padding:12px">
                <div v-if="cognitoState.loadingConfig" class="empty-row">Loading configuration...</div>
                <div v-else-if="!cognitoState.poolConfig" class="empty-row">No configuration loaded.</div>
                <div v-else style="display:flex;flex-direction:column;gap:14px">

                  <!-- Header badges -->
                  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                    <span style="font-size:13px;font-weight:600">{{ cognitoState.poolConfig.Name }}</span>
                    <span class="mono-xs text-dim" style="font-size:10px">{{ cognitoState.poolConfig.Id }}</span>
                    <span :class="cognitoState.poolConfig.Status === 'Active' ? 'status-ok' : 'status-warn'" style="font-size:11px">{{ cognitoState.poolConfig.Status }}</span>
                    <span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);color:var(--text-dim)">MFA: {{ cognitoState.poolConfig.MfaConfiguration }}</span>
                    <span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);color:var(--text-dim)">{{ cognitoState.poolConfig.EstimatedNumberOfUsers?.toLocaleString() }} users</span>
                    <span v-if="cognitoState.poolConfig.Domain" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(124,158,248,.12);color:var(--accent)">domain: {{ cognitoState.poolConfig.Domain }}</span>
                  </div>

                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                    <!-- Password Policy -->
                    <div class="config-section">
                      <div class="config-title">Política de Contraseñas</div>
                      <template v-if="cognitoState.poolConfig.Policies?.PasswordPolicy">
                        <div class="config-row">
                          <span>Longitud mínima</span>
                          <span style="font-weight:600">{{ cognitoState.poolConfig.Policies.PasswordPolicy.MinimumLength }}</span>
                        </div>
                        <div class="config-row">
                          <span>Requisitos</span>
                          <div style="display:flex;gap:4px;flex-wrap:wrap">
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireUppercase" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">A-Z</span>
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireLowercase" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">a-z</span>
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireNumbers" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">0-9</span>
                            <span v-if="cognitoState.poolConfig.Policies.PasswordPolicy.RequireSymbols" style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">!@#</span>
                          </div>
                        </div>
                        <div class="config-row"><span>Temp. pwd válida (días)</span><span>{{ cognitoState.poolConfig.Policies.PasswordPolicy.TemporaryPasswordValidityDays }}</span></div>
                      </template>
                    </div>

                    <!-- Auto-verified + Dates -->
                    <div class="config-section">
                      <div class="config-title">Verificación &amp; Fechas</div>
                      <div class="config-row"><span>Atributos verificados</span><span class="text-dim">{{ (cognitoState.poolConfig.AutoVerifiedAttributes || []).join(', ') || 'none' }}</span></div>
                      <div class="config-row"><span>Alias permitidos</span><span class="text-dim">{{ (cognitoState.poolConfig.AliasAttributes || []).join(', ') || '-' }}</span></div>
                      <div class="config-row"><span>Creado</span><span class="text-dim">{{ cognitoState.poolConfig.CreationDate ? formatDate(cognitoState.poolConfig.CreationDate) : '-' }}</span></div>
                      <div class="config-row"><span>Modificado</span><span class="text-dim">{{ cognitoState.poolConfig.LastModifiedDate ? formatDate(cognitoState.poolConfig.LastModifiedDate) : '-' }}</span></div>
                    </div>
                  </div>

                  <!-- Schema Attributes -->
                  <div class="config-section">
                    <div class="config-title">Schema Attributes ({{ (cognitoState.poolConfig.SchemaAttributes || []).length }})</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;margin-top:4px">
                      <div v-for="attr in (cognitoState.poolConfig.SchemaAttributes || [])" :key="attr.Name"
                        style="border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:11px">
                        <div style="font-weight:600;margin-bottom:2px">{{ attr.Name }}</div>
                        <div class="text-dim" style="font-size:10px">{{ attr.AttributeDataType }}{{ attr.Required ? ' · required' : '' }}{{ attr.Mutable === false ? ' · immutable' : '' }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Lambda Triggers -->
                  <div class="config-section">
                    <div class="config-title">Lambda Triggers</div>
                    <div v-if="!cognitoState.poolConfig.LambdaConfig || !Object.keys(cognitoState.poolConfig.LambdaConfig).length" class="text-dim" style="padding:4px 0;font-size:12px">No hay triggers configurados.</div>
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
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredSecrets.length" class="empty-row">{{ search.secrets ? 'No matches.' : 'No secrets found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"            @click="sortBy('name')">Secret Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('rotationEnabled')" @click="sortBy('rotationEnabled')">Rotation</th>
            <th :class="thClass('lastChanged')"     @click="sortBy('lastChanged')">Last Changed <span class="sort-icon">{{ sortIcon('lastChanged') }}</span></th>
            <th>ARN</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="s in sortRows(filteredSecrets)" :key="s.arn">
              <td>
                <div style="font-weight:500">{{ s.name.split('/').pop() }}</div>
                <div v-if="s.name.includes('/')" class="text-dim mono-xs" style="font-size:10px">{{ s.name }}</div>
                <div v-if="s.description" class="text-dim" style="font-size:11px;margin-top:1px">{{ s.description }}</div>
              </td>
              <td><span :class="s.rotationEnabled ? 'status-ok' : 'text-dim'">{{ s.rotationEnabled ? 'Enabled' : 'Off' }}</span></td>
              <td class="text-dim" style="white-space:nowrap">{{ s.lastChanged ? formatDate(s.lastChanged) : '-' }}</td>
              <td class="mono-xs text-dim" style="font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="s.arn">{{ s.arn }}</td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" @click="openSecretConfig(s)">Config</button>
                  <button class="btn sm" @click="openSecretIntegration(s)">Integrar</button>
                  <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e"
                    @click="openImportSecret(s)">Import to Env</button>
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
    <Ec2Shell    :open="ec2ShellModal.open" :instance="ec2ShellModal.instance" @close="ec2ShellModal.open = false" />
    <Ec2Rdp    :open="ec2RdpModal.open"   :instance="ec2RdpModal.instance"   @close="ec2RdpModal.open = false" />
    <Ec2Detail    :open="ec2DetailModal.open" :instance="ec2DetailModal.instance" :profile-id="selectedProfileId" @close="ec2DetailModal.open = false" />
    <LambdaDetail :open="lambdaDetailModal.open" :fn="lambdaDetailModal.fn" :profile-id="selectedProfileId" @close="lambdaDetailModal.open = false" />

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

    <!-- Glue Job Runs Modal -->
    <div v-if="glueRunsModal.open" class="modal-overlay" @click.self="glueRunsModal.open = false">
      <div class="modal" style="width:720px;max-width:96vw;max-height:82vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Recent Runs — {{ glueRunsModal.job?.name }}</span>
          <button class="btn sm" @click="glueRunsModal.open = false">Close</button>
        </div>
        <div v-if="glueRunsModal.loading" class="empty-row">Loading...</div>
        <div v-else-if="!glueRunsModal.runs.length" class="empty-row">No recent runs found.</div>
        <table v-else class="cloud-table" style="overflow:auto;flex:1">
          <thead><tr><th>Run ID</th><th>Status</th><th>Started</th><th>Completed</th><th>Duration (s)</th><th>Error</th></tr></thead>
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

    <!-- Athena Query Modal -->
    <div v-if="athenaModal.open" class="modal-overlay" @click.self="athenaModal.open = false">
      <div class="modal" style="width:800px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Athena Query — {{ athenaModal.workgroup?.name }}</span>
          <button class="btn sm" @click="athenaModal.open = false">Close</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px;flex:1;min-height:0">
          <textarea v-model="athenaModal.query" rows="5" class="ctrl-input"
            style="font-family:monospace;font-size:12px;resize:vertical"
            placeholder="SELECT * FROM my_table LIMIT 10;" />
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn" @click="submitAthenaQuery" :disabled="athenaModal.loading || !athenaModal.query.trim()">
              {{ athenaModal.loading ? 'Running...' : 'Run Query' }}
            </button>
            <span v-if="athenaModal.status" :class="athenaModal.status === 'SUCCEEDED' ? 'status-ok' : athenaModal.status === 'FAILED' ? 'status-err' : 'status-warn'">
              {{ athenaModal.status }}
            </span>
            <span v-if="athenaModal.queryId" class="text-dim mono-xs">ID: {{ athenaModal.queryId }}</span>
          </div>
          <div v-if="athenaModal.error" class="alert-error">{{ athenaModal.error }}</div>
          <div v-if="athenaModal.results" style="overflow:auto;flex:1">
            <table class="cloud-table">
              <thead v-if="athenaModal.results.ResultSetMetadata?.ColumnInfo">
                <tr>
                  <th v-for="col in athenaModal.results.ResultSetMetadata.ColumnInfo" :key="col.Name">{{ col.Name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in (athenaModal.results.Rows || []).slice(1)" :key="ri">
                  <td v-for="(cell, ci) in (row.Data || [])" :key="ci" class="text-dim" style="font-size:12px">{{ cell.VarCharValue ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- CloudFront Invalidation Modal -->
    <div v-if="invalidateModal.open" class="modal-overlay" @click.self="invalidateModal.open = false">
      <div class="modal" style="width:500px;max-width:96vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Create Invalidation — {{ invalidateModal.dist?.domainName }}</span>
          <button class="btn sm" @click="invalidateModal.open = false">Close</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <label style="font-size:12px;color:var(--text-dim)">Paths to invalidate (one per line)</label>
          <textarea v-model="invalidateModal.paths" rows="4" class="ctrl-input"
            style="font-family:monospace;font-size:12px" placeholder="/*" />
          <div v-if="invalidateModal.error" class="alert-error">{{ invalidateModal.error }}</div>
          <div v-if="invalidateModal.result" class="alert-success">{{ invalidateModal.result }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitInvalidation" :disabled="invalidateModal.loading">
              {{ invalidateModal.loading ? 'Creating...' : 'Invalidate' }}
            </button>
            <button class="btn sm" @click="invalidateModal.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- CloudFront Stats Modal -->
    <div v-if="cfStatsModal.open" class="modal-overlay" @click.self="cfStatsModal.open = false">
      <div class="modal" style="width:min(740px,96vw);max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;flex:1">CloudFront Stats — {{ cfStatsModal.domainName }}</span>
          <button class="btn sm" @click="cfStatsModal.open = false">Close</button>
        </div>
        <div style="flex:1;min-height:0;overflow-y:auto;padding:14px">
          <div v-if="cfStatsModal.loading" class="empty-row">Loading stats from CloudWatch...</div>
          <div v-else-if="cfStatsModal.error" class="alert-error">{{ cfStatsModal.error }}</div>
          <div v-else-if="cfStatsModal.data" style="display:flex;flex-direction:column;gap:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">Requests (last 7 days)</div>
                <div v-if="!cfStatsModal.data.requests.length" class="text-dim" style="font-size:12px;padding:8px">No data</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>Date</th><th>Requests</th></tr></thead>
                  <tbody>
                    <tr v-for="pt in cfStatsModal.data.requests" :key="pt.date">
                      <td class="text-dim mono-xs">{{ formatDate(pt.date) }}</td>
                      <td>{{ pt.value?.toLocaleString() }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="config-section">
                <div class="config-title">Bytes Downloaded (last 7 days)</div>
                <div v-if="!cfStatsModal.data.bytesDownloaded.length" class="text-dim" style="font-size:12px;padding:8px">No data</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>Date</th><th>Bytes</th></tr></thead>
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
                <div class="config-title">4xx Error Rate (%)</div>
                <div v-if="!cfStatsModal.data.errorRate4xx.length" class="text-dim" style="font-size:12px;padding:8px">No data</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>Date</th><th>Rate</th></tr></thead>
                  <tbody>
                    <tr v-for="pt in cfStatsModal.data.errorRate4xx" :key="pt.date">
                      <td class="text-dim mono-xs">{{ formatDate(pt.date) }}</td>
                      <td :style="pt.value > 5 ? 'color:#f87171' : ''">{{ pt.value?.toFixed(2) }}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="config-section">
                <div class="config-title">5xx Error Rate (%)</div>
                <div v-if="!cfStatsModal.data.errorRate5xx.length" class="text-dim" style="font-size:12px;padding:8px">No data</div>
                <table v-else class="cloud-table">
                  <thead><tr><th>Date</th><th>Rate</th></tr></thead>
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
          <div v-else class="text-dim" style="padding:16px">No stats available.</div>
        </div>
      </div>
    </div>

    <!-- CloudFront Create from S3 Modal -->
    <div v-if="cfCreateModal.open" class="modal-overlay" @click.self="cfCreateModal.open = false">
      <div class="modal" style="width:540px;max-width:96vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Create CloudFront Distribution from S3</span>
          <button class="btn sm" @click="cfCreateModal.open = false">Close</button>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">S3 Bucket</label>
            <select v-model="cfCreateModal.bucketName" class="ctrl-select" style="width:100%">
              <option value="">— select bucket —</option>
              <option v-for="b in awsStore.s3Buckets" :key="b.name" :value="b.name">{{ b.name }} ({{ b.region }})</option>
            </select>
          </div>
          <div v-if="cfCreateModal.bucketName">
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Bucket Region</label>
            <input v-model="cfCreateModal.region" class="ctrl-input" style="width:100%" placeholder="us-east-1" />
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Comment (optional)</label>
            <input v-model="cfCreateModal.comment" class="ctrl-input" style="width:100%" placeholder="My distribution" />
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Price Class</label>
            <select v-model="cfCreateModal.priceClass" class="ctrl-select" style="width:100%">
              <option value="PriceClass_100">PriceClass_100 (US, CA, EU)</option>
              <option value="PriceClass_200">PriceClass_200 (+ Asia, Africa, ME)</option>
              <option value="PriceClass_All">PriceClass_All (All edge locations)</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Custom Aliases (one per line, optional)</label>
            <textarea v-model="cfCreateModal.aliases" rows="3" class="ctrl-input"
              style="font-family:monospace;font-size:12px;width:100%" placeholder="www.example.com" />
          </div>
          <div v-if="cfCreateModal.error" class="alert-error">{{ cfCreateModal.error }}</div>
          <div v-if="cfCreateModal.result" class="alert-success">
            Created! Domain: <span class="mono-xs">{{ cfCreateModal.result.domainName }}</span>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" @click="submitCfCreate" :disabled="cfCreateModal.loading || !cfCreateModal.bucketName">
              {{ cfCreateModal.loading ? 'Creating...' : 'Create Distribution' }}
            </button>
            <button class="btn sm" @click="cfCreateModal.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Secret Config Modal ═══════════════════════════════════════════════ -->
    <div v-if="secretConfigModal.open" class="modal-overlay" @click.self="secretConfigModal.open = false">
      <div class="modal-box" style="width:640px;max-width:98vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:14px">{{ secretConfigModal.secret?.name?.split('/').pop() }}</div>
            <div class="text-dim mono-xs" style="font-size:10px">{{ secretConfigModal.secret?.name }}</div>
          </div>
          <button class="btn sm" @click="secretConfigModal.open = false">Cerrar</button>
        </div>
        <div v-if="secretConfigModal.loading" class="empty-row">Loading...</div>
        <div v-else-if="secretConfigModal.error" class="alert-error">{{ secretConfigModal.error }}</div>
        <div v-else-if="secretConfigModal.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="config-section">
              <div class="config-title">General</div>
              <div class="config-row"><span>Rotation</span>
                <span :class="secretConfigModal.data.rotationEnabled ? 'status-ok' : 'text-dim'">{{ secretConfigModal.data.rotationEnabled ? 'Habilitada' : 'Off' }}</span>
              </div>
              <div class="config-row"><span>KMS Key</span><span class="mono-xs text-dim" style="font-size:10px;word-break:break-all">{{ secretConfigModal.data.kmsKeyId || 'Default (aws/secretsmanager)' }}</span></div>
              <div class="config-row"><span>Última rotación</span><span class="text-dim">{{ secretConfigModal.data.lastRotatedDate ? formatDate(secretConfigModal.data.lastRotatedDate) : '-' }}</span></div>
              <div class="config-row"><span>Último cambio</span><span class="text-dim">{{ secretConfigModal.data.lastChangedDate ? formatDate(secretConfigModal.data.lastChangedDate) : '-' }}</span></div>
            </div>
            <div class="config-section">
              <div class="config-title">Versiones ({{ (secretConfigModal.data.versionIds || []).length }})</div>
              <div v-for="v in (secretConfigModal.data.versionIds || []).slice(0, 8)" :key="v"
                class="mono-xs text-dim" style="font-size:10px;padding:2px 0;border-bottom:1px solid var(--border)">{{ v }}</div>
            </div>
          </div>
          <div v-if="secretConfigModal.data.rotationLambdaArn" class="config-section">
            <div class="config-title">Lambda de Rotación</div>
            <div class="config-row"><span>ARN</span><span class="mono-xs text-dim" style="font-size:10px;word-break:break-all">{{ secretConfigModal.data.rotationLambdaArn }}</span></div>
          </div>
          <div v-if="secretConfigModal.data.tags?.length" class="config-section">
            <div class="config-title">Tags ({{ secretConfigModal.data.tags.length }})</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
              <span v-for="t in secretConfigModal.data.tags" :key="t.Key"
                style="font-size:10px;padding:1px 8px;border-radius:4px;background:var(--bg-row);border:1px solid var(--border)">
                {{ t.Key }}: <span style="color:var(--accent)">{{ t.Value }}</span>
              </span>
            </div>
          </div>
          <div class="config-section">
            <div class="config-title">ARN completo</div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
              <span class="mono-xs text-dim" style="font-size:10px;word-break:break-all;flex:1">{{ secretConfigModal.data.arn }}</span>
              <button class="btn sm" @click="copyText(secretConfigModal.data.arn)">Copy</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Secret Integration Examples Modal ═════════════════════════════════ -->
    <div v-if="secretIntegrationModal.open" class="modal-overlay" @click.self="secretIntegrationModal.open = false">
      <div class="modal-box" style="width:780px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:14px">Ejemplos de Integración</div>
            <div class="text-dim" style="font-size:11px">{{ secretIntegrationModal.secret?.name }}</div>
          </div>
          <button class="btn sm" @click="secretIntegrationModal.open = false">Cerrar</button>
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
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">Recuperar el secreto en Python:</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.boto3 }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.boto3)">Copy</button>
            </div>
          </template>

          <!-- Node.js -->
          <template v-if="secretIntegrationModal.tab === 'nodejs'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">AWS SDK v3 para Node.js:</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.nodejs }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.nodejs)">Copy</button>
            </div>
          </template>

          <!-- CLI -->
          <template v-if="secretIntegrationModal.tab === 'cli'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">AWS CLI:</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.cli }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.cli)">Copy</button>
            </div>
          </template>

          <!-- .env / Docker -->
          <template v-if="secretIntegrationModal.tab === 'env'">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:-6px">Inyectar como variables de entorno (Docker / ECS task definition):</div>
            <div style="position:relative">
              <pre class="code-block" style="font-size:11px">{{ secretIntegrationModal.examples.env }}</pre>
              <button class="btn sm" style="position:absolute;top:6px;right:6px" @click="copyText(secretIntegrationModal.examples.env)">Copy</button>
            </div>
          </template>

          <!-- Nota de IAM -->
          <div style="border-left:3px solid var(--accent);padding:8px 12px;background:rgba(124,158,248,.07);border-radius:0 4px 4px 0;font-size:11px;color:var(--text-dim)">
            <div style="font-weight:600;margin-bottom:4px;color:var(--text)">Permisos IAM necesarios</div>
            <div>La entidad que acceda debe tener: <code style="color:var(--accent)">secretsmanager:GetSecretValue</code> sobre el ARN del secreto.</div>
            <div style="margin-top:4px;font-size:10px;word-break:break-all">ARN: {{ secretIntegrationModal.secret?.arn }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Import Secret to Env Manager Modal (con selección de variables) ══ -->
    <div v-if="importSecretModal.open" class="modal-overlay" @click.self="importSecretModal.open = false">
      <div class="modal-box" style="width:600px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:13px">Import to Env Manager</div>
            <div class="text-dim" style="font-size:11px">{{ importSecretModal.secret?.name }}</div>
          </div>
          <button class="btn sm" @click="importSecretModal.open = false">Cerrar</button>
        </div>
        <div style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px">

          <!-- Step 1: destino -->
          <div class="config-section" style="margin:0">
            <div class="config-title">Destino en Env Manager</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <button :class="['btn','sm', importSecretModal.mode === 'new' ? 'active' : '']" @click="importSecretModal.mode = 'new'">Nuevo perfil</button>
              <button :class="['btn','sm', importSecretModal.mode === 'existing' ? 'active' : '']" @click="importSecretModal.mode = 'existing'">Perfil existente</button>
            </div>
            <div v-if="importSecretModal.mode === 'new'">
              <label class="field-label">Nombre del perfil
                <input v-model="importSecretModal.profileName" class="ctrl-input" placeholder="Mi perfil" />
              </label>
            </div>
            <div v-else>
              <label class="field-label">Perfil destino
                <select v-model="importSecretModal.targetProfileId" class="ctrl-input ctrl-select">
                  <option value="">-- seleccionar perfil --</option>
                  <option v-for="p in envProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
            </div>
          </div>

          <!-- Step 2: selección de variables -->
          <div class="config-section" style="margin:0">
            <div class="config-title" style="display:flex;align-items:center;justify-content:space-between">
              <span>Variables del secreto</span>
              <div style="display:flex;gap:4px">
                <button class="btn sm" @click="importSecretModal.selectedKeys = [...(importSecretModal.previewKeys || [])]" style="font-size:10px">Seleccionar todas</button>
                <button class="btn sm" @click="importSecretModal.selectedKeys = []" style="font-size:10px">Ninguna</button>
              </div>
            </div>
            <div v-if="importSecretModal.loadingKeys" class="empty-row" style="border:none;border-radius:0">Cargando variables...</div>
            <div v-else-if="importSecretModal.keysError" class="alert-error" style="margin-top:6px">{{ importSecretModal.keysError }}</div>
            <div v-else-if="!(importSecretModal.previewKeys || []).length" class="text-dim" style="font-size:12px;padding:6px 0">No se encontraron variables en este secreto.</div>
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
            <button class="btn sm" @click="importSecretModal.open = false">Cancelar</button>
            <button class="btn sm"
              :disabled="importSecretModal.loading || !importSecretModal.selectedKeys.length"
              @click="() => submitImportSecret()">
              {{ importSecretModal.loading ? 'Importando...' : `Importar ${importSecretModal.selectedKeys.length} variable(s)` }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ DynamoDB Browse Modal ══════════════════════════════════════════════ -->
    <div v-if="dynamoBrowse.open" class="modal-overlay" @click.self="dynamoBrowse.open = false">
      <div class="modal-box" style="width:900px;max-width:98vw;height:80vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600">Browse: {{ dynamoBrowse.table }}</span>
          <button class="btn sm" @click="dynamoBrowse.open = false">Close</button>
        </div>
        <!-- Query builder -->
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:2px">
            <label style="font-size:11px;color:var(--text-muted)">Mode</label>
            <select v-model="dynamoBrowse.mode" class="ctrl-select">
              <option value="scan">Scan</option>
              <option value="query">Query</option>
            </select>
          </div>
          <template v-if="dynamoBrowse.mode === 'query'">
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">Partition Key name</label>
              <input v-model="dynamoBrowse.keyName" class="ctrl-input" placeholder="e.g. userId" style="width:140px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">Value</label>
              <input v-model="dynamoBrowse.keyValue" class="ctrl-input" placeholder="key value" style="width:160px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">Type</label>
              <select v-model="dynamoBrowse.keyType" class="ctrl-select">
                <option value="S">String</option>
                <option value="N">Number</option>
                <option value="B">Binary</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <label style="font-size:11px;color:var(--text-muted)">Index (optional)</label>
              <input v-model="dynamoBrowse.indexName" class="ctrl-input" placeholder="GSI name" style="width:120px" />
            </div>
          </template>
          <div style="display:flex;flex-direction:column;gap:2px">
            <label style="font-size:11px;color:var(--text-muted)">Limit</label>
            <input v-model.number="dynamoBrowse.limit" type="number" min="1" max="200" class="ctrl-input" style="width:70px" />
          </div>
          <button class="btn" @click="() => executeDynamoBrowse()" :disabled="dynamoBrowse.loading">
            {{ dynamoBrowse.loading ? 'Loading...' : 'Execute' }}
          </button>
        </div>
        <!-- Results -->
        <div style="flex:1;overflow:auto;padding:8px">
          <div v-if="dynamoBrowse.loading" class="empty-row">Loading...</div>
          <div v-else-if="dynamoBrowse.error" class="alert-error">{{ dynamoBrowse.error }}</div>
          <div v-else-if="!dynamoBrowse.items" class="empty-row">Run a Scan or Query to see data.</div>
          <div v-else-if="!dynamoBrowse.items.length" class="empty-row">No items returned.</div>
          <div v-else>
            <div class="text-dim" style="font-size:11px;margin-bottom:6px">
              {{ dynamoBrowse.items.length }} items shown · Total scanned: {{ dynamoBrowse.scannedCount }}
            </div>
            <table class="cloud-table" style="font-size:11px">
              <thead><tr>
                <th v-for="col in dynamoBrowse.columns" :key="col">{{ col }}</th>
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
                      title="Ver contenido completo">🔍</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <!-- Pagination -->
        <div v-if="dynamoBrowse.lastEvaluatedKey || dynamoBrowse.prevKeys?.length" style="padding:8px 12px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
          <button class="btn sm" :disabled="!dynamoBrowse.prevKeys?.length" @click="dynamoPrevPage">‹ Prev</button>
          <span class="text-dim" style="line-height:28px;font-size:12px">Page {{ (dynamoBrowse.prevKeys?.length || 0) + 1 }}</span>
          <button class="btn sm" :disabled="!dynamoBrowse.lastEvaluatedKey" @click="dynamoNextPage">Next ›</button>
        </div>
      </div>
    </div>

    <!-- ══ DynamoDB Cell Expand Modal ══════════════════════════════════════════ -->
    <div v-if="dynamoCellModal.open" class="modal-overlay" @click.self="dynamoCellModal.open = false" style="z-index:3000">
      <div class="modal-box" style="width:660px;max-width:98vw;max-height:85vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600;font-size:13px">{{ dynamoCellModal.column }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" @click="copyText(dynamoCellModal.raw)">Copiar</button>
            <button class="btn sm" @click="dynamoCellModal.open = false">Cerrar</button>
          </div>
        </div>
        <div style="flex:1;overflow:auto;padding:14px">
          <pre class="code-block" style="white-space:pre-wrap;word-break:break-all;margin:0;max-height:none;font-size:12px">{{ dynamoCellModal.formatted }}</pre>
        </div>
      </div>
    </div>

    <!-- ══ DocumentDB Config Modal ════════════════════════════════════════════ -->
    <div v-if="docdbConfigModal.open" class="modal-overlay" @click.self="docdbConfigModal.open = false">
      <div class="modal-box" style="width:820px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:14px">{{ docdbConfigModal.clusterId }}</div>
            <div class="text-dim" style="font-size:11px">DocumentDB Cluster Configuration</div>
          </div>
          <button class="btn sm" @click="docdbConfigModal.open = false">Cerrar</button>
        </div>
        <div v-if="docdbConfigModal.loading" class="empty-row">Loading...</div>
        <div v-else-if="docdbConfigModal.error" class="alert-error">{{ docdbConfigModal.error }}</div>
        <div v-else-if="docdbConfigModal.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">

          <!-- Header badges -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span :class="docdbConfigModal.data.status === 'available' ? 'status-ok' : 'status-warn'" style="font-size:13px;font-weight:600">{{ docdbConfigModal.data.status }}</span>
            <span class="text-dim" style="font-size:11px">{{ docdbConfigModal.data.engine }} {{ docdbConfigModal.data.engineVersion }}</span>
            <span v-if="docdbConfigModal.data.storageEncrypted" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(166,227,161,.12);color:#a6e3a1">Encrypted</span>
            <span v-if="docdbConfigModal.data.deletionProtection" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(250,179,135,.12);color:#fab387">Deletion Protection</span>
            <span v-if="docdbConfigModal.data.multiAZ" style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--border)">Multi-AZ</span>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <!-- General -->
            <div class="config-section">
              <div class="config-title">General</div>
              <div class="config-row"><span>Master User</span><span class="mono-xs text-dim">{{ docdbConfigModal.data.masterUsername }}</span></div>
              <div class="config-row"><span>Port</span><span class="text-dim">{{ docdbConfigModal.data.port }}</span></div>
              <div class="config-row"><span>Subnet Group</span><span class="mono-xs text-dim">{{ docdbConfigModal.data.subnetGroup || '-' }}</span></div>
              <div class="config-row"><span>Param Group</span><span class="mono-xs text-dim">{{ docdbConfigModal.data.parameterGroup || '-' }}</span></div>
              <div class="config-row"><span>Creado</span><span class="text-dim">{{ docdbConfigModal.data.clusterCreateTime ? formatDate(docdbConfigModal.data.clusterCreateTime) : '-' }}</span></div>
            </div>

            <!-- Endpoints -->
            <div class="config-section">
              <div class="config-title">Endpoints</div>
              <div class="config-row" style="align-items:flex-start">
                <span style="flex-shrink:0">Writer</span>
                <span class="mono-xs text-dim" style="word-break:break-all;font-size:10px">{{ docdbConfigModal.data.endpoint || '-' }}</span>
              </div>
              <div class="config-row" style="align-items:flex-start">
                <span style="flex-shrink:0">Reader</span>
                <span class="mono-xs text-dim" style="word-break:break-all;font-size:10px">{{ docdbConfigModal.data.readerEndpoint || '-' }}</span>
              </div>
            </div>

            <!-- Backup & Maintenance -->
            <div class="config-section">
              <div class="config-title">Backup &amp; Mantenimiento</div>
              <div class="config-row"><span>Retención (días)</span><span class="text-dim">{{ docdbConfigModal.data.backupRetentionPeriod ?? '-' }}</span></div>
              <div class="config-row"><span>Ventana backup</span><span class="mono-xs text-dim">{{ docdbConfigModal.data.preferredBackupWindow || '-' }}</span></div>
              <div class="config-row"><span>Ventana mant.</span><span class="mono-xs text-dim">{{ docdbConfigModal.data.preferredMaintenanceWindow || '-' }}</span></div>
              <div class="config-row"><span>Restore más antiguo</span><span class="text-dim" style="font-size:10px">{{ docdbConfigModal.data.earliestRestorableTime ? formatDate(docdbConfigModal.data.earliestRestorableTime) : '-' }}</span></div>
            </div>

            <!-- Security Groups -->
            <div class="config-section">
              <div class="config-title">Security Groups ({{ (docdbConfigModal.data.vpcSecurityGroups || []).length }})</div>
              <div v-for="sg in docdbConfigModal.data.vpcSecurityGroups" :key="sg.id"
                style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--border);font-size:11px">
                <span class="mono-xs">{{ sg.id }}</span>
                <span :class="sg.status === 'active' ? 'status-ok' : 'text-dim'" style="font-size:10px">{{ sg.status }}</span>
              </div>
              <div v-if="!docdbConfigModal.data.vpcSecurityGroups?.length" class="text-dim" style="font-size:11px">Ninguno</div>
            </div>
          </div>

          <!-- AZs -->
          <div class="config-section">
            <div class="config-title">Availability Zones</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
              <span v-for="az in (docdbConfigModal.data.availabilityZones || [])" :key="az"
                style="font-size:11px;padding:2px 10px;border-radius:4px;border:1px solid var(--border);color:var(--text-dim)">{{ az }}</span>
            </div>
          </div>

          <!-- Instances -->
          <div class="config-section">
            <div class="config-title">Instancias ({{ (docdbConfigModal.data.instances || []).length }})</div>
            <table class="cloud-table" style="margin-top:6px">
              <thead><tr>
                <th>ID</th><th>Clase</th><th>Status</th><th>AZ</th><th>Rol</th><th>Tier</th><th>Pública</th>
              </tr></thead>
              <tbody>
                <tr v-for="inst in docdbConfigModal.data.instances" :key="inst.id">
                  <td class="mono-xs" style="font-size:10px">{{ inst.id }}</td>
                  <td class="text-dim" style="font-size:11px">{{ inst.class }}</td>
                  <td><span :class="inst.status === 'available' ? 'status-ok' : 'status-warn'" style="font-size:11px">{{ inst.status }}</span></td>
                  <td class="text-dim" style="font-size:11px">{{ inst.az }}</td>
                  <td><span :class="inst.writer ? 'status-ok' : 'text-dim'" style="font-size:11px;font-weight:600">{{ inst.writer ? 'Writer' : 'Reader' }}</span></td>
                  <td class="text-dim" style="font-size:11px">{{ inst.promotionTier ?? '-' }}</td>
                  <td><span :class="inst.publiclyAccessible ? 'status-warn' : 'text-dim'" style="font-size:11px">{{ inst.publiclyAccessible ? 'Sí' : 'No' }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- KMS -->
          <div v-if="docdbConfigModal.data.kmsKeyId" class="config-section">
            <div class="config-title">Cifrado KMS</div>
            <div class="config-row"><span>KMS Key ID</span><span class="mono-xs text-dim" style="font-size:10px;word-break:break-all">{{ docdbConfigModal.data.kmsKeyId }}</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ DocumentDB Reset Password Modal ═════════════════════════════════════ -->
    <div v-if="docdbResetPwdModal.open" class="modal-overlay" @click.self="docdbResetPwdModal.open = false">
      <div class="modal-box" style="width:460px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">Cambiar Password Master — {{ docdbResetPwdModal.clusterId }}</span>
          <button class="btn sm" @click="docdbResetPwdModal.open = false">Cerrar</button>
        </div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
          <div style="font-size:12px;color:var(--text-dim);border-left:3px solid var(--accent);padding-left:10px;line-height:1.6">
            Esta acción cambia la contraseña del usuario master del cluster. El cambio se aplica de inmediato (<code>ApplyImmediately=true</code>). La contraseña anterior dejará de funcionar.
          </div>
          <label class="field-label">
            Nueva contraseña
            <input v-model="docdbResetPwdModal.newPassword" type="password" class="ctrl-input" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
          </label>
          <label class="field-label">
            Confirmar contraseña
            <input v-model="docdbResetPwdModal.confirmPassword" type="password" class="ctrl-input" placeholder="Repetir contraseña" autocomplete="new-password" />
          </label>
          <div v-if="docdbResetPwdModal.error" class="alert-error">{{ docdbResetPwdModal.error }}</div>
          <div v-if="docdbResetPwdModal.success" style="color:#a6e3a1;font-size:12px;padding:8px;border-radius:4px;background:rgba(166,227,161,.1)">{{ docdbResetPwdModal.success }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn sm" @click="docdbResetPwdModal.open = false">Cancelar</button>
            <button class="btn sm" :disabled="docdbResetPwdModal.loading" @click="() => doDocdbResetPassword()">
              {{ docdbResetPwdModal.loading ? 'Cambiando...' : 'Cambiar Password' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ DocumentDB Create Cluster Modal ════════════════════════════════════ -->
    <div v-if="docdbCreateModal.open" class="modal-overlay" @click.self="docdbCreateModal.open = false">
      <div class="modal-box" style="width:560px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600">Crear Nuevo Cluster DocumentDB</span>
          <button class="btn sm" @click="docdbCreateModal.open = false">Cerrar</button>
        </div>
        <div style="flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="field-label" style="grid-column:1/-1">
              Cluster ID *
              <input v-model="docdbCreateModal.form.clusterId" class="ctrl-input" placeholder="my-docdb-cluster" />
            </label>
            <label class="field-label">
              Master Username *
              <input v-model="docdbCreateModal.form.masterUsername" class="ctrl-input" placeholder="admin" />
            </label>
            <label class="field-label">
              Master Password *
              <input v-model="docdbCreateModal.form.masterPassword" type="password" class="ctrl-input" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
            </label>
            <label class="field-label">
              Engine Version
              <select v-model="docdbCreateModal.form.engineVersion" class="ctrl-input ctrl-select">
                <option value="">Última (default)</option>
                <option value="5.0.0">5.0.0</option>
                <option value="4.0.0">4.0.0</option>
                <option value="3.6.0">3.6.0</option>
              </select>
            </label>
            <label class="field-label">
              Instance Class (opcional)
              <select v-model="docdbCreateModal.form.instanceClass" class="ctrl-input ctrl-select">
                <option value="">Sin instancia inicial</option>
                <option value="db.t3.medium">db.t3.medium</option>
                <option value="db.r5.large">db.r5.large</option>
                <option value="db.r5.xlarge">db.r5.xlarge</option>
                <option value="db.r5.2xlarge">db.r5.2xlarge</option>
                <option value="db.r6g.large">db.r6g.large</option>
              </select>
            </label>
            <label class="field-label">
              Subnet Group (opcional)
              <input v-model="docdbCreateModal.form.subnetGroupName" class="ctrl-input" placeholder="default" />
            </label>
            <label class="field-label">
              Backup Retention (días)
              <input v-model.number="docdbCreateModal.form.backupRetentionPeriod" type="number" min="1" max="35" class="ctrl-input" placeholder="1" />
            </label>
          </div>
          <div style="display:flex;gap:16px;align-items:center;padding:6px 0">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
              <input type="checkbox" v-model="docdbCreateModal.form.storageEncrypted" />
              Storage Encrypted
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
              <input type="checkbox" v-model="docdbCreateModal.form.deletionProtection" />
              Deletion Protection
            </label>
          </div>
          <div v-if="docdbCreateModal.error" class="alert-error">{{ docdbCreateModal.error }}</div>
          <div v-if="docdbCreateModal.result" style="color:#a6e3a1;font-size:12px;padding:10px;border-radius:4px;background:rgba(166,227,161,.1)">
            <div style="font-weight:600;margin-bottom:4px">✓ Cluster creado</div>
            <div>ID: <span class="mono-xs">{{ docdbCreateModal.result.clusterId }}</span></div>
            <div>Status: <span class="mono-xs">{{ docdbCreateModal.result.status }}</span></div>
            <div v-if="docdbCreateModal.result.instance">Instancia: <span class="mono-xs">{{ docdbCreateModal.result.instance }}</span></div>
            <div class="text-dim" style="font-size:11px;margin-top:6px">El cluster puede tardar varios minutos en estar disponible.</div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:10px">
            <button class="btn sm" @click="docdbCreateModal.open = false">Cancelar</button>
            <button class="btn sm" :disabled="docdbCreateModal.loading" @click="() => doDocdbCreate()">
              {{ docdbCreateModal.loading ? 'Creando...' : 'Crear Cluster' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ DocumentDB Connect Modal ═══════════════════════════════════════════ -->
    <div v-if="docdbConnectModal.open" class="modal-overlay" @click.self="docdbConnectModal.open = false">
      <div class="modal-box" style="width:700px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">Connect — {{ docdbConnectModal.clusterId }}</span>
          <button class="btn sm" @click="docdbConnectModal.open = false">Close</button>
        </div>
        <div v-if="docdbConnectModal.loading" class="empty-row">Loading...</div>
        <div v-else-if="docdbConnectModal.error" class="alert-error">{{ docdbConnectModal.error }}</div>
        <div v-else-if="docdbConnectModal.data" style="padding:12px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;gap:6px;align-items:center">
            <label style="font-size:12px;color:var(--text-muted);white-space:nowrap">Password (for URI)</label>
            <input v-model="docdbConnectModal.password" type="password" class="ctrl-input" placeholder="master user password" style="flex:1" />
          </div>
          <!-- mongosh -->
          <div>
            <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text-muted)">mongosh</div>
            <div style="position:relative">
              <pre class="code-block" style="user-select:all;overflow-x:auto">{{ docdbConnectModal.password ? docdbConnectModal.data.mongoshTemplate.replace('<PASSWORD>', docdbConnectModal.password) : docdbConnectModal.data.mongoshTemplate }}</pre>
              <button class="btn sm" style="position:absolute;top:4px;right:4px" @click="copyDocdbUri('mongosh')">Copy</button>
            </div>
          </div>
          <!-- Compass URI -->
          <div>
            <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text-muted)">MongoDB Compass URI</div>
            <div style="position:relative">
              <pre class="code-block" style="user-select:all;overflow-x:auto">{{ docdbConnectModal.password ? docdbConnectModal.data.compassUri.replace('<PASSWORD>', docdbConnectModal.password) : docdbConnectModal.data.compassUri }}</pre>
              <button class="btn sm" style="position:absolute;top:4px;right:4px" @click="copyDocdbUri('compass')">Copy</button>
            </div>
          </div>
          <!-- TLS note -->
          <div style="background:var(--bg-alt,#1e1e2e);border-radius:6px;padding:10px 12px">
            <div style="font-size:11px;font-weight:600;margin-bottom:6px">TLS Setup Required</div>
            <div v-for="n in docdbConnectModal.data.notes" :key="n" style="font-size:11px;color:var(--text-muted);margin-bottom:4px">• {{ n }}</div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <code style="font-size:11px;flex:1;word-break:break-all">{{ docdbConnectModal.data.tlsDownloadNote }}</code>
              <button class="btn sm" @click="copyText(docdbConnectModal.data.tlsDownloadNote)">Copy</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Glue Job Config Modal ═══════════════════════════════════════════════ -->
    <div v-if="glueConfigModal.open" class="modal-overlay" @click.self="glueConfigModal.open = false">
      <div class="modal-box" style="width:860px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="font-weight:600;font-size:14px">{{ glueConfigModal.job?.name }}</span>
            <span class="text-dim" style="font-size:11px">{{ glueConfigModal.data?.description || 'AWS Glue Job' }}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn sm" @click="openGlueLogs(glueConfigModal.job)">Ver Logs</button>
            <button class="btn sm" @click="glueConfigModal.open = false">Cerrar</button>
          </div>
        </div>
        <div v-if="glueConfigModal.loading" class="empty-row">Loading...</div>
        <div v-else-if="glueConfigModal.error" class="alert-error">{{ glueConfigModal.error }}</div>
        <div v-else-if="glueConfigModal.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">

          <!-- ── Última ejecución ── -->
          <div v-if="glueConfigModal.lastRun" style="border-radius:8px;padding:12px 14px;border:1px solid var(--border);display:flex;gap:20px;flex-wrap:wrap;align-items:center">
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Última ejecución</span>
              <span :class="glueConfigModal.lastRun.status === 'SUCCEEDED' ? 'status-ok' : glueConfigModal.lastRun.status === 'RUNNING' ? 'status-warn' : 'status-err'" style="font-weight:600;font-size:13px">{{ glueConfigModal.lastRun.status }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Run ID</span>
              <span class="mono-xs text-dim">{{ glueConfigModal.lastRun.id }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Iniciado</span>
              <span class="text-dim" style="font-size:12px">{{ glueConfigModal.lastRun.startedOn ? formatDate(glueConfigModal.lastRun.startedOn) : '-' }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Completado</span>
              <span class="text-dim" style="font-size:12px">{{ glueConfigModal.lastRun.completedOn ? formatDate(glueConfigModal.lastRun.completedOn) : '-' }}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Duración</span>
              <span class="text-dim" style="font-size:12px">{{ glueConfigModal.lastRun.executionTime ? glueConfigModal.lastRun.executionTime + 's' : '-' }}</span>
            </div>
            <div v-if="glueConfigModal.lastRun.errorMessage" style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:2px">
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600">Error</span>
              <span style="font-size:11px;color:#f38ba8;word-break:break-word">{{ glueConfigModal.lastRun.errorMessage }}</span>
            </div>
          </div>
          <div v-else-if="!glueConfigModal.loadingRuns" style="font-size:12px;color:var(--text-dim);border:1px dashed var(--border);border-radius:6px;padding:8px 12px">Sin ejecuciones registradas.</div>

          <!-- ── Script & Script Link ── -->
          <div class="config-section">
            <div class="config-title" style="display:flex;align-items:center;justify-content:space-between">
              <span>Script</span>
              <a v-if="glueConfigModal.data.command?.ScriptLocation"
                :href="glueS3ConsoleUrl(glueConfigModal.data.command.ScriptLocation)"
                target="_blank" rel="noopener"
                class="btn sm" style="font-size:11px;text-decoration:none">Abrir en S3 ↗</a>
            </div>
            <div class="config-row"><span>Tipo</span><span class="text-dim">{{ glueConfigModal.data.command?.Name }}</span></div>
            <div class="config-row"><span>Runtime Python</span><span class="text-dim">{{ glueConfigModal.data.command?.PythonVersion ? 'Python ' + glueConfigModal.data.command.PythonVersion : 'N/A' }}</span></div>
            <div class="config-row" style="align-items:flex-start">
              <span style="flex-shrink:0">Ubicación</span>
              <div style="display:flex;gap:6px;align-items:center;min-width:0;flex:1">
                <span class="text-dim mono-xs" style="word-break:break-all;flex:1">{{ glueConfigModal.data.command?.ScriptLocation }}</span>
                <button class="btn sm" style="flex-shrink:0" @click="copyText(glueConfigModal.data.command?.ScriptLocation)">Copy</button>
              </div>
            </div>
            <div class="config-row"><span>CW Log Group</span><span class="text-dim mono-xs">{{ glueConfigModal.data.cloudWatchLogGroup }}</span></div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <!-- ── General ── -->
            <div class="config-section">
              <div class="config-title">General</div>
              <div class="config-row"><span>Glue Version</span><span class="text-dim">{{ glueConfigModal.data.glueVersion || '-' }}</span></div>
              <div class="config-row"><span>Worker Type</span><span class="text-dim">{{ glueConfigModal.data.workerType || '-' }}</span></div>
              <div class="config-row"><span>Workers</span><span class="text-dim">{{ glueConfigModal.data.numberOfWorkers ?? '-' }}</span></div>
              <div class="config-row"><span>Max Retries</span><span class="text-dim">{{ glueConfigModal.data.maxRetries ?? '-' }}</span></div>
              <div class="config-row"><span>Timeout (min)</span><span class="text-dim">{{ glueConfigModal.data.timeout ?? '-' }}</span></div>
              <div class="config-row" style="align-items:flex-start">
                <span style="flex-shrink:0">Role IAM</span>
                <span class="text-dim mono-xs" style="word-break:break-all;font-size:10px">{{ glueConfigModal.data.role }}</span>
              </div>
            </div>

            <!-- ── Conexiones ── -->
            <div class="config-section">
              <div class="config-title">Conexiones ({{ (glueConfigModal.data.connections || []).length }})</div>
              <div v-if="!glueConfigModal.data.connections?.length" class="text-dim" style="font-size:12px;padding:6px 0">Ninguna conexión asignada.</div>
              <div v-for="conn in glueConfigModal.data.connections" :key="conn"
                style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
                <span class="mono-xs">{{ conn }}</span>
              </div>
            </div>
          </div>

          <!-- ── Argumentos ── -->
          <div class="config-section">
            <div class="config-title">Default Arguments ({{ Object.keys(glueConfigModal.data.defaultArguments || {}).length }})</div>
            <div v-if="!Object.keys(glueConfigModal.data.defaultArguments || {}).length" class="text-dim" style="font-size:12px;padding:6px 0">Ninguno.</div>
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
      <div class="modal-box" style="width:900px;max-width:98vw;height:80vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <span style="font-weight:600">Logs — {{ glueLogsModal.job?.name }}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <select v-model.number="glueLogsModal.minutes" class="ctrl-select" style="font-size:12px">
              <option :value="15">15 min</option>
              <option :value="60">1 hour</option>
              <option :value="360">6 hours</option>
              <option :value="1440">24 hours</option>
            </select>
            <button class="btn sm" @click="loadGlueLogs">Refresh</button>
            <button class="btn sm" @click="glueLogsModal.open = false">Close</button>
          </div>
        </div>
        <div v-if="glueLogsModal.loading" class="empty-row">Loading logs...</div>
        <div v-else-if="glueLogsModal.error" class="alert-error">{{ glueLogsModal.error }}</div>
        <div v-else-if="!glueLogsModal.events?.length" class="empty-row">No log events found for the selected period.</div>
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
      <div class="modal-box" style="width:460px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">Create User — {{ cognitoState.selectedPool?.name }}</span>
          <button class="btn sm" @click="cognitoCreateModal.open = false">Close</button>
        </div>
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">Username *</label>
            <input v-model="cognitoCreateModal.username" class="ctrl-input" placeholder="username or email" />
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">Email</label>
            <input v-model="cognitoCreateModal.email" type="email" class="ctrl-input" placeholder="user@example.com" />
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <label style="font-size:12px;color:var(--text-muted)">Temporary Password (optional)</label>
            <input v-model="cognitoCreateModal.temporaryPassword" type="password" class="ctrl-input" placeholder="leave blank to auto-generate" />
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" v-model="cognitoCreateModal.suppressMessage" id="suppressMsg" />
            <label for="suppressMsg" style="font-size:12px">Suppress welcome message</label>
          </div>
          <div v-if="cognitoCreateModal.error" class="alert-error">{{ cognitoCreateModal.error }}</div>
          <div v-if="cognitoCreateModal.result" class="alert-success">User created: {{ cognitoCreateModal.result }}</div>
          <div style="display:flex;gap:8px">
            <button class="btn" @click="submitCreateCognitoUser" :disabled="cognitoCreateModal.loading">
              {{ cognitoCreateModal.loading ? 'Creating...' : 'Create User' }}
            </button>
            <button class="btn sm" @click="cognitoCreateModal.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Cognito User Detail Slide-over ═════════════════════════════════════ -->
    <div v-if="cognitoUserDetail.open" class="modal-overlay" @click.self="cognitoUserDetail.open = false">
      <div class="modal-box" style="width:600px;max-width:98vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div>
            <div style="font-weight:600;font-size:13px">{{ cognitoUserDetail.username }}</div>
            <div v-if="cognitoUserDetail.data" class="text-dim" style="font-size:11px">{{ cognitoUserDetail.data.attributes?.email || '' }}</div>
          </div>
          <button class="btn sm" @click="cognitoUserDetail.open = false">Cerrar</button>
        </div>
        <div v-if="cognitoUserDetail.loading" class="empty-row">Loading...</div>
        <div v-else-if="cognitoUserDetail.data" style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px">

          <!-- Status badges row -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span :class="cognitoUserDetail.data.status === 'CONFIRMED' ? 'status-ok' : 'status-warn'" style="font-size:12px;font-weight:600">{{ cognitoUserDetail.data.status }}</span>
            <span :class="cognitoUserDetail.data.enabled ? 'status-ok' : 'status-err'" style="font-size:12px">{{ cognitoUserDetail.data.enabled ? 'Habilitado' : 'Deshabilitado' }}</span>
            <span :class="cognitoUserDetail.data.mfaSettingList?.length ? 'status-ok' : 'text-dim'"
              style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid currentColor">
              MFA: {{ cognitoUserDetail.data.mfaSettingList?.join(', ') || 'Off' }}
            </span>
            <span v-if="cognitoUserDetail.data.preferredMfa" class="text-dim" style="font-size:11px">Preferido: {{ cognitoUserDetail.data.preferredMfa }}</span>
          </div>

          <!-- Timestamps -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="config-section" style="margin:0">
              <div class="config-title">Cuenta creada</div>
              <div style="font-size:12px;color:var(--text-dim)">{{ cognitoUserDetail.data.created ? formatDate(cognitoUserDetail.data.created) : '-' }}</div>
            </div>
            <div class="config-section" style="margin:0">
              <div class="config-title">Última modificación</div>
              <div style="font-size:12px;color:var(--text-dim)">{{ cognitoUserDetail.data.modified ? formatDate(cognitoUserDetail.data.modified) : '-' }}</div>
            </div>
          </div>

          <!-- All Attributes as cards -->
          <div class="config-section">
            <div class="config-title">Atributos del usuario</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;margin-top:6px">
              <div v-for="(v, k) in cognitoUserDetail.data.attributes" :key="k"
                style="border:1px solid var(--border);border-radius:5px;padding:6px 10px">
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;font-weight:600;margin-bottom:2px">{{ k }}</div>
                <div class="mono-xs" style="word-break:break-all;font-size:12px">{{ v }}</div>
              </div>
            </div>
          </div>

          <!-- MFA Options detail -->
          <div v-if="cognitoUserDetail.data.mfaOptions?.length" class="config-section">
            <div class="config-title">MFA Options</div>
            <div v-for="opt in cognitoUserDetail.data.mfaOptions" :key="opt.DeliveryMedium" class="config-row">
              <span>{{ opt.DeliveryMedium }}</span><span class="text-dim mono-xs">{{ opt.AttributeName }}</span>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border)">
            <button class="btn sm" @click="doCognitoResetPassword(cognitoUserDetail.data)">Enviar reset de contraseña</button>
            <button class="btn sm" v-if="cognitoUserDetail.data.enabled" @click="doCognitoDisable(cognitoUserDetail.data)">Deshabilitar</button>
            <button class="btn sm" v-else @click="doCognitoEnable(cognitoUserDetail.data)">Habilitar</button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { createIcons, icons } from 'lucide'
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
import Ec2Rdp              from './Ec2Rdp.vue'
import Ec2RdpInfo          from './Ec2RdpInfo.vue'
import Ec2Detail           from './Ec2Detail.vue'
import LambdaDetail        from './LambdaDetail.vue'
import ApiGwIntegrations   from './ApiGwIntegrations.vue'
import S3Browser           from './S3Browser.vue'

const props = defineProps({
  activeService: { type: String, default: 'ec2' },
})

const envStore = useEnvStore()
const awsStore = useAwsStore()
const { toast }    = useToast()
const { apiFetch } = useApi()
const { sortBy, sortRows, sortIcon, thClass, resetSort } = useSortable()

const selectedProfileId = ref(awsStore.activeProfileId || '')
const localProfiles     = ref([])

const TABS = [
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
  { id: 'dynamodb',     label: 'DynamoDB'       },
  { id: 'docdb',        label: 'DocumentDB'     },
  { id: 'glue',         label: 'Glue'           },
  { id: 'athena',       label: 'Athena'         },
  { id: 'datapipeline', label: 'Data Pipeline'  },
  { id: 'cloudfront',   label: 'CloudFront'     },
  { id: 'route53',      label: 'Route 53'       },
  { id: 'cognito',      label: 'Cognito'        },
  { id: 'secrets',      label: 'Secrets Manager'},
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
const filteredDynamo      = computed(() => filterRows(awsStore.dynamoTables,     search.dynamodb))
const filteredDocdb       = computed(() => filterRows(awsStore.docdbClusters,    search.docdb))
const filteredGlue        = computed(() => filterRows(awsStore.glueJobs,         search.glue))
const filteredAthena      = computed(() => filterRows(awsStore.athenaWorkgroups, search.athena))
const filteredPipelines   = computed(() => filterRows(awsStore.dataPipelines,    search.datapipeline))
const filteredCloudfront  = computed(() => filterRows(awsStore.cloudfrontDists,  search.cloudfront))
const filteredRoute53     = computed(() => filterRows(awsStore.route53Zones,     search.route53))
const filteredCognito     = computed(() => filterRows(awsStore.cognitoUserPools, search.cognito))
const filteredSecrets     = computed(() => filterRows(awsStore.secrets,          search.secrets))

const tabFilteredMap = {
  ec2: filteredEc2, ecs: filteredEcs, eks: filteredEks,
  lambda: filteredLambda, apigw: filteredApigw, s3: filteredS3,
  ecr: filteredEcr, vpc: filteredVpc, eventbridge: filteredEventBridge, stepfn: filteredStepFn,
  dynamodb: filteredDynamo, docdb: filteredDocdb, glue: filteredGlue,
  athena: filteredAthena, datapipeline: filteredPipelines,
  cloudfront: filteredCloudfront, route53: filteredRoute53,
  cognito: filteredCognito, secrets: filteredSecrets,
}

const activeRowCount = computed(() => tabFilteredMap[activeTab.value]?.value?.length ?? 0)

function tabCount(id) {
  const map = {
    ec2: awsStore.ec2Instances, ecs: awsStore.ecsServices, eks: awsStore.eksClusters,
    lambda: awsStore.lambdas, apigw: awsStore.apiGateways, s3: awsStore.s3Buckets,
    ecr: awsStore.ecrRepos, vpc: awsStore.vpcs, eventbridge: awsStore.eventBridgeRules,
    stepfn: awsStore.stepFunctions,
    dynamodb: awsStore.dynamoTables, docdb: awsStore.docdbClusters,
    glue: awsStore.glueJobs, athena: awsStore.athenaWorkgroups,
    datapipeline: awsStore.dataPipelines, cloudfront: awsStore.cloudfrontDists,
    route53: awsStore.route53Zones, cognito: awsStore.cognitoUserPools,
    secrets: awsStore.secrets,
  }
  return map[id]?.length ?? 0
}

const fetchMap = {
  ec2:          () => awsStore.fetchEc2Instances(),
  ecs:          () => awsStore.fetchEcsServices(),
  eks:          () => awsStore.fetchEksClusters(),
  lambda:       () => awsStore.fetchLambdas(),
  apigw:        () => awsStore.fetchApiGateways(),
  s3:           () => awsStore.fetchS3Buckets(),
  ecr:          () => awsStore.fetchEcrRepos(),
  vpc:          () => awsStore.fetchVpcs(),
  eventbridge:  () => awsStore.fetchEventBridgeRules(),
  stepfn:       () => awsStore.fetchStepFunctions(),
  dynamodb:     () => awsStore.fetchDynamoTables(),
  docdb:        () => awsStore.fetchDocdbClusters(),
  glue:         () => awsStore.fetchGlueJobs(),
  athena:       () => awsStore.fetchAthenaWorkgroups(),
  datapipeline: () => awsStore.fetchDataPipelines(),
  cloudfront:   () => awsStore.fetchCloudfrontDists(),
  route53:      () => awsStore.fetchRoute53Zones(),
  cognito:      () => awsStore.fetchCognitoUserPools(),
  secrets:      () => awsStore.fetchSecrets(),
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

// ─── EC2 RDP Info Modal ───────────────────────────────────────────────────────

const ec2RdpModal = reactive({ open: false, instance: null })
function openEc2Rdp(instance) {
  Object.assign(ec2RdpModal, { open: true, instance })
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
  if (r?.jobRunId) toast(`Glue job started: ${r.jobRunId}`, 'success')
  else toast(awsStore.error || 'Failed to start job', 'error')
}

// ─── Athena Query Panel ───────────────────────────────────────────────────────

const athenaModal = reactive({
  open: false, loading: false, workgroup: null,
  query: '', queryId: null, status: null, results: null, error: null,
})

function openAthenaQuery(wg) {
  Object.assign(athenaModal, { open: true, workgroup: wg, query: '', queryId: null, status: null, results: null, error: null, loading: false })
}

async function submitAthenaQuery() {
  if (!athenaModal.query.trim()) return
  athenaModal.loading = true; athenaModal.error = null; athenaModal.results = null; athenaModal.status = null
  try {
    const r = await awsStore.startAthenaQuery(athenaModal.query, athenaModal.workgroup?.name, athenaModal.workgroup?.outputLocation)
    if (!r?.queryExecutionId) { athenaModal.error = awsStore.error || 'Failed to start query'; return }
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
  if (r?.success) { toast(`Activated: ${p.name}`, 'success'); loaded.datapipeline = false; loadTab('datapipeline') }
  else toast(awsStore.error || 'Error', 'error')
}

async function deactivatePipeline(p) {
  const r = await awsStore.deactivateDataPipeline(p.id)
  if (r?.success) { toast(`Paused: ${p.name}`, 'success'); loaded.datapipeline = false; loadTab('datapipeline') }
  else toast(awsStore.error || 'Error', 'error')
}

// ─── CloudFront Invalidation Modal ────────────────────────────────────────────

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
      toast('Invalidation created', 'success')
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
      toast(`Distribution created: ${r.domainName}`, 'success')
      loaded.cloudfront = false; loadTab('cloudfront')
    } else {
      cfCreateModal.error = awsStore.error || 'Failed to create distribution'
    }
  } finally { cfCreateModal.loading = false }
}

// ─── Route 53 Actions ─────────────────────────────────────────────────────────

const route53State = reactive({ selectedZoneId: null, records: [], loadingRecords: false })

async function loadRoute53Records(zone) {
  route53State.selectedZoneId = zone.id
  route53State.records = []
  route53State.loadingRecords = true
  try {
    const data = await awsStore.fetchRoute53Records(zone.id)
    route53State.records = data || []
  } finally { route53State.loadingRecords = false }
}

// ─── Cognito Actions ──────────────────────────────────────────────────────────

const cognitoInnerTabs = [
  { id: 'users',   label: 'Users' },
  { id: 'clients', label: 'App Clients' },
  { id: 'idps',    label: 'Identity Providers' },
  { id: 'config',  label: 'Pool Config' },
]

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
  // Pool Config
  poolConfig:      null,
  loadingConfig:   false,
})

async function loadCognitoPool(pool) {
  cognitoState.selectedPool    = pool
  cognitoState.users           = []
  cognitoState.clients         = []
  cognitoState.idps            = []
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

async function loadCognitoPoolConfig() {
  cognitoState.loadingConfig = true
  try {
    cognitoState.poolConfig = await awsStore.fetchCognitoPoolConfig(cognitoState.selectedPool.id)
  } finally { cognitoState.loadingConfig = false }
}

async function doCognitoResetPassword(user) {
  if (!confirm(`Send password reset email to ${user.username}?`)) return
  const r = await awsStore.resetCognitoUserPassword(cognitoState.selectedPool.id, user.username)
  if (r?.success) toast('Password reset email sent.', 'success')
  else toast(awsStore.error || 'Failed', 'error')
}

async function doCognitoEnable(user) {
  const r = await awsStore.enableCognitoUser(cognitoState.selectedPool.id, user.username)
  if (r?.success) { toast('User enabled.', 'success'); user.enabled = true }
  else toast(awsStore.error || 'Failed', 'error')
}

async function doCognitoDisable(user) {
  const r = await awsStore.disableCognitoUser(cognitoState.selectedPool.id, user.username)
  if (r?.success) { toast('User disabled.', 'success'); user.enabled = false }
  else toast(awsStore.error || 'Failed', 'error')
}

// ─── Cognito Create User Modal ────────────────────────────────────────────────
const cognitoCreateModal = reactive({ open: false, loading: false, username: '', email: '', temporaryPassword: '', suppressMessage: false, error: null, result: null })

function openCreateCognitoUser() { Object.assign(cognitoCreateModal, { open: true, username: '', email: '', temporaryPassword: '', suppressMessage: false, error: null, result: null, loading: false }) }

async function submitCreateCognitoUser() {
  if (!cognitoCreateModal.username) { cognitoCreateModal.error = 'Username is required'; return }
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

// ─── Cognito User Detail ──────────────────────────────────────────────────────
const cognitoUserDetail = reactive({ open: false, loading: false, username: '', data: null })

async function openUserDetail(user) {
  Object.assign(cognitoUserDetail, { open: true, loading: true, username: user.username, data: null })
  try {
    cognitoUserDetail.data = await awsStore.fetchCognitoUserDetail(cognitoState.selectedPool.id, user.username)
  } finally { cognitoUserDetail.loading = false }
}

// ─── DynamoDB Browse Modal ────────────────────────────────────────────────────

const dynamoBrowse = reactive({
  open: false, loading: false, error: null,
  table: '', mode: 'scan', limit: 50,
  keyName: '', keyValue: '', keyType: 'S', indexName: '',
  items: null, columns: [], count: 0, scannedCount: 0,
  lastEvaluatedKey: null, prevKeys: [],
})

function openDynamoBrowse(t) {
  const keyName = t.keySchema?.[0]?.name || ''
  Object.assign(dynamoBrowse, { open: true, loading: false, error: null, table: t.name, mode: 'scan', limit: 50, keyName, keyValue: '', keyType: 'S', indexName: '', items: null, columns: [], lastEvaluatedKey: null, prevKeys: [] })
}

async function executeDynamoBrowse(exclusiveStartKey) {
  dynamoBrowse.loading = true; dynamoBrowse.error = null
  try {
    let resp
    if (dynamoBrowse.mode === 'scan') {
      resp = await awsStore.scanDynamoTable(dynamoBrowse.table, { limit: dynamoBrowse.limit, exclusiveStartKey })
    } else {
      if (!dynamoBrowse.keyName || dynamoBrowse.keyValue === '') { dynamoBrowse.error = 'Partition key name and value are required.'; return }
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

// ─── DocumentDB Connect Modal ─────────────────────────────────────────────────

const docdbConnectModal = reactive({ open: false, loading: false, error: null, clusterId: '', password: '', data: null })

async function openDocdbConnect(cluster) {
  Object.assign(docdbConnectModal, { open: true, loading: true, error: null, clusterId: cluster.id, password: '', data: null })
  try {
    docdbConnectModal.data = await awsStore.fetchDocdbConnectionStrings(cluster.id)
    if (!docdbConnectModal.data) docdbConnectModal.error = awsStore.error || 'Failed to load connection strings'
  } catch (e) { docdbConnectModal.error = e.message }
  finally      { docdbConnectModal.loading = false }
}

function copyDocdbUri(type) {
  const d = docdbConnectModal.data
  if (!d) return
  const pw   = docdbConnectModal.password || '<PASSWORD>'
  const text = type === 'mongosh'
    ? d.mongoshTemplate.replace('<PASSWORD>', pw)
    : d.compassUri.replace('<PASSWORD>', pw)
  copyText(text)
}

// ─── DocumentDB Config Modal ──────────────────────────────────────────────────

const docdbConfigModal = reactive({ open: false, loading: false, error: null, clusterId: '', data: null })

async function openDocdbConfig(cluster) {
  Object.assign(docdbConfigModal, { open: true, loading: true, error: null, clusterId: cluster.id, data: null })
  try {
    docdbConfigModal.data = await awsStore.fetchDocdbConfig(cluster.id)
    if (!docdbConfigModal.data) docdbConfigModal.error = awsStore.error || 'Failed to load config'
  } catch (e) { docdbConfigModal.error = e.message }
  finally { docdbConfigModal.loading = false }
}

// ─── DocumentDB Reset Password Modal ─────────────────────────────────────────

const docdbResetPwdModal = reactive({ open: false, loading: false, error: null, success: null, clusterId: '', newPassword: '', confirmPassword: '' })

function openDocdbResetPwd(cluster) {
  Object.assign(docdbResetPwdModal, { open: true, loading: false, error: null, success: null, clusterId: cluster.id, newPassword: '', confirmPassword: '' })
}

async function doDocdbResetPassword() {
  docdbResetPwdModal.error = null; docdbResetPwdModal.success = null
  if (!docdbResetPwdModal.newPassword || docdbResetPwdModal.newPassword.length < 8) {
    docdbResetPwdModal.error = 'La contraseña debe tener al menos 8 caracteres'; return
  }
  if (docdbResetPwdModal.newPassword !== docdbResetPwdModal.confirmPassword) {
    docdbResetPwdModal.error = 'Las contraseñas no coinciden'; return
  }
  docdbResetPwdModal.loading = true
  try {
    const resp = await awsStore.resetDocdbPassword(docdbResetPwdModal.clusterId, docdbResetPwdModal.newPassword)
    if (resp?.ok) {
      docdbResetPwdModal.success = resp.message || 'Password cambiado exitosamente'
      docdbResetPwdModal.newPassword = ''; docdbResetPwdModal.confirmPassword = ''
    } else {
      docdbResetPwdModal.error = awsStore.error || 'Error al cambiar la contraseña'
    }
  } catch (e) { docdbResetPwdModal.error = e.message }
  finally { docdbResetPwdModal.loading = false }
}

// ─── DocumentDB Create Cluster Modal ─────────────────────────────────────────

const docdbCreateForm = () => ({ clusterId: '', masterUsername: '', masterPassword: '', engineVersion: '', instanceClass: 'db.t3.medium', subnetGroupName: '', backupRetentionPeriod: 1, storageEncrypted: false, deletionProtection: false })
const docdbCreateModal = reactive({ open: false, loading: false, error: null, result: null, form: docdbCreateForm() })

function openDocdbCreate() {
  Object.assign(docdbCreateModal, { open: true, loading: false, error: null, result: null, form: docdbCreateForm() })
}

async function doDocdbCreate() {
  docdbCreateModal.error = null
  const f = docdbCreateModal.form
  if (!f.clusterId || !f.masterUsername || !f.masterPassword) {
    docdbCreateModal.error = 'Cluster ID, Master Username y Password son obligatorios'; return
  }
  if (f.masterPassword.length < 8) {
    docdbCreateModal.error = 'La contraseña debe tener al menos 8 caracteres'; return
  }
  docdbCreateModal.loading = true
  try {
    const resp = await awsStore.createDocdbCluster({
      clusterId:              f.clusterId,
      masterUsername:         f.masterUsername,
      masterPassword:         f.masterPassword,
      engineVersion:          f.engineVersion || undefined,
      instanceClass:          f.instanceClass || undefined,
      subnetGroupName:        f.subnetGroupName || undefined,
      backupRetentionPeriod:  f.backupRetentionPeriod,
      storageEncrypted:       f.storageEncrypted,
      deletionProtection:     f.deletionProtection,
    })
    if (resp?.ok) {
      docdbCreateModal.result = resp
      await awsStore.fetchDocdbClusters()
    } else {
      docdbCreateModal.error = awsStore.error || 'Error al crear el cluster'
    }
  } catch (e) { docdbCreateModal.error = e.message }
  finally { docdbCreateModal.loading = false }
}

function copyText(text) {
  navigator.clipboard?.writeText(text)
    .then(() => toast('Copied!', 'success'))
    .catch(() => toast('Copy failed', 'error'))
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
      importSecretModal.keysError = awsStore.error || 'No se pudieron cargar las variables'
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
      toast(`Importadas ${r.keysImported} variable(s) desde Secrets Manager`, 'success')
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
    if (!secretConfigModal.data) secretConfigModal.error = awsStore.error || 'Error cargando config'
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

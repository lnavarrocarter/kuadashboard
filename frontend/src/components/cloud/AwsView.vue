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
        <div style="display:flex;justify-content:flex-end;padding:6px 8px 4px;flex-shrink:0">
          <button class="btn sm" style="background:rgba(80,200,120,.18);border-color:#50c878;color:#50c878" @click="openCreateS3Modal">+ Create Bucket</button>
        </div>
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
                  <button class="btn sm" :disabled="s3TestState[b.name]?.loading"
                    @click="testS3Bucket(b.name)"
                    :style="s3TestState[b.name]?.ok === true ? 'border-color:#50c878;color:#50c878' : s3TestState[b.name]?.ok === false ? 'border-color:#f85149;color:#f85149' : ''"
                    :title="s3TestState[b.name]?.msg || 'Test bucket connectivity'">{{ s3TestState[b.name]?.loading ? '...' : 'Test' }}</button>
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
                  <button class="btn sm" style="background:rgba(124,158,248,.18);border-color:#7c9ef8;color:#7c9ef8"
                    @click="openEcrDeploy(r)">Deploy to K8s</button>
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
                  <button class="btn sm" style="background:rgba(88,166,255,.18);border-color:#58a6ff;color:#58a6ff"
                    @click="openVpcDetails(v)">Details</button>
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
        <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
          <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="openDynamoCreate">+ Create Table</button>
        </div>
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
                  <button class="btn sm" @click="openDynamoInfo(t)">ℹ Info</button>
                  <button class="btn sm" @click="openDynamoBrowse(t)">Browse</button>
                  <button class="btn sm" @click="openConfig('dynamodb', `DynamoDB: ${t.name}`, t, { table: t.name })">Config</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ RDS ═══════════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'rds'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredRds.length" class="empty-row">{{ search.rds ? 'No matches.' : 'No RDS instances found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('id')"            @click="sortBy('id')">Instance <span class="sort-icon">{{ sortIcon('id') }}</span></th>
            <th :class="thClass('engine')"        @click="sortBy('engine')">Engine <span class="sort-icon">{{ sortIcon('engine') }}</span></th>
            <th :class="thClass('class')"         @click="sortBy('class')">Class <span class="sort-icon">{{ sortIcon('class') }}</span></th>
            <th :class="thClass('status')"        @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('endpoint')"      @click="sortBy('endpoint')">Endpoint <span class="sort-icon">{{ sortIcon('endpoint') }}</span></th>
            <th :class="thClass('az')"            @click="sortBy('az')">AZ <span class="sort-icon">{{ sortIcon('az') }}</span></th>
            <th :class="thClass('storageGb')"     @click="sortBy('storageGb')">Storage <span class="sort-icon">{{ sortIcon('storageGb') }}</span></th>
            <th :class="thClass('createdAt')"     @click="sortBy('createdAt')">Created <span class="sort-icon">{{ sortIcon('createdAt') }}</span></th>
            <th>Actions</th>
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
                  <button class="btn sm" @click="openRdsInfo(db)">ℹ Info</button>
                  <button class="btn sm" @click="openConfig('rds', `RDS: ${db.id}`, db, { id: db.id })">Config</button>
                  <button class="btn sm" @click="openRdsConnect(db)">Connect</button>
                  <button class="btn sm" @click="openRdsResetPwd(db)">Reset Pwd</button>
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
                  <button class="btn sm" @click="openGlueInfo(j)">ℹ Info</button>
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
      <div v-show="activeTab === 'athena'" class="tab-panel" style="flex-direction:column;gap:0;overflow:hidden">

        <!-- ── Sub-nav ──────────────────────────────────────────────────── -->
        <div style="display:flex;align-items:center;gap:0;border-bottom:1px solid var(--border);padding:0 10px;flex-shrink:0;background:var(--bg-panel,inherit)">
          <button v-for="t in athenaSubTabs" :key="t.id"
            :class="['aws-tab-btn', { active: athenaSubTab === t.id }]"
            style="margin-right:4px"
            @click="athenaSubTab = t.id">{{ t.label }}</button>
          <div style="flex:1"/>
          <input v-if="athenaSubTab !== 'editor'"
            v-model="search.athena" type="text"
            placeholder="Search…" class="search-input"
            style="width:180px;font-size:12px;margin:4px 0" />
          <button class="btn sm" style="margin:4px 0 4px 6px" @click="reloadActiveTab" title="Reload">↺</button>
          <button v-if="athenaSubTab !== 'editor'" class="btn sm"
            style="margin:4px 0 4px 6px;background:rgba(88,166,255,.15);border-color:#58a6ff;color:#58a6ff"
            @click="athenaSubTab = 'editor'">⚡ Query Editor</button>
        </div>

        <!-- ── Workgroups sub-tab ──────────────────────────────────────── -->
        <div v-show="athenaSubTab === 'workgroups'" style="flex:1;overflow:auto">
          <div v-if="awsStore.loading" class="empty-row">Loading...</div>
          <div v-else-if="!filteredAthena.length" class="empty-row">
            {{ search.athena ? 'No matches.' : 'No Athena workgroups found.' }}
          </div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th :class="thClass('name')"          @click="sortBy('name')">Workgroup <span class="sort-icon">{{ sortIcon('name') }}</span></th>
              <th :class="thClass('state')"         @click="sortBy('state')">State <span class="sort-icon">{{ sortIcon('state') }}</span></th>
              <th>Engine Version</th>
              <th>Output Location</th>
              <th :class="thClass('bytesScanned')"  @click="sortBy('bytesScanned')">Bytes Scanned <span class="sort-icon">{{ sortIcon('bytesScanned') }}</span></th>
              <th :class="thClass('queriesRun')"    @click="sortBy('queriesRun')">Queries Run <span class="sort-icon">{{ sortIcon('queriesRun') }}</span></th>
              <th>Description</th>
              <th>Actions</th>
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
                    <button class="btn sm" @click="openAthenaWgInfo(wg)" title="Configuration details">ℹ Config</button>
                    <button class="btn sm" @click="openAthenaWgQuery(wg)" title="Run a query with this workgroup">▶ Query</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ── Data Sources sub-tab ───────────────────────────────────── -->
        <div v-show="athenaSubTab === 'datasources'" style="flex:1;overflow:auto">
          <div v-if="athenaEditor.catalogsLoading" class="empty-row">Loading...</div>
          <div v-else-if="!athenaEditor.catalogs.length" class="empty-row">No data sources found.</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>Catalog / Data Source</th>
              <th>Type</th>
              <th>Description</th>
              <th>Databases</th>
              <th>Actions</th>
            </tr></thead>
            <tbody>
              <template v-for="cat in athenaEditor.catalogs" :key="cat.name">
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
                      <button class="btn sm" @click.stop="openAthenaCatalogInfo(cat)" title="Catalog details">ℹ Info</button>
                      <button class="btn sm" @click.stop="athenaSubTab = 'editor'; athenaEditor.selectedCatalog = cat.name" title="Open in Query Editor">⚡ Editor</button>
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
                    <td class="text-dim" style="font-size:11px">Database</td>
                    <td class="text-dim" style="font-size:11px">{{ db.description || '—' }}</td>
                    <td class="text-dim" style="font-size:11px">{{ db.tables?.length ?? '—' }} tables loaded</td>
                    <td>
                      <div class="action-group">
                        <button class="btn sm" @click="athenaSubTab = 'editor'; selectAthenaDb(cat, db)" title="Query this database">⚡ Editor</button>
                        <button class="btn sm" @click="loadAthenaDatabaseTables(cat, db)" :disabled="db._loadingTables" title="Load tables">{{ db._loadingTables ? '...' : '⊞ Tables' }}</button>
                      </div>
                    </td>
                  </tr>
                </template>
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
              <button class="btn sm" @click="loadAthenaCatalogs" :disabled="athenaEditor.catalogsLoading" title="Refresh">↺</button>
            </div>
            <div v-if="athenaEditor.catalogsLoading" class="empty-row" style="font-size:11px">Loading...</div>
            <div v-else-if="!athenaEditor.catalogs.length" class="empty-row" style="font-size:11px">No catalogs found.</div>
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
                      <div v-if="db._loadingTables" class="tree-loading">Loading tables...</div>
                      <div v-else-if="!(db.tables || []).length" class="tree-loading">No tables</div>
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
              <div style="flex:1"></div>
              <button class="btn sm" @click="loadAthenaHistory" title="Query history">📋 History</button>
              <button class="btn" style="background:rgba(34,197,94,.2);border-color:#22c55e;color:#22c55e;font-size:12px"
                @click="runAthenaEditorQuery" :disabled="athenaEditor.running || !athenaEditor.sql.trim()">
                {{ athenaEditor.running ? '⏳ Running…' : '▶ Run' }}
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
              <span v-if="athenaEditor.running" class="status-warn">Running…</span>
              <span v-else-if="athenaEditor.status === 'SUCCEEDED'" class="status-ok">✓ Succeeded</span>
              <span v-else-if="athenaEditor.status === 'FAILED'" class="status-err">✗ Failed</span>
              <span v-else-if="athenaEditor.status === 'CANCELLED'" class="status-err">✗ Cancelled</span>
              <span v-if="athenaEditor.queryId" class="text-dim mono-xs">ID: {{ athenaEditor.queryId }}</span>
              <span v-if="athenaEditor.execTimeMs" class="text-dim" style="font-size:11px">{{ (athenaEditor.execTimeMs/1000).toFixed(1) }}s · {{ athenaEditor.bytesScanned ? formatBytes(athenaEditor.bytesScanned) + ' scanned' : '' }}</span>
              <span v-if="athenaEditor.error" class="status-err" style="font-size:11px">{{ athenaEditor.error }}</span>
            </div>

            <!-- Results -->
            <div class="athena-results" v-if="athenaEditor.results">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;flex-shrink:0;font-size:11px;color:var(--text-dim)">
                <span>{{ (athenaEditor.results.Rows || []).length - 1 }} rows</span>
                <button class="btn sm" @click="exportAthenaResults">⬇ Export CSV</button>
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
                <span style="font-size:12px;font-weight:600">Recent Queries</span>
                <button class="btn sm" @click="athenaEditor.showHistory = false">✕</button>
              </div>
              <div v-if="athenaEditor.historyLoading" class="empty-row">Loading...</div>
              <div v-else-if="!athenaEditor.history.length" class="empty-row" style="font-size:12px">No history found.</div>
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

      <!-- ══ Bedrock ═══════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'bedrock'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredBedrock.length" class="empty-row">{{ search.bedrock ? 'No matches.' : 'No Bedrock foundation models found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('modelName')"        @click="sortBy('modelName')">Model <span class="sort-icon">{{ sortIcon('modelName') }}</span></th>
            <th :class="thClass('providerName')"     @click="sortBy('providerName')">Provider <span class="sort-icon">{{ sortIcon('providerName') }}</span></th>
            <th :class="thClass('inputModalities')"  @click="sortBy('inputModalities')">Input</th>
            <th :class="thClass('outputModalities')" @click="sortBy('outputModalities')">Output</th>
            <th :class="thClass('responseStreamingSupported')" @click="sortBy('responseStreamingSupported')">Streaming</th>
            <th :class="thClass('lifecycleStatus')"  @click="sortBy('lifecycleStatus')">Lifecycle <span class="sort-icon">{{ sortIcon('lifecycleStatus') }}</span></th>
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
              <td><span :class="m.responseStreamingSupported ? 'status-ok' : 'text-dim'">{{ m.responseStreamingSupported ? 'Yes' : 'No' }}</span></td>
              <td><span :class="m.lifecycleStatus === 'ACTIVE' ? 'status-ok' : 'status-warn'">{{ m.lifecycleStatus || '-' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ Amazon Lex ════════════════════════════════════════════════════ -->
      <div v-show="activeTab === 'lex'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredLex.length" class="empty-row">{{ search.lex ? 'No matches.' : 'No Lex bots found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"         @click="sortBy('name')">Bot <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('status')"       @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('latestVersion')" @click="sortBy('latestVersion')">Latest Version</th>
            <th :class="thClass('updatedDate')"  @click="sortBy('updatedDate')">Updated <span class="sort-icon">{{ sortIcon('updatedDate') }}</span></th>
            <th>Role ARN</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="b in sortRows(filteredLex)" :key="b.id">
              <td>
                <div>{{ b.name }}</div>
                <div class="text-dim mono-xs">{{ b.id }}</div>
                <div v-if="b.description" class="text-dim" style="font-size:11px">{{ b.description }}</div>
              </td>
              <td><span :class="b.status === 'Available' ? 'status-ok' : 'status-warn'">{{ b.status || '-' }}</span></td>
              <td class="text-dim">{{ b.latestVersion || '-' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ b.updatedDate ? formatDate(b.updatedDate) : '-' }}</td>
              <td class="text-dim mono-xs" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="b.roleArn">{{ b.roleArn || '-' }}</td>
              <td style="white-space:nowrap">
                <button class="btn xs" style="background:rgba(139,92,246,.18);border-color:#8b5cf6;color:#8b5cf6;margin-right:4px" @click="openLexIntents(b)" title="Intents & Slots">Intents</button>
                <button class="btn xs" style="background:rgba(59,130,246,.18);border-color:#3b82f6;color:#3b82f6;margin-right:4px" @click="openLexLogs(b)" title="Invocation Logs">Logs</button>
                <button class="btn xs" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e;margin-right:4px" @click="openLexTestSet(b)" title="Test Sets">Test Set</button>
                <button class="btn xs" style="background:rgba(245,158,11,.18);border-color:#f59e0b;color:#f59e0b;margin-right:4px" @click="openLexChat(b)" title="Chat Simulator">Chat</button>
                <button class="btn xs" style="background:rgba(239,68,68,.18);border-color:#ef4444;color:#ef4444;margin-right:4px" @click="openLexMissed(b)" title="Missed Utterances">Missed</button>
                <button class="btn xs" style="background:rgba(20,184,166,.18);border-color:#14b8a6;color:#14b8a6;margin-right:4px" @click="openLexAliases(b)" title="Bot Aliases">Aliases</button>
                <button class="btn xs" style="background:rgba(168,85,247,.18);border-color:#a855f7;color:#a855f7;margin-right:4px" @click="openLexSlotTypes(b)" title="Slot Types">Slot Types</button>
                <button class="btn xs" style="background:rgba(99,102,241,.18);border-color:#6366f1;color:#6366f1" @click="openLexMetrics(b)" title="Runtime Metrics">Metrics</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ══ AgentCore CloudFormation ══════════════════════════════════════ -->
      <div v-show="activeTab === 'agentcorecfn'" class="tab-panel">
        <div v-if="awsStore.loading" class="empty-row">Loading...</div>
        <div v-else-if="!filteredAgentCoreCfn.length" class="empty-row">{{ search.agentcorecfn ? 'No matches.' : 'No AgentCore CloudFormation stacks found.' }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th :class="thClass('name')"        @click="sortBy('name')">Stack <span class="sort-icon">{{ sortIcon('name') }}</span></th>
            <th :class="thClass('status')"      @click="sortBy('status')">Status <span class="sort-icon">{{ sortIcon('status') }}</span></th>
            <th :class="thClass('createdTime')" @click="sortBy('createdTime')">Created <span class="sort-icon">{{ sortIcon('createdTime') }}</span></th>
            <th :class="thClass('updatedTime')" @click="sortBy('updatedTime')">Updated <span class="sort-icon">{{ sortIcon('updatedTime') }}</span></th>
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
                  <button class="btn sm" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="openSiteUrl('https://' + (d.aliases?.[0] || d.domainName))" title="Open site">Visit Site</button>
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
              <!-- ── Groups tab ──────────────────────────────── -->
              <div v-show="cognitoState.innerTab === 'groups'" style="flex:1;overflow:auto;padding:8px">
                <div v-if="cognitoState.loadingGroups" class="empty-row">Loading groups...</div>
                <div v-else-if="!cognitoState.groups.length" class="empty-row">No groups in this user pool.</div>
                <table v-else class="cloud-table">
                  <thead><tr>
                    <th>Group Name</th><th>Description</th><th>Precedence</th><th>Role ARN</th><th>Last Modified</th>
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

    <!-- ── Create S3 Bucket Modal ─────────────────────────────────────────── -->
    <div v-if="createS3Modal.open" class="modal-overlay" @click.self="createS3Modal.open = false">
      <div class="modal" style="width:480px;max-width:95vw">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Create S3 Bucket</span>
          <button class="btn sm" @click="createS3Modal.open = false">✕</button>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Bucket Name <span style="color:#f85149">*</span></label>
            <input v-model="createS3Modal.name" type="text" placeholder="my-bucket-name"
              style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:13px;box-sizing:border-box" />
            <div style="font-size:11px;color:var(--text-dim);margin-top:3px">3-63 chars · lowercase · letters, numbers, hyphens, dots</div>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Region</label>
            <select v-model="createS3Modal.region"
              style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:13px">
              <option value="us-east-1">us-east-1 (N. Virginia)</option>
              <option value="us-east-2">us-east-2 (Ohio)</option>
              <option value="us-west-1">us-west-1 (N. California)</option>
              <option value="us-west-2">us-west-2 (Oregon)</option>
              <option value="eu-west-1">eu-west-1 (Ireland)</option>
              <option value="eu-west-2">eu-west-2 (London)</option>
              <option value="eu-west-3">eu-west-3 (Paris)</option>
              <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
              <option value="eu-north-1">eu-north-1 (Stockholm)</option>
              <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
              <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
              <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
              <option value="ap-northeast-2">ap-northeast-2 (Seoul)</option>
              <option value="ap-south-1">ap-south-1 (Mumbai)</option>
              <option value="sa-east-1">sa-east-1 (São Paulo)</option>
              <option value="ca-central-1">ca-central-1 (Canada)</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="s3BlockPublic" v-model="createS3Modal.blockPublicAccess" />
            <label for="s3BlockPublic" style="font-size:12px;cursor:pointer">Block all public access <span style="color:var(--text-dim)">(recommended)</span></label>
          </div>
          <div v-if="createS3Modal.error" class="alert-error" style="margin:0">{{ createS3Modal.error }}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
            <button class="btn sm" @click="createS3Modal.open = false">Cancel</button>
            <button class="btn sm" :disabled="createS3Modal.loading || !createS3Modal.name.trim()"
              style="background:rgba(80,200,120,.2);border-color:#50c878;color:#50c878"
              @click="doCreateS3Bucket">{{ createS3Modal.loading ? 'Creating...' : 'Create Bucket' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── VPC Details Modal ──────────────────────────────────────────────── -->
    <div v-if="vpcDetailModal.open" class="modal-overlay" @click.self="vpcDetailModal.open = false">
      <div class="modal" style="width:1020px;max-width:97vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">VPC Details — {{ vpcDetailModal.name }}</span>
          <button class="btn sm" @click="vpcDetailModal.open = false">✕</button>
        </div>
        <div v-if="vpcDetailModal.loading" class="empty-row" style="padding:20px">Loading details...</div>
        <div v-else-if="vpcDetailModal.error" class="alert-error" style="margin:8px">{{ vpcDetailModal.error }}</div>
        <template v-else-if="vpcDetailModal.data">
          <!-- inner tab bar -->
          <div style="display:flex;gap:2px;padding:4px 8px;border-bottom:1px solid var(--border);flex-shrink:0">
            <button v-for="t in vpcDetailTabs" :key="t.id"
              :class="['btn','sm', vpcDetailModal.tab === t.id ? 'active' : '']"
              @click="vpcDetailModal.tab = t.id">{{ t.label }}</button>
          </div>
          <div style="flex:1;overflow:auto;padding:8px">
            <!-- Overview -->
            <div v-if="vpcDetailModal.tab === 'overview'">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="config-section">
                  <div class="config-title">VPC Info</div>
                  <div class="config-row"><span>VPC ID</span><span class="mono-xs">{{ vpcDetailModal.data.vpc?.VpcId }}</span></div>
                  <div class="config-row"><span>CIDR</span><span class="mono-xs">{{ vpcDetailModal.data.vpc?.CidrBlock }}</span></div>
                  <div class="config-row"><span>State</span><span :class="vpcDetailModal.data.vpc?.State === 'available' ? 'status-ok' : 'status-warn'">{{ vpcDetailModal.data.vpc?.State }}</span></div>
                  <div class="config-row"><span>Default</span><span :class="vpcDetailModal.data.vpc?.IsDefault ? 'status-warn' : 'text-dim'">{{ vpcDetailModal.data.vpc?.IsDefault ? 'Yes' : 'No' }}</span></div>
                  <div class="config-row"><span>Tenancy</span><span class="text-dim">{{ vpcDetailModal.data.vpc?.InstanceTenancy }}</span></div>
                  <div class="config-row"><span>DHCPOptionsId</span><span class="mono-xs text-dim">{{ vpcDetailModal.data.vpc?.DhcpOptionsId }}</span></div>
                </div>
                <div class="config-section">
                  <div class="config-title">Summary</div>
                  <div class="config-row"><span>Subnets</span><span style="font-weight:600">{{ vpcDetailModal.data.subnets?.length ?? 0 }}</span></div>
                  <div class="config-row"><span>Security Groups</span><span style="font-weight:600">{{ vpcDetailModal.data.securityGroups?.length ?? 0 }}</span></div>
                  <div class="config-row"><span>Route Tables</span><span style="font-weight:600">{{ vpcDetailModal.data.routeTables?.length ?? 0 }}</span></div>
                  <div class="config-row"><span>Internet Gateways</span><span style="font-weight:600">{{ vpcDetailModal.data.internetGateways?.length ?? 0 }}</span></div>
                  <div class="config-row"><span>NAT Gateways</span><span style="font-weight:600">{{ vpcDetailModal.data.natGateways?.length ?? 0 }}</span></div>
                </div>
              </div>
              <div class="config-section" style="margin-top:12px" v-if="vpcDetailModal.data.vpc?.Tags?.length">
                <div class="config-title">Tags</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                  <span v-for="t in vpcDetailModal.data.vpc.Tags" :key="t.Key" class="tag-chip">{{ t.Key }}={{ t.Value }}</span>
                </div>
              </div>
            </div>
            <!-- Subnets -->
            <div v-else-if="vpcDetailModal.tab === 'subnets'">
              <div v-if="!vpcDetailModal.data.subnets?.length" class="empty-row">No subnets.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Subnet ID</th><th>CIDR</th><th>AZ</th><th>State</th><th>Public IP</th><th>Available IPs</th></tr></thead>
                <tbody>
                  <tr v-for="s in vpcDetailModal.data.subnets" :key="s.SubnetId">
                    <td class="mono-xs">{{ s.SubnetId }}</td>
                    <td class="text-dim">{{ s.CidrBlock }}</td>
                    <td class="text-dim">{{ s.AvailabilityZone }}</td>
                    <td><span :class="s.State === 'available' ? 'status-ok' : 'status-warn'">{{ s.State }}</span></td>
                    <td><span :class="s.MapPublicIpOnLaunch ? 'status-warn' : 'text-dim'">{{ s.MapPublicIpOnLaunch ? 'Yes' : 'No' }}</span></td>
                    <td class="text-dim">{{ s.AvailableIpAddressCount }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- Security Groups -->
            <div v-else-if="vpcDetailModal.tab === 'sgs'">
              <div v-if="!vpcDetailModal.data.securityGroups?.length" class="empty-row">No security groups.</div>
              <div v-else style="display:flex;flex-direction:column;gap:10px">
                <div v-for="sg in vpcDetailModal.data.securityGroups" :key="sg.GroupId"
                  class="config-section">
                  <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                    <span style="font-weight:600">{{ sg.GroupName }}</span>
                    <span class="mono-xs text-dim">{{ sg.GroupId }}</span>
                    <span class="text-dim" style="font-size:11px">{{ sg.Description }}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">Inbound Rules ({{ sg.IpPermissions?.length ?? 0 }})</div>
                  <table class="cloud-table" style="font-size:11px">
                    <thead><tr><th>Protocol</th><th>Port</th><th>Source</th></tr></thead>
                    <tbody>
                      <tr v-for="(rule, i) in (sg.IpPermissions || [])" :key="i">
                        <td>{{ rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol }}</td>
                        <td>{{ rule.FromPort != null ? (rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`) : '*' }}</td>
                        <td>{{ (rule.IpRanges||[]).map(r=>r.CidrIp).concat((rule.Ipv6Ranges||[]).map(r=>r.CidrIpv6)).join(', ') || (rule.UserIdGroupPairs||[]).map(p=>p.GroupId).join(', ') || '*' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <!-- Route Tables -->
            <div v-else-if="vpcDetailModal.tab === 'routes'">
              <div v-if="!vpcDetailModal.data.routeTables?.length" class="empty-row">No route tables.</div>
              <div v-else style="display:flex;flex-direction:column;gap:10px">
                <div v-for="rt in vpcDetailModal.data.routeTables" :key="rt.RouteTableId" class="config-section">
                  <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                    <span class="mono-xs" style="font-weight:600">{{ rt.RouteTableId }}</span>
                    <span v-if="rt.Associations?.some(a => a.Main)" style="font-size:11px;padding:1px 6px;border-radius:3px;background:rgba(124,158,248,.15);color:var(--accent)">Main</span>
                    <span class="text-dim" style="font-size:11px">{{ (rt.Tags||[]).find(t=>t.Key==='Name')?.Value || '' }}</span>
                  </div>
                  <table class="cloud-table" style="font-size:11px">
                    <thead><tr><th>Destination</th><th>Target</th><th>State</th></tr></thead>
                    <tbody>
                      <tr v-for="(r, i) in (rt.Routes || [])" :key="i">
                        <td class="mono-xs">{{ r.DestinationCidrBlock || r.DestinationIpv6CidrBlock || r.DestinationPrefixListId }}</td>
                        <td class="mono-xs text-dim">{{ r.GatewayId || r.NatGatewayId || r.TransitGatewayId || r.InstanceId || 'local' }}</td>
                        <td><span :class="r.State === 'active' ? 'status-ok' : 'status-warn'">{{ r.State }}</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <!-- IGWs -->
            <div v-else-if="vpcDetailModal.tab === 'igws'">
              <div v-if="!vpcDetailModal.data.internetGateways?.length" class="empty-row">No internet gateways attached.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>Gateway ID</th><th>State</th><th>Name</th></tr></thead>
                <tbody>
                  <tr v-for="igw in vpcDetailModal.data.internetGateways" :key="igw.InternetGatewayId">
                    <td class="mono-xs">{{ igw.InternetGatewayId }}</td>
                    <td><span :class="igw.Attachments?.[0]?.State === 'available' ? 'status-ok' : 'status-warn'">{{ igw.Attachments?.[0]?.State || '-' }}</span></td>
                    <td class="text-dim">{{ (igw.Tags||[]).find(t=>t.Key==='Name')?.Value || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- NAT Gateways -->
            <div v-else-if="vpcDetailModal.tab === 'nats'">
              <div v-if="!vpcDetailModal.data.natGateways?.length" class="empty-row">No NAT gateways.</div>
              <table v-else class="cloud-table">
                <thead><tr><th>NAT ID</th><th>Subnet</th><th>Public IP</th><th>Private IP</th><th>State</th></tr></thead>
                <tbody>
                  <tr v-for="nat in vpcDetailModal.data.natGateways" :key="nat.NatGatewayId">
                    <td class="mono-xs">{{ nat.NatGatewayId }}</td>
                    <td class="mono-xs text-dim">{{ nat.SubnetId }}</td>
                    <td class="text-dim">{{ nat.NatGatewayAddresses?.[0]?.PublicIp || '-' }}</td>
                    <td class="text-dim">{{ nat.NatGatewayAddresses?.[0]?.PrivateIp || '-' }}</td>
                    <td><span :class="nat.State === 'available' ? 'status-ok' : 'status-warn'">{{ nat.State }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ── ECR Deploy to K8s Modal ────────────────────────────────────────── -->
    <div v-if="ecrDeployModal.open" class="modal-overlay" @click.self="ecrDeployModal.open = false">
      <div class="modal" style="width:760px;max-width:97vw;max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Deploy to Kubernetes — {{ ecrDeployModal.repoName }}</span>
          <button class="btn sm" @click="ecrDeployModal.open = false">✕</button>
        </div>
        <div style="padding:12px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px">
          <!-- Image tag selector -->
          <div>
            <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Image Tag</label>
            <div v-if="ecrDeployModal.loadingImages" style="font-size:12px;color:var(--text-dim)">Loading images...</div>
            <select v-else v-model="ecrDeployModal.selectedTag"
              style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:13px">
              <option value="">-- select a tag --</option>
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
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">App Name <span style="color:#f85149">*</span></label>
              <input v-model="ecrDeployModal.appName" type="text" placeholder="my-app"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Namespace</label>
              <input v-model="ecrDeployModal.namespace" type="text" placeholder="default"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Replicas</label>
              <input v-model.number="ecrDeployModal.replicas" type="number" min="1" max="20"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Container Port</label>
              <input v-model.number="ecrDeployModal.port" type="number" min="1" max="65535" placeholder="8080"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">K8s Context <span style="color:var(--text-dim)">(optional)</span></label>
              <input v-model="ecrDeployModal.context" type="text" placeholder="use current context"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Image Pull Secret <span style="color:var(--text-dim)">(optional)</span></label>
              <input v-model="ecrDeployModal.pullSecret" type="text" placeholder="ecr-secret"
                style="width:100%;background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box" />
            </div>
          </div>
          <!-- Service creation option -->
          <div style="display:flex;align-items:center;gap:12px;padding:8px 10px;background:rgba(88,166,255,.06);border:1px solid rgba(88,166,255,.2);border-radius:6px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text,#ccc);user-select:none">
              <input type="checkbox" v-model="ecrDeployModal.createService" style="cursor:pointer" />
              También crear un <strong>Service</strong>
            </label>
            <template v-if="ecrDeployModal.createService">
              <span style="font-size:12px;color:var(--text-dim)">Tipo:</span>
              <select v-model="ecrDeployModal.serviceType"
                style="background:var(--bg-input,#1e1e1e);color:var(--text,#ccc);border:1px solid var(--border,#444);border-radius:4px;padding:4px 8px;font-size:12px">
                <option>ClusterIP</option>
                <option>NodePort</option>
                <option>LoadBalancer</option>
              </select>
              <span v-if="!ecrDeployModal.port" style="font-size:11px;color:#f85149">⚠ Requiere un Container Port</span>
            </template>
          </div>
          <!-- YAML Preview -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label style="font-size:12px;color:var(--text-dim)">Generated Manifest</label>
              <button class="btn sm" @click="copyEcrManifest">Copy YAML</button>
            </div>
            <pre style="background:var(--bg-input,#161b22);border:1px solid var(--border,#444);border-radius:4px;padding:10px;font-size:11px;overflow:auto;max-height:220px;margin:0;white-space:pre;color:var(--text,#ccc)">{{ ecrDeployYaml }}</pre>
          </div>
          <!-- Apply result -->
          <div v-if="ecrDeployModal.applyResult" :class="ecrDeployModal.applyResult.success ? 'alert-success' : 'alert-error'" style="margin:0;white-space:pre-wrap;font-size:11px;font-family:monospace">{{ ecrDeployModal.applyResult.stdout || ecrDeployModal.applyResult.stderr }}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
            <button class="btn sm" @click="ecrDeployModal.open = false">Close</button>
            <button class="btn sm" :disabled="!ecrDeployModal.appName || !ecrDeployModal.selectedTag || ecrDeployModal.applying"
              style="background:rgba(124,158,248,.2);border-color:#7c9ef8;color:#7c9ef8"
              @click="doApplyEcrToK8s">{{ ecrDeployModal.applying ? 'Applying...' : 'Apply to K8s' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Lex Intents & Slots Modal ──────────────────────────────────────── -->
    <div v-if="lexIntentsModal.open" class="modal-overlay" @click.self="lexIntentsModal.open = false">
      <div class="modal" style="width:920px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Intents & Slots — {{ lexIntentsModal.botName }}</span>
          <button class="btn sm" @click="lexIntentsModal.open = false">✕</button>
        </div>
        <div v-if="lexIntentsModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading intents...</div>
        <div v-else-if="lexIntentsModal.error" class="alert-error" style="margin:12px">{{ lexIntentsModal.error }}</div>
        <div v-else style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <!-- Locale tabs -->
          <div v-if="lexIntentsModal.locales.length > 1" style="display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--border);flex-shrink:0">
            <button v-for="loc in lexIntentsModal.locales" :key="loc.localeId"
              :class="['btn','xs', lexIntentsModal.activeLocale === loc.localeId ? 'active' : '']"
              @click="lexIntentsModal.activeLocale = loc.localeId; lexIntentsModal.activeIntent = null; lexIntentsModal.activeView = 'list'">
              {{ loc.localeName }} <span class="text-dim">({{ loc.intents.length }})</span>
            </button>
          </div>
          <!-- Inner tabs: List / Flow -->
          <div style="display:flex;gap:4px;padding:8px 12px 0;flex-shrink:0">
            <button :class="['btn','xs', lexIntentsModal.activeView === 'list' ? 'active' : '']"
              @click="lexIntentsModal.activeView = 'list'; lexIntentsModal.activeIntent = null">Intent List</button>
            <button :class="['btn','xs', lexIntentsModal.activeView === 'flow' ? 'active' : '']"
              @click="lexIntentsModal.activeView = 'flow'">Conversation Flow</button>
          </div>
          <div style="flex:1;overflow:auto;padding:12px">
            <!-- ── Intent List view ── -->
            <div v-if="lexIntentsModal.activeView === 'list'">
              <div v-if="!lexCurrentLocale || !lexCurrentLocale.intents.length" class="text-dim" style="padding:16px">No intents found for this locale.</div>
              <div v-else>
                <div v-for="intent in lexCurrentLocale.intents" :key="intent.id"
                  style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden">
                  <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;background:var(--surface)"
                    @click="lexIntentsModal.activeIntent = lexIntentsModal.activeIntent === intent.id ? null : intent.id">
                    <span style="font-weight:600;flex:1">{{ intent.name }}</span>
                    <span class="text-dim" style="font-size:11px">{{ intent.slots.length }} slot{{ intent.slots.length !== 1 ? 's' : '' }}</span>
                    <span class="text-dim" style="font-size:11px">{{ intent.sampleUtterances.length }} utterance{{ intent.sampleUtterances.length !== 1 ? 's' : '' }}</span>
                    <span style="font-size:11px;color:var(--text-dim)">{{ lexIntentsModal.activeIntent === intent.id ? '▲' : '▼' }}</span>
                  </div>
                  <div v-if="lexIntentsModal.activeIntent === intent.id" style="padding:12px;border-top:1px solid var(--border)">
                    <div v-if="intent.description" class="text-dim" style="font-size:12px;margin-bottom:8px">{{ intent.description }}</div>
                    <!-- Sample utterances -->
                    <div style="margin-bottom:12px">
                      <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Sample Utterances</div>
                      <div v-if="!intent.sampleUtterances.length" class="text-dim" style="font-size:12px">None defined.</div>
                      <div style="display:flex;flex-wrap:wrap;gap:4px">
                        <span v-for="(u, i) in intent.sampleUtterances" :key="i"
                          style="background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:12px;padding:2px 8px;font-size:11px">{{ u }}</span>
                      </div>
                    </div>
                    <!-- Slots table -->
                    <div>
                      <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Slots</div>
                      <div v-if="!intent.slots.length" class="text-dim" style="font-size:12px">No slots defined.</div>
                      <table v-else class="cloud-table" style="font-size:12px">
                        <thead><tr>
                          <th>Slot Name</th><th>Type</th><th>Required</th><th>Description</th>
                        </tr></thead>
                        <tbody>
                          <tr v-for="s in intent.slots" :key="s.id">
                            <td style="font-weight:600">{{ s.name }}</td>
                            <td class="mono-xs">{{ s.typeName || '-' }}</td>
                            <td><span :class="s.required ? 'status-ok' : 'status-warn'">{{ s.required ? 'Required' : 'Optional' }}</span></td>
                            <td class="text-dim">{{ s.description || '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <!-- ── Conversation Flow view ── -->
            <div v-if="lexIntentsModal.activeView === 'flow'">
              <div v-if="!lexCurrentLocale || !lexCurrentLocale.intents.length" class="text-dim" style="padding:16px">No intents to render flow.</div>
              <div v-else style="display:flex;flex-wrap:wrap;gap:16px">
                <div v-for="intent in lexCurrentLocale.intents" :key="intent.id"
                  style="border:1px solid rgba(139,92,246,.4);border-radius:8px;min-width:220px;max-width:300px;overflow:hidden;background:var(--surface)">
                  <!-- Intent header -->
                  <div style="background:rgba(139,92,246,.2);padding:8px 12px;border-bottom:1px solid rgba(139,92,246,.3)">
                    <div style="font-weight:600;font-size:13px">🎯 {{ intent.name }}</div>
                    <div v-if="intent.description" class="text-dim" style="font-size:11px">{{ intent.description }}</div>
                  </div>
                  <!-- Utterances (up to 3) -->
                  <div style="padding:8px 12px;border-bottom:1px solid var(--border)">
                    <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Triggers</div>
                    <div style="display:flex;flex-direction:column;gap:2px">
                      <div v-for="(u, i) in intent.sampleUtterances.slice(0,3)" :key="i"
                        style="font-size:11px;color:var(--text-dim);font-style:italic">"{{ u }}"</div>
                      <div v-if="intent.sampleUtterances.length > 3" class="text-dim" style="font-size:10px">+{{ intent.sampleUtterances.length - 3 }} more</div>
                    </div>
                  </div>
                  <!-- Slots flow -->
                  <div v-if="intent.slots.length" style="padding:8px 12px">
                    <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px">Slot Collection</div>
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
                  <div v-else style="padding:8px 12px;color:var(--text-dim);font-size:11px">No slots — immediate fulfillment</div>
                  <!-- Fulfillment -->
                  <div style="background:rgba(34,197,94,.1);padding:6px 12px;border-top:1px solid var(--border);font-size:11px;color:#22c55e;text-align:center">
                    ✓ Fulfillment
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Lex Invocation Logs Modal ────────────────────────────────────── -->
    <div v-if="lexLogsModal.open" class="modal-overlay" @click.self="lexLogsModal.open = false">
      <div class="modal" style="width:900px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-weight:600">Invocation Logs — {{ lexLogsModal.botName }}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <select v-model="lexLogsModal.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
              <option :value="1">Last 1h</option>
              <option :value="6">Last 6h</option>
              <option :value="24">Last 24h</option>
              <option :value="72">Last 3d</option>
              <option :value="168">Last 7d</option>
            </select>
            <button class="btn sm" @click="reloadLexLogs" :disabled="lexLogsModal.loading">{{ lexLogsModal.loading ? 'Loading...' : 'Refresh' }}</button>
            <button class="btn sm" @click="lexLogsModal.open = false">✕</button>
          </div>
        </div>
        <div v-if="lexLogsModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading logs...</div>
        <div v-else-if="lexLogsModal.error" class="alert-error" style="margin:12px">{{ lexLogsModal.error }}</div>
        <div v-else-if="!lexLogsModal.configured" style="padding:24px;text-align:center">
          <div style="font-size:32px;margin-bottom:8px">📋</div>
          <div style="font-weight:600;margin-bottom:4px">Conversation logs not configured</div>
          <div class="text-dim" style="font-size:12px">No CloudWatch log group found for this bot. Enable conversation logs in the bot's alias settings.</div>
        </div>
        <div v-else style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:6px 12px;font-size:11px;color:var(--text-dim);flex-shrink:0;border-bottom:1px solid var(--border)">
            Log group: <span class="mono-xs">{{ (lexLogsModal.groups || []).join(', ') }}</span>
            &nbsp;·&nbsp; {{ lexLogsModal.events.length }} events
          </div>
          <div v-if="!lexLogsModal.events.length" class="empty-row">No log events in this time range.</div>
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
    </div>

    <!-- ── Lex Test Set Modal ───────────────────────────────────────────── -->
    <div v-if="lexTestSetModal.open" class="modal-overlay" @click.self="lexTestSetModal.open = false">
      <div class="modal" style="width:900px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Test Sets — {{ lexTestSetModal.botName }}</span>
          <button class="btn sm" @click="lexTestSetModal.open = false">✕</button>
        </div>
        <!-- Inner tabs -->
        <div style="display:flex;gap:4px;padding:8px 12px 0;flex-shrink:0;border-bottom:1px solid var(--border)">
          <button :class="['btn','xs', lexTestSetModal.activeView === 'existing' ? 'active' : '']" @click="lexTestSetModal.activeView = 'existing'">Existing Test Sets</button>
          <button :class="['btn','xs', lexTestSetModal.activeView === 'generate' ? 'active' : '']" @click="lexTestSetModal.activeView = 'generate'">Generate from Intents</button>
        </div>
        <div v-if="lexTestSetModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading...</div>
        <div v-else-if="lexTestSetModal.error" class="alert-error" style="margin:12px">{{ lexTestSetModal.error }}</div>
        <div v-else style="flex:1;overflow:auto;padding:12px">
          <!-- Existing test sets -->
          <div v-if="lexTestSetModal.activeView === 'existing'">
            <div v-if="!lexTestSetModal.testSets.length" style="text-align:center;padding:32px;color:var(--text-dim)">
              <div style="font-size:28px;margin-bottom:8px">📂</div>
              <div>No test sets found for this account.</div>
              <div style="font-size:12px;margin-top:4px">Use the "Generate from Intents" tab to create one.</div>
            </div>
            <table v-else class="cloud-table">
              <thead><tr>
                <th>Name</th><th>Status</th><th>Turns</th><th>Modality</th><th>Last Updated</th>
              </tr></thead>
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
          <!-- Generate from intents -->
          <div v-if="lexTestSetModal.activeView === 'generate'">
            <div v-if="!lexTestSetModal.intentsLoaded" style="text-align:center;padding:24px">
              <button class="btn sm" style="background:rgba(139,92,246,.18);border-color:#8b5cf6;color:#8b5cf6"
                @click="lexLoadIntentsForTestSet" :disabled="lexTestSetModal.loadingIntents">
                {{ lexTestSetModal.loadingIntents ? 'Loading intents...' : 'Load Intents to Generate Tests' }}
              </button>
            </div>
            <div v-else>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                <span style="font-size:12px;color:var(--text-dim)">{{ lexTestSetModal.generatedCases.length }} test cases generated</span>
                <button class="btn xs" style="background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e" @click="downloadLexTestSetCsv">⬇ Download CSV</button>
                <button class="btn xs" style="background:rgba(59,130,246,.18);border-color:#3b82f6;color:#3b82f6" @click="downloadLexTestSetJson">⬇ Download JSON</button>
              </div>
              <table class="cloud-table" style="font-size:12px">
                <thead><tr>
                  <th>#</th><th>Intent</th><th>Utterance</th><th>Expected Slots</th>
                </tr></thead>
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

    <!-- ── Lex Chat Simulator Modal ────────────────────────────────────── -->
    <div v-if="lexChatModal.open" class="modal-overlay" @click.self="lexChatModal.open = false">
      <div class="modal" style="width:720px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-weight:600">Chat Simulator — {{ lexChatModal.botName }}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <select v-model="lexChatModal.aliasId" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
              <option value="TSTALIASID">DRAFT (TestBotAlias)</option>
              <option v-for="a in lexChatModal.aliases" :key="a.id" :value="a.id">{{ a.name }} ({{ a.botVersion }})</option>
            </select>
            <select v-model="lexChatModal.localeId" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
              <option v-if="!lexChatModal.locales.length" value="">Cargando...</option>
              <option v-for="loc in lexChatModal.locales" :key="loc.localeId" :value="loc.localeId">{{ loc.localeName || loc.localeId }}</option>
            </select>
            <button class="btn sm" @click="lexChatReset">↺ Reset</button>
            <button class="btn sm" @click="lexChatModal.open = false">✕</button>
          </div>
        </div>
        <!-- Conversation area -->
        <div ref="lexChatScrollRef" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:300px">
          <div v-if="!lexChatModal.messages.length" style="text-align:center;color:var(--text-dim);padding:40px 0;font-size:13px">
            Escribe un mensaje para iniciar la conversación con el bot
          </div>
          <div v-for="(msg, i) in lexChatModal.messages" :key="i"
            :style="`display:flex;flex-direction:column;align-items:${msg.role === 'user' ? 'flex-end' : 'flex-start'};gap:4px`">
            <div :style="`max-width:80%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;${msg.role === 'user' ? 'background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3)' : 'background:var(--surface);border:1px solid var(--border)'}`">
              {{ msg.role === 'user' ? msg.text : msg.content }}
            </div>
            <!-- Intent / confidence bubble -->
            <div v-if="msg.role === 'bot' && msg.intent" style="display:flex;gap:4px;flex-wrap:wrap">
              <span style="font-size:10px;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:10px;padding:1px 6px;color:#a78bfa">🎯 {{ msg.intent }}</span>
              <span v-if="msg.confidence != null" style="font-size:10px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:1px 6px;color:#4ade80">{{ (msg.confidence * 100).toFixed(0) }}%</span>
              <span v-for="(v, k) in msg.slots" :key="k" style="font-size:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:1px 6px;color:#fbbf24">{{ k }}: {{ v }}</span>
            </div>
            <!-- interpretations dropdown -->
            <details v-if="msg.role === 'bot' && msg.interpretations && msg.interpretations.length > 1" style="font-size:10px;color:var(--text-dim);margin-top:2px">
              <summary style="cursor:pointer">All interpretations</summary>
              <div v-for="int in msg.interpretations" :key="int.intent" style="padding:1px 4px">{{ int.intent }}: {{ int.confidence != null ? (int.confidence*100).toFixed(0)+'%' : '' }}</div>
            </details>
          </div>
          <div v-if="lexChatModal.sending" style="display:flex;align-items:flex-start;gap:4px">
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 12px;font-size:13px;color:var(--text-dim)">...</div>
          </div>
        </div>
        <!-- Input area -->
        <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:8px;flex-shrink:0">
          <input v-model="lexChatModal.input" type="text" placeholder="Escribe un mensaje..."
            style="flex:1;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text)"
            @keydown.enter="lexChatSend" :disabled="lexChatModal.sending" />
          <button class="btn sm" style="background:rgba(99,102,241,.2);border-color:#6366f1;color:#6366f1"
            @click="lexChatSend" :disabled="!lexChatModal.input.trim() || lexChatModal.sending">Send</button>
        </div>
      </div>
    </div>

    <!-- ── Lex Missed Utterances Modal ─────────────────────────────────── -->
    <div v-if="lexMissedModal.open" class="modal-overlay" @click.self="lexMissedModal.open = false">
      <div class="modal" style="width:860px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-weight:600">Missed Utterances — {{ lexMissedModal.botName }}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <select v-model="lexMissedModal.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
              <option :value="6">Last 6h</option>
              <option :value="24">Last 24h</option>
              <option :value="72">Last 3d</option>
              <option :value="168">Last 7d</option>
            </select>
            <button class="btn sm" @click="reloadLexMissed" :disabled="lexMissedModal.loading">{{ lexMissedModal.loading ? 'Loading...' : 'Refresh' }}</button>
            <button class="btn sm" @click="lexMissedModal.open = false">✕</button>
          </div>
        </div>
        <div v-if="lexMissedModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading...</div>
        <div v-else-if="lexMissedModal.error" class="alert-error" style="margin:12px">{{ lexMissedModal.error }}</div>
        <div v-else-if="!lexMissedModal.configured" style="padding:32px;text-align:center">
          <div style="font-size:28px;margin-bottom:8px">🔇</div>
          <div style="font-weight:600;margin-bottom:4px">Conversation logs not configured</div>
          <div class="text-dim" style="font-size:12px">Enable conversation logs in the bot's alias settings to track missed utterances.</div>
        </div>
        <div v-else style="flex:1;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:6px 12px;font-size:11px;color:var(--text-dim);border-bottom:1px solid var(--border);flex-shrink:0">
            <span class="mono-xs">{{ lexMissedModal.logGroupName }}</span> · {{ lexMissedModal.utterances.length }} missed utterance{{ lexMissedModal.utterances.length !== 1 ? 's' : '' }}
          </div>
          <div v-if="!lexMissedModal.utterances.length" class="empty-row">No missed utterances in this time range. 🎉</div>
          <div v-else style="flex:1;overflow:auto">
            <table class="cloud-table">
              <thead><tr>
                <th>Time</th><th>Utterance</th><th>Session</th><th>Locale</th>
              </tr></thead>
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
    </div>

    <!-- ── Lex Aliases Modal ────────────────────────────────────────────── -->
    <div v-if="lexAliasesModal.open" class="modal-overlay" @click.self="lexAliasesModal.open = false">
      <div class="modal" style="width:960px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <span style="font-weight:600">Bot Aliases — {{ lexAliasesModal.botName }}</span>
            <div v-if="lexAliasesModal.botArn" class="mono-xs text-dim" style="font-size:10px;margin-top:2px" :title="lexAliasesModal.botArn">
              Bot ARN: {{ lexAliasesModal.botArn }}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn sm" style="background:rgba(20,184,166,.15);border-color:#14b8a6;color:#14b8a6"
              @click="lexAliasesModal.showCreate = !lexAliasesModal.showCreate">
              {{ lexAliasesModal.showCreate ? '✕ Cancel' : '＋ New Alias' }}
            </button>
            <button class="btn sm" @click="lexAliasesModal.open = false">✕</button>
          </div>
        </div>

        <!-- Create alias form -->
        <div v-if="lexAliasesModal.showCreate" style="padding:14px 16px;border-bottom:1px solid var(--border);background:rgba(20,184,166,.05);flex-shrink:0">
          <div style="font-size:12px;font-weight:600;margin-bottom:10px;color:#2dd4bf">Create New Alias</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">Name *</label>
              <input v-model="lexAliasesModal.createForm.name" type="text" placeholder="my-alias"
                style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text)" />
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">Bot Version *</label>
              <input v-model="lexAliasesModal.createForm.botVersion" type="text" placeholder="1, 2, DRAFT…"
                style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text)" />
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">Description</label>
              <input v-model="lexAliasesModal.createForm.description" type="text" placeholder="Optional"
                style="width:100%;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text)" />
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn sm" style="background:rgba(20,184,166,.2);border-color:#14b8a6;color:#2dd4bf"
              :disabled="lexAliasesModal.creating || !lexAliasesModal.createForm.name || !lexAliasesModal.createForm.botVersion"
              @click="doCreateLexAlias">
              {{ lexAliasesModal.creating ? 'Creating...' : 'Create Alias' }}
            </button>
            <span v-if="lexAliasesModal.createError" style="font-size:12px;color:#f87171">{{ lexAliasesModal.createError }}</span>
          </div>
        </div>

        <div v-if="lexAliasesModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading aliases...</div>
        <div v-else-if="lexAliasesModal.error" class="alert-error" style="margin:12px">{{ lexAliasesModal.error }}</div>
        <div v-else style="flex:1;overflow:auto;padding:12px">
          <div v-if="!lexAliasesModal.aliases.length" class="text-dim" style="text-align:center;padding:32px">No aliases found.</div>
          <div v-for="alias in lexAliasesModal.aliases" :key="alias.id"
            style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
            <!-- Header row -->
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--surface)">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px">{{ alias.name }}</div>
                <div class="mono-xs text-dim" style="font-size:10px">ID: {{ alias.id }}</div>
                <div v-if="alias.arn" class="mono-xs text-dim" style="font-size:10px;word-break:break-all" :title="alias.arn">ARN: {{ alias.arn }}</div>
                <div v-if="alias.description" class="text-dim" style="font-size:11px;margin-top:2px">{{ alias.description }}</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                <span :class="alias.status === 'Available' ? 'status-ok' : 'status-warn'">{{ alias.status }}</span>
                <span style="font-size:11px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:1px 7px;color:#818cf8">
                  v{{ alias.botVersion }}
                </span>
              </div>
            </div>
            <!-- Details grid -->
            <div style="padding:10px 14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;border-top:1px solid var(--border)">
              <!-- Lambda -->
              <div>
                <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Fulfillment Lambdas</div>
                <div v-if="!alias.lambdaArns.length" class="text-dim" style="font-size:12px">None configured</div>
                <div v-for="l in alias.lambdaArns" :key="l.localeId" style="font-size:11px;margin-bottom:2px">
                  <span class="mono-xs" style="background:rgba(245,158,11,.1);border-radius:3px;padding:0 3px;color:#fbbf24">{{ l.localeId }}</span>
                  <span class="mono-xs text-dim" :title="l.arn" style="margin-left:4px">{{ l.arn.split(':').pop() }}</span>
                </div>
              </div>
              <!-- Conversation logs -->
              <div>
                <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Conversation Logs</div>
                <div style="display:flex;flex-direction:column;gap:3px">
                  <span v-if="alias.textLogs" style="font-size:11px;color:#4ade80">✓ Text logs</span>
                  <span v-else style="font-size:11px;color:var(--text-dim)">✗ Text logs</span>
                  <span v-if="alias.audioLogs" style="font-size:11px;color:#4ade80">✓ Audio logs</span>
                  <span v-else style="font-size:11px;color:var(--text-dim)">✗ Audio logs</span>
                  <span v-if="alias.logsGroup" class="mono-xs text-dim" style="font-size:10px" :title="alias.logsGroup">{{ alias.logsGroup.split(':').pop() }}</span>
                </div>
              </div>
              <!-- Dates -->
              <div>
                <div style="font-size:10px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Dates</div>
                <div v-if="alias.createdDate" style="font-size:11px;color:var(--text-dim)">Created: {{ new Date(alias.createdDate).toLocaleString() }}</div>
                <div v-if="alias.updatedDate" style="font-size:11px;color:var(--text-dim)">Updated: {{ new Date(alias.updatedDate).toLocaleString() }}</div>
              </div>
            </div>
            <!-- Actions -->
            <div style="padding:0 14px 10px;display:flex;gap:6px;border-top:1px solid var(--border);padding-top:8px">
              <button class="btn xs" style="background:rgba(245,158,11,.15);border-color:#f59e0b;color:#f59e0b"
                @click="openLexChatFromAlias(lexAliasesModal.bot, alias)">💬 Chat</button>
              <button class="btn xs" style="background:rgba(99,102,241,.15);border-color:#6366f1;color:#6366f1"
                @click="openLexBuildFromAlias(lexAliasesModal.bot, alias)">⚒ Build</button>
              <button class="btn xs" style="background:rgba(15,23,42,.3);border-color:var(--border);color:var(--text-dim)"
                :title="alias.arn || alias.id" @click="navigator.clipboard.writeText(alias.arn || alias.id)">📋 Copy ARN</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Lex Slot Types Modal ─────────────────────────────────────────── -->
    <div v-if="lexSlotTypesModal.open" class="modal-overlay" @click.self="lexSlotTypesModal.open = false">
      <div class="modal" style="width:860px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">Custom Slot Types — {{ lexSlotTypesModal.botName }}</span>
          <button class="btn sm" @click="lexSlotTypesModal.open = false">✕</button>
        </div>
        <div v-if="lexSlotTypesModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading slot types...</div>
        <div v-else-if="lexSlotTypesModal.error" class="alert-error" style="margin:12px">{{ lexSlotTypesModal.error }}</div>
        <div v-else style="flex:1;overflow:auto;padding:12px">
          <!-- Locale tabs -->
          <div v-if="lexSlotTypesModal.locales.length > 1" style="display:flex;gap:4px;margin-bottom:10px">
            <button v-for="loc in lexSlotTypesModal.locales" :key="loc.localeId"
              :class="['btn','xs', lexSlotTypesModal.activeLocale === loc.localeId ? 'active' : '']"
              @click="lexSlotTypesModal.activeLocale = loc.localeId">
              {{ loc.localeName }}
            </button>
          </div>
          <div v-for="locale in lexSlotTypesModal.locales.filter(l => l.localeId === lexSlotTypesModal.activeLocale)" :key="locale.localeId">
            <div v-if="!locale.types.length" class="text-dim" style="text-align:center;padding:32px">No custom slot types defined for this locale.</div>
            <div v-for="st in locale.types" :key="st.id"
              style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface)">
                <div style="flex:1">
                  <span style="font-weight:600">{{ st.name }}</span>
                  <span class="mono-xs text-dim" style="font-size:10px;margin-left:6px">{{ st.id }}</span>
                </div>
                <span style="font-size:11px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);border-radius:10px;padding:1px 7px;color:#c084fc">{{ st.strategy }}</span>
                <span class="text-dim" style="font-size:11px">{{ st.values.length }} value{{ st.values.length !== 1 ? 's' : '' }}</span>
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
          <div v-if="!lexSlotTypesModal.locales.length" class="text-dim" style="text-align:center;padding:32px">No custom slot types found.</div>
        </div>
      </div>
    </div>

    <!-- ── Lex Metrics Modal ────────────────────────────────────────────── -->
    <div v-if="lexMetricsModal.open" class="modal-overlay" @click.self="lexMetricsModal.open = false">
      <div class="modal" style="width:900px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-weight:600">Runtime Metrics — {{ lexMetricsModal.botName }}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <select v-model="lexMetricsModal.hours" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text)">
              <option :value="6">Last 6h</option>
              <option :value="24">Last 24h</option>
              <option :value="72">Last 3d</option>
              <option :value="168">Last 7d</option>
            </select>
            <button class="btn sm" @click="reloadLexMetrics" :disabled="lexMetricsModal.loading">{{ lexMetricsModal.loading ? 'Loading...' : 'Refresh' }}</button>
            <button class="btn sm" @click="lexMetricsModal.open = false">✕</button>
          </div>
        </div>
        <div v-if="lexMetricsModal.loading" style="padding:24px;text-align:center;color:var(--text-dim)">Loading metrics...</div>
        <div v-else-if="lexMetricsModal.error" class="alert-error" style="margin:12px">{{ lexMetricsModal.error }}</div>
        <div v-else style="flex:1;overflow:auto;padding:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <!-- Requests card -->
            <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
              <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Runtime Requests</div>
              <div v-if="!lexMetricsModal.metrics.RuntimeRequestCount?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">No data</div>
              <div v-else>
                <div style="font-size:28px;font-weight:700;margin-bottom:4px">{{ lexMetricsTotal('RuntimeRequestCount') }}</div>
                <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                  <div v-for="(p, i) in lexMetricsSparkline('RuntimeRequestCount')" :key="i"
                    :style="`flex:1;background:#6366f1;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`" :title="p+'%'"></div>
                </div>
              </div>
            </div>
            <!-- Missed utterances card -->
            <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
              <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Missed Utterances</div>
              <div v-if="!lexMetricsModal.metrics.MissedUtteranceCount?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">No data</div>
              <div v-else>
                <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#f87171">{{ lexMetricsTotal('MissedUtteranceCount') }}</div>
                <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                  <div v-for="(p, i) in lexMetricsSparkline('MissedUtteranceCount')" :key="i"
                    :style="`flex:1;background:#ef4444;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                </div>
              </div>
            </div>
            <!-- Latency card -->
            <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
              <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Avg Latency (ms)</div>
              <div v-if="!lexMetricsModal.metrics.RuntimeSuccessfulRequestLatency?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">No data</div>
              <div v-else>
                <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#4ade80">{{ lexMetricsAvg('RuntimeSuccessfulRequestLatency') }}ms</div>
                <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                  <div v-for="(p, i) in lexMetricsSparkline('RuntimeSuccessfulRequestLatency')" :key="i"
                    :style="`flex:1;background:#22c55e;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                </div>
              </div>
            </div>
            <!-- Polly errors card -->
            <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
              <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Polly TTS Errors</div>
              <div v-if="!lexMetricsModal.metrics.RuntimePollyErrors?.length" class="text-dim" style="text-align:center;padding:16px;font-size:12px">No data</div>
              <div v-else>
                <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#fb923c">{{ lexMetricsTotal('RuntimePollyErrors') }}</div>
                <div style="display:flex;align-items:flex-end;gap:2px;height:60px">
                  <div v-for="(p, i) in lexMetricsSparkline('RuntimePollyErrors')" :key="i"
                    :style="`flex:1;background:#f97316;border-radius:2px 2px 0 0;height:${p}%;opacity:.7;min-height:2px`"></div>
                </div>
              </div>
            </div>
          </div>
          <!-- Build section -->
          <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:12px">
            <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Build Bot</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <select v-model="lexMetricsModal.buildLocale" style="font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text)">
                <option v-for="loc in lexMetricsModal.locales" :key="loc.localeId" :value="loc.localeId">{{ loc.localeName || loc.localeId }}</option>
              </select>
              <button class="btn sm" style="background:rgba(99,102,241,.18);border-color:#6366f1;color:#6366f1"
                :disabled="lexMetricsModal.building || !lexMetricsModal.buildLocale"
                @click="doBuildLexBot">{{ lexMetricsModal.building ? 'Building...' : '⚒ Build' }}</button>
              <span v-if="lexMetricsModal.buildResult" :class="lexMetricsModal.buildResult.status === 'Built' ? 'status-ok' : 'status-err'">
                {{ lexMetricsModal.buildResult.status }}
                <span v-if="lexMetricsModal.buildResult.failureReasons?.length" class="text-dim" style="font-size:11px"> — {{ lexMetricsModal.buildResult.failureReasons.join('; ') }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

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

    <!-- ══ Athena Workgroup Config Modal ════════════════════════════════════ -->
    <div v-if="athenaWgInfo.open" class="modal-overlay" @click.self="athenaWgInfo.open = false">
      <div class="modal" style="width:660px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Athena Workgroup — {{ athenaWgInfo.wg?.name }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" style="background:rgba(34,197,94,.2);border-color:#22c55e;color:#22c55e" @click="athenaWgInfo.open=false; openAthenaWgQuery(athenaWgInfo.wg)">▶ Query</button>
            <button class="btn sm" @click="athenaWgInfo.open = false">Close</button>
          </div>
        </div>
        <div v-if="athenaWgInfo.loading" class="empty-row">Loading...</div>
        <div v-else-if="athenaWgInfo.error" class="alert-error">{{ athenaWgInfo.error }}</div>
        <div v-else-if="athenaWgInfo.data" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <!-- Status & engine -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            <div class="config-section">
              <div class="config-title">Estado</div>
              <span :class="athenaWgInfo.data.state === 'ENABLED' ? 'status-ok' : 'status-err'">{{ athenaWgInfo.data.state }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">Engine Version</div>
              <span class="text-dim">{{ athenaWgInfo.data.effectiveEngineVersion || athenaWgInfo.data.selectedEngineVersion || '—' }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">Creado</div>
              <span class="text-dim" style="font-size:11px">{{ athenaWgInfo.data.creationTime ? formatDate(athenaWgInfo.data.creationTime) : '—' }}</span>
            </div>
          </div>
          <!-- Stats -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="config-section">
              <div class="config-title">Estadísticas de Uso</div>
              <div class="config-row"><span>Total Queries</span><span class="mono-xs">{{ (athenaWgInfo.data.totalQueryCount || 0).toLocaleString() }}</span></div>
              <div class="config-row"><span>Total Bytes Escaneados</span><span class="mono-xs">{{ athenaWgInfo.data.totalBytesScanned ? formatBytes(athenaWgInfo.data.totalBytesScanned) : '—' }}</span></div>
            </div>
            <div class="config-section">
              <div class="config-title">Límites</div>
              <div class="config-row"><span>Bytes Scanned Cutoff</span><span class="mono-xs">{{ athenaWgInfo.data.bytesScannedCutoff ? formatBytes(athenaWgInfo.data.bytesScannedCutoff) : 'Sin límite' }}</span></div>
              <div class="config-row"><span>Requester Pays</span><span :class="athenaWgInfo.data.requesterPays ? 'status-warn' : 'text-dim'">{{ athenaWgInfo.data.requesterPays ? 'Sí' : 'No' }}</span></div>
            </div>
          </div>
          <!-- Output / Encryption -->
          <div class="config-section">
            <div class="config-title">Resultados & Cifrado</div>
            <div class="config-row"><span>Output Location (S3)</span><span class="mono-xs" style="font-size:11px;word-break:break-all">{{ athenaWgInfo.data.outputLocation || '—' }}</span></div>
            <div class="config-row"><span>Encryption</span><span class="mono-xs">{{ athenaWgInfo.data.encryptionOption || 'SSE_S3 (default)' }}</span></div>
            <div v-if="athenaWgInfo.data.kmsKey" class="config-row"><span>KMS Key</span><span class="mono-xs" style="font-size:10px;word-break:break-all">{{ athenaWgInfo.data.kmsKey }}</span></div>
          </div>
          <!-- Policies -->
          <div class="config-section">
            <div class="config-title">Políticas</div>
            <div class="config-row"><span>Enforce Workgroup Config</span><span :class="athenaWgInfo.data.enforceWorkGroupConfig ? 'status-ok' : 'text-dim'">{{ athenaWgInfo.data.enforceWorkGroupConfig ? 'Sí' : 'No' }}</span></div>
            <div class="config-row"><span>Publish CloudWatch Metrics</span><span :class="athenaWgInfo.data.publishCloudWatchMetrics ? 'status-ok' : 'text-dim'">{{ athenaWgInfo.data.publishCloudWatchMetrics ? 'Sí' : 'No' }}</span></div>
          </div>
          <!-- Execution Role -->
          <div v-if="athenaWgInfo.data.executionRole" class="config-section">
            <div class="config-title">IAM Execution Role</div>
            <span class="mono-xs" style="font-size:11px;word-break:break-all">{{ athenaWgInfo.data.executionRole }}</span>
          </div>
          <!-- Description -->
          <div v-if="athenaWgInfo.data.description" class="config-section">
            <div class="config-title">Descripción</div>
            <span class="text-dim">{{ athenaWgInfo.data.description }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Athena Workgroup Query Modal ══════════════════════════════════════ -->
    <div v-if="athenaModal.open" class="modal-overlay" @click.self="athenaModal.open = false">
      <div class="modal" style="width:700px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Query — Workgroup: {{ athenaModal.workgroup?.name }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" @click="athenaModal.open=false; athenaSubTab='editor'; if(athenaModal.workgroup) athenaEditor.selectedWorkgroup = athenaModal.workgroup.name">⚡ Open in Editor</button>
            <button class="btn sm" @click="athenaModal.open = false">Close</button>
          </div>
        </div>
        <div style="padding:10px 14px;display:flex;flex-direction:column;gap:10px;flex:1;overflow:hidden">
          <textarea v-model="athenaModal.query" rows="5" class="ctrl-input"
            style="font-family:monospace;font-size:12px;resize:vertical"
            placeholder="SELECT * FROM my_database.my_table LIMIT 10;"></textarea>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn" @click="submitAthenaQuery" :disabled="athenaModal.loading || !athenaModal.query.trim()">
              {{ athenaModal.loading ? 'Running...' : '▶ Run Query' }}
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
      <div class="modal" style="width:560px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Data Source — {{ athenaCatInfo.cat?.name }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn sm" style="background:rgba(88,166,255,.15);border-color:#58a6ff;color:#58a6ff"
              @click="athenaCatInfo.open=false; athenaSubTab='editor'; athenaEditor.selectedCatalog = athenaCatInfo.cat?.name || ''">⚡ Editor</button>
            <button class="btn sm" @click="athenaCatInfo.open = false">Close</button>
          </div>
        </div>
        <div v-if="athenaCatInfo.loading" class="empty-row">Loading...</div>
        <div v-else-if="athenaCatInfo.error" class="alert-error">{{ athenaCatInfo.error }}</div>
        <div v-else-if="athenaCatInfo.data" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="config-section">
              <div class="config-title">Tipo</div>
              <span class="tag-chip">{{ athenaCatInfo.data.type }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">Descripción</div>
              <span class="text-dim">{{ athenaCatInfo.data.description || '—' }}</span>
            </div>
          </div>
          <div v-if="Object.keys(athenaCatInfo.data.parameters || {}).length" class="config-section">
            <div class="config-title">Parámetros de Conexión</div>
            <div v-for="(v, k) in athenaCatInfo.data.parameters" :key="k" class="config-row">
              <span class="mono-xs" style="color:var(--text-dim)">{{ k }}</span>
              <span class="mono-xs" style="word-break:break-all;font-size:11px">{{ v }}</span>
            </div>
          </div>
          <div class="config-section">
            <div class="config-title">Bases de Datos</div>
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
      <div class="modal-box" style="width:560px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">Create DynamoDB Table</span>
          <button class="btn sm" @click="dynamoCreate.open = false">Close</button>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
          <div>
            <label class="ctrl-label">Table Name</label>
            <input v-model="dynamoCreate.tableName" class="ctrl-input" placeholder="my-table" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 100px;gap:8px">
            <div>
              <label class="ctrl-label">Partition Key</label>
              <input v-model="dynamoCreate.partitionKey" class="ctrl-input" placeholder="pk" />
            </div>
            <div>
              <label class="ctrl-label">Type</label>
              <select v-model="dynamoCreate.partitionKeyType" class="ctrl-select">
                <option value="S">S</option>
                <option value="N">N</option>
                <option value="B">B</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 100px;gap:8px">
            <div>
              <label class="ctrl-label">Sort Key (optional)</label>
              <input v-model="dynamoCreate.sortKey" class="ctrl-input" placeholder="sk" />
            </div>
            <div>
              <label class="ctrl-label">Type</label>
              <select v-model="dynamoCreate.sortKeyType" class="ctrl-select" style="width:70px">
                <option value="S">S (String)</option>
                <option value="N">N (Number)</option>
                <option value="B">B (Binary)</option>
              </select>
            </div>
          </div>
          <div>
            <label class="ctrl-label">Billing Mode</label>
            <select v-model="dynamoCreate.billingMode" class="ctrl-select">
              <option value="PAY_PER_REQUEST">PAY_PER_REQUEST (On-demand)</option>
              <option value="PROVISIONED">PROVISIONED</option>
            </select>
          </div>
          <div v-if="dynamoCreate.billingMode === 'PROVISIONED'" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label class="ctrl-label">Read Capacity Units</label>
              <input v-model.number="dynamoCreate.readCapacity" class="ctrl-input" type="number" min="1" />
            </div>
            <div>
              <label class="ctrl-label">Write Capacity Units</label>
              <input v-model.number="dynamoCreate.writeCapacity" class="ctrl-input" type="number" min="1" />
            </div>
          </div>
          <div v-if="dynamoCreate.error" class="alert-error">{{ dynamoCreate.error }}</div>
          <div v-if="dynamoCreate.result" class="alert-success">{{ dynamoCreate.result }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
            <button class="btn" @click="submitDynamoCreate" :disabled="dynamoCreate.loading">{{ dynamoCreate.loading ? 'Creating...' : 'Create Table' }}</button>
            <button class="btn sm" @click="dynamoCreate.open = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ Glue Job Info Modal ════════════════════════════════════════════════ -->
    <div v-if="glueInfo.open" class="modal-overlay" @click.self="glueInfo.open = false">
      <div class="modal" style="width:700px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <span style="font-weight:600">Glue Job — {{ glueInfo.job?.name }}</span>
          <button class="btn sm" @click="glueInfo.open = false">Close</button>
        </div>
        <div v-if="glueInfo.loading" class="empty-row">Loading...</div>
        <div v-else-if="glueInfo.error" class="alert-error">{{ glueInfo.error }}</div>
        <div v-else-if="glueInfo.data" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px">
          <!-- Summary cards -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
            <div class="config-section">
              <div class="config-title">Tipo</div>
              <span class="text-dim">{{ glueInfo.data.command || '-' }}</span>
            </div>
            <div class="config-section">
              <div class="config-title">Glue Version</div>
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
            <div class="config-title">Configuración de Ejecución</div>
            <div class="config-row"><span>Timeout</span><span class="mono-xs">{{ glueInfo.data.timeout ? glueInfo.data.timeout + ' min' : '-' }}</span></div>
            <div class="config-row"><span>Max Retries</span><span class="mono-xs">{{ glueInfo.data.maxRetries ?? '-' }}</span></div>
            <div class="config-row"><span>Max Concurrent Runs</span><span class="mono-xs">{{ glueInfo.data.maxConcurrentRuns ?? '-' }}</span></div>
            <div class="config-row"><span>Python Version</span><span class="mono-xs">{{ glueInfo.data.pythonVersion || '-' }}</span></div>
            <div class="config-row"><span>Runtime</span><span class="mono-xs">{{ glueInfo.data.runtime || '-' }}</span></div>
          </div>
          <!-- IAM / Role -->
          <div class="config-section">
            <div class="config-title">IAM Role</div>
            <span class="mono-xs" style="word-break:break-all;font-size:11px">{{ glueInfo.data.role || '-' }}</span>
          </div>
          <!-- Script -->
          <div v-if="glueInfo.data.scriptLocation" class="config-section">
            <div class="config-title">Script</div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="mono-xs" style="font-size:11px;word-break:break-all;flex:1">{{ glueInfo.data.scriptLocation }}</span>
              <a :href="glueS3ConsoleUrl(glueInfo.data.scriptLocation)" target="_blank" class="btn sm">Open in S3</a>
            </div>
          </div>
          <!-- CW Log Group -->
          <div class="config-section">
            <div class="config-title">CloudWatch Log Group</div>
            <span class="mono-xs" style="font-size:11px">{{ glueInfo.data.cloudWatchLogGroup || `/aws-glue/jobs/${glueInfo.job?.name}` }}</span>
          </div>
          <!-- Connections -->
          <div v-if="(glueInfo.data.connections || []).length" class="config-section">
            <div class="config-title">Conexiones ({{ glueInfo.data.connections.length }})</div>
            <div v-for="c in glueInfo.data.connections" :key="c" class="config-row">
              <span>{{ c }}</span>
            </div>
          </div>
          <!-- Catalog database -->
          <div v-if="glueInfo.data.databaseName" class="config-section">
            <div class="config-title">Data Catalog Database</div>
            <span class="mono-xs">{{ glueInfo.data.databaseName }}</span>
          </div>
          <!-- Default Arguments -->
          <div v-if="Object.keys(glueInfo.data.defaultArguments || {}).length" class="config-section">
            <div class="config-title">Default Arguments ({{ Object.keys(glueInfo.data.defaultArguments).length }})</div>
            <div v-for="(v, k) in glueInfo.data.defaultArguments" :key="k" class="config-row">
              <span class="mono-xs" style="color:var(--text-dim)">{{ k }}</span>
              <span class="mono-xs" style="word-break:break-all;font-size:11px">{{ v }}</span>
            </div>
          </div>
          <!-- Tags -->
          <div v-if="Object.keys(glueInfo.data.tags || {}).length" class="config-section">
            <div class="config-title">Tags</div>
            <div class="tag-chips">
              <span v-for="(v, k) in glueInfo.data.tags" :key="k" class="tag-chip">{{ k }}={{ v }}</span>
            </div>
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

    <!-- ══ RDS Info Modal ══════════════════════════════════════════════════════ -->
    <div v-if="rdsInfoModal.open" class="modal-overlay" @click.self="rdsInfoModal.open = false">
      <div class="modal-box" style="width:900px;max-width:98vw;max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
        <div class="modal-header">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <span style="font-weight:600">Info de RDS — {{ rdsInfoModal.id }}</span>
            <span v-if="rdsInfoModal.data" class="text-dim" style="font-size:11px">{{ rdsInfoModal.data.engine }} {{ rdsInfoModal.data.engineVersion || '' }} · {{ rdsInfoModal.data.status }}</span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn sm" @click="openRdsConnect({ id: rdsInfoModal.id })">Conectar</button>
            <button class="btn sm" @click="openRdsResetPwd({ id: rdsInfoModal.id })">Restablecer contraseña</button>
            <button class="btn sm" @click="rdsInfoModal.open = false">Cerrar</button>
          </div>
        </div>
        <div v-if="rdsInfoModal.loading" class="empty-row">Cargando...</div>
        <div v-else-if="rdsInfoModal.error" class="alert-error">{{ rdsInfoModal.error }}</div>
        <div v-else-if="rdsInfoModal.data" style="padding:12px;display:flex;flex-direction:column;gap:12px;overflow:hidden;flex:1">
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;flex-wrap:wrap">
            <button
              v-for="t in rdsInfoTabs"
              :key="t.id"
              class="btn sm"
              :style="rdsInfoTab === t.id ? 'background:var(--accent);border-color:var(--accent);color:#fff' : ''"
              @click="rdsInfoTab = t.id"
            >{{ t.label }}</button>
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
                <div class="config-title">Conectividad y seguridad</div>
                <div class="config-row"><span>Endpoint</span><span class="mono-xs text-dim">{{ rdsInfoModal.data.endpoint ? `${rdsInfoModal.data.endpoint}:${rdsInfoModal.data.port}` : '-' }}</span></div>
                <div class="config-row"><span>Acceso público</span><span :class="rdsInfoModal.data.public ? 'status-warn' : 'status-ok'">{{ rdsInfoModal.data.public ? 'Sí' : 'No' }}</span></div>
                <div class="config-row"><span>Grupo de subredes</span><span class="text-dim">{{ rdsInfoModal.data.subnetGroup || '-' }}</span></div>
                <div class="config-row"><span>Tipo de red</span><span class="text-dim">{{ rdsInfoModal.data.networkType || '-' }}</span></div>
                <div class="config-row"><span>Autenticación IAM DB</span><span :class="rdsInfoModal.data.iamDatabaseAuthenticationEnabled ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.iamDatabaseAuthenticationEnabled ? 'Habilitada' : 'Deshabilitada' }}</span></div>
                <div class="config-row"><span>Certificado CA</span><span class="text-dim mono-xs">{{ rdsInfoModal.data.caCertificateIdentifier || '-' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">Grupos de seguridad ({{ (rdsInfoModal.data.vpcSecurityGroups || []).length }})</div>
                <div v-if="!rdsInfoModal.data.vpcSecurityGroups?.length" class="text-dim" style="font-size:12px">Sin grupos de seguridad.</div>
                <div v-for="sg in rdsInfoModal.data.vpcSecurityGroups" :key="sg.id" class="config-row">
                  <span class="mono-xs">{{ sg.id }}</span>
                  <span :class="sg.status === 'active' ? 'status-ok' : 'text-dim'">{{ sg.status }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'monitoring'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">Supervisión</div>
                <div class="config-row"><span>Monitoreo mejorado</span><span :class="rdsInfoModal.data.monitoringInterval ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.monitoringInterval ? `Cada ${rdsInfoModal.data.monitoringInterval}s` : 'Deshabilitado' }}</span></div>
                <div class="config-row"><span>Rol de monitoreo</span><span class="mono-xs text-dim" style="font-size:10px">{{ rdsInfoModal.data.monitoringRoleArn || '-' }}</span></div>
                <div class="config-row"><span>Performance Insights</span><span :class="rdsInfoModal.data.performanceInsightsEnabled ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.performanceInsightsEnabled ? 'Habilitado' : 'Deshabilitado' }}</span></div>
                <div class="config-row"><span>Retención PI</span><span class="text-dim">{{ rdsInfoModal.data.performanceInsightsRetentionPeriod || '-' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">Logs exportados</div>
                <div v-if="!(rdsInfoModal.data.enabledCloudwatchLogsExports || []).length" class="text-dim" style="font-size:12px">Sin exportaciones a CloudWatch Logs.</div>
                <div v-for="logName in (rdsInfoModal.data.enabledCloudwatchLogsExports || [])" :key="logName" class="config-row">
                  <span class="mono-xs">{{ logName }}</span>
                  <span class="status-ok">Habilitado</span>
                </div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'configuration'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">Configuración</div>
                <div class="config-row"><span>Motor</span><span class="text-dim">{{ rdsInfoModal.data.engine }} {{ rdsInfoModal.data.engineVersion || '' }}</span></div>
                <div class="config-row"><span>Clase de instancia</span><span class="text-dim">{{ rdsInfoModal.data.class || '-' }}</span></div>
                <div class="config-row"><span>Usuario maestro</span><span class="text-dim">{{ rdsInfoModal.data.masterUsername || '-' }}</span></div>
                <div class="config-row"><span>Nombre de base</span><span class="text-dim">{{ rdsInfoModal.data.dbName || '-' }}</span></div>
                <div class="config-row"><span>Almacenamiento</span><span class="text-dim">{{ rdsInfoModal.data.storageGb || '-' }} GiB ({{ rdsInfoModal.data.storageType || '-' }})</span></div>
                <div class="config-row"><span>Cifrado de almacenamiento</span><span :class="rdsInfoModal.data.storageEncrypted ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.storageEncrypted ? 'Sí' : 'No' }}</span></div>
                <div class="config-row"><span>Máx. almacenamiento automático</span><span class="text-dim">{{ rdsInfoModal.data.maxAllocatedStorage || '-' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">Parámetros y opciones</div>
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Grupos de parámetros</div>
                <div v-if="!(rdsInfoModal.data.parameterGroups || []).length" class="text-dim" style="font-size:12px">No asignados.</div>
                <div v-for="pg in (rdsInfoModal.data.parameterGroups || [])" :key="pg.name" class="config-row">
                  <span class="mono-xs">{{ pg.name }}</span>
                  <span class="text-dim">{{ pg.status }}</span>
                </div>
                <div style="font-size:11px;color:var(--text-dim);margin:10px 0 6px">Grupos de opciones</div>
                <div v-if="!(rdsInfoModal.data.optionGroups || []).length" class="text-dim" style="font-size:12px">No asignados.</div>
                <div v-for="og in (rdsInfoModal.data.optionGroups || [])" :key="og.name" class="config-row">
                  <span class="mono-xs">{{ og.name }}</span>
                  <span class="text-dim">{{ og.status }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'maintenance'" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="config-section">
                <div class="config-title">Mantenimiento</div>
                <div class="config-row"><span>Actualización menor automática</span><span :class="rdsInfoModal.data.autoMinorVersionUpgrade ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.autoMinorVersionUpgrade ? 'Habilitada' : 'Deshabilitada' }}</span></div>
                <div class="config-row"><span>Ventana de mantenimiento</span><span class="text-dim mono-xs">{{ rdsInfoModal.data.preferredMaintenanceWindow || '-' }}</span></div>
                <div class="config-row"><span>Protección contra eliminación</span><span :class="rdsInfoModal.data.deletionProtection ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.deletionProtection ? 'Habilitada' : 'Deshabilitada' }}</span></div>
              </div>
              <div class="config-section">
                <div class="config-title">Copias de seguridad</div>
                <div class="config-row"><span>Retención (días)</span><span class="text-dim">{{ rdsInfoModal.data.backupRetention ?? '-' }}</span></div>
                <div class="config-row"><span>Ventana de copia</span><span class="text-dim mono-xs">{{ rdsInfoModal.data.preferredBackupWindow || '-' }}</span></div>
                <div class="config-row"><span>Último punto restaurable</span><span class="text-dim">{{ rdsInfoModal.data.latestRestorableTime ? formatDate(rdsInfoModal.data.latestRestorableTime) : '-' }}</span></div>
                <div class="config-row"><span>Copiar etiquetas en snapshot</span><span :class="rdsInfoModal.data.copyTagsToSnapshot ? 'status-ok' : 'text-dim'">{{ rdsInfoModal.data.copyTagsToSnapshot ? 'Sí' : 'No' }}</span></div>
                <div class="config-row"><span>Destino de backup</span><span class="text-dim">{{ rdsInfoModal.data.backupTarget || '-' }}</span></div>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'migration'" class="config-section">
              <div class="config-title">Migración y replicación</div>
              <div class="config-row"><span>Instancia origen</span><span class="mono-xs text-dim">{{ rdsInfoModal.data.readReplicaSourceDBInstanceIdentifier || '-' }}</span></div>
              <div class="config-row"><span>Modo de réplica</span><span class="text-dim">{{ rdsInfoModal.data.replicaMode || '-' }}</span></div>
              <div class="config-row" style="align-items:flex-start">
                <span>Réplicas de lectura (instancias)</span>
                <span class="text-dim mono-xs" style="font-size:10px;word-break:break-all">{{ (rdsInfoModal.data.readReplicaDBInstanceIdentifiers || []).join(', ') || '-' }}</span>
              </div>
              <div class="config-row" style="align-items:flex-start">
                <span>Réplicas de lectura (clusters)</span>
                <span class="text-dim mono-xs" style="font-size:10px;word-break:break-all">{{ (rdsInfoModal.data.readReplicaDBClusterIdentifiers || []).join(', ') || '-' }}</span>
              </div>
            </div>

            <div v-else-if="rdsInfoTab === 'tags'" class="config-section">
              <div class="config-title">Etiquetas</div>
              <div v-if="!(rdsInfoModal.data.tags || []).length" class="text-dim" style="font-size:12px">Sin etiquetas.</div>
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
      <div class="modal-box" style="width:760px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">Conexión RDS — {{ rdsConnectModal.id }}</span>
          <button class="btn sm" @click="rdsConnectModal.open = false">Cerrar</button>
        </div>
        <div v-if="rdsConnectModal.loading" class="empty-row">Cargando...</div>
        <div v-else-if="rdsConnectModal.error" class="alert-error">{{ rdsConnectModal.error }}</div>
        <div v-else-if="rdsConnectModal.data" style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:6px;align-items:center">
            <label style="font-size:12px;color:var(--text-muted);white-space:nowrap">Contraseña (para URI)</label>
            <input v-model="rdsConnectModal.password" type="password" class="ctrl-input" placeholder="contraseña del usuario maestro" style="flex:1" />
          </div>
          <div v-for="entry in rdsConnectionEntries" :key="entry.key">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text-muted)">{{ entry.label }}</div>
            <div style="position:relative">
              <pre class="code-block" style="user-select:all;overflow-x:auto">{{ entry.value }}</pre>
              <button class="btn sm" style="position:absolute;top:4px;right:4px" @click="copyText(entry.value)">Copiar</button>
            </div>
          </div>
          <div v-if="rdsConnectModal.data.templates?.notes?.length" style="background:var(--bg-alt,#1e1e2e);border-radius:6px;padding:10px 12px">
            <div style="font-size:11px;font-weight:600;margin-bottom:6px">Notas</div>
            <div v-for="n in rdsConnectModal.data.templates.notes" :key="n" style="font-size:11px;color:var(--text-muted);margin-bottom:4px">• {{ n }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ RDS Reset Password Modal ═══════════════════════════════════════════ -->
    <div v-if="rdsResetPwdModal.open" class="modal-overlay" @click.self="rdsResetPwdModal.open = false">
      <div class="modal-box" style="width:460px;max-width:98vw">
        <div class="modal-header">
          <span style="font-weight:600">Restablecer contraseña maestra — {{ rdsResetPwdModal.id }}</span>
          <button class="btn sm" @click="rdsResetPwdModal.open = false">Cerrar</button>
        </div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
          <label class="field-label">
            Nueva contraseña
            <input v-model="rdsResetPwdModal.newPassword" type="password" class="ctrl-input" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />
          </label>
          <label class="field-label">
            Confirmar contraseña
            <input v-model="rdsResetPwdModal.confirmPassword" type="password" class="ctrl-input" placeholder="Repetir contraseña" autocomplete="new-password" />
          </label>
          <div v-if="rdsResetPwdModal.error" class="alert-error">{{ rdsResetPwdModal.error }}</div>
          <div v-if="rdsResetPwdModal.success" style="color:#a6e3a1;font-size:12px;padding:8px;border-radius:4px;background:rgba(166,227,161,.1)">{{ rdsResetPwdModal.success }}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn sm" @click="rdsResetPwdModal.open = false">Cancelar</button>
            <button class="btn sm" :disabled="rdsResetPwdModal.loading" @click="doRdsResetPassword">
              {{ rdsResetPwdModal.loading ? 'Aplicando...' : 'Restablecer contraseña' }}
            </button>
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
  { id: 'rds',          label: 'RDS'            },
  { id: 'glue',         label: 'Glue'           },
  { id: 'athena',       label: 'Athena'         },
  { id: 'datapipeline', label: 'Data Pipeline'  },
  { id: 'bedrock',      label: 'Bedrock'        },
  { id: 'lex',          label: 'Amazon Lex'     },
  { id: 'agentcorecfn', label: 'AgentCore CFN'  },
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
const filteredRds         = computed(() => filterRows(awsStore.rdsClusters,      search.rds))
const filteredGlue        = computed(() => filterRows(awsStore.glueJobs,         search.glue))
const filteredAthena      = computed(() => filterRows(awsStore.athenaWorkgroups, search.athena))
const filteredPipelines   = computed(() => filterRows(awsStore.dataPipelines,    search.datapipeline))
const filteredBedrock     = computed(() => filterRows(awsStore.bedrockModels,    search.bedrock))
const filteredLex         = computed(() => filterRows(awsStore.lexBots,          search.lex))
const filteredAgentCoreCfn= computed(() => filterRows(awsStore.cfnStacks,        search.agentcorecfn))
const filteredCloudfront  = computed(() => filterRows(awsStore.cloudfrontDists,  search.cloudfront))
const filteredRoute53     = computed(() => filterRows(awsStore.route53Zones,     search.route53))
const filteredCognito     = computed(() => filterRows(awsStore.cognitoUserPools, search.cognito))
const filteredSecrets     = computed(() => filterRows(awsStore.secrets,          search.secrets))

const tabFilteredMap = {
  ec2: filteredEc2, ecs: filteredEcs, eks: filteredEks,
  lambda: filteredLambda, apigw: filteredApigw, s3: filteredS3,
  ecr: filteredEcr, vpc: filteredVpc, eventbridge: filteredEventBridge, stepfn: filteredStepFn,
  dynamodb: filteredDynamo, rds: filteredRds, glue: filteredGlue,
  athena: filteredAthena, datapipeline: filteredPipelines,
  bedrock: filteredBedrock, lex: filteredLex, agentcorecfn: filteredAgentCoreCfn,
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
    dynamodb: awsStore.dynamoTables,
    rds: awsStore.rdsClusters,
    glue: awsStore.glueJobs, athena: awsStore.athenaWorkgroups,
    datapipeline: awsStore.dataPipelines,
    bedrock: awsStore.bedrockModels, lex: awsStore.lexBots, agentcorecfn: awsStore.cfnStacks,
    cloudfront: awsStore.cloudfrontDists,
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
  rds:          () => awsStore.fetchRdsClusters(),
  glue:         () => awsStore.fetchGlueJobs(),
  athena:       () => Promise.all([awsStore.fetchAthenaWorkgroups(), loadAthenaCatalogs()]),
  datapipeline: () => awsStore.fetchDataPipelines(),
  bedrock:      () => awsStore.fetchBedrockModels(),
  lex:          () => awsStore.fetchLexBots(),
  agentcorecfn: () => awsStore.fetchCloudformationStacks(true),
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
      toast(`Bucket "${result.name}" created in ${result.region}`, 'success')
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
      toast(`S3 "${bucketName}" accessible — ${r.latencyMs}ms (${r.region})`, 'success')
    } else {
      s3TestState[bucketName].ok  = false
      s3TestState[bucketName].msg = r?.reason || 'Not accessible'
      toast(`S3 "${bucketName}" — ${r?.reason || 'Not accessible'}`, 'error')
    }
  } catch (e) {
    s3TestState[bucketName].ok  = false
    s3TestState[bucketName].msg = e?.message || 'Error'
  } finally {
    s3TestState[bucketName].loading = false
  }
}

// ─── VPC Details Modal ────────────────────────────────────────────────────────

const vpcDetailTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'subnets',  label: 'Subnets' },
  { id: 'sgs',      label: 'Security Groups' },
  { id: 'routes',   label: 'Route Tables' },
  { id: 'igws',     label: 'Internet GWs' },
  { id: 'nats',     label: 'NAT GWs' },
]

const vpcDetailModal = reactive({
  open: false, loading: false, error: null,
  name: '', vpcId: '', tab: 'overview', data: null,
})

async function openVpcDetails(v) {
  Object.assign(vpcDetailModal, { open: true, loading: true, error: null, name: v.name, vpcId: v.id, tab: 'overview', data: null })
  try {
    const data = await awsStore.fetchResourceConfig('vpc', { id: v.id })
    if (data) {
      vpcDetailModal.data = data
    } else {
      vpcDetailModal.error = awsStore.error || 'Failed to load VPC details'
    }
  } catch (e) {
    vpcDetailModal.error = e?.message || 'Error'
  } finally {
    vpcDetailModal.loading = false
  }
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
  toast('Manifest copied to clipboard', 'success')
}

async function doApplyEcrToK8s() {
  if (!ecrDeployModal.appName || !ecrDeployModal.selectedTag) return
  ecrDeployModal.applying = true; ecrDeployModal.applyResult = null
  try {
    const result = await awsStore.applyK8sManifest(ecrDeployYaml.value, ecrDeployModal.context || undefined)
    ecrDeployModal.applyResult = result
    if (result?.success) {
      toast(`Deployment applied successfully`, 'success')
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
  botId: '', botName: '',
  locales: [], activeLocale: null, activeIntent: null, activeView: 'list',
})

const lexCurrentLocale = computed(() =>
  lexIntentsModal.locales.find(l => l.localeId === lexIntentsModal.activeLocale) || null
)

async function openLexIntents(bot) {
  Object.assign(lexIntentsModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    locales: [], activeLocale: null, activeIntent: null, activeView: 'list',
  })
  try {
    const data = await awsStore.fetchLexIntents(bot.id)
    lexIntentsModal.locales = data
    if (data.length) lexIntentsModal.activeLocale = data[0].localeId
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
  hours: 24, configured: false, groups: [], events: [],
})

async function openLexLogs(bot) {
  Object.assign(lexLogsModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    hours: 24, configured: false, groups: [], events: [],
  })
  await reloadLexLogs()
}

async function reloadLexLogs() {
  lexLogsModal.loading = true; lexLogsModal.error = null
  try {
    const data = await awsStore.fetchLexLogs(lexLogsModal.botId, lexLogsModal.hours)
    lexLogsModal.configured = data.configured
    lexLogsModal.groups     = data.groups || []
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
  lexAliasesModal.open = false
  openLexChat(bot).then(() => {
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
  hours: 24, configured: false, logGroupName: '', utterances: [],
})

async function openLexMissed(bot) {
  Object.assign(lexMissedModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    hours: 24, configured: false, logGroupName: '', utterances: [],
  })
  await reloadLexMissed()
}

async function reloadLexMissed() {
  lexMissedModal.loading = true; lexMissedModal.error = null
  try {
    const data = await awsStore.fetchLexMissedUtterances(lexMissedModal.botId, lexMissedModal.hours)
    lexMissedModal.configured   = data.configured
    lexMissedModal.logGroupName = data.logGroupName || ''
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
    toast(`Alias "${alias.name}" created`, 'success')
  } catch (e) {
    lexAliasesModal.createError = e?.message || 'Error creating alias'
  } finally {
    lexAliasesModal.creating = false
  }
}

function openLexBuildFromAlias(bot, alias) {
  lexAliasesModal.open = false
  openLexMetrics(bot)
}

// ─── Lex Slot Types Modal ─────────────────────────────────────────────────────

const lexSlotTypesModal = reactive({
  open: false, loading: false, error: null,
  botId: '', botName: '',
  locales: [], activeLocale: null,
})

async function openLexSlotTypes(bot) {
  Object.assign(lexSlotTypesModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    locales: [], activeLocale: null,
  })
  try {
    const data = await awsStore.fetchLexSlotTypes(bot.id)
    lexSlotTypesModal.locales = data
    if (data.length) lexSlotTypesModal.activeLocale = data[0].localeId
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
  hours: 24, metrics: {},
  locales: [], buildLocale: null, building: false, buildResult: null,
})

async function openLexMetrics(bot) {
  Object.assign(lexMetricsModal, {
    open: true, loading: true, error: null,
    botId: bot.id, botName: bot.name,
    hours: 24, metrics: {},
    locales: [], buildLocale: null, building: false, buildResult: null,
  })
  // Load locales for the build selector
  try {
    const intents = await awsStore.fetchLexIntents(bot.id)
    lexMetricsModal.locales = intents.map(l => ({ localeId: l.localeId, localeName: l.localeName }))
    if (lexMetricsModal.locales.length) lexMetricsModal.buildLocale = lexMetricsModal.locales[0].localeId
  } catch (_) {}
  await reloadLexMetrics()
}

async function reloadLexMetrics() {
  lexMetricsModal.loading = true; lexMetricsModal.error = null
  try {
    const data = await awsStore.fetchLexMetrics(lexMetricsModal.botId, lexMetricsModal.hours)
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
  { id: 'groups',  label: 'Groups' },
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
    dynamoCreate.error = 'Table name and partition key are required'; return
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
      toast(`DynamoDB table created: ${r.tableName}`, 'success')
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
const athenaSubTabs = [
  { id: 'workgroups',  label: 'Workgroups' },
  { id: 'datasources', label: 'Data Sources' },
  { id: 'editor',      label: '⚡ Query Editor' },
]
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
  Object.assign(athenaModal, { open: true, workgroup: wg, query: '', queryId: null, status: null, results: null, error: null, loading: false })
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
    const outputLocation = awsStore.athenaWorkgroups.find(w => w.name === wg)?.outputLocation
    const r = await awsStore.startAthenaQuery(athenaEditor.sql, wg, outputLocation)
    if (!r?.queryExecutionId) { athenaEditor.error = awsStore.error || 'Failed to start query'; return }
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

function copyText(text) {
  navigator.clipboard?.writeText(text)
    .then(() => toast('Copied!', 'success'))
    .catch(() => toast('Copy failed', 'error'))
}

// ─── RDS actions/modals ──────────────────────────────────────────────────────

const rdsInfoModal = reactive({ open: false, loading: false, error: null, id: '', data: null })
const rdsConnectModal = reactive({ open: false, loading: false, error: null, id: '', password: '', data: null })
const rdsResetPwdModal = reactive({ open: false, loading: false, error: null, success: null, id: '', newPassword: '', confirmPassword: '' })
const rdsInfoTabs = [
  { id: 'connectivity', label: 'Conectividad y seguridad' },
  { id: 'monitoring', label: 'Supervisión y registros' },
  { id: 'configuration', label: 'Configuración' },
  { id: 'maintenance', label: 'Mantenimiento y copias de seguridad' },
  { id: 'migration', label: 'Migración y réplicas' },
  { id: 'tags', label: 'Etiquetas' },
]
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
        { label: 'Acceso público', value: d.public ? 'Habilitado' : 'Privado', tone: d.public ? 'status-warn' : 'status-ok' },
        { label: 'Grupos de seguridad', value: String(sgCount), tone: sgCount ? 'status-ok' : 'text-dim' },
      ]
    case 'monitoring':
      return [
        { label: 'Monitoreo mejorado', value: d.monitoringInterval ? `Cada ${d.monitoringInterval}s` : 'Deshabilitado', tone: d.monitoringInterval ? 'status-ok' : 'text-dim' },
        { label: 'Performance Insights', value: d.performanceInsightsEnabled ? 'Habilitado' : 'Deshabilitado', tone: d.performanceInsightsEnabled ? 'status-ok' : 'text-dim' },
        { label: 'Logs exportados', value: String(logCount), tone: logCount ? 'status-ok' : 'text-dim' },
      ]
    case 'configuration':
      return [
        { label: 'Motor', value: `${d.engine || '-'} ${d.engineVersion || ''}`.trim(), tone: 'text-dim' },
        { label: 'Clase', value: d.class || '-', tone: 'text-dim' },
        { label: 'Almacenamiento', value: `${d.storageGb ?? '-'} GiB`, tone: 'text-dim' },
      ]
    case 'maintenance':
      return [
        { label: 'Retención de backup', value: d.backupRetention != null ? `${d.backupRetention} días` : '-', tone: 'text-dim' },
        { label: 'Protección de borrado', value: d.deletionProtection ? 'Habilitada' : 'Deshabilitada', tone: d.deletionProtection ? 'status-ok' : 'text-dim' },
        { label: 'Estado', value: d.status || '-', tone: d.status === 'available' ? 'status-ok' : 'status-warn' },
      ]
    case 'migration':
      return [
        { label: 'Instancia origen', value: d.readReplicaSourceDBInstanceIdentifier || '-', tone: 'text-dim' },
        { label: 'Modo réplica', value: d.replicaMode || '-', tone: 'text-dim' },
        { label: 'Total de réplicas', value: String(replicasCount), tone: replicasCount ? 'status-ok' : 'text-dim' },
      ]
    case 'tags':
      return [
        { label: 'Etiquetas', value: String(tagCount), tone: tagCount ? 'status-ok' : 'text-dim' },
        { label: 'Copiar etiquetas a snapshot', value: d.copyTagsToSnapshot ? 'Sí' : 'No', tone: d.copyTagsToSnapshot ? 'status-ok' : 'text-dim' },
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
    if (!rdsInfoModal.data) rdsInfoModal.error = awsStore.error || 'No se pudo cargar la información de RDS'
  } catch (e) { rdsInfoModal.error = e.message }
  finally { rdsInfoModal.loading = false }
}

async function openRdsConnect(db) {
  Object.assign(rdsConnectModal, { open: true, loading: true, error: null, id: db.id, password: '', data: null })
  try {
    rdsConnectModal.data = await awsStore.fetchRdsConnectionStrings(db.id)
    if (!rdsConnectModal.data) rdsConnectModal.error = awsStore.error || 'No se pudieron cargar las cadenas de conexión'
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
    rdsResetPwdModal.error = 'La contraseña debe tener al menos 8 caracteres'
    return
  }
  if (rdsResetPwdModal.newPassword !== rdsResetPwdModal.confirmPassword) {
    rdsResetPwdModal.error = 'Las contraseñas no coinciden'
    return
  }
  rdsResetPwdModal.loading = true
  try {
    const resp = await awsStore.resetRdsPassword(rdsResetPwdModal.id, rdsResetPwdModal.newPassword)
    if (resp?.ok) {
      rdsResetPwdModal.success = resp.message || 'Restablecimiento de contraseña iniciado'
      rdsResetPwdModal.newPassword = ''
      rdsResetPwdModal.confirmPassword = ''
    } else {
      rdsResetPwdModal.error = awsStore.error || 'No se pudo restablecer la contraseña'
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

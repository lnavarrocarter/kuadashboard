<template>
  <div class="cloud-view">

    <!-- Empty state: no profile selected -->
    <div v-if="!vercelStore.activeProfileId" class="empty-state">
      {{ t('vercel.noProfile') }}<br />
      <span class="text-dim">{{ t('vercel.noProfileHint') }}</span>
    </div>

    <template v-else>
      <!-- Error banner -->
      <div v-if="vercelStore.error" class="alert-error">{{ vercelStore.error }}</div>

      <!-- Toolbar -->
      <div class="aws-toolbar">
        <input
          v-model="search"
          class="ctrl-input aws-search"
          :placeholder="t('vercel.searchPlaceholder')"
        />
        <span class="text-dim" style="font-size:12px">
          <template v-if="vercelStore.loading">{{ t('vercel.loading') }}</template>
          <template v-else>{{ activeRowCount }} {{ activeRowCount !== 1 ? t('vercel.results') : t('vercel.result') }}</template>
        </span>
        <button class="btn sm" @click="reload" :disabled="vercelStore.loading" title="Refresh">
          <i data-lucide="refresh-cw"></i>
        </button>
      </div>

      <!-- ── Projects ─────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'projects'" class="tab-panel">
        <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
        <div v-else-if="!filteredProjects.length" class="empty-row">
          {{ search ? t('vercel.noMatches') : t('vercel.noProjects') }}
        </div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th>{{ t('vercel.col.name') }}</th>
            <th>{{ t('vercel.col.framework') }}</th>
            <th>{{ t('vercel.col.latestState') }}</th>
            <th>{{ t('vercel.col.latestUrl') }}</th>
            <th>{{ t('vercel.col.repo') }}</th>
            <th>{{ t('vercel.col.updated') }}</th>
            <th>{{ t('vercel.col.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr
              v-for="p in filteredProjects"
              :key="p.id"
              :class="{ 'row-selected': vercelStore.selectedProject?.id === p.id }"
              @click="handleSelectProject(p)"
              style="cursor:pointer"
            >
              <td>
                <div class="fw-medium">{{ p.name }}</div>
                <div class="text-dim mono-xs">{{ p.id }}</div>
              </td>
              <td class="text-dim">{{ p.framework || '—' }}</td>
              <td>
                <span
                  v-if="p.latestDeployments?.[0]"
                  :class="stateClass(p.latestDeployments[0].state)"
                >{{ p.latestDeployments[0].state }}</span>
                <span v-else class="text-dim">—</span>
              </td>
              <td>
                <a
                  v-if="p.latestDeployments?.[0]?.url"
                  :href="`https://${p.latestDeployments[0].url}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link-dim"
                  @click.stop
                >{{ p.latestDeployments[0].url }}</a>
                <span v-else class="text-dim">—</span>
              </td>
              <td class="text-dim">{{ p.link?.repo || '—' }}</td>
              <td class="text-dim" style="white-space:nowrap">{{ p.updatedAt ? formatDate(p.updatedAt) : '—' }}</td>
              <td>
                <div class="row-actions" @click.stop>
                  <button class="btn sm" @click="loadProjectDeployments(p)">{{ t('vercel.action.viewDeployments') }}</button>
                  <button class="btn sm" @click="loadProjectDomains(p)">{{ t('vercel.action.viewDomains') }}</button>
                  <button class="btn sm" @click="loadProjectEnvVars(p)">{{ t('vercel.action.viewEnvVars') }}</button>
                  <button class="btn sm" @click="loadProjectCron(p)">{{ t('vercel.action.viewCron') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Deployments ──────────────────────────────────────────────────── -->
      <div v-show="activeService === 'deployments'" class="tab-panel">
        <!-- Project context banner -->
        <div v-if="vercelStore.selectedProject" class="context-banner">
          <span>{{ t('vercel.deployments.contextLabel') }}</span>
          <strong>{{ vercelStore.selectedProject.name }}</strong>
          <div style="display:flex;gap:6px;margin-left:auto">
            <button
              class="btn sm"
              :class="{ active: deploymentTarget === '' }"
              @click="deploymentTarget = ''; reloadDeployments()"
            >All</button>
            <button
              class="btn sm"
              :class="{ active: deploymentTarget === 'production' }"
              @click="deploymentTarget = 'production'; reloadDeployments()"
            >Production</button>
            <button
              class="btn sm"
              :class="{ active: deploymentTarget === 'preview' }"
              @click="deploymentTarget = 'preview'; reloadDeployments()"
            >Preview</button>
          </div>
        </div>
        <div v-else class="empty-row">{{ t('vercel.deployments.selectProject') }}</div>

        <template v-if="vercelStore.selectedProject">
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredDeployments.length" class="empty-row">
            {{ search ? t('vercel.noMatches') : t('vercel.deployments.empty') }}
          </div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.deploymentId') }}</th>
              <th>{{ t('vercel.col.state') }}</th>
              <th>{{ t('vercel.col.target') }}</th>
              <th>{{ t('vercel.col.url') }}</th>
              <th>{{ t('vercel.col.creator') }}</th>
              <th>{{ t('vercel.col.created') }}</th>
              <th>{{ t('vercel.col.actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="d in filteredDeployments" :key="d.id">
                <td>
                  <div class="fw-medium">{{ d.name || d.id }}</div>
                  <div class="text-dim mono-xs">{{ d.id }}</div>
                </td>
                <td><span :class="stateClass(d.state)">{{ d.state }}</span></td>
                <td>
                  <span :class="d.target === 'production' ? 'badge-prod' : 'badge-preview'">
                    {{ d.target || 'preview' }}
                  </span>
                </td>
                <td>
                  <a
                    v-if="d.url"
                    :href="`https://${d.url}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link-dim"
                  >{{ d.url }}</a>
                  <span v-else class="text-dim">—</span>
                </td>
                <td class="text-dim">{{ d.creator?.username || d.creator?.email || '—' }}</td>
                <td class="text-dim" style="white-space:nowrap">{{ d.createdAt ? formatDate(d.createdAt) : '—' }}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn sm" @click="openLogs(d)">{{ t('vercel.action.logs') }}</button>
                    <button class="btn sm" @click="viewFunctions(d)">{{ t('vercel.action.functions') }}</button>
                    <button
                      class="btn sm"
                      :disabled="d.state === 'BUILDING' || d.state === 'QUEUED'"
                      @click="triggerRedeploy(d)"
                    >{{ t('vercel.action.redeploy') }}</button>
                    <button
                      v-if="d.target !== 'production'"
                      class="btn sm"
                      @click="triggerPromote(d)"
                    >{{ t('vercel.action.promote') }}</button>
                    <button
                      v-if="d.state === 'BUILDING' || d.state === 'QUEUED'"
                      class="btn sm danger"
                      @click="triggerCancel(d)"
                    >{{ t('vercel.action.cancel') }}</button>
                    <button class="btn sm" @click="viewChecks(d)">{{ t('vercel.action.checks') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Domains ──────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'domains'" class="tab-panel">
        <div v-if="!vercelStore.selectedProject" class="empty-row">{{ t('vercel.domains.selectProject') }}</div>
        <template v-else>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredDomains.length" class="empty-row">
            {{ search ? t('vercel.noMatches') : t('vercel.domains.empty') }}
          </div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.domain') }}</th>
              <th>{{ t('vercel.col.apex') }}</th>
              <th>{{ t('vercel.col.gitBranch') }}</th>
              <th>{{ t('vercel.col.redirect') }}</th>
              <th>{{ t('vercel.col.verified') }}</th>
              <th>{{ t('vercel.col.created') }}</th>
              <th>{{ t('vercel.col.actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="d in filteredDomains" :key="d.name">
                <td class="fw-medium">{{ d.name }}</td>
                <td class="text-dim">{{ d.apexName || '—' }}</td>
                <td class="text-dim">{{ d.gitBranch || '—' }}</td>
                <td class="text-dim">{{ d.redirect ? `→ ${d.redirect}` : '—' }}</td>
                <td>
                  <span :class="d.verified ? 'badge-ok' : 'badge-warn'">
                    {{ d.verified ? '✓ verified' : '⚠ unverified' }}
                  </span>
                </td>
                <td class="text-dim" style="white-space:nowrap">{{ d.createdAt ? formatDate(d.createdAt) : '—' }}</td>
                <td>
                  <button class="btn sm" @click="loadDnsRecords(d)">{{ t('vercel.action.viewDns') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Env Vars ─────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'env-vars'" class="tab-panel">
        <div v-if="!vercelStore.selectedProject" class="empty-row">{{ t('vercel.envVars.selectProject') }}</div>
        <template v-else>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredEnvVars.length" class="empty-row">
            {{ search ? t('vercel.noMatches') : t('vercel.envVars.empty') }}
          </div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.key') }}</th>
              <th>{{ t('vercel.col.target') }}</th>
              <th>{{ t('vercel.col.type') }}</th>
              <th>{{ t('vercel.col.gitBranch') }}</th>
              <th>{{ t('vercel.col.updated') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="e in filteredEnvVars" :key="e.id">
                <td class="fw-medium mono-xs">{{ e.key }}</td>
                <td>
                  <span
                    v-for="tgt in (Array.isArray(e.target) ? e.target : [e.target])"
                    :key="tgt"
                    class="tag-chip"
                  >{{ tgt }}</span>
                </td>
                <td class="text-dim">{{ e.type }}</td>
                <td class="text-dim">{{ e.gitBranch || '—' }}</td>
                <td class="text-dim" style="white-space:nowrap">{{ e.updatedAt ? formatDate(e.updatedAt) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Functions ────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'functions'" class="tab-panel">
        <div v-if="!selectedDeploymentForFunctions" class="empty-row">{{ t('vercel.functions.selectDeployment') }}</div>
        <template v-else>
          <div class="context-banner">
            <span>{{ t('vercel.functions.contextLabel') }}</span>
            <strong>{{ selectedDeploymentForFunctions.id }}</strong>
          </div>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredFunctions.length" class="empty-row">
            {{ search ? t('vercel.noMatches') : t('vercel.functions.empty') }}
          </div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.functionName') }}</th>
              <th>{{ t('vercel.col.type') }}</th>
              <th>{{ t('vercel.col.mode') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="f in filteredFunctions" :key="f.uid || f.name">
                <td class="fw-medium mono-xs">{{ f.name }}</td>
                <td>
                  <span :class="f.type === 'edge' ? 'badge-prod' : 'badge-preview'">{{ f.type || 'lambda' }}</span>
                </td>
                <td class="text-dim">{{ f.mode !== undefined ? f.mode.toString(8) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Checks ───────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'checks'" class="tab-panel">
        <div v-if="!selectedDeploymentForChecks" class="empty-row text-dim">
          {{ t('vercel.checks.noDeployment') }}
        </div>
        <template v-else>
          <div class="context-banner">
            <span>{{ t('vercel.checks.contextLabel') }}</span>
            <strong class="mono-xs">{{ selectedDeploymentForChecks.id }}</strong>
          </div>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!vercelStore.checks.length" class="empty-row">{{ t('vercel.checks.none') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.name') }}</th>
              <th>{{ t('vercel.col.status') }}</th>
              <th>{{ t('vercel.col.conclusion') }}</th>
              <th>{{ t('vercel.col.completedAt') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in vercelStore.checks" :key="c.id">
                <td class="fw-medium">{{ c.name }}</td>
                <td><span :class="checkStatusClass(c.status)">{{ c.status }}</span></td>
                <td>
                  <span v-if="c.conclusion" :class="conclusionClass(c.conclusion)">{{ c.conclusion }}</span>
                  <span v-else class="text-dim">—</span>
                </td>
                <td class="text-dim">{{ formatDate(c.completedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── DNS Records ──────────────────────────────────────────────────── -->
      <div v-show="activeService === 'dns-records'" class="tab-panel">
        <div v-if="!vercelStore.selectedDomain" class="empty-row text-dim">
          {{ t('vercel.dns.noDomain') }}
        </div>
        <template v-else>
          <div class="context-banner">
            <span>{{ t('vercel.dns.contextLabel') }}</span>
            <strong>{{ vercelStore.selectedDomain }}</strong>
            <button class="btn sm" style="margin-left:auto" @click="vercelStore.fetchDnsRecords(vercelStore.selectedDomain)">
              <i data-lucide="refresh-cw"></i>
            </button>
          </div>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredDnsRecords.length" class="empty-row">{{ t('vercel.dns.none') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.type') }}</th>
              <th>{{ t('vercel.col.name') }}</th>
              <th>{{ t('vercel.col.value') }}</th>
              <th>TTL</th>
              <th>{{ t('vercel.col.updated') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in filteredDnsRecords" :key="r.id">
                <td><span class="badge-preview">{{ r.type }}</span></td>
                <td class="mono-xs">{{ r.name || '@' }}</td>
                <td class="mono-xs" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="r.value">{{ r.value }}</td>
                <td class="text-dim">{{ r.ttl ?? '—' }}</td>
                <td class="text-dim">{{ formatDate(r.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Aliases ──────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'aliases'" class="tab-panel">
        <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
        <div v-else-if="!filteredAliases.length" class="empty-row">{{ search ? t('vercel.noMatches') : t('vercel.aliases.none') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th>{{ t('vercel.col.alias') }}</th>
            <th>{{ t('vercel.col.project') }}</th>
            <th>{{ t('vercel.col.deployment') }}</th>
            <th>{{ t('vercel.col.created') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="a in filteredAliases" :key="a.uid">
              <td class="fw-medium mono-xs">{{ a.alias }}</td>
              <td class="text-dim">{{ a.projectId || '—' }}</td>
              <td>
                <a
                  v-if="a.deployment?.url"
                  :href="`https://${a.deployment.url}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link-dim"
                  @click.stop
                >{{ a.deployment.url }}</a>
                <span v-else class="text-dim mono-xs">{{ a.deployment?.id || '—' }}</span>
              </td>
              <td class="text-dim">{{ formatDate(a.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Cron Jobs ────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'cron'" class="tab-panel">
        <div v-if="!vercelStore.selectedProject" class="empty-row text-dim">{{ t('vercel.noProjectSelected') }}</div>
        <template v-else>
          <div class="context-banner">
            <span>{{ t('vercel.cron.contextLabel') }}</span>
            <strong>{{ vercelStore.selectedProject.name }}</strong>
          </div>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredCronJobs.length" class="empty-row">{{ search ? t('vercel.noMatches') : t('vercel.cron.none') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.path') }}</th>
              <th>{{ t('vercel.col.schedule') }}</th>
              <th>{{ t('vercel.col.active') }}</th>
              <th>{{ t('vercel.col.created') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="j in filteredCronJobs" :key="j.path">
                <td class="fw-medium mono-xs">{{ j.path }}</td>
                <td class="mono-xs">{{ j.schedule }}</td>
                <td>
                  <span :class="j.active ? 'badge-ok' : 'badge-warn'">{{ j.active ? 'Active' : 'Inactive' }}</span>
                </td>
                <td class="text-dim">{{ formatDate(j.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Webhooks ─────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'webhooks'" class="tab-panel">
        <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
        <div v-else-if="!filteredWebhooks.length" class="empty-row">{{ search ? t('vercel.noMatches') : t('vercel.webhooks.none') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th>{{ t('vercel.col.url') }}</th>
            <th>{{ t('vercel.webhooks.events') }}</th>
            <th>{{ t('vercel.webhooks.projects') }}</th>
            <th>{{ t('vercel.col.created') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="w in filteredWebhooks" :key="w.id">
              <td class="mono-xs fw-medium" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="w.url">{{ w.url }}</td>
              <td>
                <span
                  v-for="ev in (w.events || [])" :key="ev"
                  class="badge-preview" style="margin-right:4px;font-size:10px"
                >{{ ev }}</span>
                <span v-if="!w.events?.length" class="text-dim">—</span>
              </td>
              <td class="text-dim">{{ w.projectIds?.length || 0 }}</td>
              <td class="text-dim">{{ formatDate(w.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Edge Config ──────────────────────────────────────────────────── -->
      <div v-show="activeService === 'edge-config'" class="tab-panel">
        <!-- Store list -->
        <template v-if="!vercelStore.selectedEdgeConfig">
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredEdgeConfigs.length" class="empty-row">{{ search ? t('vercel.noMatches') : t('vercel.edgeConfig.none') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.name') }}</th>
              <th>{{ t('vercel.edgeConfig.itemCount') }}</th>
              <th>{{ t('vercel.col.updated') }}</th>
              <th>{{ t('vercel.col.actions') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="ec in filteredEdgeConfigs" :key="ec.id" style="cursor:pointer" @click="openEdgeConfig(ec)">
                <td>
                  <div class="fw-medium">{{ ec.slug }}</div>
                  <div class="text-dim mono-xs">{{ ec.id }}</div>
                </td>
                <td class="text-dim">{{ ec.itemCount ?? '—' }}</td>
                <td class="text-dim">{{ formatDate(ec.updatedAt) }}</td>
                <td>
                  <button class="btn sm" @click.stop="openEdgeConfig(ec)">{{ t('vercel.edgeConfig.viewItems') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <!-- Items view -->
        <template v-else>
          <div class="context-banner">
            <button class="btn sm" @click="vercelStore.selectedEdgeConfig = null">← {{ t('vercel.back') }}</button>
            <span>{{ t('vercel.edgeConfig.contextLabel') }}</span>
            <strong>{{ vercelStore.selectedEdgeConfig.slug }}</strong>
          </div>
          <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
          <div v-else-if="!filteredEdgeConfigItems.length" class="empty-row">{{ search ? t('vercel.noMatches') : t('vercel.edgeConfig.noItems') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('vercel.col.key') }}</th>
              <th>{{ t('vercel.col.value') }}</th>
              <th>{{ t('vercel.col.updated') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="item in filteredEdgeConfigItems" :key="item.key">
                <td class="fw-medium mono-xs">{{ item.key }}</td>
                <td class="mono-xs" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="JSON.stringify(item.value)">{{ JSON.stringify(item.value) }}</td>
                <td class="text-dim">{{ formatDate(item.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── Activity ─────────────────────────────────────────────────────── -->
      <div v-show="activeService === 'activity'" class="tab-panel">
        <div v-if="vercelStore.loading" class="empty-row">{{ t('vercel.loading') }}</div>
        <div v-else-if="!filteredEvents.length" class="empty-row">{{ search ? t('vercel.noMatches') : t('vercel.activity.none') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th>{{ t('vercel.col.event') }}</th>
            <th>{{ t('vercel.col.user') }}</th>
            <th>{{ t('vercel.col.created') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="ev in filteredEvents" :key="ev.id">
              <td>
                <div class="fw-medium">{{ ev.type }}</div>
                <div v-if="ev.text" class="text-dim" style="font-size:11px">{{ ev.text }}</div>
              </td>
              <td>
                <div v-if="ev.user">
                  <div class="fw-medium">{{ ev.user.name || ev.user.username }}</div>
                  <div class="text-dim" style="font-size:11px">{{ ev.user.email }}</div>
                </div>
                <span v-else class="text-dim">—</span>
              </td>
              <td class="text-dim" style="white-space:nowrap">{{ formatDate(ev.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Logs panel ───────────────────────────────────────────────────── -->
      <VercelDeploymentLogs
        v-if="logsDeployment"
        :deployment="logsDeployment"
        :profile-id="vercelStore.activeProfileId"
        @close="logsDeployment = null"
      />

      <!-- ── Action confirm modal ─────────────────────────────────────────── -->
      <Teleport to="body">
        <div v-if="confirmAction" class="modal-overlay" @mousedown.self="confirmAction = null">
          <div class="modal-box" style="width:400px">
            <div class="modal-header">
              <span>{{ confirmAction.title }}</span>
              <button class="btn-close" @click="confirmAction = null">✕</button>
            </div>
            <div class="modal-body">{{ confirmAction.message }}</div>
            <div class="modal-footer">
              <button class="btn" @click="confirmAction = null">{{ t('action.cancel') }}</button>
              <button
                :class="['btn', confirmAction.danger ? 'danger' : 'primary']"
                :disabled="actionPending"
                @click="confirmAction.run()"
              >
                {{ actionPending ? t('vercel.pending') : confirmAction.label }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useVercelStore } from '../../stores/useVercelStore'
import { useI18n }        from '../../composables/useI18n.js'
import VercelDeploymentLogs from './VercelDeploymentLogs.vue'

const props = defineProps({
  activeService: { type: String, default: 'projects' },
})

const { t }       = useI18n()
const vercelStore = useVercelStore()

const search                      = ref('')
const deploymentTarget            = ref('')
const logsDeployment              = ref(null)
const selectedDeploymentForFunctions = ref(null)
const selectedDeploymentForChecks    = ref(null)
const confirmAction               = ref(null)
const actionPending               = ref(false)

// ─── Load data when tab/profile changes ──────────────────────────────────────

watch(
  () => [props.activeService, vercelStore.activeProfileId],
  ([service, profileId]) => {
    if (!profileId) return
    reload(service)
  },
  { immediate: true }
)

function reload(service) {
  const svc = service || props.activeService
  if (svc === 'projects')    vercelStore.fetchProjects()
  else if (svc === 'deployments' && vercelStore.selectedProject)
    vercelStore.fetchDeployments(vercelStore.selectedProject.id, { target: deploymentTarget.value })
  else if (svc === 'domains' && vercelStore.selectedProject)
    vercelStore.fetchDomains(vercelStore.selectedProject.id)
  else if (svc === 'env-vars' && vercelStore.selectedProject)
    vercelStore.fetchEnvVars(vercelStore.selectedProject.id)
  else if (svc === 'functions' && selectedDeploymentForFunctions.value)
    vercelStore.fetchFunctions(selectedDeploymentForFunctions.value.id)
  else if (svc === 'checks' && selectedDeploymentForChecks.value)
    vercelStore.fetchChecks(selectedDeploymentForChecks.value.id)
  else if (svc === 'dns-records' && vercelStore.selectedDomain)
    vercelStore.fetchDnsRecords(vercelStore.selectedDomain)
  else if (svc === 'aliases')
    vercelStore.fetchAliases()
  else if (svc === 'cron' && vercelStore.selectedProject)
    vercelStore.fetchCronJobs(vercelStore.selectedProject.id)
  else if (svc === 'webhooks')
    vercelStore.fetchWebhooks()
  else if (svc === 'edge-config')
    vercelStore.fetchEdgeConfigs()
  else if (svc === 'activity')
    vercelStore.fetchEvents()
}

function reloadDeployments() {
  if (!vercelStore.selectedProject) return
  vercelStore.fetchDeployments(vercelStore.selectedProject.id, { target: deploymentTarget.value })
}

// ─── Project selection ───────────────────────────────────────────────────────

function handleSelectProject(project) {
  vercelStore.selectProject(project)
}

function loadProjectDeployments(project) {
  vercelStore.selectProject(project)
  deploymentTarget.value = ''
  vercelStore.fetchDeployments(project.id)
}

function loadProjectDomains(project) {
  vercelStore.selectProject(project)
  vercelStore.fetchDomains(project.id)
}

function loadProjectEnvVars(project) {
  vercelStore.selectProject(project)
  vercelStore.fetchEnvVars(project.id)
}

function loadProjectCron(project) {
  vercelStore.selectProject(project)
  vercelStore.fetchCronJobs(project.id)
}

// ─── Deployment actions ───────────────────────────────────────────────────────

function openLogs(deployment) {
  logsDeployment.value = deployment
}

function viewFunctions(deployment) {
  selectedDeploymentForFunctions.value = deployment
  vercelStore.fetchFunctions(deployment.id)
}

function viewChecks(deployment) {
  selectedDeploymentForChecks.value = deployment
  vercelStore.fetchChecks(deployment.id)
}

function openEdgeConfig(ec) {
  vercelStore.selectedEdgeConfig = ec
  vercelStore.fetchEdgeConfigItems(ec.id)
}

function loadDnsRecords(domain) {
  vercelStore.selectedDomain = domain.name
  vercelStore.fetchDnsRecords(domain.name)
}

function triggerRedeploy(deployment) {
  confirmAction.value = {
    title:   t('vercel.confirm.redeployTitle'),
    message: t('vercel.confirm.redeployMsg', { id: deployment.id }),
    label:   t('vercel.action.redeploy'),
    danger:  false,
    run: async () => {
      actionPending.value = true
      const result = await vercelStore.redeployDeployment(deployment.id)
      actionPending.value = false
      confirmAction.value = null
      if (result && vercelStore.selectedProject)
        await vercelStore.fetchDeployments(vercelStore.selectedProject.id)
    },
  }
}

function triggerPromote(deployment) {
  if (!vercelStore.selectedProject) return
  confirmAction.value = {
    title:   t('vercel.confirm.promoteTitle'),
    message: t('vercel.confirm.promoteMsg', { id: deployment.id }),
    label:   t('vercel.action.promote'),
    danger:  false,
    run: async () => {
      actionPending.value = true
      await vercelStore.promoteDeployment(deployment.id, vercelStore.selectedProject.id)
      actionPending.value = false
      confirmAction.value = null
      await vercelStore.fetchDeployments(vercelStore.selectedProject.id)
    },
  }
}

function triggerCancel(deployment) {
  confirmAction.value = {
    title:   t('vercel.confirm.cancelTitle'),
    message: t('vercel.confirm.cancelMsg', { id: deployment.id }),
    label:   t('vercel.action.cancel'),
    danger:  true,
    run: async () => {
      actionPending.value = true
      await vercelStore.cancelDeployment(deployment.id)
      actionPending.value = false
      confirmAction.value = null
      if (vercelStore.selectedProject)
        await vercelStore.fetchDeployments(vercelStore.selectedProject.id)
    },
  }
}

// ─── Filtering ────────────────────────────────────────────────────────────────

const filteredProjects = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.projects
  return vercelStore.projects.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.id?.toLowerCase().includes(q) ||
    p.framework?.toLowerCase().includes(q) ||
    p.link?.repo?.toLowerCase().includes(q)
  )
})

const filteredDeployments = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.deployments
  return vercelStore.deployments.filter(d =>
    d.id?.toLowerCase().includes(q) ||
    d.name?.toLowerCase().includes(q) ||
    d.url?.toLowerCase().includes(q) ||
    d.state?.toLowerCase().includes(q)
  )
})

const filteredDomains = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.domains
  return vercelStore.domains.filter(d =>
    d.name?.toLowerCase().includes(q) ||
    d.apexName?.toLowerCase().includes(q)
  )
})

const filteredEnvVars = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.envVars
  return vercelStore.envVars.filter(e => e.key?.toLowerCase().includes(q))
})

const filteredFunctions = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.functions
  return vercelStore.functions.filter(f =>
    f.name?.toLowerCase().includes(q) ||
    f.type?.toLowerCase().includes(q)
  )
})

const filteredDnsRecords = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.dnsRecords
  return vercelStore.dnsRecords.filter(r =>
    r.type?.toLowerCase().includes(q) ||
    r.name?.toLowerCase().includes(q) ||
    r.value?.toLowerCase().includes(q)
  )
})

const filteredAliases = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.aliases
  return vercelStore.aliases.filter(a =>
    a.alias?.toLowerCase().includes(q) ||
    a.projectId?.toLowerCase().includes(q) ||
    a.deployment?.url?.toLowerCase().includes(q)
  )
})

const filteredCronJobs = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.cronJobs
  return vercelStore.cronJobs.filter(j =>
    j.path?.toLowerCase().includes(q) ||
    j.schedule?.toLowerCase().includes(q)
  )
})

const filteredWebhooks = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.webhooks
  return vercelStore.webhooks.filter(w =>
    w.url?.toLowerCase().includes(q) ||
    w.events?.some(ev => ev.toLowerCase().includes(q))
  )
})

const filteredEdgeConfigs = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.edgeConfigs
  return vercelStore.edgeConfigs.filter(e =>
    e.slug?.toLowerCase().includes(q) ||
    e.id?.toLowerCase().includes(q)
  )
})

const filteredEdgeConfigItems = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.edgeConfigItems
  return vercelStore.edgeConfigItems.filter(i =>
    i.key?.toLowerCase().includes(q) ||
    JSON.stringify(i.value)?.toLowerCase().includes(q)
  )
})

const filteredEvents = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return vercelStore.events
  return vercelStore.events.filter(ev =>
    ev.type?.toLowerCase().includes(q) ||
    ev.user?.name?.toLowerCase().includes(q) ||
    ev.user?.email?.toLowerCase().includes(q) ||
    ev.text?.toLowerCase().includes(q)
  )
})

const activeRowCount = computed(() => {
  const s = props.activeService
  if (s === 'projects')     return filteredProjects.value.length
  if (s === 'deployments')  return filteredDeployments.value.length
  if (s === 'domains')      return filteredDomains.value.length
  if (s === 'env-vars')     return filteredEnvVars.value.length
  if (s === 'functions')    return filteredFunctions.value.length
  if (s === 'checks')       return vercelStore.checks.length
  if (s === 'dns-records')  return filteredDnsRecords.value.length
  if (s === 'aliases')      return filteredAliases.value.length
  if (s === 'cron')         return filteredCronJobs.value.length
  if (s === 'webhooks')     return filteredWebhooks.value.length
  if (s === 'edge-config')  return vercelStore.selectedEdgeConfig ? filteredEdgeConfigItems.value.length : filteredEdgeConfigs.value.length
  if (s === 'activity')     return filteredEvents.value.length
  return 0
})

// ─── Styling helpers ──────────────────────────────────────────────────────────

function stateClass(state) {
  const s = (state || '').toUpperCase()
  if (s === 'READY')    return 'state-ready'
  if (s === 'ERROR')    return 'state-error'
  if (s === 'BUILDING') return 'state-building'
  if (s === 'QUEUED')   return 'state-queued'
  if (s === 'CANCELED') return 'state-canceled'
  return 'state-unknown'
}

function checkStatusClass(status) {
  const s = (status || '').toLowerCase()
  if (s === 'completed') return 'state-ready'
  if (s === 'running')   return 'state-building'
  if (s === 'registered') return 'state-queued'
  return 'state-unknown'
}

function conclusionClass(conclusion) {
  const c = (conclusion || '').toLowerCase()
  if (c === 'succeeded') return 'state-ready'
  if (c === 'failed')    return 'state-error'
  if (c === 'canceled')  return 'state-canceled'
  if (c === 'skipped')   return 'state-unknown'
  return 'state-unknown'
}

function formatDate(val) {
  if (!val) return '—'
  const d = new Date(typeof val === 'number' ? val : val)
  return d.toLocaleString()
}
</script>

<style scoped>
.fw-medium   { font-weight: 500; }
.mono-xs     { font-family: monospace; font-size: 11px; }
.link-dim    { color: var(--accent, #7c9ef8); text-decoration: none; font-size: 12px; }
.link-dim:hover { text-decoration: underline; }

/* Deployment state badges */
.state-ready    { color: #4ade80; font-weight: 600; font-size: 12px; }
.state-error    { color: #f87171; font-weight: 600; font-size: 12px; }
.state-building { color: #60a5fa; font-weight: 600; font-size: 12px; }
.state-queued   { color: #fbbf24; font-weight: 600; font-size: 12px; }
.state-canceled { color: var(--text-dim, #888); font-weight: 600; font-size: 12px; }
.state-unknown  { color: var(--text-dim, #888); font-size: 12px; }

.badge-prod    { background: rgba(74,222,128,.15); color: #4ade80; border: 1px solid rgba(74,222,128,.3); border-radius: 4px; padding: 1px 6px; font-size: 11px; }
.badge-preview { background: rgba(251,191,36,.12); color: #fbbf24; border: 1px solid rgba(251,191,36,.3); border-radius: 4px; padding: 1px 6px; font-size: 11px; }
.badge-ok      { background: rgba(74,222,128,.15); color: #4ade80; border: 1px solid rgba(74,222,128,.3); border-radius: 4px; padding: 1px 6px; font-size: 11px; }
.badge-warn    { background: rgba(251,191,36,.12); color: #fbbf24; border: 1px solid rgba(251,191,36,.3); border-radius: 4px; padding: 1px 6px; font-size: 11px; }

.context-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-alt, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  margin-bottom: 10px;
  font-size: 13px;
}

.row-selected td { background: var(--bg-alt, #1e1e2e); }

.btn.active {
  background: var(--accent, #5b6ef5);
  color: #fff;
}
</style>

<template>
  <div id="app">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="header">
      <div class="header-left">
        <span class="app-logo" title="Know Unified Administration">
          <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="border-radius:5px;flex-shrink:0">
            <rect width="32" height="32" rx="6" fill="#252526"/>
            <path fill="#0e9de8" d="M7,5 L12,5 L12,13.5 L25,5 L28.5,5 L15.5,16.5 L28.5,27 L25,27 L12,18.5 L12,27 L7,27 Z"/>
          </svg>
          <span>KUA</span><span class="app-logo-sub">Know Unified Administration</span>
        </span>
        <div class="provider-tabs">
          <button :class="['provider-tab', { active: activeProvider === 'kubernetes' }]" title="Kubernetes" aria-label="Kubernetes" @click="setProvider('kubernetes')">
            <i data-lucide="box"></i> Kubernetes
          </button>
          <button :class="['provider-tab', { active: activeProvider === 'aws' }]" title="AWS" aria-label="AWS" @click="setProvider('aws')">
            <i data-lucide="cloud"></i> AWS
          </button>
          <button :class="['provider-tab', { active: activeProvider === 'gcp' }]" title="GCP" aria-label="GCP" @click="setProvider('gcp')">
            <i data-lucide="cloud-cog"></i> GCP
          </button>
          <button :class="['provider-tab', { active: activeProvider === 'vercel' }]" title="Vercel" aria-label="Vercel" @click="setProvider('vercel')">
            <svg width="14" height="14" viewBox="0 0 76 65" fill="currentColor" style="display:inline-block;vertical-align:middle;margin-right:4px"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>
            Vercel
          </button>
          <button :class="['provider-tab', { active: activeProvider === 'kuapps' }]" title="KUApps" aria-label="KUApps" @click="setProvider('kuapps')">
            <i data-lucide="boxes"></i> KUApps
          </button>
        </div>
        <template v-if="activeProvider === 'kubernetes'">
          <button ref="kubeNavToggleRef" class="btn btn-icon kube-nav-toggle" :aria-expanded="kubeNavOpen" aria-controls="kube-nav" :title="t('nav.kubeResources')" :aria-label="t('nav.kubeResources')" @click="kubeNavOpen = !kubeNavOpen"><i data-lucide="menu"></i></button>
          <span :class="['kube-env-badge', `env-${kubeEnvironment || 'unknown'}`]" :title="store.currentContext" data-test="kube-env-badge">{{ t(`kubeAction.env.${kubeEnvironment || 'unknown'}`) }}</span>
          <select class="ctrl-select kube-context-select" v-model="selectedContext" :title="selectedContext" :aria-label="t('nav.kubeContext')" @change="switchContext">
            <option v-for="c in store.contexts" :key="c.name" :value="c.name" :title="c.name">{{ shortContextName(c.name) }}</option>
          </select>
          <select class="ctrl-select kube-context-select" v-model="store.namespace" :aria-label="t('nav.kubeNamespace')" @change="store.loadResources()">
            <option value="all">{{ t('nav.allNamespaces') }}</option>
            <option v-for="n in store.namespaces" :key="n" :value="n">{{ n }}</option>
          </select>
        </template>
        <template v-else-if="activeProvider === 'aws'">
          <select class="ctrl-select" v-model="awsProfileId" @change="onAwsProfileChange">
            <option value="">{{ t('aws.noProfile') }}</option>
            <optgroup v-if="envStore.awsProfiles.length" :label="t('nav.storedProfiles')">
              <option v-for="p in envStore.awsProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
            <optgroup v-if="awsLocalProfiles.length" label="~/.aws/credentials">
              <option v-for="p in awsLocalProfiles" :key="`local:${p.name}`" :value="`local:${p.name}`">
                {{ p.name }}{{ p.region ? ` (${p.region})` : '' }}
              </option>
            </optgroup>
          </select>
        </template>
        <template v-else-if="activeProvider === 'gcp'">
          <select class="ctrl-select" v-model="gcpProfileId" @change="onGcpProfileChange">
            <option value="">{{ t('gcp.noProfile') }}</option>
            <optgroup v-if="envStore.gcpProfiles.length" :label="t('nav.storedProfiles')">
              <option v-for="p in envStore.gcpProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
            <optgroup v-if="gcpLocalConfigs.length" :label="t('nav.gcpConfigs')">
              <option v-for="c in gcpLocalConfigs" :key="`local:${c.name}`" :value="`local:${c.name}`">
                {{ c.name }}{{ c.project ? ` (${c.project})` : '' }}
              </option>
            </optgroup>
          </select>
        </template>
        <template v-else-if="activeProvider === 'vercel'">
          <select class="ctrl-select" v-model="vercelProfileId" @change="onVercelProfileChange">
            <option value="">{{ t('vercel.noProfile') }}</option>
            <optgroup v-if="envStore.vercelProfiles.length" :label="t('nav.storedProfiles')">
              <option v-for="p in envStore.vercelProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </optgroup>
          </select>
          <VercelProjectSelector />
        </template>
        <template v-else-if="activeProvider === 'kuapps' && activeApplicationContext">
          <span class="header-application-context">
            <i data-lucide="boxes"></i>
            <span><strong>{{ activeApplicationContext.name || activeApplicationContext.id }}</strong><small>{{ activeApplicationContext.provider ? activeApplicationContext.provider.toUpperCase() : t('kuapps.multiProvider') }} · {{ activeApplicationContext.environment || 'Application' }}<template v-if="activeApplicationContext.team"> · {{ activeApplicationContext.team }}</template></small></span>
          </span>
        </template>
        <template v-else-if="activeProvider === 'kuapps'">
          <span class="header-architecture-hint">Select a KUA application below</span>
        </template>
      </div>
      <div class="header-right">
        <template v-if="activeProvider === 'kubernetes'">
          <button class="btn sm" :class="{ primary: pfPanelVisible }" @click="pfPanelVisible = !pfPanelVisible" title="Port Forwards">
            <i data-lucide="cable"></i>
            <span v-if="pfStore.list.length" class="badge-count">{{ pfStore.list.length }}</span>
          </button>
          <button class="btn btn-icon" :title="t('nav.importKubeconfig')" @click="modals.kubeconfig = true"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteContext')" @click="deleteContextConfirm"><i data-lucide="trash-2"></i></button>
        </template>
        <template v-else-if="activeProvider === 'aws'">
          <button class="btn btn-icon" :title="t('nav.addAws')" @click="openAddConnection('aws')"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteAws')" :disabled="!awsProfileId || awsProfileId.startsWith('local:')" @click="deleteConnectionConfirm('aws')"><i data-lucide="trash-2"></i></button>
        </template>
        <template v-else-if="activeProvider === 'gcp'">
          <button class="btn btn-icon" :title="t('nav.addGcp')" @click="openAddConnection('gcp')"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteGcp')" :disabled="!gcpProfileId || gcpProfileId.startsWith('local:')" @click="deleteConnectionConfirm('gcp')"><i data-lucide="trash-2"></i></button>
        </template>
        <template v-else-if="activeProvider === 'vercel'">
          <button class="btn btn-icon" :title="t('nav.addVercel')" @click="openAddConnection('vercel')"><i data-lucide="plus-circle"></i></button>
          <button class="btn btn-icon" :title="t('nav.deleteVercel')" :disabled="!vercelProfileId" @click="deleteConnectionConfirm('vercel')"><i data-lucide="trash-2"></i></button>
        </template>
        <button class="btn btn-icon" :class="{ primary: cloudView === 'envs' }" :title="t('nav.envManager')" @click="toggleEnvManager"><i data-lucide="key-round"></i></button>
        <button class="btn btn-icon" :title="t('nav.localShell')" @click="openLocalShell()"><i data-lucide="terminal"></i></button>
        <button class="btn btn-icon" :class="{ primary: cloudView === 'console' }" :title="t('nav.console')" @click="toggleConsole"><i data-lucide="square-terminal"></i></button>
        <button class="btn btn-icon" :class="{ primary: backgroundTasksVisible }" :title="t('nav.backgroundTasks')" :aria-label="t('nav.backgroundTasks')" data-test="open-background-tasks" @click="backgroundTasksVisible = !backgroundTasksVisible"><i data-lucide="list-checks"></i></button>
        <button class="btn btn-icon btn-lang" @click="toggleLang" :title="settings.lang === 'es' ? 'Switch to English' : 'Cambiar a Español'">
          <span class="lang-flag">{{ settings.lang === 'es' ? '🇪🇸' : '🇺🇸' }}</span>
        </button>
        <button class="btn btn-icon" @click="toggleTheme" :title="settings.theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')">
          <i :data-lucide="settings.theme === 'dark' ? 'sun' : 'moon'"></i>
        </button>
        <AlertsBell :profile-name="profileNameById" />
        <button class="btn btn-icon" :class="{ primary: cloudView === 'audit' }" :title="t('nav.auditLog')" @click="toggleAuditLog"><i data-lucide="shield-check"></i></button>
        <button class="btn btn-icon" @click="modals.help = true" :title="t('nav.help')"><i data-lucide="help-circle"></i></button>
        <button class="btn btn-icon btn-donate" @click="openSponsor" :title="t('nav.supportProject')">
          <i data-lucide="heart"></i>
        </button>
      </div>
    </header>

    <!-- ── CLI tools notice ──────────────────────────────────────────────── -->
    <CliToolsNotice />

    <!-- ── Body ──────────────────────────────────────────────────────────── -->
    <div class="page-body">
      <div class="layout">
        <!-- Kubernetes sidebar -->
        <div v-if="activeProvider === 'kubernetes' && kubeNavOpen" class="kube-nav-backdrop" @click="closeKubeNav"></div>
        <nav id="kube-nav" ref="kubeNavRef" :class="['sidebar', 'kube-nav', { open: kubeNavOpen }]" v-if="activeProvider === 'kubernetes'" :aria-label="t('nav.kubeResources')" :inert="narrowLayout && !kubeNavOpen ? true : undefined" @keydown.esc="closeKubeNav">
          <div class="sidebar-section">
            <button type="button" :class="['sidebar-item', { active: cloudView === 'kube-overview' }]"
               @click="setCloudView('kube-overview')" :aria-current="(cloudView === 'kube-overview') ? 'page' : undefined">{{ t('sidebar.overview') }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.workloads') }}</div>
            <button type="button" v-for="r in ['pods','deployments','statefulsets','daemonsets','replicasets','jobs','cronjobs']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click="setResource(r)" :aria-current="(cloudView === null && store.resource === r) ? 'page' : undefined">{{ LABELS[r] }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.network') }}</div>
            <button type="button" v-for="r in ['services','endpointslices','endpoints','ingresses','ingressclasses','networkpolicies']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click="setResource(r)" :aria-current="(cloudView === null && store.resource === r) ? 'page' : undefined">{{ LABELS[r] }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.config') }}</div>
            <button type="button" v-for="r in ['configmaps','secrets','resourcequotas','limitranges','hpas','pdbs','priorityclasses','runtimeclasses','leases','mutatingwebhookconfigurations','validatingwebhookconfigurations']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click="setResource(r)" :aria-current="(cloudView === null && store.resource === r) ? 'page' : undefined">{{ LABELS[r] }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.storage') }}</div>
            <button type="button" v-for="r in ['pvcs','pvs','storageclasses']" :key="r"
              :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
              @click="setResource(r)" :aria-current="(cloudView === null && store.resource === r) ? 'page' : undefined">{{ LABELS[r] }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.cluster') }}</div>
            <button type="button" v-for="r in ['nodes','namespaces','events']" :key="r"
               :class="['sidebar-item', { active: cloudView === null && store.resource === r }]"
               @click="setResource(r)" :aria-current="(cloudView === null && store.resource === r) ? 'page' : undefined">{{ LABELS[r] }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.logs') }}</div>
            <button type="button" :class="['sidebar-item', { active: cloudView === 'kube-logs' }]" data-test="sidebar-kube-logs"
               @click="setCloudView('kube-logs')" :aria-current="(cloudView === 'kube-logs') ? 'page' : undefined">{{ t('sidebar.logsIntelligence') }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.helm') }}</div>
            <button type="button" :class="['sidebar-item', { active: cloudView === 'helm' }]"
               @click="setCloudView('helm')" :aria-current="(cloudView === 'helm') ? 'page' : undefined">{{ t('sidebar.releases') }}</button>
            <button type="button" :class="['sidebar-item', { active: cloudView === 'helm-repos' }]"
               @click="setCloudView('helm-repos')" :aria-current="(cloudView === 'helm-repos') ? 'page' : undefined">{{ t('sidebar.repositories') }}</button>
          </div>
        </nav>

        <!-- AWS sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'aws'">
          <div class="sidebar-section">
            <button type="button" :class="['sidebar-item', { active: awsTab === 'overview' }]"
               @click="awsTab = 'overview'" :aria-current="(awsTab === 'overview') ? 'page' : undefined">{{ t('sidebar.overview') }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.compute') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.compute" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.containers') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.containers" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.networking') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.networking" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.storage') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.storage" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.database') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.database" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.analytics') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.analytics" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.integration') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.integration" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">AI</div>
            <button type="button" v-for="r in AWS_SIDEBAR.ai" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.security') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.security" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.monitoring') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.monitoring" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.management') }}</div>
            <button type="button" v-for="r in AWS_SIDEBAR.management" :key="r.id"
               :class="['sidebar-item', { active: awsTab === r.id }]"
               @click="awsTab = r.id" :aria-current="(awsTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
        </nav>

        <!-- Vercel sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'vercel'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('vercel.sidebar.projects') }}</div>
            <button type="button" v-for="r in VERCEL_SIDEBAR.projects" :key="r.id"
               :class="['sidebar-item', { active: vercelTab === r.id }]"
               @click="vercelTab = r.id" :aria-current="(vercelTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('vercel.sidebar.deployments') }}</div>
            <button type="button" v-for="r in VERCEL_SIDEBAR.deployments" :key="r.id"
               :class="['sidebar-item', { active: vercelTab === r.id }]"
               @click="vercelTab = r.id" :aria-current="(vercelTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('vercel.sidebar.config') }}</div>
            <button type="button" v-for="r in VERCEL_SIDEBAR.config" :key="r.id"
               :class="['sidebar-item', { active: vercelTab === r.id }]"
               @click="vercelTab = r.id" :aria-current="(vercelTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('vercel.sidebar.advanced') }}</div>
            <button type="button" v-for="r in VERCEL_SIDEBAR.advanced" :key="r.id"
               :class="['sidebar-item', { active: vercelTab === r.id }]"
               @click="vercelTab = r.id" :aria-current="(vercelTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('vercel.sidebar.account') }}</div>
            <button type="button" v-for="r in VERCEL_SIDEBAR.account" :key="r.id"
               :class="['sidebar-item', { active: vercelTab === r.id }]"
               @click="vercelTab = r.id" :aria-current="(vercelTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
        </nav>

        <!-- GCP sidebar -->
        <nav class="sidebar" v-if="activeProvider === 'gcp'">
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.compute') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.compute" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.database') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.database" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.storage') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.storage" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.serverless') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.serverless" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.messaging') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.messaging" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.security') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.security" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.analytics') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.analytics" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.workflows') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.workflows" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.networking') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.networking" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.cache') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.cache" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.async') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.async" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.devops') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.devops" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
          <div class="sidebar-section">
            <div class="sidebar-section-title">{{ t('sidebar.iam') }}</div>
            <button type="button" v-for="r in GCP_SIDEBAR.iam" :key="r.id"
               :class="['sidebar-item', { active: gcpTab === r.id }]"
               @click="gcpTab = r.id" :aria-current="(gcpTab === r.id) ? 'page' : undefined">{{ r.label }}</button>
          </div>
        </nav>

        <main class="main">
          <EnvManagerView v-if="cloudView === 'envs'" />
          <AuditLogView  v-else-if="cloudView === 'audit'" />
          <ConsoleWorkspaceView v-else-if="cloudView === 'console'" />
          <KubeOverview ref="kubeOverviewRef" v-else-if="cloudView === 'kube-overview' && activeProvider === 'kubernetes'" @navigate="openKubeFromOverview" />
          <KubeLogsView v-else-if="cloudView === 'kube-logs' && activeProvider === 'kubernetes'" />
          <HelmView ref="helmViewRef" v-else-if="cloudView === 'helm' || cloudView === 'helm-repos'" :initial-tab="cloudView === 'helm-repos' ? 'repos' : 'releases'" />
          <template v-else-if="activeProvider === 'kubernetes'">
            <div class="kube-main-split" :class="{ 'detail-open': !!selectedKubeResource, resizing: isKubeResizing }">
              <ResourceTable
                :selected-key="selectedKubeKey"
                :initial-filter="kubeResourceFilter"
                @action="handleAction"
                @select="selectKubeResource"
                @bulk-delete="openBulkDelete"
              />
              <div
                v-if="selectedKubeResource"
                class="kube-resize-handle"
                title="Ajustar panel"
                @mousedown="startKubeResize"
                @dblclick="resetKubePanelWidth"
              ></div>
              <KubeResourceDetailPanel
                v-if="selectedKubeResource"
                :resource-type="selectedKubeResource.type"
                :resource="selectedKubeResource.row"
                :style="{ width: `${kubeDetailWidth}px` }"
                @close="selectedKubeResource = null"
                @open-helm="openPrometheusHelm"
                @open-logs="openInspectorLogs"
                @open-resource="openInspectorResource"
              />
            </div>
          </template>
          <AwsView     ref="awsViewRef" v-else-if="activeProvider === 'aws'"    :active-service="awsTab" :application-id="activeApplicationContext?.provider === 'aws' ? activeApplicationContext.id : ''" :environment="activeApplicationContext?.provider === 'aws' ? activeApplicationContext.environment : ''" @open-architecture="openApplicationArchitecture" @open-kubernetes-logs="openObservabilityKubernetesLogs" @navigate-tab="tab => { awsTab = tab }" @open-observability="openApplicationObservability" :saved-filters="awsFiltersByTab" :saved-filters-seq="awsFiltersSeq" @filters-change="(tab, filters) => { awsFiltersByTab[tab] = filters }" />
          <GcpView     ref="gcpViewRef" v-else-if="activeProvider === 'gcp'"    :active-service="gcpTab" :application-id="activeApplicationContext?.provider === 'gcp' ? activeApplicationContext.id : ''" :environment="activeApplicationContext?.provider === 'gcp' ? activeApplicationContext.environment : ''" @connect-gke="handleGkeConnect" @open-architecture="openApplicationArchitecture"
            @navigate-tab="tab => { gcpTab = tab }" :saved-filters="gcpFiltersByTab" :saved-resources="gcpResourceByTab" :saved-filters-seq="gcpFiltersSeq"
            @filters-change="(tab, filters) => { gcpFiltersByTab[tab] = filters }" @resource-change="(tab, key) => { gcpResourceByTab[tab] = key }" />
          <VercelView  ref="vercelViewRef" v-else-if="activeProvider === 'vercel'" :active-service="vercelTab" :application-id="activeApplicationContext?.provider === 'vercel' ? activeApplicationContext.id : ''" :environment="activeApplicationContext?.provider === 'vercel' ? activeApplicationContext.environment : ''" @open-architecture="openApplicationArchitecture" />
          <KUAppsView
            v-else-if="activeProvider === 'kuapps'"
            ref="kuappsViewRef"
            :active-view="kuappsView"
            :profile-id="architectureProfileId"
            :application-id="activeApplicationContext?.id || ''"
            :project-id="architectureProjectId"
            :observability-provider="kuappsObservabilityProvider"
            :observability-profile-id="kuappsObservabilityProfileId"
            :focus-resource="observabilityFocus"
            compact-navigation
            @update-view="kuappsView = $event"
            @open-observability="openApplicationObservability"
            @open-architecture="openApplicationArchitecture"
            @application-context="handleKuAppsApplicationContext"
            @open-kubernetes-logs="openObservabilityKubernetesLogs"
            @open-kubernetes-detail="openKubernetesDetail"
            @open-kubernetes-pods="openArchitectureKubernetesPods"
            @open-aws-resource="openArchitectureAwsResource"
            @open-aws-logs="openArchitectureAwsLogs"
          />
          <AwsView
            ref="observabilityViewRef"
            v-else-if="activeProvider === 'observability' && observabilityProvider === 'aws'"
            :active-service="observabilitySelections.aws"
            :application-id="activeApplicationContext?.provider === 'aws' ? activeApplicationContext.id : ''"
            :apm-focus-resource="observabilityFocus"
            @open-architecture="openApplicationArchitecture"
            @open-kubernetes-logs="openObservabilityKubernetesLogs"
          />
          <GcpView
            ref="observabilityViewRef"
            v-else-if="activeProvider === 'observability' && observabilityProvider === 'gcp'"
            :active-service="observabilitySelections.gcp"
            :application-id="activeApplicationContext?.provider === 'gcp' ? activeApplicationContext.id : ''"
            :apm-focus-resource="observabilityFocus"
            @open-architecture="openApplicationArchitecture"
          />
          <VercelView
            ref="observabilityViewRef"
            v-else-if="activeProvider === 'observability' && observabilityProvider === 'vercel'"
            :active-service="observabilitySelections.vercel"
            :application-id="activeApplicationContext?.provider === 'vercel' ? activeApplicationContext.id : ''"
            :apm-focus-resource="observabilityFocus"
            @open-architecture="openApplicationArchitecture"
          />
          <ArchitectureView v-else-if="activeProvider === 'architecture'" :profile-id="architectureProfileId" :application-id="activeApplicationContext?.id || ''" :project-id="architectureProjectId" @open-observability="openApplicationObservability" @application-context="setApplicationContext" @open-kubernetes-logs="openObservabilityKubernetesLogs" @open-kubernetes-detail="openKubernetesDetail" @open-kubernetes-pods="openArchitectureKubernetesPods" @open-aws-resource="openArchitectureAwsResource" @open-aws-logs="openArchitectureAwsLogs" />
        </main>
      </div>

      <TerminalPanel @restartStream="restartStream" />
    </div>

    <PortForwardPanel :visible="pfPanelVisible" @close="pfPanelVisible = false" @add="openPfManual" />
    <BackgroundTasksPanel v-if="backgroundTasksVisible" :show="backgroundTasksVisible" @close="backgroundTasksVisible = false" />

    <div class="statusbar">
      <template v-if="activeProvider === 'kubernetes'">
        <span class="sb-item">{{ store.currentContext }}</span>
        <span class="sb-sep">|</span>
        <span class="sb-item">{{ store.namespace }}</span>
        <span class="sb-spacer"></span>
        <span class="sb-item">{{ t('status.items', { n: store.rows.length }) }}</span>
      </template>
      <template v-else>
        <span class="sb-item">{{
          activeProvider === 'aws' ? 'Amazon Web Services'
          : activeProvider === 'gcp' ? 'Google Cloud Platform'
          : activeProvider === 'vercel' ? 'Vercel'
          : activeProvider === 'kuapps' ? `KUApps / ${t('kuapps.applications')}`
          : activeProvider
        }}</span>
        <span class="sb-spacer"></span>
      </template>
      <span class="sb-sep">|</span>
      <span v-if="settings.showClock" class="sb-item">{{ clock }}</span>
    </div>

    <!-- Modals -->
    <DeleteModal      :show="modals.delete"        :message="modalData.deleteMsg"          @confirm="confirmDelete"        @close="modals.delete = false" />
    <DeleteModal      :show="modals.deleteContext"  :message="modalData.deleteContextMsg"   @confirm="confirmDeleteContext"  @close="modals.deleteContext = false" />
    <KubeActionConfirmModal :show="modals.kubeAction" :action="modalData.kubeAction"         @confirm="confirmKubeAction"     @close="modals.kubeAction = false" />
    <ScaleModal       :show="modals.scale"          :name="modalData.scaleName"              :current="modalData.scaleCurrent" :context="modalData.scalePending?.context" :namespace="modalData.scalePending?.ns" :type="modalData.scalePending?.type" @confirm="confirmScale" @close="modals.scale = false" />
    <YamlModal        :show="modals.yaml"           :title="modalData.yamlTitle"             :resource-type="modalData.yamlType" :namespace="modalData.yamlNs" :name="modalData.yamlName" :context="modalData.yamlContext" @close="modals.yaml = false" />
    <PortForwardModal :show="modals.portForward"    :namespace="modalData.pfNamespace"       :service="modalData.pfService" :ports="modalData.pfPorts" :label="modalData.pfLabel" :manual-mode="modalData.pfManual" :resource-type="modalData.pfResourceType" @close="modals.portForward = false" @started="pfPanelVisible = true" />
    <KubeconfigModal  :show="modals.kubeconfig"                                              @close="modals.kubeconfig = false" />
    <HelpModal        :show="modals.help" :initial-tab="helpTab"                             @close="modals.help = false; helpTab = ''" />
    <ProfileModal
      :show="modals.addConnection"
      :profile="null"
      :default-provider="modalData.connectionProvider"
      @close="modals.addConnection = false"
      @save="handleConnectionSave"
    />

    <DonationModal />
    <WelcomeModal />
    <UpdateNotice />
    <ToastContainer />
    <AwsSessionAlert />
  </div>
</template>

<script setup>
import { awsDestinationNotice, awsViewTarget } from './lib/awsResourceLinks'
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch, defineAsyncComponent, h } from 'vue'
import { createIcons, icons } from 'lucide'

import { useKubeStore }        from './stores/useKubeStore'
import { usePortForwardStore } from './stores/usePortForwardStore'
import { useTerminalStore }    from './stores/useTerminalStore'
import { useAwsStore }         from './stores/useAwsStore'
import { useGcpStore }         from './stores/useGcpStore'
import { useVercelStore }      from './stores/useVercelStore'
import { useEnvStore }         from './stores/useEnvStore'
import { useTerminalStreams }   from './composables/useTerminalStreams'
import { useToast }            from './composables/useToast'
import { useViewUrl }          from './composables/useViewUrl'
import { api }                 from './composables/useApi'
import { settings, applySettings } from './composables/useSettings'
import { syncServerCacheSettings } from './composables/serverCacheSettings'
import { useI18n } from './composables/useI18n'
import { applicationContextFromView, useArchitectureContext } from './composables/useArchitectureContext'
import { useAdvisorAlerts } from './composables/useAdvisorAlerts'
import { usePlan } from './composables/usePlan'
import { parseScope } from './lib/advisorAlerts'

import ResourceTable    from './components/ResourceTable.vue'
import KubeResourceDetailPanel from './components/KubeResourceDetailPanel.vue'
import KubeOverview     from './components/KubeOverview.vue'
import { loadTableView, saveTableView } from './composables/useTableViews'
import { RESOURCES } from './config/resources'
import VercelProjectSelector from './components/cloud/VercelProjectSelector.vue'
import CliToolsNotice  from './components/CliToolsNotice.vue'
import TerminalPanel    from './components/TerminalPanel.vue'
import PortForwardPanel from './components/PortForwardPanel.vue'
import DeleteModal      from './components/modals/DeleteModal.vue'
import ScaleModal       from './components/modals/ScaleModal.vue'
import KubeActionConfirmModal from './components/modals/KubeActionConfirmModal.vue'
import { contextEnvironment, shortContextName } from './lib/kubeContext'
import { kubeUrlChange, kubeUrlHref, readKubeUrl } from './lib/kubeUrl'
import YamlModal        from './components/modals/YamlModal.vue'
import PortForwardModal from './components/modals/PortForwardModal.vue'
import KubeconfigModal  from './components/modals/KubeconfigModal.vue'
import HelpModal        from './components/modals/HelpModal.vue'
import ProfileModal     from './components/modals/ProfileModal.vue'
import DonationModal    from './components/modals/DonationModal.vue'
import WelcomeModal     from './components/modals/WelcomeModal.vue'
import UpdateNotice     from './components/UpdateNotice.vue'
import ToastContainer   from './components/ToastContainer.vue'
import AwsSessionAlert  from './components/AwsSessionAlert.vue'
import AlertsBell       from './components/advisor/AlertsBell.vue'
import BackgroundTasksPanel from './components/BackgroundTasksPanel.vue'
import { useUpdateStore } from './stores/useUpdateStore'

// The views of each section load on demand, in their own chunks: the first
// paint only parses Kubernetes and the shell. A view that arrives after the
// parent drew its icons gets them drawn once it renders. A chunk that cannot
// load (Vite re-optimized its dependencies under an open window, an update
// replaced the files) shows a reload notice instead of a blank section.
const ViewLoadFailed = {
  setup: () => () => h('div', { class: 'empty-state' }, [
    h('p', t('common.viewLoadFailed')),
    h('button', { class: 'btn sm', onClick: () => location.reload() }, t('common.retry')),
  ]),
}
const lazyView = loader => defineAsyncComponent({
  loader: () => loader().then(module => {
    setTimeout(() => createIcons({ icons }))
    return module
  }),
  errorComponent: ViewLoadFailed,
  onError(error, retry, fail, attempts) {
    if (attempts <= 2) setTimeout(retry, attempts * 500)
    else { console.error('[view] could not load:', error); fail() }
  },
})
const HelmView             = lazyView(() => import('./components/HelmView.vue'))
const KubeLogsView         = lazyView(() => import('./components/cloud/logs/KubeLogsView.vue'))
const AuditLogView         = lazyView(() => import('./components/AuditLogView.vue'))
const ConsoleWorkspaceView = lazyView(() => import('./components/ConsoleWorkspaceView.vue'))
const EnvManagerView       = lazyView(() => import('./components/cloud/EnvManagerView.vue'))
const AwsView              = lazyView(() => import('./components/cloud/AwsView.vue'))
const GcpView              = lazyView(() => import('./components/cloud/GcpView.vue'))
const VercelView           = lazyView(() => import('./components/cloud/VercelView.vue'))
const ApmObservabilityView = lazyView(() => import('./components/cloud/apm/ApmObservabilityView.vue'))
const ArchitectureView     = lazyView(() => import('./components/architecture/ArchitectureView.vue'))
const KUAppsView           = lazyView(() => import('./components/kuapps/KUAppsView.vue'))

/** Resolves with a view's instance once it is mounted (a lazy view may still be loading). */
function whenMounted(viewRef, timeoutMs = 15000) {
  if (viewRef.value) return Promise.resolve(viewRef.value)
  return new Promise(resolve => {
    let stop = null
    const timer = setTimeout(() => { stop?.(); resolve(null) }, timeoutMs)
    stop = watch(viewRef, view => {
      if (!view) return
      clearTimeout(timer)
      stop()
      resolve(view)
    }, { flush: 'post' })
  })
}

const { t } = useI18n()
const updateStore = useUpdateStore()
const store     = useKubeStore()
const pfStore   = usePortForwardStore()
const termStore = useTerminalStore()
const awsStore     = useAwsStore()
const gcpStore     = useGcpStore()
const vercelStore  = useVercelStore()
const envStore     = useEnvStore()
const { startLogStream, startExecStream, startLocalStream, startSshStream, startSsmStream, startGcpLogsStream, startVercelLogsStream } = useTerminalStreams()
const { toast } = useToast()

const LABELS = {
  pods: 'Pods', deployments: 'Deployments', statefulsets: 'StatefulSets',
  daemonsets: 'DaemonSets', services: 'Services', ingresses: 'Ingresses',
  configmaps: 'ConfigMaps', secrets: 'Secrets', pvcs: 'PVC',
  replicasets: 'ReplicaSets', jobs: 'Jobs', cronjobs: 'CronJobs',
  endpointslices: 'EndpointSlices', endpoints: 'Endpoints', ingressclasses: 'IngressClasses', networkpolicies: 'NetworkPolicies',
  resourcequotas: 'ResourceQuotas', limitranges: 'LimitRanges', hpas: 'HorizontalPodAutoscalers', pdbs: 'PodDisruptionBudgets',
  priorityclasses: 'PriorityClasses', runtimeclasses: 'RuntimeClasses', leases: 'Leases',
  mutatingwebhookconfigurations: 'MutatingWebhookConfigurations', validatingwebhookconfigurations: 'ValidatingWebhookConfigurations',
  pvs: 'PersistentVolumes', storageclasses: 'StorageClasses', namespaces: 'Namespaces', nodes: 'Nodes', events: 'Events',
}

const AWS_SIDEBAR = {
  compute:     [{ id: 'ec2', label: 'EC2' }, { id: 'lambda', label: 'Lambda' }],
  containers:  [{ id: 'ecs', label: 'ECS' }, { id: 'eks', label: 'EKS' }, { id: 'ecr', label: 'ECR' }],
  networking:  [{ id: 'vpc', label: 'VPC' }, { id: 'elb', label: 'Load Balancers' }, { id: 'apigw', label: 'API Gateway' }, { id: 'cloudfront', label: 'CloudFront' }, { id: 'route53', label: 'Route 53' }],
  storage:     [{ id: 's3', label: 'S3' }],
  database:    [{ id: 'dynamodb', label: 'DynamoDB' }, { id: 'rds', label: 'RDS' }],
  analytics:   [{ id: 'glue', label: 'Glue' }, { id: 'athena', label: 'Athena' }, { id: 'datapipeline', label: 'Data Pipeline' }],
  integration: [{ id: 'eventbridge', label: 'EventBridge' }, { id: 'stepfn', label: 'Step Functions' }, { id: 'sqs', label: 'SQS' }, { id: 'sns', label: 'SNS' }, { id: 'ses', label: 'SES' }, { id: 'lex', label: 'Amazon Lex' }],
  ai:          [{ id: 'bedrock', label: 'Bedrock' }, { id: 'agentcorecfn', label: 'AgentCore CFN' }],
  security:    [{ id: 'cognito', label: 'Cognito' }, { id: 'secrets', label: 'Secrets Manager' }],
  monitoring:  [{ id: 'cwdashboards', label: 'CloudWatch Dashboards' }, { id: 'cwlogs', label: 'CloudWatch Logs' }],
  management:  [{ id: 'cloudformation', label: 'CloudFormation' }],
}

const VERCEL_SIDEBAR = {
  projects:    [{ id: 'overview',    label: 'Overview' }, { id: 'projects', label: 'Projects' }],
  deployments: [{ id: 'deployments', label: 'Deployments' }, { id: 'functions', label: 'Deployment Files' }, { id: 'checks', label: 'Checks' }],
  config:      [{ id: 'domains',     label: 'Domains' }, { id: 'dns-records', label: 'DNS Records' }, { id: 'env-vars', label: 'Env Variables' }, { id: 'aliases', label: 'Aliases' }, { id: 'cron', label: 'Cron Jobs' }],
  advanced:    [{ id: 'edge-config', label: 'Edge Config' }, { id: 'webhooks', label: 'Webhooks' }],
  account:     [{ id: 'activity',    label: 'Activity' }],
}

const GCP_SIDEBAR = {
  compute:    [{ id: 'overview', label: 'Overview' }, { id: 'cloudrun', label: 'Cloud Run' }, { id: 'gke', label: 'GKE' }, { id: 'vms', label: 'Compute VMs' }],
  database:   [{ id: 'sql', label: 'Cloud SQL' }, { id: 'firestore', label: 'Firestore' }, { id: 'spanner', label: 'Cloud Spanner' }],
  storage:    [{ id: 'storage', label: 'Storage' }, { id: 'artifact', label: 'Artifact Registry' }],
  serverless: [{ id: 'functions', label: 'Functions' }, { id: 'cloudrunJobs', label: 'Run Jobs' }],
  messaging:  [{ id: 'pubsub', label: 'Pub/Sub' }, { id: 'pubsubSubs', label: 'Subscriptions' }],
  security:   [{ id: 'secrets', label: 'Secret Manager' }, { id: 'kms', label: 'Cloud KMS' }],
  analytics:  [{ id: 'bigquery', label: 'BigQuery' }],
  workflows:  [{ id: 'workflows', label: 'Cloud Workflows' }],
  networking: [{ id: 'dns', label: 'Cloud DNS' }, { id: 'vpc', label: 'VPC Networks' }],
  cache:      [{ id: 'memorystore', label: 'Memorystore' }],
  async:      [{ id: 'tasks', label: 'Cloud Tasks' }, { id: 'scheduler', label: 'Cloud Scheduler' }],
  devops:     [{ id: 'build', label: 'Cloud Build' }],
  iam:        [{ id: 'iam', label: 'Service Accounts' }],
}

const OBSERVABILITY_OPTIONS = {
  generic: [
    { id: 'apm', labelKey: 'apm.applications' },
  ],
  aws: [
    { id: 'apm', labelKey: 'apm.applications' },
  ],
  gcp: [
    { id: 'apm', labelKey: 'apm.applications' },
    { id: 'monitoring', label: 'Cloud Monitoring' },
    { id: 'logging', label: 'Cloud Logging' },
  ],
  vercel: [
    { id: 'apm', labelKey: 'apm.applications' },
    { id: 'activity', label: 'Activity' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'checks', label: 'Checks' },
  ],
}

// ─── localStorage helpers ────────────────────────────────────────────────────
const LS = {
  get:    (k, def = '') => { try { return localStorage.getItem(`kua:${k}`) ?? def } catch { return def } },
  set:    (k, v)        => { try { if (v) localStorage.setItem(`kua:${k}`, v); else localStorage.removeItem(`kua:${k}`) } catch {} },
}

const pfPanelVisible  = ref(false)
const backgroundTasksVisible = ref(false)
const storedProvider = LS.get('provider', 'kubernetes')
const activeProvider  = ref(['architecture', 'observability'].includes(storedProvider) ? 'kuapps' : storedProvider)
const kuappsView      = ref(LS.get('kuappsView', storedProvider === 'observability' ? 'observability' : 'architecture'))
const cloudView       = ref(null)   // null = Kubernetes view, 'envs' = Env Manager
const selectedContext = ref('')
// Narrow windows show the Kubernetes resource menu as a drawer: opening it moves
// focus to the active item, Escape or the backdrop close it and return focus to
// the toggle.
const kubeNavOpen = ref(false)
const kubeNavRef = ref(null)
const kubeNavToggleRef = ref(null)
const narrowQuery = globalThis.matchMedia?.('(max-width: 900px)')
const narrowLayout = ref(!!narrowQuery?.matches)
narrowQuery?.addEventListener?.('change', event => { narrowLayout.value = event.matches; if (!event.matches) kubeNavOpen.value = false })
watch(kubeNavOpen, open => {
  if (!open || !narrowLayout.value) return
  nextTick(() => (kubeNavRef.value?.querySelector('.sidebar-item.active') || kubeNavRef.value?.querySelector('.sidebar-item'))?.focus())
})
function closeKubeNav() {
  if (!kubeNavOpen.value) return
  kubeNavOpen.value = false
  nextTick(() => kubeNavToggleRef.value?.focus())
}
const kubeEnvironment = computed(() => contextEnvironment(store.currentContext))
const awsTab          = ref('overview')
const gcpTab          = ref('cloudrun')
const selectedKubeResource = ref(null)
const kubeResourceFilter = ref('')
const kubeOverviewRef = ref(null)
const kubeDetailWidth = ref(Number(LS.get('kubeDetailWidth', '420')) || 420)
const isKubeResizing = ref(false)
const helmViewRef     = ref(null)
const awsViewRef      = ref(null)
const gcpViewRef      = ref(null)
const vercelViewRef   = ref(null)
const observabilityViewRef = ref(null)
const kuappsViewRef = ref(null)
const vercelTab       = ref('overview')
const clock           = ref('')
let clockTimer
let autoRefreshTimer
let autoRefreshPending = false
let lastUserInteractionAt = 0
const AUTO_REFRESH_PAUSE_MS = 15000

function markUserInteraction() {
  lastUserInteractionAt = Date.now()
}

function shouldPauseAutoRefresh() {
  return Date.now() - lastUserInteractionAt < AUTO_REFRESH_PAUSE_MS
}

watch(() => settings.autoRefresh, (secs) => {
  clearInterval(autoRefreshTimer)
  if (secs > 0) autoRefreshTimer = setInterval(() => reloadActiveProvider(), secs * 1000)
}, { immediate: true })

async function reloadActiveProvider() {
  if (autoRefreshPending || document.hidden || shouldPauseAutoRefresh()) return
  autoRefreshPending = true
  try {
    if (cloudView.value === 'helm' || cloudView.value === 'helm-repos') {
      await helmViewRef.value?.reloadActiveTab?.()
      return
    }
    if (cloudView.value === 'kube-overview') {
      await kubeOverviewRef.value?.load?.({ background: true })
      return
    }
    if (cloudView.value) return
    if (activeProvider.value === 'kubernetes') {
      if (!store.loading && !store.refreshing) await store.loadResources({ silent: true, background: true })
      return
    }
    if (activeProvider.value === 'aws') {
      await awsViewRef.value?.reloadActiveTab?.({ background: true })
      return
    }
    if (activeProvider.value === 'gcp') {
      await gcpViewRef.value?.reloadActiveTab?.({ background: true, preserveSearch: true })
      return
    }
    if (activeProvider.value === 'vercel') {
      await vercelViewRef.value?.reloadActiveTab?.({ background: true })
      return
    }
    if (activeProvider.value === 'kuapps') {
      await kuappsViewRef.value?.reloadActiveTab?.({ background: true, preserveSearch: true })
      return
    }
    if (activeProvider.value === 'observability') {
      await observabilityViewRef.value?.reloadActiveTab?.({ background: true, preserveSearch: true })
    }
  } finally {
    autoRefreshPending = false
  }
}

const awsLocalProfiles = ref([])
const gcpLocalConfigs  = ref([])
const awsProfileId     = ref(LS.get('awsProfile',    ''))
const gcpProfileId     = ref(LS.get('gcpProfile',    ''))
const vercelProfileId  = ref(LS.get('vercelProfile', ''))
const observabilityProvider = ref(LS.get('observabilityProvider', 'generic'))
const observabilityFocus = ref(null)
const observabilitySelections = reactive({
  generic: 'apm',
  aws: LS.get('observabilityAwsView', 'apm'),
  gcp: LS.get('observabilityGcpView', 'apm'),
  vercel: LS.get('observabilityVercelView', 'apm'),
})
const availableObservabilityProviders = computed(() => [
  {
    id: 'generic', label: t('observability.general'), icon: 'boxes',
    description: t('observability.generalDescription'), available: true,
  },
  {
    id: 'aws', label: 'AWS', icon: 'cloud', description: t('observability.awsDescription'),
    available: envStore.awsProfiles.length > 0 || awsLocalProfiles.value.length > 0 || awsProfileId.value.startsWith('local:'),
  },
  {
    id: 'gcp', label: 'GCP', icon: 'cloud-cog', description: t('observability.gcpDescription'),
    available: envStore.gcpProfiles.length > 0 || gcpLocalConfigs.value.length > 0 || gcpProfileId.value.startsWith('local:'),
  },
  {
    id: 'vercel', label: 'Vercel', icon: 'triangle', description: t('observability.vercelDescription'),
    available: envStore.vercelProfiles.length > 0,
  },
].filter(provider => provider.available))
const hasCloudConnections = computed(() => availableObservabilityProviders.value.length > 0)
const currentObservabilityOptions = computed(() => OBSERVABILITY_OPTIONS[observabilityProvider.value] || [])
const currentObservabilityProviderLabel = computed(() =>
  availableObservabilityProviders.value.find(provider => provider.id === observabilityProvider.value)?.label || observabilityProvider.value)
const selectedKubeKey = computed(() => {
  const row = selectedKubeResource.value?.row
  return row ? row.name + (row.namespace || '') : ''
})

// Persistir cambios en localStorage automáticamente
watch(activeProvider,   v  => LS.set('provider',       v))
watch(kuappsView,       v  => LS.set('kuappsView',     v))
watch(awsProfileId,     v  => LS.set('awsProfile',     v))
watch(gcpProfileId,     v  => LS.set('gcpProfile',     v))
watch(vercelProfileId,  v  => LS.set('vercelProfile',  v))
watch(observabilityProvider, v => LS.set('observabilityProvider', v))
watch(() => observabilitySelections.aws, v => LS.set('observabilityAwsView', v))
watch(() => observabilitySelections.gcp, v => LS.set('observabilityGcpView', v))
watch(() => observabilitySelections.vercel, v => LS.set('observabilityVercelView', v))

// Sanear ids de perfil persistidos cuando la lista de perfiles cambia:
// si el perfil activo fue eliminado (p.ej. desde el Env Manager) se limpia,
// y si queda exactamente un perfil del proveedor se selecciona solo.
watch(() => envStore.profiles, (profiles) => {
  if (envStore.error) return   // no tocar la selección si la carga falló
  const exists = id => !id || id.startsWith('local:') || profiles.some(p => p.id === id)
  if (!exists(awsProfileId.value))    { awsProfileId.value    = ''; awsStore.setActiveProfile(null) }
  if (!exists(gcpProfileId.value))    { gcpProfileId.value    = ''; gcpStore.setActiveProfile(null) }
  if (!exists(vercelProfileId.value)) { vercelProfileId.value = ''; vercelStore.setActiveProfile(null) }
  if (!awsProfileId.value) {
    const aws = profiles.filter(p => p.provider === 'aws')
    if (aws.length === 1) { awsProfileId.value = aws[0].id; awsStore.setActiveProfile(aws[0].id) }
  }
  // Console tabs restored from a previous session (#40) may reference a profile that no
  // longer exists — prune them once the fresh profile list is known, rather than blocking
  // startup on a synchronous check.
  termStore.pruneStaleTabs(tab => !tab.profileId || profiles.some(p => p.id === tab.profileId))
}, { deep: true })

watch(() => store.contexts, contexts => {
  termStore.pruneStaleTabs(tab => !tab.kubeContext || contexts.some(c => c.name === tab.kubeContext))
}, { deep: true })
watch(availableObservabilityProviders, providers => {
  if (!providers.length) {
    if (activeProvider.value === 'observability') activeProvider.value = 'kubernetes'
    return
  }
  if (!providers.some(provider => provider.id === observabilityProvider.value)) {
    observabilityProvider.value = providers[0].id
  }
}, { deep: true })
watch(() => store.namespace, v => LS.set('kubeNs', v))
watch(kubeDetailWidth, v => LS.set('kubeDetailWidth', String(v)))

// Tab Help & Options opens with; components ask for one with the kua:open-help event.
const helpTab = ref('')
window.addEventListener('kua:open-help', event => {
  helpTab.value = event.detail?.tab || ''
  modals.help = true
})
const modals    = reactive({ delete: false, deleteContext: false, scale: false, yaml: false, portForward: false, kubeconfig: false, help: false, kubeAction: false, addConnection: false })
const modalData = reactive({
  deleteMsg: '',
  deleteContextMsg: '', deleteContextName: '',
  scaleName: '', scaleCurrent: 0, scalePending: null,
  yamlTitle: '', yamlType: '', yamlNs: null, yamlName: '', yamlContext: '',
  pfNamespace: '', pfService: '', pfPorts: [], pfLabel: '', pfManual: false, pfResourceType: 'services',
  kubeAction: null,
  connectionProvider: 'aws', deleteConnectionId: null,
})
const {
  architectureProjectId,
  activeApplicationContext,
  architectureProfileId,
  openApplicationArchitecture,
  setApplicationContext,
  urlApplicationId,
} = useArchitectureContext({ storage: LS, awsProfileId, setProvider })

// ─── View in the URL ──────────────────────────────────────────────────────────
// ?view=aws&service=lambda&profile=<id> opens that view; Back/Forward move
// between providers and AWS services (composables/useViewUrl.js).
const AWS_TABS = new Set(['overview', ...Object.values(AWS_SIDEBAR).flat().map(item => item.id)])
// Search and filters per AWS tab. They live here, not in AwsView, so leaving AWS
// for another provider and coming back keeps them; a link or Back sets them.
const awsFiltersByTab = reactive({})
const awsFiltersSeq = ref(0) // bumped when a link/Back brings filters: AwsView applies them again
function setLinkedAwsFilters(service, filters) {
  awsFiltersByTab[service] = { ...(filters || {}) }
  awsFiltersSeq.value += 1
}
// The same for GCP (G15): service, profile, search/filters/sort and the
// selected resource per tab, kept here so leaving GCP and coming back keeps them.
const GCP_TABS = new Set(['apm', 'overview', ...Object.values(GCP_SIDEBAR).flat().map(item => item.id)])
const gcpFiltersByTab = reactive({})
const gcpResourceByTab = reactive({})
const gcpFiltersSeq = ref(0)
function setLinkedGcpState(service, filters, resource) {
  gcpFiltersByTab[service] = { ...(filters || {}) }
  gcpResourceByTab[service] = resource || ''
  gcpFiltersSeq.value += 1
}
function serviceState() {
  if (activeProvider.value === 'aws') return { service: awsTab.value, profile: awsProfileId.value, filters: { ...(awsFiltersByTab[awsTab.value] || {}) } }
  if (activeProvider.value === 'gcp') return { service: gcpTab.value, profile: gcpProfileId.value, filters: { ...(gcpFiltersByTab[gcpTab.value] || {}) }, resource: gcpResourceByTab[gcpTab.value] || '' }
  return { service: '', profile: '', filters: {} }
}
const viewUrl = useViewUrl({
  state: () => ({ view: activeProvider.value, ...serviceState() }),
  navigation: [activeProvider, awsTab, gcpTab],
  context: [awsProfileId, gcpProfileId, activeApplicationContext, () => JSON.stringify(awsFiltersByTab[awsTab.value] || {}),
    () => JSON.stringify(gcpFiltersByTab[gcpTab.value] || {}), () => gcpResourceByTab[gcpTab.value] || ''],
  onPop: applyViewFromHistory,
})
// A profile named by a link is only selected once it is known to exist here.
let linkedAwsProfile = ''
function applyLinkedView(linked) {
  if (!linked.view) return
  activeProvider.value = linked.view
  if (linked.view === 'aws' && AWS_TABS.has(linked.service)) {
    awsTab.value = linked.service
    setLinkedAwsFilters(linked.service, linked.filters)
  }
  if (linked.view === 'aws' && linked.profile && linked.profile !== awsProfileId.value) linkedAwsProfile = linked.profile
  if (linked.view === 'gcp' && GCP_TABS.has(linked.service)) {
    gcpTab.value = linked.service
    setLinkedGcpState(linked.service, linked.filters, linked.resource)
  }
  if (linked.view === 'gcp' && linked.profile && linked.profile !== gcpProfileId.value) linkedGcpProfile = linked.profile
}
let linkedGcpProfile = ''
function gcpProfileExists(id) {
  if (id.startsWith('local:')) return gcpLocalConfigs.value.some(config => `local:${config.name}` === id)
  return envStore.profiles.some(profile => profile.id === id && profile.provider === 'gcp')
}
function applyLinkedGcpProfile() {
  if (!linkedGcpProfile) return
  const id = linkedGcpProfile
  linkedGcpProfile = ''
  if (gcpProfileExists(id)) selectProfile('gcp', id)
  else toast(t('viewUrl.profileMissing', { profile: id }), 'warn')
}
function awsProfileExists(id) {
  if (id.startsWith('local:')) return awsLocalProfiles.value.some(profile => `local:${profile.name}` === id)
  return envStore.profiles.some(profile => profile.id === id && profile.provider === 'aws')
}
function applyLinkedAwsProfile() {
  if (!linkedAwsProfile) return
  const id = linkedAwsProfile
  linkedAwsProfile = ''
  if (awsProfileExists(id)) awsProfileId.value = id
  else toast(t('viewUrl.profileMissing', { profile: id }), 'warn')
}
async function applyViewFromHistory(linked) {
  // Kubernetes entries are applied by onKubePopState (context, namespace, resource).
  if (!linked.view || linked.view === 'kubernetes') return
  await setProvider(linked.view)
  if (linked.view === 'gcp') return applyGcpFromHistory(linked)
  if (linked.view !== 'aws') return
  if (AWS_TABS.has(linked.service)) {
    awsTab.value = linked.service
    setLinkedAwsFilters(linked.service, linked.filters)
  }
  if (linked.profile && linked.profile !== awsProfileId.value) {
    if (!awsProfileExists(linked.profile)) {
      toast(t('viewUrl.profileMissing', { profile: linked.profile }), 'warn')
      return
    }
    selectProfile('aws', linked.profile)
    // Never a silent switch: the view now reads another account.
    toast(t('viewUrl.profileFromHistory', { profile: linked.profile }), 'info')
  }
}
function applyGcpFromHistory(linked) {
  if (GCP_TABS.has(linked.service)) {
    gcpTab.value = linked.service
    setLinkedGcpState(linked.service, linked.filters, linked.resource)
  }
  if (linked.profile && linked.profile !== gcpProfileId.value) {
    if (!gcpProfileExists(linked.profile)) {
      toast(t('viewUrl.profileMissing', { profile: linked.profile }), 'warn')
      return
    }
    selectProfile('gcp', linked.profile)
    // Never a silent switch: the view now reads another project.
    toast(t('viewUrl.profileFromHistory', { profile: linked.profile }), 'info')
  }
}
applyLinkedView(viewUrl.initial)
viewUrl.start()
onUnmounted(() => viewUrl.stop())

// A link with ?view=kubernetes names a cluster view (lib/kubeUrl.js, its own params and Back).
const urlKubeView = readKubeUrl(globalThis.location?.search || '')

// A link with ?app=<id> opens that KUA Application in KUApps (#149).
async function openApplicationFromUrl() {
  // A link that names another view wins over a leftover ?app= (older URLs kept it everywhere).
  if (!urlApplicationId || urlKubeView || (viewUrl.initial.view && viewUrl.initial.view !== 'kuapps')) return
  try {
    const context = applicationContextFromView(await api('GET', `/api/kua-apps/applications/${encodeURIComponent(urlApplicationId)}`))
    if (!context) return
    handleKuAppsApplicationContext(context)
    await setProvider('kuapps')
  } catch { /* an unknown or deleted application keeps the stored context */ }
}

const kuappsObservabilityProvider = computed(() => {
  const provider = activeApplicationContext.value?.provider || observabilityProvider.value
  return ['aws', 'gcp', 'vercel', 'generic'].includes(provider) ? provider : 'generic'
})
const kuappsObservabilityProfileId = computed(() => {
  const application = activeApplicationContext.value
  if (application?.profileId) return application.profileId
  if (kuappsObservabilityProvider.value === 'aws') return awsProfileId.value
  if (kuappsObservabilityProvider.value === 'gcp') return gcpProfileId.value
  if (kuappsObservabilityProvider.value === 'vercel') return vercelProfileId.value
  return 'local'
})

// ── Advisor posture alerts (header bell + system notifications) ──────────────
const advisorAlerts = useAdvisorAlerts()
const { plan: currentPlan } = usePlan()

function profileNameById(id) {
  return envStore.profiles.find(profile => profile.id === id)?.name || id
}

/** Opens the overview an alert belongs to (AWS/GCP/Vercel profile, Kubernetes, KUApps application). */
async function openAdvisorAlert(alert) {
  const scope = parseScope(alert.scope)
  if (scope.provider === 'aws') {
    if (scope.profileId && awsProfileId.value !== scope.profileId) { awsProfileId.value = scope.profileId; onAwsProfileChange() }
    awsTab.value = 'overview'
    await setProvider('aws')
  } else if (scope.provider === 'gcp') {
    if (scope.profileId && gcpProfileId.value !== scope.profileId) { gcpProfileId.value = scope.profileId; onGcpProfileChange() }
    gcpTab.value = 'overview'
    await setProvider('gcp')
  } else if (scope.provider === 'vercel') {
    // Token-only profiles are keyed by a hash (local-…): open the Overview of the current profile.
    const known = envStore.vercelProfiles.some(profile => profile.id === scope.profileId)
    if (known && vercelProfileId.value !== scope.profileId) { vercelProfileId.value = scope.profileId; onVercelProfileChange() }
    vercelTab.value = 'overview'
    await setProvider('vercel')
  } else if (scope.provider === 'kubernetes') {
    await setProvider('kubernetes')
    cloudView.value = 'kube-overview'
  } else if (scope.provider === 'product') {
    try {
      const application = (await api('GET', '/api/architecture/applications/catalog')).find(item => item.id === scope.applicationId)
      if (application) handleKuAppsApplicationContext(application)
    } catch { /* opens KUApps without a selection */ }
    await setProvider('kuapps')
  }
}

// Alerts need the Advisor (Pro and Team); polling starts again when the plan changes.
watch(() => currentPlan.value?.features?.advisor, enabled => {
  if (enabled) advisorAlerts.start({ t, profileName: profileNameById, onOpen: openAdvisorAlert })
  else advisorAlerts.stop()
}, { immediate: true })

function handleKuAppsApplicationContext(application) {
  if (!application?.id) return
  setApplicationContext(application)
  if (application.provider === 'aws' && application.profileId) awsProfileId.value = application.profileId
  if (application.provider === 'gcp' && application.profileId) gcpProfileId.value = application.profileId
  if (application.provider === 'vercel' && application.profileId) vercelProfileId.value = application.profileId
}

function openApplicationObservability(application, focus = null) {
  if (!application?.id) return
  activeApplicationContext.value = application
  if (application.provider === 'aws') awsProfileId.value = application.profileId
  if (application.provider === 'gcp') gcpProfileId.value = application.profileId
  if (application.provider === 'vercel') vercelProfileId.value = application.profileId
  observabilityProvider.value = application.provider || 'generic'
  if (focus?.view && Object.prototype.hasOwnProperty.call(observabilitySelections, observabilityProvider.value)) {
    observabilitySelections[observabilityProvider.value] = 'apm'
  }
  observabilityFocus.value = focus
  activeProvider.value = 'kuapps'
  kuappsView.value = 'observability'
  nextTick(() => createIcons({ icons }))
}

async function openObservabilityKubernetesLogs(resource) {
  const resourceType = ({ Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Pod: 'pods' })[resource?.kind]
  if (!resourceType || !resource?.kubeContext || !resource?.namespace || !resource?.name) return
  activeProvider.value = 'kubernetes'
  cloudView.value = null
  try {
    if (store.currentContext !== resource.kubeContext) {
      selectedContext.value = resource.kubeContext
      await store.switchContext(resource.kubeContext)
    }
    openLogs(resource.namespace, resource.name, [], resourceType)
  } catch (error) {
    toast(error.message, 'error')
  }
  nextTick(() => createIcons({ icons }))
}

// Kind -> resource table key used by the Kubernetes sidebar/ResourceTable.
const KUBE_KIND_TO_RESOURCE = {
  Pod: 'pods', Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets',
  Service: 'services', Ingress: 'ingresses', ConfigMap: 'configmaps', Secret: 'secrets',
  PersistentVolumeClaim: 'pvcs', ReplicaSet: 'replicasets', Job: 'jobs', CronJob: 'cronjobs', Node: 'nodes',
}
const CLUSTER_SCOPED_KINDS = new Set(['Node'])

async function switchToKubernetesResourceScope(resource) {
  activeProvider.value = 'kubernetes'
  cloudView.value = null
  if (resource.kubeContext && store.currentContext !== resource.kubeContext) {
    selectedContext.value = resource.kubeContext
    await store.switchContext(resource.kubeContext)
  }
  if (resource.namespace && store.namespace !== resource.namespace) store.namespace = resource.namespace
}

// Open the YAML/metrics detail panel of the Kubernetes view for a resource, in
// its context and namespace (Architecture Canvas and inspector links).
async function openKubernetesDetail(resource) {
  const resourceType = KUBE_KIND_TO_RESOURCE[resource?.kind]
  const clusterScoped = CLUSTER_SCOPED_KINDS.has(resource?.kind)
  if (!resourceType || !resource?.kubeContext || (!clusterScoped && !resource?.namespace) || !resource?.name) return
  try {
    await switchToKubernetesResourceScope(clusterScoped ? { ...resource, namespace: '' } : resource)
    selectedKubeResource.value = null
    store.resource = resourceType
    await store.loadResources()
    const row = store.rows.find(r => r.name === resource.name)
    if (row) selectKubeResource(resourceType, row)
    else toast(`${resource.name} not found in ${resource.namespace}`, 'error')
  } catch (error) {
    toast(error.message, 'error')
  }
  nextTick(() => createIcons({ icons }))
}

// Architecture Canvas node action: list the Pods in the workload's namespace, filtered by its name.
async function openArchitectureKubernetesPods(resource) {
  if (!resource?.kubeContext || !resource?.namespace || !resource?.name) return
  try {
    await switchToKubernetesResourceScope(resource)
    kubeResourceFilter.value = resource.name
    setResource('pods')
  } catch (error) {
    toast(error.message, 'error')
  }
  nextTick(() => createIcons({ icons }))
}

// Where the AWS view opens (#239 N06): account, region and profile, and a warning when the resource
// lives in another region than the profile's (the view lists the profile's region) or its account
// is ambiguous (the profile selected in KUA is used, not one chosen silently).
function awsProfileRegion(profileId) {
  if (String(profileId || '').startsWith('local:')) return awsLocalProfiles.value.find(item => `local:${item.name}` === profileId)?.region || ''
  return (envStore.profiles || []).find(item => item.id === profileId)?.region || ''
}
function announceAwsDestination(resource, target) {
  const profileId = resource.awsProfileId || awsProfileId.value
  const notice = awsDestinationNotice({ resource, target, profileId, profileRegion: awsProfileRegion(profileId) })
  if (notice) toast(t(notice.key, notice.params), notice.tone)
}

// Architecture Canvas node action: focus a Lambda/EC2/EventBridge/Step Functions resource inside AwsView.
// A resource of a map or a KUA Application opens in its tab of the AWS view, searched by the name
// AWS lists it with, and with the profile bound to its account when the caller knows it (#239).
function openArchitectureAwsResource(resource) {
  const target = awsViewTarget(resource)
  if (!target) return
  if (resource.awsProfileId && resource.awsProfileId !== awsProfileId.value) selectProfile('aws', resource.awsProfileId)
  announceAwsDestination(resource, target)
  activeProvider.value = 'aws'
  awsTab.value = target.tab
  whenMounted(awsViewRef).then(view => view?.focusResourceByName?.(target.tab, target.search))
}

function openArchitectureAwsLogs(resource) {
  if (resource?.resourceType !== 'lambda' || !resource?.name) return
  activeProvider.value = 'aws'
  awsTab.value = 'lambda'
  whenMounted(awsViewRef).then(view => view?.openLambdaLogsByName?.(resource.name))
}

async function setProvider(p) {
  const view = p === 'observability' ? 'observability' : p === 'architecture' ? 'architecture' : kuappsView.value
  const target = ['observability', 'architecture'].includes(p) ? 'kuapps' : p
  if (p !== 'observability') observabilityFocus.value = null
  if (target === 'kuapps') kuappsView.value = view
  activeProvider.value = target
  if (p === 'kubernetes' && cloudView.value !== 'envs') cloudView.value = null
  if (p === 'aws')    { if (!awsLocalProfiles.value.length) loadAwsLocalProfiles() }
  if (p === 'gcp')    { if (!gcpLocalConfigs.value.length) loadGcpLocalConfigs() }
  if (p === 'vercel') { envStore.fetchProfiles() }
  if (p === 'architecture' && !awsLocalProfiles.value.length) loadAwsLocalProfiles()
  if (p === 'observability') selectObservabilityProvider(observabilityProvider.value)
  nextTick(() => createIcons({ icons }))
}

function selectObservabilityProvider(provider) {
  if (!availableObservabilityProviders.value.some(item => item.id === provider)) return
  observabilityProvider.value = provider
  if (provider === 'aws') onAwsProfileChange()
  if (provider === 'gcp') onGcpProfileChange()
  if (provider === 'vercel') onVercelProfileChange()
  nextTick(() => createIcons({ icons }))
}

async function loadAwsLocalProfiles() {
  try { awsLocalProfiles.value = await api('GET', '/api/cloud/aws/local-profiles') } catch { /* ignore */ }
}
async function loadGcpLocalConfigs() {
  try { gcpLocalConfigs.value = await api('GET', '/api/cloud/gcp/gcloud-configs') } catch { /* ignore */ }
}
function onAwsProfileChange() {
  awsStore.setActiveProfile(awsProfileId.value || null)
}
function onGcpProfileChange() {
  gcpStore.setActiveProfile(gcpProfileId.value || null)
}
function onVercelProfileChange() {
  vercelStore.setActiveProfile(vercelProfileId.value || null)
}
function selectProfile(provider, id) {
  if (provider === 'aws')    { awsProfileId.value    = id; awsStore.setActiveProfile(id) }
  else if (provider === 'vercel') { vercelProfileId.value = id; vercelStore.setActiveProfile(id) }
  else                            { gcpProfileId.value    = id; gcpStore.setActiveProfile(id) }
}
function openAddConnection(provider) {
  modalData.connectionProvider = provider
  modals.addConnection = true
}
async function handleConnectionSave(payload) {
  // gcloud CLI auto-auth mode: no profile stored, just activate the local config
  if (payload.gcpAuthMode === 'gcloud') {
    modals.addConnection = false
    gcpProfileId.value   = payload.profileId
    gcpStore.setActiveProfile(payload.profileId)
    toast(`GCP gcloud config "${payload.profileId.slice(6)}" activated`, 'success')
    nextTick(() => createIcons({ icons }))
    return
  }

  // Vercel OAuth flow: profile already created by backend callback, just select it
  if (payload.oauthProfile && payload.provider === 'vercel') {
    if (!payload.oauthProfile.id || !payload.oauthProfile.name) {
      toast('Vercel OAuth failed: invalid callback response', 'error')
      return
    }
    modals.addConnection = false
    await envStore.fetchProfiles()
    vercelProfileId.value = payload.oauthProfile.id
    vercelStore.setActiveProfile(payload.oauthProfile.id)
    toast(`Vercel account "${payload.oauthProfile.name}" connected`, 'success')
    nextTick(() => createIcons({ icons }))
    return
  }

  const { name, category, provider, keys, meta } = payload
  const created = await envStore.createProfile({ name, category, provider, keys, meta })
  if (created) {
    modals.addConnection = false
    if (provider === 'aws')    { awsProfileId.value    = created.id; awsStore.setActiveProfile(created.id) }
    if (provider === 'gcp')    { gcpProfileId.value    = created.id; gcpStore.setActiveProfile(created.id) }
    if (provider === 'vercel') { vercelProfileId.value = created.id; vercelStore.setActiveProfile(created.id) }
    toast(`Connection "${name}" added`, 'success')
    nextTick(() => createIcons({ icons }))
  }
}
function deleteConnectionConfirm(provider) {
  const id = provider === 'aws' ? awsProfileId.value
           : provider === 'vercel' ? vercelProfileId.value
           : gcpProfileId.value
  if (!id || id.startsWith('local:')) return
  const profile = envStore.profiles.find(p => p.id === id)
  if (!profile) return
  modalData.deleteConnectionId   = id
  modalData.deleteMsg            = `Delete profile "${profile.name}"? All stored keys will be permanently removed.`
  modals.delete                  = true
}
function toggleEnvManager() {
  cloudView.value = cloudView.value === 'envs' ? null : 'envs'
  nextTick(() => createIcons({ icons }))
}
function toggleAuditLog() {
  cloudView.value = cloudView.value === 'audit' ? null : 'audit'
  nextTick(() => createIcons({ icons }))
}
function toggleConsole() {
  cloudView.value = cloudView.value === 'console' ? null : 'console'
  nextTick(() => createIcons({ icons }))
}
function setResource(r)       { cloudView.value = null; selectedKubeResource.value = null; kubeNavOpen.value = false; store.selectResource(r) }
function setCloudView(view)   { cloudView.value = view; kubeNavOpen.value = false }

// Overview drill-down: open the resource table with the matching filter/chips
// preset, keeping the user's sort for that table.
function openKubeFromOverview({ resource, filter = '', quick = [], facets = [] }) {
  saveTableView(resource, { ...loadTableView(resource), filter, quick, facets })
  kubeResourceFilter.value = ''
  setResource(resource)
}

function selectKubeResource(type, row) {
  selectedKubeResource.value = { type, row }
  nextTick(() => createIcons({ icons }))
}

function startKubeResize(event) {
  event.preventDefault()
  isKubeResizing.value = true
  document.body.classList.add('kube-resizing')
  window.addEventListener('mousemove', onKubeResize)
  window.addEventListener('mouseup', stopKubeResize)
}

function onKubeResize(event) {
  const max = Math.min(Math.round(window.innerWidth * 0.72), Math.max(360, window.innerWidth - 260))
  const next = window.innerWidth - event.clientX
  kubeDetailWidth.value = Math.min(max, Math.max(320, next))
}

function stopKubeResize() {
  isKubeResizing.value = false
  document.body.classList.remove('kube-resizing')
  window.removeEventListener('mousemove', onKubeResize)
  window.removeEventListener('mouseup', stopKubeResize)
}

function resetKubePanelWidth() {
  kubeDetailWidth.value = 420
}

function openPrometheusHelm() {
  activeProvider.value = 'kubernetes'
  cloudView.value = 'helm-repos'
  selectedKubeResource.value = null
  nextTick(() => createIcons({ icons }))
}

async function handleGkeConnect(contextName) {
  // Switch to the Kubernetes view
  activeProvider.value = 'kubernetes'
  cloudView.value      = null
  // Reload contexts so the imported one is available
  await store.loadContexts()
  // Switch to it
  try {
    selectedContext.value = contextName
    await store.switchContext(contextName)
    toast(t('msg.contextSwitched', { name: contextName }), 'success')
  } catch (e) {
    toast(e.message, 'error')
  }
  nextTick(() => createIcons({ icons }))
}

function openLocalShell() {
  const tab = termStore.openLocalTab()
  startLocalStream(tab)
}

async function switchContext() {
  try { await store.switchContext(selectedContext.value); toast(t('msg.contextSwitched', { name: selectedContext.value }), 'success') }
  catch (e) { toast(e.message, 'error') }
}

function deleteContextConfirm() {
  const name = selectedContext.value; if (!name) return
  modalData.deleteContextName = name
  modalData.deleteContextMsg  = t('msg.deleteContext', { name })
  modals.deleteContext = true
}
async function confirmDeleteContext() {
  modals.deleteContext = false
  try { await store.deleteContext(modalData.deleteContextName); toast(t('msg.contextDeleted'), 'success'); selectedContext.value = store.currentContext }
  catch (e) { toast(e.message, 'error') }
}

function handleAction(fn, args) {
  const h = {
    viewLogs:        ([ns, pod, c, type])   => openLogs(ns, pod, c, type),
    openExec:        ([ns, pod, c])         => openExec(ns, pod, c),
    viewYaml:        ([type, ns, name])     => openYaml(type, ns, name),
    confirmDelete:   ([type, ns, name])     => openDelete(type, ns, name),
    openScale:       ([type, ns, name, cur])=> openScale(type, ns, name, cur),
    openPortForward: ([ns, name, ports, resourceType]) => openPf(ns, name, ports, resourceType || 'services'),
    openExternal:    ([url])                 => openExternalUrl(url),
    restart:         ([type, ns, name])     => openKubeAction({ kind: 'restart', type, namespace: ns, name }),
    cordonNode:      ([name, cordon])       => openKubeAction({ kind: cordon ? 'cordon' : 'uncordon', type: 'nodes', name }),
    confirmDrain:    ([name])               => openKubeAction({ kind: 'drain', type: 'nodes', name }),
  }
  h[fn]?.(args)
}

function applicationAuditContext() {
  return { environment: activeApplicationContext.value?.environment, applicationId: activeApplicationContext.value?.id }
}
function openLogs(ns, pod, containers, resourceType = 'pods', { previous = false, container = null } = {}) {
  const tab = termStore.openLogsTab(ns, pod, containers, resourceType, { kubeContext: store.currentContext, ...applicationAuditContext() })
  if (container && tab.containers.includes(container)) tab.container = container
  tab.previous = previous
  startLogStream(tab, previous)
}
// Inspector shortcuts: logs of the instance that just ended, for one container.
function openInspectorLogs({ namespace, name, containers, container, previous }) {
  openLogs(namespace, name, containers, 'pods', { previous, container })
}
function openInspectorResource({ kind, name, namespace }) {
  openKubernetesDetail({ kind, name, namespace, kubeContext: store.currentContext })
}
function openExec(ns, pod, containers) { const tab = termStore.openExecTab(ns, pod, containers, { kubeContext: store.currentContext, ...applicationAuditContext() }); startExecStream(tab) }
function restartStream(tab, previous = false) {
  if (tab.type === 'exec') startExecStream(tab, { reconnect: true })
  else if (tab.type === 'local') startLocalStream(tab, { reconnect: true })
  else if (tab.type === 'ec2') startSshStream(tab, { reconnect: true })
  else if (tab.type === 'gcp-ssh') startSshStream(tab, { reconnect: true })
  else if (tab.type === 'ssm') startSsmStream(tab, { reconnect: true })
  else if (tab.type === 'gcp-logs') startGcpLogsStream(tab, { reconnect: true })
  else if (tab.type === 'vercel') startVercelLogsStream(tab, { reconnect: true })
  else startLogStream(tab, previous, { reconnect: true })
}

function openExternalUrl(url) {
  if (!url) return
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank')
}

function openYaml(type, ns, name)    { Object.assign(modalData, { yamlTitle: `${type}/${name}`, yamlType: type, yamlNs: ns, yamlName: name, yamlContext: store.currentContext }); modals.yaml = true }
function openDelete(type, ns, name)  { openKubeAction({ kind: 'delete', type, namespace: ns, name }) }
function openBulkDelete(rows) {
  const selected = Array.isArray(rows) ? rows : []
  if (!selected.length) return
  const items = selected.map(row => ({ namespace: row.namespace, name: row.name }))
  openKubeAction({ kind: 'delete', type: store.resource, namespace: items[0].namespace, name: items[0].name, items })
}
function openScale(type, ns, name, cur) { modalData.scalePending = { type, ns, name, context: store.currentContext }; modalData.scaleName = name; modalData.scaleCurrent = cur; modals.scale = true }
function openPf(ns, name, ports, resourceType = 'services') { Object.assign(modalData, { pfNamespace: ns, pfService: name, pfPorts: ports||[], pfLabel: `${resourceType}/${ns}/${name}`, pfManual: false, pfResourceType: resourceType }); modals.portForward = true }
function openPfManual()              { Object.assign(modalData, { pfNamespace: store.namespace||'default', pfService: '', pfPorts: [], pfLabel: 'Manual', pfManual: true, pfResourceType: 'services' }); modals.portForward = true }

// Kubernetes deletes go through confirmKubeAction; this modal only removes
// stored connection profiles.
async function confirmDelete() {
  const id = modalData.deleteConnectionId
  modals.delete = false
  const ok = await envStore.deleteProfile(id)
  if (ok) {
    if (awsProfileId.value === id) { awsProfileId.value = ''; awsStore.setActiveProfile(null) }
    if (gcpProfileId.value === id) { gcpProfileId.value = ''; gcpStore.setActiveProfile(null) }
    toast('Profile deleted', 'success')
  }
}
function deleteKubeResource(type, ns, name, expectedContext) {
  const body = { expectedContext }
  if (type === 'nodes') return api('DELETE', `/api/nodes/${encodeURIComponent(name)}`, body)
  return api('DELETE', `/api/${encodeURIComponent(ns)}/${type}/${encodeURIComponent(name)}`, body)
}
async function confirmScale(replicas) {
  const { type, ns, name, context } = modalData.scalePending; modals.scale = false
  if (!kubeContextStillActive(context)) return
  try { await api('POST', `/api/${ns}/${type}/${name}/scale`, { replicas, expectedContext: context }); toast(t('kubeAction.scaled', { name, n: replicas }), 'success'); setTimeout(() => store.loadResources({ silent: true }), 800) }
  catch (e) { toastKubeActionError(e) }
}
// Restart, cordon, drain and delete change the cluster, so they are confirmed with the
// context captured when the action was opened. The server rejects the write if
// the active context changed in the meantime.
function openKubeAction(action) {
  modalData.kubeAction = { ...action, context: store.currentContext }
  modals.kubeAction = true
}
function kubeActionRequest({ kind, type, namespace, name }) {
  if (kind === 'restart') return { path: `/api/${namespace}/${type}/${name}/restart`, body: {} }
  if (kind === 'drain') return { path: `/api/nodes/${name}/drain`, body: {} }
  return { path: `/api/nodes/${name}/cordon`, body: { cordon: kind === 'cordon' } }
}
function kubeContextStillActive(context) {
  if (context === store.currentContext) return true
  toast(t('kubeAction.contextChanged', { current: store.currentContext, expected: context }), 'error')
  return false
}
function toastKubeActionError(e) {
  if (e.details?.code === 'KUBE_CONTEXT_CHANGED') toast(t('kubeAction.contextChanged', { current: e.details.currentContext, expected: e.details.expectedContext }), 'error')
  else toast(e.message, 'error')
}
async function confirmKubeDelete(action) {
  const items = action.items || [{ namespace: action.namespace, name: action.name }]
  const results = await Promise.allSettled(items.map(item => deleteKubeResource(action.type, item.namespace, item.name, action.context)))
  const failed = results.filter(result => result.status === 'rejected')
  const removed = results.length - failed.length
  if (removed) toast(items.length === 1 ? t('kubeAction.deleted', { name: action.name }) : t('kubeAction.deletedMany', { n: removed }), failed.length ? 'warn' : 'success')
  if (failed.length === 1) toastKubeActionError(failed[0].reason)
  else if (failed.length) toast(t('kubeAction.deleteFailed', { n: failed.length }), 'error')
  setTimeout(() => store.loadResources({ silent: true }), 600)
}
async function confirmKubeAction() {
  const action = modalData.kubeAction
  modals.kubeAction = false
  if (!action || !kubeContextStillActive(action.context)) return
  if (action.kind === 'delete') return confirmKubeDelete(action)
  const { path, body } = kubeActionRequest(action)
  try {
    const r = await api('POST', path, { ...body, expectedContext: action.context })
    if (action.kind === 'restart') toast(t('kubeAction.restarted', { name: action.name }), 'success')
    else if (action.kind === 'drain') toast(t('kubeAction.drained', { name: action.name, evicted: r.evicted }), r.failed ? 'warn' : 'success')
    else toast(t(`kubeAction.${action.kind}ed`, { name: action.name }), 'success')
    setTimeout(() => store.loadResources({ silent: true }), action.kind === 'restart' ? 1000 : 800)
  } catch (e) { toastKubeActionError(e) }
}

function openSponsor() {
  const url = 'https://github.com/sponsors/lnavarrocarter/'
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank')
}

function toggleLang() {
  settings.lang = settings.lang === 'es' ? 'en' : 'es'
  applySettings()
}

function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
  applySettings()
}

function onKey(e) {
  if (e.key !== 'Escape') return
  if (backgroundTasksVisible.value) backgroundTasksVisible.value = false
  else Object.keys(modals).forEach(k => modals[k] = false)
}

syncServerCacheSettings()

// Keep the URL on the Kubernetes view shown: context, namespace, resource list
// (or overview) and the selected resource. Other views drop these params.
const KUBE_URL_VIEWS = { 'kube-overview': 'overview', 'kube-logs': 'logs' }
// Moves within the Kubernetes view add a history entry (Back returns to them);
// changes arriving together (a context switch loads its namespace and list)
// are recorded once. While Back/Forward re-applies a view, nothing is recorded.
let applyingKubeHistory = false
// Start-up passes through transient states (no context yet, default namespace):
// the URL follows the view only once the first Kubernetes load is done.
let kubeUrlReady = false
let kubeUrlTimer = null
function scheduleKubeUrlSync() {
  clearTimeout(kubeUrlTimer)
  kubeUrlTimer = setTimeout(syncKubeUrl, 250)
}
function syncKubeUrl({ replace = false } = {}) {
  const location = globalThis.location
  if (!kubeUrlReady || applyingKubeHistory || !location?.href || !globalThis.history?.replaceState) return
  const kubeView = activeProvider.value === 'kubernetes' && (!cloudView.value || cloudView.value in KUBE_URL_VIEWS)
  let href
  try {
    href = kubeUrlHref(location.href, kubeView ? {
      context: store.currentContext,
      namespace: store.namespace,
      resource: KUBE_URL_VIEWS[cloudView.value] || store.resource,
      name: cloudView.value ? '' : selectedKubeResource.value?.row?.name || '',
    } : null)
    if (!kubeView && activeProvider.value === 'kuapps' && activeApplicationContext.value?.id) {
      const url = new URL(href)
      url.searchParams.set('app', activeApplicationContext.value.id)
      href = url.href
    }
  } catch { return }
  const change = kubeUrlChange(location.href, href)
  if (change === 'push' && !replace) globalThis.history.pushState(null, '', href)
  else if (change) globalThis.history.replaceState(globalThis.history.state, '', href)
}
watch(() => [activeProvider.value, cloudView.value, store.currentContext, store.namespace, store.resource, selectedKubeResource.value?.row?.name], scheduleKubeUrlSync)

// Back/Forward to a Kubernetes URL shows that view again.
async function onKubePopState() {
  const view = readKubeUrl(globalThis.location?.search || '')
  if (!view) return
  clearTimeout(kubeUrlTimer)
  applyingKubeHistory = true
  try {
    await setProvider('kubernetes')
    if (!(await applyKubeUrlView(view))) return
    if (view.namespace && view.namespace !== store.namespace) store.namespace = view.namespace
    if (!cloudView.value) {
      await store.loadResources()
      const row = view.name ? store.rows.find(r => r.name === view.name) : null
      selectedKubeResource.value = row ? { type: store.resource, row } : null
    }
  } catch (error) {
    toast(error.message, 'error')
  } finally {
    await nextTick()
    applyingKubeHistory = false
  }
}

// Applies ?view=kubernetes once the contexts are known. A context missing from
// this machine's kubeconfig is said, not silently replaced by another cluster.
async function applyKubeUrlView(view = urlKubeView) {
  if (view.context && view.context !== store.currentContext) {
    if (store.contexts.some(c => c.name === view.context)) {
      selectedContext.value = view.context
      await store.switchContext(view.context)
    } else {
      toast(t('kubeUrl.contextMissing', { context: view.context }), 'warn')
      return false
    }
  }
  if (view.resource === 'overview') cloudView.value = 'kube-overview'
  else if (view.resource === 'logs') cloudView.value = 'kube-logs'
  else if (view.resource && RESOURCES[view.resource]) { cloudView.value = null; store.resource = view.resource }
  return true
}

onMounted(async () => {
  applySettings()
  if (urlKubeView) setProvider('kubernetes')
  openApplicationFromUrl()
  clockTimer = setInterval(() => { clock.value = new Date().toLocaleTimeString() }, 1000)
  clock.value = new Date().toLocaleTimeString()
  // Shortcuts and listeners work right away, not after the cluster answers.
  lastUserInteractionAt = Date.now()
  document.addEventListener('keydown', onKey)
  globalThis.addEventListener('popstate', onKubePopState)
  document.addEventListener('pointerdown', markUserInteraction, { passive: true })
  document.addEventListener('wheel', markUserInteraction, { passive: true, capture: true })
  document.addEventListener('touchstart', markUserInteraction, { passive: true })
  document.addEventListener('scroll', markUserInteraction, { passive: true, capture: true })
  updateStore.initListeners()
  // Kubernetes and the cloud profiles load side by side: a slow cluster does not hold AWS/GCP back.
  const kube = (async () => {
    await store.loadContexts()
    selectedContext.value = store.currentContext
    const urlViewApplied = urlKubeView ? await applyKubeUrlView() : false
    await Promise.all([
      (async () => {
        await store.loadNamespaces()
        // The URL namespace wins over the one saved locally.
        const savedNs = urlViewApplied && urlKubeView.namespace ? urlKubeView.namespace : LS.get('kubeNs', '')
        if (savedNs && (savedNs === 'all' || store.namespaces.includes(savedNs))) store.namespace = savedNs
        await store.loadResources()
        if (urlViewApplied && urlKubeView.name) {
          const row = store.rows.find(r => r.name === urlKubeView.name)
          if (row) selectKubeResource(store.resource, row)
          else toast(t('kubeUrl.resourceMissing', { name: urlKubeView.name }), 'warn')
        }
      })(),
      pfStore.autoRestore(),
    ])
    kubeUrlReady = true
    syncKubeUrl({ replace: true })
  })()
  const cloud = (async () => {
    await Promise.all([envStore.fetchProfiles(), loadAwsLocalProfiles(), loadGcpLocalConfigs()])
    if (activeProvider.value === 'observability' && !hasCloudConnections.value) activeProvider.value = 'kubernetes'
    if (hasCloudConnections.value && !availableObservabilityProviders.value.some(provider => provider.id === observabilityProvider.value)) {
      observabilityProvider.value = availableObservabilityProviders.value[0].id
    }
    applyLinkedAwsProfile()
    applyLinkedGcpProfile()
    // Restaurar perfiles AWS/GCP guardados
    if (awsProfileId.value) awsStore.setActiveProfile(awsProfileId.value)
    if (gcpProfileId.value) gcpStore.setActiveProfile(gcpProfileId.value)
    // A failed first read is retried when the active provider needs it
    if (activeProvider.value === 'aws' && !awsLocalProfiles.value.length) loadAwsLocalProfiles()
    if (activeProvider.value === 'gcp' && !gcpLocalConfigs.value.length)  loadGcpLocalConfigs()
  })()
  await Promise.all([kube, cloud])
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => {
  globalThis.removeEventListener('popstate', onKubePopState)
  clearTimeout(kubeUrlTimer)
  clearInterval(clockTimer)
  clearInterval(autoRefreshTimer)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', markUserInteraction)
  document.removeEventListener('wheel', markUserInteraction, true)
  document.removeEventListener('touchstart', markUserInteraction)
  document.removeEventListener('scroll', markUserInteraction, true)
  stopKubeResize()
})
</script>

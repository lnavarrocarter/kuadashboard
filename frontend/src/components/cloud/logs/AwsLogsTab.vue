<template>
  <div class="cwl-tab">
    <div class="cwl-header">
      <div class="cwl-views" role="tablist">
        <button v-for="v in VIEWS" :key="v" class="btn sm" :class="{ primary: view === v }" role="tab" :aria-selected="view === v" @click="setView(v)">
          {{ t(`awsLogs.view_${v}`) }}<span v-if="v === 'cache' && cache?.groups.length" class="cwl-count">{{ cache.groups.length }}</span>
          <span v-if="v === 'cache' && activeScans" class="cwl-count cwl-scanning" :title="t('awsLogs.scan.activeHint', { n: activeScans })" data-test="active-scans">⟳ {{ activeScans }}</span>
        </button>
      </div>
      <span class="cwl-hint">{{ t(`awsLogs.costHint_${view}`) }}</span>
    </div>

    <div v-if="notice" class="activity-notice">
      <span>{{ notice.text }}</span>
      <button v-if="notice.access" class="btn sm" @click="emit('request-access', notice)">{{ t('awsAccess.requestAccess') }}</button>
    </div>

    <UsageCostPanel v-if="view === 'cache'" ref="usagePanel" compact service="CloudWatch Logs" :profile-id="profileId" />

    <LogScansPanel
      v-show="view === 'cache'"
      :profile-id="profileId"
      :group-names="groupNames"
      :prefill="scanPrefill"
      @open="openScan"
      @changed="onScanChanged"
      @active="n => { activeScans = n }"
      @active-groups="groups => { scanningGroups = groups }"
    />

    <!-- ── Log groups ─────────────────────────────────────────────── -->
    <template v-if="view === 'groups'">
      <div class="cwl-toolbar">
        <input v-model="search" class="ctrl-input cwl-search" :placeholder="t('awsLogs.searchPlaceholder')" />
        <div class="cwl-kinds">
          <button v-for="k in KINDS" :key="k" class="btn sm" :class="{ accent: kind === k }" @click="kind = k">
            {{ t(`awsLogs.kind_${k}`) }} <span class="text-dim">{{ counts[k] || 0 }}</span>
          </button>
        </div>
        <label class="cwl-history" :title="t('awsLogs.history.hint')">
          {{ t('awsLogs.history.whenCaching') }}
          <select v-model="historyChoice" class="ctrl-select">
            <option v-for="o in HISTORY_OPTIONS" :key="o.key" :value="o.key">{{ t(`awsLogs.history.${o.key}`) }}</option>
          </select>
        </label>
        <button class="btn sm" :disabled="loading.groups" :title="t('awsLogs.refresh')" @click="loadGroups">↻</button>
      </div>
      <div v-if="groupsData?.truncated" class="activity-notice">{{ t('awsLogs.truncated') }}</div>
      <div v-if="loading.groups && !groupsData" class="empty-row">{{ t('common.loading') }}</div>
      <div v-else-if="!rows.length" class="empty-row">{{ search ? t('awsLogs.noMatches') : t('awsLogs.empty') }}</div>
      <table v-else class="cloud-table">
        <thead><tr>
          <th :class="thClass('name')" @click="sortBy('name')">{{ t('awsLogs.colGroup') }} <span class="sort-icon">{{ sortIcon('name') }}</span></th>
          <th :class="thClass('kind')" @click="sortBy('kind')">{{ t('awsLogs.colSource') }} <span class="sort-icon">{{ sortIcon('kind') }}</span></th>
          <th :class="thClass('storedBytes')" @click="sortBy('storedBytes')" :title="t('awsLogs.storedHint')">{{ t('awsLogs.colStored') }} <span class="sort-icon">{{ sortIcon('storedBytes') }}</span></th>
          <th :class="thClass('retentionInDays')" @click="sortBy('retentionInDays')">{{ t('awsLogs.colRetention') }} <span class="sort-icon">{{ sortIcon('retentionInDays') }}</span></th>
          <th>{{ t('awsLogs.colCache') }}</th>
          <th></th>
        </tr></thead>
        <tbody>
          <template v-for="g in sortRows(rows)" :key="g.name">
            <tr :class="{ 'msg-selected': selected === g.name }">
              <td class="cwl-name">{{ g.name }}</td>
              <td>
                <span class="msg-chip" :class="g.kind === 'machine' ? 'warn' : g.kind === 'aws' ? 'ok' : ''">{{ t(`awsLogs.kind_${g.kind}`) }}</span>
                <span v-if="g.service && g.service !== 'aws'" class="text-dim cwl-service">{{ g.service }}</span>
              </td>
              <td class="activity-cell">{{ formatBytes(g.storedBytes) }}</td>
              <td class="text-dim">{{ g.retentionInDays ? t('awsLogs.days', { n: g.retentionInDays }) : t('awsLogs.neverExpire') }}</td>
              <td>
                <span v-if="g.cache" class="msg-chip ok" :title="t('awsLogs.cachedHint', { size: formatBytes(g.cache.bytes), events: g.cache.events })">
                  {{ formatWindow(g.cache.windowMs) }} · {{ formatBytes(g.cache.bytes) }}
                </span>
                <button v-else class="btn sm" :disabled="busy[g.name]" :title="t('awsLogs.cacheHint')" @click="enableCache(g)">{{ busy[g.name] ? '…' : t('awsLogs.cacheIt') }}</button>
              </td>
              <td><button class="btn sm" :aria-expanded="selected === g.name" @click="toggle(g)">{{ selected === g.name ? t('awsMsg.hide') : t('awsLogs.viewLogs') }}</button></td>
            </tr>
            <tr v-if="selected === g.name" class="msg-detail-row">
              <td colspan="6">
                <div class="cwl-detail">
                  <div class="cwl-streams">
                    <span v-if="streams" class="text-dim">{{ t('awsLogs.streams', { n: streams.streams.length }) }}{{ streams.more ? '+' : '' }}</span>
                    <span v-if="streams?.instances.length" class="cwl-instances">
                      {{ t('awsLogs.instances') }}
                      <span v-for="id in streams.instances" :key="id" class="msg-chip warn">{{ id }}</span>
                    </span>
                    <span class="cwl-modes">
                      <button class="btn sm" :class="{ accent: detailMode === 'query' }" @click="detailMode = 'query'">{{ t('awsLogs.q.modeQuery') }}</button>
                      <button class="btn sm" :class="{ accent: detailMode === 'events' }" @click="detailMode = 'events'">{{ t('awsLogs.q.modeEvents') }}</button>
                    </span>
                  </div>
                  <LogActivityChart
                    ref="activityChart"
                    :key="`chart:${g.name}`"
                    :group="g.name"
                    :profile-id="profileId"
                    :cached="!!g.cache"
                    :default-minutes="1440"
                    @range="onChartRange(g, $event)"
                  />
                  <div v-if="!g.cache" class="cwl-chart-hint">
                    {{ t('awsLogs.chart.cacheToSee') }}
                    <button class="btn sm" :disabled="busy[g.name]" @click="enableCache(g)">{{ busy[g.name] ? '…' : t('awsLogs.cacheIt') }}</button>
                  </div>
                  <LogsQueryEditor
                    v-if="detailMode === 'query'"
                    :key="g.name"
                    :group="g"
                    :profile-id="profileId"
                    :sample-events="events?.events || []"
                    @request-access="emit('request-access', $event)"
                    @ingested="onIngested"
                  />
                  <template v-else>
                  <div class="cwl-toolbar">
                    <span v-if="eventsQuery.from" class="msg-chip warn cwl-window">
                      {{ formatTime(eventsQuery.from, settings.lang) }} → {{ formatTime(eventsQuery.to, settings.lang) }}
                      <button class="li-x" :aria-label="t('awsLogs.intel.clear')" @click="clearWindow(g)">×</button>
                    </span>
                    <select v-model="eventsQuery.source" class="ctrl-select" :aria-label="t('awsLogs.source')">
                      <option value="live">{{ t('awsLogs.sourceLive') }}</option>
                      <option value="cache" :disabled="!g.cache">{{ t('awsLogs.sourceCache') }}</option>
                    </select>
                    <select v-if="!eventsQuery.from" v-model.number="eventsQuery.minutes" class="ctrl-select" :aria-label="t('awsLogs.range')">
                      <option v-for="r in LOG_RANGES" :key="r.minutes" :value="r.minutes">{{ r.label }}</option>
                    </select>
                    <select v-if="streams?.streams.length" v-model="eventsQuery.stream" class="ctrl-select cwl-stream-select" :aria-label="t('awsLogs.stream')">
                      <option value="">{{ t('awsLogs.allStreams') }}</option>
                      <option v-for="s in streams.streams" :key="s.name" :value="s.name">{{ s.name }}</option>
                    </select>
                    <input v-model="eventsQuery.filter" class="ctrl-input cwl-filter" :placeholder="t('awsLogs.filterPattern')" :title="t('awsLogs.filterSyntax')" @keydown.enter="loadEvents(g)" />
                    <button class="btn sm primary" :disabled="loading.events" @click="loadEvents(g)">{{ loading.events ? '…' : t('awsLogs.load') }}</button>
                  </div>
                  <div v-if="events" class="text-dim cwl-events-meta">
                    {{ t('awsLogs.eventsCount', { n: events.events.length }) }}
                    <template v-if="events.more"> · {{ t('awsLogs.moreEvents') }}</template>
                    <template v-if="events.storedInCache"> · {{ t('awsLogs.storedInCache', { n: events.storedInCache }) }}</template>
                    <template v-if="events.status === 'missing'"> · {{ t('awsLogs.missingGroup') }}</template>
                  </div>
                  <div v-if="events?.source === 'cache' && events.coverage" class="cwl-coverage">
                    {{ t('awsLogs.cacheCoverage', { from: formatTime(events.coverage.oldest, settings.lang), to: formatTime(events.coverage.syncedUntil || events.coverage.newest, settings.lang) }) }}
                    <template v-if="events.coverage.backfillPending"> · {{ t('awsLogs.backfill') }}</template>
                    <button class="btn sm" :disabled="busy[g.name]" @click="syncOne(g.name).then(() => loadEvents(g))">{{ t('awsLogs.sync') }}</button>
                  </div>
                  <div v-if="events?.source === 'cache'" class="cwl-hint">{{ t('awsLogs.cacheSanitizedHint') }}</div>
                  <div v-if="events?.events.length" class="cwl-events">
                    <div v-for="(e, i) in events.events" :key="i" class="cwl-event">
                      <span class="cwl-ts">{{ formatTime(e.timestamp, settings.lang) }}</span>
                      <span class="cwl-stream" :title="e.logStreamName">{{ e.logStreamName }}</span>
                      <span class="cwl-msg">{{ e.message }}</span>
                    </div>
                  </div>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>

    <!-- ── Local cache ────────────────────────────────────────────── -->
    <template v-else-if="view === 'cache'">
      <div v-if="loading.cache && !cache" class="empty-row">{{ t('common.loading') }}</div>
      <template v-else-if="cache">
        <div class="cwl-summary">
          <div class="cwl-usage">
            <div class="cwl-usage-label">
              {{ t('awsLogs.cacheUsage', { used: formatBytes(cache.totalBytes), budget: formatBytes(cache.budgetBytes) }) }}
              <span class="text-dim">· {{ t('awsLogs.eventsCount', { n: cache.totalEvents }) }}</span>
            </div>
            <div class="cwl-bar" role="progressbar" :aria-valuenow="usage" aria-valuemin="0" aria-valuemax="100"><div :style="{ width: `${usage}%` }"></div></div>
          </div>
          <button class="btn sm primary" :disabled="loading.sync || !cache.groups.length" @click="syncAll">{{ loading.sync ? t('awsLogs.syncing') : t('awsLogs.syncAll') }}</button>
        </div>
        <div class="cwl-hint">{{ t('awsLogs.cachePolicy', { max: formatWindow(cache.maxWindowMs), hot: formatWindow(cache.hotWindowMs) }) }}</div>
        <div v-if="cache.encryption" class="cwl-hint cwl-protection">
          🔒 {{ t('awsLogs.protection', { algorithm: cache.encryption.algorithm, store: t(`awsLogs.keyStore_${cache.encryption.keyStore || 'pending'}`) }) }}
          <template v-if="cache.totalBytes"> · {{ t('awsLogs.compression', { raw: formatBytes(cache.totalRawBytes), stored: formatBytes(cache.totalBytes), ratio: compressionRatio(cache.totalRawBytes, cache.totalBytes) }) }}</template>
        </div>
        <div v-if="!cache.groups.length" class="empty-row">{{ t('awsLogs.cacheEmpty') }}</div>
        <table v-else class="cloud-table">
          <thead><tr>
            <th>{{ t('awsLogs.colGroup') }}</th>
            <th :title="t('awsLogs.windowHint')">{{ t('awsLogs.colWindow') }}</th>
            <th :title="t('awsLogs.history.hint')">{{ t('awsLogs.history.column') }}</th>
            <th>{{ t('awsLogs.colDaily') }}</th>
            <th>{{ t('awsLogs.colEvents') }}</th>
            <th>{{ t('awsLogs.colSize') }}</th>
            <th>{{ t('awsLogs.colRange') }}</th>
            <th>{{ t('awsLogs.colLastSync') }}</th>
            <th></th>
          </tr></thead>
          <tbody>
            <template v-for="c in cache.groups" :key="c.logGroup">
            <tr :class="{ 'msg-selected': intelOpen === c.logGroup }">
              <td class="cwl-name">{{ c.logGroup }}</td>
              <td>
                {{ formatWindow(c.windowMs) }}
                <span v-if="c.limitedBySize" class="msg-chip warn" :title="t('awsLogs.limitedHint')">{{ t('awsLogs.limited') }}</span>
              </td>
              <td>
                <select class="ctrl-select cwl-history-select" :value="historyKey(c.historyMs)" :disabled="busy[c.logGroup]" :aria-label="t('awsLogs.history.column')" @change="setHistory(c.logGroup, $event.target.value)">
                  <option v-for="o in HISTORY_OPTIONS" :key="o.key" :value="o.key">{{ t(`awsLogs.history.${o.key}`) }}</option>
                </select>
                <button v-if="c.backfillPending" class="btn sm" :disabled="busy[c.logGroup]" :title="t('awsLogs.history.fillHint')" @click="fillHistory(c.logGroup)">{{ busy[c.logGroup] ? '…' : t('awsLogs.history.fill') }}</button>
              </td>
              <td class="text-dim">{{ c.dailyBytes ? `~${formatBytes(c.dailyBytes)}` : '—' }}</td>
              <td class="activity-cell">{{ c.events }}</td>
              <td class="activity-cell" :title="t('awsLogs.blocksHint', { blocks: c.blocks, hot: c.hotBlocks, raw: formatBytes(c.rawBytes) })">
                {{ formatBytes(c.bytes) }}<span v-if="c.compressionRatio" class="text-dim"> · {{ c.compressionRatio }}×</span>
              </td>
              <td class="text-dim cwl-range">
                {{ formatTime(c.oldest, settings.lang) }} → {{ formatTime(c.newest, settings.lang) }}
                <span v-if="c.pinnedFrom" class="msg-chip" :title="t('awsLogs.scan.pinnedHint')">{{ t('awsLogs.scan.pinned') }}</span>
              </td>
              <td>
                <span :class="c.lastSyncStatus === 'error' || c.lastSyncStatus === 'missing' ? 'status-err' : 'text-dim'" :title="c.lastError || ''">
                  {{ formatTime(c.lastSyncAt, settings.lang) }}<template v-if="c.lastSyncStatus && c.lastSyncStatus !== 'ok'"> · {{ t(`awsLogs.sync_${c.lastSyncStatus}`) }}</template>
                </span>
              </td>
              <td class="cwl-actions">
                <button class="btn sm" :class="{ accent: intelOpen === c.logGroup }" :aria-expanded="intelOpen === c.logGroup" @click="intelOpen = intelOpen === c.logGroup ? null : c.logGroup">{{ t('awsLogs.intel.button') }}</button>
                <button class="btn sm" :disabled="busy[c.logGroup]" @click="syncOne(c.logGroup)">{{ t('awsLogs.sync') }}</button>
                <button class="btn sm" :title="t('awsLogs.scan.rowHint')" @click="scanPrefill = { group: c.logGroup, at: Date.now() }">{{ t('awsLogs.scan.button') }}</button>
                <button class="btn sm" @click="openCached(c.logGroup)">{{ t('awsLogs.viewLogs') }}</button>
                <button class="btn sm danger" :disabled="busy[c.logGroup]" @click="disableCache(c.logGroup)">{{ t('awsLogs.remove') }}</button>
              </td>
            </tr>
            <tr v-if="intelOpen === c.logGroup" class="msg-detail-row">
              <td colspan="9"><LogIntelligencePanel :key="c.logGroup" :group="c.logGroup" :profile-id="profileId" :revision="cacheRevision(c)" :scanning="scanningGroups.includes(c.logGroup)" /></td>
            </tr>
            </template>
          </tbody>
        </table>
      </template>
    </template>

    <!-- ── S3 backup ──────────────────────────────────────────────── -->
    <template v-else>
      <div v-if="loading.backup && !backup" class="empty-row">{{ t('awsLogs.backupLoading') }}</div>
      <template v-else-if="backup">
        <div class="cwl-cards">
          <div class="cwl-card"><b>{{ backupStats.continuous }}</b><span>{{ t('awsLogs.method_continuous') }}</span></div>
          <div class="cwl-card"><b>{{ backupStats.export }}</b><span>{{ t('awsLogs.method_export') }}</span></div>
          <div class="cwl-card"><b>{{ backupStats.none }}</b><span>{{ t('awsLogs.method_none') }} · {{ formatBytes(backupStats.unprotectedBytes) }}</span></div>
          <div class="cwl-card" :class="{ warn: backupStats.atRisk }"><b>{{ backupStats.atRisk }}</b><span>{{ t('awsLogs.atRisk') }}</span></div>
          <button class="btn sm" :disabled="loading.backup" @click="loadBackup">↻</button>
        </div>
        <div v-if="backup.coverage.length > backup.subscriptionsChecked" class="activity-notice">{{ t('awsLogs.subscriptionsCapped', { n: backup.subscriptionsChecked }) }}</div>
        <div v-for="err in backup.errors" :key="err.source" class="activity-notice">{{ t(`awsLogs.sourceError_${err.source}`) }}: {{ err.error }}</div>

        <section v-if="archive.bucket" class="cwl-archive">
          <div class="cwl-section-head">
            <h5>{{ t('awsLogs.archiveTitle') }}</h5>
            <code>s3://{{ archive.bucket }}/{{ archive.prefix }}</code>
            <button v-if="archive.prefix" class="btn sm" @click="browse(archive.bucket, parentPrefix(archive.prefix))">↑</button>
            <button class="btn sm" @click="closeArchive">{{ t('awsMsg.hide') }}</button>
          </div>
          <div v-if="archive.loading" class="empty-row">{{ t('common.loading') }}</div>
          <div v-else-if="archive.error" class="activity-notice">{{ archive.error }}</div>
          <ul v-else class="cwl-files">
            <li v-for="f in archive.folders" :key="f"><button class="cwl-link" @click="browse(archive.bucket, f)">📁 {{ f.slice(archive.prefix.length) }}</button></li>
            <li v-for="f in archive.files" :key="f.key">
              <button class="cwl-link" @click="readObject(f.key)">📄 {{ f.name }}</button>
              <span class="text-dim">{{ formatBytes(f.size) }} · {{ formatTime(f.lastModified, settings.lang) }}<template v-if="f.storageClass && f.storageClass !== 'STANDARD'"> · {{ f.storageClass }}</template></span>
            </li>
            <li v-if="!archive.folders.length && !archive.files.length" class="text-dim">{{ t('awsLogs.archiveEmpty') }}</li>
          </ul>
          <div v-if="archive.object" class="cwl-object">
            <div class="text-dim">
              {{ archive.object.key }} · {{ formatBytes(archive.object.size) }}<template v-if="archive.object.gzip"> · gzip</template>
              <template v-if="archive.object.truncated || archive.object.partial"> · {{ t('awsLogs.objectTruncated') }}</template>
            </div>
            <pre>{{ archive.object.text }}</pre>
          </div>
        </section>

        <section class="cwl-section">
          <h5>{{ t('awsLogs.coverageTitle') }}</h5>
          <div class="cwl-toolbar">
            <input v-model="search" class="ctrl-input cwl-search" :placeholder="t('awsLogs.searchPlaceholder')" />
            <label class="cwl-check"><input v-model="riskOnly" type="checkbox" /> {{ t('awsLogs.riskOnly') }}</label>
          </div>
          <table class="cloud-table">
            <thead><tr>
              <th>{{ t('awsLogs.colGroup') }}</th>
              <th>{{ t('awsLogs.colStored') }}</th>
              <th>{{ t('awsLogs.colRetention') }}</th>
              <th>{{ t('awsLogs.colBackup') }}</th>
              <th>{{ t('awsLogs.colLastExport') }}</th>
              <th>{{ t('awsLogs.colRisk') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in coverageRows" :key="c.name">
                <td class="cwl-name">{{ c.name }} <span class="text-dim cwl-service">{{ t(`awsLogs.kind_${c.kind}`) }}</span></td>
                <td class="activity-cell">{{ formatBytes(c.storedBytes) }}</td>
                <td class="text-dim">{{ c.retentionInDays ? t('awsLogs.days', { n: c.retentionInDays }) : t('awsLogs.neverExpire') }}</td>
                <td>
                  <span class="msg-chip" :class="c.method === 'none' ? '' : 'ok'">{{ t(`awsLogs.method_${c.method}`) }}</span>
                  <span v-for="s in c.subscriptions" :key="s.name" class="text-dim cwl-dest" :title="s.destinationArn">{{ s.kind }}: {{ s.destinationArn.split(':').pop() }}</span>
                </td>
                <td>
                  <template v-if="c.lastExport">
                    <button class="cwl-link" @click="browse(c.lastExport.bucket, exportTaskPrefix({ ...c.lastExport, taskId: c.lastExport.taskId }).prefix)">{{ c.lastExport.bucket }}</button>
                    <span class="text-dim"> {{ formatTime(c.lastExport.to, settings.lang) }}</span>
                  </template>
                  <span v-else class="text-dim">—</span>
                </td>
                <td>
                  <span v-if="c.risk" class="msg-chip warn" :title="t(`awsLogs.risk_${c.risk}Hint`, { n: c.retentionInDays })">{{ t(`awsLogs.risk_${c.risk}`) }}</span>
                  <span v-else class="text-dim">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="cwl-section">
          <h5>{{ t('awsLogs.exportsTitle') }}</h5>
          <div v-if="!backup.exportTasks.length" class="text-dim">{{ t('awsLogs.noExports') }}</div>
          <table v-else class="cloud-table">
            <thead><tr>
              <th>{{ t('awsLogs.colGroup') }}</th><th>{{ t('awsLogs.colRange') }}</th><th>{{ t('awsLogs.colDestination') }}</th><th>{{ t('awsLogs.colStatus') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="task in backup.exportTasks" :key="task.taskId">
                <td class="cwl-name">{{ task.logGroup }}</td>
                <td class="text-dim cwl-range">{{ formatTime(task.from, settings.lang) }} → {{ formatTime(task.to, settings.lang) }}</td>
                <td><button v-if="task.bucket" class="cwl-link" @click="browse(task.bucket, exportTaskPrefix(task).prefix)">s3://{{ task.bucket }}/{{ exportTaskPrefix(task).prefix }}</button></td>
                <td><span :class="task.status === 'COMPLETED' ? '' : task.status === 'FAILED' ? 'status-err' : 'text-dim'" :title="task.statusMessage || ''">{{ task.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="cwl-section">
          <h5>{{ t('awsLogs.s3SourcesTitle') }}</h5>
          <div v-if="!backup.s3Sources.length" class="text-dim">{{ t('awsLogs.noS3Sources') }}</div>
          <table v-else class="cloud-table">
            <thead><tr><th>{{ t('awsLogs.colType') }}</th><th>{{ t('awsMsg.name') }}</th><th>{{ t('awsLogs.colDestination') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in backup.s3Sources" :key="`${s.type}:${s.name}`">
                <td><span class="msg-chip">{{ t(`awsLogs.s3Type_${s.type}`) }}</span></td>
                <td>{{ s.name }}<span v-if="s.resource" class="text-dim"> · {{ s.resource }}</span></td>
                <td class="text-dim">s3://{{ s.bucket }}/{{ s.prefix }}</td>
                <td><button class="btn sm" @click="browse(s.bucket, s.prefix)">{{ t('awsLogs.explore') }}</button></td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useSortable } from '../../../composables/useSortable'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import {
  HISTORY_OPTIONS, LOG_RANGES, backupSummary, cacheUsage, exportTaskPrefix, filterGroups, formatBytes, formatTime, formatWindow, kindCounts, parentPrefix,
} from '../../../lib/awsLogs'
import LogsQueryEditor from './LogsQueryEditor.vue'
import LogIntelligencePanel from './LogIntelligencePanel.vue'
import UsageCostPanel from '../UsageCostPanel.vue'
import LogActivityChart from './LogActivityChart.vue'
import LogScansPanel from './LogScansPanel.vue'

const props = defineProps({ profileId: { type: String, default: '' } })
const emit = defineEmits(['request-access'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const { sortBy, sortRows, sortIcon, thClass } = useSortable()

const VIEWS = ['groups', 'cache', 'backup']
const KINDS = ['all', 'aws', 'machine', 'custom']
const BASE = '/api/cloud/aws/cloudwatch'

const view = ref('groups')
const search = ref('')
const kind = ref('all')
const riskOnly = ref(false)
const selected = ref(null)
const detailMode = ref('query')
const intelOpen = ref(null)
const notice = ref(null)
const groupsData = ref(null)
const cache = ref(null)
const backup = ref(null)
const streams = ref(null)
const events = ref(null)
const busy = reactive({})
const loading = reactive({ groups: false, cache: false, backup: false, events: false, sync: false })
const activityChart = ref(null)
const activeScans = ref(0)
// Groups with a running background scan (their Intelligence panel says so).
const scanningGroups = ref([])
// Changes when a sync or scan caches new events: the panel then offers to refresh.
const cacheRevision = group => `${group.events ?? ''}|${group.newest ?? ''}|${group.lastSyncAt ?? ''}`
const usagePanel = ref(null)
const scanPrefill = ref(null)
const groupNames = computed(() => (groupsData.value?.groups || []).map(g => g.name))

// Searches of a cached group feed its cache and per-minute index: refresh the chart.
function onIngested(count) {
  // Inside v-for the ref is an array (only the open group's chart is mounted).
  for (const chart of [].concat(activityChart.value || [])) chart?.reload()
  toast(t('awsLogs.chart.ingested', { n: count }), 'success')
}

const eventsQuery = reactive({ source: 'live', minutes: 60, stream: '', filter: '', from: null, to: null })

// Zooming the chart lists the events of that exact window (cache when available, live otherwise).
function onChartRange(group, range) {
  if (!range.zoomed) {
    if (eventsQuery.from) clearWindow(group)
    return
  }
  Object.assign(eventsQuery, { source: group.cache ? 'cache' : 'live', from: range.from, to: range.to })
  detailMode.value = 'events'
  loadEvents(group)
}

function clearWindow(group) {
  Object.assign(eventsQuery, { from: null, to: null })
  loadEvents(group)
}
const historyChoice = ref('window')

function historyHours(key) {
  return HISTORY_OPTIONS.find(o => o.key === key)?.hours ?? null
}
function historyKey(ms) {
  if (ms == null) return 'window'
  return HISTORY_OPTIONS.find(o => o.hours != null && o.hours * 3600000 === ms)?.key || 'window'
}
const archive = reactive({ bucket: '', prefix: '', folders: [], files: [], loading: false, error: null, object: null })

const counts = computed(() => kindCounts(groupsData.value?.groups))
const rows = computed(() => filterGroups(groupsData.value?.groups, { search: search.value, kind: kind.value }))
const usage = computed(() => cacheUsage(cache.value))
const backupStats = computed(() => backupSummary(backup.value?.coverage))
const coverageRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (backup.value?.coverage || [])
    .filter(c => (!riskOnly.value || c.risk) && (!q || c.name.toLowerCase().includes(q)))
    .sort((a, b) => (!!b.risk - !!a.risk) || (b.storedBytes - a.storedBytes))
})

function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

function fail(err) {
  notice.value = { text: err.message, access: err.details?.access || null }
}

async function call(path, options = {}) {
  notice.value = null
  return apiFetch(`${BASE}${path}`, { ...options, headers: headers(!!options.body) })
}

async function loadGroups() {
  if (!props.profileId) return
  loading.groups = true
  try { groupsData.value = await call('/log-groups') } catch (err) { fail(err) } finally { loading.groups = false }
}

async function loadCache() {
  if (!props.profileId) return
  loading.cache = true
  try { cache.value = await call('/log-cache') } catch (err) { fail(err) } finally { loading.cache = false }
}

async function loadBackup() {
  if (!props.profileId) return
  loading.backup = true
  try { backup.value = await call('/log-backup') } catch (err) { fail(err) } finally { loading.backup = false }
}

function setView(v) {
  view.value = v
  if (v === 'cache') loadCache()
  if (v === 'backup' && !backup.value) loadBackup()
  if (v === 'groups' && !groupsData.value) loadGroups()
}

function updateGroupCache(name, cacheInfo) {
  const group = groupsData.value?.groups.find(g => g.name === name)
  if (group) group.cache = cacheInfo
}

async function toggle(group) {
  if (selected.value === group.name) { selected.value = null; return }
  selected.value = group.name
  streams.value = null
  events.value = null
  Object.assign(eventsQuery, { source: group.cache ? 'cache' : 'live', stream: '', filter: '', from: null, to: null })
  try { streams.value = await call(`/log-groups/streams?group=${encodeURIComponent(group.name)}`) } catch (err) { fail(err) }
  loadEvents(group)
}

async function loadEvents(group) {
  loading.events = true
  try {
    const query = new URLSearchParams({ group: group.name, minutes: eventsQuery.minutes, source: eventsQuery.source })
    if (eventsQuery.from) { query.set('from', eventsQuery.from); query.set('to', eventsQuery.to) }
    if (eventsQuery.filter) query.set('filter', eventsQuery.filter)
    if (eventsQuery.stream) query.set('stream', eventsQuery.stream)
    events.value = await call(`/log-groups/events?${query}`)
    if (events.value.storedInCache) onIngested(events.value.storedInCache)
  } catch (err) { fail(err) } finally { loading.events = false }
}

async function enableCache(group) {
  busy[group.name] = true
  try {
    const result = await call('/log-cache', { method: 'POST', body: JSON.stringify({ group: group.name, historyHours: historyHours(historyChoice.value) }) })
    updateGroupCache(group.name, result.group)
    toast(t('awsLogs.cachedToast', { group: group.name, n: result.inserted, window: formatWindow(result.group.windowMs) }), 'success')
  } catch (err) { fail(err) } finally { busy[group.name] = false }
}

async function disableCache(name) {
  busy[name] = true
  try {
    cache.value = { ...cache.value, ...(await call(`/log-cache?group=${encodeURIComponent(name)}`, { method: 'DELETE' })) }
    updateGroupCache(name, null)
  } catch (err) { fail(err) } finally { busy[name] = false }
}

function compressionRatio(raw, stored) {
  return stored ? Math.round((raw / stored) * 10) / 10 : '—'
}

function applySync(result) {
  cache.value = { ...cache.value, ...result }
  for (const g of result.groups || []) updateGroupCache(g.logGroup, g)
  const failed = (result.results || []).filter(r => r.status === 'error')
  const inserted = (result.results || []).reduce((sum, r) => sum + (r.inserted || 0), 0)
  toast(failed.length ? t('awsLogs.syncFailed', { n: failed.length }) : t('awsLogs.synced', { n: inserted }), failed.length ? 'error' : 'success')
}

async function syncAll() {
  loading.sync = true
  try { applySync(await call('/log-cache/sync', { method: 'POST', body: '{}' })) } catch (err) { fail(err) } finally { loading.sync = false }
}

async function syncOne(name, extra = {}) {
  busy[name] = true
  try { applySync(await call('/log-cache/sync', { method: 'POST', body: JSON.stringify({ group: name, ...extra }) })) } catch (err) { fail(err) } finally { busy[name] = false }
}

// Fill older hours now with a bigger page budget (FilterLogEvents: no scan charge).
function fillHistory(name) {
  return syncOne(name, { backfillPages: 50 })
}

async function setHistory(name, key) {
  busy[name] = true
  try {
    const group = await call('/log-cache', { method: 'PATCH', body: JSON.stringify({ group: name, historyHours: historyHours(key) }) })
    cache.value = { ...cache.value, groups: cache.value.groups.map(g => (g.logGroup === name ? group : g)) }
    updateGroupCache(name, group)
  } catch (err) { fail(err) } finally { busy[name] = false }
}

// Opens a cached group in the groups view; with a range, lists its cached events of that range.
async function openCached(name, range = null) {
  view.value = 'groups'
  if (!groupsData.value) await loadGroups()
  search.value = name
  kind.value = 'all'
  const group = groupsData.value?.groups.find(g => g.name === name)
  if (!group) return
  if (selected.value !== name) await toggle(group)
  if (range) {
    Object.assign(eventsQuery, { source: 'cache', from: range.from, to: range.to })
    detailMode.value = 'events'
    loadEvents(group)
  }
}

function openScan(scan) {
  return openCached(scan.logGroup, { from: scan.from, to: scan.to })
}

// A scan started (it may have cached a new group) or finished: refresh the cache summary.
async function onScanChanged() {
  await loadCache()
  // A finished scan downloaded data: show its cost.
  usagePanel.value?.load()
  for (const g of cache.value?.groups || []) updateGroupCache(g.logGroup, g)
}

async function browse(bucket, prefix = '') {
  Object.assign(archive, { bucket, prefix, folders: [], files: [], loading: true, error: null, object: null })
  try {
    const data = await apiFetch(`/api/cloud/aws/s3/${encodeURIComponent(bucket)}/browse?prefix=${encodeURIComponent(prefix)}`, { headers: headers() })
    archive.folders = data.folders || []
    archive.files = (data.files || []).sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
  } catch (err) {
    archive.error = err.message
    if (err.details?.access) notice.value = { text: err.message, access: err.details.access }
  } finally { archive.loading = false }
}

async function readObject(key) {
  archive.loading = true
  try {
    archive.object = await call(`/log-archive/object?bucket=${encodeURIComponent(archive.bucket)}&key=${encodeURIComponent(key)}`)
  } catch (err) { archive.error = err.message } finally { archive.loading = false }
}

function closeArchive() {
  Object.assign(archive, { bucket: '', prefix: '', folders: [], files: [], object: null, error: null })
}

onMounted(() => {
  loadGroups()
  loadCache()
})
</script>

<style scoped>
.cwl-tab { display: flex; flex-direction: column; gap: 10px; }
.cwl-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cwl-views { display: flex; gap: 4px; }
.cwl-count { margin-left: 6px; font-size: 10px; opacity: .8; }
.cwl-scanning { color: var(--accent); opacity: 1; }
.cwl-hint { font-size: 11px; color: var(--text-dim); }
.cwl-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cwl-search { min-width: 220px; flex: 1 1 220px; max-width: 420px; }
.cwl-filter { flex: 1 1 200px; min-width: 160px; }
.cwl-stream-select { max-width: 260px; }
.cwl-kinds { display: flex; gap: 4px; flex-wrap: wrap; }
.cwl-chart-hint { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--text-dim); padding: 6px 0; }
.cwl-window { display: inline-flex; align-items: center; gap: 4px; }
.li-x { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
.cwl-history { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--text-dim); }
.cwl-history-select { max-width: 150px; }
.cwl-coverage { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 11px; color: var(--text-dim); }
.cwl-name { font-family: monospace; font-size: 12px; overflow-wrap: anywhere; white-space: normal; }
.cwl-service { margin-left: 6px; font-size: 11px; }
.cwl-detail { display: flex; flex-direction: column; gap: 8px; padding: 6px 2px; white-space: normal; }
.cwl-streams { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.cwl-modes { display: flex; gap: 4px; margin-left: auto; }
.cwl-instances { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.cwl-events-meta { font-size: 11px; }
.cwl-events { max-height: 420px; overflow: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-row); font-family: monospace; font-size: 11px; }
.cwl-event { display: grid; grid-template-columns: 150px 160px 1fr; gap: 8px; padding: 3px 8px; border-bottom: 1px solid var(--border); }
.cwl-ts { color: var(--text-dim); white-space: nowrap; }
.cwl-stream { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cwl-msg { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.cwl-summary { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.cwl-usage { flex: 1 1 320px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.cwl-bar { height: 6px; border-radius: 3px; background: var(--bg-hover); overflow: hidden; }
.cwl-bar div { height: 100%; background: var(--accent); }
.cwl-range { font-size: 11px; white-space: nowrap; }
.cwl-actions { display: flex; gap: 4px; }
.cwl-cards { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
.cwl-card { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; min-width: 130px; font-size: 11px; color: var(--text-dim); }
.cwl-card b { font-size: 18px; color: var(--text); }
.cwl-card.warn b { color: var(--yellow); }
.cwl-section, .cwl-archive { display: flex; flex-direction: column; gap: 6px; }
.cwl-section h5, .cwl-archive h5 { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); }
.cwl-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cwl-section-head code { font-size: 11px; overflow-wrap: anywhere; }
.cwl-archive { border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.cwl-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; max-height: 240px; overflow: auto; }
.cwl-files li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.cwl-link { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-align: left; overflow-wrap: anywhere; }
.cwl-link:hover { text-decoration: underline; }
.cwl-object pre { max-height: 360px; overflow: auto; margin: 4px 0 0; padding: 8px; font-size: 11px; background: var(--bg-row); border: 1px solid var(--border); border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
.cwl-dest { margin-left: 6px; font-size: 11px; }
.cwl-check { display: flex; gap: 4px; align-items: center; font-size: 12px; }
@media (max-width: 720px) {
  .cwl-event { grid-template-columns: 1fr; gap: 2px; }
}
</style>

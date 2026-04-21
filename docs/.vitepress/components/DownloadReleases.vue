<script setup>
import { ref, computed, onMounted } from 'vue'
import { marked } from 'marked'

const REPO = 'lnavarrocarter/kuadashboard'
const releases = ref([])
const loading  = ref(true)
const error    = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`)
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`)
    const data = await res.json()
    releases.value = data.filter(r => !r.draft)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

const latest   = computed(() => releases.value[0] ?? null)
const previous = computed(() => releases.value.slice(1))

function fileIcon(name) {
  if (name.endsWith('.exe'))      return '🪟'
  if (name.endsWith('.dmg'))      return '🍎'
  if (name.endsWith('.AppImage')) return '🐧'
  if (name.endsWith('.deb'))      return '🐧'
  return '📦'
}

function fileSize(bytes) {
  if (!bytes) return ''
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function platformLabel(name) {
  if (name.endsWith('.exe'))      return 'Windows'
  if (name.endsWith('.dmg'))      return name.includes('arm64') ? 'macOS (Apple Silicon)' : 'macOS (Intel)'
  if (name.endsWith('.AppImage')) return 'Linux (AppImage)'
  if (name.endsWith('.deb'))      return 'Linux (deb)'
  return 'Other'
}

function releaseAssets(release) {
  return release.assets.filter(a => /\.(exe|dmg|AppImage|deb)$/.test(a.name))
}

function renderMarkdown(body) {
  if (!body) return ''
  return marked.parse(body)
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="downloads-widget">
    <!-- Loading -->
    <div v-if="loading" class="state-box loading">
      <span class="spinner" /> Loading latest release…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="state-box error-box">
      <p>Could not load releases from GitHub.</p>
      <p class="dim">{{ error }}</p>
      <a :href="`https://github.com/${REPO}/releases`" target="_blank" class="fallback-link">
        → View all releases on GitHub
      </a>
    </div>

    <!-- No releases -->
    <div v-else-if="!latest" class="state-box">
      <p>No releases published yet.</p>
      <a :href="`https://github.com/${REPO}/releases`" target="_blank" class="fallback-link">
        → Check GitHub Releases
      </a>
    </div>

    <!-- Latest release -->
    <div v-else>
      <!-- Header -->
      <div class="release-header">
        <div class="release-title-row">
          <h3 class="release-title">{{ latest.name || latest.tag_name }}</h3>
          <span class="badge stable">Latest</span>
          <span v-if="latest.prerelease" class="badge pre">Pre-release</span>
        </div>
        <div class="release-meta">
          <code class="release-tag">{{ latest.tag_name }}</code>
          <span class="release-date">{{ formatDate(latest.published_at) }}</span>
          <a :href="latest.html_url" target="_blank" class="release-gh-link">View on GitHub ↗</a>
        </div>
      </div>

      <!-- Download cards -->
      <div class="assets-grid">
        <a
          v-for="asset in releaseAssets(latest)"
          :key="asset.id"
          :href="asset.browser_download_url"
          class="asset-card"
          target="_blank"
        >
          <span class="asset-icon">{{ fileIcon(asset.name) }}</span>
          <span class="asset-info">
            <span class="asset-platform">{{ platformLabel(asset.name) }}</span>
            <span class="asset-name">{{ asset.name }}</span>
            <span class="asset-size">{{ fileSize(asset.size) }}</span>
          </span>
          <span class="download-arrow">↓</span>
        </a>
      </div>

      <!-- Release notes -->
      <div v-if="latest.body" class="release-notes-section">
        <div class="release-notes-title">Release Notes</div>
        <div class="release-notes-body markdown-body" v-html="renderMarkdown(latest.body)" />
      </div>

      <!-- Previous releases link -->
      <div v-if="previous.length" class="previous-releases">
        <details>
          <summary>
            <span>Previous releases ({{ previous.length }})</span>
          </summary>
          <div class="prev-list">
            <div v-for="rel in previous" :key="rel.id" class="prev-item">
              <a :href="rel.html_url" target="_blank" class="prev-tag">{{ rel.tag_name }}</a>
              <span class="prev-name">{{ rel.name || rel.tag_name }}</span>
              <span class="prev-date">{{ formatDate(rel.published_at) }}</span>
            </div>
          </div>
          <a :href="`https://github.com/${REPO}/releases`" target="_blank" class="fallback-link" style="margin-top:1rem;display:inline-block">
            → View all releases on GitHub
          </a>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.downloads-widget {
  margin-top: 1rem;
}

/* States */
.state-box {
  text-align: center;
  padding: 2rem;
  color: var(--vp-c-text-2);
}
.error-box {
  border: 1px solid var(--vp-c-danger-1);
  border-radius: 8px;
  background: var(--vp-c-danger-soft);
}
.dim { color: var(--vp-c-text-3); font-size: 0.9em; }
.fallback-link {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}
.fallback-link:hover { text-decoration: underline; }

/* Spinner */
.spinner {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid var(--vp-c-divider);
  border-top-color: var(--vp-c-brand-1);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Header */
.release-header {
  margin-bottom: 1.25rem;
}
.release-title-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}
.release-title {
  margin: 0;
  font-size: 1.3rem;
}
.release-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.875em;
  color: var(--vp-c-text-3);
}
.release-tag {
  font-size: 0.85em;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--vp-c-text-2);
}
.release-date { color: var(--vp-c-text-3); }
.release-gh-link {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  font-weight: 500;
}
.release-gh-link:hover { text-decoration: underline; }

/* Badges */
.badge {
  font-size: 0.72em;
  padding: 2px 9px;
  border-radius: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.badge.stable {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.badge.pre {
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-warning-1);
}

/* Asset cards */
.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.asset-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.18s, box-shadow 0.18s, transform 0.12s;
}
.asset-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 3px 12px rgba(0,0,0,0.12);
  transform: translateY(-1px);
}
.asset-icon { font-size: 1.9rem; flex-shrink: 0; }
.asset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.asset-platform { font-weight: 600; font-size: 0.95em; }
.asset-name {
  font-size: 0.78em;
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-size { font-size: 0.78em; color: var(--vp-c-text-3); }
.download-arrow {
  margin-left: auto;
  font-size: 1.3rem;
  color: var(--vp-c-brand-1);
  font-weight: bold;
  flex-shrink: 0;
}

/* Release notes */
.release-notes-section {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 1.5rem;
}
.release-notes-title {
  padding: 0.6rem 1rem;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-weight: 600;
  font-size: 0.9em;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.release-notes-body {
  padding: 1rem 1.25rem;
  font-size: 0.93em;
  color: var(--vp-c-text-1);
}

/* Markdown body styles (scoped via :deep) */
.release-notes-body :deep(h1),
.release-notes-body :deep(h2),
.release-notes-body :deep(h3) {
  margin: 1em 0 0.4em;
  font-weight: 600;
  color: var(--vp-c-text-1);
  border: none;
  padding: 0;
}
.release-notes-body :deep(h2) { font-size: 1.05em; }
.release-notes-body :deep(h3) { font-size: 0.97em; color: var(--vp-c-text-2); }
.release-notes-body :deep(ul),
.release-notes-body :deep(ol) {
  padding-left: 1.4em;
  margin: 0.4em 0;
}
.release-notes-body :deep(li) { margin: 0.25em 0; line-height: 1.6; }
.release-notes-body :deep(strong) { color: var(--vp-c-text-1); font-weight: 600; }
.release-notes-body :deep(code) {
  font-size: 0.88em;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: var(--vp-font-family-mono);
}
.release-notes-body :deep(pre) {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.75em 1em;
  overflow-x: auto;
  margin: 0.75em 0;
}
.release-notes-body :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}
.release-notes-body :deep(a) { color: var(--vp-c-brand-1); }
.release-notes-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--vp-c-divider);
  margin: 1em 0;
}
.release-notes-body :deep(p) { margin: 0.4em 0; line-height: 1.7; }

/* Previous releases */
.previous-releases {
  margin-top: 0.5rem;
}
.previous-releases details {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}
.previous-releases summary {
  padding: 0.65rem 1rem;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.9em;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  user-select: none;
}
.previous-releases summary::-webkit-details-marker { display: none; }
.previous-releases summary::before {
  content: '›';
  font-size: 1.1em;
  transition: transform 0.15s;
  display: inline-block;
}
.previous-releases details[open] summary::before { transform: rotate(90deg); }
.previous-releases summary:hover { color: var(--vp-c-text-1); }

.prev-list {
  padding: 0.5rem 1rem 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.prev-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 0.875em;
}
.prev-item:last-child { border-bottom: none; }
.prev-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 0.85em;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 1px 7px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  flex-shrink: 0;
  font-weight: 600;
}
.prev-tag:hover { text-decoration: underline; }
.prev-name {
  flex: 1;
  color: var(--vp-c-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prev-date {
  color: var(--vp-c-text-3);
  font-size: 0.85em;
  flex-shrink: 0;
}
</style>


<template>
  <div class="downloads-widget">
    <div v-if="loading" class="loading">Loading releases...</div>
    <div v-else-if="error" class="error-box">
      <p>Could not load releases from GitHub.</p>
      <p class="dim">{{ error }}</p>
      <a :href="`https://github.com/${REPO}/releases`" target="_blank" class="fallback-link">
        → View all releases on GitHub
      </a>
    </div>
    <div v-else-if="!releases.length" class="empty">
      <p>No releases available yet.</p>
      <p class="dim">Releases will appear here once the first version is published.</p>
      <a :href="`https://github.com/${REPO}/releases`" target="_blank" class="fallback-link">
        → Check GitHub Releases
      </a>
    </div>
    <div v-else>
      <div v-for="release in releases" :key="release.id" class="release-card">
        <div class="release-header">
          <h3>{{ release.name || release.tag_name }}</h3>
          <span class="release-tag">{{ release.tag_name }}</span>
          <span class="release-date">{{ new Date(release.published_at).toLocaleDateString() }}</span>
          <span v-if="release.prerelease" class="badge pre">Pre-release</span>
          <span v-else class="badge stable">Latest</span>
        </div>
        <div class="assets-grid">
          <a
            v-for="asset in release.assets.filter(a => /\.(exe|dmg|AppImage|deb)$/.test(a.name))"
            :key="asset.id"
            :href="asset.browser_download_url"
            class="asset-card"
            target="_blank"
          >
            <span class="asset-icon">{{ fileIcon(asset.name) }}</span>
            <span class="asset-info">
              <span class="asset-platform">{{ platformLabel(asset.name) }}</span>
              <span class="asset-name">{{ asset.name }}</span>
              <span class="asset-size">{{ fileSize(asset.size) }}</span>
            </span>
            <span class="download-arrow">↓</span>
          </a>
        </div>
        <details v-if="release.body" class="release-notes">
          <summary>Release notes</summary>
          <div v-html="release.body.replace(/\n/g, '<br/>')"></div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.downloads-widget {
  margin-top: 1rem;
}

.loading, .empty {
  text-align: center;
  padding: 2rem;
  color: var(--vp-c-text-2);
}

.error-box {
  text-align: center;
  padding: 2rem;
  border: 1px solid var(--vp-c-danger-1);
  border-radius: 8px;
  background: var(--vp-c-danger-soft);
}

.dim { color: var(--vp-c-text-3); font-size: 0.9em; }

.fallback-link {
  display: inline-block;
  margin-top: 1rem;
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.release-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  background: var(--vp-c-bg-soft);
}

.release-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.release-header h3 {
  margin: 0;
  font-size: 1.15rem;
}

.release-tag {
  font-family: monospace;
  font-size: 0.85em;
  color: var(--vp-c-text-2);
}

.release-date {
  font-size: 0.85em;
  color: var(--vp-c-text-3);
}

.badge {
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.badge.stable {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.badge.pre {
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-warning-1);
}

.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
}

.asset-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.asset-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.asset-icon {
  font-size: 1.75rem;
  flex-shrink: 0;
}

.asset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.asset-platform {
  font-weight: 600;
  font-size: 0.95em;
}

.asset-name {
  font-size: 0.8em;
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-size {
  font-size: 0.8em;
  color: var(--vp-c-text-3);
}

.download-arrow {
  margin-left: auto;
  font-size: 1.25rem;
  color: var(--vp-c-brand-1);
  font-weight: bold;
  flex-shrink: 0;
}

.release-notes {
  margin-top: 1rem;
  font-size: 0.9em;
  color: var(--vp-c-text-2);
}

.release-notes summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.release-notes div {
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: var(--vp-c-bg);
  border-radius: 6px;
  line-height: 1.6;
}
</style>

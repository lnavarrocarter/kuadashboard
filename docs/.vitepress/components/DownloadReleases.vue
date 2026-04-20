<script setup>
import { ref, onMounted } from 'vue'

const REPO = 'lnavarrocarter/kuadashboard'
const releases = ref([])
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`)
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`)
    const data = await res.json()
    releases.value = data.filter(r => !r.draft)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

function fileIcon(name) {
  if (name.endsWith('.exe')) return '🪟'
  if (name.endsWith('.dmg')) return '🍎'
  if (name.endsWith('.AppImage') || name.endsWith('.deb')) return '🐧'
  return '📦'
}

function fileSize(bytes) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

function platformLabel(name) {
  if (name.endsWith('.exe')) return 'Windows'
  if (name.endsWith('.dmg')) return 'macOS'
  if (name.endsWith('.AppImage')) return 'Linux (AppImage)'
  if (name.endsWith('.deb')) return 'Linux (deb)'
  return 'Other'
}
</script>

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

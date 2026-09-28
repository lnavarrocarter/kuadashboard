import { reactive, watch } from 'vue'

const STORAGE_KEY = 'kua:settings'
const SETTINGS_VERSION = 2

export const SETTINGS_DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  theme:        'dark',    // 'dark' | 'light'
  lang:         'en',      // 'en' | 'es'
  fontSize:     'normal',  // 'small' | 'normal' | 'large'
  compactMode:  false,     // reduce row padding
  showClock:    true,      // clock in header
  autoRefresh:  5,         // 0 = off, seconds interval
  accentColor:  'blue',    // 'blue' | 'teal' | 'purple' | 'orange'
  // Cache & refresh (Options). Billed AWS reads are reused so auto-refresh does not repeat them.
  awsOverviewCacheMin:   5,    // resource counts (free)
  awsInsightsCacheMin:   15,   // Overview KPIs (CloudWatch GetMetricData, billed)
  awsActivityCacheMin:   15,   // Lambda / Step Functions 24h activity (GetMetricData, billed)
  awsCostCacheHours:     12,   // Cost Explorer (USD 0.01 per request)
  cwDashboardRefreshSec: 60,   // dashboard auto-refresh interval (metrics and alarms only)
  logsAutoRunMb:         1024, // Logs Insights runs on its own up to this estimate; 0 = always ask
  kubeListCacheSec:      15,   // backend list cache: fresh window (stale revalidates in background)
  kubeOverviewRefreshSec: 30,  // Kubernetes Overview + Prometheus trends: min seconds between auto-refreshes
  kubePrometheusDiscoveryMin: 5, // backend reuse of the Prometheus service discovery
  gcpListRefreshSec:     30,   // GCP tables: min seconds between auto-refreshes (0 = every tick)
  vercelListRefreshSec:  30,   // Vercel tables: min seconds between auto-refreshes (0 = every tick)
}
const DEFAULTS = SETTINGS_DEFAULTS

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const loaded = { ...DEFAULTS, ...saved }
    if ((saved.settingsVersion || 0) < SETTINGS_VERSION) {
      loaded.settingsVersion = SETTINGS_VERSION
      loaded.autoRefresh = DEFAULTS.autoRefresh
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded))
    }
    return loaded
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = reactive(load())

const FONT_SIZES = { small: '12px', normal: '13px', large: '15px' }

const ACCENT_COLORS = {
  blue:   { accent: '#0e9de8', sel: '#094771' },
  teal:   { accent: '#4ec9b0', sel: '#0a3d35' },
  purple: { accent: '#a371f7', sel: '#3b1f6e' },
  orange: { accent: '#ff9800', sel: '#6b3d00' },
}

export function applySettings() {
  const root = document.documentElement

  // Theme
  root.setAttribute('data-theme', settings.theme)

  // Font size
  root.style.setProperty('--font-size-base', FONT_SIZES[settings.fontSize] || '13px')
  document.body.style.fontSize = FONT_SIZES[settings.fontSize] || '13px'

  // Compact mode
  root.classList.toggle('compact', settings.compactMode)

  // Accent color
  const colors = ACCENT_COLORS[settings.accentColor] || ACCENT_COLORS.blue
  root.style.setProperty('--accent', colors.accent)
  root.style.setProperty('--bg-sel', colors.sel)
}

// Persist on every change
watch(settings, () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings }))
  applySettings()
}, { deep: true })

import { reactive, watch } from 'vue'

const STORAGE_KEY = 'kua:settings'

const DEFAULTS = {
  theme:        'dark',    // 'dark' | 'light'
  lang:         'es',      // 'es' | 'en'
  fontSize:     'normal',  // 'small' | 'normal' | 'large'
  compactMode:  false,     // reduce row padding
  showClock:    true,      // clock in header
  autoRefresh:  0,         // 0 = off, seconds interval
  accentColor:  'blue',    // 'blue' | 'teal' | 'purple' | 'orange'
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULTS, ...saved }
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

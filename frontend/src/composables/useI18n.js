/**
 * useI18n — lightweight reactive i18n composable
 * Uses settings.lang ('es' | 'en') from useSettings.js
 *
 * Usage:
 *   import { useI18n } from '../composables/useI18n'
 *   const { t } = useI18n()
 *   // template: {{ t('action.save') }}
 *   // with interpolation: t('msg.deleteContext', { name: 'my-ctx' })
 *
 * Reactivity: since t() reads settings.lang (a reactive property),
 * Vue's template compiler tracks it automatically — templates re-render
 * when settings.lang changes.
 */
import { settings } from './useSettings'
import es from '../locales/es'
import en from '../locales/en'

const LOCALES = { es, en }

/**
 * Interpolate a string with named params.
 * e.g. interpolate('Hello {name}', { name: 'world' }) → 'Hello world'
 */
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str
  return str.replace(/\{(\w+)\}/g, (_, key) => (params[key] ?? `{${key}}`))
}

export function useI18n() {
  /**
   * Translate a key. Reads settings.lang directly so Vue tracks it as a
   * reactive dependency when called from a template or computed.
   * @param {string} key   - dot-notation key, e.g. 'action.save'
   * @param {object} [params] - interpolation params, e.g. { name: 'foo' }
   * @returns {string}
   */
  function t(key, params) {
    const locale = LOCALES[settings.lang] || LOCALES.es
    const str = locale[key] ?? key
    return interpolate(str, params)
  }

  return { t }
}

/**
 * Standalone t() for use outside setup() (e.g. in computed config arrays).
 * Returns the current translation without reactivity — call inside computed() for reactivity.
 */
export function getT() {
  return (key, params) => {
    const locale = LOCALES[settings.lang] || LOCALES.es
    const str = locale[key] ?? key
    return interpolate(str, params)
  }
}

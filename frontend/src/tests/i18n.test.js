import { describe, it, expect, afterEach } from 'vitest'
import en from '../locales/en'
import es from '../locales/es'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'

describe('i18n', () => {
  afterEach(() => { settings.lang = 'en' })

  it('keeps English and Spanish with the same keys', () => {
    const enKeys = Object.keys(en)
    const esKeys = new Set(Object.keys(es))
    expect(enKeys.filter(key => !esKeys.has(key)), 'missing in es').toEqual([])
    expect([...esKeys].filter(key => !(key in en)), 'missing in en').toEqual([])
  })

  it('has no empty translations', () => {
    expect(Object.entries(en).filter(([, v]) => !String(v).trim()).map(([k]) => k)).toEqual([])
    expect(Object.entries(es).filter(([, v]) => !String(v).trim()).map(([k]) => k)).toEqual([])
  })

  it('translates to the active language', () => {
    const { t } = useI18n()
    settings.lang = 'es'
    expect(t('detail.tabMetrics')).toBe('Métricas')
    settings.lang = 'en'
    expect(t('detail.tabMetrics')).toBe('Metrics')
  })

  it('falls back to English, then to the key', () => {
    const { t } = useI18n()
    settings.lang = 'fr'
    expect(t('detail.tabEvents')).toBe('Events')
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('interpolates parameters', () => {
    const { t } = useI18n()
    expect(t('table.selected', { n: 3 })).toBe('3 selected')
  })
})

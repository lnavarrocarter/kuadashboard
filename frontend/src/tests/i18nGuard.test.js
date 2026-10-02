import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import en from '../locales/en'
import es from '../locales/es'

// Components already moved to i18n keys. Add a component here once its
// hard-coded text is migrated, so new hard-coded Spanish cannot slip back in.
const MIGRATED = [
  'components/advisor/AdvisorPanel.vue',
  'components/cloud/AwsView.vue',
  'components/cloud/Ec2Detail.vue',
  'components/cloud/LambdaDetail.vue',
  'components/cloud/EksDetail.vue',
  'components/cloud/VpcDetail.vue',
  'components/cloud/GcpCloudRunInfo.vue',
  'components/cloud/GcpVmInfo.vue',
  'components/cloud/GcpSqlInfo.vue',
  'components/cloud/GcpCreateModal.vue',
  'components/cloud/Ec2Rdp.vue',
  'components/cloud/Ec2RdpInfo.vue',
  'components/cloud/Ec2Shell.vue',
  'components/TerminalPanel.vue',
]

// Characters that only appear in Spanish text.
const SPANISH = /[áéíóúñ¿¡]/i

function strip(source) {
  return source
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '')
}

describe('i18n guard', () => {
  it.each(MIGRATED)('%s has no hard-coded Spanish text', file => {
    const source = strip(readFileSync(resolve(__dirname, '..', file), 'utf8'))
    const offending = source.split('\n').filter(line => SPANISH.test(line))
    expect(offending).toEqual([])
  })

  it.each(MIGRATED)('%s only uses keys that exist', file => {
    const source = readFileSync(resolve(__dirname, '..', file), 'utf8')
    const used = [...source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map(match => match[1])
    expect(used.filter(key => !(key in en) || !(key in es))).toEqual([])
  })

  it('every key exists in English and Spanish', () => {
    expect(Object.keys(es).filter(key => !(key in en))).toEqual([])
    expect(Object.keys(en).filter(key => !(key in es))).toEqual([])
  })
})

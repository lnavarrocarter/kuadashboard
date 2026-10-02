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
  'components/cloud/GcpView.vue',
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
  'components/StepFnDetail.vue',
  'components/architecture/ArchitectureCanvas.vue',
  'components/architecture/ArchitectureView.vue',
  'components/architecture/ArchitectureRoutes.vue',
  'components/architecture/ArchitectureDiscoveryPanel.vue',
  'components/architecture/ArchitectureKubernetesDiscoveryPanel.vue',
  'components/architecture/ArchitectureResources.vue',
  'components/architecture/ArchitectureManualResourcePanel.vue',
  'components/HelmView.vue',
  'components/modals/ProfileModal.vue',
  'components/EventBridgeDetail.vue',
  'components/EventBridgeLogs.vue',
  'components/cloud/apm/ApmObservabilityView.vue',
  'components/cloud/apm/ApmApplicationLogs.vue',
  'components/kuapps/KUAppsView.vue',
  'components/cloud/S3Browser.vue',
  'components/cloud/GcsBrowser.vue',
  'components/cloud/EksObservabilityDashboard.vue',
  'components/FileViewerModal.vue',
  'components/StepFnExecution.vue',
  'components/StepFnDiagram.vue',
  'components/cloud/GcpPollingSettings.vue',
  'components/cloud/GcpStateTimeline.vue',
  'components/cloud/GcpLabelsEditor.vue',
  'components/cloud/GcpConfirmModal.vue',
  'components/cloud/gcpActions.js',
  'components/modals/YamlModal.vue',
  'components/SplitPane.vue',
  'components/UpdateNotice.vue',
  'components/AwsSessionAlert.vue',
  'components/modals/DonationModal.vue',
  'components/modals/PortForwardModal.vue',
  'components/cloud/EnvManagerView.vue',
  'lib/stepFnExecution.js',
]

// Characters that only appear in Spanish text.
const SPANISH = /[áéíóúñ¿¡]/i
// Common Spanish words, to catch text written without accents. Only checked
// inside text nodes and string literals, so identifiers never match.
const SPANISH_WORDS = /\b(para|del|los|las|una|que|est[aá]|hay|nunca|aqu[ií]|cargando|guardar|guardando|eliminar|seleccionar|selecciona|buscar|cerrar|volver|agregar|actualizar|historial|desconocido|ning[uú]n|ninguna|todav[ií]a|tambi[eé]n|despu[eé]s|disponible|ejecuci[oó]n|definici[oó]n|pudo|pudieron)\b/i

function texts(line) {
  return [...line.matchAll(/>([^<>{}]+)<|'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)].map(match => match[1] ?? match[2] ?? match[3] ?? match[4])
}

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
    const offending = source.split('\n')
      .filter(line => SPANISH.test(line) || texts(line).some(text => SPANISH_WORDS.test(text)))
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

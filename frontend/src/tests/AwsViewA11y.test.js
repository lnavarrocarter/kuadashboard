import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Static guards for the AWS views: an executable control must always have a name.
const FILES = [
  'components/cloud/AwsView.vue',
  'components/cloud/Ec2Detail.vue',
  'components/cloud/Ec2Rdp.vue',
  'components/cloud/EksDetail.vue',
  'components/cloud/LambdaDetail.vue',
]
const read = file => readFileSync(resolve(__dirname, '..', file), 'utf8')

describe('AWS views accessibility guards', () => {
  it.each(FILES)('%s has no empty buttons', file => {
    expect(read(file).match(/<button\b(?![^>]*aria-label)[^>]*>\s*<\/button>/g) || []).toEqual([])
  })

  it.each(FILES)('%s names every icon-only close button', file => {
    expect(read(file).match(/<button\b(?![^>]*aria-label)[^>]*>\s*[✕×]\s*<\/button>/g) || []).toEqual([])
  })

  it('the Lambda invoke dialog has a title and a labelled run button', () => {
    const view = read('components/cloud/AwsView.vue')
    expect(view).toContain("t('awsv.invokeTitle', { name: invokeModal.name })")
    expect(view).toMatch(/@click="submitInvoke"[^>]*>\s*\{\{[^}]*awsv\.invokeAction/)
  })

  it('action names say whether they read, configure or check (A14)', () => {
    const view = read('components/cloud/AwsView.vue')
    expect(view).not.toMatch(/>\s*CW Logs\s*</)
    expect(view).not.toMatch(/ℹ Info|>Info</)
    expect(view).not.toMatch(/'Test'/)
  })

  it('the AWS search box has an accessible name and a placeholder', () => {
    const input = read('components/cloud/AwsView.vue').match(/<input[^>]*aws-search[^>]*\/>/)[0]
    expect(input).toContain(":aria-label=\"t('awsv.searchResourcesLabel')\"")
    expect(input).toContain(":placeholder=\"t('awsv.searchResourcesPlaceholder')\"")
  })
})

import { describe, expect, it } from 'vitest'
import { kubeUrlHref, readKubeUrl } from '../lib/kubeUrl'

describe('Kubernetes view in the URL', () => {
  it('writes context, namespace, resource and selection, dropping stale KUApps params', () => {
    const href = kubeUrlHref('http://localhost:7192/?app=orders&tab=signals', {
      context: 'arn:aws:eks:us-east-1:1:cluster/dev', namespace: 'backend360', resource: 'pods', name: 'sot360-abc',
    })
    const params = new URL(href).searchParams
    expect(params.get('app')).toBeNull()
    expect(params.get('tab')).toBeNull()
    expect(readKubeUrl(new URL(href).search)).toEqual({
      context: 'arn:aws:eks:us-east-1:1:cluster/dev', namespace: 'backend360', resource: 'pods', name: 'sot360-abc',
    })
  })

  it('removes only its own params when leaving the Kubernetes view', () => {
    const href = kubeUrlHref('http://localhost/?view=kubernetes&context=dev&ns=a&resource=pods&name=x&other=1', null)
    expect(new URL(href).search).toBe('?other=1')
  })

  it('ignores URLs of other views', () => {
    expect(readKubeUrl('?app=orders')).toBeNull()
    expect(readKubeUrl('?view=kubernetes')).toEqual({ context: '', namespace: '', resource: '', name: '' })
  })
})

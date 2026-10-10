import { describe, expect, it } from 'vitest'
import { kubeUrlChange, kubeUrlHref, readKubeUrl } from '../lib/kubeUrl'

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

  it('adds a history entry for moves inside the view and replaces otherwise', () => {
    const base = 'http://localhost/?view=kubernetes&context=dev&ns=shop&resource=pods'
    expect(kubeUrlChange(base, base)).toBeNull()
    expect(kubeUrlChange(base, `${base}&name=web-a`)).toBe('push')
    expect(kubeUrlChange(base, base.replace('pods', 'services'))).toBe('push')
    expect(kubeUrlChange(base, base.replace('resource=pods', 'resource=logs'))).toBe('push')
    expect(kubeUrlChange('http://localhost/?app=orders', base)).toBe('replace')
    expect(kubeUrlChange(base, 'http://localhost/')).toBe('replace')
    expect(kubeUrlChange(base, `${base}&utm=x`)).toBe('replace')
  })
})

describe('Kubernetes and the other views share ?view= (useViewUrl)', () => {
  const BASE = 'http://localhost:7192/'
  it('leaving Kubernetes keeps the view another provider set', () => {
    expect(kubeUrlHref(`${BASE}?view=aws&service=lambda&context=prod&ns=api`, null)).toBe(`${BASE}?view=aws&service=lambda`)
    expect(kubeUrlHref(`${BASE}?view=kubernetes&context=prod`, null)).toBe(BASE)
  })

  it('the first cluster state after the provider switch replaces that entry', () => {
    expect(kubeUrlChange(`${BASE}?view=kubernetes`, `${BASE}?view=kubernetes&context=prod&ns=api&resource=pods`)).toBe('replace')
    expect(kubeUrlChange(`${BASE}?view=kubernetes&context=prod&resource=pods`, `${BASE}?view=kubernetes&context=prod&resource=services`)).toBe('push')
  })
})

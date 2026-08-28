import { describe, expect, it } from 'vitest'
import { apmResourceIcon, apmResourceLabel, apmResourceLocation } from '../components/cloud/apm/resourcePresentation'

describe('resourcePresentation', () => {
  it('distinguishes Kubernetes kinds instead of always labeling them "Kubernetes"', () => {
    expect(apmResourceLabel({ type: 'kubernetes', kind: 'Deployment' })).toBe('Kubernetes Deployment')
    expect(apmResourceLabel({ type: 'kubernetes', kind: 'Pod' })).toBe('Kubernetes Pod')
    expect(apmResourceLabel({ type: 'kubernetes', kind: 'Service' })).toBe('Kubernetes Service')
    expect(apmResourceLabel({ type: 'kubernetes' })).toBe('Kubernetes')
  })

  it('picks a distinct icon per Kubernetes kind and falls back to a generic one otherwise', () => {
    expect(apmResourceIcon({ type: 'kubernetes', kind: 'Deployment' })).toBe('boxes')
    expect(apmResourceIcon({ type: 'kubernetes', kind: 'Pod' })).toBe('container')
    expect(apmResourceIcon({ type: 'kubernetes', kind: 'Service' })).toBe('network')
    expect(apmResourceIcon({ type: 'kubernetes' })).toBe('container')
    expect(apmResourceIcon({ type: 'lambda' })).toBe('function-square')
    expect(apmResourceIcon('lambda')).toBe('function-square')
  })

  it('keeps non-Kubernetes labels and locations unchanged', () => {
    expect(apmResourceLabel({ type: 'lambda' })).toBe('AWS Lambda')
    expect(apmResourceLocation({ type: 'kubernetes', kubeContext: 'eks-dev', namespace: 'orders' })).toBe('eks-dev / orders')
  })
})

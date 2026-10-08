import { describe, expect, it } from 'vitest'
import { architectureGraphRecommendations } from '../lib/architectureGraphAdvisor'

describe('architecture graph advisor', () => {
  it('suggests a reviewable Ingress route only when there is one same-scope Service candidate', () => {
    const graph = { document: { nodes: [
      { id: 'ingress', provider: 'kubernetes', resourceType: 'ingress', kubeContext: 'eks-a', namespace: 'orders', details: { backendServiceNames: ['api'] } },
      { id: 'service', name: 'api', provider: 'kubernetes', resourceType: 'service', kubeContext: 'eks-a', namespace: 'orders' },
      { id: 'other', provider: 'kubernetes', resourceType: 'service', kubeContext: 'eks-b', namespace: 'orders' },
    ], edges: [] } }

    expect(architectureGraphRecommendations(graph).find(item => item.type === 'relationship')).toMatchObject({
      source: { id: 'ingress' }, target: { id: 'service' },
      operation: { type: 'edge.upsert', value: { status: 'suggested', relationType: 'routes_to', confidence: 0.95 } },
    })
  })

  it('does not guess between multiple same-scope Services or repeat existing edges', () => {
    const ingress = { id: 'ingress', provider: 'kubernetes', resourceType: 'ingress', kubeContext: 'eks-a', namespace: 'orders', details: { backendServiceNames: ['service-a', 'service-b'] } }
    const first = { id: 'service-a', provider: 'kubernetes', resourceType: 'service', kubeContext: 'eks-a', namespace: 'orders' }
    const second = { ...first, id: 'service-b' }
    expect(architectureGraphRecommendations({ document: { nodes: [ingress, first, second], edges: [] } }).some(item => item.type === 'relationship')).toBe(false)
    expect(architectureGraphRecommendations({ document: { nodes: [ingress, first], edges: [{ sourceNodeId: ingress.id, targetNodeId: first.id, relationType: 'routes_to' }] } }).some(item => item.type === 'relationship')).toBe(false)
  })

  it('connects an AWS load balancer to a Kubernetes Service only when its DNS name matches exactly', () => {
    const loadBalancer = { id: 'alb', provider: 'aws', resourceType: 'loadbalancer', arn: 'arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/api/id', accountId: '123', region: 'us-east-1', details: { dnsName: 'api.elb.amazonaws.com' } }
    const service = { id: 'service', provider: 'kubernetes', resourceType: 'service', details: { loadBalancerHostnames: ['api.elb.amazonaws.com'] } }
    const nearMatch = { id: 'other', provider: 'kubernetes', resourceType: 'service', details: { loadBalancerHostnames: ['api2.elb.amazonaws.com'] } }
    const suggestions = architectureGraphRecommendations({ document: { nodes: [loadBalancer, service, nearMatch], edges: [] } })

    expect(suggestions.filter(item => item.type === 'relationship')).toHaveLength(1)
    expect(suggestions.find(item => item.type === 'relationship')).toMatchObject({
      source: { id: 'alb' }, target: { id: 'service' },
      operation: { type: 'edge.upsert', value: { confidence: 0.95, status: 'suggested' } },
    })
  })

  it('proposes an ALB target group relation only when the target group declares its load balancer ARN', () => {
    const arn = 'arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/api/id'
    const loadBalancer = { id: 'alb', provider: 'aws', resourceType: 'loadbalancer', arn, accountId: '123', region: 'us-east-1' }
    const targetGroup = { id: 'tg', provider: 'aws', resourceType: 'targetgroup', details: { loadBalancerArns: [arn] } }
    const unrelatedTargetGroup = { id: 'unrelated', provider: 'aws', resourceType: 'targetgroup' }
    const recommendations = architectureGraphRecommendations({ document: { nodes: [loadBalancer, targetGroup, unrelatedTargetGroup], edges: [] } })

    expect(recommendations.find(item => item.type === 'relationship')).toMatchObject({
      source: { id: 'alb' }, target: { id: 'tg' }, operation: { value: { confidence: 0.95 } },
    })
  })

  it('recommends merging only exact ARN duplicates and preserves AWS EC2 as the canonical node', () => {
    const arn = 'arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0'
    const recommendations = architectureGraphRecommendations({ document: { nodes: [
      { id: 'kube-node', provider: 'kubernetes', resourceType: 'node', arn },
      { id: 'ec2', provider: 'aws', resourceType: 'ec2', arn },
    ], edges: [] } })

    expect(recommendations.find(item => item.type === 'deduplicate')).toMatchObject({
      target: { id: 'ec2' }, sources: [{ id: 'kube-node' }],
      operation: { type: 'node.merge', value: { targetId: 'ec2', sourceIds: ['kube-node'] } },
    })
  })

  it('offers explicit stale-node removal and a visual domain aggregation', () => {
    const recommendations = architectureGraphRecommendations({ document: {
      nodes: [{ id: 'stale', syncState: 'stale' }, { id: 'a' }, { id: 'b' }], edges: [], view: {},
    } })

    expect(recommendations.find(item => item.type === 'remove')?.operation).toEqual({ type: 'node.remove', subjectId: 'stale' })
    expect(recommendations.find(item => item.type === 'aggregate')?.operation).toEqual({ type: 'view.set', value: { layoutMode: 'system-domains' } })
  })
})
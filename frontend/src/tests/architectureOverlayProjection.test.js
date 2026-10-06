import { describe, expect, it } from 'vitest'
import { awsSecurityByNode, gcpSecurityByNode, kubernetesRolloutsByNode, kubernetesSecurityByNode, mergeNodeFindings } from '../lib/architectureOverlayProjection'

describe('architecture operational overlay projection', () => {
  it('links Kubernetes findings only by context, kind, namespace, and exact name', () => {
    const nodes = [
      { id: 'deployment', provider: 'kubernetes', kubeContext: 'orders', namespace: 'shop', kind: 'Deployment', name: 'api' },
      { id: 'other-context', provider: 'kubernetes', kubeContext: 'staging', namespace: 'shop', kind: 'Deployment', name: 'api' },
      { id: 'other-namespace', provider: 'kubernetes', kubeContext: 'orders', namespace: 'admin', kind: 'Deployment', name: 'api' },
    ]
    const reports = [{ context: 'orders', findings: [{
      id: 'k8s.privileged', category: 'security', severity: 'high',
      resources: [{ kind: 'Deployment', namespace: 'shop', name: 'api' }],
    }] }]

    expect(kubernetesSecurityByNode(reports, nodes)).toMatchObject({ deployment: { count: 1, high: 1, severity: 'high' } })
    expect(Object.keys(kubernetesSecurityByNode(reports, nodes))).toEqual(['deployment'])
  })

  it('links AWS findings by resource type, exact identity, and report region', () => {
    const nodes = [
      { id: 'lambda', provider: 'aws', region: 'us-east-1', resourceType: 'lambda', name: 'orders-api' },
      { id: 'wrong-region', provider: 'aws', region: 'us-west-2', resourceType: 'lambda', name: 'orders-api' },
      { id: 'wrong-type', provider: 'aws', region: 'us-east-1', resourceType: 'ec2', name: 'orders-api' },
    ]
    const report = { scope: { region: 'us-east-1' }, findings: [{
      id: 'aws.lambda_plain_secrets', category: 'security', severity: 'medium',
      resources: [{ kind: 'Lambda', name: 'orders-api', detail: 'TOKEN' }],
    }] }

    expect(Object.keys(awsSecurityByNode(report, nodes))).toEqual(['lambda'])
    expect(awsSecurityByNode({ ...report, locked: true }, nodes)).toEqual({})
  })

  it('links GCP findings only to exact project, resource type, and location', () => {
    const nodes = [
      { id: 'run', provider: 'gcp', projectId: 'prod', resourceType: 'gcp-cloud-run', name: 'orders', location: 'us-central1' },
      { id: 'wrong-project', provider: 'gcp', projectId: 'staging', resourceType: 'gcp-cloud-run', name: 'orders', location: 'us-central1' },
      { id: 'wrong-location', provider: 'gcp', projectId: 'prod', resourceType: 'gcp-cloud-run', name: 'orders', location: 'us-east1' },
      { id: 'wrong-type', provider: 'gcp', projectId: 'prod', resourceType: 'gcp-function', name: 'orders', location: 'us-central1' },
    ]
    const report = { scope: { projectId: 'prod' }, findings: [{
      id: 'gcp.cloudrun_public_ingress', category: 'security', severity: 'low',
      resources: [{ kind: 'Cloud Run', name: 'orders', namespace: 'us-central1' }],
    }] }

    expect(Object.keys(gcpSecurityByNode(report, nodes))).toEqual(['run'])
    expect(gcpSecurityByNode({ ...report, locked: true }, nodes)).toEqual({})
  })

  it('selects the latest rollout only for the matching Deployment UID and context', () => {
    const nodes = [
      { id: 'orders-api', provider: 'kubernetes', kubeContext: 'orders', namespace: 'shop', kind: 'Deployment', nativeId: 'uid-orders' },
      { id: 'staging-api', provider: 'kubernetes', kubeContext: 'staging', namespace: 'shop', kind: 'Deployment', nativeId: 'uid-staging' },
    ]
    const rollouts = [
      { context: 'orders', namespace: 'shop', deploymentUid: 'uid-orders', revision: 6, replicas: 2, readyReplicas: 2 },
      { context: 'orders', namespace: 'shop', deploymentUid: 'uid-orders', revision: 7, replicas: 2, readyReplicas: 1 },
      { context: 'staging', namespace: 'shop', deploymentUid: 'uid-orders', revision: 99, replicas: 1, readyReplicas: 1 },
    ]

    expect(kubernetesRolloutsByNode(rollouts, nodes)).toMatchObject({
      'orders-api': { revision: 7, status: 'degraded' },
    })
    expect(Object.keys(kubernetesRolloutsByNode(rollouts, nodes))).toEqual(['orders-api'])
  })

  it('combines findings from multiple providers without losing severity counts', () => {
    const merged = mergeNodeFindings(
      { api: { count: 1, high: 1, medium: 0, low: 0, severity: 'high', details: ['k8s.privileged'] } },
      { api: { count: 2, high: 0, medium: 1, low: 1, severity: 'medium', details: ['rule-a', 'rule-b'] } },
    )

    expect(merged.api).toMatchObject({ count: 3, high: 1, medium: 1, low: 1, severity: 'high' })
    expect(merged.api.detail).toContain('k8s.privileged')
  })
})
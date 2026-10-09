import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import { awsConsoleUrl, awsDestinationNotice, awsIdentity, awsRegion, awsViewTarget } from '../lib/awsResourceLinks'
import { kubernetesObject, resourceDestinations } from '../lib/resourceDestinations'
import ArchitectureCanvas from '../components/architecture/ArchitectureCanvas.vue'
import KUAppResourceInspector from '../components/kuapps/KUAppResourceInspector.vue'
import KUAppsView from '../components/kuapps/KUAppsView.vue'
import { settings } from '../composables/useSettings'

const node = (kind, identifier, extra = {}) => ({ provider: 'aws', kind, nativeId: `${kind}:${identifier}`, name: identifier, ...extra })

describe('AWS resource links (#239)', () => {
  it('opens the tab of the AWS view that lists the resource, searched by the name AWS shows', () => {
    expect(awsViewTarget(node('AWS::SQS::Queue', 'orders-dlq'))).toEqual({ tab: 'sqs', search: 'orders-dlq' })
    expect(awsViewTarget(node('AWS::ElasticLoadBalancingV2::LoadBalancer', 'arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/app/k8s-api/6c2c'))).toEqual({ tab: 'elb', search: 'k8s-api' })
    expect(awsViewTarget(node('AWS::ElasticLoadBalancingV2::TargetGroup', 'arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/k8s-tg/20ab'))).toEqual({ tab: 'elb', search: 'k8s-tg' })
    expect(awsViewTarget(node('AWS::EKS::Cluster', 'EKS130-360-Dev'))).toEqual({ tab: 'eks', search: 'EKS130-360-Dev' })
    expect(awsViewTarget({ provider: 'aws', resourceType: 'dynamodb', name: 'orders' })).toEqual({ tab: 'dynamodb', search: 'orders' })
    // A security group shares resourceType "ec2" with instances, but has no tab: the console instead.
    expect(awsViewTarget(node('AWS::EC2::SecurityGroup', 'sg-0720983be49e437e2', { resourceType: 'ec2' }))).toBe(null)
    expect(awsViewTarget({ provider: 'kubernetes', resourceType: 'service', name: 'api' })).toBe(null)
  })

  it('a registry resource carries its type in its identifier, and its region in the ARN or location', () => {
    expect(awsIdentity({ nativeIdentifier: 'AWS::EC2::SecurityGroup:sg-1' })).toEqual({ kind: 'AWS::EC2::SecurityGroup', identifier: 'sg-1' })
    expect(awsRegion({ arn: 'arn:aws:sqs:sa-east-1:1:jobs' })).toBe('sa-east-1')
    expect(awsRegion({ location: 'us-west-2' })).toBe('us-west-2')
  })

  it('opens the AWS console page, in the resource region, for what KUA has no tab for', () => {
    expect(awsConsoleUrl(node('AWS::EC2::SecurityGroup', 'sg-0720983be49e437e2', { region: 'us-east-1' })))
      .toBe('https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#SecurityGroup:groupId=sg-0720983be49e437e2')
    expect(awsConsoleUrl(node('AWS::EKS::AccessEntry', 'arn:aws:iam::1:role/node|EKS130-360-Dev', { location: 'us-east-1' })))
      .toBe('https://us-east-1.console.aws.amazon.com/eks/home?region=us-east-1#/clusters/EKS130-360-Dev?selectedTab=cluster-access-tab')
    expect(awsConsoleUrl(node('AWS::IAM::Role', 'cobranza-ia-lambda-role'))).toBe('https://console.aws.amazon.com/iam/home#/roles/details/cobranza-ia-lambda-role')
    expect(awsConsoleUrl(node('AWS::CDK::Metadata', 'x'))).toBe('')
  })
})

describe('navigating to an AWS resource (#239)', () => {
  const stubs = {
    VueFlow: { props: ['nodes'], emits: ['node-click'], template: '<div><button v-for="node in nodes" :key="node.id" :class="`pick-${node.id}`" @click="$emit(\'node-click\', { node })">{{ node.id }}</button></div>' },
    Background: true, Controls: true,
  }

  it('the canvas offers the AWS view for a queue and the AWS console for a security group', async () => {
    settings.lang = 'en'
    const graph = { revision: 1, document: { nodes: [
      { id: 'q', provider: 'aws', resourceType: 'sqs', kind: 'AWS::SQS::Queue', name: 'jobs', nativeId: 'AWS::SQS::Queue:jobs' },
      { id: 'sg', provider: 'aws', resourceType: 'ec2', kind: 'AWS::EC2::SecurityGroup', name: 'sg-1', nativeId: 'AWS::EC2::SecurityGroup:sg-0720983be49e437e2' },
    ], edges: [], layout: {} } }
    const wrapper = mount(ArchitectureCanvas, { props: { graph }, global: { stubs } })
    await wrapper.get('.pick-q').trigger('click')
    const labels = () => wrapper.findAll('.component-node-actions button').map(button => button.text())
    expect(labels()).toContain('Open in AWS view')
    await wrapper.findAll('.component-node-actions button').find(button => button.text() === 'Open in AWS view').trigger('click')
    expect(wrapper.emitted('node-action')[0][0]).toMatchObject({ action: 'aws-detail', node: { id: 'q' } })
    await wrapper.get('.pick-sg').trigger('click')
    expect(labels()).toContain('Open in the AWS console')
    expect(labels()).not.toContain('Open in AWS view')
  })

  it('the KUApps inspector offers the same destinations', () => {
    settings.lang = 'en'
    const queue = mount(KUAppResourceInspector, { props: { applicationId: 'a', resource: { id: 'r', provider: 'aws', resourceType: 'sqs', displayName: 'jobs', nativeIdentifier: 'arn:aws:sqs:us-east-1:111111111111:jobs', signals: { state: 'unsupported' } } }, global: { stubs: { KUAppResourceSignals: true } } })
    expect(queue.find('[data-test="inspector-aws-view"]').exists()).toBe(true)
    const group = mount(KUAppResourceInspector, { props: { applicationId: 'a', resource: { id: 's', provider: 'aws', resourceType: 'ec2', displayName: 'sg-1', nativeIdentifier: 'AWS::EC2::SecurityGroup:sg-1', location: 'us-east-1', signals: { state: 'unsupported' } } }, global: { stubs: { KUAppResourceSignals: true } } })
    expect(group.get('[data-test="inspector-aws-console"]').attributes('href')).toContain('#SecurityGroup:groupId=sg-1')
    expect(group.get('[data-test="inspector-aws-console"]').attributes('rel')).toContain('noopener')
  })

  it('KUApps sends the profile bound to the resource account with it', async () => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    const application = { id: 'app-1', name: 'Dev', provider: null, profileId: null }
    const resource = { id: 'r1', provider: 'aws', resourceType: 'sqs', displayName: 'jobs', scopeId: '222222222222', location: 'us-east-1', nativeIdentifier: 'arn:aws:sqs:us-east-1:222222222222:jobs', sources: ['apm_resource'], signals: { state: 'unsupported' } }
    global.fetch = vi.fn(url => {
      const text = String(url)
      const body = text.includes('/catalog') ? [application]
        : text.includes('/registry') ? { resources: [resource], relationships: [] }
          : text.includes('/api/kua-apps/applications/app-1') && !text.includes('/views') ? { id: 'app-1', scopes: [
            { key: 'a', provider: 'aws', scopeId: '111111111111', location: 'us-east-1' },
            { key: 'b', provider: 'aws', scopeId: '222222222222', location: 'us-east-1' },
          ], local: { bindings: [{ scopeKey: 'a', profileId: 'local:one', status: 'verified' }, { scopeKey: 'b', profileId: 'local:two', status: 'verified' }], legacy: null } } : []
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
    })
    const wrapper = mount(KUAppsView, { props: { activeView: 'architecture', applicationId: 'app-1' }, global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } } })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    await wrapper.get('.kuapps-resource-list .kuapps-resource-row').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="inspector-aws-view"]').trigger('click')
    expect(wrapper.emitted('open-aws-resource')[0][0]).toMatchObject({ id: 'r1', awsProfileId: 'local:two', awsRegion: 'us-east-1', awsAccountId: '222222222222', awsAmbiguous: false })
    wrapper.unmount()
  })
})

describe('Kubernetes resources and the Resources list (#239)', () => {
  const CONTEXT = 'arn:aws:eks:us-east-1:073746111526:cluster/EKS130-360-Dev'

  it('reads the Kubernetes object of a registry resource, even from its key, and offers detail, pods and logs', () => {
    const deployment = { provider: 'kubernetes', resourceType: 'deployment', displayName: 'authv1', nativeIdentifier: `${CONTEXT}/backend360/Deployment/authv1` }
    expect(kubernetesObject(deployment)).toEqual({ provider: 'kubernetes', kind: 'Deployment', name: 'authv1', namespace: 'backend360', kubeContext: CONTEXT })
    expect(resourceDestinations(deployment).map(item => item.key)).toEqual(['kubernetes-detail', 'kubernetes-pods', 'kubernetes-logs'])
    expect(resourceDestinations({ ...deployment, resourceType: 'service', nativeIdentifier: `${CONTEXT}/backend360/Service/authv1` }).map(item => item.key)).toEqual(['kubernetes-detail'])
    // A cluster Node has no Kubernetes view to open; an AWS resource has no Kubernetes one.
    expect(resourceDestinations({ provider: 'kubernetes', resourceType: 'node', displayName: 'ip-1', nativeIdentifier: `${CONTEXT}//Node/ip-1` })).toEqual([])
    expect(resourceDestinations({ provider: 'aws', resourceType: 'sqs', name: 'jobs' }).map(item => item.key)).toEqual(['aws-view'])
  })

  it('each row of Resources opens its resource where it lives; the inspector offers every destination', async () => {
    setActivePinia(createPinia())
    settings.lang = 'en'
    const application = { id: 'app-1', name: 'Dev', provider: 'aws', profileId: 'local:prod' }
    const resources = [
      { id: 'k1', provider: 'kubernetes', resourceType: 'deployment', displayName: 'authv1', kubeContext: CONTEXT, namespace: 'backend360', nativeIdentifier: `${CONTEXT}/backend360/Deployment/authv1`, sources: ['apm_resource'], signals: { state: 'current' } },
      { id: 'q1', provider: 'aws', resourceType: 'sqs', displayName: 'jobs', scopeId: '111111111111', location: 'us-east-1', nativeIdentifier: 'arn:aws:sqs:us-east-1:111111111111:jobs', sources: ['apm_resource'], signals: { state: 'unsupported' } },
      { id: 's1', provider: 'aws', resourceType: 'ec2', displayName: 'sg-1', scopeId: '111111111111', location: 'us-east-1', nativeIdentifier: 'AWS::EC2::SecurityGroup:sg-1', sources: ['architecture_node'], signals: { state: 'unsupported' } },
    ]
    global.fetch = vi.fn(url => {
      const text = String(url)
      const body = text.includes('/catalog') ? [application]
        : text.includes('/registry') ? { resources, relationships: [] }
          : text.includes('/api/kua-apps/applications/app-1') && !text.includes('/views') ? { id: 'app-1', scopes: [], local: { bindings: [], legacy: null } } : []
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
    })
    const wrapper = mount(KUAppsView, { props: { activeView: 'architecture', applicationId: 'app-1' }, global: { stubs: { ArchitectureView: true, ApmObservabilityView: true } } })
    await flushPromises()
    await wrapper.findAll('.kuapps-workspace-tab')[1].trigger('click')
    const opens = wrapper.findAll('[data-test="resource-open"]')
    expect(opens.map(open => open.attributes('title'))).toEqual(['Open in Kubernetes', 'Open in AWS view', 'Open in the AWS console'])
    await opens[0].trigger('click')
    expect(wrapper.emitted('open-kubernetes-detail')[0][0]).toEqual({ provider: 'kubernetes', kind: 'Deployment', name: 'authv1', namespace: 'backend360', kubeContext: CONTEXT })
    await opens[1].trigger('click')
    expect(wrapper.emitted('open-aws-resource')[0][0]).toMatchObject({ id: 'q1', awsProfileId: 'local:prod' })
    expect(opens[2].attributes('href')).toContain('#SecurityGroup:groupId=sg-1')
    // Opening a row's destination does not select the row.
    expect(wrapper.find('.kuapps-resource-row.active').exists()).toBe(false)

    await wrapper.findAll('.kuapps-resource-list .kuapps-resource-row')[0].trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="inspector-kubernetes-pods"]').trigger('click')
    expect(wrapper.emitted('open-kubernetes-pods')[0][0]).toMatchObject({ kind: 'Deployment', name: 'authv1' })
    expect(wrapper.find('[data-test="inspector-kubernetes-logs"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('where the AWS view opens (#239 N06)', () => {
  const target = { tab: 'sqs', search: 'jobs' }
  it('says account, region and profile; warns about another region or an ambiguous account', () => {
    expect(awsDestinationNotice({ resource: { awsAccountId: '2222', awsRegion: 'us-east-1' }, target, profileId: 'local:two', profileRegion: 'us-east-1' }))
      .toEqual({ key: 'app.awsDestination.opening', params: { name: 'jobs', where: '2222 · us-east-1', profile: 'local:two' }, tone: 'info' })
    expect(awsDestinationNotice({ resource: { awsRegion: 'sa-east-1' }, target, profileId: 'local:two', profileRegion: 'us-east-1' }))
      .toMatchObject({ key: 'app.awsDestination.otherRegion', tone: 'warning', params: { region: 'sa-east-1', profileRegion: 'us-east-1' } })
    expect(awsDestinationNotice({ resource: { awsAmbiguous: true }, target, profileId: 'local:dev' }))
      .toMatchObject({ key: 'app.awsDestination.ambiguous', tone: 'warning' })
  })
})

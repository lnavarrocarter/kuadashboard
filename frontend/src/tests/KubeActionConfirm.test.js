import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import KubeActionConfirmModal from '../components/modals/KubeActionConfirmModal.vue'
import ScaleModal from '../components/modals/ScaleModal.vue'
import { contextEnvironment, shortContextName } from '../lib/kubeContext'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

const BaseModalStub = {
  props: ['show'],
  template: '<section v-if="show"><header><slot name="title" /></header><main><slot /></main><footer><slot name="footer" /></footer></section>',
}

const EKS_DEV = 'arn:aws:eks:us-east-1:123456789012:cluster/EKS130-360-Dev'
const EKS_PROD = 'arn:aws:eks:us-east-1:123456789012:cluster/EKS130-360-Prod'

describe('kube context helpers', () => {
  it('shortens EKS and GKE context names', () => {
    expect(shortContextName(EKS_DEV)).toBe('EKS130-360-Dev')
    expect(shortContextName('gke_my-project_us-central1-a_payments')).toBe('payments')
    expect(shortContextName('minikube')).toBe('minikube')
  })

  it('guesses the environment from name tokens', () => {
    expect(contextEnvironment(EKS_DEV)).toBe('development')
    expect(contextEnvironment(EKS_PROD)).toBe('production')
    expect(contextEnvironment('eks-preprod')).toBe('staging')
    expect(contextEnvironment('docker-desktop')).toBe('development')
    expect(contextEnvironment('product-catalog')).toBeNull()
    expect(contextEnvironment('cluster-a')).toBeNull()
  })
})

describe('KubeActionConfirmModal', () => {
  function mountModal(action) {
    return mount(KubeActionConfirmModal, {
      props: { show: true, action },
      global: { stubs: { BaseModal: BaseModalStub } },
    })
  }

  it('shows the full context, namespace and resource before a restart', async () => {
    const wrapper = mountModal({ kind: 'restart', type: 'deployments', namespace: 'backend360', name: 'sot360', context: EKS_DEV })
    expect(wrapper.get('[data-test="kube-action-context"]').text()).toBe(EKS_DEV)
    expect(wrapper.get('[data-test="kube-action-namespace"]').text()).toBe('backend360')
    expect(wrapper.get('[data-test="kube-action-resource"]').text()).toBe('Deployment / sot360')
    expect(wrapper.get('[data-test="kube-action-env"]').text()).toBe('Development')
    expect(wrapper.text()).toContain('EKS130-360-Dev')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    await wrapper.get('[data-test="kube-action-submit"]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('labels production with text and a warning, not only color', () => {
    const wrapper = mountModal({ kind: 'cordon', type: 'nodes', name: 'node-1', context: EKS_PROD })
    expect(wrapper.get('[data-test="kube-action-env"]').text()).toBe('Production')
    expect(wrapper.get('[role="alert"]').text()).toContain('production')
    expect(wrapper.find('[data-test="kube-action-namespace"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="kube-action-submit"]').text()).toBe('Cordon node')
  })

  it('shows the target of a single delete', () => {
    const wrapper = mountModal({ kind: 'delete', type: 'pods', namespace: 'backend360', name: 'sot360-abc', context: EKS_PROD })
    expect(wrapper.text()).toContain('Delete Pod "sot360-abc"?')
    expect(wrapper.get('[data-test="kube-action-resource"]').text()).toBe('Pod / sot360-abc')
    expect(wrapper.get('[data-test="kube-action-namespace"]').text()).toBe('backend360')
    expect(wrapper.get('[data-test="kube-action-submit"]').classes()).toContain('danger')
    expect(wrapper.find('[data-test="kube-action-items"]').exists()).toBe(false)
  })

  it('lists every namespace touched by a bulk delete', () => {
    const items = [
      { namespace: 'a', name: 'p1' }, { namespace: 'b', name: 'p2' }, { namespace: 'a', name: 'p3' },
      { namespace: 'a', name: 'p4' }, { namespace: 'a', name: 'p5' }, { namespace: 'a', name: 'p6' },
    ]
    const wrapper = mountModal({ kind: 'delete', type: 'pods', namespace: 'a', name: 'p1', items, context: EKS_DEV })
    expect(wrapper.text()).toContain('Delete 6 Pods?')
    expect(wrapper.get('[data-test="kube-action-namespace"]').text()).toBe('2 namespaces')
    expect(wrapper.get('[data-test="kube-action-resource"]').text()).toBe('6 Pods')
    const listed = wrapper.get('[data-test="kube-action-items"]').text()
    expect(listed).toContain('b/p2')
    expect(listed).toContain('and 1 more')
    expect(wrapper.get('[data-test="kube-action-submit"]').text()).toBe('Delete 6 Pods')
  })

  it('marks drain as a destructive action', () => {
    const wrapper = mountModal({ kind: 'drain', type: 'nodes', name: 'node-1', context: 'cluster-a' })
    expect(wrapper.get('[data-test="kube-action-submit"]').classes()).toContain('danger')
    expect(wrapper.get('[data-test="kube-action-env"]').text()).toBe('Unidentified environment')
  })
})

describe('ScaleModal', () => {
  function mountScale(props) {
    return mount(ScaleModal, {
      props: { show: true, name: 'sot360', current: 3, type: 'deployments', namespace: 'backend360', context: EKS_DEV, ...props },
      global: { stubs: { BaseModal: BaseModalStub } },
    })
  }

  it('shows the context and the replica change before scaling', async () => {
    const wrapper = mountScale()
    expect(wrapper.get('[data-test="kube-action-context"]').text()).toBe(EKS_DEV)
    expect(wrapper.get('[data-test="kube-action-resource"]').text()).toBe('Deployment / sot360')
    await wrapper.get('[data-test="kube-scale-input"]').setValue(5)
    expect(wrapper.get('[data-test="kube-scale-change"]').text()).toBe('Replicas: 3 → 5')
    await wrapper.get('[data-test="kube-scale-submit"]').trigger('click')
    expect(wrapper.emitted('confirm')[0]).toEqual([5])
  })

  it('warns that zero replicas stops the workload', async () => {
    const wrapper = mountScale()
    expect(wrapper.find('[data-test="kube-scale-zero"]').exists()).toBe(false)
    await wrapper.get('[data-test="kube-scale-input"]').setValue(0)
    expect(wrapper.get('[data-test="kube-scale-zero"]').text()).toContain('stops every pod')
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { age, RESOURCES } from '../config/resources'

describe('age()', () => {
  let now

  beforeEach(() => {
    now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns "-" for null/undefined', () => {
    expect(age(null)).toBe('-')
    expect(age(undefined)).toBe('-')
  })

  it('returns seconds for < 60s ago', () => {
    const ts = new Date(now - 45 * 1000).toISOString()
    expect(age(ts)).toEqual({ text: '45sec', sort: 45 })
  })

  it('returns minutes and sort value for < 1h ago', () => {
    const ts = new Date(now - 30 * 60 * 1000).toISOString() // 30 minutes
    expect(age(ts)).toEqual({ text: '30min', sort: 1800 })
  })

  it('returns hours and minutes with total minutes sort value', () => {
    const ts = new Date(now - (2 * 3600 + 5 * 60) * 1000).toISOString()
    expect(age(ts)).toEqual({ text: '2hrs 5min', sort: 7500 })
  })

  it('returns days, hours and minutes for long durations', () => {
    const ts = new Date(now - (1 * 86400 + 3 * 3600 + 10 * 60) * 1000).toISOString()
    expect(age(ts)).toEqual({ text: '1day 3hrs 10min', sort: 97800 })
  })
})

describe('RESOURCES structure', () => {
  const resourceKeys = ['pods', 'deployments', 'statefulsets', 'daemonsets',
    'replicasets', 'jobs', 'cronjobs', 'services', 'endpointslices', 'endpoints',
    'ingresses', 'ingressclasses', 'networkpolicies', 'configmaps', 'secrets',
    'resourcequotas', 'limitranges', 'hpas', 'pdbs', 'priorityclasses',
    'runtimeclasses', 'leases', 'mutatingwebhookconfigurations',
    'validatingwebhookconfigurations', 'pvcs', 'pvs', 'storageclasses',
    'namespaces', 'nodes', 'events']
  const readOnlyKeys = new Set([
    'nodes', 'events', 'replicasets', 'jobs', 'cronjobs', 'endpointslices',
    'endpoints', 'ingressclasses', 'networkpolicies', 'resourcequotas',
    'limitranges', 'hpas', 'pdbs', 'priorityclasses', 'runtimeclasses',
    'leases', 'mutatingwebhookconfigurations', 'validatingwebhookconfigurations',
    'pvs', 'storageclasses', 'namespaces',
  ])

  it('exports all expected resource keys', () => {
    resourceKeys.forEach(key => {
      expect(RESOURCES).toHaveProperty(key)
    })
  })

  resourceKeys.forEach(key => {
    describe(`RESOURCES.${key}`, () => {
      it('has title, cols, row function and actions function', () => {
        const r = RESOURCES[key]
        expect(typeof r.title).toBe('string')
        expect(Array.isArray(r.cols)).toBe(true)
        expect(r.cols.length).toBeGreaterThan(0)
        expect(typeof r.row).toBe('function')
        expect(typeof r.actions).toBe('function')
      })

      it('row() returns an array with correct length', () => {
        const r = RESOURCES[key]
        // Provide a fake resource with all fields
        const fake = {
          name: 'test', namespace: 'default', status: 'Running', ready: '1/1',
          restarts: 0, age: new Date().toISOString(), nodeName: 'node1',
          replicas: 2, desired: 2, current: 1, owner: 'Deployment/test', type: 'ClusterIP', clusterIP: '10.0.0.1',
          ports: '80/TCP', rawPorts: [], class: 'nginx', hosts: 'example.com',
          keys: 3, capacity: '1Gi', storageClass: 'standard', containers: ['nginx'],
          message: 'something', reason: 'Started', object: 'Pod/test',
          role: 'worker', version: 'v1.28', cpu: '1', memory: '2Gi',
          conditions: 'Ready',
          completions: '1/1', active: 0, failed: 0, schedule: '* * * * *', suspend: 'No', lastSchedule: '-',
          addressType: 'IPv4', endpoints: 1, controller: 'example.com/controller', parameters: '-', podSelector: 'app=test', types: 'Ingress', ingress: 1, egress: 0,
          hard: 'pods:10', used: 'pods:1', items: 1, target: 'Deployment/test', min: 1, max: 3, holder: 'holder', renewTime: '-',
          minAvailable: 1, maxUnavailable: '-', allowed: 1, value: 1000, globalDefault: 'No', description: 'desc', handler: 'runc', overhead: 'No', scheduling: 'No',
          webhooks: 1, reclaimPolicy: 'Delete', claim: 'default/claim', provisioner: 'kubernetes.io/no-provisioner', volumeBindingMode: 'Immediate',
        }
        const row = r.row(fake)
        expect(Array.isArray(row)).toBe(true)
        expect(row.length).toBe(r.cols.length)
      })

      it('actions() returns an array of valid action descriptors', () => {
        const r = RESOURCES[key]
        const fake = {
          name: 'test', namespace: 'default', containers: ['app'],
          replicas: 1, rawPorts: [],
        }
        const actions = r.actions(fake)
        expect(Array.isArray(actions)).toBe(true)
        actions.forEach(a => {
          expect(typeof a.icon).toBe('string')
          expect(typeof a.label).toBe('string')
          expect(typeof a.cls).toBe('string')
          expect(typeof a.fn).toBe('string')
          expect(Array.isArray(a.args)).toBe(true)
        })
      })

      it('actions() always include a Delete action', () => {
        const r = RESOURCES[key]
        if (readOnlyKeys.has(key)) return
        const actions = r.actions({ name: 'x', namespace: 'default', containers: [] })
        const hasDelete = actions.some(a => a.fn === 'confirmDelete')
        expect(hasDelete).toBe(true)
      })
    })
  })
})

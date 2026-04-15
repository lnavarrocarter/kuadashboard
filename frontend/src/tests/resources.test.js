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
    expect(age(ts)).toBe('45s')
  })

  it('returns minutes for < 1h ago', () => {
    const ts = new Date(now - 30 * 60 * 1000).toISOString() // 30 minutes
    expect(age(ts)).toBe('30m')
  })

  it('returns hours for < 24h ago', () => {
    const ts = new Date(now - 5 * 3600 * 1000).toISOString()
    expect(age(ts)).toBe('5h')
  })

  it('returns days for >= 24h ago', () => {
    const ts = new Date(now - 3 * 86400 * 1000).toISOString()
    expect(age(ts)).toBe('3d')
  })
})

describe('RESOURCES structure', () => {
  const resourceKeys = ['pods', 'deployments', 'statefulsets', 'daemonsets',
    'services', 'ingresses', 'configmaps', 'secrets', 'pvcs', 'nodes', 'events']

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
          replicas: 2, type: 'ClusterIP', clusterIP: '10.0.0.1',
          ports: '80/TCP', rawPorts: [], class: 'nginx', hosts: 'example.com',
          keys: 3, capacity: '1Gi', storageClass: 'standard', containers: ['nginx'],
          message: 'something', reason: 'Started', object: 'Pod/test',
          role: 'worker', version: 'v1.28', cpu: '1', memory: '2Gi',
          conditions: 'Ready',
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
        if (key === 'nodes' || key === 'events') return // read-only resources
        const actions = r.actions({ name: 'x', namespace: 'default', containers: [] })
        const hasDelete = actions.some(a => a.fn === 'confirmDelete')
        expect(hasDelete).toBe(true)
      })
    })
  })
})

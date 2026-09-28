import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import ResourceTable from '../components/ResourceTable.vue'
import { RESOURCES } from '../config/resources'
import { useKubeStore } from '../stores/useKubeStore'

const ROWS = [
  {
    name: 'api', namespace: 'default', type: 'ClusterIP', clusterIP: '10.100.0.10',
    ports: '80:8080/TCP', rawPorts: [], app: 'api-server',
    backendIPs: '10.0.1.5, 10.0.1.6', age: new Date().toISOString(),
  },
  {
    name: 'db', namespace: 'default', type: 'ExternalName', clusterIP: '', ports: '-', rawPorts: [],
    app: '-', backendIPs: '→ db.example.com', age: new Date().toISOString(),
  },
  {
    name: 'many', namespace: 'default', type: 'NodePort', clusterIP: '10.100.0.11', ports: '80:80/TCP', rawPorts: [],
    app: 'web', backendIPs: Array.from({ length: 12 }, (_, i) => `10.0.2.${i + 1}`).join(', '),
    age: new Date().toISOString(),
  },
]

describe('Services table — app and backend IPs (#62)', () => {
  it('keeps Type and Cluster IP and adds App and Backend IPs columns', () => {
    expect(RESOURCES.services.cols).toEqual(['Name', 'Namespace', 'App', 'Type', 'Cluster IP', 'Backend IPs', 'Ports', 'Age'])
  })

  it('row() maps the new fields next to the existing ones', () => {
    const cells = RESOURCES.services.row(ROWS[0])
    const col = name => cells[RESOURCES.services.cols.indexOf(name)]
    expect(col('App')).toBe('api-server')
    expect(col('Type')).toBe('ClusterIP')
    expect(col('Cluster IP')).toBe('10.100.0.10')
    expect(col('Backend IPs')).toEqual({ truncate: '10.0.1.5, 10.0.1.6', max: 48 })
  })

  it('row() falls back to "-" when the backend omits the new fields', () => {
    const cells = RESOURCES.services.row({ ...ROWS[0], app: undefined, backendIPs: undefined })
    expect(cells[2]).toBe('-')
    expect(cells[5]).toEqual({ truncate: '-', max: 48 })
  })

  describe('ResourceTable render', () => {
    let wrapper

    beforeEach(() => {
      setActivePinia(createPinia())
      const store = useKubeStore()
      store.resource = 'services'
      store.rows = ROWS
      wrapper = mount(ResourceTable, { props: { resource: 'services' } })
    })

    it('renders the new headers', () => {
      const headers = wrapper.findAll('thead th').map(th => th.text())
      expect(headers.some(h => h.startsWith('App'))).toBe(true)
      expect(headers.some(h => h.startsWith('Backend IPs'))).toBe(true)
      expect(headers.some(h => h.startsWith('Type'))).toBe(true)
    })

    it('renders app name and backend IPs per service', () => {
      const rows = wrapper.findAll('tbody tr')
      expect(rows).toHaveLength(3)
      expect(rows[0].text()).toContain('api-server')
      expect(rows[0].text()).toContain('10.0.1.5, 10.0.1.6')
      expect(rows[1].text()).toContain('→ db.example.com')
    })

    it('truncates long IP lists and keeps the full list in the tooltip', () => {
      const cell = wrapper.findAll('tbody tr')[2].findAll('td').find(td => td.find('span[title]').exists())
      const span = cell.find('span[title]')
      expect(span.text().endsWith('…')).toBe(true)
      expect(span.attributes('title')).toBe(ROWS[2].backendIPs)
    })

    it('filters services by backend IP or app name', async () => {
      await wrapper.find('.search-input').setValue('10.0.1.6')
      expect(wrapper.findAll('tbody tr')).toHaveLength(1)
      await wrapper.find('.search-input').setValue('api-server')
      expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { buildExecution, formatExecutionJson } from '../lib/stepFnExecution'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import StepFnDetail from '../components/StepFnDetail.vue'
import { useAwsStore } from '../stores/useAwsStore'
import StepFnExecution from '../components/StepFnExecution.vue'
import StepFnDiagram from '../components/StepFnDiagram.vue'

const event = (id, previousEventId, type, details = {}) => ({ id, previousEventId, type, timestamp: id * 1000, ...details })
const enter = (id, previous, name, type = 'Task') => event(id, previous, `${type}StateEntered`, { stateEnteredEventDetails: { name, input: '{"value":1}' } })
const exit = (id, previous, name, type = 'Task') => event(id, previous, `${type}StateExited`, { stateExitedEventDetails: { name, output: '{"ok":true}' } })
const definition = JSON.stringify({ StartAt: 'Work', States: { Work: { Type: 'Task', Next: 'Done' }, Done: { Type: 'Succeed' } } })

describe('Step Functions execution history', () => {
  it('switches between repeated visits without mixing their input or events', async () => {
    const wrapper = mount(StepFnExecution, { props: { definition, events: [
      enter(1, 0, 'Work'), exit(2, 1, 'Work'), enter(3, 2, 'Work'), event(4, 3, 'TaskFailed'),
    ] } })
    expect(wrapper.find('[aria-label="Visita del paso"]').element.value).toBe('3')
    await wrapper.find('[aria-label="Visita del paso"]').setValue('1')
    expect(wrapper.find('.sfnx-heading').text()).toContain('Completado')
    expect(wrapper.find('.sfnx-step-events').text()).not.toContain('TaskFailed')
    expect(wrapper.findComponent(StepFnDiagram).props('nodeStatuses').Work).toBe('SUCCEEDED')
    wrapper.unmount()
  })

  it('does not assign identical branch names to an arbitrary diagram node', () => {
    const branch = { StartAt: 'Work', States: { Work: { Type: 'Task', End: true } } }
    const parallel = { StartAt: 'Both', States: { Both: { Type: 'Parallel', End: true, Branches: [branch, branch] } } }
    const result = buildExecution([enter(1, 0, 'Both', 'Parallel'), event(2, 1, 'ParallelStateStarted'), enter(3, 2, 'Work')], parallel)
    expect(result.visits[1].scopeId).toBeUndefined()
    expect(result.visits[1].parent.name).toBe('Both')
  })

  it('does not mark redriven visits as terminated by an earlier failure', () => {
    const result = buildExecution([
      enter(1, 0, 'Work'), event(2, 1, 'TaskFailed'), event(3, 2, 'ExecutionFailed'),
      event(4, 3, 'ExecutionRedriven'), enter(5, 4, 'Work'), event(6, 5, 'TaskStarted'),
    ], definition)
    expect(result.visits.map(visit => visit.status)).toEqual(['FAILED', 'RUNNING'])
    expect(result.visits[1].end).toBeNull()
  })

  it('loads history when selecting a row and ignores stale execution responses', async () => {
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const store = useAwsStore()
    const executions = [{ name: 'first', executionArn: 'first', status: 'RUNNING' }, { name: 'second', executionArn: 'second', status: 'SUCCEEDED' }]
    store.fetchStepFnDiagram.mockResolvedValue({ stateMachine: { definition }, recentExecutions: executions })
    let resolveFirst
    store.fetchStepFnExecutionEvents.mockImplementation(arn => arn === 'first'
      ? new Promise(resolve => { resolveFirst = resolve })
      : Promise.resolve({ definition, events: [enter(10, 0, 'Done', 'Succeed'), event(11, 10, 'ExecutionSucceeded')] }))
    const wrapper = mount(StepFnDetail, { props: { open: false, sm: { arn: 'machine' } }, global: { plugins: [pinia], stubs: { teleport: true } } })
    await wrapper.setProps({ open: true })
    await flushPromises()
    await wrapper.findAll('.sfnd-tab')[2].trigger('click')
    await wrapper.findAll('.sfnd-exec-row')[0].trigger('click')
    await wrapper.findAll('.sfnd-exec-row')[1].trigger('click')
    await flushPromises()
    resolveFirst({ events: [enter(1, 0, 'Work')], definition })
    await flushPromises()
    await wrapper.findAll('.sfnd-tab')[3].trigger('click')
    expect(wrapper.findComponent(StepFnExecution).props('events')[0].id).toBe(10)
    expect(wrapper.find('.sfnx-heading').text()).toContain('Done')
    expect(wrapper.find('.sfnd-modal-execution').exists()).toBe(true)
    wrapper.unmount()
  })

  it('highlights catch transitions after a failed task', () => {
    const result = buildExecution([enter(1, 0, 'Work'), event(2, 1, 'TaskFailed'), enter(3, 2, 'Done', 'Succeed')], definition)
    expect(result.transitions).toEqual([{ scopeId: 'root', from: 'Work', to: 'Done' }])
  })
  it('opens the failed step, selects diagram nodes and preserves full history', async () => {
    const wrapper = mount(StepFnExecution, { props: { definition, events: [
      enter(1, 0, 'Work'), event(2, 1, 'TaskFailed', { taskFailedEventDetails: { error: 'Unavailable', cause: '{"reason":"offline"}' } }), event(3, 2, 'ExecutionFailed'),
    ] } })
    expect(wrapper.find('h3').text()).toBe('Work')
    expect(wrapper.find('.sfnx-failure').text()).toContain('offline')
    const diagram = wrapper.findComponent(StepFnDiagram)
    expect(diagram.props('nodeStatuses')).toEqual({ Work: 'FAILED' })
    await diagram.findAll('.sfn-node')[1].trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.sfnx-empty').text()).toContain('no tiene visitas')
    await wrapper.find('[aria-label="Paso y visita"]').setValue('1')
    expect(wrapper.find('h3').text()).toBe('Work')
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    expect(wrapper.findAll('.sfnx-history details')).toHaveLength(3)
    wrapper.unmount()
  })
  it('keeps repeated visits and retry events separate from final success', () => {
    const result = buildExecution([
      enter(1, 0, 'Work'), event(2, 1, 'TaskFailed'), event(3, 2, 'TaskScheduled'),
      exit(4, 3, 'Work'), enter(5, 4, 'Work'), event(6, 5, 'TaskFailed'),
      event(7, 6, 'ExecutionFailed'),
    ], definition)
    expect(result.visits.map(visit => visit.status)).toEqual(['SUCCEEDED', 'FAILED'])
    expect(result.visits[0].events.map(item => item.id)).toEqual([1, 2, 3, 4])
    expect(result.visits[1].events.map(item => item.id)).toEqual([5, 6, 7])
    expect(result.transitions).toEqual([{ scopeId: 'root', from: 'Work', to: 'Work' }])
  })

  it('links interleaved parallel branches through previousEventId', () => {
    const parallel = { StartAt: 'Both', States: { Both: { Type: 'Parallel', End: true, Branches: [
      { StartAt: 'Left', States: { Left: { Type: 'Task', End: true } } },
      { StartAt: 'Right', States: { Right: { Type: 'Task', End: true } } },
    ] } } }
    const result = buildExecution([
      enter(1, 0, 'Both', 'Parallel'), event(2, 1, 'ParallelStateStarted'),
      enter(3, 2, 'Left'), enter(4, 2, 'Right'), event(5, 3, 'TaskScheduled'),
      exit(6, 5, 'Left'), exit(7, 4, 'Right'), event(8, 2, 'ParallelStateSucceeded'),
      exit(9, 8, 'Both', 'Parallel'),
    ], parallel)
    expect(result.visits[1].events.map(item => item.id)).toEqual([3, 5, 6])
    expect(result.visits[2].events.map(item => item.id)).toEqual([4, 7])
    expect(result.visits[1].scopeId).not.toBe(result.visits[2].scopeId)
    expect(result.visits[0].status).toBe('SUCCEEDED')
  })

  it('retains map iteration indexes and closes interrupted visits', () => {
    const map = { StartAt: 'Each', States: { Each: { Type: 'Map', End: true, Iterator: { StartAt: 'Work', States: { Work: { Type: 'Task', End: true } } } } } }
    const result = buildExecution([
      enter(1, 0, 'Each', 'Map'), event(2, 1, 'MapIterationStarted', { mapIterationStartedEventDetails: { index: 0 } }),
      enter(3, 2, 'Work'), event(4, 1, 'MapIterationStarted', { mapIterationStartedEventDetails: { index: 1 } }),
      enter(5, 4, 'Work'), event(6, 1, 'ExecutionAborted'),
    ], map)
    expect(result.visits.slice(1).map(visit => visit.iteration)).toEqual([0, 1])
    expect(result.visits.every(visit => visit.status === 'ABORTED' && visit.end === 6000)).toBe(true)
  })

  it('decodes nested serialized objects while preserving strings and malformed data', () => {
    expect(JSON.parse(formatExecutionJson('{"input":"{\\"count\\":1}","id":"001","bad":"{no}"}'))).toEqual({ input: { count: 1 }, id: '001', bad: '{no}' })
    expect(buildExecution([], 'invalid').visits).toEqual([])
  })
})
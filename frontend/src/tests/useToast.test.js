import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useToast } from '../composables/useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Reset the shared toasts array between tests
    const { toasts } = useToast()
    toasts.value.splice(0)
  })

  it('adds a toast with default type "info"', () => {
    const { toasts, toast } = useToast()
    toast('Hello!')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]).toMatchObject({ message: 'Hello!', type: 'info' })
    expect(typeof toasts.value[0].id).toBe('number')
  })

  it('adds a toast with custom type', () => {
    const { toasts, toast } = useToast()
    toast('Error occurred', 'error')
    expect(toasts.value[0].type).toBe('error')
  })

  it('auto-removes toast after 4 seconds', () => {
    const { toasts, toast } = useToast()
    toast('I will disappear')
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    expect(toasts.value).toHaveLength(0)
  })

  it('does not remove toast before 4 seconds', () => {
    const { toasts, toast } = useToast()
    toast('Still here')
    vi.advanceTimersByTime(3999)
    expect(toasts.value).toHaveLength(1)
  })

  it('supports multiple toasts independently', () => {
    const { toasts, toast } = useToast()
    toast('First')
    vi.advanceTimersByTime(1000)
    toast('Second')
    expect(toasts.value).toHaveLength(2)
    vi.advanceTimersByTime(3001) // first toast (1000+3001=4001ms) removed
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('Second')
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })

  it('each call to useToast shares the same toasts array', () => {
    const a = useToast()
    const b = useToast()
    a.toast('shared')
    expect(b.toasts.value).toHaveLength(1)
  })
})

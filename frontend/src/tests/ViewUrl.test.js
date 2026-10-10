import { describe, it, expect, afterEach, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { readViewUrl, nextViewUrl, useViewUrl } from '../composables/useViewUrl'

const BASE = 'http://localhost:7192/'

describe('view URL (A15)', () => {
  it('reads the view, AWS service and profile, ignoring unknown views', () => {
    expect(readViewUrl('?view=aws&service=lambda&profile=local%3Adev')).toEqual({ view: 'aws', service: 'lambda', profile: 'local:dev' })
    expect(readViewUrl('?view=nope&service=x')).toEqual({ view: '', service: 'x', profile: '' })
    expect(readViewUrl('')).toEqual({ view: '', service: '', profile: '' })
  })

  it('drops the KUApps params on other views and puts them back on KUApps', () => {
    const left = nextViewUrl(`${BASE}?app=app-1&tab=signals`, { view: 'aws', service: 'lambda', profile: 'local:dev' })
    expect(left.href).toBe(`${BASE}?view=aws&service=lambda&profile=local%3Adev`)
    expect(left.stash).toEqual({ app: 'app-1', tab: 'signals' })

    const back = nextViewUrl(left.href, { view: 'kuapps' }, left.stash)
    expect(new URL(back.href).searchParams.toString()).toBe('view=kuapps&app=app-1&tab=signals')
    expect(back.stash).toEqual({})
  })

  it('keeps AWS-only params off other providers and never writes credentials', () => {
    const { href } = nextViewUrl(`${BASE}?view=aws&service=s3&profile=p1`, { view: 'gcp', service: 's3', profile: 'p1' })
    expect(href).toBe(`${BASE}?view=gcp`)
  })
})

// A browser with its own entries: the test setup replaces window.location with a stub.
function fakeBrowser(href) {
  const entries = [href]
  let index = 0
  const location = {
    get href() { return entries[index] },
    get search() { return new URL(entries[index]).search },
  }
  const history = {
    state: null,
    get length() { return entries.length },
    pushState(state, _, url) { entries.splice(index + 1); entries.push(new URL(url, entries[index]).href); index += 1; this.state = state },
    replaceState(state, _, url) { entries[index] = new URL(url, entries[index]).href; this.state = state },
    back() { index -= 1; window.dispatchEvent(new PopStateEvent('popstate')) },
  }
  return { location, history }
}

describe('useViewUrl history', () => {
  let scope
  afterEach(() => scope?.stop())

  function setup(onPop = vi.fn()) {
    const browser = fakeBrowser(`${BASE}?app=app-1&tab=signals`)
    const provider = ref('kuapps')
    const service = ref('overview')
    const profile = ref('local:dev')
    let api
    scope = effectScope()
    scope.run(() => {
      api = useViewUrl({
        state: () => ({ view: provider.value, service: provider.value === 'aws' ? service.value : '', profile: provider.value === 'aws' ? profile.value : '' }),
        navigation: [provider, service],
        context: [profile],
        onPop,
        ...browser,
      })
      api.start()
    })
    return { api, provider, service, profile, onPop, ...browser }
  }

  it('navigations push entries, profile changes replace the current one', async () => {
    const { provider, service, profile, location, history, api } = setup()
    expect(location.search).toBe('?app=app-1&tab=signals&view=kuapps')

    provider.value = 'aws'
    await nextTick()
    expect(location.search).toBe('?view=aws&service=overview&profile=local%3Adev')
    service.value = 'lambda'
    await nextTick()
    expect(history.length).toBe(3)

    profile.value = 'local:prod'
    await nextTick()
    expect(history.length).toBe(3)
    expect(location.search).toBe('?view=aws&service=lambda&profile=local%3Aprod')

    provider.value = 'kuapps'
    await nextTick()
    expect(new URLSearchParams(location.search).get('app')).toBe('app-1')
    api.stop()
  })

  it('Back hands the previous view to onPop without pushing a new entry', async () => {
    const onPop = vi.fn(async linked => {
      provider.value = linked.view // the app applies it: no new entry while applying
      if (linked.service) service.value = linked.service
    })
    const { provider, service, history, location, api } = setup(onPop)
    provider.value = 'aws'
    await nextTick()
    service.value = 'lambda'
    await nextTick()
    history.back()
    await nextTick(); await nextTick(); await nextTick()
    expect(onPop).toHaveBeenCalledWith({ view: 'aws', service: 'overview', profile: 'local:dev' })
    expect(service.value).toBe('overview')
    expect(history.length).toBe(3)
    expect(location.search).toBe('?view=aws&service=overview&profile=local%3Adev')
    api.stop()
  })
})

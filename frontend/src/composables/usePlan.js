/**
 * The KUA plan the app runs with (GET /api/system/plan), fetched once and
 * shared. Until the desktop is linked to an account it comes from KUA_PLAN.
 */
import { ref } from 'vue'
import { api } from './useApi'

const plan = ref(null)
let loading = null

export function usePlan() {
  function load({ force = false } = {}) {
    if (loading && !force) return loading
    loading = api('GET', '/api/system/plan')
      // Only a well-formed answer counts: anything else keeps the controls locked.
      .then(value => { plan.value = value?.features && value?.limits ? value : null; return plan.value })
      .catch(() => { loading = null; return plan.value })
    return loading
  }
  if (!plan.value) load()
  return { plan, reload: () => load({ force: true }) }
}

/** Plan that unlocks a value: the cheapest plan whose limit allows it. */
export function requiredPlanFor(plans, test) {
  return ['free', 'pro', 'team'].find(name => plans?.[name] && test(plans[name])) || 'team'
}

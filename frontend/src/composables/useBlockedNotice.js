import { reactive } from 'vue'

// One notice for every request KUA refused for a reason the user can change:
//   READ_ONLY      the read-only mode is on (lib/readOnlyMode.js) → turn it off
//   PLAN_REQUIRED  the plan does not include it (lib/plans.js)      → see the plans
// Views keep showing their own error; this says why and what to do about it.
export const blockedNotice = reactive({ open: false, kind: '', area: '', feature: '', required: '', limit: null, message: '' })

export function showBlockedNotice(body = {}) {
  if (body.code !== 'READ_ONLY' && body.code !== 'PLAN_REQUIRED') return false
  Object.assign(blockedNotice, {
    open: true,
    kind: body.code === 'READ_ONLY' ? 'readOnly' : 'plan',
    area: body.area || '',
    feature: body.feature || (body.limit != null ? 'kuaApps' : ''),
    required: body.required || 'pro',
    limit: body.limit ?? null,
    message: body.error || '',
  })
  return true
}

export function closeBlockedNotice() {
  blockedNotice.open = false
}

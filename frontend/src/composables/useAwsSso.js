/**
 * composables/useAwsSso.js
 * Browser-based AWS IAM Identity Center (SSO) login flow.
 *
 * Drives the device-authorization endpoints in routes/aws.js:
 *   startLogin()       → opens the AWS verification page in the browser and
 *                        polls until the user approves (resolves when authorized)
 *   fetchAccounts()    → accounts + roles visible to the authorized session
 *   fetchCredentials() → temporary role credentials (key/secret/token/expiration)
 *
 * Used by ProfileModal (initial setup) and AwsSessionAlert (one-click renewal).
 */
import { ref } from 'vue'

export function useAwsSso() {
  const phase           = ref('idle')   // idle | starting | waiting | authorized | denied | expired | error
  const message         = ref('')
  const verificationUrl = ref('')
  const userCode        = ref('')

  let sessionId = null
  let pollTimer = null
  let cancelled = false

  function reset() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    cancelled       = true
    sessionId       = null
    phase.value     = 'idle'
    message.value   = ''
    verificationUrl.value = ''
    userCode.value  = ''
  }

  async function api(path, opts = {}) {
    const res  = await fetch(`/api/cloud/aws/sso/${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `SSO request failed (${res.status})`)
    return data
  }

  /** List SSO profiles detected in ~/.aws/config */
  async function fetchLocalSsoProfiles() {
    try { return await api('local-profiles') } catch { return [] }
  }

  /**
   * Start the device-authorization flow: opens the AWS login page in the
   * browser and resolves once the user approves the request there.
   */
  async function startLogin({ startUrl, ssoRegion }) {
    reset()
    cancelled     = false
    phase.value   = 'starting'
    try {
      const data = await api('start', { method: 'POST', body: JSON.stringify({ startUrl, ssoRegion }) })
      sessionId             = data.sessionId
      verificationUrl.value = data.verificationUriComplete || data.verificationUri
      userCode.value        = data.userCode || ''
      window.open(verificationUrl.value, '_blank', 'noopener,noreferrer')
      phase.value = 'waiting'

      const intervalMs = Math.max((data.interval || 5) * 1000, 2000)
      await new Promise((resolve, reject) => {
        const poll = async () => {
          if (cancelled) return reject(new Error('cancelled'))
          try {
            const d = await api('poll', { method: 'POST', body: JSON.stringify({ sessionId }) })
            if (d.status === 'authorized') { phase.value = 'authorized'; return resolve() }
            if (d.status === 'denied')     { phase.value = 'denied';  return reject(new Error('Acceso denegado en AWS')) }
            if (d.status === 'expired')    { phase.value = 'expired'; return reject(new Error('La solicitud de login expiró — inténtalo de nuevo')) }
            pollTimer = setTimeout(poll, intervalMs)
          } catch (e) { phase.value = 'error'; message.value = e.message; reject(e) }
        }
        pollTimer = setTimeout(poll, intervalMs)
      })
      return sessionId
    } catch (e) {
      if (phase.value === 'starting') { phase.value = 'error'; message.value = e.message }
      throw e
    }
  }

  /** Accounts + roles visible to the authorized SSO session */
  async function fetchAccounts() {
    return api(`accounts?sessionId=${encodeURIComponent(sessionId)}`)
  }

  /** Temporary role credentials: { accessKeyId, secretAccessKey, sessionToken, expiration } */
  async function fetchCredentials(accountId, roleName) {
    return api('credentials', { method: 'POST', body: JSON.stringify({ sessionId, accountId, roleName }) })
  }

  return {
    phase, message, verificationUrl, userCode,
    reset, fetchLocalSsoProfiles, startLogin, fetchAccounts, fetchCredentials,
  }
}

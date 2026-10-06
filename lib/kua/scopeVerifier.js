'use strict';
/**
 * lib/kua/scopeVerifier.js
 * Checks that a local profile reaches the provider scope it is bound to (#149),
 * with free reads only: AWS STS GetCallerIdentity, the GCP project and Vercel
 * team of the profile, and the kube contexts on this computer. A failed read
 * leaves the binding unverified; only a different identity is a mismatch.
 */

// What a profile reaches, per provider: { identity, detail }. identity is compared with scopeId.
const DEFAULT_RESOLVERS = {
  async aws(profileId) {
    const { resolveAwsConfig } = require('../awsProfileResolver');
    const { callerIdentity } = require('../awsOverview');
    const { account } = await callerIdentity(await resolveAwsConfig(profileId));
    return { identity: account || null };
  },
  async gcp(profileId) {
    const { resolveGcpAuth } = require('../../routes/gcp');
    const { projectId } = await resolveGcpAuth(profileId);
    return { identity: projectId || null };
  },
  async vercel(profileId) {
    const { resolveVercelAuth } = require('../../routes/vercel');
    const { teamId } = await resolveVercelAuth(profileId);
    return { identity: teamId || null };
  },
  // The profile of a Kubernetes scope is a kube context of this computer. Context names
  // differ between computers, so choosing an existing context is the verification.
  async kubernetes(profileId) {
    const { buildKubeConfig } = require('../kubeConfigManager');
    const { kubeConfig } = buildKubeConfig(undefined, { logger: { log() {}, warn() {} } });
    const context = kubeConfig.getContexts().find(item => item.name === profileId);
    if (!context) throw new Error(`Kube context not found: ${profileId}`);
    return { identity: profileId, anyScope: true };
  },
};

function createScopeVerifier({ resolvers = DEFAULT_RESOLVERS, now = () => Date.now() } = {}) {
  /**
   * Returns the binding fields to store, plus completedScopeId when the scope had no
   * scopeId yet and the profile revealed it (the caller completes the scope).
   */
  async function verify(scope, profileId) {
    const resolve = resolvers[scope.provider];
    const at = new Date(now()).toISOString();
    if (!resolve) return { status: 'unverified', verifiedIdentity: null, verifiedAt: null, lastError: `No verification for provider ${scope.provider}` };
    let result;
    try { result = await resolve(profileId); } catch (error) {
      return { status: 'unverified', verifiedIdentity: null, verifiedAt: null, lastError: error.message || 'Verification failed' };
    }
    const identity = result?.identity ? String(result.identity) : null;
    if (!identity) return { status: 'unverified', verifiedIdentity: null, verifiedAt: at, lastError: 'The profile does not name its account, project or team' };
    if (!scope.scopeId) return { status: 'verified', verifiedIdentity: identity, verifiedAt: at, lastError: null, completedScopeId: identity };
    if (result.anyScope || identity.toLowerCase() === scope.scopeId.toLowerCase()) {
      return { status: 'verified', verifiedIdentity: identity, verifiedAt: at, lastError: null };
    }
    return { status: 'mismatch', verifiedIdentity: identity, verifiedAt: at, lastError: `The profile reaches ${identity}, not ${scope.scopeId}` };
  }

  return { verify };
}

module.exports = { createScopeVerifier, DEFAULT_RESOLVERS };

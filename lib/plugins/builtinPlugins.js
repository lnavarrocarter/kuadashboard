'use strict';
/** First-party plugins that ship with KUA (#193). */

const { GITHUB_CICD_MANIFEST } = require('../kua/githubCicd');

function githubCicdPlugin(github) {
  return {
    manifest: {
      manifestVersion: 1,
      id: GITHUB_CICD_MANIFEST.id,
      name: 'GitHub CI/CD',
      description: 'Explains what changed and when in a KUA Application: the workflow or deploy that probably replaced a resource that no longer exists, with its commit and author.',
      version: '1.0.0',
      contractVersion: 1,
      category: 'ci-cd',
      capabilities: { ...GITHUB_CICD_MANIFEST.capabilities },
      resourceTypes: [],
      credentialFields: [],
      reads: ['GitHub Actions runs', 'GitHub deployments', 'Repositories of the logged-in gh account'],
      cost: { level: 'free', summary: 'Read-only requests with the GitHub CLI already logged in on this computer. No token is stored and nothing is written to GitHub.' },
    },
    adapter: github.adapter,
    // Applications that already synced with GitHub before the registry existed keep the plugin on.
    defaultActive: () => github.hasEnabledApplications(),
    async status() {
      const connection = await github.connection();
      return connection.authenticated
        ? { state: 'connected', detail: connection.login || '' }
        : { state: 'unavailable', detail: connection.available ? 'gh not logged in' : 'gh not installed' };
    },
  };
}

module.exports = { githubCicdPlugin };

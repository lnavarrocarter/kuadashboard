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

const VERCEL_PLUGIN_ID = 'vercel';

/**
 * Vercel (#194): the Vercel tab, its Advisor, build and runtime logs, Observability, discovery for
 * Architecture and the vercel_advisor MCP tool. On by default only where a Vercel profile already
 * exists, so nothing changes for those who use it; without one, nothing of Vercel is mounted or read.
 */
function vercelPlugin({ listProfiles }) {
  return {
    manifest: {
      manifestVersion: 1,
      id: VERCEL_PLUGIN_ID,
      name: 'Vercel',
      description: 'Projects, deployments, domains and environment variables of a Vercel account or team, with its Advisor, build and runtime logs, Observability and the projects in Architecture and KUApps.',
      version: '1.0.0',
      contractVersion: 1,
      category: 'provider',
      capabilities: { discovery: true, enrichment: false, relationshipEvidence: false, telemetry: true, historicalSearch: false, findings: true },
      resourceTypes: ['vercel-project'],
      credentialFields: [{ name: 'VERCEL_API_TOKEN', secret: true }, { name: 'VERCEL_TEAM_ID', secret: false }],
      reads: ['Projects, deployments and domains', 'Environment variable names and targets', 'Build and runtime logs', 'Team settings for the Advisor'],
      cost: { level: 'free', summary: 'Vercel REST API reads with the token of each profile, at no charge from Vercel. Redeploy, promote and cancel ask first.' },
    },
    defaultActive: async () => (await listProfiles()).some(profile => profile.provider === 'vercel'),
    // Until the profiles are read at startup it stays on, so an existing Vercel setup never blinks.
    activeWhilePending: true,
    async status() {
      const count = (await listProfiles()).filter(profile => profile.provider === 'vercel').length;
      return count ? { state: 'connected', detail: `${count} profile${count === 1 ? '' : 's'}` } : { state: 'unavailable', detail: 'no Vercel profile' };
    },
  };
}

const PROXMOX_PLUGIN_ID = 'proxmox';

/**
 * Proxmox VE (#195): the inventory of a cluster or a single node (quorum, nodes, VMs, LXC, storage,
 * backup jobs, recent tasks), read-only. Off until the person turns it on.
 */
function proxmoxPlugin({ listProfiles }) {
  return {
    manifest: {
      manifestVersion: 1,
      id: PROXMOX_PLUGIN_ID,
      name: 'Proxmox VE',
      description: 'Clusters and single nodes of Proxmox VE: quorum, nodes, QEMU VMs and LXC containers, storage, backup jobs and recent tasks. Read-only, with an API token and a pinned TLS certificate.',
      version: '1.0.0',
      contractVersion: 1,
      category: 'provider',
      capabilities: { discovery: false, enrichment: false, relationshipEvidence: false, telemetry: false, historicalSearch: false, findings: false },
      resourceTypes: ['proxmox-node', 'proxmox-qemu', 'proxmox-lxc', 'proxmox-storage'],
      credentialFields: [
        { name: 'PROXMOX_URL', secret: false },
        { name: 'PROXMOX_TOKEN_ID', secret: false },
        { name: 'PROXMOX_TOKEN_SECRET', secret: true },
        { name: 'PROXMOX_TLS_FINGERPRINT', secret: false },
        { name: 'PROXMOX_CA_PEM', secret: false },
      ],
      reads: ['Cluster status and quorum', 'Nodes, VMs and containers', 'Storage usage', 'Backup jobs and recent tasks'],
      cost: { level: 'free', summary: 'Reads of the Proxmox API on your network; no cloud cost. Use a token of a user with the PVEAuditor role and privilege separation on.' },
    },
    async status() {
      const count = (await listProfiles()).filter(profile => profile.provider === 'proxmox').length;
      return count ? { state: 'connected', detail: `${count} profile${count === 1 ? '' : 's'}` } : { state: 'unavailable', detail: 'no Proxmox profile' };
    },
  };
}

module.exports = { PROXMOX_PLUGIN_ID, VERCEL_PLUGIN_ID, githubCicdPlugin, proxmoxPlugin, vercelPlugin };

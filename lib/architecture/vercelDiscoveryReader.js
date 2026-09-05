'use strict';

const { resolveVercelAuth, vercelFetch, VERCEL_ENDPOINTS, withTeam } = require('../../routes/vercel');
const { stableNodeId } = require('./cloudDiscoveryService');

function createVercelDiscoveryReader({ resolveAuth = resolveVercelAuth, fetchJson = vercelFetch } = {}) {
  return {
    async preview({ profileId }) {
      const { token, teamId } = await resolveAuth(profileId);
      const projectsData = await fetchJson(withTeam(`${VERCEL_ENDPOINTS.projects}?limit=100`, teamId), token);
      const projects = Array.isArray(projectsData) ? projectsData : (projectsData.projects || []);
      const failures = [];
      const deploymentResults = await Promise.all(projects.map(async project => {
        try {
          const path = withTeam(`${VERCEL_ENDPOINTS.deployments}?projectId=${encodeURIComponent(project.id)}&limit=10`, teamId);
          const data = await fetchJson(path, token);
          return { projectId: project.id, deployments: data.deployments || [] };
        } catch (error) {
          failures.push({ projectId: project.id, message: error.message });
          return { projectId: project.id, deployments: [] };
        }
      }));
      const deploymentsByProject = new Map(deploymentResults.map(result => [result.projectId, result.deployments]));
      const sourceId = `vercel:team:${teamId || 'personal'}`;
      const source = { id: sourceId, type: 'vercel_inventory', provider: 'vercel', teamId: teamId || '', name: teamId || 'Personal account', readOnly: true };
      const scope = { id: `vercel:${teamId || 'personal'}`, provider: 'vercel', profileId, teamId: teamId || '', region: 'global' };
      const nodes = projects.map(project => {
        const deployments = deploymentsByProject.get(project.id) || [];
        const region = project.serverlessFunctionRegion || project.resourceConfig?.functionDefaultRegions?.[0] || 'global';
        return {
          id: stableNodeId({ provider: 'vercel', scopeId: teamId || 'personal', location: region, resourceType: 'vercel-project', nativeId: project.id }),
          name: project.name || project.id,
          provider: 'vercel',
          accountId: teamId || 'personal',
          region,
          resourceType: 'vercel-project',
          // Keep kind canonical so discoveryIdentityKeys correlates this node with the APM projection.
          kind: 'vercel-project',
          nativeId: project.id,
          discoveryKey: project.id,
          sourceId,
          framework: project.framework || null,
          paused: !!project.paused,
          link: project.link ? { type: project.link.type, repo: project.link.repo || project.link.projectName } : null,
          deployments: deployments.slice(0, 10).map(deployment => ({ id: deployment.uid, name: deployment.name, url: deployment.url, state: deployment.readyState, target: deployment.target, createdAt: deployment.createdAt })),
          latestDeployment: deployments[0] ? { id: deployments[0].uid, url: deployments[0].url, state: deployments[0].readyState, target: deployments[0].target } : null,
          manual: false,
          evidence: [{ type: 'vercel_inventory', sourceId, values: [project.id, project.name, ...deployments.slice(0, 3).map(deployment => deployment.uid)] }],
        };
      });
      return { scope, sources: [source], nodes, relationships: [], failures, estimate: { requests: 1 + projects.length, projects: projects.length, deployments: deploymentResults.reduce((sum, item) => sum + item.deployments.length, 0) } };
    },
  };
}

module.exports = { createVercelDiscoveryReader };

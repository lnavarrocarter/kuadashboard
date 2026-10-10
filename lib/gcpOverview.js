'use strict';
// Overview summary with three separate answers (GCP UX audit G05):
//   - resourceHealth: incidents in the resources KUA could read (declared
//     states, not end-to-end checks). A read error is never an incident.
//   - coverage: how many services were evaluated and why the rest were not.
//   - recommendations live in the advisor, not here.

function summarizeOverview(services = []) {
  const available = services.filter(service => service.status !== 'unavailable');
  const unavailable = services.filter(service => service.status === 'unavailable');
  const critical = services.reduce((sum, service) => sum + (service.critical || 0), 0);
  const warning = services.reduce((sum, service) => sum + (service.warning || 0), 0);
  const causes = {};
  for (const service of unavailable) {
    const kind = service.error?.kind || 'unknown';
    causes[kind] = (causes[kind] || 0) + 1;
  }
  const resourceHealth = critical ? 'critical' : warning ? 'warning' : 'healthy';
  return {
    total: services.reduce((sum, service) => sum + (service.count || 0), 0),
    active: services.reduce((sum, service) => sum + (service.active || 0), 0),
    inactive: services.reduce((sum, service) => sum + (service.inactive || 0), 0),
    empty: available.filter(service => service.status === 'empty').length,
    unavailable: unavailable.length,
    critical,
    warning,
    incidents: critical + warning,
    // Kept for older readers: attention now counts incidents only.
    attention: critical + warning,
    health: resourceHealth,
    resourceHealth,
    coverage: {
      evaluated: available.length,
      total: services.length,
      notEvaluated: unavailable.length,
      percent: services.length ? Math.round((available.length / services.length) * 100) : 0,
      causes,
    },
    services: services.length,
    availableServices: available.length,
  };
}

module.exports = { summarizeOverview };

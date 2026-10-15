'use strict';
/**
 * lib/agentPlanGuard.js
 * AI agents use KUA through MCP (lib/mcp/kuaMcp.mjs), which marks every request
 * with X-KUA-Actor: mcp. That use is part of the Pro and Team plans (lib/plans.js
 * `agents`): on Free the request is refused with PLAN_REQUIRED, which the MCP
 * server turns into a message for the user. The user can also turn agents off
 * on this computer (lib/kua/agentAccess.js): then every agent request is refused
 * with AGENTS_DISABLED. The UI itself is never affected.
 */

const { getPlan } = require('./plans');

// Discovery stays open so the MCP server can find KUA and report the plan.
const OPEN_PATHS = new Set(['/api/health', '/api/system/plan']);

function createAgentPlanGuard({ plan = getPlan, agentAccess = null } = {}) {
  return function agentPlanGuard(req, res, next) {
    if (String(req.get?.('X-KUA-Actor') || req.headers?.['x-kua-actor'] || '').toLowerCase() !== 'mcp') return next();
    const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
    agentAccess?.recordRequest();
    if (OPEN_PATHS.has(pathname)) return next();
    if (agentAccess && !agentAccess.enabled()) {
      return res.status(403).json({
        error: 'AI agent access (MCP) is turned off in KUA on this computer',
        code: 'AGENTS_DISABLED',
      });
    }
    if (plan().features.agents) return next();
    return res.status(403).json({
      error: 'Using KUA from an AI agent (MCP) is part of the Pro and Team plans',
      code: 'PLAN_REQUIRED',
      required: 'pro',
      feature: 'agents',
    });
  };
}

module.exports = { createAgentPlanGuard };

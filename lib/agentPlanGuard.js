'use strict';
/**
 * lib/agentPlanGuard.js
 * AI agents use KUA through MCP (lib/mcp/kuaMcp.mjs), which marks every request
 * with X-KUA-Actor: mcp. That use is part of the Pro and Team plans (lib/plans.js
 * `agents`): on Free the request is refused with PLAN_REQUIRED, which the MCP
 * server turns into a message for the user. The UI itself is never affected.
 */

const { getPlan } = require('./plans');

// Discovery stays open so the MCP server can find KUA and report the plan.
const OPEN_PATHS = new Set(['/api/health', '/api/system/plan']);

function createAgentPlanGuard({ plan = getPlan } = {}) {
  return function agentPlanGuard(req, res, next) {
    if (String(req.get?.('X-KUA-Actor') || req.headers?.['x-kua-actor'] || '').toLowerCase() !== 'mcp') return next();
    const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
    if (OPEN_PATHS.has(pathname) || plan().features.agents) return next();
    return res.status(403).json({
      error: 'Using KUA from an AI agent (MCP) is part of the Pro and Team plans',
      code: 'PLAN_REQUIRED',
      required: 'pro',
      feature: 'agents',
    });
  };
}

module.exports = { createAgentPlanGuard };

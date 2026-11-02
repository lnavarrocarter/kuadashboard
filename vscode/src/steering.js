'use strict';
/**
 * vscode/src/steering.js
 * KUA's steering file for Kiro (#214): `.kiro/steering/kua.md` in a workspace, so Kiro's agent
 * knows how to work with KUA, not only its tools. Its text is the `kua` skill of the Claude Code
 * plugin (plugins/kua/skills/kua/SKILL.md), turned into a steering file by esbuild.mjs into
 * dist/kua-steering.md, so both agents get the same rules.
 */

const STEERING_PATH = ['.kiro', 'steering', 'kua.md'];
const STEERING_FILE = 'kua-steering.md';

/** The skill without its front matter, naming the tools as Kiro shows them, always included. */
function steeringFrom(skill) {
  const body = String(skill).replace(/^---\n[\s\S]*?\n---\n+/, '');
  if (body === String(skill)) throw new Error('The kua skill has no front matter.');
  return [
    '---',
    'inclusion: always',
    '---',
    '',
    '<!-- Added by the KUA extension from KUA\'s own skill. Edit it freely: the extension asks before replacing it. -->',
    '',
    body.replace('Its MCP tools (`mcp__plugin_kua_kua__*`)', 'The tools of its `kua` MCP server').trimEnd(),
    '',
  ].join('\n');
}

/** 'create' (no file), 'same' (already this text) or 'different' (the user's own, or an older one). */
function steeringChange(current, next) {
  if (current === null || current === undefined) return 'create';
  return current === next ? 'same' : 'different';
}

module.exports = { STEERING_FILE, STEERING_PATH, steeringChange, steeringFrom };

'use strict';
/**
 * vscode/src/mcpJson.js
 * Adds the KUA server to a workspace `.vscode/mcp.json` (#302), for editors that read that file
 * but not the extension API. The rest of the file (other servers, inputs, comments) is kept.
 */

const { applyEdits, modify, parse } = require('jsonc-parser');

const NAME = 'kua';

class McpJsonError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** The new text of mcp.json with servers.kua set to this launch. `text` may be empty or missing. */
function withKuaServer(text, launch) {
  const source = String(text || '').trim() ? String(text) : '{}';
  const errors = [];
  const current = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !current || typeof current !== 'object' || Array.isArray(current)) {
    throw new McpJsonError('.vscode/mcp.json is not valid JSON; fix it first so nothing in it is lost.', 'INVALID_JSON');
  }
  if (current.servers !== undefined && (typeof current.servers !== 'object' || Array.isArray(current.servers))) {
    throw new McpJsonError('"servers" in .vscode/mcp.json is not an object.', 'INVALID_JSON');
  }
  const server = {
    type: 'stdio',
    command: launch.command,
    args: launch.args || [],
    ...(launch.env && Object.keys(launch.env).length ? { env: launch.env } : {}),
  };
  const edits = modify(source, ['servers', NAME], server, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  const result = applyEdits(source, edits);
  return result.endsWith('\n') ? result : `${result}\n`;
}

module.exports = { McpJsonError, withKuaServer };

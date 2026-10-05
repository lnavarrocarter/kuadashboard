/**
 * Ready-to-paste setup of the KUA MCP server for each client, from the launch
 * description served by GET /api/system/mcp ({ command, args, env }).
 */

const NAME = 'kua'

/**
 * Shell argument, double-quoted when it has spaces. The backend sends Windows
 * paths with forward slashes (lib/mcp/launch.js): unquoted, bash drops
 * backslashes, and C:\Users\me\… arrived as C:Usersme… (#133).
 */
function quote(value) {
  const text = String(value)
  return /\s/.test(text) ? `"${text}"` : text
}

function envPairs(env = {}) {
  return Object.entries(env)
}

export function claudeCommand({ command, args = [], env }) {
  const flags = envPairs(env).map(([key, value]) => `-e ${key}=${quote(value)}`)
  return ['claude mcp add', NAME, '--scope user', ...flags, '--', quote(command), ...args.map(quote)].join(' ')
}

export function codexCommand({ command, args = [], env }) {
  const flags = envPairs(env).map(([key, value]) => `--env ${key}=${quote(value)}`)
  return ['codex mcp add', NAME, ...flags, '--', quote(command), ...args.map(quote)].join(' ')
}

/** .mcp.json (Claude Code project), Cursor, VS Code and most JSON-configured clients. */
export function jsonConfig({ command, args = [], env }) {
  const server = { command, args, ...(envPairs(env).length ? { env } : {}) }
  return JSON.stringify({ mcpServers: { [NAME]: server } }, null, 2)
}

/** ~/.codex/config.toml. JSON strings are valid TOML basic strings. */
export function codexToml({ command, args = [], env }) {
  const lines = [
    `[mcp_servers.${NAME}]`,
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map(arg => JSON.stringify(arg)).join(', ')}]`,
  ]
  const pairs = envPairs(env)
  if (pairs.length) lines.push(`env = { ${pairs.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(', ')} }`)
  return lines.join('\n')
}

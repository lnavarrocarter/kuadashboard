'use strict';
/**
 * lib/mcp/clientSetup.js
 * The two actions of "Connect AI agents (MCP)" that do more than copy text:
 *
 *   verify   starts the MCP server exactly as a client would (mcpLaunch),
 *            runs initialize + tools/list + list_profiles, and says what
 *            failed in words (not "Connection closed").
 *   install  runs `claude mcp add` / `codex mcp add` for the user, replacing
 *            a previous "kua" entry, so nothing has to be pasted in a shell.
 *            Claude Code gets the KUA plugin instead (#305): MCP server and
 *            skill, from the local marketplace KUA keeps in
 *            ~/.kuadashboard/claude-plugin (lib/mcp/claudePlugin.js), so
 *            nothing is downloaded. A Claude Code without plugins falls back
 *            to `claude mcp add`.
 *
 * Both only start local processes on this computer; no cloud call.
 */

const { spawn } = require('node:child_process');

const NAME = 'kua';
const CLIENTS = { claude: 'claude', codex: 'codex' };

class SetupError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/**
 * Starts the MCP server and talks JSON-RPC to it over stdio.
 * @returns {{ ok, tools, kua, profiles, error?, stderr? }}
 */
function verifyMcp({ launch, spawnImpl = spawn, timeoutMs = 20000, env = process.env } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl(launch.command, launch.args, { env: { ...env, ...launch.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      resolve({ ok: false, error: `The MCP server could not start: ${err.message}` });
      return;
    }
    const waiting = new Map();
    let buffer = '';
    let stderr = '';
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* closed */ }
      try { child.kill(); } catch { /* exited */ }
      resolve({ ...result, ...(result.ok ? {} : { stderr: stderr.trim().slice(-800) }) });
    };
    const timer = setTimeout(() => finish({ ok: false, error: `The MCP server did not answer in ${Math.round(timeoutMs / 1000)} s.` }), timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message = null;
        try { message = JSON.parse(line); } catch { continue; }
        const done = waiting.get(message.id);
        if (done) { waiting.delete(message.id); done(message); }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => finish({ ok: false, error: err.code === 'ENOENT' ? `"${launch.command}" was not found on this computer.` : `The MCP server could not start: ${err.message}` }));
    // 'close' waits for stdout, so an answer written just before exiting is still read.
    child.on('close', code => finish({ ok: false, error: `The MCP server stopped (exit code ${code}) before answering.` }));

    let nextId = 1;
    const call = (method, params) => new Promise(answer => {
      const id = nextId++;
      waiting.set(id, answer);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

    (async () => {
      const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kua-verify', version: '1' } });
      if (init.error) return finish({ ok: false, error: `initialize failed: ${init.error.message}` });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const kua = init.result?._meta?.kua || null;
      const list = await call('tools/list', {});
      if (list.error) return finish({ ok: false, kua, error: `tools/list failed: ${list.error.message}` });
      const tools = (list.result?.tools || []).length;
      const profiles = await call('tools/call', { name: 'list_profiles', arguments: {} });
      if (profiles.result?.isError) return finish({ ok: false, kua, tools, error: profiles.result.content?.[0]?.text || 'list_profiles failed' });
      let count = null;
      try { count = JSON.parse(profiles.result?.content?.[0]?.text || '[]').length; } catch { /* not JSON */ }
      finish({ ok: true, kua, tools, profiles: count });
    })().catch(err => finish({ ok: false, error: err.message }));
  });
}

/**
 * argv of `claude` to install the KUA plugin from the local marketplace in `pluginDir`: the old
 * "kua" MCP entry goes away (the plugin brings the same server, so tools would show twice), the
 * marketplace is added or repointed to this folder, and the plugin is installed at user scope.
 * Both commands succeed when they were already done.
 */
function pluginInstallSteps(pluginDir) {
  const { MARKETPLACE, PLUGIN } = require('./claudePlugin');
  return [
    { args: ['mcp', 'remove', NAME, '--scope', 'user'], optional: true },
    { args: ['plugin', 'marketplace', 'add', pluginDir] },
    { args: ['plugin', 'install', `${PLUGIN}@${MARKETPLACE}`, '--scope', 'user'] },
  ];
}

/** argv of the client CLI: remove a previous entry, then add this one. */
function installSteps(client, { command, args = [], env = {} }) {
  const pairs = Object.entries(env);
  if (client === 'claude') {
    return [
      { args: ['mcp', 'remove', NAME, '--scope', 'user'], optional: true },
      { args: ['mcp', 'add', NAME, '--scope', 'user', ...pairs.flatMap(([key, value]) => ['-e', `${key}=${value}`]), '--', command, ...args] },
    ];
  }
  if (client === 'codex') {
    return [
      { args: ['mcp', 'remove', NAME], optional: true },
      { args: ['mcp', 'add', NAME, ...pairs.flatMap(([key, value]) => ['--env', `${key}=${value}`]), '--', command, ...args] },
    ];
  }
  throw new SetupError(`Unknown client "${client}".`, 'UNKNOWN_CLIENT');
}

/**
 * cmd.exe argument: always double-quoted. Quotes and % would change the
 * command, so such values are refused instead of escaped.
 */
function cmdArg(value) {
  const text = String(value);
  if (/["%\r\n]/.test(text)) throw new SetupError(`Cannot pass ${JSON.stringify(text)} to the command line safely.`, 'UNSAFE_ARGUMENT');
  return `"${text}"`;
}

function exec(spawnImpl, command, args, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { windowsHide: true, ...options });
    let output = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* exited */ } reject(new SetupError(`${command} did not finish in ${timeoutMs / 1000} s.`, 'TIMEOUT')); }, timeoutMs);
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output: String(output).trim() }); });
  });
}

/**
 * Runs a client CLI. On Windows through cmd.exe, which finds both claude.exe
 * (native install) and claude.cmd (npm install). The program name stays
 * unquoted: a quoted batch file resolves %~dp0 against the current folder
 * and the npm shim fails. It is a fixed name (claude, codex), never input.
 */
async function runCli(program, args, { spawnImpl = spawn, platform = process.platform, timeoutMs = 60000 } = {}) {
  if (!/^[\w.-]+$/.test(program)) throw new SetupError(`Unexpected program name ${JSON.stringify(program)}.`, 'UNSAFE_ARGUMENT');
  const notFound = () => new SetupError(`${program} is not installed or not in PATH.`, 'CLI_NOT_FOUND');
  if (platform === 'win32') {
    // `where` answers by exit code, whatever the language of Windows.
    const found = await exec(spawnImpl, 'where', [program], {}, 10000).catch(() => ({ code: 1 }));
    if (found.code !== 0) throw notFound();
    return exec(spawnImpl, [program, ...args.map(cmdArg)].join(' '), [], { shell: true }, timeoutMs);
  }
  return exec(spawnImpl, program, args, {}, timeoutMs).catch(err => { throw err.code === 'ENOENT' ? notFound() : err; });
}

async function runSteps(program, steps, run, label) {
  let last = null;
  for (const step of steps) {
    last = await run(program, step.args);
    if (last.code !== 0 && !step.optional) throw new SetupError(`${program} ${label} failed: ${last.output.slice(-500) || `exit code ${last.code}`}`, 'INSTALL_FAILED');
  }
  return last;
}

/**
 * Adds KUA to Claude Code or Codex (user scope). With `pluginDir`, Claude Code gets the KUA plugin
 * (`mode: 'plugin'`); if its CLI cannot install plugins, the MCP server alone (`mode: 'mcp'`).
 */
async function installMcp({ client, launch, pluginDir = null, run = runCli }) {
  const program = CLIENTS[client];
  if (!program) throw new SetupError(`Unknown client "${client}".`, 'UNKNOWN_CLIENT');
  if (client === 'claude' && pluginDir) {
    try {
      const last = await runSteps(program, pluginInstallSteps(pluginDir), run, 'plugin install');
      return { client, name: NAME, mode: 'plugin', output: last?.output || '' };
    } catch (err) {
      if (err.code !== 'INSTALL_FAILED') throw err;
      // An older Claude Code without plugins: the MCP server still works without the skill.
    }
  }
  const last = await runSteps(program, installSteps(client, launch), run, 'mcp add');
  return { client, name: NAME, mode: 'mcp', output: last?.output || '' };
}

module.exports = { verifyMcp, installMcp, installSteps, pluginInstallSteps, runCli, cmdArg, SetupError };

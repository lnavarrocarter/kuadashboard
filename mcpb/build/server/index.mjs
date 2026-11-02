#!/usr/bin/env node
/**
 * plugins/kua/server/launcher.mjs
 * Starts the MCP server of the KUA installed on this computer, for the Claude Code plugin (#305)
 * and the Claude Desktop extension (mcpb/, #306), which ships this same file.
 *
 * The plugin is installed as a copy of its own folder, so it cannot know where KUA lives. Every
 * KUA that starts writes how to launch its MCP server to ~/.kuadashboard/run/mcp-launch.json
 * (lib/mcp/runtime.js recordLaunch), and the file stays when KUA stops. This launcher runs that
 * command with stdio passed through, so the server and KUA always have the same version.
 *
 * With no record (KUA never opened here) it answers the MCP protocol itself, with no tools and an
 * instruction to install and open KuaDashboard, instead of the client showing "Connection closed".
 *
 * No dependencies: only Node's own modules.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export const NOT_INSTALLED = 'KUA has not run on this computer yet, so there is no KUA MCP server to start. Install KuaDashboard (https://lnavarrocarter.github.io/kuadashboard/download), open it once, then restart this session.'

/** Same folder as lib/mcp/runtime.js runDir(). */
export function runDir(env = process.env) {
  return env.KUA_RUN_DIR || join(homedir(), '.kuadashboard', 'run')
}

/** The recorded launch, or null when there is none or its program is gone (KUA uninstalled). */
export function readLaunch({ dir = runDir(), exists = existsSync, read = file => readFileSync(file, 'utf8') } = {}) {
  let record
  try { record = JSON.parse(read(join(dir, 'mcp-launch.json'))) } catch { return null }
  if (!record?.command || !Array.isArray(record.args)) return null
  if (isAbsolute(record.command) && !exists(record.command)) return null
  return record
}

/**
 * The environment for KUA's server. An optional KUA_URL left empty, or passed as an unfilled
 * placeholder such as "${user_config.kua_url}" (Claude Desktop extension, #306), is dropped so
 * the server finds the running KUA by itself.
 */
export function serverEnv(base, extra = {}) {
  const env = { ...base, ...extra }
  if (!env.KUA_URL || /\$\{/.test(env.KUA_URL)) delete env.KUA_URL
  return env
}

/** The answer to one JSON-RPC message when there is no KUA to start (null for notifications). */
export function answerWithoutKua(message) {
  if (!message || message.id === undefined || message.id === null) return null
  const ok = result => ({ jsonrpc: '2.0', id: message.id, result })
  switch (message.method) {
    case 'initialize':
      return ok({
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'kua', title: 'KUA (Know Unified Administration)', version: '0.0.0' },
        instructions: NOT_INSTALLED,
      })
    case 'tools/list': return ok({ tools: [] })
    case 'ping': return ok({})
    default: return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: NOT_INSTALLED } }
  }
}

function serveWithoutKua() {
  process.stderr.write(`kua-mcp: ${NOT_INSTALLED}\n`)
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', line => {
    if (!line.trim()) return
    let message = null
    try { message = JSON.parse(line) } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
      return
    }
    const answer = answerWithoutKua(message)
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`)
  })
}

function main() {
  const launch = readLaunch()
  if (!launch) return serveWithoutKua()
  const child = spawn(launch.command, launch.args, {
    stdio: 'inherit',
    env: serverEnv(process.env, launch.env || {}),
    windowsHide: true,
  })
  child.on('error', error => {
    process.stderr.write(`kua-mcp: could not start ${launch.command}: ${error.message}\n`)
    serveWithoutKua()
  })
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 0) })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()

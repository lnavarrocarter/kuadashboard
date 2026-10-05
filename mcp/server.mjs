#!/usr/bin/env node
/**
 * mcp/server.mjs
 * KUA MCP server over stdio (newline-delimited JSON-RPC), for Claude Code,
 * Codex CLI and any other MCP client. KuaDashboard must be running: the
 * server reads it through its local API.
 *
 *   KUA_URL   where KUA runs. Optional: without it the server finds the
 *             running KUA (lib/mcp/runtime.js), whatever its port.
 *
 * stdout carries protocol messages only; diagnostics go to stderr.
 */

import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { createKuaMcp, httpRequest } from '../lib/mcp/kuaMcp.mjs'
import runtime from '../lib/mcp/runtime.js'
// The installed app runs this from app.asar.unpacked, next to (not inside) app.asar.
function readVersion() {
  for (const candidate of ['../package.json', '../../app.asar/package.json']) {
    try { return JSON.parse(readFileSync(new URL(candidate, import.meta.url), 'utf8')).version } catch { /* try the next one */ }
  }
  return '0.0.0'
}
const version = readVersion()

// The KUA to read, found once and again when it stops answering (closed, or reopened on another port).
let located = null
function locate({ fresh = false } = {}) {
  if (!located || fresh) located = runtime.resolveKua()
  return located
}

async function request(path, options) {
  const kua = await locate()
  try {
    return await httpRequest(kua.url)(path, options)
  } catch (err) {
    if (!err.unreachable || kua.source === 'env') throw err
    const again = await locate({ fresh: true })
    if (!again.reachable) throw err
    return httpRequest(again.url)(path, options)
  }
}

const server = createKuaMcp({ request, version, locate })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function receive(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  try {
    const response = await server.handle(message)
    if (response) send(response)
  } catch (err) {
    process.stderr.write(`kua-mcp: ${err.stack || err}\n`)
    if (message && 'id' in message) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error' } })
  }
}

// Requests run concurrently; on close, answer the pending ones before exiting.
const pending = new Set()
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', line => {
  if (!line.trim()) return
  const task = receive(line).finally(() => pending.delete(task))
  pending.add(task)
})
lines.on('close', async () => {
  await Promise.allSettled([...pending])
  process.exit(0)
})

// Diagnostics for the client's log; initialize carries the same note for the agent.
locate().then(kua => {
  if (!kua.reachable) process.stderr.write(`kua-mcp ${version}: KUA is not answering at ${kua.url}. Open KuaDashboard${kua.source === 'env' ? ', or check KUA_URL' : ''}.\n`)
  else process.stderr.write(`kua-mcp ${version}: reading KUA ${kua.version || ''} at ${kua.url} (${kua.source})${kua.version && kua.version !== version ? ` — this server is ${version}, restart the agent session after updating KUA` : ''}\n`)
})

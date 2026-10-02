#!/usr/bin/env node
/**
 * mcp/server.mjs
 * KUA MCP server over stdio (newline-delimited JSON-RPC), for Claude Code,
 * Codex CLI and any other MCP client. KuaDashboard must be running: the
 * server reads it through its local API.
 *
 *   KUA_URL   where KUA runs (default http://localhost:7190)
 *
 * stdout carries protocol messages only; diagnostics go to stderr.
 */

import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { createKuaMcp, httpRequest } from '../lib/mcp/kuaMcp.mjs'

const baseUrl = process.env.KUA_URL || 'http://localhost:7190'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const server = createKuaMcp({ request: httpRequest(baseUrl), version })

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

process.stderr.write(`kua-mcp ${version}: reading KUA at ${baseUrl}\n`)

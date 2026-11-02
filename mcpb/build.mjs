// Builds dist/kua.mcpb, the Claude Desktop extension of KUA (#306): this manifest with KUA's
// version, the icon, and the launcher of the Claude Code plugin (plugins/kua/server/launcher.mjs)
// as the server, so both start the MCP server of the KUA installed on the computer.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const stage = join(here, 'build')
const out = join(here, 'dist', 'kua.mcpb')

export function manifestFor(template, version) {
  return { ...template, version }
}

export function build() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const template = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(join(stage, 'server'), { recursive: true })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifestFor(template, version), null, 2)}\n`)
  copyFileSync(join(root, 'plugins', 'kua', 'server', 'launcher.mjs'), join(stage, 'server', 'index.mjs'))
  copyFileSync(join(root, 'assets', 'icon.png'), join(stage, 'icon.png'))
  const mcpb = join(here, 'node_modules', '.bin', process.platform === 'win32' ? 'mcpb.cmd' : 'mcpb')
  execFileSync(mcpb, ['validate', join(stage, 'manifest.json')], { stdio: 'inherit', shell: process.platform === 'win32' })
  execFileSync(mcpb, ['pack', stage, out], { stdio: 'inherit', shell: process.platform === 'win32' })
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) build()

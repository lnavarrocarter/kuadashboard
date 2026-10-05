import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { icons as allIcons } from 'lucide'
import { icons } from '../lib/lucideIcons.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pascal = name => name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())

function sources(dir = SRC, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'tests') sources(full, files) }
    else if (/\.(vue|js|mjs)$/.test(entry.name)) files.push(full)
  }
  return files
}

describe('lucide icon subset', () => {
  // Every quoted token that names a lucide icon (data-lucide="…", icon maps,
  // ternaries) must be in the build's subset, or it renders as an empty <i>.
  it('lists every icon named in the sources', () => {
    const missing = new Set()
    for (const file of sources()) {
      for (const [, , token] of fs.readFileSync(file, 'utf8').matchAll(/(['"`])([a-z0-9][a-z0-9-]*)\1/g)) {
        const name = pascal(token)
        if (allIcons[name] && !icons[name]) missing.add(`${name} (${path.relative(SRC, file)})`)
      }
    }
    expect([...missing], 'add them to src/lib/lucideIcons.js').toEqual([])
  })

  it('holds real lucide icons only', () => {
    // Tests load lucide's CommonJS build and the subset its ES modules: same icons, other objects.
    for (const [name, node] of Object.entries(icons)) expect(node, name).toEqual(allIcons[name])
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIONS, invalidatesFor } from '../lib/actionCatalog'

const SRC = join(__dirname, '..')
const sources = dir => readdirSync(dir).flatMap(name => {
  const file = join(dir, name)
  if (statSync(file).isDirectory()) return name === 'tests' ? [] : sources(file)
  return /\.(js|vue)$/.test(name) ? [file] : []
})

describe('action catalog in the UI (#329)', () => {
  it('every write the UI sends through a task coordinator is a catalogued action', () => {
    const used = new Set()
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\.write\('([^']+)'/g)) used.add(match[1])
      // KUAppMissingResources passes the key to its run() helper.
      for (const match of text.matchAll(/\brun\(\s*'([a-z-]+\.[a-z.-]+)'/g)) used.add(match[1])
    }
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter(key => !ACTIONS[key])).toEqual([])
  })

  it('reads what an action invalidates, and nothing for an unknown one', () => {
    expect(invalidatesFor('edge.confirm-batch')).toEqual(['topology', 'registry', 'kuapps.registry'])
    expect(invalidatesFor('missing-resource.ignore')).toEqual(['kuapps.missing'])
    expect(invalidatesFor('not.an-action')).toEqual([])
  })
})

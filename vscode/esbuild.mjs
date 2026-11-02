// Bundles the extension (src/extension.js and the KUA modules it reuses from lib/mcp) into
// dist/extension.js. `vscode` is provided by the editor.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import en from '../frontend/src/locales/en.js'
import es from '../frontend/src/locales/es.js'

const require = createRequire(import.meta.url)
const { TEXT_PREFIXES } = require('./src/texts.js')
const { STEERING_FILE, steeringFrom } = require('./src/steering.js')

await build({
  entryPoints: ['src/extension.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  // jsonc-parser's main is UMD with dynamic requires that a bundle cannot follow; its ESM build bundles.
  mainFields: ['module', 'main'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  logLevel: 'info',
})

// The Marketplace needs the icon and the license inside the extension folder.
mkdirSync('media', { recursive: true })
copyFileSync('../assets/icon.png', 'media/icon.png')

// KUA's own texts for applications, issues and the Advisor (src/texts.js), so the editor says
// the same as KUA without shipping all of its locales.
const pick = locale => Object.fromEntries(Object.entries(locale).filter(([key]) => TEXT_PREFIXES.some(prefix => key.startsWith(prefix))))
writeFileSync('dist/texts.json', JSON.stringify({ en: pick(en), es: pick(es) }))

// Kiro's steering file (src/steering.js), from the kua skill of the Claude Code plugin.
writeFileSync(`dist/${STEERING_FILE}`, steeringFrom(readFileSync('../plugins/kua/skills/kua/SKILL.md', 'utf8')))

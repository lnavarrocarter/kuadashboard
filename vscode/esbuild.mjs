// Bundles the extension (src/extension.js and the KUA modules it reuses from lib/mcp) into
// dist/extension.js. `vscode` is provided by the editor.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

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

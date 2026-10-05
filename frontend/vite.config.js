import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue(process.env.VITEST ? {
    // Tests only: keep absolute public URLs such as <use href="/icons.svg#x"> as plain
    // strings. As imports they resolve to "file:///icons.svg", which is not a valid
    // path on Windows. Builds keep the default so Electron (base './') gets rebased URLs.
    template: { transformAssetUrls: { includeAbsolute: false } },
  } : {})],
  // 'lucide' resolves to the icons KUA draws (src/lib/lucideIcons.js). Tests keep
  // the real package, which several of them mock with vi.mock('lucide').
  resolve: {
    alias: process.env.VITEST ? [] : [{ find: /^lucide$/, replacement: fileURLToPath(new URL('./src/lib/lucideIcons.js', import.meta.url)) }],
  },
  // Development: the section views load on demand, so Vite would only discover
  // their dependencies (vue-flow, chart.js…) when one opens, re-bundle them and
  // break the imports of the window already open. Scanning every component at
  // start bundles them all up front.
  optimizeDeps: { entries: ['index.html', 'src/**/*.vue'] },
  // In Electron production build, assets must use relative paths
  base: process.env.ELECTRON_BUILD ? './' : '/',
  build: {
    // Output to the Express static folder so `node server.js` serves the built frontend
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 7193,
    strictPort: true,
    proxy: {
      '/api/console': { target: `http://localhost:${process.env.VITE_BACKEND_PORT || 7190}`, changeOrigin: false },
      '/api': { target: `http://localhost:${process.env.VITE_BACKEND_PORT || 7190}`, changeOrigin: true },
      '/ws':  { target: `ws://localhost:${process.env.VITE_BACKEND_PORT || 7190}`,   ws: true, changeOrigin: true },
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js',
  }
})

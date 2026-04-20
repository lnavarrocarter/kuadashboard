import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // In Electron production build, assets must use relative paths
  base: process.env.ELECTRON_BUILD ? './' : '/',
  build: {
    // Output to the Express static folder so `node server.js` serves the built frontend
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:3000',   ws: true, changeOrigin: true },
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js',
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard is served by the Vite dev server in development and by the
// FastAPI process in production (frontend/dist is mounted at "/"), so every
// request to the API uses a relative path and is proxied to the backend here.
const API_TARGET = process.env.ARBIBOT_API ?? 'http://127.0.0.1:8000'

// GitHub Pages and other sub-path hosts set ARBIBOT_BASE=/<repo>/ at build time.
const BASE = process.env.ARBIBOT_BASE ?? '/'

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Sandboxed previews proxy the app under a generated hostname.
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})

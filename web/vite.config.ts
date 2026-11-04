/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
// contracts/ lives one level up (repo root); in docker-compose it is mounted at /contracts, which is also one level up from /app.
// VITE_PORT moves the dev server off 5173; VITE_API_PROXY (e.g. http://localhost:18100) proxies /api to that API, so
// run with VITE_API_URL=/api/v1 and no CORS change is needed. Both unset = the compose defaults.
const port = Number(process.env.VITE_PORT ?? 5173)
const proxy = process.env.VITE_API_PROXY ? { '/api': { target: process.env.VITE_API_PROXY, changeOrigin: true } } : undefined
export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true, host: true, fs: { allow: ['..'] }, proxy },
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@contracts': path.resolve(__dirname, '../contracts') } },
  // The full suite loads lazy pages under heavy parallel load; 5 s (the default) timed out at random. 30 s per test.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
})

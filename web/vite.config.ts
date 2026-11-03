import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
// contracts/ lives one level up (repo root); in docker-compose it is mounted at /contracts, which is also one level up from /app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@contracts': path.resolve(__dirname, '../contracts') } },
})

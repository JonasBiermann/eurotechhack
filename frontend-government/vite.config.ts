import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Government site. Proxies /api to the shared FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})

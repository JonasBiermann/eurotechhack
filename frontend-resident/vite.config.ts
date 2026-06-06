import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Resident site. Proxies /api to the shared FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})

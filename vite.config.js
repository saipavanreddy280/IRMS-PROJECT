import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backendUrl = process.env.VITE_BACKEND_URL || 'http://localhost:5000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/uploads': {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
})

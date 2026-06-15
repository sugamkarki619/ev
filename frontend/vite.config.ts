import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
    },
    allowedHosts: ['.ngrok-free.dev'],
    // --- ADD THIS PROXY BLOCK ---
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        secure: false,
      },
      '/route': {
        target: 'http://valhalla:8002',
        changeOrigin: true,
        secure: false,
      }
    }
    // ----------------------------
  },
})

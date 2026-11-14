import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3210',
        ws: true,
      },
      '/api/v1': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3210',
        changeOrigin: true,
      },
    },
  },
})

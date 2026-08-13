import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = env.PORT || 5173
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:5001'

  return {
    plugins: [react(), tailwindcss()],
    build: {
      chunkSizeWarningLimit: 1100,
    },
    server: {
      port: Number(port),
      host: '127.0.0.1', // dev-only; never bind to 0.0.0.0 (LAN exposure)
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/uploads': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/socket.io': {
          target: backendUrl,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})

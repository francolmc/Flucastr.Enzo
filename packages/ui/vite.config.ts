import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const uiPort = Number(env.VITE_UI_PORT || 5173)
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:3001'

  return {
    plugins: [react()],
    server: {
      port: uiPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/ollama-chat-completions': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: () => '/v1/chat/completions',
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pwaPlugin } from './scripts/pwa-plugin.js'

export default defineConfig({
  plugins: [react(), pwaPlugin()],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas grandes e estáveis em chunks próprios: ficam em cache entre deploys (o hash
        // só muda quando a biblioteca muda) e só os chunks de boot entram no precache do SW
        // (scripts/pwa-plugin.js). charts/markdown só são importados por telas lazy.
        manualChunks: {
          charts: ['recharts'],
          primer: ['@primer/react', 'styled-components'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
        },
      },
    },
  },
})

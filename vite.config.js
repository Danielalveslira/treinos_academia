import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pwaPlugin } from './scripts/pwa-plugin.js'

export default defineConfig({
  plugins: [react(), pwaPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          charts: ['recharts'],
          primer: ['@primer/react', 'styled-components'],
        },
      },
    },
  },
})

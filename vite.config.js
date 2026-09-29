import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pwaPlugin } from './scripts/pwa-plugin.js'
import { localExerciseCatalogImagesPlugin } from './scripts/local-exercise-catalog-images-plugin.js'

export default defineConfig({
  plugins: [react(), pwaPlugin(), localExerciseCatalogImagesPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          primer: ['@primer/react', 'styled-components'],
        },
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pwaPlugin } from './scripts/pwa-plugin.js'
import { publicPreviewPlugin } from './scripts/public-preview-plugin.js'

export default defineConfig({
  plugins: [react(), pwaPlugin(), publicPreviewPlugin()],
  build: {
    rollupOptions: {
      input: { main: 'index.html', publicHomeRedirect: 'src/publicHomeRedirect.js', publicHeaderAuth: 'src/publicHeaderAuth.js', publicTurbo: 'src/publicTurbo.js', publicHeaderMenu: 'src/PublicHeaderMenu.jsx' },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'publicHomeRedirect' ? 'assets/public-home-redirect.js' :
          chunk.name === 'publicHeaderAuth' ? 'assets/public-header-auth.js' : 'assets/[name]-[hash].js',
        manualChunks: {
          charts: ['recharts'],
          primer: ['@primer/react', 'styled-components'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
        },
      },
    },
    // Keep the previous Vite 5 browser contract while upgrading the build tools.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
  },
})

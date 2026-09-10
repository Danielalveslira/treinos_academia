import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, BaseStyles } from '@primer/react'
import App from './App.jsx'
import { PwaControls } from './components/PwaControls'
import { ThemeSync } from './components/ThemeSync'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/app.css'
import './styles/navigation.css'

function getInitialColorMode() {
  try {
    return localStorage.getItem('colorMode') || 'auto'
  } catch {
    return 'auto'
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider colorMode={getInitialColorMode()} dayScheme="light" nightScheme="dark">
      <BaseStyles>
        <ThemeSync />
        <div id="app-content" style={{ display: 'contents' }}>
          <App />
        </div>
        <PwaControls />
      </BaseStyles>
    </ThemeProvider>
  </StrictMode>
)

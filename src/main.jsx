import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, BaseStyles } from '@primer/react'
import App from './App.jsx'
import { PwaControls } from './components/PwaControls'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/app.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider colorMode="auto" dayScheme="light" nightScheme="dark">
      <BaseStyles>
        <div id="app-content" style={{ display: 'contents' }}>
          <App />
        </div>
        <PwaControls />
      </BaseStyles>
    </ThemeProvider>
  </StrictMode>
)

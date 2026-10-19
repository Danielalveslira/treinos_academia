import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, BaseStyles } from '@primer/react'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import App from './App.jsx'
import { PwaControls } from './components/PwaControls'
import { ThemeSync } from './components/ThemeSync'
import { ErrorBoundary } from './components/ErrorBoundary'
import { redactAnalyticsEvent } from './utils/analyticsRedaction'
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

// Rede de segurança para erros que um Error Boundary não alcança (fora do ciclo de
// render do React: handlers de evento, callbacks assíncronos, promises sem catch).
// Só registra no console para diagnóstico — nunca tenta "corrigir" nada sozinho aqui.
window.addEventListener('error', (event) => {
  console.error('[Global] Erro não tratado:', event.error || event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Promise rejeitada sem tratamento:', event.reason)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider colorMode={getInitialColorMode()} dayScheme="light" nightScheme="dark">
      <BaseStyles>
        <ThemeSync />
        <ErrorBoundary>
          <div id="app-content" style={{ display: 'contents' }}>
            <App />
          </div>
          <PwaControls />
          <Analytics beforeSend={redactAnalyticsEvent} />
          <SpeedInsights beforeSend={redactAnalyticsEvent} />
        </ErrorBoundary>
      </BaseStyles>
    </ThemeProvider>
  </StrictMode>
)

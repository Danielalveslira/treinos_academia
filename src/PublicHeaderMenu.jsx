import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconButton, ThemeProvider } from '@primer/react'
import { PublicNavigationMenu } from './components/PublicNavigationMenu'
import { PublicThemeIcon } from './PublicThemeIcon.js'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/public-header.css'

// Mesmo estado lido por public-header.css via data-public-auth em <html> (definido por
// publicHeaderAuth.js, a partir da sessão já persistida pelo client único do app) --
// o grupo "Conta" deste menu só espelha o que o CSS já decidiu pro resto do cabeçalho,
// nunca cria outra fonte de verdade sobre quem está logado.
function usePublicAuthState() {
  const [state, setState] = useState(() => document.documentElement.dataset.publicAuth || 'guest')
  useEffect(() => {
    const update = () => setState(document.documentElement.dataset.publicAuth || 'guest')
    window.addEventListener('public-auth-change', update)
    return () => window.removeEventListener('public-auth-change', update)
  }, [])
  return state
}

function usePublicThemeMode() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.colorMode || 'light')
  useEffect(() => {
    const update = () => setMode(document.documentElement.dataset.colorMode || 'light')
    window.addEventListener('public-theme-change', update)
    return () => window.removeEventListener('public-theme-change', update)
  }, [])
  return mode
}
export function MenuIsland() {
  const mode = usePublicThemeMode()
  const authState = usePublicAuthState()
  return <ThemeProvider colorMode={mode === 'dark' ? 'night' : 'day'} dayScheme="light" nightScheme="dark"><PublicNavigationMenu authState={authState} /></ThemeProvider>
}
export function ThemeIsland() {
  const mode = usePublicThemeMode()
  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <ThemeProvider colorMode={mode === 'dark' ? 'night' : 'day'} dayScheme="light" nightScheme="dark">
      <IconButton
        icon={PublicThemeIcon}
        aria-label={`Ativar tema ${next === 'dark' ? 'escuro' : 'claro'}`}
        aria-pressed={mode === 'dark'}
        variant="invisible"
        className="public-theme-trigger"
        unsafeDisableTooltip
        onClick={() => window.setPublicTheme?.(next)}
      />
    </ThemeProvider>
  )
}

let menuRoot
let themeRoot
function mount() {
  const menuContainer = document.getElementById('public-header-menu-root')
  if (menuContainer && !menuRoot) {
    menuRoot = createRoot(menuContainer)
    menuRoot.render(<MenuIsland />)
  }
  const themeContainer = document.getElementById('public-theme-root')
  if (themeContainer && !themeRoot) {
    themeRoot = createRoot(themeContainer)
    themeRoot.render(<ThemeIsland />)
  }
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
document.addEventListener('turbo:load', mount)

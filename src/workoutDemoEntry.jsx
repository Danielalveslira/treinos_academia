import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BaseStyles, ThemeProvider } from '@primer/react'
import WorkoutDemo from './pages/WorkoutDemo.jsx'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/workoutExecution.css'
import './styles/workoutDemo.css'

const container = document.getElementById('demo-root')

export function DemoIsland() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.colorMode || 'light')
  useEffect(() => {
    const update = () => setMode(document.documentElement.dataset.colorMode || 'light')
    window.addEventListener('public-theme-change', update)
    return () => window.removeEventListener('public-theme-change', update)
  }, [])
  return (
    <ThemeProvider
      colorMode={mode === 'dark' ? 'night' : 'day'}
      dayScheme="light"
      nightScheme="dark"
    >
      <BaseStyles>
        <WorkoutDemo />
      </BaseStyles>
    </ThemeProvider>
  )
}

if (container) {
  createRoot(container).render(
    <StrictMode>
      <DemoIsland />
    </StrictMode>
  )
}

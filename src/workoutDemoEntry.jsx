/* eslint-disable react-refresh/only-export-components -- Turbo imports the mount function from this entry. */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BaseStyles, ThemeProvider } from '@primer/react'
import WorkoutDemo from './pages/WorkoutDemo.jsx'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/workoutExecution.css'
import './styles/workoutDemo.css'

function DemoIsland() {
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

let root
let container

export function mountWorkoutDemo() {
  const next = document.getElementById('demo-root')
  if (!next || next === container) return
  root?.unmount()
  container = next
  root = createRoot(next)
  root.render(
    <StrictMode>
      <DemoIsland />
    </StrictMode>
  )
}

document.addEventListener('turbo:before-cache', () => {
  root?.unmount()
  root = null
  container = null
})

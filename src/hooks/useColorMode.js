import { useTheme } from '@primer/react'

export function useColorMode() {
  const { resolvedColorMode, setColorMode } = useTheme()
  const dark = resolvedColorMode === 'night'
  function toggleColorMode() {
    const next = dark ? 'day' : 'night'
    setColorMode(next)
    try {
      localStorage.setItem('colorMode', next)
    } catch {
      // Theme changes also work without browser storage.
    }
  }
  return { dark, toggleColorMode }
}

import { useEffect } from 'react'
import { useTheme } from '@primer/react'

// Also covers dialogs and menus rendered outside the page by a portal.
export function ThemeSync() {
  const { resolvedColorMode } = useTheme()
  useEffect(() => {
    const dark = resolvedColorMode === 'night'
    document.documentElement.dataset.colorMode = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [resolvedColorMode])
  return null
}

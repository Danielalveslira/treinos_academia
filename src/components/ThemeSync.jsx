import { useEffect } from 'react'
import { useTheme } from '@primer/react'

// Primer's BaseStyles (main.jsx) sets data-color-mode/data-light-theme/data-dark-theme only on
// the <div data-portal-root> it renders -- every Primer overlay (ActionMenu, Dialog, Tooltip,
// SelectPanel...) portals INTO that same node (see @primer/react's Portal.js, which looks up
// `[data-portal-root]`), so those inherit the theme fine automatically.
//
// Our own ModalSheet (ShareProgressDialog, TrainingPlanDialog, the catalog detail sheet...)
// createPortal()s straight into document.body instead -- needed so it can escape any
// scroll/stacking/overflow context of an ancestor (ModalSheet.jsx) -- which makes it a SIBLING
// of the BaseStyles div, not a descendant. <html> is the only common ancestor left, so this
// mirrors `data-light-theme`/`data-dark-theme` there too -- without them, every @primer/primitives
// CSS custom property (--bgColor-default etc.) is undefined inside a ModalSheet, and
// `background: var(--bgColor-default)` silently falls back to its initial value (transparent),
// which is how dark mode was showing a plain white page behind those dialogs: nothing themed was
// being overridden, the tokens just never resolved outside the portal root.
//
// `data-color-mode` itself keeps the EXACT original formula (always the resolved 'light'/'dark',
// never the literal "auto") on purpose: several OTHER consumers already read it straight off
// <html> expecting a concrete value, with "light" as their fallback when it's anything else --
// PublicHeaderMenu.jsx/PublicProductsIsland.jsx (`data-color-mode || 'light'`), TrainingPlanDialog.jsx
// (`closest('[data-color-mode]')`) and app.css's own `[data-color-mode='dark']`/`[data-color-mode='light']`
// rules (training-plan-dialog, community-access.css). Writing "auto" there would silently fall
// every one of those back to light mode for the majority of users who never touched the toggle.
export function ThemeSync() {
  const { resolvedColorMode, dayScheme, nightScheme } = useTheme()
  useEffect(() => {
    const dark = resolvedColorMode === 'night'
    const root = document.documentElement
    root.dataset.colorMode = dark ? 'dark' : 'light'
    root.dataset.lightTheme = dayScheme
    root.dataset.darkTheme = nightScheme
    root.style.colorScheme = dark ? 'dark' : 'light'
  }, [resolvedColorMode, dayScheme, nightScheme])
  return null
}

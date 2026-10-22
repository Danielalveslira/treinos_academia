import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ActionList, ActionMenu, IconButton, ThemeProvider } from '@primer/react'
import {
  HomeIcon,
  LocationIcon,
  OrganizationIcon,
  PackageIcon,
  PersonAddIcon,
  QuestionIcon,
  SignInIcon,
  ThreeBarsIcon,
  XIcon,
} from '@primer/octicons-react'
import { ACCOUNT_PUBLIC_LINKS, DISCOVERY_PUBLIC_LINKS } from '../scripts/public-navigation.mjs'
import { PublicThemeIcon } from './PublicThemeIcon.js'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/public-header.css'

const linkIcons = {
  '/': HomeIcon,
  '/como-funciona': QuestionIcon,
  '/para-empresas': OrganizationIcon,
  '/vitrine': PackageIcon,
  '/profissionais': LocationIcon,
  '/login': SignInIcon,
  '/cadastro': PersonAddIcon,
}
function leadingVisual(href) {
  const Icon = linkIcons[href]
  return (
    <ActionList.LeadingVisual>
      <Icon />
    </ActionList.LeadingVisual>
  )
}

export function PublicHeaderMenu() {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState(location.pathname)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const breakpoint = matchMedia('(max-width: 767px)')
    const updateBreakpoint = () => {
      setMobile(breakpoint.matches)
      setOpen(false)
    }
    const updateRoute = () => {
      setPath(location.pathname)
      setOpen(false)
    }
    breakpoint.addEventListener('change', updateBreakpoint)
    document.addEventListener('turbo:load', updateRoute)
    document.addEventListener('turbo:before-cache', updateRoute)
    window.addEventListener('popstate', updateRoute)
    return () => {
      breakpoint.removeEventListener('change', updateBreakpoint)
      document.removeEventListener('turbo:load', updateRoute)
      document.removeEventListener('turbo:before-cache', updateRoute)
      window.removeEventListener('popstate', updateRoute)
    }
  }, [])

  useEffect(() => {
    // The fullscreen mobile overlay doesn't close on Escape through Primer's
    // own handler (verified: the X button and outside clicks do close it).
    if (!mobile || !open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // Capture phase: something inside the fullscreen overlay stops the keydown
    // from bubbling to document, where Primer's own Escape handler listens.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [mobile, open])

  return (
    <ActionMenu open={open} onOpenChange={setOpen}>
      <ActionMenu.Anchor>
        <IconButton
          icon={open ? XIcon : ThreeBarsIcon}
          aria-label="Menu de navegação"
          variant="invisible"
          className="public-header-trigger"
          unsafeDisableTooltip
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay
        align="end"
        width="small"
        className="public-header-overlay"
        variant={{ regular: 'anchored', narrow: 'fullscreen' }}
      >
        <div className="public-header-menu-content">
          {mobile && (
            <div className="public-header-menu-title">
              <strong>Menu</strong>
            </div>
          )}
          <div className="public-header-menu-scroll">
            <ActionList>
              <ActionList.Group title="Descobrir">
                {[['/', 'Início'], ...DISCOVERY_PUBLIC_LINKS].map(([href, label]) => (
                  <ActionList.LinkItem
                    key={href}
                    as="a"
                    href={href}
                    aria-current={path === href ? 'page' : undefined}
                    data-turbo="true"
                    onClick={() => setOpen(false)}
                  >
                    {leadingVisual(href)}
                    {label}
                  </ActionList.LinkItem>
                ))}
              </ActionList.Group>
              <ActionList.Group title="Conta">
                {ACCOUNT_PUBLIC_LINKS.map(([href, label]) => (
                  <ActionList.LinkItem key={href} as="a" href={href} onClick={() => setOpen(false)}>
                    {leadingVisual(href)}
                    {label}
                  </ActionList.LinkItem>
                ))}
              </ActionList.Group>
            </ActionList>
          </div>
        </div>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
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
function MenuIsland() {
  const mode = usePublicThemeMode()
  return <ThemeProvider colorMode={mode === 'dark' ? 'night' : 'day'} dayScheme="light" nightScheme="dark"><PublicHeaderMenu /></ThemeProvider>
}
function ThemeIsland() {
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

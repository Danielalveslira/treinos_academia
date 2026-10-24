import { useEffect, useState } from 'react'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import { ArrowRightIcon, HomeIcon, LocationIcon, OrganizationIcon, PackageIcon, PersonAddIcon, QuestionIcon, SignInIcon, ThreeBarsIcon, XIcon } from '@primer/octicons-react'
import { ACCOUNT_PUBLIC_LINKS, DISCOVERY_PUBLIC_LINKS } from '../../scripts/public-navigation.mjs'
import '../styles/public-navigation-menu.css'

const linkIcons = {
  '/': HomeIcon,
  '/como-funciona': QuestionIcon,
  '/para-empresas': OrganizationIcon,
  '/vitrine': PackageIcon,
  '/profissionais': LocationIcon,
  '/login': SignInIcon,
  '/cadastro': PersonAddIcon,
  '/app': ArrowRightIcon,
}
function leadingVisual(href) {
  const Icon = linkIcons[href]
  return (
    <ActionList.LeadingVisual>
      <Icon />
    </ActionList.LeadingVisual>
  )
}

// Same Primer ActionMenu/ActionList and responsive overlay used by AccountMenu in /app.
export function PublicNavigationMenu({ authState = 'guest', pathname }) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState(() => pathname || (typeof window === 'undefined' ? '/' : window.location.pathname))
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    setPath(pathname || location.pathname)
    setOpen(false)
  }, [pathname])

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
          size="large"
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
                {authState === 'authed' ? (
                  <ActionList.LinkItem as="a" href="/app" onClick={() => setOpen(false)}>
                    {leadingVisual('/app')}
                    Ir para o app
                  </ActionList.LinkItem>
                ) : (
                  ACCOUNT_PUBLIC_LINKS.map(([href, label]) => (
                    <ActionList.LinkItem key={href} as="a" href={href} onClick={() => setOpen(false)}>
                      {leadingVisual(href)}
                      {label}
                    </ActionList.LinkItem>
                  ))
                )}
              </ActionList.Group>
            </ActionList>
          </div>
        </div>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

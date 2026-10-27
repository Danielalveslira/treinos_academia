import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

// Primer owns anchoring, collision avoidance, focus and closing at every width.
export function PublicNavigationMenu({ authState = 'guest', pathname }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const [menuTop, setMenuTop] = useState(undefined)
  const [path, setPath] = useState(() => pathname || (typeof window === 'undefined' ? '/' : window.location.pathname))

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const anchor = anchorRef.current
    const header = anchor.closest('header') || anchor
    const update = () => {
      const gap = Number.parseFloat(getComputedStyle(header).getPropertyValue('--base-size-8')) || 8
      setMenuTop(header.getBoundingClientRect().bottom + gap)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [open])

  useEffect(() => {
    setPath(pathname || location.pathname)
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    const updateRoute = () => {
      setPath(location.pathname)
      setOpen(false)
    }
    document.addEventListener('turbo:load', updateRoute)
    document.addEventListener('turbo:before-cache', updateRoute)
    window.addEventListener('popstate', updateRoute)
    return () => {
      document.removeEventListener('turbo:load', updateRoute)
      document.removeEventListener('turbo:before-cache', updateRoute)
      window.removeEventListener('popstate', updateRoute)
    }
  }, [])

  return (
    <ActionMenu open={open} onOpenChange={setOpen} anchorRef={anchorRef}>
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
        // Primer 37 anchors to the button with a 4px offset, inside the sticky
        // header's bottom padding. Its portal is below that header's stacking
        // context, so the header paints over the panel's top border/corners.
        // Use supported Overlay coordinates for the measured HEADER bottom;
        // keep Primer's horizontal anchoring, collision handling and focus logic.
        align="end"
        side="outside-bottom"
        position="fixed"
        top={menuTop}
        style={{ '--public-menu-top': `${menuTop || 0}px` }}
        width="small"
        className="public-header-overlay"
        variant={{ regular: 'anchored', narrow: 'anchored' }}
        overflow="auto"
      >
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
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

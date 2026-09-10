import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { Suspense, useEffect } from 'react'
import { ActionList, ActionMenu, Button, IconButton, Flash, useTheme } from '@primer/react'
import {
  HomeIcon,
  HistoryIcon,
  ListUnorderedIcon,
  PeopleIcon,
  PersonIcon,
  ShieldLockIcon,
  SignOutIcon,
  PlayIcon,
  SunIcon,
  MoonIcon,
  ThreeBarsIcon,
} from '@primer/octicons-react'
import { logoutUser } from '../services/authService'
import { useAuth } from '../hooks/useAuth'
import { preloadRoute } from '../routeLoaders'
import { PageFallback } from './PageFallback'
import { SubscriptionBanner } from './SubscriptionBanner'
import { BrandMark } from './BrandMark'

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: HomeIcon, end: true },
  { to: '/exercicios', label: 'Exercícios', icon: ListUnorderedIcon },
  { to: '/novo-treino', label: 'Treinar', icon: PlayIcon, action: true },
  { to: '/historico', label: 'Progresso', icon: HistoryIcon },
  { to: '/comunidades', label: 'Comunidades', icon: PeopleIcon },
]

export function Layout() {
  const { resolvedColorMode, setColorMode } = useTheme()
  const { profile, isSuperAdmin } = useAuth()
  const { pathname } = useLocation()
  const activePage = NAV_ITEMS.find((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to)
  )
  const contextLabel = activePage?.label || (pathname.startsWith('/admin') ? 'Admin' : '')
  const dark = resolvedColorMode === 'night'

  useEffect(() => {
    document.documentElement.setAttribute('data-color-mode', resolvedColorMode)
  }, [resolvedColorMode])

  function toggleColorMode() {
    const next = dark ? 'day' : 'night'
    setColorMode(next)
    try {
      localStorage.setItem('colorMode', next)
    } catch {
      // localStorage indisponível (modo privado etc.) — só não persiste entre sessões
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <header className="app-header">
        <div className="header-top">
          <Link to="/" className="brand" aria-label="Evolutus — início">
            <span className="brand-mark">
              <BrandMark size={25} />
            </span>
            <span>Evolutus</span>
          </Link>
          {contextLabel && (
            <>
              <span className="header-divider">/</span>
              <span className="header-context">{contextLabel}</span>
            </>
          )}
          <div className="header-actions">
            <div className="header-actions-desktop">
              <IconButton as={Link} to="/perfil" icon={PersonIcon} aria-label="Meu perfil" />
              {isSuperAdmin && (
                <IconButton
                  as={Link}
                  to="/admin/comunidades"
                  icon={ShieldLockIcon}
                  aria-label="Administrar comunidades"
                />
              )}
              <IconButton
                icon={dark ? SunIcon : MoonIcon}
                aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
                onClick={toggleColorMode}
              />
              <IconButton
                icon={SignOutIcon}
                variant="invisible"
                aria-label="Sair"
                onClick={logoutUser}
              />
            </div>
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  icon={ThreeBarsIcon}
                  aria-label="Abrir menu"
                  className="header-menu-trigger"
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay align="end">
                <ActionList>
                  <ActionList.LinkItem as={Link} to="/perfil">
                    Meu perfil
                  </ActionList.LinkItem>
                  {isSuperAdmin && (
                    <ActionList.LinkItem as={Link} to="/admin/comunidades">
                      Administrar comunidades
                    </ActionList.LinkItem>
                  )}
                  <ActionList.Item onSelect={toggleColorMode}>
                    {dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
                  </ActionList.Item>
                  <ActionList.Divider />
                  <ActionList.Item variant="danger" onSelect={logoutUser}>
                    Sair
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
        </div>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              replace
              className={`nav-link${item.action ? ' nav-link-action' : ''}`}
              onMouseEnter={() => preloadRoute(item.to)}
              onFocus={() => preloadRoute(item.to)}
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={`main-content${pathname === '/novo-treino' ? ' main-content-form' : ''}`}
      >
        <SubscriptionBanner profile={profile} />
        {profile && !profile.username && pathname !== '/perfil' && (
          <Flash sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 3 }}>
            Defina um nome de usuário para aparecer nas comunidades no lugar do seu e-mail.
            <Button as={Link} to="/perfil" size="small" sx={{ ml: 'auto', flexShrink: 0 }}>
              Definir agora
            </Button>
          </Flash>
        )}
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="mobile-nav" aria-label="Navegação principal mobile">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            replace
            className={`nav-link${item.action ? ' nav-link-action' : ''}`}
            onTouchStart={() => preloadRoute(item.to)}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

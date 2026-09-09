import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { Suspense } from 'react'
import { Button, IconButton, Flash, useTheme } from '@primer/react'
import {
  HomeIcon,
  PlusCircleIcon,
  HistoryIcon,
  ListUnorderedIcon,
  PeopleIcon,
  PersonIcon,
  ShieldLockIcon,
  SignOutIcon,
  GraphIcon,
  SunIcon,
  MoonIcon,
} from '@primer/octicons-react'
import { logoutUser } from '../services/authService'
import { useAuth } from '../hooks/useAuth'
import { preloadRoute } from '../routeLoaders'
import { PageFallback } from './PageFallback'
import { LegalLinks } from './LegalLinks'

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: HomeIcon, end: true },
  { to: '/novo-treino', label: 'Registrar', icon: PlusCircleIcon },
  { to: '/historico', label: 'Histórico', icon: HistoryIcon },
  { to: '/exercicios', label: 'Exercícios', icon: ListUnorderedIcon },
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
          <Link to="/" className="brand" aria-label="Treinos — início">
            <span className="brand-mark">
              <GraphIcon size={18} />
            </span>
            <span>Treinos</span>
          </Link>
          {contextLabel && (
            <>
              <span className="header-divider">/</span>
              <span className="header-context">{contextLabel}</span>
            </>
          )}
          <div className="header-actions">
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
        </div>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              replace
              className="nav-link"
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
      <footer className="app-footer">
        <LegalLinks />
        <p className="app-footer-brand">
          <GraphIcon size={12} /> Treinos · Seu progresso, um treino de cada vez.
        </p>
      </footer>
      <nav className="mobile-nav" aria-label="Navegação principal mobile">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            replace
            className="nav-link"
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

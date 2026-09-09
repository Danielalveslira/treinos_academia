import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { Button, IconButton, Flash, useTheme } from '@primer/react'
import {
  HomeIcon,
  PlusCircleIcon,
  HistoryIcon,
  ListUnorderedIcon,
  PeopleIcon,
  ShieldLockIcon,
  SignOutIcon,
  GraphIcon,
  SunIcon,
  MoonIcon,
} from '@primer/octicons-react'
import { logoutUser } from '../services/authService'
import { useAuth } from '../hooks/useAuth'

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
              <GraphIcon size={22} />
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
            <span className="action-divider" />
            <Button leadingVisual={SignOutIcon} variant="invisible" onClick={logoutUser}>
              Sair
            </Button>
          </div>
        </div>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} replace className="nav-link">
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
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>Treinos</span>
        <span>Seu progresso, um treino de cada vez.</span>
      </footer>
      <nav className="mobile-nav" aria-label="Navegação principal mobile">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} replace className="nav-link">
            <item.icon size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

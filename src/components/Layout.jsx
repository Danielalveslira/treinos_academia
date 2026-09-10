import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { Suspense, useState } from 'react'
import { Button, Flash } from '@primer/react'
import {
  HomeIcon,
  HistoryIcon,
  ListUnorderedIcon,
  PeopleIcon,
  PlayIcon,
} from '@primer/octicons-react'
import { logoutUser } from '../services/authService'
import { useAuth } from '../hooks/useAuth'
import { preloadRoute } from '../routeLoaders'
import { PageFallback } from './PageFallback'
import { BrandMark } from './BrandMark'
import { AccountMenu } from './AccountMenu'

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: HomeIcon, end: true },
  { to: '/exercicios', label: 'Exercícios', icon: ListUnorderedIcon },
  { to: '/novo-treino', label: 'Treinar', icon: PlayIcon, action: true },
  { to: '/historico', label: 'Progresso', icon: HistoryIcon },
  { to: '/comunidades', label: 'Comunidades', icon: PeopleIcon },
]

function Navigation({ mobile = false }) {
  return (
    <nav
      className={mobile ? 'mobile-nav' : 'desktop-nav'}
      aria-label={mobile ? 'Navegação principal mobile' : 'Navegação principal'}
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={`nav-link${item.action ? ' nav-link-action' : ''}`}
          onMouseEnter={() => preloadRoute(item.to)}
          onFocus={() => preloadRoute(item.to)}
        >
          <item.icon size={18} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export function Layout() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  async function logout() {
    if (signingOut) return
    setSigningOut(true)
    setLogoutError('')
    try {
      await logoutUser()
    } catch {
      setLogoutError('Não foi possível sair. Tente novamente pelo menu da conta.')
    } finally {
      setSigningOut(false)
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
          <Navigation />
          <div className="header-actions">
            <AccountMenu onLogout={logout} signingOut={signingOut} />
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={`main-content${pathname === '/novo-treino' ? ' main-content-form' : ''}`}
      >
        {logoutError && (
          <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
            {logoutError}
          </Flash>
        )}
        {profile && !profile.username && pathname !== '/perfil' && (
          <Flash className="profile-reminder">
            Defina um nome de usuário para aparecer nas comunidades no lugar do seu e-mail.
            <Button as={Link} to="/perfil" size="small">
              Definir agora
            </Button>
          </Flash>
        )}
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Navigation mobile />
    </div>
  )
}

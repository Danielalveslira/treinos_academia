import { NavLink, Outlet } from 'react-router-dom'
import { logoutUser } from '../services/authService'

const NAV_ITEMS = [
  { to: '/', label: 'Início', end: true },
  { to: '/novo-treino', label: 'Registrar' },
  { to: '/historico', label: 'Histórico' },
  { to: '/exercicios', label: 'Exercícios' },
]

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Treinos</span>
        <button className="link-button" onClick={logoutUser}>
          Sair
        </button>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <nav className="app-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `app-nav__item${isActive ? ' app-nav__item--active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

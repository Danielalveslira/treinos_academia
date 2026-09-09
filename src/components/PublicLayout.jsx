import { Link, NavLink } from 'react-router-dom'
import { IconButton, useTheme } from '@primer/react'
import { LegalLinks } from './LegalLinks'
import {
  GraphIcon,
  SunIcon,
  MoonIcon,
  ChecklistIcon,
  HistoryIcon,
  ArrowUpRightIcon,
} from '@primer/octicons-react'

export function PublicLayout({ children }) {
  const { resolvedColorMode, setColorMode } = useTheme()
  const dark = resolvedColorMode === 'night'
  return (
    <div className="public-shell">
      <a className="skip-link" href="#public-content">
        Pular para o conteúdo
      </a>
      <header className="public-header">
        <Link to="/login" className="brand">
          <span className="brand-mark">
            <GraphIcon size={22} />
          </span>
          Treinos
        </Link>
        <nav aria-label="Navegação">
          <NavLink to="/planos">Planos</NavLink>
          <NavLink to="/login">Entrar</NavLink>
          <IconButton
            icon={dark ? SunIcon : MoonIcon}
            aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
            onClick={() => setColorMode(dark ? 'day' : 'night')}
          />
        </nav>
      </header>
      <main id="public-content" tabIndex={-1} className="public-main">
        {children}
      </main>
      <footer className="public-footer">
        <div className="public-footer-brand">
          <span>Treinos · Seu diário de evolução</span>
          <Link to="/planos">
            Conheça os planos <ArrowUpRightIcon size={12} />
          </Link>
        </div>
        <LegalLinks />
      </footer>
    </div>
  )
}

export function AuthLayout({ children, title, description, footer }) {
  return (
    <PublicLayout>
      <div className="auth-layout">
        <section className="auth-intro" aria-label="Sobre o Treinos">
          <span className="public-eyebrow">
            <span /> CADA TREINO CONTA
          </span>
          <h2>
            Seu esforço merece
            <br />
            <span>ser acompanhado.</span>
          </h2>
          <p>
            Um espaço para organizar seus treinos, acompanhar suas cargas e enxergar sua evolução.
          </p>
          <div className="auth-benefits">
            <div>
              <span className="benefit-icon">
                <ChecklistIcon size={20} />
              </span>
              <div>
                <h3>Registre com simplicidade</h3>
                <p>Exercícios, séries e repetições em um só lugar.</p>
              </div>
            </div>
            <div>
              <span className="benefit-icon">
                <GraphIcon size={20} />
              </span>
              <div>
                <h3>Visualize seu progresso</h3>
                <p>Acompanhe o volume e a evolução das cargas.</p>
              </div>
            </div>
            <div>
              <span className="benefit-icon">
                <HistoryIcon size={20} />
              </span>
              <div>
                <h3>Construa sua constância</h3>
                <p>Consulte seu histórico a cada novo treino.</p>
              </div>
            </div>
          </div>
        </section>
        <section className="auth-form-section" aria-labelledby="auth-title">
          <div className="auth-form-card">
            <span className="auth-heading-icon">
              <GraphIcon size={24} />
            </span>
            <h1 id="auth-title">{title}</h1>
            <p className="auth-description">{description}</p>
            {children}
          </div>
          <div className="auth-switch">{footer}</div>
        </section>
      </div>
    </PublicLayout>
  )
}

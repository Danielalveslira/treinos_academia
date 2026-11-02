import { Link, NavLink, useLocation } from 'react-router-dom'
import { IconButton } from '@primer/react'
import { useColorMode } from '../hooks/useColorMode'
import { LegalLinks } from './LegalLinks'
import { useAuth } from '../hooks/useAuth'
import { GraphIcon, SunIcon, MoonIcon, ChecklistIcon, HistoryIcon } from '@primer/octicons-react'
import { BrandMark } from './BrandMark'
import { ResponsivePicture } from './ResponsivePicture'
import { PublicNavigationMenu } from './PublicNavigationMenu'

export function PublicLayout({ children }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { dark, toggleColorMode } = useColorMode()

  return (
    <div className="public-shell">
      <a className="skip-link" href="#public-content">
        Pular para o conteúdo
      </a>
      <header className="public-header">
        <Link to={user ? '/app' : '/'} reloadDocument={!user} replace className="brand">
          <span className="brand-mark">
            <BrandMark size={28} />
          </span>
          Evolutus
        </Link>
        <nav aria-label="Navegação" className="auth-header-actions">
          <div className="auth-header-discovery">
            <a href="/vitrine">Vitrine de produtos</a>
            <a href="/profissionais">Profissionais e locais</a>
          </div>
          {user ? (
            <NavLink to="/app" replace>
              Ir para o app
            </NavLink>
          ) : (
            <NavLink to="/login" replace>
              Entrar
            </NavLink>
          )}
          <IconButton
            size="large"
            icon={dark ? SunIcon : MoonIcon}
            aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
            onClick={toggleColorMode}
          />
          <div className="auth-header-menu">
            <PublicNavigationMenu authState={user ? 'authed' : 'guest'} pathname={pathname} />
          </div>
        </nav>
      </header>
      <main id="public-content" tabIndex={-1} className="public-main">
        {children}
      </main>
      <footer className="public-footer">
        <LegalLinks />
        <p className="public-footer-brand">
          <BrandMark size={14} /> Evolutus · Seu diário de evolução
        </p>
      </footer>
    </div>
  )
}

// `variant="signup"`: cadastro em etapas -- arte lateral simplificada no desktop e oculta em telas
// estreitas (formulário primeiro). `titleRef`: permite à página levar o foco ao título (troca de etapa).
// Sem essas props, Login/recuperação continuam exatamente como antes.
export function AuthLayout({ children, title, description, footer, variant, titleRef }) {
  return (
    <PublicLayout>
      <div className={variant ? `auth-layout auth-layout--${variant}` : 'auth-layout'}>
        <section className="auth-intro" aria-label="Sobre o Evolutus">
          <ResponsivePicture
            className="auth-cover"
            name="capa_principal"
            alt=""
            width={1145}
            height={1374}
            sizes="(max-width: 900px) 100vw, 50vw"
            priority
          />
          <div className="auth-intro-content">
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
          </div>
        </section>
        <section className="auth-form-section" aria-labelledby="auth-title">
          <div className="auth-form-card">
            <span className="auth-heading-icon">
              <BrandMark size={26} />
            </span>
            <h1 id="auth-title" ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
              {title}
            </h1>
            <p className="auth-description">{description}</p>
            {children}
          </div>
          <div className="auth-switch">{footer}</div>
        </section>
      </div>
    </PublicLayout>
  )
}

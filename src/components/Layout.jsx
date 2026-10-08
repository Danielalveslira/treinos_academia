import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { Suspense, lazy } from 'react'
import { Button, Flash, useConfirm } from '@primer/react'
import {
  HomeIcon,
  HistoryIcon,
  ListUnorderedIcon,
  PeopleIcon,
  PlayIcon,
} from '@primer/octicons-react'
import { confirmAndLogoutAll, useLogout } from '../hooks/useLogout'
import { useAuth } from '../hooks/useAuth'
import { useQualifiedActivity } from '../hooks/useQualifiedActivity'
import { useActivityHeartbeat } from '../hooks/useActivityHeartbeat'
import { preloadRoute } from '../routeLoaders'
import { originState } from '../utils/navigation'
import { PageFallback } from './PageFallback'
import { BrandMark } from './BrandMark'
import { AccountMenu } from './AccountMenu'
import { WalletHeaderBadges } from './WalletHeaderBadges'
import { EvoCoinsAwardNotice } from './EvoCoinsAwardNotice'
import { usePushSubscriptionSync } from '../features/notifications/hooks/usePushSubscriptionSync'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useSyncScheduler } from '../hooks/useSyncScheduler'
import { isOfflineShellEnabled } from '../services/offline/database'
import { useWarmOfflineRoutes } from '../hooks/useWarmOfflineRoutes'
import { isOfflineCapablePath } from '../utils/offlineRoutes'
import { resolveLegalGateState } from '../utils/legal'

// Fora do bundle de entrada: o indicador (e toda a pilha de sync) só é necessário com usuário logado.
// O sino (e a pilha de notificações com Realtime) não é necessário para pintar a primeira tela: sai do bundle
// de boot. O espaço de 32 px evita deslocar o menu da conta quando o chunk chega.
const NotificationBell = lazy(() =>
  import('../features/notifications/components/NotificationBell').then((module) => ({
    default: module.NotificationBell,
  }))
)
const SyncStatus = lazy(() =>
  import('./SyncStatus').then((module) => ({ default: module.SyncStatus }))
)

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: HomeIcon, end: true },
  { to: '/exercicios', label: 'Exercícios', icon: ListUnorderedIcon },
  { to: '/novo-treino', label: 'Treinar', icon: PlayIcon, action: true },
  { to: '/progresso', label: 'Progresso', icon: HistoryIcon },
  { to: '/comunidades', label: 'Comunidades', icon: PeopleIcon },
]

function Navigation({ mobile = false }) {
  const location = useLocation()
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
          // Troca de seção (Início/Exercícios/Progresso/Comunidades) substitui a entrada
          // atual do histórico em vez de empilhar uma nova — sem isso, alternar entre
          // abas repetidamente faz o botão voltar do navegador/celular ter que passar por
          // cada aba visitada antes de sair do app de verdade. "Treinar" fica de fora
          // (é uma ação, não uma aba) porque o Cancelar de NewWorkout.jsx depende de
          // returnToOrigin (utils/navigation.js) para voltar à origem registrada em state.from.
          replace={!item.action}
          state={item.action ? originState(location) : undefined}
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
  const { user, profile, legalAccess, deletionStatus, offlineLocal, serverAccessAllowed } =
    useAuth()
  const location = useLocation()
  const { pathname } = location
  const { logout, logoutAll, signingOut, error: logoutError } = useLogout()
  const confirm = useConfirm()

  const confirmLogoutAll = () => confirmAndLogoutAll(confirm, logoutAll)
  // Só o "ping" de atividade qualificada (seção 8/9 do prompt de economia) -- não é um
  // listener de saldo: a carteira em si só é lida sob demanda onde a UI precisa dela
  // (ver WalletCard/useWallet.js).
  useQualifiedActivity()
  // "Último uso" para o admin: visível apenas, no máximo 1 chamada a cada 10 min.
  useActivityHeartbeat()
  // Modo offline local (cold start): usuário reconhecido pelo aparelho, SEM sessão confirmada pelo servidor.
  // Push e sync só começam depois que a revalidação confirma sessão, perfil e termos (AuthContext).
  usePushSubscriptionSync(Boolean(profile) && !offlineLocal, user?.uid)
  // Esvazia a outbox (treino salvo offline) ao abrir, no evento `online`, ao voltar ao primeiro plano.
  const syncAuthorized =
    !offlineLocal &&
    serverAccessAllowed &&
    !deletionStatus &&
    profile?.accountStatus === 'active' &&
    resolveLegalGateState({ profile, access: legalAccess, loading: false, error: '' }) === 'allowed'
  useSyncScheduler(syncAuthorized ? user?.uid : null)
  useWarmOfflineRoutes(!offlineLocal)
  // Escrita offline ligada: o app não é mais bloqueado sem rede, mas o que EXIGE servidor (EvoCash,
  // comunidades, perfil, administração...) mostra um aviso em vez de tentar e falhar.
  const online = useOnlineStatus()
  const needsServer = !online && isOfflineShellEnabled() && !isOfflineCapablePath(pathname)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <header className="app-header">
        <div className="header-top">
          <Link to="/" replace className="brand" aria-label="Evolutus — início">
            <span className="brand-mark">
              <BrandMark size={25} />
            </span>
            <span>Evolutus</span>
          </Link>
          <Navigation />
          <div className="header-actions">
            <WalletHeaderBadges />
            {!offlineLocal && (
              <Suspense fallback={<span aria-hidden="true" style={{ width: 32, height: 32 }} />}>
                <NotificationBell userId={user?.uid} />
              </Suspense>
            )}
            <AccountMenu onLogout={logout} onLogoutAll={confirmLogoutAll} signingOut={signingOut} />
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
        {/* No registro de treino o estado offline/pendente vive no próprio card (SetCard), então os avisos
            de topo saem dali: menos rolagem e nada repetido. Falhas de sincronização continuam aparecendo. */}
        {offlineLocal && pathname !== '/novo-treino' && (
          <div className="sync-status sync-status-offline" role="status">
            {online
              ? 'Reconectando sua conta…'
              : 'Modo offline: você entrou com os dados salvos neste aparelho.'}
          </div>
        )}
        <Suspense fallback={null}>
          <SyncStatus criticalOnly={pathname === '/novo-treino'} />
        </Suspense>
        {needsServer ? (
          <div className="offline-only-notice" role="alert">
            <h2>Esta área precisa de internet</h2>
            <p>
              Conecte-se para continuar. Seus registros de treino continuam salvos neste aparelho.
            </p>
            <Button as={Link} to="/novo-treino" replace>
              Ir para o treino
            </Button>
          </div>
        ) : (
          /* Um erro de renderização numa página fica contido aqui (navegação e cabeçalho continuam
             utilizáveis) e é limpo ao trocar de rota (key). O ErrorBoundary raiz (main.jsx) continua
             como última rede. O erro segue sendo registrado no console por componentDidCatch. */
          <ErrorBoundary key={pathname} inline>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
      <EvoCoinsAwardNotice />
      <Navigation mobile />
    </div>
  )
}

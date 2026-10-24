import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import {
  PersonIcon,
  ShieldLockIcon,
  RocketIcon,
  CreditCardIcon,
  SunIcon,
  MoonIcon,
  SignOutIcon,
  DeviceMobileIcon,
  ThreeBarsIcon,
  XIcon,
  QuestionIcon,
  BriefcaseIcon,
  LocationIcon,
  PackageIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useColorMode } from '../hooks/useColorMode'
import { useLogoutNotice } from '../hooks/usePendingNotice'
import { ADMIN_ITEMS } from '../constants/adminNav'

// Rotas compartilhadas de "Minha conta" para desktop e mobile. A carteira tem
// um atalho exclusivo no painel mobile porque seu indicador já aparece no header
// desktop. Exportadas (junto com as funções de
// render abaixo) pra serem testáveis sem precisar montar o ActionMenu.Overlay
// inteiro (que depende de Portal/DOM real -- ver AccountMenu.test.js).
export const ACCOUNT_ITEMS = [
  { key: 'anuncios', to: '/meus-anuncios', icon: BriefcaseIcon, label: 'Meus anúncios' },
  { key: 'perfil', to: '/perfil', icon: PersonIcon, label: 'Meu perfil' },
  // profile?.usageProfile === 'common' só esconde o atalho (declutter) -- a
  // rota /minha-vitrine continua acessível e decide por conta própria (com
  // dados reais) o que mostrar; ver MyProfessionalListing.jsx. Legado
  // (usageProfile ausente) e profissional/estabelecimento continuam vendo o
  // atalho normalmente.
  {
    key: 'vitrine',
    to: '/minha-vitrine',
    icon: BriefcaseIcon,
    label: 'Minha vitrine',
    show: (profile) => profile?.usageProfile !== 'common',
  },
  { key: 'evocash', to: '/evocash', icon: CreditCardIcon, label: 'Comprar EvoCash' },
  { key: 'promocoes', to: '/minhas-promocoes', icon: RocketIcon, label: 'Minhas promoções' },
]

export const EXPLORE_ITEMS = [
  { key: 'public-products', to: '/vitrine', icon: PackageIcon, label: 'Vitrine de produtos', document: true },
  { key: 'public-professionals', to: '/profissionais', icon: LocationIcon, label: 'Profissionais e locais', document: true },
]

// Reexportada por compatibilidade (AccountMenu.test.js e código legado importam
// ADMIN_ITEMS daqui) -- a lista em si vive em constants/adminNav.js, um módulo puro
// sem hooks, pra AdminNav.jsx poder importá-la sem arrastar useAuth/useColorMode/
// Supabase para dentro de cada página /admin/* que a usa (ver AdminNav.jsx).
export { ADMIN_ITEMS }

// replace: mesmo motivo do menu inferior em Layout.jsx -- esses links trocam
// de seção do app, não deveriam empilhar histórico.
export function renderNavItems(items, profile, onNavigate) {
  return items
    .filter((item) => !item.show || item.show(profile))
    .map((item) => (
      <ActionList.LinkItem
        key={item.key}
        as={item.document ? 'a' : Link}
        {...(item.document ? { href: item.to } : { to: item.to, replace: true })}
        onClick={onNavigate}
      >
        <ActionList.LeadingVisual>
          <item.icon />
        </ActionList.LeadingVisual>
        {item.label}
      </ActionList.LinkItem>
    ))
}

export function renderMobileWalletItem(onNavigate) {
  return (
    <ActionList.LinkItem as={Link} to="/entenda-suas-moedas" replace onClick={onNavigate}>
      <ActionList.LeadingVisual>
        <CreditCardIcon />
      </ActionList.LeadingVisual>
      Carteira e moedas
    </ActionList.LinkItem>
  )
}

// Os dois logouts, compartilhados entre o dropdown do desktop (inline, fim da
// lista) e o rodapé fixo do painel mobile -- mesmo onSelect/variant/disabled
// nos dois, só o container ao redor muda.
export function renderSessionItems({ onLogout, onLogoutAll, signingOut, logoutNotice }) {
  return (
    <>
      {/* preventDefault: o menu fica aberto durante o signOut para o item mostrar "Saindo…"; o
          redirecionamento para /login desmonta tudo no fim. */}
      <ActionList.Item
        variant="danger"
        disabled={signingOut}
        onSelect={(event) => {
          event.preventDefault()
          onLogout()
        }}
      >
        <ActionList.LeadingVisual>
          <SignOutIcon />
        </ActionList.LeadingVisual>
        {signingOut ? 'Saindo…' : 'Sair da conta'}
        {logoutNotice && (
          <ActionList.Description variant="block">{logoutNotice}</ActionList.Description>
        )}
      </ActionList.Item>
      {/* Ação de segurança, separada do "Sair da conta": SEM preventDefault de propósito --
          o menu fecha normalmente (comportamento padrão do ActionMenu) e só então a
          confirmação explícita (Layout) aparece, nunca sobreposta pelo painel mobile. */}
      <ActionList.Item variant="danger" disabled={signingOut} onSelect={onLogoutAll}>
        <ActionList.LeadingVisual>
          <DeviceMobileIcon />
        </ActionList.LeadingVisual>
        Sair de todos os dispositivos
      </ActionList.Item>
    </>
  )
}

// Item "Administração" recolhível (mobile) -- separado em função própria pra ser
// testável direto (expande/recolhe, mostra as 9 rotas) sem precisar montar o
// ActionMenu.Overlay inteiro. `expanded`/`onToggle` vêm de fora: aqui não há
// estado próprio, só apresentação.
export function renderAdminSection({ expanded, onToggle, profile, onNavigate }) {
  const label = `Ferramentas administrativas (${ADMIN_ITEMS.length})`
  return (
    <ActionList.Group title="Administração">
      <ActionList.Item
        aria-expanded={expanded}
        aria-controls="account-menu-admin-list"
        onSelect={(event) => {
          event.preventDefault()
          onToggle()
        }}
      >
        <ActionList.LeadingVisual>
          <ShieldLockIcon />
        </ActionList.LeadingVisual>
        {label}
        <ActionList.TrailingVisual>
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </ActionList.TrailingVisual>
      </ActionList.Item>
      {/* `hidden` (não desmontar): aria-controls precisa de um elemento que exista de
          verdade, só oculto -- não um id "no ar" quando recolhido. */}
      <div id="account-menu-admin-list" hidden={!expanded}>
        {renderNavItems(ADMIN_ITEMS, profile, onNavigate)}
      </div>
    </ActionList.Group>
  )
}

export function AccountMenu({ onLogout, onLogoutAll, signingOut }) {
  // Treino salvo offline e ainda não sincronizado NÃO impede sair (a fila é desta conta e fica guardada).
  const logoutNotice = useLogoutNotice()
  const [open, setOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const [adminExpanded, setAdminExpanded] = useState(false)
  const { key } = useLocation()
  const { isSuperAdmin, profile } = useAuth()
  const { dark, toggleColorMode } = useColorMode()

  useEffect(() => {
    setOpen(false)
  }, [key])
  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 767px)')
    const update = () => {
      setIsMobile(breakpoint.matches)
      setOpen(false)
    }
    breakpoint.addEventListener('change', update)
    return () => breakpoint.removeEventListener('change', update)
  }, [])
  // "Administração" sempre começa recolhida -- nunca herda o estado expandido
  // de uma abertura anterior do menu (fechar cobre X/Escape/clique fora/navegação).
  useEffect(() => {
    if (!open) setAdminExpanded(false)
  }, [open])

  function closeMenu() {
    setOpen(false)
  }

  return (
    <ActionMenu open={open} onOpenChange={setOpen}>
      <ActionMenu.Anchor>
        <IconButton
          icon={open ? XIcon : ThreeBarsIcon}
          aria-label="Menu da conta"
          variant="invisible"
          className="account-menu-trigger"
          unsafeDisableTooltip
        />
      </ActionMenu.Anchor>
      {/* variant: dropdown ancorado no desktop (≥768px, inalterado), folha cheia no mobile
          (<768px) -- modo responsivo de primeira classe do próprio Primer (AnchoredOverlay),
          não uma reconstrução própria de modal/foco/Escape. */}
      <ActionMenu.Overlay
        align="end"
        width="small"
        className="account-menu-overlay"
        variant={{ regular: 'anchored', narrow: 'fullscreen' }}
      >
        <div className="account-menu-content">
          {isMobile && (
            <div className="account-menu-mobile-header">
              <strong>Menu</strong>
            </div>
          )}
          <div className="account-menu-scroll">
            {isMobile ? (
              <ActionList>
                <ActionList.Group title="Minha conta">
                  {renderNavItems(ACCOUNT_ITEMS, profile, closeMenu)}
                  {renderMobileWalletItem(closeMenu)}
                </ActionList.Group>
                <ActionList.Group title="Explorar">
                  {renderNavItems(EXPLORE_ITEMS, profile, closeMenu)}
                </ActionList.Group>
                {isSuperAdmin &&
                  renderAdminSection({
                    expanded: adminExpanded,
                    onToggle: () => setAdminExpanded((current) => !current),
                    profile,
                    onNavigate: closeMenu,
                  })}
                <ActionList.Group title="Preferências e ajuda">
                  <ActionList.Item onSelect={toggleColorMode}>
                    <ActionList.LeadingVisual>
                      {dark ? <SunIcon /> : <MoonIcon />}
                    </ActionList.LeadingVisual>
                    {dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
                  </ActionList.Item>
                  <ActionList.LinkItem as={Link} to="/atendimento" replace onClick={closeMenu}>
                    <ActionList.LeadingVisual>
                      <QuestionIcon />
                    </ActionList.LeadingVisual>
                    Ajuda e atendimento
                  </ActionList.LinkItem>
                </ActionList.Group>
              </ActionList>
            ) : (
              <ActionList>
                {renderNavItems(ACCOUNT_ITEMS, profile, closeMenu)}
                <ActionList.Group title="Explorar">
                  {renderNavItems(EXPLORE_ITEMS, profile, closeMenu)}
                </ActionList.Group>
                {isSuperAdmin && (
                  <ActionList.Group title="Administração">
                    {renderNavItems(ADMIN_ITEMS, profile, closeMenu)}
                  </ActionList.Group>
                )}
                <ActionList.Divider />
                <ActionList.Item onSelect={toggleColorMode}>
                  <ActionList.LeadingVisual>
                    {dark ? <SunIcon /> : <MoonIcon />}
                  </ActionList.LeadingVisual>
                  {dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
                </ActionList.Item>
                <ActionList.LinkItem as={Link} to="/atendimento" replace onClick={closeMenu}>
                  <ActionList.LeadingVisual>
                    <QuestionIcon />
                  </ActionList.LeadingVisual>
                  Ajuda e atendimento
                </ActionList.LinkItem>
                <ActionList.Divider />
                {renderSessionItems({ onLogout, onLogoutAll, signingOut, logoutNotice })}
              </ActionList>
            )}
          </div>
          {isMobile && (
            <ActionList className="account-menu-session">
              <ActionList.Group title="Sessão">
                {renderSessionItems({ onLogout, onLogoutAll, signingOut, logoutNotice })}
              </ActionList.Group>
            </ActionList>
          )}
        </div>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

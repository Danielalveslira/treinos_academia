import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import {
  PersonIcon,
  ShieldLockIcon,
  PeopleIcon,
  MegaphoneIcon,
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
  ImageIcon,
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useColorMode } from '../hooks/useColorMode'
import { useLogoutNotice } from '../hooks/usePendingNotice'

export function AccountMenu({ onLogout, onLogoutAll, signingOut }) {
  // Treino salvo offline e ainda não sincronizado NÃO impede sair (a fila é desta conta e fica guardada).
  const logoutNotice = useLogoutNotice()
  const [open, setOpen] = useState(false)
  const { key } = useLocation()
  const { isSuperAdmin, profile } = useAuth()
  const { dark, toggleColorMode } = useColorMode()

  useEffect(() => {
    setOpen(false)
  }, [key])
  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 767px)')
    const close = () => setOpen(false)
    breakpoint.addEventListener('change', close)
    return () => breakpoint.removeEventListener('change', close)
  }, [])

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
      <ActionMenu.Overlay align="end" width="small" className="account-menu-overlay">
        <ActionList>
          {/* replace: mesmo motivo do menu inferior em Layout.jsx — esses links trocam de
              seção do app, não deveriam empilhar histórico. */}
          <ActionList.LinkItem as={Link} to="/perfil" replace onClick={() => setOpen(false)}>
            <ActionList.LeadingVisual>
              <PersonIcon />
            </ActionList.LeadingVisual>
            Meu perfil
          </ActionList.LinkItem>
          <ActionList.LinkItem as={Link} to="/profissionais" replace onClick={() => setOpen(false)}>
            <ActionList.LeadingVisual>
              <LocationIcon />
            </ActionList.LeadingVisual>
            Profissionais e locais
          </ActionList.LinkItem>
          {/* profile?.usageProfile === 'common' só esconde o atalho (declutter) -- a
              rota /minha-vitrine continua acessível e decide por conta própria (com
              dados reais) o que mostrar; ver MyProfessionalListing.jsx. Legado
              (usageProfile ausente) e profissional/estabelecimento continuam vendo o
              atalho normalmente. */}
          {profile?.usageProfile !== 'common' && (
            <ActionList.LinkItem as={Link} to="/minha-vitrine" replace onClick={() => setOpen(false)}>
              <ActionList.LeadingVisual>
                <BriefcaseIcon />
              </ActionList.LeadingVisual>
              Minha vitrine
            </ActionList.LinkItem>
          )}
          <ActionList.LinkItem as={Link} to="/evocash" replace onClick={() => setOpen(false)}>
            <ActionList.LeadingVisual>
              <CreditCardIcon />
            </ActionList.LeadingVisual>
            Comprar EvoCash
          </ActionList.LinkItem>
          <ActionList.LinkItem
            as={Link}
            to="/minhas-promocoes"
            replace
            onClick={() => setOpen(false)}
          >
            <ActionList.LeadingVisual>
              <RocketIcon />
            </ActionList.LeadingVisual>
            Minhas promoções
          </ActionList.LinkItem>
          {isSuperAdmin && (
            <ActionList.Group title="Administração">
              <ActionList.LinkItem
                as={Link}
                to="/admin/comunidades"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <PeopleIcon />
                </ActionList.LeadingVisual>
                Comunidades
              </ActionList.LinkItem>
              <ActionList.LinkItem
                as={Link}
                to="/admin/parcerias"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <MegaphoneIcon />
                </ActionList.LeadingVisual>
                Anúncios e parcerias
              </ActionList.LinkItem>
              <ActionList.LinkItem
                as={Link}
                to="/admin/contas"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <PersonIcon />
                </ActionList.LeadingVisual>
                Contas
              </ActionList.LinkItem>
              <ActionList.LinkItem
                as={Link}
                to="/admin/moderacao"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <ShieldLockIcon />
                </ActionList.LeadingVisual>
                Moderação
              </ActionList.LinkItem>
              <ActionList.LinkItem
                as={Link}
                to="/admin/compras-evocash"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <CreditCardIcon />
                </ActionList.LeadingVisual>
                Compras de EvoCash
              </ActionList.LinkItem>
              <ActionList.LinkItem
                as={Link}
                to="/admin/promocoes"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <RocketIcon />
                </ActionList.LeadingVisual>
                Promoções (EvoCash)
              </ActionList.LinkItem>
              <ActionList.LinkItem
                as={Link}
                to="/admin/exercicios-imagens"
                replace
                onClick={() => setOpen(false)}
              >
                <ActionList.LeadingVisual>
                  <ImageIcon />
                </ActionList.LeadingVisual>
                Imagens dos exercícios
              </ActionList.LinkItem>
            </ActionList.Group>
          )}
          <ActionList.Divider />
          <ActionList.Item onSelect={toggleColorMode}>
            <ActionList.LeadingVisual>{dark ? <SunIcon /> : <MoonIcon />}</ActionList.LeadingVisual>
            {dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
          </ActionList.Item>
          <ActionList.LinkItem as={Link} to="/atendimento" replace onClick={() => setOpen(false)}>
            <ActionList.LeadingVisual>
              <QuestionIcon />
            </ActionList.LeadingVisual>
            Ajuda e atendimento
          </ActionList.LinkItem>
          <ActionList.Divider />
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
          {/* Ação de segurança, separada do "Sair da conta": o menu fecha normalmente e a
              confirmação explícita (Layout) vem antes de qualquer logout global. */}
          <ActionList.Item variant="danger" disabled={signingOut} onSelect={onLogoutAll}>
            <ActionList.LeadingVisual>
              <DeviceMobileIcon />
            </ActionList.LeadingVisual>
            Sair de todos os dispositivos
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

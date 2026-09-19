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
  ThreeBarsIcon,
  XIcon,
  QuestionIcon,
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useColorMode } from '../hooks/useColorMode'

export function AccountMenu({ onLogout, signingOut }) {
  const [open, setOpen] = useState(false)
  const { key } = useLocation()
  const { isSuperAdmin } = useAuth()
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
          <ActionList.LinkItem as={Link} to="/evocash" replace onClick={() => setOpen(false)}>
            <ActionList.LeadingVisual>
              <CreditCardIcon />
            </ActionList.LeadingVisual>
            Comprar EvoCash
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
              <ActionList.LinkItem as={Link} to="/admin/contas" replace onClick={() => setOpen(false)}>
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
          <ActionList.Item variant="danger" disabled={signingOut} onSelect={onLogout}>
            <ActionList.LeadingVisual>
              <SignOutIcon />
            </ActionList.LeadingVisual>
            {signingOut ? 'Saindo…' : 'Sair da conta'}
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

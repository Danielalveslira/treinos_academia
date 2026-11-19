import { Link } from 'react-router-dom'
import { ActionList, ActionMenu, Box, Text } from '@primer/react'
import { ADMIN_ITEMS } from '../constants/adminNav'

// Mesma lista de ADMIN_ITEMS (fonte única das rotas /admin/*, ver
// constants/adminNav.js) só que sem a página atual -- não faz sentido
// oferecer um link para onde o usuário já está. Pura e exportada para ser
// testável sem montar o ActionMenu.Overlay (portalado, ver AdminNav.test.js).
export function adminNavItems(current) {
  return ADMIN_ITEMS.filter((item) => item.to !== current)
}

// Cabeçalho administrativo compartilhado: dropdown "Administração" com as
// demais rotas + breadcrumb da página atual. Cada página /admin/*
// renderiza isto no topo, no lugar de fileiras de
// botões próprias -- navegação continua client-side (react-router Link),
// sem RPC própria e sem recarregar o app: só o chunk lazy da página de
// destino e os dados que ela mesma busca ao montar.
export default function AdminNav({ current, currentLabel }) {
  const items = adminNavItems(current)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '-8px 0 12px -8px' }}>
      <ActionMenu>
        <ActionMenu.Button variant="invisible">Administração</ActionMenu.Button>
        <ActionMenu.Overlay width="medium">
          <ActionList>
            {items.map((item) => (
              <ActionList.LinkItem key={item.key} as={Link} to={item.to} replace>
                <ActionList.LeadingVisual>
                  <item.icon />
                </ActionList.LeadingVisual>
                {item.label}
              </ActionList.LinkItem>
            ))}
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}> / {currentLabel}</Text>
    </Box>
  )
}

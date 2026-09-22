import { UnderlineNav } from '@primer/react'

export function AdminCashPurchasesTabs({ tab, onSelectTab }) {
  return (
    <UnderlineNav aria-label="Seções de Compras de EvoCash" sx={{ mb: 3 }}>
      <UnderlineNav.Item
        as="button"
        type="button"
        aria-current={tab === 'pedidos' ? 'page' : undefined}
        onSelect={() => onSelectTab('pedidos')}
      >
        Pedidos
      </UnderlineNav.Item>
      <UnderlineNav.Item
        as="button"
        type="button"
        aria-current={tab === 'pix' ? 'page' : undefined}
        onSelect={() => onSelectTab('pix')}
      >
        Configuração PIX
      </UnderlineNav.Item>
    </UnderlineNav>
  )
}

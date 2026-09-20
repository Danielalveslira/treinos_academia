import { BrandMark } from './BrandMark'
import { useAuth } from '../hooks/useAuth'
import { useWallet } from '../hooks/useWallet'

// Indicador compacto de saldo no header (estilo TabNews), ao lado do menu hambúrguer --
// EvoCoins em azul, EvoCash em verde, usando a MESMA marca "Z" (BrandMark) só que com a
// prop `color` sobrescrevendo o bicolor padrão pra uma cor sólida por indicador.
//
// View pura (sem hooks) separada do wrapper que lê os dados de verdade -- mesmo padrão
// de PromoteDialogBody/PromoteDialog: testável só com props, sem precisar mockar
// useAuth/useWallet/Firestore.
export function WalletHeaderBadgesView({ visible, loading, coinBalance, cashBalance }) {
  if (!visible) return null

  return (
    <div className="wallet-header-badges" aria-label="Seu saldo de EvoCoins e EvoCash">
      <span className="wallet-badge" title={loading ? undefined : `${coinBalance} EvoCoins`}>
        <BrandMark size={14} color="var(--fitness-blue)" className="wallet-badge-icon" />
        <span className="wallet-badge-value">{loading ? '—' : coinBalance.toLocaleString('pt-BR')}</span>
      </span>
      <span className="wallet-badge" title={loading ? undefined : `${cashBalance} EvoCash`}>
        <BrandMark size={14} color="var(--fitness-accent)" className="wallet-badge-icon" />
        <span className="wallet-badge-value">{loading ? '—' : cashBalance.toLocaleString('pt-BR')}</span>
      </span>
    </div>
  )
}

// useWallet() é a MESMA fonte já usada por WalletCard.jsx (Perfil) -- leitura sob
// demanda com cache de sessão (ver economyService.js:getWallet), nunca um listener novo
// nem uma segunda forma de calcular saldo.
export function WalletHeaderBadges() {
  const { user } = useAuth()
  const { wallet, loading } = useWallet()

  return (
    <WalletHeaderBadgesView
      visible={!!user}
      loading={loading}
      coinBalance={wallet.coinBalance}
      cashBalance={wallet.cashBalance}
    />
  )
}

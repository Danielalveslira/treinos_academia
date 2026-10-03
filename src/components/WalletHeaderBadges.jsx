import { BrandMark } from './BrandMark'
import { useAuth } from '../hooks/useAuth'
import { useWallet } from '../hooks/useWallet'
import { formatDailyProgress } from '../utils/evocoins'

// Indicador compacto de saldo no header (estilo TabNews), ao lado do menu hambúrguer --
// EvoCoins em azul, EvoCash em verde, usando a MESMA marca "Z" (BrandMark) só que com a
// prop `color` sobrescrevendo o bicolor padrão pra uma cor sólida por indicador.
//
// View pura (sem hooks) separada do wrapper que lê os dados de verdade -- mesmo padrão
// de PromoteDialogBody/PromoteDialog: testável só com props, sem precisar mockar
// useAuth/useWallet/Supabase.
export function WalletHeaderBadgesView({ visible, loading, coinBalance, cashBalance, dailyProgress = null }) {
  if (!visible) return null

  const coinTitle = loading ? undefined : `${coinBalance} EvoCoins${dailyProgress ? ` · ${dailyProgress}` : ''}`

  return (
    <div className="wallet-header-badges" aria-label="Seu saldo de EvoCoins e EvoCash">
      <span className="wallet-badge" title={coinTitle}>
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

// useWallet() é a MESMA fonte já usada por WalletCard.jsx (Perfil) -- 1 canal
// postgres_changes compartilhado por usuário, mantido em WalletContext.jsx, nunca um
// listener novo nem uma segunda forma de calcular saldo (ver useWallet.js).
export function WalletHeaderBadges() {
  const { user } = useAuth()
  const { wallet, loading, dailyCoins } = useWallet()

  return (
    <WalletHeaderBadgesView
      visible={!!user}
      loading={loading}
      coinBalance={wallet.coinBalance}
      cashBalance={wallet.cashBalance}
      dailyProgress={formatDailyProgress(dailyCoins)}
    />
  )
}

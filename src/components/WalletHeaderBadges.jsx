import { BrandMark } from './BrandMark'
import { Link } from 'react-router-dom'
import { QuestionIcon } from '@primer/octicons-react'
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
// `snapshot`: o valor exibido é o ÚLTIMO CONHECIDO guardado no aparelho (modo offline), não uma leitura
// do servidor. Só muda o texto de apoio: o número é o mesmo e nada aqui autoriza gasto.
export function WalletHeaderBadgesView({
  visible,
  loading,
  coinBalance,
  cashBalance,
  dailyProgress = null,
  snapshot = false,
}) {
  if (!visible) return null

  const known = snapshot ? ' (último saldo conhecido)' : ''
  const coinTitle = loading
    ? undefined
    : `${coinBalance} EvoCoins${dailyProgress ? ` · ${dailyProgress}` : ''}${known}`

  return (
    <Link
      className="wallet-header-badges"
      to="/entenda-suas-moedas"
      aria-label="Entenda suas moedas e veja seus saldos de EvoCoins e EvoCash"
      title="Entenda suas moedas"
    >
      <span className="wallet-badge" title={coinTitle}>
        <BrandMark size={14} color="var(--fitness-blue)" className="wallet-badge-icon" />
        <span className="wallet-badge-value">
          {loading ? '—' : coinBalance.toLocaleString('pt-BR')}
        </span>
      </span>
      <span className="wallet-badge" title={loading ? undefined : `${cashBalance} EvoCash${known}`}>
        <BrandMark size={14} color="var(--fitness-accent)" className="wallet-badge-icon" />
        <span className="wallet-badge-value">
          {loading ? '—' : cashBalance.toLocaleString('pt-BR')}
        </span>
      </span>
      <QuestionIcon className="wallet-badges-help" size={16} aria-hidden="true" />
    </Link>
  )
}

// useWallet() é a MESMA fonte usada pela central de moedas -- 1 canal
// postgres_changes compartilhado por usuário, mantido em WalletContext.jsx, nunca um
// listener novo nem uma segunda forma de calcular saldo (ver useWallet.js).
export function WalletHeaderBadges() {
  const { user } = useAuth()
  const { dailyCoins, display } = useWallet()

  // `display` = último valor conhecido (servidor ou snapshot do aparelho). Sem nenhum valor real ainda
  // (carregando, ou offline sem snapshot) o indicador mostra "—": nunca um 0 que pareça saldo.
  return (
    <WalletHeaderBadgesView
      visible={!!user}
      loading={!display}
      coinBalance={display?.coinBalance ?? 0}
      cashBalance={display?.cashBalance ?? 0}
      dailyProgress={formatDailyProgress(dailyCoins)}
      snapshot={display?.source === 'snapshot'}
    />
  )
}

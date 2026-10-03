import { Link } from 'react-router-dom'
import { StarFillIcon, TrophyIcon, CreditCardIcon } from '@primer/octicons-react'
import { Box } from '@primer/react'
import { useWallet } from '../hooks/useWallet'
import { IndicatorCard } from './IndicatorCard'
import { formatDailyProgress } from '../utils/evocoins'

// "UI de saldo" da Fase 1 (seção 33 do prompt de economia): só exibição, sem extrato.
// EvoCash sempre aparece (mesmo zerado) para deixar claro, desde já, que é uma unidade
// separada de EvoCoins. Fase 4: link para /evocash (pacotes/solicitar compra/minhas
// compras) -- esta carteira em si nunca inicia uma compra sozinha.
export function WalletCard() {
  const { wallet, loading, dailyCoins } = useWallet()
  const dailyProgress = formatDailyProgress(dailyCoins)

  return (
    <div className="profile-wallet">
      <h3 className="profile-wallet-heading">Carteira Evolutus</h3>
      <Box className="stats-grid" sx={{ my: 2 }}>
        <IndicatorCard
          label="EvoCoins"
          value={loading ? '—' : wallet.coinBalance}
          icon={StarFillIcon}
        />
        <IndicatorCard
          label="Reputação"
          value={loading ? '—' : wallet.lifetimeCoinsEarned}
          icon={TrophyIcon}
        />
        <IndicatorCard
          label="EvoCash"
          value={loading ? '—' : wallet.cashBalance}
          icon={CreditCardIcon}
        />
      </Box>
      {dailyProgress && <p className="profile-wallet-daily">{dailyProgress}</p>}
      <Link to="/evocash">Comprar EvoCash</Link>
    </div>
  )
}

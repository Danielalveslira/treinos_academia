import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { useWallet } from '../hooks/useWallet'
import { formatAwardMessage } from '../utils/evocoins'

const VISIBLE_MS = 3500

// View pura (só props), testável sem hooks/Supabase -- mesmo padrão de WalletHeaderBadgesView.
export function EvoCoinsAwardNoticeView({ message }) {
  if (!message) return null
  return (
    <div className="evocoin-award-notice" role="status" aria-live="polite">
      <BrandMark size={14} color="var(--fitness-blue)" className="evocoin-award-icon" />
      <span>{message}</span>
    </div>
  )
}

// Aviso discreto "+1 EvoCoin" quando o servidor confirma um crédito (ver WalletContext). Não é
// um modal nem um toast de página: não captura foco nem cliques (pointer-events: none) e some
// sozinho, então nunca interrompe a ação principal -- inclusive créditos que chegam depois
// (publicação/comentário pagos ~15 min depois) com o usuário em qualquer tela.
export function EvoCoinsAwardNotice() {
  const { lastAward } = useWallet()
  const [visibleId, setVisibleId] = useState(null)

  useEffect(() => {
    if (!lastAward) return undefined
    setVisibleId(lastAward.id)
    const timeout = setTimeout(() => setVisibleId(null), VISIBLE_MS)
    return () => clearTimeout(timeout)
  }, [lastAward])

  const message =
    lastAward && visibleId === lastAward.id ? formatAwardMessage(lastAward.coins) : null
  return <EvoCoinsAwardNoticeView message={message} />
}

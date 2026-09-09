import { IconButton, Tooltip } from '@primer/react'
import { ClockIcon } from '@primer/octicons-react'
import { toMillis, formatTimeRemaining } from '../utils/expiry'

// Ícone discreto: o Tooltip oficial do Primer mostra a dica no hover/foco (desktop e
// teclado) e em toque-e-segure no mobile. O rótulo é recalculado a partir de expiresAt
// (já carregado) contra o relógio compartilhado do feed — nenhuma leitura extra ao Firestore.
export function ExpiryBadge({ expiresAt, now }) {
  const label = formatTimeRemaining(toMillis(expiresAt) - now)
  if (!label) return null

  return (
    <Tooltip text={label} direction="nw">
      <IconButton icon={ClockIcon} variant="invisible" size="small" aria-label={label} />
    </Tooltip>
  )
}

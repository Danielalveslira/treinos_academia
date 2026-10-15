import { Label } from '@primer/react'
import { STATUS_LABELS, STATUS_VARIANTS } from '../utils/accounts'

export function AccountStatusBadge({ status, compact = false }) {
  return (
    <Label
      aria-label={STATUS_LABELS[status] || status}
      variant={STATUS_VARIANTS[status] || 'secondary'}
    >
      {compact && status === 'deleting' ? 'Em exclusão' : STATUS_LABELS[status] || status}
    </Label>
  )
}

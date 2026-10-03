import { Label } from '@primer/react'
import { STATUS_LABELS, STATUS_VARIANTS } from '../utils/accounts'

export function AccountStatusBadge({ status }) {
  return (
    <Label variant={STATUS_VARIANTS[status] || 'secondary'}>
      {STATUS_LABELS[status] || status}
    </Label>
  )
}

import { Box, Text } from '@primer/react'
import { formatDateTime } from '../../../utils/format'
import { AUDIT_ACTION_LABELS } from '../utils/accounts'

const who = (username, id) => (username ? `@${username}` : id ? `${id.slice(0, 8)}…` : '—')

export function AuditLogList({ entries, showTarget = false }) {
  if (entries.length === 0) {
    return <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nenhum registro de auditoria.</Text>
  }
  return (
    <Box
      as="ul"
      sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      {entries.map((entry) => (
        <Box
          as="li"
          key={entry.id}
          sx={{ p: 2, border: '1px solid', borderColor: 'border.default', borderRadius: 2 }}
        >
          <Text sx={{ display: 'block', fontWeight: 'bold', fontSize: 1 }}>
            {AUDIT_ACTION_LABELS[entry.action] || entry.action}
            {showTarget && ` — ${who(entry.target_username, entry.target_user_id)}`}
          </Text>
          <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
            por {who(entry.admin_username, entry.admin_user_id)} ·{' '}
            {formatDateTime(entry.created_at)}
            {entry.metadata?.protocol ? ` · ${entry.metadata.protocol}` : ''}
          </Text>
          {entry.reason && (
            <Text sx={{ display: 'block', fontSize: 1, mt: 1, overflowWrap: 'anywhere' }}>
              {entry.reason}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

import { useState } from 'react'
import { Box, Dialog, FormControl, Text, TextInput, Textarea } from '@primer/react'

const label = (account) => (account.username ? `@${account.username}` : account.email || account.id)

// Desativar / reativar uma ou várias contas. `targets` já vem filtrado para o que o banco
// aceitaria; `skipped` só informa quantas da seleção ficaram de fora (ex.: administradores).
export function StatusDialog({ targets, skipped = 0, disabled, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const many = targets.length > 1
  const verb = disabled ? 'Desativar' : 'Reativar'
  const subject = many ? `${targets.length} contas` : label(targets[0])
  const needsReason = disabled && reason.trim().length < 5

  return (
    <Dialog
      title={`${verb} ${subject}?`}
      onClose={saving ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: saving },
        {
          content: disabled ? 'Desativar conta' : 'Reativar conta',
          buttonType: disabled ? 'danger' : 'primary',
          disabled: needsReason || saving,
          onClick: async () => {
            setSaving(true)
            setError((await onConfirm(reason.trim())) || '')
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text>
          {disabled
            ? 'Essa ação impedirá o acesso à conta até que ela seja reativada.'
            : 'A conta voltará a ter acesso ao Evolutus (restrições de moderação vigentes continuam valendo).'}
        </Text>
        {many && (
          <Text sx={{ fontSize: 1, color: 'fg.muted', overflowWrap: 'anywhere' }}>
            {targets.slice(0, 5).map(label).join(', ')}
            {targets.length > 5 ? ` e mais ${targets.length - 5}` : ''}
          </Text>
        )}
        {skipped > 0 && (
          <Text sx={{ fontSize: 1, color: 'attention.fg' }}>
            {skipped}{' '}
            {skipped === 1
              ? 'conta selecionada será ignorada'
              : 'contas selecionadas serão ignoradas'}{' '}
            (administrador, em exclusão ou já no estado final).
          </Text>
        )}
        {error && (
          <Text as="p" role="alert" sx={{ color: 'danger.fg', m: 0 }}>
            {error}
          </Text>
        )}
        {disabled && (
          <FormControl required>
            <FormControl.Label>Motivo (fica na auditoria)</FormControl.Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              block
              placeholder="Descreva o motivo da desativação"
            />
          </FormControl>
        )}
      </Box>
    </Dialog>
  )
}

export function DeleteAccountDialog({ account, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      title={`Excluir permanentemente ${label(account)}?`}
      onClose={saving ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: saving },
        {
          content: 'Excluir permanentemente',
          buttonType: 'danger',
          disabled: confirmation !== 'EXCLUIR' || reason.trim().length < 5 || saving,
          onClick: async () => {
            setSaving(true)
            setError((await onConfirm(reason.trim())) || '')
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text sx={{ fontWeight: 'bold', color: 'danger.fg' }}>
          A conta será bloqueada agora e excluída em etapas. Registros de atendimento preservados
          não serão apagados. Esta ação não pode ser desfeita.
        </Text>
        {error && (
          <Text as="p" role="alert" sx={{ color: 'danger.fg', m: 0 }}>
            {error}
          </Text>
        )}
        <FormControl required>
          <FormControl.Label>Motivo (fica na auditoria)</FormControl.Label>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Digite EXCLUIR para confirmar</FormControl.Label>
          <TextInput
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            block
          />
        </FormControl>
      </Box>
    </Dialog>
  )
}

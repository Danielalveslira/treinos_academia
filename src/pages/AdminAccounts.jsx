import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Box,
  Heading,
  Text,
  Button,
  Spinner,
  Label,
  Dialog,
  FormControl,
  TextInput,
  Textarea,
  ActionMenu,
  ActionList,
  IconButton,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PersonIcon, KebabHorizontalIcon, TrashIcon, BlockedIcon, CheckIcon } from '@primer/octicons-react'
import { useAdminAccounts } from '../hooks/useAdminAccounts'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

function actionError(error, fallback) {
  return [
    'functions/failed-precondition',
    'functions/invalid-argument',
    'functions/already-exists',
    'functions/not-found',
  ].includes(error?.code)
    ? error.message
    : fallback
}

function DisableDialog({ account, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      title={`Desativar conta de ${account.username || account.email || account.id}`}
      onClose={saving ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: saving },
        {
          content: 'Desativar conta',
          buttonType: 'danger',
          disabled: reason.trim().length < 5 || saving,
          onClick: async () => {
            setSaving(true)
            setError((await onConfirm(reason)) || '')
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3 }}>
        {error && (
          <Text as="p" role="alert" sx={{ color: 'danger.fg' }}>
            {error}
          </Text>
        )}
        <FormControl required>
          <FormControl.Label>Motivo</FormControl.Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            block
            placeholder="Descreva o motivo da desativação"
          />
        </FormControl>
      </Box>
    </Dialog>
  )
}

function DeleteAccountDialog({ account, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      title={`Excluir permanentemente ${account.username || account.email || account.id}`}
      onClose={saving ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: saving },
        {
          content: 'Excluir permanentemente',
          buttonType: 'danger',
          disabled: confirmation !== 'EXCLUIR' || saving,
          onClick: async () => {
            setSaving(true)
            setError((await onConfirm()) || '')
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
          <Text as="p" role="alert" sx={{ color: 'danger.fg' }}>
            {error}
          </Text>
        )}
        <FormControl>
          <FormControl.Label>Digite EXCLUIR para confirmar</FormControl.Label>
          <TextInput value={confirmation} onChange={(e) => setConfirmation(e.target.value)} block />
        </FormControl>
      </Box>
    </Dialog>
  )
}

export default function AdminAccounts() {
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('usuario') || '')
  const { accounts, jobs, loading, error, busy, hasMore, loadMore, refresh, disable, enable, remove } =
    useAdminAccounts(search)
  const { toasts, showToast } = useToast()
  const [dialog, setDialog] = useState(null) // { type: 'disable'|'delete', account }

  const filtered = accounts

  async function handleDisable(reason) {
    try {
      await disable(dialog.account.id, reason)
      setDialog(null)
      showToast('Conta desativada.')
    } catch (err) {
      console.error('[AdminAccounts] disable:', err)
      return actionError(err, 'Erro ao desativar conta.')
    }
  }

  async function handleEnable(account) {
    try {
      await enable(account.id)
      showToast('Conta ativada.')
    } catch (err) {
      console.error('[AdminAccounts] enable:', err)
      showToast('Erro ao ativar conta.', 'danger')
    }
  }

  async function handleDelete() {
    try {
      await remove(dialog.account.id)
      setDialog(null)
      showToast('Exclusão agendada. A conta já está bloqueada.')
    } catch (err) {
      console.error('[AdminAccounts] delete:', err)
      return actionError(err, 'Erro ao excluir conta.')
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/comunidades" replace>
          Administrar comunidades
        </Button>
        <Button as={Link} to="/admin/moderacao" replace>
          Atendimento e moderação
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Contas
      </Heading>

      <FormControl sx={{ mb: 3 }}>
        <FormControl.Label visuallyHidden>Buscar conta</FormControl.Label>
        <TextInput
          placeholder="Início do @usuário, e-mail completo ou UID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          block
        />
      </FormControl>

      <Button onClick={refresh} disabled={loading || !!busy} sx={{ mb: 3 }}>
        Atualizar lista
      </Button>
      {jobs.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Heading as="h2" sx={{ fontSize: 2 }}>
            Exclusões em andamento
          </Heading>
          {jobs.map((job) => (
            <Text as="p" key={job.id} sx={{ fontSize: 1, overflowWrap: 'anywhere' }}>
              {job.kind}: {job.targetId} —{' '}
              {job.lastError ? 'Nova tentativa automática pendente' : 'Em processamento'}
            </Text>
          ))}
        </Box>
      )}
      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && filtered.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <PersonIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhuma conta encontrada</Blankslate.Heading>
        </Blankslate>
      )}

      {filtered.length > 0 && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {filtered.map((account, index) => (
            <Box
              key={account.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
                px: 3,
                py: 2,
                borderTop: index === 0 ? 'none' : '1px solid',
                borderColor: 'border.default',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Text sx={{ fontWeight: 'bold' }}>
                    {account.username ? `@${account.username}` : account.email || account.id}
                  </Text>
                  <Label variant={account.accountStatus === 'disabled' ? 'danger' : 'success'}>
                    {account.accountStatus === 'deleting'
                      ? 'Em exclusão'
                      : account.accountStatus === 'disabled'
                        ? 'Desativada'
                        : 'Ativa'}
                  </Label>
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{account.email}</Text>
              </Box>

              {account.role !== 'superadmin' && account.accountStatus !== 'deleting' && (
                <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {account.accountStatus === 'disabled' ? (
                    <Button
                      size="small"
                      disabled={!!busy}
                      leadingVisual={CheckIcon}
                      onClick={() => handleEnable(account)}
                    >
                      Ativar
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      disabled={!!busy}
                      leadingVisual={BlockedIcon}
                      onClick={() => setDialog({ type: 'disable', account })}
                    >
                      Desativar
                    </Button>
                  )}

                  <ActionMenu>
                    <ActionMenu.Anchor>
                      <IconButton
                        disabled={!!busy}
                        icon={KebabHorizontalIcon}
                        variant="invisible"
                        aria-label="Mais ações"
                        sx={{ color: 'fg.muted' }}
                      />
                    </ActionMenu.Anchor>
                    <ActionMenu.Overlay align="end">
                      <ActionList>
                        <ActionList.Item
                          variant="danger"
                          onSelect={() => setDialog({ type: 'delete', account })}
                        >
                          <ActionList.LeadingVisual>
                            <TrashIcon />
                          </ActionList.LeadingVisual>
                          Excluir permanentemente
                        </ActionList.Item>
                      </ActionList>
                    </ActionMenu.Overlay>
                  </ActionMenu>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {hasMore && (
        <Button onClick={loadMore} disabled={loading} sx={{ mt: 3 }}>
          Carregar mais contas
        </Button>
      )}

      {dialog?.type === 'disable' && (
        <DisableDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onConfirm={handleDisable}
        />
      )}
      {dialog?.type === 'delete' && (
        <DeleteAccountDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onConfirm={handleDelete}
        />
      )}
    </Box>
  )
}

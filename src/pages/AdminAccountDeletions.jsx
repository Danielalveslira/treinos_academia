import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Label,
  Spinner,
  Text,
  Textarea,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ShieldLockIcon } from '@primer/octicons-react'
import { useAdminAccountDeletions } from '../hooks/useAdminAccountDeletions'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { formatDateTime } from '../utils/format'

const BLOCK_REASON_LABELS = {
  pending_cash_purchase: 'Compra de EvoCash pendente',
  positive_cash_balance: 'Saldo de EvoCash positivo',
}

const REVIEW_RESULT_LABELS = {
  resumed: 'Retomou a exclusão',
  still_blocked: 'Continuou bloqueado',
}

function toDate(value) {
  return value ? new Date(value) : null
}

// Painel "Exclusão de contas" (correção do bug "conta com exclusão bloqueada"): antes
// desta tela, um job em blocked_financial_review não aparecia em NENHUM lugar do
// painel admin -- listDeletionJobs (usado em AdminAccounts) só lista state=='pending'.
// A única ação disponível aqui é revalidar o bloqueio com os valores REAIS e atuais da
// carteira -- nunca um botão de "forçar exclusão", e nenhuma ação daqui altera saldo,
// ledger ou qualquer dado financeiro (ver reviewFinancialBlock em deletion-service.js).
// Resolver de fato um saldo positivo (positive_cash_balance) ainda não tem um
// procedimento seguro implementado neste sistema -- ver o comentário em
// cash-purchase-service.js (reactivateDeletionIfClear): confirmar uma compra credita
// EvoCash (deixa o saldo positivo, nunca zera), e não existe nenhuma operação de
// estorno/perda de saldo. Essa é uma decisão de negócio/jurídica ainda em aberto; esta
// tela só torna a pendência visível e auditável, e retoma automaticamente assim que a
// causa (qualquer uma das duas) deixar de existir, por qualquer via legítima.
export default function AdminAccountDeletions() {
  const { jobs, usernameById, loading, error, busy, refresh, review } = useAdminAccountDeletions()
  const { toasts, showToast } = useToast()
  const [noteDraft, setNoteDraft] = useState({}) // { [jobId]: string }
  const [actionError, setActionError] = useState({}) // { [jobId]: string }

  async function handleReview(jobId) {
    setActionError((previous) => ({ ...previous, [jobId]: '' }))
    try {
      const result = await review(jobId, noteDraft[jobId])
      showToast(
        result.resumed
          ? 'Bloqueio removido -- a exclusão será retomada automaticamente.'
          : `Revisão registrada -- continua bloqueado (${BLOCK_REASON_LABELS[result.blockReason] || result.blockReason}).`
      )
      setNoteDraft((previous) => ({ ...previous, [jobId]: '' }))
    } catch (err) {
      console.error('[AdminAccountDeletions] review:', err)
      setActionError((previous) => ({
        ...previous,
        [jobId]: ['functions/failed-precondition', 'functions/invalid-argument', 'functions/not-found'].includes(
          err?.code
        )
          ? err.message
          : 'Não foi possível registrar a revisão. Tente novamente.',
      }))
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/contas" replace>
          Contas
        </Button>
        <Button as={Link} to="/admin/compras-evocash" replace>
          Compras de EvoCash
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 2 }}>
        Exclusão de contas
      </Heading>
      <Text as="p" sx={{ color: 'fg.muted', mb: 3 }}>
        Solicitações de exclusão bloqueadas aguardando revisão financeira. Revisar aqui nunca altera
        saldo, ledger ou qualquer dado financeiro -- só confirma se o motivo do bloqueio ainda é
        válido e, se não for, retoma a exclusão automaticamente.
      </Text>

      <Button onClick={refresh} disabled={loading} sx={{ mb: 3 }}>
        Atualizar lista
      </Button>
      {loading && jobs.length === 0 && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && jobs.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <ShieldLockIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhuma exclusão aguardando revisão</Blankslate.Heading>
        </Blankslate>
      )}

      {jobs.map((job) => (
        <Box
          as="article"
          key={job.id}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: 3,
            mb: 3,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
            <Box>
              <Text sx={{ fontWeight: 'bold' }}>
                {usernameById[job.targetId] ? `@${usernameById[job.targetId]}` : job.targetId}
              </Text>
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                {job.targetId} · solicitada em {formatDateTime(toDate(job.createdAt)) || '—'}
                {job.requestedBy ? ` · por ${job.requestedBy}` : ''}
              </Text>
            </Box>
            <Label variant="attention">{BLOCK_REASON_LABELS[job.blockReason] || job.blockReason}</Label>
          </Box>

          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Text as="p" sx={{ fontSize: 1, m: 0 }}>
              Saldo atual: <strong>{job.cashBalance} EvoCash</strong>
            </Text>
            {job.pendingPurchaseId && (
              <Text as="p" sx={{ fontSize: 1, m: 0 }}>
                Compra pendente: <strong>{job.pendingPurchaseId}</strong>
              </Text>
            )}
          </Box>

          <Link to={`/admin/contas?usuario=${encodeURIComponent(job.targetId)}`}>Ver conta</Link>
          {job.pendingPurchaseId && (
            <Link to="/admin/compras-evocash">Ver compras de EvoCash pendentes</Link>
          )}

          {job.history.length > 0 && (
            <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
              <Text sx={{ fontWeight: 'bold', fontSize: 0 }}>Histórico de revisões</Text>
              {job.history.map((entry) => (
                <Text as="p" key={entry.id} sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  {formatDateTime(toDate(entry.checkedAt))} · {entry.adminId} —{' '}
                  {REVIEW_RESULT_LABELS[entry.resultingState] || entry.resultingState}
                  {entry.note ? `: "${entry.note}"` : ''}
                </Text>
              ))}
            </Box>
          )}

          <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
            {actionError[job.id] && (
              <Flash variant="danger" role="alert" sx={{ mb: 2 }}>
                {actionError[job.id]}
              </Flash>
            )}
            <FormControl disabled={busy === job.id}>
              <FormControl.Label>
                Nota da revisão <span className="profile-optional">(opcional)</span>
              </FormControl.Label>
              <Textarea
                block
                maxLength={500}
                rows={2}
                placeholder="Ex.: saldo confirmado com o financeiro, aguardando estorno"
                value={noteDraft[job.id] || ''}
                onChange={(event) =>
                  setNoteDraft((previous) => ({ ...previous, [job.id]: event.target.value }))
                }
              />
            </FormControl>
            <Button
              variant="primary"
              sx={{ mt: 2 }}
              loading={busy === job.id}
              disabled={!!busy && busy !== job.id}
              onClick={() => handleReview(job.id)}
            >
              Revalidar bloqueio
            </Button>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

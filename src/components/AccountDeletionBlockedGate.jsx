import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { logoutUser } from '../services/authService'
import { describeDeletionProgress } from '../utils/accountDeletion'
import { formatDateTime } from '../utils/format'

const STEP_MARK = { done: '✓', current: '●', todo: '○' }

// Tela "Exclusão em análise": mostrada enquanto a exclusão solicitada está em revisão
// financeira (blocked_financial_review) ou, depois que um administrador separou a
// pendência financeira, até o worker concluir. Só um administrador decide isso -- nunca o
// próprio titular -- por isso as únicas ações são atualizar a situação e sair da conta.
// Mostra apenas o que get_my_deletion_review considera público para o titular (estado,
// protocolos, se a pendência foi separada): NUNCA saldo, valores ou motivo do bloqueio,
// mesmo que a própria carteira continue legível pelo dono via RLS.
export function AccountDeletionBlockedGate() {
  const { deletionReview, refreshDeletionReview } = useAuth()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const progress = describeDeletionProgress(deletionReview)

  async function handleRefresh() {
    setRefreshing(true)
    setError('')
    try {
      const review = await refreshDeletionReview()
      // Sem exclusão em andamento: concluída (a sessão deixa de valer) ou cancelada (a
      // conta foi reativada) -- recarregar resolve os dois casos.
      if (!review) window.location.reload()
    } catch {
      setError('Não foi possível atualizar agora. Se a exclusão já foi concluída, saia da conta.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="deletion-blocked-title">
        <h1 id="deletion-blocked-title">{progress.headline}</h1>
        {deletionReview?.protocol && (
          <p>
            Protocolo: <strong>{deletionReview.protocol}</strong>
            {deletionReview.requestedAt && (
              <> · solicitada em {formatDateTime(new Date(deletionReview.requestedAt))}</>
            )}
          </p>
        )}
        <p>
          Situação atual: <strong>{progress.situation}</strong>
        </p>

        <ol aria-label="Andamento da exclusão" style={{ listStyle: 'none', padding: 0 }}>
          {progress.steps.map((step) => (
            <li key={step.key} aria-current={step.status === 'current' ? 'step' : undefined}>
              <span aria-hidden="true">{STEP_MARK[step.status]}</span> {step.label}
              {step.key === 'case_separated' && deletionReview?.financialCaseProtocol && (
                <> (protocolo {deletionReview.financialCaseProtocol})</>
              )}
            </li>
          ))}
        </ol>

        {progress.separatedMessage ? (
          <p>{progress.separatedMessage}</p>
        ) : (
          <p>
            A exclusão da sua conta foi solicitada, mas está temporariamente em análise financeira.
            Nossa equipe fará essa revisão e entrará em contato para concluir o processo.
          </p>
        )}
        <p>
          Para dúvidas ou para acompanhar o andamento, entre em contato pelo{' '}
          <Link to="/atendimento">atendimento</Link> informando o protocolo
          {deletionReview?.financialCaseSeparated ? ' do processo financeiro' : ' da exclusão'}.
        </p>
        {error && <Flash variant="danger">{error}</Flash>}
        <Button onClick={handleRefresh} disabled={refreshing} sx={{ mr: 2 }}>
          Atualizar situação
        </Button>
        <Button onClick={logoutUser}>Sair da conta</Button>
      </section>
    </PublicLayout>
  )
}

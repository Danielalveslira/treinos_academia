import { useEffect, useRef, useState } from 'react'
import { Button, Flash, Spinner } from '@primer/react'
import {
  listOpenShowcaseReports,
  listPendingProfessionalListings,
  resolveProfessionalListingReport,
  reviewProfessionalListing,
} from '../services/professionalListingsService'

export default function AdminProfessionalListings() {
  const [pending, setPending] = useState(null)
  const [reports, setReports] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const busyRef = useRef(false)

  async function load() {
    try {
      const [submissions, openReports] = await Promise.all([
        listPendingProfessionalListings(),
        listOpenShowcaseReports(),
      ])
      setPending(submissions)
      setReports(openReports)
      setError('')
      return true
    } catch {
      setPending((current) => current ?? [])
      setReports((current) => current ?? [])
      setError('Não foi possível carregar a fila de vitrines.')
      return false
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function decide(listingId, decision) {
    if (busyRef.current) return
    const reason = decision === 'rejected' ? window.prompt('Motivo da rejeição:') : ''
    if (decision === 'rejected' && !reason) return
    if (decision === 'rejected' && reason.trim().length < 5) {
      setError('O motivo da rejeição deve ter pelo menos 5 caracteres.')
      return
    }
    busyRef.current = true
    setBusy(`${listingId}:${decision}`)
    setError('')
    setSuccess('')
    try {
      await reviewProfessionalListing(listingId, decision, reason)
      if (await load())
        setSuccess(decision === 'approved' ? 'Vitrine aprovada e publicada.' : 'Vitrine rejeitada.')
    } catch (actionError) {
      setError(actionError?.message || 'A decisão não foi aplicada.')
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  async function decideReport(report, action) {
    if (busyRef.current) return
    const reason = action === 'suspend' ? window.prompt('Motivo da suspensão:') : ''
    if (action === 'suspend' && !reason) return
    if (action === 'suspend' && reason.trim().length < 5) {
      setError('O motivo da suspensão deve ter pelo menos 5 caracteres.')
      return
    }
    busyRef.current = true
    setBusy(`${report.id}:${action}`)
    setError('')
    setSuccess('')
    try {
      await resolveProfessionalListingReport(report.id, action, reason)
      if (await load())
        setSuccess(
          action === 'suspend'
            ? 'Vitrine suspensa e denúncia resolvida.'
            : 'Denúncia resolvida sem ação.'
        )
    } catch (actionError) {
      setError(actionError?.message || 'A denúncia não foi decidida.')
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  return (
    <div className="admin-listings-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">ADMINISTRAÇÃO</span>
        <h1>Vitrines profissionais</h1>
        <p>Aprovação de conteúdo não representa certificação profissional.</p>
      </header>
      {error && (
        <Flash variant="danger" role="alert">
          {error}{' '}
          <Button size="small" onClick={load} disabled={Boolean(busy)}>
            Atualizar fila
          </Button>
        </Flash>
      )}
      {success && (
        <Flash variant="success" role="status">
          {success}
        </Flash>
      )}
      <section className="admin-listing-section">
        <div className="admin-listing-section-heading">
          <div>
            <span className="profile-eyebrow">FILA DE REVISÃO</span>
            <h2>Submissões pendentes</h2>
          </div>
          {pending && <span className="admin-listing-count">{pending.length}</span>}
        </div>
        {pending === null ? (
          <Spinner aria-label="Carregando submissões" />
        ) : pending.length === 0 ? (
          <p>Nenhuma submissão pendente.</p>
        ) : (
          <div className="admin-listing-stack">
            {pending.map((draft) => (
              <article key={draft.id} className="admin-listing-item admin-listing-item-pending">
                <div className="admin-listing-copy">
                  <span className="admin-listing-status">Aguardando análise</span>
                  <strong>{draft.displayName}</strong>
                  <span>
                    {draft.kind === 'professional' ? 'Profissional' : 'Espaço'} · {draft.city}/
                    {draft.uf}
                  </span>
                  <p>{draft.bio}</p>
                  <small>
                    ID: {draft.id} · versão {draft.version}
                  </small>
                </div>
                <div className="admin-listing-actions">
                  <Button
                    variant="primary"
                    onClick={() => decide(draft.id, 'approved')}
                    loading={busy === `${draft.id}:approved`}
                    disabled={Boolean(busy)}
                  >
                    Aprovar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => decide(draft.id, 'rejected')}
                    loading={busy === `${draft.id}:rejected`}
                    disabled={Boolean(busy)}
                  >
                    Rejeitar
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="admin-listing-section">
        <div className="admin-listing-section-heading">
          <div>
            <span className="profile-eyebrow">MODERAÇÃO</span>
            <h2>Denúncias abertas</h2>
          </div>
          {reports && <span className="admin-listing-count">{reports.length}</span>}
        </div>
        {reports === null ? (
          <Spinner aria-label="Carregando denúncias" />
        ) : reports.length === 0 ? (
          <p>Nenhuma denúncia aberta.</p>
        ) : (
          <div className="admin-listing-stack">
            {reports.map((report) => (
              <article key={report.id} className="admin-listing-item">
                <div className="admin-listing-copy">
                  <strong>Vitrine {report.listingId}</strong>
                  <p>{report.message}</p>
                </div>
                <div className="admin-listing-actions">
                  <Button
                    onClick={() => decideReport(report, 'no_action')}
                    loading={busy === `${report.id}:no_action`}
                    disabled={Boolean(busy)}
                  >
                    Sem ação
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => decideReport(report, 'suspend')}
                    loading={busy === `${report.id}:suspend`}
                    disabled={Boolean(busy)}
                  >
                    Suspender vitrine
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

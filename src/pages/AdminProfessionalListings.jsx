import { useEffect, useState } from 'react'
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

  async function load() {
    setError('')
    try {
      const [submissions, openReports] = await Promise.all([
        listPendingProfessionalListings(),
        listOpenShowcaseReports(),
      ])
      setPending(submissions)
      setReports(openReports)
    } catch {
      setError('Não foi possível carregar a fila de vitrines.')
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function decide(listingId, decision) {
    const reason = decision === 'rejected' ? window.prompt('Motivo da rejeição:') : ''
    if (decision === 'rejected' && !reason) return
    setBusy(listingId)
    try {
      await reviewProfessionalListing(listingId, decision, reason)
      await load()
    } catch (actionError) {
      setError(actionError?.message || 'A decisão não foi aplicada.')
    } finally {
      setBusy('')
    }
  }

  async function decideReport(report, action) {
    const reason = action === 'suspend' ? window.prompt('Motivo da suspensão:') : ''
    if (action === 'suspend' && !reason) return
    setBusy(report.id)
    try {
      await resolveProfessionalListingReport(report.id, action, reason)
      await load()
    } catch (actionError) {
      setError(actionError?.message || 'A denúncia não foi decidida.')
    } finally {
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
      {error && <Flash variant="danger">{error}</Flash>}
      <section className="admin-listing-section">
        <h2>Submissões pendentes</h2>
        {pending === null ? (
          <Spinner aria-label="Carregando submissões" />
        ) : pending.length === 0 ? (
          <p>Nenhuma submissão pendente.</p>
        ) : (
          <div className="admin-listing-stack">
            {pending.map((draft) => (
              <article key={draft.id}>
                <div>
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
                <div>
                  <Button
                    variant="primary"
                    onClick={() => decide(draft.id, 'approved')}
                    loading={busy === draft.id}
                  >
                    Aprovar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => decide(draft.id, 'rejected')}
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
        <h2>Denúncias abertas</h2>
        {reports === null ? (
          <Spinner aria-label="Carregando denúncias" />
        ) : reports.length === 0 ? (
          <p>Nenhuma denúncia aberta.</p>
        ) : (
          <div className="admin-listing-stack">
            {reports.map((report) => (
              <article key={report.id}>
                <div>
                  <strong>Vitrine {report.listingId}</strong>
                  <p>{report.message}</p>
                </div>
                <div>
                  <Button
                    onClick={() => decideReport(report, 'no_action')}
                    disabled={Boolean(busy)}
                  >
                    Sem ação
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => decideReport(report, 'suspend')}
                    loading={busy === report.id}
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

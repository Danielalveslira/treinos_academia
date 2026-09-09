import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Flash, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { LegalConsent } from './LegalConsent'
import { useAuth } from '../hooks/useAuth'
import { getLegalAccess, acceptLegalDocuments } from '../services/legalService'
import { logoutUser } from '../services/authService'
import { isAccountRestricted, LEGAL_MANIFEST, needsLegalAcceptance } from '../utils/legal'

export function LegalGate({ children }) {
  const { user, profile, refreshProfile } = useAuth()
  const [access, setAccess] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState({
    accepted: false,
    healthDataConsent: false,
    ageConfirmed: false,
  })
  useEffect(() => {
    if (!LEGAL_MANIFEST.published) return
    let active = true
    getLegalAccess(user.uid)
      .then((data) => {
        if (active) setAccess(data)
      })
      .catch(() => {
        if (active) setError('Não foi possível verificar os documentos. Tente novamente.')
      })
    return () => {
      active = false
    }
  }, [user.uid, attempt])
  if (!LEGAL_MANIFEST.published) return children
  const restricted = isAccountRestricted(access?.restriction)
  const outdated =
    access &&
    (access.policy?.version !== LEGAL_MANIFEST.version || access.policy?.published !== true)
  if (
    access &&
    !restricted &&
    !outdated &&
    !needsLegalAcceptance(profile?.legalAcceptance, access.policy.version)
  )
    return children

  async function accept(e) {
    e.preventDefault()
    if (saving || !Object.values(confirmed).every(Boolean)) return
    setSaving(true)
    setError('')
    try {
      await acceptLegalDocuments(confirmed)
      await refreshProfile(user.uid)
    } catch {
      setError(
        'Não foi possível salvar o aceite. Suas confirmações foram mantidas; tente novamente.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="legal-gate-title">
        <h1 id="legal-gate-title">
          {restricted ? 'Acesso restrito' : 'Documentos para continuar'}
        </h1>
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        {!access && !error && <Spinner aria-label="Verificando documentos" />}
        {!access && error && (
          <Button
            onClick={() => {
              setError('')
              setAttempt((n) => n + 1)
            }}
          >
            Tentar novamente
          </Button>
        )}
        {restricted && (
          <p>
            Sua conta recebeu uma restrição. Consulte a fundamentação e envie um recurso pelo{' '}
            <Link to="/atendimento">atendimento</Link>.
          </p>
        )}
        {outdated && (
          <p>
            Os documentos estão sendo atualizados.{' '}
            <Button onClick={() => window.location.reload()}>Recarregar</Button>
          </p>
        )}
        {access && !restricted && !outdated && (
          <form onSubmit={accept}>
            <p>
              Leia a versão {LEGAL_MANIFEST.version}. O atendimento permanece disponível antes da
              sua decisão.
            </p>
            <ul>
              {LEGAL_MANIFEST.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            <LegalConsent value={confirmed} onChange={setConfirmed} disabled={saving} />
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              Aceitar e continuar
            </Button>
          </form>
        )}
        <p>
          <Link to="/atendimento">Atendimento, recursos e privacidade</Link>
        </p>
        <Button onClick={logoutUser} disabled={saving}>
          Sair da conta
        </Button>
      </section>
    </PublicLayout>
  )
}

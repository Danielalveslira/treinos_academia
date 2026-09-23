import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, FormControl, TextInput, Flash, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { LegalConsent } from './LegalConsent'
import { useAuth } from '../hooks/useAuth'
import { acceptLegalDocuments, isLegalPolicyChangedError } from '../services/legalService'
import { setBirthInfo } from '../services/usersService'
import { logoutUser } from '../services/authService'
import { resolveLegalGateState } from '../utils/legal'
import { validateBirthDate, hasErrors } from '../utils/validators'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

export function LegalGate({ children }) {
  const {
    user,
    profile,
    legalAccess: access,
    legalLoading,
    legalError,
    refreshProfile,
    refreshLegalAccess,
  } = useAuth()
  const [error, setError] = useState('')
  const [policyChanged, setPolicyChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState({
    accepted: false,
    healthDataConsent: false,
  })
  // Contas que existiam antes deste campo ainda não têm data de nascimento —
  // acceptLegalDocuments (index.js) agora exige essa data pra confirmar a idade
  // mínima no servidor, então quem chega aqui sem ela precisa informar antes de
  // conseguir aceitar uma versão nova dos documentos. Quem já tem, não vê o campo.
  const [birthDate, setBirthDate] = useState('')
  const [birthDateError, setBirthDateError] = useState('')
  const gateState = resolveLegalGateState({
    profile,
    access,
    loading: legalLoading,
    error: legalError,
  })

  if (gateState === 'loading') {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}
      >
        <Spinner aria-label="Verificando acesso" />
      </Box>
    )
  }
  if (gateState === 'allowed') return children

  const restricted = gateState === 'restricted'
  const policyUnavailable = gateState === 'policy-unavailable'
  const accessError = gateState === 'error'

  const needsBirthDate = !profile?.dataNascimento
  const legalBundle = access?.legalBundle

  async function accept(e) {
    e.preventDefault()
    if (saving || !Object.values(confirmed).every(Boolean)) return
    if (needsBirthDate) {
      const errors = validateBirthDate(birthDate, {
        minimumAge: legalBundle.manifest.minimumAge,
      })
      setBirthDateError(errors.birthDate || '')
      if (hasErrors(errors)) return
    }
    setSaving(true)
    setError('')
    try {
      if (needsBirthDate) await setBirthInfo(user.uid, { dataNascimento: birthDate })
      await acceptLegalDocuments(confirmed, legalBundle)
      await refreshProfile(user.uid)
    } catch (err) {
      // A própria Cloud Function já identifica esse caso com precisão (assertWritableAccount
      // em functions/index.js) — normalmente o AuthContext já teria encerrado a sessão
      // sozinho antes de chegar aqui (ver handlePossibleGhostSession), mas se a conta foi
      // excluída bem no meio dessa tentativa de aceite, é mais honesto avisar e sair do
      // que insistir num "tente novamente" que nunca vai funcionar.
      if (err?.message === 'A conta está em exclusão.') {
        setError('Sua sessão não é mais válida. Você será desconectado.')
        await logoutUser().catch(() => {})
        return
      }
      if (isLegalPolicyChangedError(err) || err?.message === 'LEGAL_POLICY_INCOMPATIBLE') {
        setPolicyChanged(true)
        return
      }
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
          {restricted
            ? 'Acesso restrito'
            : accessError
              ? 'Não foi possível verificar seu acesso'
              : policyUnavailable
                ? 'Documentos indisponíveis'
                : 'Antes de continuar'}
        </h1>
        {(error || accessError) && (
          <Flash variant="danger" role="alert">
            {error || `${legalError} Verifique sua conexão e tente novamente.`}
          </Flash>
        )}
        {accessError && (
          <Button onClick={() => refreshLegalAccess(user.uid)}>Tentar novamente</Button>
        )}
        {restricted && (
          <p>
            Sua conta recebeu uma restrição. Consulte a fundamentação e envie um recurso pelo{' '}
            <Link to="/atendimento">atendimento</Link>.
          </p>
        )}
        {policyUnavailable && (
          <p>
            A policy publicada não corresponde a esta versão do app.{' '}
            <Button onClick={() => window.location.reload()}>Recarregar</Button>
          </p>
        )}
        {policyChanged && (
          <Flash variant="warning" role="alert">
            A Política de Privacidade mudou nesta aba. Recarregue a página para ler a versão ativa.
          </Flash>
        )}
        {gateState === 'acceptance-required' && !policyChanged && (
          <form onSubmit={accept}>
            <p>
              Leia a versão {legalBundle.manifest.version}. O atendimento permanece disponível antes
              da sua decisão.
            </p>
            <ul>
              {legalBundle.manifest.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            {needsBirthDate && (
              <FormControl required disabled={saving}>
                <FormControl.Label>Data de nascimento</FormControl.Label>
                <TextInput
                  type="date"
                  value={birthDate}
                  onChange={(e) => {
                    setBirthDate(e.target.value)
                    setBirthDateError('')
                  }}
                  max={todayString()}
                  block
                />
                <FormControl.Caption>
                  Necessária para confirmar a idade mínima ({legalBundle.manifest.minimumAge} anos)
                  — sua conta ainda não tinha essa informação.
                </FormControl.Caption>
                {birthDateError && (
                  <FormControl.Validation variant="error">{birthDateError}</FormControl.Validation>
                )}
              </FormControl>
            )}
            <LegalConsent
              value={confirmed}
              onChange={setConfirmed}
              disabled={saving}
              legalBundle={legalBundle}
            />
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              Aceitar e continuar
            </Button>
          </form>
        )}
        {policyChanged && <Button onClick={() => window.location.reload()}>Recarregar</Button>}
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

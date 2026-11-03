import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, FormControl, TextInput, Flash, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { LegalConsent } from './LegalConsent'
import { useAuth } from '../hooks/useAuth'
import { acceptLegalDocuments, isLegalPolicyChangedError } from '../services/legalService'
import { setBirthInfo } from '../services/usersService'
import { logoutUser } from '../services/authService'
import { LogoutButton } from './LogoutButton'
import { resolveLegalGateState } from '../utils/legal'
import { validateBirthDate, hasErrors } from '../utils/validators'
import { MINIMUM_AGE_MESSAGE, registrationMinimumAge } from '../constants/accountAge'
import { businessDayKey } from '../utils/businessDate'

// Comprovantes e reembolsos continuam acessíveis sem o aceite da versão vigente (o servidor
// usa private.require_rights_user nessas RPCs). Carregado só quando o painel é aberto.
const HealthConsentSettings = lazy(() =>
  import('./HealthConsentSettings').then((module) => ({ default: module.HealthConsentSettings }))
)
const RefundRequestsPanel = lazy(() =>
  import('./Refunds').then((module) => ({ default: module.RefundRequestsPanel }))
)

const LEGAL_RECHECK_MIN_INTERVAL_MS = 30 * 1000

function todayString() {
  return businessDayKey()
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
  // O painel de direitos só carrega (e consulta o servidor) quando aberto.
  const [rightsOpen, setRightsOpen] = useState(false)
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

  // Revalida termos/restrições ao voltar para a aba -- em segundo plano (silent) e no máximo
  // uma vez por LEGAL_RECHECK_MIN_INTERVAL_MS, para não refazer 3 consultas a cada troca de aba.
  const lastLegalCheck = useRef(Date.now())
  const refreshLegalAccessRef = useRef(refreshLegalAccess)
  refreshLegalAccessRef.current = refreshLegalAccess
  useEffect(() => {
    if (!user?.uid) return undefined
    const checkActivePolicy = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLegalCheck.current < LEGAL_RECHECK_MIN_INTERVAL_MS) return
      lastLegalCheck.current = Date.now()
      refreshLegalAccessRef.current(user.uid, { silent: true })
    }
    document.addEventListener('visibilitychange', checkActivePolicy)
    return () => document.removeEventListener('visibilitychange', checkActivePolicy)
  }, [user?.uid])

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
    if (saving || confirmed.accepted !== true) return
    if (needsBirthDate) {
      const errors = validateBirthDate(birthDate, {
        minimumAge: registrationMinimumAge(legalBundle.manifest),
      })
      setBirthDateError(errors.birthDate || '')
      if (hasErrors(errors)) return
    }
    setSaving(true)
    setError('')
    try {
      if (needsBirthDate) await setBirthInfo(user.uid, { dataNascimento: birthDate })
      await acceptLegalDocuments(confirmed, legalBundle, 'reacceptance')
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
      if (err?.message === 'MINIMUM_AGE') {
        // Data recém-informada: o erro fica no campo. Conta antiga já com data (preexistente de
        // menor): aviso geral; atendimento, privacidade e reembolsos seguem disponíveis abaixo.
        if (needsBirthDate) setBirthDateError(MINIMUM_AGE_MESSAGE)
        else setError('O Evolutus é exclusivo para pessoas com 18 anos completos ou mais.')
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
            Os documentos foram atualizados e esta versão do app ainda não os conhece. Recarregue
            para ler e aceitar a versão vigente.{' '}
            <Button onClick={() => window.location.reload()}>Recarregar</Button>
          </p>
        )}
        {policyChanged && (
          <Flash variant="warning" role="alert">
            Os documentos mudaram enquanto esta aba estava aberta. Recarregue a página para ler a
            versão vigente.
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
                  Necessária para confirmar a idade mínima (
                  {registrationMinimumAge(legalBundle.manifest)} anos) — sua conta ainda não tinha
                  essa informação.
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
        {!accessError && (
          <details
            className="legal-rights-panel"
            onToggle={(event) => event.currentTarget.open && setRightsOpen(true)}
          >
            <summary>Seus direitos continuam disponíveis</summary>
            <p>
              Sem aceitar a nova versão você ainda pode consultar os documentos, falar com o
              atendimento, acompanhar e abrir pedidos de reembolso e alterar sua autorização de
              dados de saúde.
            </p>
            {rightsOpen && (
              <Suspense fallback={<Spinner size="small" aria-label="Carregando seus direitos" />}>
                <HealthConsentSettings compact />
                <RefundRequestsPanel />
              </Suspense>
            )}
          </details>
        )}
        <LogoutButton disabled={saving} />
      </section>
    </PublicLayout>
  )
}

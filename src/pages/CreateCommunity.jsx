import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Flash, Heading, Spinner, Text } from '@primer/react'
import { CheckCircleFillIcon, XCircleFillIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useWallet } from '../hooks/useWallet'
import { CommunityForm } from '../components/CommunityForm'
import { getCreateCommunityPrivilege, createCommunityWithCash } from '../services/privilegeService'
import { resolveRequestId } from '../utils/cashPurchaseFlow'
import { evaluateCommunityCreationRequirements } from '../utils/communityOwnership'
import { toDate } from '../utils/date'
import { formatDate } from '../utils/format'
import { invalidateCommunitiesCache } from '../utils/pageCache'

function newRequestId() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function accountAgeDays(createdAt) {
  const date = toDate(createdAt)
  if (!date) return 0
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

// Fase 5 (privilégios com EvoCash) -- primeiro privilégio: criação de comunidade paga.
// A elegibilidade mostrada aqui é só UX: quem decide de verdade é sempre
// createCommunityWithCash (Cloud Function), que revalida tudo de novo antes de cobrar.
export default function CreateCommunity() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { wallet, loading: loadingWallet } = useWallet()
  const [privilege, setPrivilege] = useState(null)
  const [loadingPrivilege, setLoadingPrivilege] = useState(true)
  const [pendingAttempt, setPendingAttempt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getCreateCommunityPrivilege()
      .then((result) => {
        if (active) setPrivilege(result)
      })
      .finally(() => {
        if (active) setLoadingPrivilege(false)
      })
    return () => {
      active = false
    }
  }, [])

  const loading = loadingWallet || loadingPrivilege
  const ageDays = accountAgeDays(profile?.createdAt)

  const { requirements, allMet } = evaluateCommunityCreationRequirements({
    privilege,
    accountAgeDays: ageDays,
    emailVerified: user.emailVerified === true,
    lifetimeCoinsEarned: wallet.lifetimeCoinsEarned,
    cashBalance: wallet.cashBalance,
  })

  async function handleSubmit(values) {
    setError('')
    const attemptKey = JSON.stringify(values)
    const requestId = resolveRequestId(pendingAttempt, attemptKey, newRequestId)
    try {
      const result = await createCommunityWithCash({ ...values, requestId })
      setPendingAttempt(null)
      invalidateCommunitiesCache(user.uid)
      navigate(`/comunidades/${result.communityId}`, { replace: true })
    } catch (err) {
      console.error('[CreateCommunity] createCommunityWithCash:', err)
      // create_community_with_cash (RPC) levanta um código curto em vez de uma frase
      // pronta (ver supabase/migrations/..._privilege_create_community.sql).
      const KNOWN_ERRORS = {
        REQUEST_ID_CONFLICT: 'Este pedido já foi usado para criar uma comunidade diferente.',
        PRIVILEGE_CONFIG_UNAVAILABLE: 'Configuração de privilégios indisponível no momento.',
        ACCOUNT_DISABLED: 'Sua conta não está em condições de criar uma comunidade.',
        ACCOUNT_RESTRICTED: 'Sua conta está com uma restrição ativa.',
        ACCOUNT_TOO_NEW: 'Sua conta ainda não atingiu o tempo mínimo exigido.',
        EMAIL_NOT_VERIFIED: 'Confirme seu e-mail para criar uma comunidade.',
        INSUFFICIENT_REPUTATION: 'Você ainda não tem reputação (EvoCoins histórico) suficiente.',
        INSUFFICIENT_CASH: 'Você não tem EvoCash suficiente.',
      }
      setPendingAttempt(err?.message === 'REQUEST_ID_CONFLICT' ? null : { key: attemptKey, requestId })
      setError(KNOWN_ERRORS[err?.message] || 'Não foi possível criar a comunidade. Tente novamente.')
    }
  }

  return (
    <div className="profile-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">EVOCASH</span>
        <h1>Criar uma comunidade</h1>
        <p>Requisitos combinados de reputação, tempo de conta e EvoCash.</p>
      </header>

      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {loading && <Spinner aria-label="Carregando requisitos" />}
      {!loading && !privilege && (
        <Flash variant="warning">Criação de comunidades está indisponível no momento.</Flash>
      )}

      {!loading && privilege && (
        <>
          <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 4 }}>
            <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
              Requisitos
            </Heading>
            {requirements.map((requirement) => (
              <Box key={requirement.key} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                {requirement.met ? (
                  <CheckCircleFillIcon fill="success.fg" />
                ) : (
                  <XCircleFillIcon fill="danger.fg" />
                )}
                <Text as="span">{requirement.label}</Text>
                <Text as="span" sx={{ color: 'fg.muted', fontSize: 0 }}>
                  ({requirement.detail})
                </Text>
              </Box>
            ))}
          </Box>

          {allMet ? (
            <CommunityForm showPostAccess={false} onSubmit={handleSubmit} onCancel={() => navigate('/comunidades')} />
          ) : (
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Você ainda não atende a todos os requisitos acima.
              {profile?.createdAt && ` Conta criada em ${formatDate(profile.createdAt)}.`}
            </Text>
          )}
        </>
      )}
    </div>
  )
}

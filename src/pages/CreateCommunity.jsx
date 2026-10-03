import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Flash, Spinner } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { EligibilityPanel } from '../components/communityCreation/EligibilityPanel'
import {
  InfoStep,
  PaymentStep,
  RetentionStep,
  ReviewStep,
} from '../components/communityCreation/CreationSteps'
import {
  createCommunity,
  getCommunityCreationEligibility,
  listCommunityCreationProducts,
} from '../services/communityCreationService'
import { DEFAULT_COMMUNITY_ICON_NAME } from '../constants/communityIcons'
import { resolveRequestId } from '../utils/cashPurchaseFlow'
import {
  WIZARD_STEPS,
  attemptKeyOf,
  creationErrorMessage,
  newIdempotencyKey,
  paymentOptionsFor,
  shouldRenewRequestId,
} from '../utils/communityCreation'
import { invalidateCommunitiesCache } from '../utils/pageCache'

// Erros que mudam a elegibilidade/saldo: recarrega os dados do servidor e volta ao início.
const REFRESH_ERRORS = new Set([
  'ACCOUNT_NOT_ELIGIBLE',
  'ACCOUNT_TOO_NEW',
  'NOT_ACTIVE_ENOUGH',
  'EMAIL_NOT_VERIFIED',
  'COMMUNITY_LIMIT_REACHED',
])

// Criação de comunidade em 5 etapas, mobile first: elegibilidade -> informações -> retenção
// das publicações -> pagamento -> revisão. Nada aqui autoriza nada: create_community
// recalcula elegibilidade, limite, preço e saldo no banco, e é idempotente.
export default function CreateCommunity() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [stepIndex, setStepIndex] = useState(0)
  const [eligibility, setEligibility] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [values, setValues] = useState({
    name: '',
    description: '',
    iconName: DEFAULT_COMMUNITY_ICON_NAME,
  })
  const [tier, setTier] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const pendingAttemptRef = useRef(null)
  const submittingRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [nextEligibility, nextProducts] = await Promise.all([
        getCommunityCreationEligibility(),
        listCommunityCreationProducts(),
      ])
      setEligibility(nextEligibility)
      setProducts(nextProducts)
    } catch (err) {
      console.error('[CreateCommunity] load:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const step = WIZARD_STEPS[stepIndex]
  const product = products.find((item) => item.tier === tier) || null
  const paymentOption =
    paymentOptionsFor(product, eligibility).find((option) => option.method === paymentMethod) ||
    null

  const goBack = () => (stepIndex === 0 ? navigate('/comunidades') : setStepIndex(stepIndex - 1))
  const goNext = () => setStepIndex((index) => Math.min(index + 1, WIZARD_STEPS.length - 1))

  function selectTier(nextTier) {
    setTier(nextTier)
    const options = paymentOptionsFor(
      products.find((item) => item.tier === nextTier),
      eligibility
    )
    // Pré-seleciona uma forma que o saldo cobre; senão o usuário escolhe (ou vê o que falta).
    setPaymentMethod((options.find((option) => option.enough) || null)?.method ?? null)
  }

  async function handleSubmit() {
    if (submittingRef.current || !product || !paymentOption) return
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    const payload = { ...values, tier, paymentMethod }
    const attemptKey = attemptKeyOf(payload)
    const idempotencyKey = resolveRequestId(
      pendingAttemptRef.current,
      attemptKey,
      newIdempotencyKey
    )
    pendingAttemptRef.current = { key: attemptKey, requestId: idempotencyKey }
    try {
      const result = await createCommunity({
        name: values.name.trim(),
        description: values.description.trim(),
        iconName: values.iconName,
        tier,
        paymentMethod,
        idempotencyKey,
      })
      pendingAttemptRef.current = null
      invalidateCommunitiesCache(user.uid)
      navigate(`/comunidades/${result.communityId}`, { replace: true })
    } catch (err) {
      console.error('[CreateCommunity] createCommunity:', err)
      // Falha de rede/desconhecida mantém a chave (o retry devolve o resultado original);
      // conflito de chave não se resolve repetindo.
      if (shouldRenewRequestId(err)) pendingAttemptRef.current = null
      setError(creationErrorMessage(err))
      if (REFRESH_ERRORS.has(err?.message)) {
        await load()
        setStepIndex(0)
      } else if (err?.message === 'INSUFFICIENT_COINS' || err?.message === 'INSUFFICIENT_CASH') {
        await load()
        setPaymentMethod(null)
        setStepIndex(WIZARD_STEPS.indexOf('payment'))
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="profile-page community-wizard">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">
          PASSO {stepIndex + 1} DE {WIZARD_STEPS.length}
        </span>
        <h1>Criar comunidade</h1>
      </header>

      {loading && (
        <Spinner
          aria-label="Carregando sua elegibilidade"
          sx={{ display: 'block', mx: 'auto', my: 5 }}
        />
      )}

      {!loading && loadError && (
        <Flash variant="danger" role="alert">
          Não foi possível carregar a criação de comunidades.{' '}
          <Button variant="invisible" onClick={load}>
            Tentar novamente
          </Button>
        </Flash>
      )}

      {!loading && !loadError && eligibility && (
        <>
          {error && step !== 'review' && (
            <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
              {error}
            </Flash>
          )}
          {step === 'eligibility' && (
            <EligibilityPanel eligibility={eligibility} onContinue={goNext} />
          )}
          {step === 'info' && (
            <InfoStep
              values={values}
              onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
              onBack={goBack}
              onNext={goNext}
            />
          )}
          {step === 'retention' && (
            <RetentionStep
              products={products}
              tier={tier}
              onSelect={selectTier}
              onBack={goBack}
              onNext={goNext}
            />
          )}
          {step === 'payment' && product && (
            <PaymentStep
              product={product}
              eligibility={eligibility}
              method={paymentMethod}
              onSelect={setPaymentMethod}
              onBack={goBack}
              onNext={goNext}
            />
          )}
          {step === 'review' && product && paymentOption && (
            <ReviewStep
              values={values}
              product={product}
              option={paymentOption}
              submitting={submitting}
              error={error}
              onBack={goBack}
              onSubmit={handleSubmit}
            />
          )}
        </>
      )}
    </div>
  )
}

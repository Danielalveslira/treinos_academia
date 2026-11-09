import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Flash, Spinner } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { ConfigStep, InfoStep, ReviewStep } from '../components/communityCreation/CreationSteps'
import {
  createCommunity,
  createFreeCommunity,
  getCommunityCreationEligibility,
  listCommunityCreationProducts,
} from '../services/communityCreationService'
import { uploadCommunityCover } from '../services/communitiesService'
import { DEFAULT_COMMUNITY_ICON_NAME } from '../constants/communityIcons'
import { resolveRequestId } from '../utils/cashPurchaseFlow'
import {
  WIZARD_STEPS,
  attemptKeyOf,
  creationErrorMessage,
  eligibilityPanelCoversError,
  newIdempotencyKey,
  paymentOptionsFor,
  shouldRenewRequestId,
} from '../utils/communityCreation'
import { invalidateCommunitiesCache } from '../utils/pageCache'
import '../styles/community-creation.css'

// Erros que mudam a elegibilidade/benefício/saldo: recarrega os dados do servidor e volta ao
// início. ACCOUNT_TOO_NEW/NOT_ACTIVE_ENOUGH não existem mais em nenhum caminho (ver
// eligibility_simplify) -- não aparecem aqui.
const REFRESH_ERRORS = new Set([
  'ACCOUNT_NOT_ELIGIBLE',
  'EMAIL_NOT_VERIFIED',
  'COMMUNITY_LIMIT_REACHED',
  'FREE_BENEFIT_ALREADY_USED',
])

// Criação de comunidade em 3 etapas, mobile first: informações (+ capa opcional) ->
// configuração (modalidade + quem pode publicar + pagamento, quando pago) -> revisão. Nada
// aqui autoriza nada: create_community/create_free_community recalculam elegibilidade, limite,
// benefício, preço e saldo no banco, e são idempotentes.
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
    coverBlob: null,
  })
  const [tier, setTier] = useState(null)
  const [postAccess, setPostAccess] = useState('everyone')
  const [paymentMethod, setPaymentMethod] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const pendingAttemptRef = useRef(null)
  const submittingRef = useRef(false)
  const autoSelectedRef = useRef(false)

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

  // Recomendação inicial: pré-seleciona a comunidade grátis quando o usuário ainda tem o
  // benefício disponível. Só uma vez, para não sobrescrever uma escolha manual do usuário.
  useEffect(() => {
    if (autoSelectedRef.current || !eligibility || products.length === 0 || tier) return
    autoSelectedRef.current = true
    const freeProduct = products.find((item) => item.free === true)
    if (freeProduct && eligibility.freeCommunityAvailable !== false) setTier(freeProduct.tier)
  }, [eligibility, products, tier])

  const step = WIZARD_STEPS[stepIndex]
  const product = products.find((item) => item.tier === tier) || null
  const isFree = product?.free === true
  const paymentOption =
    paymentOptionsFor(product, eligibility).find((option) => option.method === paymentMethod) ||
    null

  const goBack = () => (stepIndex === 0 ? navigate('/comunidades') : setStepIndex(stepIndex - 1))
  const goNext = () => setStepIndex((index) => Math.min(index + 1, WIZARD_STEPS.length - 1))

  function selectTier(nextTier) {
    setTier(nextTier)
    const nextProduct = products.find((item) => item.tier === nextTier)
    if (nextProduct?.free === true) {
      setPaymentMethod(null)
      return
    }
    const options = paymentOptionsFor(nextProduct, eligibility)
    // Pré-seleciona uma forma que o saldo cobre; senão o usuário escolhe (ou vê o que falta).
    setPaymentMethod((options.find((option) => option.enough) || null)?.method ?? null)
  }

  async function handleSubmit() {
    if (submittingRef.current || !tier || !postAccess || (!isFree && !paymentOption)) return
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    setErrorCode('')
    const attemptKey = attemptKeyOf({
      name: values.name,
      description: values.description,
      iconName: values.iconName,
      tier,
      paymentMethod: isFree ? null : paymentMethod,
      postAccess,
    })
    const idempotencyKey = resolveRequestId(
      pendingAttemptRef.current,
      attemptKey,
      newIdempotencyKey
    )
    pendingAttemptRef.current = { key: attemptKey, requestId: idempotencyKey }
    try {
      const result = isFree
        ? await createFreeCommunity({
            name: values.name.trim(),
            description: values.description.trim(),
            iconName: values.iconName,
            postAccess,
            idempotencyKey,
          })
        : await createCommunity({
            name: values.name.trim(),
            description: values.description.trim(),
            iconName: values.iconName,
            tier,
            paymentMethod,
            postAccess,
            idempotencyKey,
          })
      pendingAttemptRef.current = null
      invalidateCommunitiesCache(user.uid)

      // Capa (se selecionada) só é enviada DEPOIS que a comunidade existe -- o caminho de
      // Storage é determinístico por communityId. Falha aqui não desfaz a criação nem gera
      // nova cobrança: a comunidade já existe e já foi paga/concedida; só avisa e deixa o
      // usuário tentar de novo em "Gerenciar comunidade".
      let coverUploadFailed = false
      if (values.coverBlob) {
        try {
          await uploadCommunityCover(result.communityId, values.coverBlob)
        } catch (coverErr) {
          console.error('[CreateCommunity] uploadCommunityCover:', coverErr)
          coverUploadFailed = true
        }
      }

      navigate(`/comunidades/${result.communityId}`, {
        replace: true,
        state: coverUploadFailed ? { coverUploadFailed: true } : undefined,
      })
    } catch (err) {
      console.error('[CreateCommunity] create:', err)
      // Falha de rede/desconhecida mantém a chave (o retry devolve o resultado original);
      // conflito de chave não se resolve repetindo.
      if (shouldRenewRequestId(err)) pendingAttemptRef.current = null
      setError(creationErrorMessage(err))
      setErrorCode(err?.message ?? '')
      if (REFRESH_ERRORS.has(err?.message)) {
        await load()
        // FREE_BENEFIT_ALREADY_USED: a modalidade grátis que estava selecionada deixou de
        // ser válida -- limpa para o usuário escolher outra, em vez de deixar "selecionada"
        // uma opção agora desabilitada.
        if (err?.message === 'FREE_BENEFIT_ALREADY_USED') {
          setTier(null)
          setPaymentMethod(null)
        }
        setStepIndex(0)
      } else if (err?.message === 'INSUFFICIENT_COINS' || err?.message === 'INSUFFICIENT_CASH') {
        await load()
        setPaymentMethod(null)
        setStepIndex(WIZARD_STEPS.indexOf('config'))
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
          {error && step !== 'review' && !(step === 'info' && !eligibility.eligible && eligibilityPanelCoversError(errorCode)) && (
            <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
              {error}
            </Flash>
          )}
          {step === 'info' && (
            <InfoStep
              values={values}
              eligibility={eligibility}
              onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
              onBack={goBack}
              onNext={goNext}
            />
          )}
          {step === 'config' && (
            <ConfigStep
              products={products}
              eligibility={eligibility}
              tier={tier}
              postAccess={postAccess}
              paymentMethod={paymentMethod}
              onSelectTier={selectTier}
              onSelectPostAccess={setPostAccess}
              onSelectPayment={setPaymentMethod}
              onBack={goBack}
              onNext={goNext}
            />
          )}
          {step === 'review' && product && (isFree || paymentOption) && (
            <ReviewStep
              values={values}
              product={product}
              option={paymentOption}
              postAccess={postAccess}
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

import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Flash, FormControl, Text, TextInput, Textarea } from '@primer/react'
import { validateCommunity } from '../../utils/validators'
import { CommunityIconPicker } from '../CommunityIconPicker'
import { CoverCropField } from './CoverCropField'
import { EligibilityPanel } from './EligibilityPanel'
import {
  TIER_LABELS,
  describeEligibilityGap,
  formatPrice,
  paymentOptionsFor,
  productIsAvailable,
  retentionCopy,
} from '../../utils/communityCreation'

// Mesma terminologia já usada em CommunityForm.jsx (edição de comunidade): "moderadores" são
// o superadmin e, na própria comunidade, o dono dela -- can_post_in_community já implementa
// exatamente essa regra.
const POST_ACCESS_OPTIONS = [
  { value: 'everyone', title: 'Todos os membros', text: 'Qualquer pessoa da comunidade pode publicar.' },
  {
    value: 'admins',
    title: 'Somente moderadores',
    text: 'Membros comuns só visualizam. Moderadores são o superadmin e o dono da comunidade.',
  },
]

function StepActions({
  onBack,
  onNext,
  nextLabel = 'Continuar',
  nextDisabled = false,
  loading = false,
}) {
  return (
    <Box className="community-wizard-actions">
      <Button type="button" onClick={onBack} disabled={loading}>
        Voltar
      </Button>
      <Button
        type="button"
        variant="primary"
        onClick={onNext}
        disabled={nextDisabled || loading}
        loading={loading}
      >
        {nextLabel}
      </Button>
    </Box>
  )
}

function CoverPreview({ blob }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return undefined
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  if (!url) return null
  return (
    <div className="community-cover community-wizard-cover-preview">
      <img src={url} alt="Prévia da capa selecionada" className="community-cover-image" />
    </div>
  )
}

// Etapa 1 -- informações, capa (opcional, enviada só depois que a comunidade existe -- ver
// handleSubmit em CreateCommunity.jsx) e aviso de elegibilidade inline (sem etapa própria: a
// validação aqui é só UX, o banco valida/recalcula tudo de novo).
export function InfoStep({ values, onChange, eligibility, onBack, onNext }) {
  const errors = validateCommunity(values)
  const nameFilled = values.name.trim().length > 0
  const fieldsValid = nameFilled && Object.keys(errors).length === 0
  const gap = describeEligibilityGap(eligibility)
  const valid = fieldsValid && gap.eligible
  return (
    <Box as="section" aria-labelledby="creation-info-title" className="community-wizard-card">
      <h2 id="creation-info-title" className="community-wizard-title">
        Informações
      </h2>
      <EligibilityPanel eligibility={eligibility} />
      <Box className="community-wizard-fields">
        <FormControl required>
          <FormControl.Label>Nome</FormControl.Label>
          <TextInput
            block
            value={values.name}
            maxLength={60}
            onChange={(e) => onChange('name', e.target.value)}
          />
          {nameFilled && errors.name && (
            <FormControl.Validation variant="error">{errors.name}</FormControl.Validation>
          )}
        </FormControl>
        <FormControl>
          <FormControl.Label>Descrição</FormControl.Label>
          <Textarea
            block
            rows={3}
            value={values.description}
            onChange={(e) => onChange('description', e.target.value)}
          />
          {errors.description && (
            <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
          )}
        </FormControl>
        <FormControl>
          <FormControl.Label>Ícone</FormControl.Label>
          <CommunityIconPicker
            value={values.iconName}
            onChange={(v) => onChange('iconName', v)}
            name={values.name}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Capa (opcional)</FormControl.Label>
          <CoverPreview blob={values.coverBlob} />
          <div className="community-wizard-cover-actions">
            <CoverCropField
              triggerLabel={values.coverBlob ? 'Trocar capa' : 'Adicionar capa'}
              onCropped={(blob) => onChange('coverBlob', blob)}
            />
            {values.coverBlob && (
              <Button type="button" onClick={() => onChange('coverBlob', null)}>
                Remover capa
              </Button>
            )}
          </div>
          <Text as="p" className="community-wizard-note">
            Recomendado: 1200 × 600 px. Enviada depois que a comunidade for criada -- se o envio
            falhar, a comunidade já existe e você pode tentar de novo em "Gerenciar comunidade".
          </Text>
        </FormControl>
      </Box>
      <Text as="p" className="community-wizard-note">
        Ao criar, você segue as{' '}
        <RouterLink to="/regras-da-comunidade">Regras da comunidade</RouterLink> e continua
        responsável pelo que for publicado nela.
      </Text>
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!valid} />
    </Box>
  )
}

// Etapa 2 -- modalidade (grátis em destaque quando disponível), permissão de publicação e,
// quando a modalidade escolhida não é grátis, a forma de pagamento. Preço e disponibilidade
// vêm sempre do catálogo do servidor; "grátis" é só product.free === true, nunca inferido por
// preço nulo.
export function ConfigStep({
  products,
  eligibility,
  tier,
  postAccess,
  paymentMethod,
  onSelectTier,
  onSelectPostAccess,
  onSelectPayment,
  onBack,
  onNext,
}) {
  const product = products.find((item) => item.tier === tier) || null
  const isFree = product?.free === true
  const paymentOptions = isFree ? [] : paymentOptionsFor(product, eligibility)
  const selectedPayment = paymentOptions.find((option) => option.method === paymentMethod)
  const ready = Boolean(tier) && Boolean(postAccess) && (isFree || Boolean(selectedPayment))

  function productAvailable(candidate) {
    if (!productIsAvailable(candidate)) return false
    if (candidate.free === true) return eligibility?.freeCommunityAvailable !== false
    return true
  }

  return (
    <Box as="section" aria-labelledby="creation-config-title" className="community-wizard-card">
      <h2 id="creation-config-title" className="community-wizard-title">
        Modalidade e configuração
      </h2>

      <div role="radiogroup" aria-label="Modalidade da comunidade" className="community-choice-list">
        {products.map((candidate) => {
          const copy = retentionCopy(candidate.postRetentionMode)
          const available = productAvailable(candidate)
          const selected = tier === candidate.tier
          const candidateFree = candidate.free === true
          return (
            <button
              key={candidate.tier}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!available}
              className={`community-choice${selected ? ' is-selected' : ''}${candidateFree ? ' community-choice-free' : ''}`}
              onClick={() => onSelectTier(candidate.tier)}
            >
              <span className="community-choice-title">
                {candidateFree ? 'Grátis' : TIER_LABELS[candidate.tier]}
              </span>
              <span className="community-choice-text">{copy.description}</span>
              <span className="community-choice-meta">
                {copy.title}
                {!available && candidateFree && ' · benefício já usado'}
                {!available && !candidateFree && ' · em breve'}
              </span>
            </button>
          )
        })}
      </div>

      <h3 className="community-wizard-subtitle">Quem pode publicar?</h3>
      <div role="radiogroup" aria-label="Quem pode publicar" className="community-choice-list community-post-access-list">
        {POST_ACCESS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={postAccess === option.value}
            className={`community-choice${postAccess === option.value ? ' is-selected' : ''}`}
            onClick={() => onSelectPostAccess(option.value)}
          >
            <span className="community-choice-title">{option.title}</span>
            <span className="community-choice-text">{option.text}</span>
          </button>
        ))}
      </div>

      {tier && !isFree && (
        <>
          <h3 className="community-wizard-subtitle">Forma de pagamento</h3>
          {paymentOptions.length === 0 && (
            <Flash variant="warning">Este tipo de comunidade não está disponível agora.</Flash>
          )}
          <div role="radiogroup" aria-label="Forma de pagamento" className="community-choice-list">
            {paymentOptions.map((option) => (
              <button
                key={option.method}
                type="button"
                role="radio"
                aria-checked={paymentMethod === option.method}
                disabled={!option.enough}
                className={`community-choice${paymentMethod === option.method ? ' is-selected' : ''}`}
                onClick={() => onSelectPayment(option.method)}
              >
                <span className="community-choice-title">{formatPrice(option)}</span>
                <span className="community-choice-text">
                  Saldo: {option.balance} {option.label}
                </span>
                {!option.enough && (
                  <span className="community-choice-meta">
                    Faltam {option.price - option.balance} {option.label}
                    {option.method === 'evocash' && (
                      <>
                        {' · '}
                        <RouterLink to="/evocash">Comprar EvoCash</RouterLink>
                      </>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!ready} />
    </Box>
  )
}

// Etapa 3 -- revisão. O botão envia só nome/descrição/ícone/tier/post_access/forma de
// pagamento/chave de idempotência; preço, saldo e retenção são decididos no servidor. Capa (se
// selecionada) é enviada separadamente DEPOIS da criação ter sucesso.
export function ReviewStep({ values, product, option, postAccess, submitting, error, onBack, onSubmit }) {
  const copy = retentionCopy(product.postRetentionMode)
  const isFree = product.free === true
  const postAccessLabel = POST_ACCESS_OPTIONS.find((item) => item.value === postAccess)?.title ?? postAccess
  return (
    <Box as="section" aria-labelledby="creation-review-title" className="community-wizard-card">
      <h2 id="creation-review-title" className="community-wizard-title">
        Revisão
      </h2>
      <dl className="community-review">
        <div>
          <dt>Comunidade</dt>
          <dd>{values.name.trim()}</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd>{copy.title}</dd>
        </div>
        <div>
          <dt>Quem pode publicar</dt>
          <dd>{postAccessLabel}</dd>
        </div>
        <div>
          <dt>Pagamento</dt>
          <dd>{isFree ? 'Grátis' : formatPrice(option)}</dd>
        </div>
        {values.coverBlob && (
          <div>
            <dt>Capa</dt>
            <dd>Selecionada -- enviada após a criação</dd>
          </div>
        )}
      </dl>
      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      <StepActions
        onBack={onBack}
        onNext={onSubmit}
        nextLabel={isFree ? 'Criar comunidade gratuitamente' : 'Confirmar e criar'}
        loading={submitting}
      />
    </Box>
  )
}

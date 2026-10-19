import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Flash, FormControl, Text, TextInput, Textarea } from '@primer/react'
import { validateCommunity } from '../../utils/validators'
import { CommunityIconPicker } from '../CommunityIconPicker'
import {
  TIER_LABELS,
  formatPrice,
  paymentOptionsFor,
  productIsAvailable,
  retentionCopy,
} from '../../utils/communityCreation'

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

// Etapa 2 -- informações básicas. A validação aqui é só UX: o banco valida de novo.
export function InfoStep({ values, onChange, onBack, onNext }) {
  const errors = validateCommunity(values)
  const nameFilled = values.name.trim().length > 0
  const valid = nameFilled && Object.keys(errors).length === 0
  return (
    <Box as="section" aria-labelledby="creation-info-title" className="community-wizard-card">
      <h2 id="creation-info-title" className="community-wizard-title">
        Informações
      </h2>
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

// Etapa 3 -- como as publicações funcionam. Textos do servidor-agnósticos: o tier é só um
// rótulo; retenção e preço reais vêm do catálogo e são recalculados em create_community.
export function RetentionStep({ products, tier, onSelect, onBack, onNext }) {
  return (
    <Box as="section" aria-labelledby="creation-retention-title" className="community-wizard-card">
      <h2 id="creation-retention-title" className="community-wizard-title">
        Como funcionam as publicações?
      </h2>
      <div role="radiogroup" aria-label="Duração das publicações" className="community-choice-list">
        {products.map((product) => {
          const copy = retentionCopy(product.postRetentionMode)
          const available = productIsAvailable(product)
          const selected = tier === product.tier
          return (
            <button
              key={product.tier}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!available}
              className={`community-choice${selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(product.tier)}
            >
              <span className="community-choice-title">{copy.title}</span>
              <span className="community-choice-text">{copy.description}</span>
              <span className="community-choice-meta">
                {TIER_LABELS[product.tier]}
                {!available && ' · em breve'}
              </span>
            </button>
          )
        })}
      </div>
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!tier} />
    </Box>
  )
}

// Etapa 4 -- forma de pagamento. Só aparecem as formas com preço válido; o saldo mostrado
// é o que o servidor devolveu (create_community lê o saldo de novo na hora de cobrar).
export function PaymentStep({ product, eligibility, method, onSelect, onBack, onNext }) {
  const options = paymentOptionsFor(product, eligibility)
  const selected = options.find((option) => option.method === method)
  return (
    <Box as="section" aria-labelledby="creation-payment-title" className="community-wizard-card">
      <h2 id="creation-payment-title" className="community-wizard-title">
        Forma de pagamento
      </h2>
      {options.length === 0 && (
        <Flash variant="warning">Este tipo de comunidade não está disponível agora.</Flash>
      )}
      <div role="radiogroup" aria-label="Forma de pagamento" className="community-choice-list">
        {options.map((option) => (
          <button
            key={option.method}
            type="button"
            role="radio"
            aria-checked={method === option.method}
            disabled={!option.enough}
            className={`community-choice${method === option.method ? ' is-selected' : ''}`}
            onClick={() => onSelect(option.method)}
          >
            <span className="community-choice-title">{formatPrice(option)}</span>
            <span className="community-choice-text">
              Saldo: {option.balance} {option.label}
            </span>
            {!option.enough && (
              <span className="community-choice-meta">
                Saldo insuficiente
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
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!selected} />
    </Box>
  )
}

// Etapa 5 -- revisão. O botão envia só nome/descrição/ícone/tier/forma de pagamento/chave de
// idempotência; preço, saldo e retenção são decididos no servidor.
export function ReviewStep({ values, product, option, submitting, error, onBack, onSubmit }) {
  const copy = retentionCopy(product.postRetentionMode)
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
          <dt>Pagamento</dt>
          <dd>{formatPrice(option)}</dd>
        </div>
      </dl>
      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      <StepActions
        onBack={onBack}
        onNext={onSubmit}
        nextLabel="Criar comunidade"
        loading={submitting}
      />
    </Box>
  )
}

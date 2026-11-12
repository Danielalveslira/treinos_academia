import { useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  Select,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import { useFormState } from '../hooks/useFormState'
import { FormShell } from './FormShell'
import AdvertisingCreativePreview from './advertising/AdvertisingCreativePreview'
import { isTrustedAdImage } from '../utils/adImage'

const PLACEMENTS = [
  ['home_banner', 'Página inicial — banner'],
  ['progress_banner', 'Progresso — banner compacto'],
  ['community_banner', 'Comunidade — banner'],
  ['community_feed', 'Feed da comunidade — card'],
]

export function initialInstitutionalAdValues(ad) {
  const expiry = ad?.expiresAt ? new Date(ad.expiresAt) : null
  const expiryDay =
    expiry &&
    expiry.getUTCHours() === 0 &&
    expiry.getUTCMinutes() === 0 &&
    expiry.getUTCSeconds() === 0
      ? new Date(expiry.getTime() - 86400000)
      : expiry
  return {
    partnerName: ad?.partnerName || '',
    title: ad?.title || '',
    description: ad?.description || '',
    imageUrl: ad?.imageUrl || '',
    ctaLabel: ad?.ctaLabel || '',
    ctaType: ad?.ctaType || 'external',
    ctaTarget: ad?.ctaTarget || '',
    expiresAt: expiryDay ? expiryDay.toISOString().slice(0, 10) : '',
    codes: [...new Set((ad?.placements || []).map((item) => item.code))],
    communityIdsByCode: Object.fromEntries(
      ['community_banner', 'community_feed'].map((code) => [
        code,
        [
          ...new Set(
            (ad?.placements || [])
              .filter((item) => item.code === code)
              .map((item) => item.contextId)
              .filter(Boolean)
          ),
        ],
      ])
    ),
  }
}

export function institutionalPlacementsFromValues(values) {
  return [
    ...values.codes
      .filter((code) => !code.startsWith('community_'))
      .map((code) => ({ code, contextId: null })),
    ...values.codes
      .filter((code) => code.startsWith('community_'))
      .flatMap((code) => values.communityIdsByCode[code].map((contextId) => ({ code, contextId }))),
  ]
}

function validate(values) {
  const errors = {}
  if (!values.partnerName.trim() || values.partnerName.trim().length > 60)
    errors.partnerName = 'Informe uma marca com até 60 caracteres.'
  if (!values.title.trim() || values.title.trim().length > 100)
    errors.title = 'Informe um título com até 100 caracteres.'
  if (!values.codes.length) errors.codes = 'Escolha onde o anúncio será exibido.'
  for (const code of values.codes.filter((item) => item.startsWith('community_'))) {
    if (!values.communityIdsByCode[code].length) errors[code] = 'Selecione ao menos uma comunidade.'
  }
  if (institutionalPlacementsFromValues(values).length > 50)
    errors.codes = 'Use no máximo 50 combinações de local e comunidade.'
  if (values.codes.includes('community_feed')) {
    if (values.description.length > 500) errors.description = 'Use até 500 caracteres.'
    if (
      values.imageUrl &&
      (!/^https:\/\/[^\s@]+$/.test(values.imageUrl) || values.imageUrl.length > 500)
    )
      errors.imageUrl = 'Use um endereço HTTPS válido.'
  }
  if (values.ctaLabel.trim()) {
    if (values.ctaLabel.trim().length > 30) errors.ctaLabel = 'Use até 30 caracteres.'
    if (
      values.ctaType === 'external'
        ? !/^https:\/\/[^\s@]+$/.test(values.ctaTarget.trim())
        : !/^\/([^/\\].*)?$/.test(values.ctaTarget.trim())
    )
      errors.ctaTarget = 'Informe um destino válido para o botão.'
  }
  if (
    values.expiresAt &&
    (Number.isNaN(Date.parse(values.expiresAt)) ||
      new Date(`${values.expiresAt}T23:59:59Z`) <= new Date())
  )
    errors.expiresAt = 'Escolha uma data futura.'
  return errors
}

export function InstitutionalAdForm({
  initialValue,
  communities,
  hasMoreCommunities,
  loadMoreCommunities,
  onSubmit,
  onCancel,
}) {
  const [serverError, setServerError] = useState('')
  const requestId = useRef(initialValue?.id || crypto.randomUUID())
  const { values, setField, setValues, errors, submitting, handleSubmit } = useFormState({
    initialValues: () => initialInstitutionalAdValues(initialValue),
    validate,
    onSubmit: async (values) => {
      setServerError('')
      const placements = institutionalPlacementsFromValues(values)
      try {
        await onSubmit(
          {
            partnerName: values.partnerName.trim(),
            title: values.title.trim(),
            description: values.codes.includes('community_feed') ? values.description.trim() : '',
            imageUrl: values.codes.includes('community_feed') ? values.imageUrl.trim() : '',
            ctaLabel: values.ctaLabel.trim(),
            ctaType: values.ctaType,
            ctaTarget: values.ctaLabel.trim() ? values.ctaTarget.trim() : '',
            expiresAt:
              initialValue?.expiresAt &&
              values.expiresAt === initialInstitutionalAdValues(initialValue).expiresAt
                ? initialValue.expiresAt
                : values.expiresAt,
            placements,
          },
          requestId.current
        )
      } catch (error) {
        setServerError(error.message || 'Não foi possível salvar o anúncio.')
      }
    },
  })
  const hasCommunity = values.codes.some((code) => code.startsWith('community_'))
  const hasFeed = values.codes.includes('community_feed')
  const previewCodes = useMemo(
    () => PLACEMENTS.map(([code]) => code).filter((code) => values.codes.includes(code)),
    [values.codes]
  )
  const toggle = (field, value) =>
    setValues((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }))
  const toggleCommunity = (code, id) =>
    setValues((prev) => ({
      ...prev,
      communityIdsByCode: {
        ...prev.communityIdsByCode,
        [code]: prev.communityIdsByCode[code].includes(id)
          ? prev.communityIdsByCode[code].filter((item) => item !== id)
          : [...prev.communityIdsByCode[code], id],
      },
    }))

  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
      <Text as="p" sx={{ color: 'fg.muted', m: 0 }}>
        Anúncio institucional · sem cobrança de EvoCash. Salve e depois ative a publicação.
      </Text>
      <FormControl required>
        <FormControl.Label>Parceiro ou marca</FormControl.Label>
        <TextInput
          value={values.partnerName}
          onChange={(event) => setField('partnerName', event.target.value)}
          block
          autoFocus
        />
        {errors.partnerName && (
          <FormControl.Validation variant="error">{errors.partnerName}</FormControl.Validation>
        )}
      </FormControl>
      <FormControl required>
        <FormControl.Label>Título</FormControl.Label>
        <TextInput
          value={values.title}
          onChange={(event) => setField('title', event.target.value)}
          block
        />
        {errors.title && (
          <FormControl.Validation variant="error">{errors.title}</FormControl.Validation>
        )}
      </FormControl>
      <FormControl required>
        <FormControl.Label>Onde anunciar</FormControl.Label>
        <Box
          sx={{ display: 'grid', gridTemplateColumns: ['1fr', 'repeat(2,minmax(0,1fr))'], gap: 2 }}
        >
          {PLACEMENTS.map(([code, label]) => (
            <FormControl key={code}>
              <Checkbox
                checked={values.codes.includes(code)}
                onChange={() => toggle('codes', code)}
              />
              <FormControl.Label>{label}</FormControl.Label>
            </FormControl>
          ))}
        </Box>
        {errors.codes && (
          <FormControl.Validation variant="error">{errors.codes}</FormControl.Validation>
        )}
      </FormControl>
      {hasCommunity &&
        values.codes
          .filter((code) => code.startsWith('community_'))
          .map((code) => (
            <FormControl required key={code}>
              <FormControl.Label>
                {values.codes.includes('community_banner') &&
                values.codes.includes('community_feed')
                  ? code === 'community_banner'
                    ? 'Comunidades do banner'
                    : 'Comunidades do feed'
                  : 'Comunidades'}
              </FormControl.Label>
              <Box
                sx={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  p: 2,
                }}
              >
                {communities
                  .filter((community) => community.isActive !== false)
                  .map((community) => (
                    <FormControl key={community.id}>
                      <Checkbox
                        checked={values.communityIdsByCode[code].includes(community.id)}
                        onChange={() => toggleCommunity(code, community.id)}
                      />
                      <FormControl.Label>{community.name}</FormControl.Label>
                    </FormControl>
                  ))}
              </Box>
              {values.communityIdsByCode[code].some(
                (id) => !communities.some((community) => community.id === id)
              ) && (
                <FormControl.Caption>
                  Há comunidades selecionadas fora desta página. Carregue mais para conferi-las.
                </FormControl.Caption>
              )}
              {errors[code] && (
                <FormControl.Validation variant="error">{errors[code]}</FormControl.Validation>
              )}
            </FormControl>
          ))}
      {hasCommunity && hasMoreCommunities && (
        <Button type="button" onClick={loadMoreCommunities}>
          Carregar mais comunidades
        </Button>
      )}
      {hasFeed && (
        <>
          <FormControl>
            <FormControl.Label>Descrição do card (opcional)</FormControl.Label>
            <Textarea
              value={values.description}
              onChange={(event) => setField('description', event.target.value)}
              rows={2}
              block
            />
            {errors.description && (
              <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
            )}
          </FormControl>
          <FormControl>
            <FormControl.Label>Imagem do card (opcional)</FormControl.Label>
            <TextInput
              value={values.imageUrl}
              onChange={(event) => setField('imageUrl', event.target.value)}
              placeholder="https://…"
              block
            />
            {values.imageUrl && !isTrustedAdImage(values.imageUrl) && (
              <FormControl.Caption>
                Imagens externas podem permitir rastreamento. Prefira uma imagem do Evolutus.
              </FormControl.Caption>
            )}
            {errors.imageUrl && (
              <FormControl.Validation variant="error">{errors.imageUrl}</FormControl.Validation>
            )}
          </FormControl>
        </>
      )}
      <FormControl>
        <FormControl.Label>Texto do botão (opcional)</FormControl.Label>
        <TextInput
          value={values.ctaLabel}
          onChange={(event) => setField('ctaLabel', event.target.value)}
          block
        />
        {errors.ctaLabel && (
          <FormControl.Validation variant="error">{errors.ctaLabel}</FormControl.Validation>
        )}
      </FormControl>
      {values.ctaLabel.trim() && (
        <>
          <FormControl required>
            <FormControl.Label>Destino</FormControl.Label>
            <Select
              value={values.ctaType}
              onChange={(event) => setField('ctaType', event.target.value)}
              block
            >
              <Select.Option value="external">Site externo</Select.Option>
              <Select.Option value="internal">Página do Evolutus</Select.Option>
            </Select>
          </FormControl>
          <FormControl required>
            <FormControl.Label>Link do botão</FormControl.Label>
            <TextInput
              value={values.ctaTarget}
              onChange={(event) => setField('ctaTarget', event.target.value)}
              placeholder={values.ctaType === 'external' ? 'https://…' : '/comunidades/…'}
              block
            />
            {errors.ctaTarget && (
              <FormControl.Validation variant="error">{errors.ctaTarget}</FormControl.Validation>
            )}
          </FormControl>
        </>
      )}
      <FormControl>
        <FormControl.Label>Expiração (opcional)</FormControl.Label>
        <TextInput
          type="date"
          value={values.expiresAt}
          onChange={(event) => setField('expiresAt', event.target.value)}
          block
        />
        {errors.expiresAt && (
          <FormControl.Validation variant="error">{errors.expiresAt}</FormControl.Validation>
        )}
      </FormControl>
      <AdvertisingCreativePreview
        placements={previewCodes}
        partnerName={values.partnerName}
        title={values.title}
        description={hasFeed ? values.description : ''}
        imageUrl={hasFeed ? values.imageUrl : ''}
        ctaLabel={values.ctaLabel}
      />
      {serverError && (
        <Text role="alert" sx={{ color: 'danger.fg' }}>
          {serverError}
        </Text>
      )}
    </FormShell>
  )
}

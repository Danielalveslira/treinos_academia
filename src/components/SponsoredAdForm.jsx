import { useMemo, useState } from 'react'
import { Box, FormControl, TextInput, Select, Textarea, Checkbox, Text } from '@primer/react'
import {
  validateSponsoredAd,
  SPONSORED_AD_CTA_TYPES,
  SPONSORED_AD_DISPLAY_MODES,
  MAX_ACTIVE_ADS_PER_COMMUNITY,
  SponsoredAdCapError,
} from '../utils/validators'
import { useFormState } from '../hooks/useFormState'
import { FormShell } from './FormShell'

const EMPTY = {
  partnerName: '',
  title: '',
  description: '',
  imageUrl: '',
  ctaLabel: '',
  ctaType: 'external',
  ctaTarget: '',
  expiresAt: '',
  communityIds: [],
  displayMode: [],
}

const DISPLAY_MODE_LABELS = {
  feed: 'Card no feed da comunidade',
  banner: 'Banner rotativo do topo',
}

export function SponsoredAdForm({
  initialValue,
  communities,
  adCountByCommunityId,
  onSubmit,
  onCancel,
}) {
  const [capErrorCommunityId, setCapErrorCommunityId] = useState(null)

  const { values, setField, setValues, errors, submitting, handleSubmit } = useFormState({
    initialValues: () => (initialValue ? { ...EMPTY, ...initialValue } : EMPTY),
    validate: validateSponsoredAd,
    onSubmit: async (finalValues) => {
      setCapErrorCommunityId(null)
      try {
        await onSubmit(finalValues)
      } catch (err) {
        if (err instanceof SponsoredAdCapError) {
          setCapErrorCommunityId(err.communityId)
          return
        }
        throw err
      }
    },
  })

  const communityNameById = useMemo(
    () => Object.fromEntries(communities.map((c) => [c.id, c.name])),
    [communities]
  )
  const hasCta = Boolean(values.ctaLabel && values.ctaLabel.trim())
  const communityIdsError =
    errors.communityIds ||
    (capErrorCommunityId &&
      `A comunidade "${communityNameById[capErrorCommunityId] || capErrorCommunityId}" já atingiu o limite de ${MAX_ACTIVE_ADS_PER_COMMUNITY} anúncios ativos.`)

  function toggleCommunity(id) {
    setValues((prev) => ({
      ...prev,
      communityIds: prev.communityIds.includes(id)
        ? prev.communityIds.filter((c) => c !== id)
        : [...prev.communityIds, id],
    }))
  }

  function toggleDisplayMode(mode) {
    setValues((prev) => ({
      ...prev,
      displayMode: prev.displayMode.includes(mode)
        ? prev.displayMode.filter((m) => m !== mode)
        : [...prev.displayMode, mode],
    }))
  }

  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
      <FormControl required>
        <FormControl.Label>Parceiro</FormControl.Label>
        <TextInput
          value={values.partnerName}
          onChange={(e) => setField('partnerName', e.target.value)}
          block
          autoFocus
        />
        {errors.partnerName && (
          <FormControl.Validation variant="error">{errors.partnerName}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl required>
        <FormControl.Label>Título</FormControl.Label>
        <TextInput value={values.title} onChange={(e) => setField('title', e.target.value)} block />
        {errors.title && (
          <FormControl.Validation variant="error">{errors.title}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Descrição</FormControl.Label>
        <Textarea
          value={values.description}
          onChange={(e) => setField('description', e.target.value)}
          rows={2}
          block
        />
        <FormControl.Caption>Usada só no card do feed, não aparece no banner.</FormControl.Caption>
        {errors.description && (
          <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Link da imagem</FormControl.Label>
        <TextInput
          value={values.imageUrl}
          onChange={(e) => setField('imageUrl', e.target.value)}
          block
        />
        <FormControl.Caption>Usada só no card do feed, não aparece no banner.</FormControl.Caption>
        {errors.imageUrl && (
          <FormControl.Validation variant="error">{errors.imageUrl}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Texto do botão (opcional)</FormControl.Label>
        <TextInput
          value={values.ctaLabel}
          onChange={(e) => setField('ctaLabel', e.target.value)}
          placeholder="Ex.: Saiba mais"
          block
        />
        {errors.ctaLabel && (
          <FormControl.Validation variant="error">{errors.ctaLabel}</FormControl.Validation>
        )}
      </FormControl>

      {hasCta && (
        <>
          <FormControl required>
            <FormControl.Label>Tipo de destino</FormControl.Label>
            <Select value={values.ctaType} onChange={(e) => setField('ctaType', e.target.value)} block>
              {SPONSORED_AD_CTA_TYPES.map((type) => (
                <Select.Option key={type} value={type}>
                  {type === 'external' ? 'Link externo' : 'Rota interna do app'}
                </Select.Option>
              ))}
            </Select>
            {errors.ctaType && (
              <FormControl.Validation variant="error">{errors.ctaType}</FormControl.Validation>
            )}
          </FormControl>

          <FormControl required>
            <FormControl.Label>Destino do botão</FormControl.Label>
            <TextInput
              value={values.ctaTarget}
              onChange={(e) => setField('ctaTarget', e.target.value)}
              placeholder={values.ctaType === 'external' ? 'https://…' : '/comunidades/123'}
              block
            />
            {errors.ctaTarget && (
              <FormControl.Validation variant="error">{errors.ctaTarget}</FormControl.Validation>
            )}
          </FormControl>
        </>
      )}

      <FormControl>
        <FormControl.Label>Expira em (opcional)</FormControl.Label>
        <TextInput
          type="date"
          value={values.expiresAt}
          onChange={(e) => setField('expiresAt', e.target.value)}
          block
        />
        <FormControl.Caption>
          Deixe em branco para não expirar automaticamente.
        </FormControl.Caption>
        {errors.expiresAt && (
          <FormControl.Validation variant="error">{errors.expiresAt}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl required>
        <FormControl.Label>Comunidades onde aparece</FormControl.Label>
        <Box
          sx={{
            maxHeight: 260,
            overflowY: 'auto',
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: 2,
          }}
        >
          {communities.map((community) => {
            const checked = values.communityIds.includes(community.id)
            const count = adCountByCommunityId[community.id] || 0
            const atCap = count >= MAX_ACTIVE_ADS_PER_COMMUNITY
            return (
              <Box
                key={community.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  py: 1,
                }}
              >
                <FormControl disabled={!checked && atCap}>
                  <Checkbox checked={checked} onChange={() => toggleCommunity(community.id)} />
                  <FormControl.Label>{community.name}</FormControl.Label>
                </FormControl>
                <Text sx={{ fontSize: 0, color: atCap ? 'danger.fg' : 'fg.muted', flexShrink: 0 }}>
                  {count}/{MAX_ACTIVE_ADS_PER_COMMUNITY} anúncios
                </Text>
              </Box>
            )
          })}
        </Box>
        {communityIdsError && (
          <FormControl.Validation variant="error">{communityIdsError}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl required>
        <FormControl.Label>Onde exibir</FormControl.Label>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {SPONSORED_AD_DISPLAY_MODES.map((mode) => (
            <FormControl key={mode}>
              <Checkbox
                checked={values.displayMode.includes(mode)}
                onChange={() => toggleDisplayMode(mode)}
              />
              <FormControl.Label>{DISPLAY_MODE_LABELS[mode]}</FormControl.Label>
            </FormControl>
          ))}
        </Box>
        {errors.displayMode && (
          <FormControl.Validation variant="error">{errors.displayMode}</FormControl.Validation>
        )}
      </FormControl>
    </FormShell>
  )
}

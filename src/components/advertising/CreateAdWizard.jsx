import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flash,
  FormControl,
  Heading,
  Select,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import {
  createAdvertisingCampaign,
  editAdvertisingCampaign,
} from '../../services/advertisingService'
import { listActiveCommunities } from '../../services/communitiesService'
import { uploadStorefrontImage } from '../../services/storefrontService'
import StorefrontImage from '../StorefrontImage'
import CommunityAdvertisingPermissions from '../CommunityAdvertisingPermissions'
import { useAuth } from '../../hooks/useAuth'
import { commercialError } from '../../utils/commercial'
import { PLACEMENT_LABELS, placementsSummary } from '../../utils/placementLabels'

const PLACEMENT_OPTIONS = [
  {
    code: 'home_banner',
    title: 'Página inicial',
    description: 'Destaque na Home do Evolutus, visível para todos os usuários do app.',
  },
  {
    code: 'community_banner',
    title: 'Comunidade',
    description: 'Banner exibido no contexto de uma comunidade que você administra.',
  },
  {
    code: 'community_feed',
    title: 'Feed da comunidade',
    description: 'Anúncio exibido junto às publicações de uma comunidade que você administra.',
  },
  {
    code: 'network',
    title: PLACEMENT_LABELS.network,
    description:
      'Conjunto de posicionamentos configurado pelo Evolutus. A disponibilidade depende do que a administração liberou.',
  },
]

const EMPTY_VALUES = { title: '', description: '', destination: '', media_id: null }
const STEPS = ['Onde anunciar', 'Preparar anúncio', 'Duração', 'Revisar e enviar']
const STORAGE_PREFIX = 'evolutus:ad-wizard:'

function loadSaved(accountId) {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + accountId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveProgress(accountId, state) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + accountId, JSON.stringify(state))
  } catch {
    // Browser storage can throw (private mode, quota, disabled). Never block the wizard.
  }
}
function clearProgress(accountId) {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + accountId)
  } catch {
    // Same as above: best-effort only.
  }
}

export default function CreateAdWizard({ accountId, existingDraft, onDone, onCancel }) {
  const { user } = useAuth()
  const resuming = loadSaved(accountId)
  const [step, setStep] = useState(existingDraft ? 2 : resuming?.step || 1)
  const [placement, setPlacement] = useState(
    existingDraft?.placements?.[0]?.code || resuming?.placement || ''
  )
  const [communityId, setCommunityId] = useState(resuming?.communityId || '')
  const [values, setValues] = useState(
    existingDraft
      ? {
          title: existingDraft.title,
          description: existingDraft.description || '',
          destination: existingDraft.destination,
          media_id: existingDraft.media_id || null,
        }
      : resuming?.values || EMPTY_VALUES
  )
  const [desiredDays, setDesiredDays] = useState(
    existingDraft?.desired_duration_days || resuming?.desiredDays || 1
  )
  const [draft, setDraft] = useState(
    existingDraft
      ? { ad_id: existingDraft.ad_id, version: existingDraft.version }
      : resuming?.draft || null
  )
  const [communities, setCommunities] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(null)
  const lock = useRef(false)
  const intent = useRef(null)

  useEffect(() => {
    let live = true
    listActiveCommunities(user?.uid)
      .then((rows) => live && setCommunities(rows))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [user?.uid])

  useEffect(() => {
    if (submitted) return
    saveProgress(accountId, { step, placement, communityId, values, desiredDays, draft })
  }, [accountId, step, placement, communityId, values, desiredDays, draft, submitted])

  const placementDisplay = existingDraft?.placements
    ? placementsSummary(existingDraft.placements)
    : PLACEMENT_LABELS[placement] || placement
  // community_banner/community_feed are unambiguously community placements. 'network'
  // expands to an admin-configured bundle whose composition isn't readable from here
  // (no advertiser-facing RPC exposes it) — offer the choice without forcing it; if the
  // configured bundle does include a community surface, the server enforces
  // AD_COMMUNITY_NOT_AUTHORIZED and the error is shown back on this same step.
  const communityRequired = placement === 'community_banner' || placement === 'community_feed'
  const communityOffered = communityRequired || placement === 'network'
  const minimumContentValid = values.title.trim().length > 0 && values.destination.startsWith('https://')

  async function saveDraft(submit) {
    if (lock.current) return null
    lock.current = true
    setBusy(true)
    setError('')
    try {
      let result
      if (!draft) {
        intent.current ||= crypto.randomUUID()
        const ad_id = await createAdvertisingCampaign(
          accountId,
          { placement, communityId, ...values },
          intent.current
        )
        result = await editAdvertisingCampaign(
          { ad_id, version: 1 },
          values,
          submit,
          desiredDays
        )
        setDraft({ ad_id, version: result.version })
      } else {
        result = await editAdvertisingCampaign(draft, values, submit, desiredDays)
        setDraft({ ad_id: draft.ad_id, version: result.version })
      }
      if (submit) {
        setSubmitted(result)
        clearProgress(accountId)
      }
      return result
    } catch (e) {
      // A prior attempt may have created the draft server-side without the client ever
      // seeing the response (timeout, dropped connection). If the content changed since
      // then, the server correctly refuses to replay it under the old id — start a fresh
      // one on the next try instead of getting stuck.
      if (!draft && e?.message === 'IDEMPOTENCY_CONFLICT') intent.current = null
      setError(commercialError(e))
      return null
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function uploadImage(file) {
    if (!draft || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const media_id = await uploadStorefrontImage(draft.ad_id, file)
      const result = await editAdvertisingCampaign({ ...draft }, { ...values, media_id }, false, desiredDays)
      setValues((v) => ({ ...v, media_id }))
      setDraft({ ad_id: draft.ad_id, version: result.version })
    } catch (e) {
      setError(commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  if (submitted) {
    return (
      <Box sx={{ mt: 3 }}>
        <Flash variant="success">
          Enviado para aprovação. Status atual:{' '}
          {submitted.state === 'submitted' ? 'Em análise' : submitted.state}.
        </Flash>
        <Text as="p" sx={{ mt: 2 }}>
          Enviar para aprovação é gratuito. Você só autoriza o uso de EvoCash na contratação.
        </Text>
        <Button sx={{ mt: 2 }} onClick={() => onDone?.(submitted)}>
          Voltar para Meus anúncios
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ mt: 3, border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}>
      <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
        Criar anúncio — {STEPS[step - 1]}
      </Heading>
      <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 3 }}>
        Etapa {step} de 4
      </Text>
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {step === 1 && (
        <Box>
          {PLACEMENT_OPTIONS.map((opt) => (
            <Box
              key={opt.code}
              as="button"
              type="button"
              onClick={() => setPlacement(opt.code)}
              sx={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                bg: placement === opt.code ? 'accent.subtle' : 'canvas.subtle',
                border: '1px solid',
                borderColor: placement === opt.code ? 'accent.emphasis' : 'border.default',
                borderRadius: 2,
                p: 3,
                mb: 2,
                cursor: 'pointer',
              }}
            >
              <Text as="p" sx={{ fontWeight: 'bold' }}>
                {opt.title}
              </Text>
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
                {opt.description}
              </Text>
            </Box>
          ))}
          {communityOffered && (
            <FormControl required={communityRequired} sx={{ mt: 2 }}>
              <FormControl.Label>Comunidade que você administra</FormControl.Label>
              <Select block value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
                <Select.Option value="">
                  {placement === 'network'
                    ? 'Nenhuma (se o pacote usar só posições gerais)'
                    : 'Selecione sua comunidade'}
                </Select.Option>
                {communities.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select>
              {placement === 'network' && (
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 1 }}>
                  Deixe em branco se o pacote configurado não usar posições de comunidade. Se usar,
                  o Evolutus pedirá a comunidade ao enviar.
                </Text>
              )}
              {communityId && <CommunityAdvertisingPermissions communityId={communityId} />}
            </FormControl>
          )}
          <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
            <Button
              variant="primary"
              disabled={!placement || (communityRequired && !communityId)}
              onClick={() => setStep(2)}
            >
              Avançar
            </Button>
          </Box>
        </Box>
      )}

      {step === 2 && (
        <Box>
          <FormControl required>
            <FormControl.Label>Nome e título do anúncio</FormControl.Label>
            <TextInput
              block
              maxLength={100}
              value={values.title}
              onChange={(e) => setValues({ ...values, title: e.target.value })}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Descrição curta</FormControl.Label>
            <Textarea
              block
              maxLength={500}
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
            />
          </FormControl>
          <FormControl required>
            <FormControl.Label>Link de destino (HTTPS)</FormControl.Label>
            <TextInput
              block
              type="url"
              maxLength={300}
              placeholder="https://sua-empresa.com.br"
              value={values.destination}
              onChange={(e) => setValues({ ...values, destination: e.target.value })}
            />
          </FormControl>
          {!draft && (
            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
              Salve os dados para habilitar o envio de imagem.
            </Text>
          )}
          {draft && (
            <FormControl disabled={busy}>
              <FormControl.Label>Imagem do anúncio (opcional)</FormControl.Label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadImage(file)
                }}
              />
              {values.media_id && <StorefrontImage id={values.media_id} size={160} />}
            </FormControl>
          )}
          <Box sx={{ my: 3, p: 2, bg: 'canvas.subtle', borderRadius: 2 }} aria-label="Prévia do anúncio">
            {values.media_id && <StorefrontImage id={values.media_id} size={160} />}
            <Text as="p" sx={{ fontWeight: 'bold' }}>
              {values.title || 'Seu anúncio'}
            </Text>
            <Text as="p">{values.description}</Text>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {/* Placement is immutable once the draft exists (edit_advertising_campaign has
               no placement parameter), so going back to change it only makes sense before
               the first save. */}
            {!draft && <Button onClick={() => setStep(1)}>Voltar</Button>}
            <Button disabled={busy || !minimumContentValid} onClick={() => saveDraft(false)}>
              Salvar dados
            </Button>
            <Button
              variant="primary"
              disabled={busy || !draft || !minimumContentValid}
              onClick={async () => {
                const result = await saveDraft(false)
                if (result) setStep(3)
              }}
            >
              Avançar
            </Button>
          </Box>
        </Box>
      )}

      {step === 3 && (
        <Box>
          <FormControl required>
            <FormControl.Label>Por quantos dias você deseja anunciar?</FormControl.Label>
            <TextInput
              block
              type="number"
              min={1}
              max={3650}
              value={desiredDays}
              onChange={(e) => setDesiredDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
            />
          </FormControl>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            O prazo definitivo só é confirmado na contratação, após aprovação e disponibilidade.
            Esta escolha é apenas uma intenção: não reserva posição nem inicia qualquer período.
          </Text>
          <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            <Button onClick={() => setStep(2)}>Voltar</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                const result = await saveDraft(false)
                if (result) setStep(4)
              }}
            >
              Avançar
            </Button>
          </Box>
        </Box>
      )}

      {step === 4 && (
        <Box>
          <Box sx={{ p: 2, bg: 'canvas.subtle', borderRadius: 2, mb: 3 }}>
            {values.media_id && <StorefrontImage id={values.media_id} size={160} />}
            <Text as="p" sx={{ fontWeight: 'bold' }}>
              {values.title}
            </Text>
            <Text as="p">{values.description}</Text>
            <Text as="p">Destino: {values.destination}</Text>
            <Text as="p">Local: {placementDisplay}</Text>
            <Text as="p">Duração desejada: {desiredDays} dia(s)</Text>
          </Box>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
            Enviar para aprovação é gratuito. Você só autoriza o uso de EvoCash na contratação.
          </Text>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button onClick={() => setStep(3)}>Voltar</Button>
            <Button variant="primary" disabled={busy} onClick={() => saveDraft(true)}>
              {busy ? <Spinner size="small" /> : 'Enviar para aprovação'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Select,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import {
  createAdvertisingCampaign,
  editAdvertisingCampaign,
  getAdvertisingSalesStatus,
} from '../../services/advertisingService'
import { listActiveCommunities } from '../../services/communitiesService'
import { uploadStorefrontImage } from '../../services/storefrontService'
import StorefrontImage from '../StorefrontImage'
import AdvertisingCreativePreview from './AdvertisingCreativePreview'
import CommunityAdvertisingPermissions from '../CommunityAdvertisingPermissions'
import { MarkdownField } from '../MarkdownField'
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
    code: 'progress_banner',
    title: 'Progresso',
    description: 'Banner discreto na página de Progresso.',
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
]
const NIL_CONTEXT = '00000000-0000-0000-0000-000000000000'
const EMPTY_VALUES = { title: '', description: '', destination: '', media_id: null }
const STEPS = ['Onde anunciar', 'Conteúdo', 'Revisar e enviar']
const STORAGE_PREFIX = 'evolutus:ad-wizard:'
const GENERIC_MIN_DAYS = 1
const GENERIC_MAX_DAYS = 3650

// Isolado por usuário autenticado, conta, modo (criação vs. edição de um anúncio específico)
// e, em edição, pelo próprio ad_id -- nunca cruza rascunhos de contas, usuários ou anúncios
// diferentes (ver seção 6 do prompt de reestruturação).
function storageKey(uid, accountId, mode, adId) {
  return `${STORAGE_PREFIX}${uid || 'anon'}:${accountId}:${mode}${adId ? `:${adId}` : ''}`
}
function loadSaved(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveProgress(key, state) {
  try {
    sessionStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Browser storage can throw (private mode, quota, disabled). Never block the wizard.
  }
}
function clearProgress(key) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Same as above: best-effort only.
  }
}

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

export default function CreateAdWizard({
  accountId,
  accountName,
  existingDraft,
  onDone,
  onCancel,
}) {
  const { user } = useAuth()
  const mode = existingDraft ? 'edit' : 'create'
  const storageId = storageKey(user?.uid, accountId, mode, existingDraft?.ad_id)
  // Congelado na primeira renderização: nunca deve refletir os próprios saves que este
  // componente vai fazer depois. Edição sempre parte do servidor (existingDraft), nunca de um
  // sessionStorage potencialmente de outra sessão/edição -- é a causa raiz do bug de mistura
  // de rascunhos apontado no diagnóstico.
  const [resuming] = useState(() => (mode === 'create' ? loadSaved(storageId) : null))

  const [step, setStep] = useState(mode === 'edit' ? 2 : resuming?.step || 1)
  const [placement, setPlacement] = useState(
    existingDraft?.placements?.[0]?.code || resuming?.placement || ''
  )
  const [communityId, setCommunityId] = useState(() => {
    if (existingDraft?.placements) {
      const communityEntry = existingDraft.placements.find(
        (p) => p.context && p.context !== NIL_CONTEXT
      )
      return communityEntry?.context || ''
    }
    return resuming?.communityId || ''
  })
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
  const [daysInput, setDaysInput] = useState(String(desiredDays))
  const [draft, setDraft] = useState(
    existingDraft
      ? { ad_id: existingDraft.ad_id, version: existingDraft.version }
      : resuming?.draft || null
  )
  const [communities, setCommunities] = useState([])
  const [salesStatus, setSalesStatus] = useState(null)
  const [salesError, setSalesError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(null)
  // Uma imagem recém-selecionada ainda não enviada ao servidor: só prévia local, liberada ao
  // trocar/remover/desmontar. O envio real só acontece ao avançar da Etapa 2 (seção 5.2.2).
  const [pendingImage, setPendingImage] = useState(null)
  const [savedIndicator, setSavedIndicator] = useState(false)
  const lock = useRef(false)
  const intent = useRef(null)
  const fileInputRef = useRef(null)
  // Uma imagem escolhida antes de uma interrupção (fechar a aba, recarregar) nunca sobrevive
  // ao sessionStorage (File não é serializável) -- mas o fato de que havia uma, sim.
  const imageLostOnResume =
    mode === 'create' && Boolean(resuming?.hadPendingImage) && !pendingImage && !values.media_id

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
    if (mode === 'edit') return
    let live = true
    getAdvertisingSalesStatus()
      .then((rows) => {
        if (live) setSalesStatus(rows)
      })
      .catch(() => {
        if (live) setSalesError(true)
      })
    return () => {
      live = false
    }
  }, [mode])

  // Prévia local: a URL de objeto é liberada sempre que a imagem pendente muda ou o
  // componente desmonta, nunca só ao enviar -- cobre troca, remoção e cancelamento.
  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl)
    }
  }, [pendingImage])

  useEffect(() => {
    if (submitted || mode !== 'create') return
    const timer = setTimeout(() => {
      saveProgress(storageId, {
        step,
        placement,
        communityId,
        values,
        desiredDays,
        draft,
        hadPendingImage: Boolean(pendingImage),
      })
      setSavedIndicator(true)
    }, 600)
    return () => clearTimeout(timer)
  }, [storageId, mode, step, placement, communityId, values, desiredDays, draft, pendingImage, submitted])

  useEffect(() => {
    if (!savedIndicator) return
    const t = setTimeout(() => setSavedIndicator(false), 1500)
    return () => clearTimeout(t)
  }, [savedIndicator])

  const placementDisplay = existingDraft?.placements
    ? placementsSummary(existingDraft.placements)
    : PLACEMENT_LABELS[placement] || placement
  const communityRequired = placement === 'community_banner' || placement === 'community_feed'
  const previewPlacements = existingDraft?.placements || [placement]
  const hasFeed = previewPlacements.some(
    (item) => (typeof item === 'string' ? item : item.code) === 'community_feed'
  )
  const availableOptions = PLACEMENT_OPTIONS.map((opt) => ({
    ...opt,
    tariff: salesStatus?.find((row) => row.code === opt.code)?.tariff || null,
  })).filter(
    (opt) =>
      salesStatus?.some((row) => row.code === opt.code && row.salesEnabled) &&
      (!['community_banner', 'community_feed'].includes(opt.code) || communities.length > 0)
  )
  const minimumContentValid = values.title.trim().length > 0 && isValidHttpsUrl(values.destination)
  // Local contratado é somente leitura (sem suporte seguro pra troca de posicionamento ou
  // comunidade em edição); exibir a comunidade certa depende de hidratar communityId a
  // partir de existingDraft.placements, não do sessionStorage de uma campanha diferente.
  const communityName = communityId
    ? communities.find((c) => c.id === communityId)?.name || null
    : null
  const localDisplay = communityName ? `${placementDisplay} · ${communityName}` : placementDisplay

  // Tarifa vigente: em edição, já vem resolvida pela mesma campanha em get_advertising_campaigns;
  // em criação, vem da leitura fina por posicionamento (advertising_sales_status). Faixa de dias
  // cai para o limite genérico só quando não há tarifa alguma ainda (nunca mais permissivo do
  // que o servidor aceitaria).
  const tariff =
    mode === 'edit'
      ? existingDraft?.tariff
      : salesStatus?.find((row) => row.code === placement)?.tariff
  const minDays = Number(tariff?.minDays) || GENERIC_MIN_DAYS
  const maxDays = Number(tariff?.maxDays) || GENERIC_MAX_DAYS
  const parsedDays = /^[0-9]+$/.test(daysInput.trim()) ? Number(daysInput.trim()) : null
  const daysValid = parsedDays != null && parsedDays >= minDays && parsedDays <= maxDays
  const daysError =
    daysInput.trim() === ''
      ? 'Informe a quantidade de dias.'
      : parsedDays == null
        ? 'Use apenas números inteiros, sem casas decimais.'
        : !daysValid
          ? `Escolha um valor entre ${minDays} e ${maxDays} dias.`
          : ''
  const estimatedTotal = tariff?.price && daysValid ? Number(tariff.price) * parsedDays : null

  useEffect(() => {
    if (daysValid) setDesiredDays(parsedDays)
  }, [daysValid, parsedDays])

  function stepDays(delta) {
    const base = parsedDays ?? minDays
    setDaysInput(String(Math.min(maxDays, Math.max(minDays, base + delta))))
  }

  const displayImage = pendingImage
    ? { kind: 'local', url: pendingImage.previewUrl }
    : values.media_id
      ? { kind: 'remote', id: values.media_id }
      : null

  function attachImage(file) {
    if (busy) return
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) })
  }

  async function removeImage() {
    if (lock.current) return
    if (pendingImage) {
      setPendingImage(null)
      return
    }
    if (!values.media_id || !draft) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await editAdvertisingCampaign(draft, values, false, null, true)
      setDraft({ ad_id: draft.ad_id, version: result.version })
      setValues((v) => ({ ...v, media_id: null }))
    } catch (e) {
      setError(commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // Cria o rascunho (se ainda não existir) e envia a imagem pendente (se houver) coordenados
  // com o avanço de etapa -- nunca ao simples acesso à tela, e nunca exigindo um botão
  // "Salvar dados" separado só para desbloquear o upload (seção 5.2.2 do prompt).
  async function commitContentAndAdvance() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      let current = draft
      if (!current) {
        intent.current ||= crypto.randomUUID()
        const ad_id = await createAdvertisingCampaign(
          accountId,
          { placement, communityId, ...values },
          intent.current
        )
        current = { ad_id, version: 1 }
        setDraft(current)
      }
      let media_id = values.media_id
      if (pendingImage) {
        media_id = await uploadStorefrontImage(current.ad_id, pendingImage.file)
      }
      const result = await editAdvertisingCampaign(current, { ...values, media_id }, false)
      setDraft({ ad_id: current.ad_id, version: result.version })
      if (pendingImage) setPendingImage(null)
      setValues((v) => ({ ...v, media_id }))
      setStep(3)
    } catch (e) {
      if (!draft && e?.message === 'IDEMPOTENCY_CONFLICT') intent.current = null
      setError(commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function submitForApproval() {
    if (lock.current || !draft || !daysValid) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await editAdvertisingCampaign(draft, values, true, desiredDays)
      setSubmitted(result)
      clearProgress(storageId)
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
          Enviar para aprovação é gratuito. Você só utiliza EvoCash depois de confirmar a
          contratação.
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
          Etapa {step} de 3
        </Text>
        {mode === 'create' && (
          <Text
            as="p"
            aria-live="polite"
            sx={{ fontSize: 0, color: 'fg.muted', opacity: savedIndicator ? 1 : 0, transition: 'opacity 200ms' }}
          >
            Rascunho salvo
          </Text>
        )}
      </Box>
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {step === 1 && (
        <Box>
          {!salesStatus && !salesError && <Spinner size="small" />}
          {salesError && (
            <Flash variant="danger">
              Não foi possível consultar os espaços disponíveis. Reabra o assistente para tentar
              novamente.
            </Flash>
          )}
          {salesStatus && availableOptions.length === 0 && (
            <Text>Nenhum espaço disponível para contratação agora.</Text>
          )}
          {availableOptions.map((opt) => (
            <Box
              key={opt.code}
              as="button"
              type="button"
              aria-label={`Selecionar posicionamento ${opt.title}`}
              aria-pressed={placement === opt.code}
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
              {opt.tariff && (
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 1 }}>
                  {opt.tariff.price} EvoCash/dia · {opt.tariff.minDays} a {opt.tariff.maxDays} dias
                </Text>
              )}
            </Box>
          ))}
          {communityRequired && (
            <FormControl required sx={{ mt: 2 }}>
              <FormControl.Label>Comunidade que você administra</FormControl.Label>
              <Select
                block
                aria-label="Comunidade que você administra"
                value={communityId}
                onChange={(e) => setCommunityId(e.target.value)}
              >
                <Select.Option value="">Selecione sua comunidade</Select.Option>
                {communities.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select>
              {communityId && <CommunityAdvertisingPermissions communityId={communityId} />}
            </FormControl>
          )}
          <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
            <Button
              variant="primary"
              disabled={
                !availableOptions.some((opt) => opt.code === placement) ||
                (communityRequired && !communityId)
              }
              onClick={() => setStep(2)}
            >
              Avançar
            </Button>
          </Box>
        </Box>
      )}

      {step === 2 && (
        <Box>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
            Local: {localDisplay}
          </Text>
          <FormControl required>
            <FormControl.Label>Nome e título do anúncio</FormControl.Label>
            <TextInput
              block
              aria-label="Nome e título do anúncio"
              maxLength={100}
              value={values.title}
              onChange={(e) => setValues({ ...values, title: e.target.value })}
            />
          </FormControl>
          {hasFeed && (
            <Box sx={{ mt: 3 }}>
              <MarkdownField
                label="Descrição do anúncio"
                profile="ads"
                value={values.description}
                onChange={(v) => setValues({ ...values, description: v })}
                maxLength={500}
                rows={4}
                placeholder="Descreva seu anúncio..."
              />
            </Box>
          )}
          <FormControl required sx={{ mt: 3 }}>
            <FormControl.Label>Link de destino (HTTPS)</FormControl.Label>
            <TextInput
              block
              type="url"
              aria-label="Link de destino"
              maxLength={300}
              placeholder="https://sua-empresa.com.br"
              value={values.destination}
              onChange={(e) => setValues({ ...values, destination: e.target.value })}
            />
            {values.destination && !isValidHttpsUrl(values.destination) && (
              <FormControl.Validation variant="error">
                Informe um endereço HTTPS válido, sem usuário/senha embutidos.
              </FormControl.Validation>
            )}
          </FormControl>
          {hasFeed && (
            <FormControl disabled={busy} sx={{ mt: 3 }}>
              <FormControl.Label>Imagem do anúncio (opcional)</FormControl.Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) attachImage(file)
                  e.target.value = ''
                }}
              />
              {imageLostOnResume && (
                <Flash variant="attention" sx={{ mb: 2 }}>
                  Uma imagem selecionada antes de uma interrupção não foi salva. Adicione-a de
                  novo, se ainda quiser usá-la.
                </Flash>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                {displayImage?.kind === 'local' && (
                  <img
                    src={displayImage.url}
                    alt="Prévia local da imagem selecionada"
                    width={96}
                    height={96}
                    style={{ objectFit: 'cover', borderRadius: 8 }}
                  />
                )}
                {displayImage?.kind === 'remote' && (
                  <StorefrontImage id={displayImage.id} size={96} />
                )}
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                    {displayImage ? 'Trocar imagem' : 'Adicionar imagem'}
                  </Button>
                  {displayImage && (
                    <Button type="button" variant="danger" disabled={busy} onClick={removeImage}>
                      Remover imagem
                    </Button>
                  )}
                </Box>
              </Box>
              {displayImage?.kind === 'local' && (
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 1 }}>
                  Ainda não enviada — será enviada ao avançar.
                </Text>
              )}
            </FormControl>
          )}
          <Box sx={{ my: 3 }}>
            <AdvertisingCreativePreview
              placements={previewPlacements}
              partnerName={accountName}
              title={values.title}
              description={values.description}
              mediaId={displayImage?.kind === 'remote' ? displayImage.id : null}
              imageUrl={displayImage?.kind === 'local' ? displayImage.url : null}
            />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {/* Placement is immutable once the draft exists (edit_advertising_campaign has
               no placement parameter), so going back to change it only makes sense before
               the first save. */}
            {mode === 'create' && !draft && <Button onClick={() => setStep(1)}>Voltar</Button>}
            {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
            <Button
              variant="primary"
              aria-label="Avançar"
              disabled={busy || !minimumContentValid}
              onClick={commitContentAndAdvance}
            >
              {busy ? <Spinner size="small" /> : 'Avançar'}
            </Button>
          </Box>
        </Box>
      )}

      {step === 3 && (
        <Box>
          <Box sx={{ p: 2, bg: 'canvas.subtle', borderRadius: 2, mb: 3 }}>
            <Text as="p">Local: {localDisplay}</Text>
            <Text as="p" sx={{ overflowWrap: 'anywhere' }}>
              Destino: {values.destination}
            </Text>
          </Box>
          <AdvertisingCreativePreview
            placements={previewPlacements}
            partnerName={accountName}
            title={values.title}
            description={values.description}
            mediaId={values.media_id}
          />

          <FormControl required sx={{ mt: 3 }}>
            <FormControl.Label>Por quantos dias você deseja anunciar?</FormControl.Label>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                type="button"
                aria-label="Diminuir um dia"
                disabled={busy || (parsedDays ?? minDays) <= minDays}
                onClick={() => stepDays(-1)}
              >
                −
              </Button>
              <TextInput
                aria-label="Quantidade de dias"
                sx={{ width: 100 }}
                inputMode="numeric"
                value={daysInput}
                onChange={(e) => setDaysInput(e.target.value.replace(/[^0-9]/g, ''))}
                validationStatus={daysError ? 'error' : undefined}
              />
              <Button
                type="button"
                aria-label="Aumentar um dia"
                disabled={busy || (parsedDays ?? minDays) >= maxDays}
                onClick={() => stepDays(1)}
              >
                +
              </Button>
            </Box>
            {daysError ? (
              <FormControl.Validation variant="error">{daysError}</FormControl.Validation>
            ) : (
              <FormControl.Caption>
                Faixa autorizada agora: {minDays} a {maxDays} dias.
              </FormControl.Caption>
            )}
          </FormControl>

          {tariff?.price ? (
            <Box sx={{ p: 2, bg: 'canvas.subtle', borderRadius: 2, mt: 2 }}>
              <Text as="p">Preço: {tariff.price} EvoCash/dia</Text>
              {estimatedTotal != null && (
                <Text as="p" sx={{ fontWeight: 'bold' }}>
                  Total estimado: {estimatedTotal} EvoCash
                </Text>
              )}
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 1 }}>
                Esta é apenas uma estimativa: ela não reserva espaço nem garante este preço no
                futuro. O valor definitivo só é confirmado na contratação, após a aprovação.
              </Text>
            </Box>
          ) : (
            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 2 }}>
              Não há tarifa vigente para calcular uma estimativa agora. Isso não impede o envio
              para aprovação.
            </Text>
          )}

          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 3, mb: 2 }}>
            Enviar para aprovação é gratuito. Você só utiliza EvoCash depois de confirmar a
            contratação.
          </Text>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button onClick={() => setStep(2)}>Voltar</Button>
            {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
            <Button
              variant="primary"
              aria-label="Enviar para aprovação"
              disabled={busy || !daysValid}
              onClick={submitForApproval}
            >
              {busy ? <Spinner size="small" /> : 'Enviar para aprovação'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}

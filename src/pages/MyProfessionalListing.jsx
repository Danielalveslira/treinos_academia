import { useEffect, useRef, useState } from 'react'
import { Button, Flash, Spinner } from '@primer/react'
import { Link } from 'react-router-dom'
import { ProfessionalListingCard } from '../components/ProfessionalListingCard'
import {
  BRAZIL_STATES,
  CATEGORY_OPTIONS,
  LISTING_KIND_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
} from '../constants/professionalListingTaxonomy'
import { useAuth } from '../hooks/useAuth'
import { listActiveCommunities } from '../services/communitiesService'
import {
  acknowledgeShowcaseTerms,
  createProfessionalListing,
  deleteProfessionalListing,
  getActiveShowcasePolicy,
  getMyProfessionalListing,
  getShowcaseLegalAcknowledgement,
  publishProfessionalListing,
  saveProfessionalListing,
  unpublishProfessionalListing,
} from '../services/professionalListingsService'
import { setUsageProfile } from '../services/usageProfileService'
import { EMPTY_LISTING_DRAFT } from '../utils/professionalListing'
import { shouldShowShowcaseTermsBanner } from '../utils/showcaseLegal'
import { isEligibleForListingCreation } from '../constants/usageProfile'
import { UsageProfileField } from '../components/UsageProfileField'

// RPCs do Supabase lançam códigos curtos (ver migration
// 20260929000005_professional_listings.sql), não frases prontas -- esta tela sempre
// mostrou error.message direto pro usuário, então precisa traduzir aqui pra não vazar o
// código cru.
const KNOWN_ERRORS = {
  INVALID_ARGUMENT: 'Dados inválidos para criar a vitrine.',
  ACCOUNT_DELETING: 'A conta não pode alterar uma vitrine agora.',
  ALREADY_EXISTS: 'Sua conta já possui uma vitrine de outro tipo.',
  NOT_ELIGIBLE:
    'Defina seu perfil de uso como profissional ou responsável por estabelecimento em Meu Perfil antes de criar uma vitrine.',
  LISTING_NOT_FOUND: 'Vitrine não encontrada.',
  LISTING_NOT_EDITABLE: 'A vitrine não pode ser alterada neste estado.',
  KIND_IMMUTABLE: 'O tipo da vitrine não pode ser alterado.',
  INVALID_DISPLAY_NAME: 'Informe um nome com até 80 caracteres.',
  INVALID_CATEGORY: 'Categoria inválida.',
  INVALID_MODALITIES: 'Selecione entre uma e cinco modalidades.',
  TOO_MANY_SPECIALTIES: 'Informe no máximo dez especialidades.',
  INVALID_BIO: 'Informe uma apresentação com até 1.500 caracteres.',
  INVALID_CITY: 'Informe uma cidade com até 80 caracteres.',
  INVALID_UF: 'Estado inválido.',
  INVALID_SERVICE_MODE: 'Atendimento inválido.',
  INVALID_CONTACTS: 'Use somente links HTTPS válidos para os contatos.',
  INVALID_LINKED_COMMUNITY: 'Você só pode vincular uma comunidade ativa da qual é titular.',
  PUBLISH_IN_PROGRESS: 'Uma publicação desta vitrine está em andamento.',
  DRAFT_INCOMPLETE: 'Salve um rascunho completo antes de publicar.',
}

const STATE_LABELS = {
  draft: 'Rascunho',
  // Legado: vitrines com uma submissão presa no antigo fluxo de aprovação (antes da
  // publicação direta). Some sozinho assim que o titular salvar o rascunho de novo.
  pending_review: 'Em revisão (legado)',
  published: 'Publicada',
  suspended: 'Suspensa',
  archived: 'Despublicada',
  deleting: 'Exclusão pendente',
}

function editableDraft(data, kind) {
  // Um rascunho recém-criado (create_professional_listing) vem do servidor com todo
  // campo de texto opcional como null, não '' (professional_listing_drafts não tem
  // default pra display_name/category_key/bio/city/uf/service_mode) -- um ...data por
  // cima de EMPTY_LISTING_DRAFT sobrescreve o default com esse null (chave presente
  // vence o spread anterior), e form.bio.length quebra a tela inteira. ?? troca só os
  // null/undefined pelo default; '' explicitamente digitado pelo usuário continua ''.
  return {
    ...EMPTY_LISTING_DRAFT,
    ...data,
    displayName: data?.displayName ?? EMPTY_LISTING_DRAFT.displayName,
    categoryKey: data?.categoryKey ?? EMPTY_LISTING_DRAFT.categoryKey,
    bio: data?.bio ?? EMPTY_LISTING_DRAFT.bio,
    city: data?.city ?? EMPTY_LISTING_DRAFT.city,
    uf: data?.uf ?? EMPTY_LISTING_DRAFT.uf,
    serviceMode: data?.serviceMode ?? EMPTY_LISTING_DRAFT.serviceMode,
    kind,
    contacts: { ...EMPTY_LISTING_DRAFT.contacts, ...data?.contacts },
    linkedCommunityId: data?.linkedCommunityId || '',
    specialtiesText: data?.specialties?.join(', ') || '',
  }
}

export default function MyProfessionalListing() {
  const { user, profile } = useAuth()
  const [record, setRecord] = useState(undefined)
  const [loadError, setLoadError] = useState(false)
  const [loadRevision, setLoadRevision] = useState(0)
  const [form, setForm] = useState(null)
  const [communities, setCommunities] = useState([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null)
  // Ciência (não aceite) da versão vigente dos Termos -- só decide o aviso abaixo, nunca
  // bloqueia salvar/publicar (ver decisão de produto em
  // 20261001000002_showcase_terms_acknowledgement.sql).
  const [showcasePolicy, setShowcasePolicy] = useState(null)
  const [showcaseAcknowledgement, setShowcaseAcknowledgement] = useState(null)
  const submissionOperation = useRef(null)

  async function reload() {
    const current = await getMyProfessionalListing(user.uid)
    if (current && (!current.listing || !current.draft)) {
      throw new Error('SHOWCASE_INCOMPLETE_RECORD')
    }
    setRecord(current)
    if (current) setForm(editableDraft(current.draft, current.listing.kind))
  }

  useEffect(() => {
    let active = true
    setLoadError(false)
    const timeout = window.setTimeout(() => {
      if (active) setLoadError(true)
    }, 15000)
    getMyProfessionalListing(user.uid)
      .then((current) => {
        if (!active) return
        if (current && (!current.listing || !current.draft)) {
          throw new Error('SHOWCASE_INCOMPLETE_RECORD')
        }
        setRecord(current)
        if (current) setForm(editableDraft(current.draft, current.listing.kind))
      })
      .catch((error) => {
        if (!active) return
        console.error('[Vitrine] carregamento inicial:', error)
        setLoadError(true)
      })
      .finally(() => window.clearTimeout(timeout))
    listActiveCommunities()
      .then((allCommunities) => {
        if (!active) return
        setCommunities(allCommunities.filter((community) => community.ownerId === user.uid))
      })
      .catch(() => {
        if (active)
          setMessage({
            variant: 'warning',
            text: 'Não foi possível carregar suas comunidades. A vitrine pode ser editada sem vínculo por enquanto.',
          })
      })
    // Ciência (não aceite) da versão vigente -- nunca bloqueia nada, então uma falha
    // aqui só loga e segue (ver decisão de produto em
    // 20261001000002_showcase_terms_acknowledgement.sql).
    getActiveShowcasePolicy()
      .then((policy) => {
        if (!active) return
        setShowcasePolicy(policy)
        if (!policy.published || !policy.version) return Promise.resolve(null)
        return getShowcaseLegalAcknowledgement(user.uid, policy.version)
      })
      .then((acknowledgement) => {
        if (active) setShowcaseAcknowledgement(acknowledgement)
      })
      .catch((error) => console.error('[Vitrine] showcase terms state:', error))
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [user.uid, loadRevision])

  function edit(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setMessage(null)
  }

  function editContact(field, value) {
    setForm((current) => ({ ...current, contacts: { ...current.contacts, [field]: value } }))
    setMessage(null)
  }

  function toggleModality(value) {
    setForm((current) => ({
      ...current,
      modalityKeys: current.modalityKeys.includes(value)
        ? current.modalityKeys.filter((item) => item !== value)
        : current.modalityKeys.length < 5
          ? [...current.modalityKeys, value]
          : current.modalityKeys,
    }))
  }

  async function create(kind) {
    setBusy('create')
    setMessage(null)
    try {
      await createProfessionalListing(kind)
      await reload()
    } catch (error) {
      setMessage({
        variant: 'danger',
        text: KNOWN_ERRORS[error?.message] || 'Não foi possível criar a vitrine.',
      })
    } finally {
      setBusy('')
    }
  }

  // Preenchimento contextual para conta legada (usageProfile ainda ausente): o
  // AuthContext mantém um listener ao vivo em users/{uid}, então profile.usageProfile
  // já reflete o novo valor no próximo render, sem precisar recarregar nada aqui.
  async function declareUsageProfile(value) {
    setBusy('usageProfile')
    setMessage(null)
    try {
      await setUsageProfile(value)
    } catch {
      setMessage({ variant: 'danger', text: 'Não foi possível salvar seu perfil de uso.' })
    } finally {
      setBusy('')
    }
  }

  function payload() {
    const { specialtiesText, ...draft } = form
    return {
      ...draft,
      specialties: specialtiesText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    }
  }

  async function save(event) {
    event.preventDefault()
    setBusy('save')
    setMessage(null)
    try {
      await saveProfessionalListing(record.id, payload())
      submissionOperation.current = null
      await reload()
      setMessage({ variant: 'success', text: 'Rascunho salvo.' })
    } catch (error) {
      setMessage({ variant: 'danger', text: KNOWN_ERRORS[error?.message] || 'Não foi possível salvar.' })
    } finally {
      setBusy('')
    }
  }

  async function publish() {
    setBusy('publish')
    setMessage(null)
    try {
      submissionOperation.current ||= crypto.randomUUID().replaceAll('-', '')
      await publishProfessionalListing(record.id, submissionOperation.current)
      await reload()
      submissionOperation.current = null
      setMessage({ variant: 'success', text: 'Vitrine publicada.' })
    } catch (error) {
      setMessage({ variant: 'danger', text: KNOWN_ERRORS[error?.message] || 'Não foi possível publicar.' })
    } finally {
      setBusy('')
    }
  }

  // Nunca é condição de salvar/publicar -- só esconde o aviso. "OK, entendi" pode falhar
  // (rede) sem que o titular perca a capacidade de editar/publicar: por isso erro aqui
  // vira mensagem de aviso, nunca bloqueia o resto da tela.
  async function acknowledgeTerms() {
    setBusy('acknowledge-terms')
    try {
      await acknowledgeShowcaseTerms()
      setShowcaseAcknowledgement({ version: showcasePolicy.version, acknowledgedAt: new Date().toISOString() })
    } catch (error) {
      console.error('[Vitrine] acknowledge terms:', error)
      setMessage({
        variant: 'warning',
        text: 'Não foi possível registrar a confirmação agora. Tente novamente.',
      })
    } finally {
      setBusy('')
    }
  }

  async function unpublish() {
    if (!window.confirm('Despublicar esta vitrine agora?')) return
    setBusy('unpublish')
    try {
      await unpublishProfessionalListing(record.id)
      await reload()
    } catch {
      setMessage({ variant: 'danger', text: 'Não foi possível despublicar.' })
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!window.confirm('Excluir permanentemente sua vitrine e o rascunho?')) return
    setBusy('delete')
    try {
      await deleteProfessionalListing(record.id)
      setRecord(null)
      setForm(null)
    } catch {
      setMessage({ variant: 'danger', text: 'Não foi possível excluir a vitrine.' })
    } finally {
      setBusy('')
    }
  }

  const preview = form && {
    id: record?.id || 'preview',
    ...payload(),
    avatarPath: form.useProfileAvatar ? profile?.avatarPath : null,
  }

  if (record === undefined)
    return (
      <div className="professional-state">
        {loadError ? (
          <>
            <Flash variant="danger">Não foi possível carregar sua vitrine.</Flash>
            <Button onClick={() => setLoadRevision((revision) => revision + 1)}>
              Tentar novamente
            </Button>
          </>
        ) : (
          <Spinner aria-label="Carregando sua vitrine" />
        )}
      </div>
    )
  if (!record) {
    const usageProfile = profile?.usageProfile
    return (
      <div className="my-listing-page">
        <header className="profile-page-heading">
          <span className="profile-eyebrow">SUA PRESENÇA PROFISSIONAL</span>
          <h1>Minha vitrine</h1>
          <p>Crie uma página pública para apresentar seu trabalho ou espaço.</p>
        </header>
        {message && <Flash variant={message.variant}>{message.text}</Flash>}
        {!usageProfile ? (
          // Conta legada: nunca declarou o perfil de uso. Preenchimento contextual
          // aqui mesmo, no ponto em que isso passa a importar -- não bloqueia o resto
          // do app nem classifica ninguém como "comum" por omissão.
          <>
            <p>Antes de continuar, diga como você pretende usar o Evolutus.</p>
            <UsageProfileField
              value=""
              onChange={declareUsageProfile}
              legend="Como você pretende utilizar o Evolutus?"
              disabled={Boolean(busy)}
            />
          </>
        ) : isEligibleForListingCreation(usageProfile) ? (
          <section className="listing-kind-picker">
            {LISTING_KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => create(option.value)}
                disabled={Boolean(busy)}
              >
                <strong>{option.label}</strong>
                <span>
                  {option.value === 'professional'
                    ? 'Para personal trainers, treinadores e especialistas.'
                    : 'Para academias, boxes, estúdios e assessorias.'}
                </span>
              </button>
            ))}
          </section>
        ) : (
          <Flash variant="warning">
            A criação de Vitrine fica disponível para os perfis de uso Profissional e
            Responsável por estabelecimento. Você pode mudar isso a qualquer momento em{' '}
            <Link to="/perfil">Meu perfil</Link>.
          </Flash>
        )}
      </div>
    )
  }
  // record e form são setState separados feitos juntos (mesmo callback), mas nada
  // garante que sempre cheguem no mesmo commit -- sem isto, um record já truthy com
  // form ainda null quebraria form.displayName logo abaixo.
  if (!form)
    return (
      <div className="professional-state">
        <Spinner aria-label="Carregando sua vitrine" />
      </div>
    )

  // 'publishing' é a trava transitória do publish() -- na prática o titular quase
  // nunca observa isso (a chamada é síncrona do ponto de vista do cliente); só fica
  // visível se uma tentativa anterior travou pela metade (ex.: função derrubada no
  // meio da cópia do avatar) e o titular ainda não tentou de novo.
  const publishing = record.draft?.reviewState === 'publishing'
  const pending = publishing || record.listing.lifecycleState === 'pending_review'
  const state = record.listing.lifecycleState
  const showTermsBanner = shouldShowShowcaseTermsBanner({
    policy: showcasePolicy,
    acknowledgement: showcaseAcknowledgement,
  })
  return (
    <div className="my-listing-page">
      <header className="listing-dashboard-heading">
        <div>
          <span className="profile-eyebrow">MINHA VITRINE</span>
          <h1>{form.displayName || 'Configure sua apresentação'}</h1>
          <p>
            Estado: <strong>{STATE_LABELS[state] || state}</strong>
          </p>
        </div>
        {record.published && (
          <Button as={Link} to={`/profissionais/${record.id}`}>
            Ver página pública
          </Button>
        )}
      </header>
      {showTermsBanner && (
        <Flash variant="default" className="showcase-terms-banner">
          <span>Os Termos da Vitrine foram atualizados.</span>
          <div className="showcase-terms-banner-actions">
            <Button as={Link} to="/termos-publicacao-vitrine" target="_blank" rel="noopener">
              Ler o que mudou
            </Button>
            <Button
              variant="primary"
              onClick={acknowledgeTerms}
              loading={busy === 'acknowledge-terms'}
            >
              OK, entendi
            </Button>
          </div>
        </Flash>
      )}
      {message && <Flash variant={message.variant}>{message.text}</Flash>}
      {state === 'published' &&
        form.kind === 'professional' &&
        profile?.avatarPath &&
        !record.published?.avatarPath && (
          <Flash variant="warning">
            {form.useProfileAvatar
              ? 'Sua foto global ainda não aparece nesta página pública. Publique esta versão para atualizá-la.'
              : 'Sua foto global ainda não está autorizada nesta página pública. Marque a autorização abaixo, salve e publique novamente.'}
          </Flash>
        )}
      {pending && (
        <Flash variant="warning">
          Uma publicação anterior desta vitrine ainda não terminou. Tente novamente em instantes.
        </Flash>
      )}
      {record.draft?.rejectionSummary && (
        <Flash variant="warning">
          <strong>Ajustes solicitados:</strong> {record.draft.rejectionSummary}
        </Flash>
      )}
      {state === 'suspended' && (
        <Flash variant="danger">
          Esta vitrine foi suspensa pela moderação. Entre em contato com o suporte.
        </Flash>
      )}
      <div className="listing-editor-grid">
        <form className="listing-editor" onSubmit={save}>
          <fieldset disabled={pending || Boolean(busy)}>
            <legend>Informações públicas</legend>
            <label>
              Nome profissional ou comercial
              <input
                required
                maxLength={80}
                value={form.displayName}
                onChange={(e) => edit('displayName', e.target.value)}
              />
            </label>
            <label>
              Categoria
              <select
                required
                value={form.categoryKey}
                onChange={(e) => edit('categoryKey', e.target.value)}
              >
                <option value="">Selecione</option>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Apresentação
              <textarea
                required
                maxLength={1500}
                rows={7}
                value={form.bio}
                onChange={(e) => edit('bio', e.target.value)}
              />
              <small>{form.bio.length}/1500</small>
            </label>
            <div className="listing-inline-fields">
              <label>
                Cidade
                <input
                  required
                  maxLength={80}
                  value={form.city}
                  onChange={(e) => edit('city', e.target.value)}
                />
              </label>
              <label>
                UF
                <select required value={form.uf} onChange={(e) => edit('uf', e.target.value)}>
                  <option value="">Selecione</option>
                  {BRAZIL_STATES.map((uf) => (
                    <option key={uf}>{uf}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Atendimento
              <select
                value={form.serviceMode}
                onChange={(e) => edit('serviceMode', e.target.value)}
              >
                {SERVICE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="listing-field-label">Modalidades (até 5)</span>
              <div className="listing-check-grid">
                {MODALITY_OPTIONS.map((option) => (
                  <label key={option.value}>
                    <input
                      type="checkbox"
                      checked={form.modalityKeys.includes(option.value)}
                      onChange={() => toggleModality(option.value)}
                    />{' '}
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
            <label>
              Especialidades, separadas por vírgula
              <input
                maxLength={610}
                value={form.specialtiesText}
                onChange={(e) => edit('specialtiesText', e.target.value)}
              />
            </label>
          </fieldset>
          <fieldset disabled={pending || Boolean(busy)}>
            <legend>Contatos externos</legend>
            <label>
              WhatsApp
              <input
                type="url"
                maxLength={300}
                placeholder="https://wa.me/5511999999999"
                value={form.contacts.whatsapp}
                onChange={(e) => editContact('whatsapp', e.target.value)}
              />
            </label>
            <label>
              Instagram
              <input
                type="url"
                maxLength={300}
                placeholder="https://instagram.com/seuusuario"
                value={form.contacts.instagram}
                onChange={(e) => editContact('instagram', e.target.value)}
              />
            </label>
            <label>
              Site
              <input
                type="url"
                maxLength={300}
                placeholder="https://seusite.com.br"
                value={form.contacts.website}
                onChange={(e) => editContact('website', e.target.value)}
              />
            </label>
          </fieldset>
          <fieldset disabled={pending || Boolean(busy)}>
            <legend>Vínculos</legend>
            {form.kind === 'professional' && (
              <label className="listing-checkbox">
                <input
                  type="checkbox"
                  checked={form.useProfileAvatar}
                  disabled={!profile?.avatarPath}
                  onChange={(e) => edit('useProfileAvatar', e.target.checked)}
                />
                <span>
                  Autorizar o uso da minha foto global nesta vitrine ao publicar
                  <small>
                    {profile?.avatarPath
                      ? 'Uma nova foto pessoal só aparecerá aqui depois que você publicar de novo.'
                      : 'Adicione uma foto em Meu perfil primeiro.'}
                  </small>
                </span>
              </label>
            )}
            <label>
              Comunidade vinculada
              <select
                value={form.linkedCommunityId}
                onChange={(e) => edit('linkedCommunityId', e.target.value)}
              >
                <option value="">Nenhuma</option>
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>
                    {community.name}
                  </option>
                ))}
              </select>
              <small>Somente comunidades ativas das quais você é titular.</small>
            </label>
          </fieldset>
          <div className="listing-editor-actions">
            <Button type="submit" loading={busy === 'save'} disabled={pending || Boolean(busy)}>
              Salvar rascunho
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={publish}
              loading={busy === 'publish'}
              disabled={pending || Boolean(busy) || !record.draft?.version}
            >
              Publicar
            </Button>
          </div>
        </form>
        <aside className="listing-preview">
          <h2>Prévia do card</h2>
          {preview && <ProfessionalListingCard listing={preview} />}
        </aside>
      </div>
      <section className="listing-danger-zone">
        <h2>Controle da publicação</h2>
        {record.published && (
          <Button onClick={unpublish} disabled={Boolean(busy)}>
            Despublicar
          </Button>
        )}
        <Button variant="danger" onClick={remove} disabled={pending || Boolean(busy)}>
          Excluir vitrine
        </Button>
      </section>
    </div>
  )
}

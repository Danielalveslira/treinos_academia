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
  createProfessionalListing,
  deleteProfessionalListing,
  getMyProfessionalListing,
  getShowcaseLegalAcceptance,
  saveProfessionalListing,
  submitProfessionalListing,
  unpublishProfessionalListing,
} from '../services/professionalListingsService'
import { EMPTY_LISTING_DRAFT } from '../utils/professionalListing'
import {
  canSubmitShowcaseListing,
  hasCurrentShowcaseAcceptance,
  SHOWCASE_LEGAL_MANIFEST,
} from '../utils/showcaseLegal'

const STATE_LABELS = {
  draft: 'Rascunho',
  pending_review: 'Em revisão',
  published: 'Publicada',
  suspended: 'Suspensa',
  archived: 'Despublicada',
  deleting: 'Exclusão pendente',
}

function editableDraft(data, kind) {
  return {
    ...EMPTY_LISTING_DRAFT,
    ...data,
    kind,
    contacts: { ...EMPTY_LISTING_DRAFT.contacts, ...data?.contacts },
    linkedCommunityId: data?.linkedCommunityId || '',
    specialtiesText: data?.specialties?.join(', ') || '',
  }
}

export default function MyProfessionalListing() {
  const { user, profile } = useAuth()
  const [record, setRecord] = useState(undefined)
  const [form, setForm] = useState(null)
  const [communities, setCommunities] = useState([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null)
  const [legalAcceptance, setLegalAcceptance] = useState(null)
  const [termsConfirmed, setTermsConfirmed] = useState(false)
  const submissionOperation = useRef(null)

  async function reload() {
    const [current, acceptance] = await Promise.all([
      getMyProfessionalListing(user.uid),
      getShowcaseLegalAcceptance(user.uid, SHOWCASE_LEGAL_MANIFEST.version),
    ])
    setRecord(current)
    setLegalAcceptance(acceptance)
    if (current) setForm(editableDraft(current.draft, current.listing.kind))
  }

  useEffect(() => {
    let active = true
    Promise.all([
      getMyProfessionalListing(user.uid),
      listActiveCommunities(),
      getShowcaseLegalAcceptance(user.uid, SHOWCASE_LEGAL_MANIFEST.version),
    ])
      .then(([current, allCommunities, acceptance]) => {
        if (!active) return
        setRecord(current)
        if (current) setForm(editableDraft(current.draft, current.listing.kind))
        setCommunities(allCommunities.filter((community) => community.ownerId === user.uid))
        setLegalAcceptance(acceptance)
      })
      .catch(
        () =>
          active &&
          setMessage({ variant: 'danger', text: 'Não foi possível carregar sua vitrine.' })
      )
    return () => {
      active = false
    }
  }, [user.uid])

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
      setMessage({ variant: 'danger', text: error?.message || 'Não foi possível criar a vitrine.' })
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
      setMessage({ variant: 'danger', text: error?.message || 'Não foi possível salvar.' })
    } finally {
      setBusy('')
    }
  }

  async function submit() {
    setBusy('submit')
    setMessage(null)
    try {
      submissionOperation.current ||= crypto.randomUUID().replaceAll('-', '')
      await submitProfessionalListing(record.id, {
        termsAccepted: termsConfirmed,
        termsVersion: SHOWCASE_LEGAL_MANIFEST.version,
        operationId: submissionOperation.current,
      })
      await reload()
      submissionOperation.current = null
      setTermsConfirmed(false)
      setMessage({ variant: 'success', text: 'Vitrine enviada para revisão.' })
    } catch (error) {
      setMessage({ variant: 'danger', text: error?.message || 'Não foi possível enviar.' })
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
        <Spinner aria-label="Carregando sua vitrine" />
      </div>
    )
  if (!record)
    return (
      <div className="my-listing-page">
        <header className="profile-page-heading">
          <span className="profile-eyebrow">SUA PRESENÇA PROFISSIONAL</span>
          <h1>Minha vitrine</h1>
          <p>Crie uma página pública para apresentar seu trabalho ou espaço.</p>
        </header>
        {message && <Flash variant={message.variant}>{message.text}</Flash>}
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
      </div>
    )

  const pending = record.draft?.reviewState === 'pending_review'
  const state = record.listing.lifecycleState
  const hasLegalAcceptance = hasCurrentShowcaseAcceptance(legalAcceptance)
  const legalSubmissionAllowed = canSubmitShowcaseListing({
    acceptance: legalAcceptance,
    confirmed: termsConfirmed,
    manifest: SHOWCASE_LEGAL_MANIFEST,
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
      {message && <Flash variant={message.variant}>{message.text}</Flash>}
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
                  Autorizar o uso da minha foto global aprovada nesta vitrine
                  <small>
                    {profile?.avatarPath
                      ? 'Uma nova foto pessoal só aparecerá aqui após nova revisão.'
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
          <fieldset className="listing-legal-consent" disabled={pending || Boolean(busy)}>
            <legend>Termos de publicação</legend>
            {SHOWCASE_LEGAL_MANIFEST.published ? (
              hasLegalAcceptance ? (
                <p>
                  Aceite da versão {SHOWCASE_LEGAL_MANIFEST.version} já registrado para esta conta.
                </p>
              ) : (
                <label className="listing-checkbox">
                  <input
                    type="checkbox"
                    checked={termsConfirmed}
                    onChange={(event) => setTermsConfirmed(event.target.checked)}
                  />
                  <span>
                    Li e aceito os{' '}
                    <Link to="/termos-publicacao-vitrine" target="_blank" rel="noopener">
                      Termos de Publicação da Vitrine Profissional — Evolutus
                    </Link>{' '}
                    (versão {SHOWCASE_LEGAL_MANIFEST.version}).
                  </span>
                </label>
              )
            ) : (
              <Flash variant="warning">
                A versão {SHOWCASE_LEGAL_MANIFEST.version} ainda é uma minuta pendente de aprovação.
                A submissão permanece bloqueada.
              </Flash>
            )}
          </fieldset>
          <div className="listing-editor-actions">
            <Button type="submit" loading={busy === 'save'} disabled={pending || Boolean(busy)}>
              Salvar rascunho
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={submit}
              loading={busy === 'submit'}
              disabled={
                pending || Boolean(busy) || !record.draft?.version || !legalSubmissionAllowed
              }
            >
              Enviar para revisão
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

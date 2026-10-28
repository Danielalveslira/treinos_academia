import { useEffect, useRef, useState } from 'react'
import { Box, Button, Flash, Heading, Label, Spinner, Text, Dialog } from '@primer/react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { listActiveCommunities } from '../services/communitiesService'
import {
  getMyProfessionalListing,
  saveProfessionalListing,
  setProfessionalListingEditorial,
  listListingCommercialOrders,
} from '../services/professionalListingsService'
import { uploadStorefrontImage } from '../services/storefrontService'
import { commercialDate } from '../utils/commercial'
import { editorialLabels, publicationLabels, storefrontError } from '../utils/storefront'
import { EMPTY_LISTING_DRAFT } from '../utils/professionalListing'
import ProfessionalListingForm from '../components/ProfessionalListingForm'
import CommercialLeasePurchase from '../components/CommercialLeasePurchase'
import CommercialOrderHistory from '../components/CommercialOrderHistory'
import ListingLegalNotice from '../components/ListingLegalNotice'
import StorefrontImage from '../components/StorefrontImage'
function editable(draft, kind) {
  return {
    ...EMPTY_LISTING_DRAFT,
    ...draft,
    kind,
    serviceMode: draft?.serviceMode || EMPTY_LISTING_DRAFT.serviceMode,
    contacts: { ...EMPTY_LISTING_DRAFT.contacts, ...draft?.contacts },
    specialtiesText: (draft?.specialties || []).join(', '),
  }
}
function message(e) {
  return (
    {
      DRAFT_INCOMPLETE:
        'Complete nome, apresentação, localização, categoria e modalidades antes de enviar.',
      NOT_ELIGIBLE: 'Defina seu perfil de uso antes de criar um cadastro.',
      INVALID_CONTACTS: 'Informe contatos HTTPS válidos.',
      EDITORIAL_REVIEW_REQUIRED: 'Esta versão precisa de revisão administrativa.',
      LISTING_NOT_FOUND: 'Cadastro indisponível ou sem permissão.',
    }[e?.message] || storefrontError(e)
  )
}
export default function MyProfessionalListing({ listingId }) {
  const { user } = useAuth()
  const [record, setRecord] = useState(undefined),
    [form, setForm] = useState(null),
    [communities, setCommunities] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [preview, setPreview] = useState(false),
    [generation, setGeneration] = useState(0)
  const lock = useRef(false)
  async function reload() {
    const row = await getMyProfessionalListing(listingId)
    setRecord(row)
    setForm(row ? editable(row.draft, row.listing.kind) : null)
    return row
  }
  useEffect(() => {
    let active = true
    setError('')
    getMyProfessionalListing(listingId)
      .then((row) => {
        if (active) {
          setRecord(row)
          setForm(row ? editable(row.draft, row.listing.kind) : null)
        }
      })
      .catch((e) => active && setError(message(e)))
    return () => {
      active = false
    }
  }, [user.uid, listingId, generation])
  useEffect(() => {
    let active = true
    listActiveCommunities(user.uid)
      .then((rows) => active && setCommunities(rows))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user.uid])
  useEffect(() => {
    if (record?.commercial?.state !== 'active') return
    const remaining =
      Date.parse(record.commercial.expiresAt) - Date.parse(record.commercial.serverTime)
    if (!Number.isFinite(remaining) || remaining <= 0) return
    const timer = setTimeout(() => setGeneration((v) => v + 1), Math.min(remaining, 2147483647))
    return () => clearTimeout(timer)
  }, [record])
  useEffect(() => {
    if (record?.id && globalThis.location?.hash === '#publicacao')
      document.getElementById('publicacao')?.scrollIntoView({ block: 'start' })
  }, [record?.id])
  async function run(action) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(message(e))
      try {
        await reload()
      } catch {
        /* Keep a visible error and require an explicit retry. */
      }
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  function payload() {
    const { specialtiesText, ...draft } = form
    return {
      ...draft,
      specialties: (specialtiesText || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  }
  const save = (e) => {
    e.preventDefault()
    run(async () => {
      await saveProfessionalListing(record.id, payload(), record.draft.version)
      await reload()
      setNotice('Rascunho salvo. A versão pública aprovada foi preservada.')
    })
  }
  const submit = () =>
    run(async () => {
      const saved = await saveProfessionalListing(record.id, payload(), record.draft.version)
      await setProfessionalListingEditorial(record.id, saved.version, 'submitted')
      await reload()
      setNotice('Versão enviada para aprovação. Nenhum EvoCash foi debitado.')
    })
  const archive = () =>
    run(async () => {
      await setProfessionalListingEditorial(record.id, record.draft.version, 'archived')
      await reload()
      setNotice('Cadastro arquivado. Dados e contratos foram preservados.')
    })
  const upload = (file) =>
    run(async () => {
      const id = await uploadStorefrontImage(record.id, file)
      setForm((prev) => ({ ...prev, mediaId: id }))
      setNotice('Imagem enviada privadamente. Salve o rascunho para associá-la.')
    })
  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', minWidth: 0, display: 'grid', gap: 3, pb: 4 }}>
      <Button as={Link} to="/minha-vitrine">
        ← Meus cadastros
      </Button>
      <Heading as="h1" sx={{ fontSize: 3 }}>
        Meu perfil ou estabelecimento
      </Heading>
      <Text as="p">
        Prepare gratuitamente. A publicação exige aprovação e contratação vigente em EvoCash.
      </Text>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash>Ambiente isolado · dados e tarifas sintéticos · Fase 5 em desenvolvimento.</Flash>
      )}
      <ListingLegalNotice userId={user.uid} />
      {error && <Flash variant="danger">{error}</Flash>}
      {notice && <Flash variant="success">{notice}</Flash>}
      <Button disabled={busy} onClick={() => setGeneration((v) => v + 1)}>
        Atualizar cadastro
      </Button>
      {record === undefined && !error && <Spinner aria-label="Carregando cadastro" />}
      {record && form && (
        <>
          <Heading as="h2" sx={{ fontSize: 2, overflowWrap: 'anywhere' }}>
            {record.draft.displayName || 'Cadastro em preparação'}
          </Heading>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Label>{editorialLabels[record.draft.reviewState] || record.draft.reviewState}</Label>
            <Label>{publicationLabels[record.commercial.state] || record.commercial.state}</Label>
            <Text>
              Revisão {record.draft.version} · versão aprovada{' '}
              {record.commercial.publishedRevision || 'nenhuma'}
            </Text>
          </Box>
          {record.commercial.expiresAt && (
            <Text as="p">
              Vencimento: {commercialDate(record.commercial.expiresAt)} ·{' '}
              {Math.ceil(Number(record.commercial.remainingSeconds) / 86400)} dia(s) restantes na
              consulta.
            </Text>
          )}
          <Text as="p">
            A última versão aprovada permanece pública durante a revisão, enquanto o direito estiver
            vigente. Suspensão e vencimento bloqueiam a publicação.
          </Text>
          {record.listing.lifecycleState === 'suspended' && (
            <Flash variant="danger">
              Publicação suspensa. {record.listing.suspendedReason} O pagamento não remove a
              suspensão.
            </Flash>
          )}
          {record.draft.rejectionSummary && (
            <Flash variant="warning">Ajustes solicitados: {record.draft.rejectionSummary}</Flash>
          )}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button onClick={() => setPreview(true)}>Prévia privada</Button>
            <Button
              as="a"
              href={`${record.listing.kind === 'space' ? '/locais' : '/profissionais'}/${record.id}`}
            >
              Ver página pública
            </Button>
            <Button as={Link} to="/vitrine/gerenciar">
              Minhas vitrines de produtos
            </Button>
          </Box>
          <ProfessionalListingForm
            form={form}
            onChange={setForm}
            onSubmit={save}
            onUpload={upload}
            busy={busy}
            communities={communities}
          />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              disabled={busy || record.listing.lifecycleState === 'suspended'}
              onClick={submit}
            >
              Enviar para aprovação
            </Button>
            <Button
              disabled={busy || record.listing.lifecycleState === 'suspended'}
              onClick={archive}
            >
              Arquivar cadastro
            </Button>
          </Box>
          <Box id="publicacao">
            {!record.commercial.canContract && (
              <Flash>
                Para contratar, este cadastro precisa ter versão aprovada e estar liberado para
                publicação.
              </Flash>
            )}
            {record.commercial.canContract && (
              <CommercialLeasePurchase
                key={`${record.id}:${record.commercial.publishedRevision}`}
                resourceId={record.id}
                resourceName={record.published?.displayName || record.draft.displayName}
                tariff={record.commercial.tariff}
                expiresAt={record.commercial.expiresAt}
                onComplete={reload}
                subjectLabel={record.listing.kind === 'space' ? 'estabelecimento' : 'perfil'}
              />
            )}
            <CommercialOrderHistory
              resourceId={record.id}
              load={listListingCommercialOrders}
              revision={record.commercial.expiresAt}
            />
          </Box>
          {preview && (
            <Dialog title="Prévia privada" onClose={() => setPreview(false)}>
              <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
                <Heading as="h2" sx={{ fontSize: 2 }}>
                  {form.displayName || 'Cadastro em preparação'}
                </Heading>
                <StorefrontImage id={form.mediaId} alt="Imagem privada" size={160} />
                <Text as="p">{form.bio}</Text>
                <Text as="p">
                  {form.city} · {form.uf}
                </Text>
                {form.kind === 'space' && (
                  <>
                    <Text as="p">{form.address}</Text>
                    <Text as="p">{form.openingHours}</Text>
                  </>
                )}
                <Text as="p">Esta prévia não concede publicação.</Text>
              </Box>
            </Dialog>
          )}
        </>
      )}
    </Box>
  )
}

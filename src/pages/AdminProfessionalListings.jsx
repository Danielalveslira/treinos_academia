import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Box,
  Heading,
  Text,
  Button,
  Spinner,
  Label,
  Dialog,
  FormControl,
  TextInput,
  Textarea,
  Select,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ListUnorderedIcon } from '@primer/octicons-react'
import { useAdminProfessionalListings } from '../hooks/useAdminProfessionalListings'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { adminGetProfessionalListing } from '../services/professionalListingsService'
import { LISTING_KIND_OPTIONS, optionLabel } from '../constants/professionalListingTaxonomy'
import { toDate } from '../utils/date'
import { formatDateTime } from '../utils/format'

const STATE_OPTIONS = [
  { value: '', label: 'Todos os estados' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'published', label: 'Publicada' },
  { value: 'archived', label: 'Despublicada' },
  { value: 'suspended', label: 'Suspensa' },
]

const STATE_LABELS = {
  draft: { text: 'Rascunho', variant: 'secondary' },
  published: { text: 'Publicada', variant: 'success' },
  archived: { text: 'Despublicada', variant: 'secondary' },
  suspended: { text: 'Suspensa', variant: 'danger' },
  deleting: { text: 'Em exclusão', variant: 'danger' },
}

function actionError(error, fallback) {
  return ['functions/failed-precondition', 'functions/invalid-argument', 'functions/not-found'].includes(
    error?.code
  )
    ? error.message
    : fallback
}

function SuspendDialog({ listing, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      title={`Suspender a vitrine de ${listing.displayName || listing.ownerUsername || listing.id}`}
      onClose={saving ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: saving },
        {
          content: 'Suspender vitrine',
          buttonType: 'danger',
          disabled: reason.trim().length < 5 || saving,
          onClick: async () => {
            setSaving(true)
            setError((await onConfirm(reason)) || '')
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3 }}>
        {error && (
          <Text as="p" role="alert" sx={{ color: 'danger.fg' }}>
            {error}
          </Text>
        )}
        <FormControl required>
          <FormControl.Label>Motivo da suspensão</FormControl.Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            block
            placeholder="Descreva o motivo da suspensão"
          />
        </FormControl>
      </Box>
    </Dialog>
  )
}

function DetailDialog({ listingId, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  useEffect(() => {
    let active = true
    adminGetProfessionalListing(listingId)
      .then((data) => {
        if (active) setState({ loading: false, data, error: '' })
      })
      .catch((err) => {
        if (active)
          setState({ loading: false, data: null, error: actionError(err, 'Erro ao carregar detalhes.') })
      })
    return () => {
      active = false
    }
  }, [listingId])
  const listing = state.data?.listing
  const draft = state.data?.draft
  const published = state.data?.published
  return (
    <Dialog
      title="Detalhes da vitrine"
      onClose={onClose}
      footerButtons={[{ content: 'Fechar', onClick: onClose }]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {state.loading && <Spinner aria-label="Carregando detalhes" />}
        {state.error && (
          <Text as="p" role="alert" sx={{ color: 'danger.fg' }}>
            {state.error}
          </Text>
        )}
        {listing && (
          <>
            <Text as="p" sx={{ m: 0 }}>
              <strong>Titular:</strong> {state.data.ownerUsername || state.data.ownerEmail || listing.ownerId}
            </Text>
            <Text as="p" sx={{ m: 0 }}>
              <strong>Tipo:</strong> {optionLabel(LISTING_KIND_OPTIONS, listing.kind)}
            </Text>
            <Text as="p" sx={{ m: 0 }}>
              <strong>Estado:</strong> {STATE_LABELS[listing.lifecycleState]?.text || listing.lifecycleState}
            </Text>
            {listing.suspendedReason && (
              <Text as="p" sx={{ m: 0 }}>
                <strong>Motivo da suspensão:</strong> {listing.suspendedReason}
              </Text>
            )}
            {draft && (
              <Text as="p" sx={{ m: 0 }}>
                <strong>Nome (rascunho atual):</strong> {draft.displayName} · versão {draft.version}
              </Text>
            )}
            {published && (
              <Text as="p" sx={{ m: 0 }}>
                <strong>Publicada:</strong> {published.displayName} · versão {published.publishedVersion} em{' '}
                {formatDateTime(toDate(published.publishedAt))}
              </Text>
            )}
            <Link to={`/atendimento?tipo=report&vitrine=${listing.id}`}>
              Ver denúncias desta vitrine na central de moderação
            </Link>
          </>
        )}
      </Box>
    </Dialog>
  )
}

export default function AdminProfessionalListings() {
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('busca') || '')
  const [lifecycleState, setLifecycleState] = useState('')
  const { listings, loading, error, busy, hasMore, loadMore, refresh, suspend, reactivate, unpublish } =
    useAdminProfessionalListings(search, lifecycleState)
  const { toasts, showToast } = useToast()
  const [dialog, setDialog] = useState(null) // { type: 'suspend'|'detail', listing }

  async function handleSuspend(reason) {
    try {
      await suspend(dialog.listing.id, reason)
      setDialog(null)
      showToast('Vitrine suspensa.')
    } catch (err) {
      console.error('[AdminProfessionalListings] suspend:', err)
      return actionError(err, 'Erro ao suspender vitrine.')
    }
  }

  async function handleReactivate(listing) {
    try {
      await reactivate(listing.id)
      showToast('Vitrine reativada (voltou para rascunho). O titular pode editar e publicar de novo.')
    } catch (err) {
      console.error('[AdminProfessionalListings] reactivate:', err)
      showToast(actionError(err, 'Erro ao reativar vitrine.'), 'danger')
    }
  }

  async function handleUnpublish(listing) {
    try {
      await unpublish(listing.id)
      showToast('Vitrine despublicada.')
    } catch (err) {
      console.error('[AdminProfessionalListings] unpublish:', err)
      showToast(actionError(err, 'Erro ao despublicar vitrine.'), 'danger')
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/contas" replace>
          Contas
        </Button>
        <Button as={Link} to="/admin/moderacao" replace>
          Atendimento e moderação
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Vitrines
      </Heading>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <FormControl sx={{ flex: 1, minWidth: '200px' }}>
          <FormControl.Label visuallyHidden>Buscar vitrine</FormControl.Label>
          <TextInput
            placeholder="Nome, @usuário ou e-mail do titular"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label visuallyHidden>Estado</FormControl.Label>
          <Select value={lifecycleState} onChange={(e) => setLifecycleState(e.target.value)}>
            {STATE_OPTIONS.map((option) => (
              <Select.Option key={option.value} value={option.value}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Button onClick={refresh} disabled={loading || !!busy} sx={{ mb: 3 }}>
        Atualizar lista
      </Button>

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && listings.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <ListUnorderedIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhuma vitrine encontrada</Blankslate.Heading>
        </Blankslate>
      )}

      {listings.length > 0 && (
        <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflow: 'hidden' }}>
          {listings.map((listing, index) => (
            <Box
              key={listing.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
                px: 3,
                py: 2,
                borderTop: index === 0 ? 'none' : '1px solid',
                borderColor: 'border.default',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Text sx={{ fontWeight: 'bold' }}>{listing.displayName || listing.id}</Text>
                  <Label variant={STATE_LABELS[listing.lifecycleState]?.variant}>
                    {STATE_LABELS[listing.lifecycleState]?.text || listing.lifecycleState}
                  </Label>
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  {optionLabel(LISTING_KIND_OPTIONS, listing.kind)} · titular:{' '}
                  {listing.ownerUsername ? `@${listing.ownerUsername}` : listing.ownerEmail} · atualizado em{' '}
                  {formatDateTime(toDate(listing.updatedAt))}
                </Text>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', flexShrink: 0 }}>
                <Button size="small" disabled={!!busy} onClick={() => setDialog({ type: 'detail', listing })}>
                  Ver detalhes
                </Button>
                {listing.lifecycleState === 'suspended' && (
                  <Button size="small" disabled={!!busy} onClick={() => handleReactivate(listing)}>
                    Reativar
                  </Button>
                )}
                {listing.lifecycleState === 'published' && (
                  <Button size="small" disabled={!!busy} onClick={() => handleUnpublish(listing)}>
                    Despublicar
                  </Button>
                )}
                {listing.lifecycleState !== 'suspended' && (
                  <Button
                    size="small"
                    variant="danger"
                    disabled={!!busy}
                    onClick={() => setDialog({ type: 'suspend', listing })}
                  >
                    Suspender
                  </Button>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {hasMore && (
        <Button onClick={loadMore} disabled={loading} sx={{ mt: 3 }}>
          Carregar mais vitrines
        </Button>
      )}

      {dialog?.type === 'suspend' && (
        <SuspendDialog listing={dialog.listing} onClose={() => setDialog(null)} onConfirm={handleSuspend} />
      )}
      {dialog?.type === 'detail' && (
        <DetailDialog listingId={dialog.listing.id} onClose={() => setDialog(null)} />
      )}
    </Box>
  )
}

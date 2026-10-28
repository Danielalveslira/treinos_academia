import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Select,
  Spinner,
  Text,
  TextInput,
  ThemeProvider,
} from '@primer/react'
import {
  MODALITY_OPTIONS,
  BRAZIL_STATES,
  SERVICE_MODE_OPTIONS,
  CATEGORY_OPTIONS,
  optionLabel,
} from '../../constants/professionalListingTaxonomy'
import { publicProductMediaUrl } from '../publicProducts/publicProductCatalogService'
import { safeExternalContact } from '../../utils/professionalListing'
import { directoryPath, fetchListingPage, fetchListingDetail } from './listingDirectoryService'
const initialFilters = () => {
  const p = new URLSearchParams(location.search)
  return {
    modality: p.get('modalidade') || '',
    uf: p.get('uf') || '',
    city: (p.get('cidade') || '').slice(0, 80),
    serviceMode: p.get('atendimento') || '',
  }
}
function Directory({ kind }) {
  const [filters, setFilters] = useState(initialFilters),
    [query, setQuery] = useState(initialFilters),
    [offset, setOffset] = useState(() =>
      Math.max(0, Math.min(10000, Number(new URLSearchParams(location.search).get('pagina')) || 0))
    ),
    [page, setPage] = useState(null),
    [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0)
  const detailAbort = useRef(null),
    generation = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    generation.current++
    detailAbort.current?.abort()
    setDialog(null)
    setPage(null)
    setBusy(true)
    setError('')
    fetchListingPage(kind, query, offset, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setPage(data)
      })
      .catch((e) => {
        if (e.name !== 'AbortError')
          setError('Não foi possível carregar o diretório. Tente novamente.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [kind, query, offset, reload])
  useEffect(() => {
    if (!page?.items?.length) return
    const remaining = page.remainingMs - (performance.now() - page.receivedAt)
    const hide = () => {
      generation.current++
      detailAbort.current?.abort()
      setPage(null)
      setDialog(null)
    }
    if (remaining <= 0) {
      hide()
      return
    }
    const timer = setTimeout(hide, Math.min(remaining, 2147483647))
    return () => clearTimeout(timer)
  }, [page])
  useEffect(() => {
    if (!dialog) return
    const remaining = dialog.remainingMs - (performance.now() - dialog.receivedAt)
    if (remaining <= 0) {
      setDialog(null)
      return
    }
    const timer = setTimeout(() => setDialog(null), Math.min(remaining, 2147483647))
    return () => clearTimeout(timer)
  }, [dialog])
  useEffect(() => {
    const hide = () => {
      generation.current++
      detailAbort.current?.abort()
      setPage(null)
      setDialog(null)
    }
    const visible = () => {
      if (document.hidden) hide()
      else setReload((n) => n + 1)
    }
    const restore = (event) => {
      if (event.persisted) setReload((n) => n + 1)
    }
    const pop = () => {
      const f = initialFilters()
      setFilters(f)
      setQuery(f)
      setOffset(Number(new URLSearchParams(location.search).get('pagina')) || 0)
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', restore)
    window.addEventListener('popstate', pop)
    return () => {
      detailAbort.current?.abort()
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', restore)
      window.removeEventListener('popstate', pop)
    }
  }, [])
  function navigate(nextFilters, nextOffset) {
    const p = new URLSearchParams()
    for (const [key, value] of Object.entries(nextFilters)) {
      const label = {
        modality: 'modalidade',
        uf: 'uf',
        city: 'cidade',
        serviceMode: 'atendimento',
      }[key]
      if (value) p.set(label, value)
    }
    if (nextOffset) p.set('pagina', String(nextOffset))
    history.pushState(null, '', directoryPath(kind) + (p.size ? '?' + p : ''))
    setQuery({ ...nextFilters })
    setOffset(nextOffset)
  }
  async function detail(id) {
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    const current = ++generation.current
    setDialog(null)
    try {
      const row = await fetchListingDetail(id, controller.signal)
      if (current === generation.current && row?.remainingMs > 0 && !document.hidden) setDialog(row)
      else if (current === generation.current) setReload((n) => n + 1)
    } catch (e) {
      if (e.name !== 'AbortError') {
        setPage(null)
        setDialog(null)
        setError('Cadastro indisponível. Atualize o diretório.')
      }
    }
  }
  function field(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        as="form"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(filters, 0)
        }}
        sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'end', mb: 3 }}
      >
        <FormControl>
          <FormControl.Label>Modalidade</FormControl.Label>
          <Select value={filters.modality} onChange={(e) => field('modality', e.target.value)}>
            <Select.Option value="">Todas</Select.Option>
            {MODALITY_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {o.label}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Estado</FormControl.Label>
          <Select value={filters.uf} onChange={(e) => field('uf', e.target.value)}>
            <Select.Option value="">Todos</Select.Option>
            {BRAZIL_STATES.map((s) => (
              <Select.Option key={s}>{s}</Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 0, flex: '1 1 180px' }}>
          <FormControl.Label>Cidade</FormControl.Label>
          <TextInput
            block
            maxLength={80}
            value={filters.city}
            onChange={(e) => field('city', e.target.value)}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Atendimento</FormControl.Label>
          <Select
            value={filters.serviceMode}
            onChange={(e) => field('serviceMode', e.target.value)}
          >
            <Select.Option value="">Todos</Select.Option>
            {SERVICE_MODE_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {o.label}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <Button type="submit" disabled={busy}>
          Buscar
        </Button>
      </Box>
      <Button disabled={busy} onClick={() => setReload((n) => n + 1)}>
        Atualizar diretório
      </Button>
      {busy && <Spinner aria-label="Carregando diretório" />}
      {error && (
        <Flash variant="danger" sx={{ my: 3 }}>
          {error}
        </Flash>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['1fr', 'repeat(2,minmax(0,1fr))', 'repeat(3,minmax(0,1fr))'],
          gap: 3,
          my: 3,
        }}
      >
        {page?.items?.map((item) => (
          <Box
            as="article"
            key={item.id}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              p: 3,
              borderRadius: 2,
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {item.mediaId && (
              <Box
                as="img"
                src={publicProductMediaUrl({ media_id: item.mediaId })}
                alt=""
                width={72}
                height={72}
                loading="lazy"
                sx={{ objectFit: 'contain', borderRadius: 2 }}
              />
            )}
            <Heading as="h2" sx={{ fontSize: 2 }}>
              <a href={`${directoryPath(item.kind)}/${item.id}`}>{item.displayName}</a>
            </Heading>
            <Text as="p">{optionLabel(CATEGORY_OPTIONS, item.categoryKey)}</Text>
            <Text as="p">
              {item.city}, {item.uf} · {optionLabel(SERVICE_MODE_OPTIONS, item.serviceMode)}
            </Text>
            <Button aria-label={`Detalhes de ${item.displayName}`} onClick={() => detail(item.id)}>
              Ver detalhes
            </Button>
          </Box>
        ))}
      </Box>
      {!busy && !page?.items?.length && !error && (
        <Text as="p">Nenhum cadastro disponível com esses filtros.</Text>
      )}
      <Box sx={{ display: 'flex', gap: 2 }}>
        {offset > 0 && (
          <Button disabled={busy} onClick={() => navigate(query, Math.max(0, offset - 12))}>
            Página anterior
          </Button>
        )}
        {page?.nextOffset !== null && page?.nextOffset !== undefined && (
          <Button disabled={busy} onClick={() => navigate(query, page.nextOffset)}>
            Próxima página
          </Button>
        )}
      </Box>
      {dialog && (
        <Dialog title={dialog.displayName} onClose={() => setDialog(null)} width="large">
          <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
            {dialog.mediaId && (
              <Box
                as="img"
                src={publicProductMediaUrl({ media_id: dialog.mediaId })}
                alt={dialog.displayName}
                width={160}
                height={160}
                sx={{ objectFit: 'contain' }}
              />
            )}
            <Text as="p">{dialog.bio}</Text>
            <Text as="p">{(dialog.specialties || []).join(', ')}</Text>
            <Text as="p">
              {dialog.city}, {dialog.uf}
            </Text>
            {dialog.address && <Text as="p">{dialog.address}</Text>}
            {dialog.openingHours && <Text as="p">{dialog.openingHours}</Text>}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {dialog.publicContacts
                ?.map(safeExternalContact)
                .filter(Boolean)
                .map((contact) => (
                  <Button
                    key={contact.type}
                    as="a"
                    href={contact.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {contact.type === 'website'
                      ? 'Site'
                      : contact.type === 'whatsapp'
                        ? 'WhatsApp'
                        : 'Instagram'}
                  </Button>
                ))}
            </Box>
            {dialog.linkedCommunity && (
              <Button as="a" href={`/comunidades/${dialog.linkedCommunity.id}`} sx={{ mt: 2 }}>
                Ver comunidade {dialog.linkedCommunity.name}
              </Button>
            )}
            <Button as="a" href={`${directoryPath(dialog.kind)}/${dialog.id}`} sx={{ mt: 3 }}>
              Abrir página pública
            </Button>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
export function PublicListingsIsland({ kind }) {
  const [mode, setMode] = useState(() => document.documentElement.dataset.colorMode || 'light')
  useEffect(() => {
    const update = () => setMode(document.documentElement.dataset.colorMode || 'light')
    window.addEventListener('public-theme-change', update)
    return () => window.removeEventListener('public-theme-change', update)
  }, [])
  return (
    <ThemeProvider
      colorMode={mode === 'dark' ? 'night' : 'day'}
      dayScheme="light"
      nightScheme="dark"
    >
      <Directory kind={kind} />
    </ThemeProvider>
  )
}

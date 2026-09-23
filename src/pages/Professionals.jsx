import { useEffect, useRef, useState } from 'react'
import { Button, Flash, Spinner } from '@primer/react'
import { SearchIcon } from '@primer/octicons-react'
import { PublicLayout } from '../components/PublicLayout'
import { ProfessionalListingCard } from '../components/ProfessionalListingCard'
import {
  BRAZIL_STATES,
  LISTING_KIND_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
} from '../constants/professionalListingTaxonomy'
import { listPublishedProfessionalListings } from '../services/professionalListingsService'

const initialFilters = { kind: 'professional', modality: '*', uf: '*', city: '*', serviceMode: '*' }

export default function Professionals() {
  const [filters, setFilters] = useState(initialFilters)
  const [result, setResult] = useState({ items: [], cursor: null })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const filterKey = JSON.stringify(filters)
  const latestFilterKey = useRef(filterKey)
  const loadingMoreRef = useRef(false)
  latestFilterKey.current = filterKey

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    listPublishedProfessionalListings(filters)
      .then((page) => active && setResult({ items: page.items, cursor: page.nextCursor }))
      .catch(() => active && setError('Não foi possível carregar as vitrines.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function change(name, value) {
    setFilters((current) => ({ ...current, [name]: value || '*' }))
  }

  async function loadMore() {
    if (!result.cursor || loadingMoreRef.current) return
    const requestedFilterKey = filterKey
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const page = await listPublishedProfessionalListings(filters, result.cursor)
      if (latestFilterKey.current !== requestedFilterKey) return
      setResult((current) => ({
        items: [...current.items, ...page.items],
        cursor: page.nextCursor,
      }))
    } catch {
      setError('Não foi possível carregar mais vitrines.')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }

  return (
    <PublicLayout>
      <div className="professionals-page">
        <header className="professionals-hero">
          <span className="profile-eyebrow">REDE EVOLUTUS</span>
          <h1>Encontre profissionais e espaços para evoluir</h1>
          <p>
            Conheça especialistas e locais de treino. O contato e a contratação acontecem fora do
            Evolutus.
          </p>
        </header>

        <div className="professional-filter-heading">
          <div>
            <span className="profile-eyebrow">EXPLORE A REDE</span>
            <h2>Encontre a opção certa para você</h2>
          </div>
          <p>Filtre por área, local e forma de atendimento.</p>
        </div>
        <section className="professional-filters" aria-label="Filtros do diretório">
          <label>
            Tipo
            <select value={filters.kind} onChange={(event) => change('kind', event.target.value)}>
              {LISTING_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modalidade
            <select
              value={filters.modality}
              onChange={(event) => change('modality', event.target.value)}
            >
              <option value="*">Todas</option>
              {MODALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            UF
            <select value={filters.uf} onChange={(event) => change('uf', event.target.value)}>
              <option value="*">Todos</option>
              {BRAZIL_STATES.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </select>
          </label>
          <label>
            Cidade
            <input
              value={filters.city === '*' ? '' : filters.city}
              onChange={(event) => change('city', event.target.value)}
              maxLength={80}
              placeholder="Todas"
            />
          </label>
          <label>
            Atendimento
            <select
              value={filters.serviceMode}
              onChange={(event) => change('serviceMode', event.target.value)}
            >
              <option value="*">Todos</option>
              {SERVICE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {error && <Flash variant="danger">{error}</Flash>}
        {loading ? (
          <div className="professional-state">
            <Spinner aria-label="Carregando vitrines" />
          </div>
        ) : result.items.length === 0 ? (
          <div className="professional-state" role="status">
            <SearchIcon size={28} />
            <h2>Nenhuma vitrine encontrada</h2>
            <p>Ajuste os filtros para ver outras opções.</p>
          </div>
        ) : (
          <div className="professional-grid">
            {result.items.map((listing) => (
              <ProfessionalListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
        {result.cursor && (
          <div className="professional-load-more">
            <Button onClick={loadMore} loading={loadingMore}>
              Carregar mais
            </Button>
          </div>
        )}
      </div>
    </PublicLayout>
  )
}

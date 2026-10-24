import { useState } from 'react'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  FilterIcon,
  ImageIcon,
  SearchIcon,
  XIcon,
} from '@primer/octicons-react'
import { useExerciseCatalogSearch } from '../hooks/useExerciseCatalogSearch.js'
import { useExerciseCatalogTaxonomy } from '../hooks/useExerciseCatalogTaxonomy.js'
import {
  formatCatalogLabel as displayValue,
  isProviderExerciseAdded,
} from '../utils/exerciseCatalog.js'
import { getMuscleIcon } from '../constants/muscleGroupIcons.js'
import { MuscleIconBadge } from './MuscleIconBadge.jsx'
import { ExerciseCatalogImage } from './ExerciseCatalogImage.jsx'
import { CatalogOfflineStatus } from './CatalogOfflineStatus.jsx'
import { ModalSheet, ModalSheetFrame } from './ModalSheet.jsx'
import { useSheetTitleId } from '../hooks/useSheetTitleId.js'

// Atalhos de músculo (seção 3.3 da Fase 4): só os valores REAIS de primary_muscle mais
// buscados -- nunca um grupo inventado (ex.: "Braços" juntaria vários slugs que a RPC
// não sabe combinar num só filtro). Cada atalho é filtrado contra a taxonomia real antes
// de aparecer (ver `shortcuts` abaixo); um valor que deixar de existir no catálogo some
// da lista sozinho, nunca quebra.
const MUSCLE_SHORTCUTS = [
  'peito',
  'dorsais',
  'quadriceps',
  'ombros',
  'biceps',
  'triceps',
  'abdominais',
  'gluteos',
]

function MuscleList({ muscles, tone }) {
  if (!muscles?.length) return null
  return (
    <ul className="catalog-muscle-list">
      {muscles.map((muscle) => (
        <li key={muscle}>
          <MuscleIconBadge icon={getMuscleIcon(muscle)} size="sm" tone={tone} />
          <span>{displayValue(muscle)}</span>
        </li>
      ))}
    </ul>
  )
}

function FilterSelect({ label, value, options, onChange }) {
  // Nunca mostra um filtro sem opções reais (ex.: taxonomia ainda carregando, ou uma
  // categoria que não existe em nenhum exercício do catálogo).
  if (!options.length) return null
  return (
    <label className="catalog-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {displayValue(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

// Conteúdo da ficha dentro da folha modal padrão do app (ModalSheet -- mesma base do
// "Compartilhar progresso"/planejamento): foco preso, Escape, restauração de foco ao
// elemento de origem e safe-area já vêm de lá, sem reimplementar nada aqui. Como a folha é
// uma camada POR CIMA da listagem (nunca a substitui), fechar a ficha nunca perde busca,
// filtros, página carregada nem posição de rolagem.
function ExerciseCatalogDetailBody({ exercise, added, adding, onAdd, onClose }) {
  const titleId = useSheetTitleId()
  const images = exercise.images?.length
    ? exercise.images.slice(0, 2)
    : exercise.thumbnail
      ? [exercise.thumbnail]
      : []

  const footer = (
    <Button
      variant="primary"
      block
      size="large"
      disabled={added || adding}
      loading={adding}
      onClick={() => onAdd(exercise)}
    >
      {added ? 'Já adicionado' : adding ? 'Adicionando...' : 'Adicionar aos meus exercícios'}
    </Button>
  )

  return (
    <ModalSheetFrame
      titleId={titleId}
      title={exercise.name}
      onClose={onClose}
      footer={footer}
      className="catalog-detail-dialog"
    >
      <div className="catalog-details">
        <div className="catalog-details-images">
          {images.length > 0 ? (
            images.map((src, index) => (
              <ExerciseCatalogImage
                key={src}
                src={src}
                fallbackSrc={exercise.thumbnail}
                alt={`Demonstração de ${exercise.name}, posição ${index + 1}`}
                className="catalog-detail-image"
              />
            ))
          ) : (
            <ExerciseCatalogImage
              src={null}
              alt=""
              className="catalog-detail-image"
              icon={getMuscleIcon(exercise.primaryMuscles?.[0])}
            />
          )}
        </div>
        <dl>
          <div>
            <dt>Músculos primários</dt>
            <dd>
              <MuscleList muscles={exercise.primaryMuscles} tone="solid" />
            </dd>
          </div>
          {exercise.secondaryMuscles?.length > 0 && (
            <div>
              <dt>Músculos secundários</dt>
              <dd>
                <MuscleList muscles={exercise.secondaryMuscles} tone="muted" />
              </dd>
            </div>
          )}
          <div>
            <dt>Equipamento</dt>
            <dd>{displayValue(exercise.equipment)}</dd>
          </div>
          <div>
            <dt>Nível</dt>
            <dd>{displayValue(exercise.level)}</dd>
          </div>
          <div>
            <dt>Categoria</dt>
            <dd>{displayValue(exercise.category)}</dd>
          </div>
        </dl>
        {exercise.instructions?.length > 0 && (
          <section aria-labelledby="catalog-instructions-title">
            <Heading as="h3" id="catalog-instructions-title">
              Instruções
            </Heading>
            <ol>
              {exercise.instructions.map((instruction, index) => (
                <li key={index}>{instruction}</li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </ModalSheetFrame>
  )
}

function cacheNoticeText(isPartialCache) {
  return isPartialCache
    ? 'Mostrando resultados salvos neste aparelho (sem conexão agora) -- podem ser só parte do catálogo.'
    : 'Mostrando o catálogo completo salvo neste aparelho (sem conexão agora).'
}

export function ExerciseCatalog({ personalExercises, onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({ muscle: '', equipment: '', category: '', level: '' })
  const [selected, setSelected] = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [addedIds, setAddedIds] = useState(() => new Set())
  const { muscles, equipment, categories, levels } = useExerciseCatalogTaxonomy()
  const {
    items,
    total,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    queryTooShort,
    fromCache,
    isPartialCache,
  } = useExerciseCatalogSearch({
    q: query,
    category: filters.category || undefined,
    muscle: filters.muscle || undefined,
    equipment: filters.equipment || undefined,
    level: filters.level || undefined,
  })

  // Só os atalhos cujo valor existe de fato na taxonomia real (nunca um grupo que a RPC
  // não reconheceria).
  const shortcuts = MUSCLE_SHORTCUTS.filter((slug) => muscles.includes(slug))

  function changeFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
  }

  const advancedFilterCount = [filters.muscle, filters.equipment, filters.category, filters.level].filter(
    Boolean
  ).length
  const hasActiveFilters = Boolean(query || advancedFilterCount > 0)

  function clearFilters() {
    setQuery('')
    setFilters({ muscle: '', equipment: '', category: '', level: '' })
  }

  function isAdded(exercise) {
    return (
      addedIds.has(exercise.id) ||
      isProviderExerciseAdded(
        personalExercises,
        exercise.providerExerciseId,
        exercise.provider || 'evolutus_dataset'
      )
    )
  }

  async function handleAdd(exercise) {
    if (isAdded(exercise) || addingId) return
    setAddingId(exercise.providerExerciseId)
    try {
      const result = await onAdd(exercise)
      if (result?.added !== false) {
        setAddedIds((current) => new Set(current).add(exercise.id))
      }
    } finally {
      setAddingId(null)
    }
  }

  return (
    <section className="exercise-catalog" aria-labelledby="catalog-title">
      <Box className="catalog-heading">
        <div>
          <span className="eyebrow">CATÁLOGO GLOBAL</span>
          <Heading as="h2" id="catalog-title">
            Catálogo Evolutus
          </Heading>
          <Text as="p" className="catalog-subtitle">
            Exercícios oficiais e gratuitos, com instruções e demonstração.
          </Text>
        </div>
        <Button leadingVisual={ArrowLeftIcon} onClick={onClose}>
          Meus exercícios
        </Button>
      </Box>

      <details className="catalog-offline-toggle">
        <summary>
          <CloudIcon size={14} aria-hidden="true" />
          Uso offline
          <ChevronDownIcon size={14} aria-hidden="true" className="catalog-disclosure-chevron" />
        </summary>
        <CatalogOfflineStatus personalExercises={personalExercises} />
      </details>

      <label className="exercise-search catalog-search">
        <span className="sr-only">Buscar no catálogo por nome</span>
        <SearchIcon size={16} />
        <input
          type="search"
          value={query}
          placeholder="Buscar por nome do exercício"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="catalog-search-clear"
            aria-label="Limpar busca"
            onClick={() => setQuery('')}
          >
            <XIcon size={14} />
          </button>
        )}
      </label>

      {shortcuts.length > 0 && (
        <div className="catalog-shortcuts" role="group" aria-label="Atalhos de grupo muscular">
          <button
            type="button"
            className={`chip ${filters.muscle === '' ? 'is-active' : ''}`}
            aria-pressed={filters.muscle === ''}
            onClick={() => changeFilter('muscle', '')}
          >
            Todos
          </button>
          {shortcuts.map((slug) => {
            const Icon = getMuscleIcon(slug)
            return (
              <button
                key={slug}
                type="button"
                className={`chip ${filters.muscle === slug ? 'is-active' : ''}`}
                aria-pressed={filters.muscle === slug}
                onClick={() => changeFilter('muscle', filters.muscle === slug ? '' : slug)}
              >
                <Icon size={14} aria-hidden="true" />
                {displayValue(slug)}
              </button>
            )
          })}
        </div>
      )}

      <details className="catalog-more-filters">
        <summary>
          <FilterIcon size={14} aria-hidden="true" />
          Mais filtros{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''}
          <ChevronDownIcon size={14} aria-hidden="true" className="catalog-disclosure-chevron" />
        </summary>
        <div className="catalog-filters">
          <FilterSelect
            label="Músculo"
            value={filters.muscle}
            options={muscles}
            onChange={(value) => changeFilter('muscle', value)}
          />
          <FilterSelect
            label="Equipamento"
            value={filters.equipment}
            options={equipment}
            onChange={(value) => changeFilter('equipment', value)}
          />
          <FilterSelect
            label="Categoria"
            value={filters.category}
            options={categories}
            onChange={(value) => changeFilter('category', value)}
          />
          <FilterSelect
            label="Nível"
            value={filters.level}
            options={levels}
            onChange={(value) => changeFilter('level', value)}
          />
        </div>
        <Text as="p" className="catalog-filter-hint">
          O filtro Músculo encontra o exercício pelo músculo principal ou secundário. Ao adicionar,
          o exercício é salvo na biblioteca só pelo músculo principal.
        </Text>
      </details>

      {hasActiveFilters && (
        <Box className="catalog-filters-footer">
          <Button size="small" variant="invisible" onClick={clearFilters}>
            Limpar filtros
          </Button>
        </Box>
      )}

      {fromCache && (
        <Box className="catalog-cache-note" role="status">
          {cacheNoticeText(isPartialCache)}
        </Box>
      )}

      {queryTooShort && (
        <Box className="catalog-status">Digite pelo menos 2 caracteres para buscar por nome.</Box>
      )}
      {loading && items.length === 0 && !queryTooShort && (
        <Box className="catalog-status" role="status">
          <Spinner /> Carregando catálogo
        </Box>
      )}
      {error && (
        <Box className="catalog-status" role="alert">
          <Text>{error}</Text>
        </Box>
      )}
      {!loading && !error && !queryTooShort && (
        <>
          <Text as="p" className="catalog-result-count" aria-live="polite">
            {total == null
              ? `${items.length} resultado${items.length === 1 ? '' : 's'}`
              : `${total} resultado${total === 1 ? '' : 's'}`}
          </Text>
          {items.length === 0 ? (
            <Box className="catalog-status">Nenhum resultado.</Box>
          ) : (
            <div className="catalog-grid">
              {items.map((exercise) => {
                const added = isAdded(exercise)
                const adding = addingId === exercise.providerExerciseId
                const hasDemo = (exercise.images?.length || 0) >= 2
                return (
                  <article className={`catalog-card${added ? ' is-added' : ''}`} key={exercise.id}>
                    <button
                      type="button"
                      className="catalog-card-details"
                      onClick={() => setSelected(exercise)}
                    >
                      <span className="catalog-card-thumb-wrap">
                        <ExerciseCatalogImage
                          src={exercise.thumbnail || exercise.images?.[0] || null}
                          fallbackSrc={exercise.thumbnail ? exercise.images?.[0] : null}
                          alt=""
                          className="catalog-card-thumbnail"
                          fallbackLabel=""
                          icon={getMuscleIcon(exercise.primaryMuscles?.[0])}
                        />
                        {added && (
                          <span
                            className="catalog-card-added-mark"
                            aria-label="Já está na sua biblioteca"
                          >
                            <CheckIcon size={12} />
                          </span>
                        )}
                        {hasDemo && (
                          <span className="catalog-card-demo-badge">
                            <ImageIcon size={10} /> Com demonstração
                          </span>
                        )}
                      </span>
                      <span className="catalog-card-copy">
                        <strong>{exercise.name}</strong>
                        <span className="catalog-card-muscle">
                          <MuscleIconBadge
                            icon={getMuscleIcon(exercise.primaryMuscles[0])}
                            size="sm"
                          />
                          <span>{exercise.primaryMuscles.map(displayValue).join(', ')}</span>
                        </span>
                        <small className="catalog-card-meta">
                          {displayValue(exercise.equipment || exercise.category)}
                        </small>
                      </span>
                    </button>
                    <Button
                      block
                      size="small"
                      disabled={added || adding}
                      loading={adding}
                      onClick={() => handleAdd(exercise)}
                    >
                      {added ? 'Já adicionado' : adding ? 'Adicionando...' : 'Adicionar'}
                    </Button>
                  </article>
                )
              })}
            </div>
          )}
          {hasMore && (
            <Button className="catalog-load-more" loading={loadingMore} onClick={loadMore}>
              Carregar mais
            </Button>
          )}
        </>
      )}

      {selected && (
        <ModalSheet onClose={() => setSelected(null)}>
          <ExerciseCatalogDetailBody
            exercise={selected}
            added={isAdded(selected)}
            adding={addingId === selected.providerExerciseId}
            onAdd={handleAdd}
            onClose={() => setSelected(null)}
          />
        </ModalSheet>
      )}
    </section>
  )
}

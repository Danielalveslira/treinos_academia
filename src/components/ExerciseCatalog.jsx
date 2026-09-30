import { useState } from 'react'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'
import { ArrowLeftIcon, SearchIcon } from '@primer/octicons-react'
import { useExerciseCatalogSearch } from '../hooks/useExerciseCatalogSearch.js'
import { useExerciseCatalogTaxonomy } from '../hooks/useExerciseCatalogTaxonomy.js'
import {
  EXERCISE_CATALOG_CATEGORIES,
  EXERCISE_CATALOG_LEVELS,
} from '../constants/exerciseCatalogTaxonomy.js'
import { isProviderExerciseAdded } from '../utils/exerciseCatalog.js'
import { ExerciseCatalogImage } from './ExerciseCatalogImage.jsx'

function displayValue(value) {
  if (value == null) return 'Não informado'
  return value
    .replaceAll('-', ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase('pt-BR'))
}

function FilterSelect({ label, value, options, onChange }) {
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

function ExerciseCatalogDetails({ exercise, added, adding, onAdd, onClose }) {
  const images = exercise.images?.slice(0, 2) || []
  return (
    <aside className="catalog-details" aria-labelledby="catalog-details-title">
      <Button leadingVisual={ArrowLeftIcon} onClick={onClose}>
        Voltar aos resultados
      </Button>
      <div className="catalog-details-images">
        {images.length > 0 ? (
          images.map((src, index) => (
            <ExerciseCatalogImage
              key={src}
              src={src}
              alt={`Demonstração de ${exercise.name}, posição ${index + 1}`}
              className="catalog-detail-image"
            />
          ))
        ) : (
          <ExerciseCatalogImage src={null} alt="" className="catalog-detail-image" />
        )}
      </div>
      <Heading as="h2" id="catalog-details-title">
        {exercise.name}
      </Heading>
      <dl>
        <div>
          <dt>Músculos primários</dt>
          <dd>{exercise.primaryMuscles.map(displayValue).join(', ')}</dd>
        </div>
        {exercise.secondaryMuscles?.length > 0 && (
          <div>
            <dt>Músculos secundários</dt>
            <dd>{exercise.secondaryMuscles.map(displayValue).join(', ')}</dd>
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
      <Button
        variant="primary"
        disabled={added || adding}
        loading={adding}
        onClick={() => onAdd(exercise)}
      >
        {added ? 'Já adicionado' : adding ? 'Adicionando...' : 'Adicionar aos meus exercícios'}
      </Button>
    </aside>
  )
}

export function ExerciseCatalog({ personalExercises, onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({ muscle: '', equipment: '', category: '', level: '' })
  const [selected, setSelected] = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [addedIds, setAddedIds] = useState(() => new Set())
  const { muscles, equipment } = useExerciseCatalogTaxonomy()
  const { items, total, loading, loadingMore, hasMore, loadMore, error, queryTooShort, noQueryIntent } =
    useExerciseCatalogSearch({
      q: query,
      category: filters.category || undefined,
      muscle: filters.muscle || undefined,
      equipment: filters.equipment || undefined,
      level: filters.level || undefined,
    })

  function changeFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
  }

  function isAdded(providerExerciseId) {
    return addedIds.has(providerExerciseId) || isProviderExerciseAdded(personalExercises, providerExerciseId)
  }

  async function handleAdd(exercise) {
    if (isAdded(exercise.providerExerciseId)) return
    setAddingId(exercise.providerExerciseId)
    try {
      const result = await onAdd(exercise)
      if (result?.added !== false) {
        setAddedIds((current) => new Set(current).add(exercise.providerExerciseId))
      }
    } finally {
      setAddingId(null)
    }
  }

  if (selected) {
    return (
      <ExerciseCatalogDetails
        exercise={selected}
        added={isAdded(selected.providerExerciseId)}
        adding={addingId === selected.providerExerciseId}
        onAdd={handleAdd}
        onClose={() => setSelected(null)}
      />
    )
  }

  return (
    <section className="exercise-catalog" aria-labelledby="catalog-title">
      <Box className="catalog-heading">
        <div>
          <span className="eyebrow">CATÁLOGO GLOBAL</span>
          <Heading as="h2" id="catalog-title">
            Catálogo Evolutus
          </Heading>
        </div>
        <Button leadingVisual={ArrowLeftIcon} onClick={onClose}>
          Meus exercícios
        </Button>
      </Box>

      <label className="exercise-search catalog-search">
        <span className="sr-only">Buscar no catálogo</span>
        <SearchIcon size={16} />
        <input
          type="search"
          value={query}
          placeholder="Buscar por nome, músculo ou equipamento"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="catalog-filters">
        <FilterSelect
          label="Grupo muscular"
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
          options={EXERCISE_CATALOG_CATEGORIES}
          onChange={(value) => changeFilter('category', value)}
        />
        <FilterSelect
          label="Nível"
          value={filters.level}
          options={EXERCISE_CATALOG_LEVELS}
          onChange={(value) => changeFilter('level', value)}
        />
      </div>

      {noQueryIntent && (
        <Box className="catalog-status">
          Busque por nome ou escolha um filtro para ver exercícios do catálogo.
        </Box>
      )}
      {queryTooShort && (
        <Box className="catalog-status">Digite pelo menos 2 caracteres para buscar por nome.</Box>
      )}
      {loading && items.length === 0 && !queryTooShort && !noQueryIntent && (
        <Box className="catalog-status" role="status">
          <Spinner /> Carregando catálogo
        </Box>
      )}
      {error && (
        <Box className="catalog-status" role="alert">
          <Text>{error}</Text>
        </Box>
      )}
      {!loading && !error && !queryTooShort && !noQueryIntent && (
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
                const added = isAdded(exercise.providerExerciseId)
                const adding = addingId === exercise.providerExerciseId
                return (
                  <article className="catalog-card" key={exercise.id}>
                    <button
                      type="button"
                      className="catalog-card-details"
                      onClick={() => setSelected(exercise)}
                    >
                      <ExerciseCatalogImage
                        src={exercise.images?.[0] || null}
                        alt=""
                        className="catalog-card-thumbnail"
                        fallbackLabel=""
                      />
                      <span className="catalog-card-copy">
                        <strong>{exercise.name}</strong>
                        <span>{exercise.primaryMuscles.map(displayValue).join(', ')}</span>
                        <small>
                          {displayValue(exercise.equipment)} · {displayValue(exercise.level)} ·{' '}
                          {displayValue(exercise.category)}
                        </small>
                      </span>
                    </button>
                    <Button
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
    </section>
  )
}

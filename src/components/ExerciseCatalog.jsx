import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'
import { ArrowLeftIcon, SearchIcon } from '@primer/octicons-react'
import { useExerciseCatalog } from '../hooks/useExerciseCatalog.js'
import {
  filterCatalog,
  getCatalogFilterOptions,
  isCatalogExerciseAdded,
  searchCatalog,
  sortCatalog,
} from '../utils/exerciseCatalog.js'
import { getExerciseImageUrl, getExerciseThumbnailUrl } from '../utils/exerciseCatalogImages.js'
import { ExerciseCatalogImage } from './ExerciseCatalogImage.jsx'

const PAGE_SIZE = 24
const NULL_FILTER = '__null__'
const EMPTY_EXERCISES = []

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
          <option key={option ?? NULL_FILTER} value={option ?? NULL_FILTER}>
            {displayValue(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

function ExerciseCatalogDetails({ exercise, added, adding, onAdd, onClose }) {
  const imageIndexes = exercise.imageRefs.length
    ? exercise.imageRefs.slice(0, 2).map((_, index) => index)
    : [0]
  return (
    <aside className="catalog-details" aria-labelledby="catalog-details-title">
      <Button leadingVisual={ArrowLeftIcon} onClick={onClose}>
        Voltar aos resultados
      </Button>
      <div className="catalog-details-images">
        {imageIndexes.map((index) => (
          <ExerciseCatalogImage
            key={index}
            src={getExerciseImageUrl(exercise, index)}
            alt={`Demonstração de ${exercise.name}, posição ${index + 1}`}
            className="catalog-detail-image"
          />
        ))}
      </div>
      <Heading as="h2" id="catalog-details-title">
        {exercise.name}
      </Heading>
      <dl>
        <div>
          <dt>Músculos primários</dt>
          <dd>{exercise.primaryMuscles.map(displayValue).join(', ')}</dd>
        </div>
        {exercise.secondaryMuscles.length > 0 && (
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
      {exercise.instructions.length > 0 && (
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
  const { data, loading, error, retry } = useExerciseCatalog()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({ muscle: '', equipment: '', category: '', level: '' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [addedIds, setAddedIds] = useState(() => new Set())
  const exercises = data?.exercises || EMPTY_EXERCISES
  const searchedExercises = useMemo(() => searchCatalog(exercises, query), [exercises, query])
  const normalizedFilters = useMemo(
    () => ({
      ...filters,
      equipment:
        filters.equipment === ''
          ? undefined
          : filters.equipment === NULL_FILTER
            ? null
            : filters.equipment,
    }),
    [filters]
  )
  const options = useMemo(
    () => getCatalogFilterOptions(searchedExercises, normalizedFilters),
    [searchedExercises, normalizedFilters]
  )
  const results = useMemo(
    () => sortCatalog(filterCatalog(searchedExercises, normalizedFilters)),
    [searchedExercises, normalizedFilters]
  )

  useEffect(() => {
    setFilters((current) => {
      const next = { ...current }
      if (current.muscle && !options.muscles.includes(current.muscle)) next.muscle = ''
      if (current.category && !options.categories.includes(current.category)) next.category = ''
      if (current.level && !options.levels.includes(current.level)) next.level = ''
      if (current.equipment) {
        const equipment = current.equipment === NULL_FILTER ? null : current.equipment
        if (!options.equipment.includes(equipment)) next.equipment = ''
      }
      return Object.keys(current).some((key) => current[key] !== next[key]) ? next : current
    })
  }, [options])

  function changeFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
    setLimit(PAGE_SIZE)
  }

  function isAdded(exerciseId) {
    return addedIds.has(exerciseId) || isCatalogExerciseAdded(personalExercises, exerciseId)
  }

  async function handleAdd(exercise) {
    if (isAdded(exercise.id)) return
    setAddingId(exercise.id)
    try {
      const result = await onAdd(exercise)
      if (result?.added !== false) {
        setAddedIds((current) => new Set(current).add(exercise.id))
      }
    } finally {
      setAddingId(null)
    }
  }

  if (selected) {
    return (
      <ExerciseCatalogDetails
        exercise={selected}
        added={isAdded(selected.id)}
        adding={addingId === selected.id}
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
      {loading && (
        <Box className="catalog-status" role="status">
          <Spinner /> Carregando catálogo
        </Box>
      )}
      {error && (
        <Box className="catalog-status" role="alert">
          <Text>Erro ao carregar o catálogo.</Text>
          <Button onClick={retry}>Tentar novamente</Button>
        </Box>
      )}
      {!loading && !error && (
        <>
          <label className="exercise-search catalog-search">
            <span className="sr-only">Buscar no catálogo</span>
            <SearchIcon size={16} />
            <input
              type="search"
              value={query}
              placeholder="Buscar por nome, músculo ou equipamento"
              onChange={(event) => {
                setQuery(event.target.value)
                setLimit(PAGE_SIZE)
              }}
            />
          </label>
          <div className="catalog-filters">
            <FilterSelect
              label="Grupo muscular"
              value={filters.muscle}
              options={options.muscles}
              onChange={(value) => changeFilter('muscle', value)}
            />
            <FilterSelect
              label="Equipamento"
              value={filters.equipment}
              options={options.equipment}
              onChange={(value) => changeFilter('equipment', value)}
            />
            <FilterSelect
              label="Categoria"
              value={filters.category}
              options={options.categories}
              onChange={(value) => changeFilter('category', value)}
            />
            <FilterSelect
              label="Nível"
              value={filters.level}
              options={options.levels}
              onChange={(value) => changeFilter('level', value)}
            />
          </div>
          <Text as="p" className="catalog-result-count" aria-live="polite">
            {results.length} resultado{results.length === 1 ? '' : 's'}
          </Text>
          {results.length === 0 ? (
            <Box className="catalog-status">Nenhum resultado.</Box>
          ) : (
            <div className="catalog-grid">
              {results.slice(0, limit).map((exercise) => {
                const added = isAdded(exercise.id)
                const adding = addingId === exercise.id
                return (
                  <article className="catalog-card" key={exercise.id}>
                    <button
                      type="button"
                      className="catalog-card-details"
                      onClick={() => setSelected(exercise)}
                    >
                      <ExerciseCatalogImage
                        src={getExerciseThumbnailUrl(exercise)}
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
          {limit < results.length && (
            <Button
              className="catalog-load-more"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              Carregar mais
            </Button>
          )}
        </>
      )}
    </section>
  )
}

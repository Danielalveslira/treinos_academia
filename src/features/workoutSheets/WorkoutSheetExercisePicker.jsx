import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Box,
  Button,
  FormControl,
  Heading,
  SegmentedControl,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import { ArrowLeftIcon, ChevronUpIcon, PlusIcon, SearchIcon } from '@primer/octicons-react'
import { useExercises } from '../../contexts/ExercisesContext'
import { canStartExercise } from '../../utils/personalExercises.js'
import { normalizeForSearch } from '../../utils/text.js'
const Catalog = lazy(() =>
  import('../../components/ExerciseCatalog').then((m) => ({ default: memo(m.ExerciseCatalog) }))
)

export const WorkoutSheetExercisePicker = memo(function WorkoutSheetExercisePicker({
  items,
  onAdd,
  disabled,
}) {
  const { exercises, addFromCatalog, loading, error, refresh } = useExercises()
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  const [catalog, setCatalog] = useState(false)
  const [visitedCatalog, setVisitedCatalog] = useState(false)
  const [search, setSearch] = useState('')
  const scrollRef = useRef(null),
    searchRef = useRef(null)
  const focusLibrary = useRef(false)
  const sourceRef = useRef('library'),
    positions = useRef({ library: 0, catalog: 0 })
  const selected = useMemo(() => new Set(items.map((item) => item.exercise_id)), [items])
  const available = useMemo(() => {
    const term = normalizeForSearch(search)
    return exercises.filter(
      (e) => canStartExercise(e) && !selected.has(e.id) && normalizeForSearch(e.name).includes(term)
    )
  }, [exercises, search, selected])

  const switchSource = useCallback((next) => {
    positions.current[sourceRef.current] = scrollRef.current?.scrollTop || 0
    focusLibrary.current = !next && sourceRef.current === 'catalog'
    sourceRef.current = next ? 'catalog' : 'library'
    if (next) setVisitedCatalog(true)
    setCatalog(next)
  }, [])
  const returnToLibrary = useCallback(() => switchSource(false), [switchSource])
  useLayoutEffect(() => {
    if (!open || !scrollRef.current) return
    scrollRef.current.scrollTop = positions.current[catalog ? 'catalog' : 'library']
    if (!catalog && focusLibrary.current) searchRef.current?.focus({ preventScroll: true })
    focusLibrary.current = false
  }, [catalog, open])
  const toggleOpen = () => {
    positions.current[sourceRef.current] = scrollRef.current?.scrollTop || 0
    if (!open) focusLibrary.current = true
    setOpened(true)
    setOpen((value) => !value)
  }
  const addOfficial = useCallback(
    async (item) => {
      if (disabled)
        throw new Error('Seleção indisponível. Verifique a conexão e o limite de exercícios.')
      const result = await addFromCatalog(item)
      const exercise =
        result.exercise ||
        exercises.find(
          (e) => e.provider === item.provider && e.providerExerciseId === item.providerExerciseId
        )
      if (exercise) onAdd(exercise)
      return result
    },
    [addFromCatalog, exercises, onAdd, disabled]
  )
  return (
    <Box sx={{ minWidth: 0 }}>
      <Button
        type="button"
        leadingVisual={open ? ChevronUpIcon : PlusIcon}
        onClick={toggleOpen}
        aria-expanded={open}
        block
        disabled={disabled && !open}
      >
        {open ? 'Fechar seleção' : 'Adicionar exercícios'}
      </Button>
      {opened && (
        <Box hidden={!open} sx={{ mt: 3, minWidth: 0 }}>
          <SegmentedControl
            aria-label="Origem dos exercícios"
            fullWidth
            sx={{ height: 44 }}
            onChange={(index) => switchSource(index === 1)}
          >
            <SegmentedControl.Button selected={!catalog} disabled={disabled}>
              Biblioteca
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={catalog} disabled={disabled}>
              Catálogo
            </SegmentedControl.Button>
          </SegmentedControl>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
              my: 2,
              minHeight: 44,
            }}
          >
            <Text hidden={catalog} sx={{ color: 'fg.muted', fontSize: 0 }}>
              Escolha exercícios sem sair da ficha.
            </Text>
            {catalog && (
              <Button
                type="button"
                variant="invisible"
                size="small"
                leadingVisual={ArrowLeftIcon}
                onClick={returnToLibrary}
              >
                Voltar à biblioteca
              </Button>
            )}
          </Box>
          <Box
            ref={scrollRef}
            role="region"
            aria-label="Seletor de exercícios"
            tabIndex={0}
            sx={{
              height: ['26rem', '32rem'],
              maxHeight: '60dvh',
              minWidth: 0,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              scrollbarGutter: 'stable',
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.default',
              p: [2, 3],
              ':focus-visible': {
                outline: '2px solid',
                outlineColor: 'accent.fg',
                outlineOffset: 2,
              },
            }}
          >
            <Box hidden={catalog}>
              <FormControl disabled={disabled} sx={{ mb: 2 }}>
                <FormControl.Label>Buscar na biblioteca</FormControl.Label>
                <TextInput
                  ref={searchRef}
                  type="search"
                  leadingVisual={SearchIcon}
                  block
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </FormControl>
              {loading && <Spinner aria-label="Carregando biblioteca" />}
              {error && (
                <Text as="p" role="alert">
                  Não foi possível carregar a biblioteca.{' '}
                  <Button onClick={refresh} disabled={disabled}>
                    Tentar novamente
                  </Button>
                </Text>
              )}
              <Box as="ul" sx={{ p: 0, m: 0, listStyle: 'none' }}>
                {available.map((exercise) => (
                  <Box
                    as="li"
                    key={exercise.id}
                    sx={{
                      display: 'flex',
                      gap: 2,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid',
                      borderColor: 'border.muted',
                      py: 2,
                    }}
                  >
                    <Text sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{exercise.name}</Text>
                    <Button
                      type="button"
                      disabled={disabled}
                      aria-label={`Adicionar ${exercise.name}`}
                      onClick={() => onAdd(exercise)}
                    >
                      Adicionar
                    </Button>
                  </Box>
                ))}
              </Box>
              {!loading && !available.length && (
                <Box sx={{ py: 3 }}>
                  <Heading as="h3" sx={{ fontSize: 1 }}>
                    Nenhum exercício disponível
                  </Heading>
                  <Text as="p" sx={{ color: 'fg.muted', fontSize: 0 }}>
                    Ajuste a busca ou encontre um exercício oficial no catálogo.
                  </Text>
                  <Button type="button" disabled={disabled} onClick={() => switchSource(true)}>
                    Encontrar no Catálogo Evolutus
                  </Button>
                </Box>
              )}
            </Box>
            {visitedCatalog && (
              <Box
                as="fieldset"
                disabled={disabled}
                hidden={!catalog}
                aria-hidden={!catalog}
                sx={{ '&&': { m: 0, p: 0, border: 0, minWidth: 0 } }}
              >
                <Suspense fallback={<Spinner aria-label="Carregando catálogo" />}>
                  <Catalog
                    personalExercises={exercises}
                    onAdd={addOfficial}
                    onClose={returnToLibrary}
                  />
                </Suspense>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
})

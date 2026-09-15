import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Spinner, Stack, IconButton } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  TasklistIcon,
  PlusIcon,
  ChevronRightIcon,
  SearchIcon,
  SyncIcon,
  EyeIcon,
  EyeClosedIcon,
  PencilIcon,
  TrashIcon,
  ListOrderedIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
  XIcon,
} from '@primer/octicons-react'
import { useExercises } from '../contexts/ExercisesContext'
import { useDashboard } from '../hooks/useDashboard'
import { useToast } from '../hooks/useToast'
import { ExerciseForm } from '../components/ExerciseForm'
import { ExerciseCatalog } from '../components/ExerciseCatalog'
import { ErrorState } from '../components/ErrorState'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { ToastFlash } from '../components/ToastFlash'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { getMuscleGroupIcon } from '../constants/muscleGroupIcons'
import { formatDate } from '../utils/format'
import { toDate } from '../utils/date.js'
import { sortExercisesInGroup, moveExerciseOrder } from '../utils/exerciseOrder'

// Busca só aparece a partir daqui — mesmo limiar usado em WorkoutForm.jsx para a busca
// por grupo, por consistência: com poucos exercícios ela é só ruído na tela.
const SEARCH_THRESHOLD = 6

// Primeira ocorrência por exerciseId já é a mais recente: allWorkouts (useDashboard)
// vem ordenado por data decrescente.
function buildLastLoggedMap(allWorkouts) {
  const map = new Map()
  for (const workout of allWorkouts) {
    if (!map.has(workout.exerciseId)) map.set(workout.exerciseId, toDate(workout.date))
  }
  return map
}

export default function Exercises() {
  const navigate = useNavigate()
  const { exercises, loading, error, add, addFromCatalog, edit, remove, reorder, refresh } =
    useExercises()
  const { allWorkouts } = useDashboard()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [addChoiceOpen, setAddChoiceOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [editingExercise, setEditingExercise] = useState(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  // Grupo atualmente em modo "Reordenar" (um por vez) e o rascunho de ids na nova
  // ordem, só gravado no Firestore ao confirmar em "Salvar ordem" (ver saveReorder).
  const [reorderGroup, setReorderGroup] = useState(null)
  const [reorderIds, setReorderIds] = useState([])
  const [savingOrder, setSavingOrder] = useState(false)

  const lastLoggedMap = useMemo(() => buildLastLoggedMap(allWorkouts), [allWorkouts])
  const inactiveCount = useMemo(() => exercises.filter((ex) => !ex.active).length, [exercises])

  const visibleExercises = useMemo(() => {
    const term = search.trim().toLowerCase()
    return exercises.filter((exercise) => {
      if (!showInactive && !exercise.active) return false
      if (term && !exercise.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [exercises, showInactive, search])

  const grouped = useMemo(() => {
    const groups = new Map()
    for (const exercise of visibleExercises) {
      const list = groups.get(exercise.muscleGroup) || []
      list.push(exercise)
      groups.set(exercise.muscleGroup, list)
    }
    return [...groups.entries()]
      .map(([group, list]) => [group, sortExercisesInGroup(list)])
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
  }, [visibleExercises])

  // Conta o grupo inteiro (ativos e inativos, sem o filtro de busca) -- "Reordenar"
  // ordena o grupo completo, então o botão só aparece quando isso de fato envolve
  // mais de um exercício, independente do que a busca/"mostrar inativos" esconde.
  const groupSizeAll = useMemo(() => {
    const counts = new Map()
    for (const exercise of exercises) {
      counts.set(exercise.muscleGroup, (counts.get(exercise.muscleGroup) || 0) + 1)
    }
    return counts
  }, [exercises])

  function startReorder(muscleGroup) {
    const ids = sortExercisesInGroup(exercises.filter((ex) => ex.muscleGroup === muscleGroup)).map(
      (ex) => ex.id
    )
    setReorderGroup(muscleGroup)
    setReorderIds(ids)
  }

  function cancelReorder() {
    setReorderGroup(null)
    setReorderIds([])
  }

  function moveReorderRow(exerciseId, direction) {
    setReorderIds((ids) => moveExerciseOrder(ids, exerciseId, direction))
  }

  async function saveReorder() {
    setSavingOrder(true)
    try {
      await reorder(reorderIds)
      showToast('Ordem salva.')
      setReorderGroup(null)
      setReorderIds([])
    } catch (err) {
      console.error('[Exercises] reorder:', err)
      showToast('Erro ao salvar a ordem.', 'danger')
    } finally {
      setSavingOrder(false)
    }
  }

  async function handleCreate(values) {
    try {
      await add(values)
      setFormOpen(false)
      showToast('Exercício cadastrado.')
    } catch (err) {
      console.error('[Exercises] create:', err)
      showToast('Erro ao cadastrar exercício.', 'danger')
    }
  }

  async function handleCatalogAdd(exercise) {
    try {
      const result = await addFromCatalog(exercise)
      showToast(result.added ? 'Exercício adicionado.' : 'Exercício já adicionado.')
      return result
    } catch (err) {
      console.error('[Exercises] catalog create:', err)
      showToast('Erro ao adicionar exercício.', 'danger')
      throw err
    }
  }

  async function handleUpdate(values) {
    try {
      await edit(editingExercise.id, values)
      setEditingExercise(null)
      showToast('Exercício atualizado.')
    } catch (err) {
      console.error('[Exercises] update:', err)
      showToast('Erro ao atualizar exercício.', 'danger')
    }
  }

  async function handleDeleteRequest(exercise) {
    const confirmed = await confirmDelete({
      title: `Excluir "${exercise.name}"?`,
      content: 'Os registros de treino associados não serão excluídos.',
    })
    if (!confirmed) return

    try {
      await remove(exercise.id)
      showToast('Exercício excluído.')
    } catch (err) {
      console.error('[Exercises] delete:', err)
      showToast('Erro ao excluir exercício.', 'danger')
    }
  }

  const hasAnyExercise = exercises.length > 0
  const hasVisibleExercise = visibleExercises.length > 0

  return (
    <Box className="exercises-page">
      <ToastFlash toasts={toasts} />
      <header className="page-title-row">
        <div>
          <span className="eyebrow">SUA BIBLIOTECA</span>
          <Heading as="h1">Exercícios</Heading>
          {hasAnyExercise && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 1, mb: 0 }}>
              {exercises.length} exercício{exercises.length === 1 ? '' : 's'} em {grouped.length}{' '}
              {grouped.length === 1 ? 'grupo' : 'grupos'}
              {inactiveCount > 0 && !showInactive
                ? ` · ${inactiveCount} inativo${inactiveCount === 1 ? '' : 's'} oculto${inactiveCount === 1 ? '' : 's'}`
                : ''}
            </Text>
          )}
        </div>

        {!formOpen && !editingExercise && !addChoiceOpen && !catalogOpen && (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button leadingVisual={SyncIcon} onClick={refresh} loading={loading} disabled={loading}>
              Atualizar
            </Button>
            {(loading || error || hasAnyExercise) && (
              <Button
                leadingVisual={PlusIcon}
                variant="primary"
                onClick={() => setAddChoiceOpen(true)}
              >
                Adicionar exercício
              </Button>
            )}
          </Box>
        )}
      </header>

      {catalogOpen ? (
        <ExerciseCatalog
          personalExercises={exercises}
          onAdd={handleCatalogAdd}
          onClose={() => setCatalogOpen(false)}
        />
      ) : (
        <>
          {addChoiceOpen && (
            <Box className="exercise-add-choice" aria-labelledby="exercise-add-title">
              <Heading as="h2" id="exercise-add-title">
                Adicionar exercício
              </Heading>
              <Text as="p">Escolha a origem do exercício.</Text>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setAddChoiceOpen(false)
                    setCatalogOpen(true)
                  }}
                >
                  Catálogo Evolutus
                </Button>
                <Button
                  onClick={() => {
                    setAddChoiceOpen(false)
                    setFormOpen(true)
                  }}
                >
                  Criar personalizado
                </Button>
                <Button variant="invisible" onClick={() => setAddChoiceOpen(false)}>
                  Cancelar
                </Button>
              </Box>
            </Box>
          )}

          {formOpen && (
            <ExerciseForm
              exercises={exercises}
              onSubmit={handleCreate}
              onCancel={() => setFormOpen(false)}
            />
          )}
          {editingExercise && (
            <ExerciseForm
              exercises={exercises}
              initialValue={editingExercise}
              onSubmit={handleUpdate}
              onCancel={() => setEditingExercise(null)}
            />
          )}

          {loading && exercises.length === 0 && (
            <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
          )}
          <ErrorState error={error} onRetry={refresh} />

          {!loading && !error && !hasAnyExercise && (
            <Blankslate>
              <Blankslate.Visual>
                <TasklistIcon size={24} />
              </Blankslate.Visual>
              <Blankslate.Heading>Nenhum exercício cadastrado</Blankslate.Heading>
              <Blankslate.Description>
                Cadastre seu primeiro exercício para começar a registrar treinos.
              </Blankslate.Description>
              <Blankslate.PrimaryAction onClick={() => setAddChoiceOpen(true)}>
                Adicionar exercício
              </Blankslate.PrimaryAction>
            </Blankslate>
          )}

          {hasAnyExercise && (
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 3 }}>
              {exercises.length > SEARCH_THRESHOLD && (
                <label className="exercise-search" style={{ flex: '1 1 220px', marginBottom: 0 }}>
                  <span className="sr-only">Buscar exercício</span>
                  <SearchIcon size={16} />
                  <input
                    type="search"
                    value={search}
                    placeholder="Buscar exercício"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              )}
              {inactiveCount > 0 && (
                <Button
                  leadingVisual={showInactive ? EyeClosedIcon : EyeIcon}
                  onClick={() => setShowInactive((prev) => !prev)}
                >
                  {showInactive ? 'Ocultar inativos' : `Mostrar inativos (${inactiveCount})`}
                </Button>
              )}
            </Box>
          )}

          {hasAnyExercise && !hasVisibleExercise && (
            <Text as="p" sx={{ color: 'fg.muted', textAlign: 'center', py: 5 }}>
              Nenhum exercício encontrado.
            </Text>
          )}

          <div className="exercise-groups">
            {grouped.map(([muscleGroup, list]) => {
              const GroupIcon = getMuscleGroupIcon(muscleGroup)
              const isReordering = reorderGroup === muscleGroup
              const canReorder =
                !reorderGroup && !formOpen && !editingExercise && groupSizeAll.get(muscleGroup) >= 2
              return (
                <section className="exercise-group" key={muscleGroup}>
                  <div className="exercise-group-heading">
                    <span className="muscle-icon">
                      <GroupIcon size={16} strokeWidth={2} />
                    </span>
                    <Heading as="h2">{muscleGroup}</Heading>
                    <span className="exercise-group-count">{list.length}</span>
                    {canReorder && (
                      <Button
                        size="small"
                        leadingVisual={ListOrderedIcon}
                        onClick={() => startReorder(muscleGroup)}
                        sx={{ ml: 2 }}
                      >
                        Reordenar
                      </Button>
                    )}
                  </div>

                  {isReordering && (
                    <Stack gap="none" className="exercise-list exercise-list-reorder">
                      {reorderIds.map((exerciseId, index) => {
                        const exercise = exercises.find((ex) => ex.id === exerciseId)
                        if (!exercise) return null
                        return (
                          <Box key={exerciseId} className="exercise-row exercise-row-reorder">
                            <Text className={exercise.active ? '' : 'is-inactive'} sx={{ flex: 1 }}>
                              {exercise.name}
                            </Text>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <IconButton
                                size="small"
                                icon={ArrowUpIcon}
                                aria-label={`Mover ${exercise.name} para cima`}
                                disabled={index === 0 || savingOrder}
                                onClick={() => moveReorderRow(exerciseId, -1)}
                              />
                              <IconButton
                                size="small"
                                icon={ArrowDownIcon}
                                aria-label={`Mover ${exercise.name} para baixo`}
                                disabled={index === reorderIds.length - 1 || savingOrder}
                                onClick={() => moveReorderRow(exerciseId, 1)}
                              />
                            </Box>
                          </Box>
                        )
                      })}
                      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                        <Button
                          variant="primary"
                          leadingVisual={CheckIcon}
                          loading={savingOrder}
                          disabled={savingOrder}
                          onClick={saveReorder}
                        >
                          Salvar ordem
                        </Button>
                        <Button
                          leadingVisual={XIcon}
                          disabled={savingOrder}
                          onClick={cancelReorder}
                        >
                          Cancelar
                        </Button>
                      </Box>
                    </Stack>
                  )}

                  {!isReordering && (
                    <Stack gap="none" className="exercise-list">
                      {list.map((exercise) => {
                        const lastLogged = lastLoggedMap.get(exercise.id)
                        return (
                          <Box key={exercise.id} className="exercise-row">
                            <Box
                              as="button"
                              type="button"
                              onClick={() => navigate(`/exercicios/${exercise.id}`)}
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                textAlign: 'left',
                                bg: 'transparent',
                                border: 0,
                                p: 0,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                cursor: 'pointer',
                                color: 'fg.default',
                              }}
                            >
                              <Box sx={{ minWidth: 0, display: 'grid', gap: '2px' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <Text className={exercise.active ? '' : 'is-inactive'}>
                                    {exercise.name}
                                  </Text>
                                  {!exercise.active && <Label>Inativo</Label>}
                                </Box>
                                {lastLogged && (
                                  <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                                    Último registro: {formatDate(lastLogged)}
                                  </Text>
                                )}
                              </Box>
                              <Box sx={{ ml: 'auto', color: 'fg.muted', display: 'flex' }}>
                                <ChevronRightIcon size={16} />
                              </Box>
                            </Box>
                            <RowActionsMenu
                              actions={[
                                {
                                  key: 'edit',
                                  label: 'Editar',
                                  icon: PencilIcon,
                                  onSelect: () => setEditingExercise(exercise),
                                },
                                {
                                  key: 'delete',
                                  label: 'Excluir',
                                  icon: TrashIcon,
                                  variant: 'danger',
                                  onSelect: () => handleDeleteRequest(exercise),
                                },
                              ]}
                            />
                          </Box>
                        )
                      })}
                    </Stack>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </Box>
  )
}

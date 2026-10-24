import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Spinner, Stack, IconButton } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  TasklistIcon,
  PlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
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
import { useSingleFlight } from '../hooks/useSingleFlight'
import { useToast } from '../hooks/useToast'
import { ExercisePreferencesForm } from '../components/ExercisePreferencesForm'
import { ExerciseCatalog } from '../components/ExerciseCatalog'
import { ErrorState } from '../components/ErrorState'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { ToastFlash } from '../components/ToastFlash'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { getMuscleGroupIcon } from '../constants/muscleGroupIcons'
import { MuscleIconBadge } from '../components/MuscleIconBadge'
import { formatDate } from '../utils/format'
import { toDate } from '../utils/date.js'
import { normalizeForSearch } from '../utils/text.js'
import { formatCatalogLabel } from '../utils/exerciseCatalog.js'
import { returnToOrigin } from '../utils/navigation.js'
import { isLegacyExercise } from '../utils/personalExercises.js'
import { sortExercisesInGroup, moveExerciseOrder } from '../utils/exerciseOrder'

// Primeira ocorrência por exerciseId já é a mais recente: allWorkouts (useDashboard)
// vem ordenado por data decrescente.
function buildLastLoggedMap(allWorkouts) {
  const map = new Map()
  for (const workout of allWorkouts) {
    if (!map.has(workout.exerciseId)) map.set(workout.exerciseId, toDate(workout.date))
  }
  return map
}

// "Grupo · Equipamento" -- nunca mostra um metadado que o exercício não tem (equipment é
// só snapshot de exercícios vindos do catálogo; personalizados normalmente não têm).
function exerciseSubtitle(exercise) {
  const equipment = exercise.equipment ? formatCatalogLabel(exercise.equipment) : null
  return [exercise.muscleGroup, equipment].filter(Boolean).join(' · ')
}

export default function Exercises() {
  const navigate = useNavigate()
  const location = useLocation()
  const { exercises, loading, error, addFromCatalog, edit, remove, reorder, refresh } =
    useExercises()
  const { allWorkouts } = useDashboard()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [catalogOpen, setCatalogOpen] = useState(() => Boolean(location.state?.openCatalog))
  const [editingExercise, setEditingExercise] = useState(null)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  // Grupo atualmente em modo "Reordenar" (um por vez) e o rascunho de ids na nova
  // ordem, só gravado no banco ao confirmar em "Salvar ordem" (ver saveReorder).
  const [reorderGroup, setReorderGroup] = useState(null)
  const [reorderIds, setReorderIds] = useState([])
  const [savingOrder, setSavingOrder] = useState(false)

  const lastLoggedMap = useMemo(() => buildLastLoggedMap(allWorkouts), [allWorkouts])
  const inactiveCount = useMemo(() => exercises.filter((ex) => !ex.active).length, [exercises])

  // Grupos com pelo menos um exercício visível (respeitando "mostrar inativos", mas não
  // a busca por nome nem o filtro de grupo em si) -- é a lista de chips disponíveis.
  const availableGroups = useMemo(() => {
    const groups = new Set()
    for (const exercise of exercises) {
      if (!showInactive && !exercise.active) continue
      groups.add(exercise.muscleGroup)
    }
    return [...groups].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [exercises, showInactive])

  const visibleExercises = useMemo(() => {
    const term = normalizeForSearch(search.trim())
    return exercises.filter((exercise) => {
      if (!showInactive && !exercise.active) return false
      if (groupFilter && exercise.muscleGroup !== groupFilter) return false
      if (term && !normalizeForSearch(exercise.name).includes(term)) return false
      return true
    })
  }, [exercises, showInactive, groupFilter, search])

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

  // Conta o grupo inteiro (ativos e inativos, sem busca/filtro de grupo) -- "Reordenar"
  // ordena o grupo completo, então o botão só aparece quando isso de fato envolve mais de
  // um exercício, independente do que a busca/"mostrar inativos" esconde.
  const groupSizeAll = useMemo(() => {
    const counts = new Map()
    for (const exercise of exercises) {
      counts.set(exercise.muscleGroup, (counts.get(exercise.muscleGroup) || 0) + 1)
    }
    return counts
  }, [exercises])

  function toggleGroupCollapsed(muscleGroup) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(muscleGroup)) next.delete(muscleGroup)
      else next.add(muscleGroup)
      return next
    })
  }

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

  async function handleCatalogAdd(exercise) {
    try {
      const result = await addFromCatalog(exercise)
      showToast(
        result.added
          ? `Exercício adicionado em ${result.exercise.muscleGroup}.`
          : 'Exercício já estava na sua biblioteca.'
      )
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

  async function handleToggleActive(exercise) {
    try {
      await edit(exercise.id, { active: !exercise.active })
      showToast(exercise.active ? 'Exercício inativado.' : 'Exercício ativado.')
    } catch (err) {
      console.error('[Exercises] toggle active:', err)
      showToast('Erro ao atualizar exercício.', 'danger')
    }
  }

  const deleteFlight = useSingleFlight()

  function handleDeleteRequest(exercise) {
    return deleteFlight.run(exercise.id, () => deleteExercise(exercise))
  }

  async function deleteExercise(exercise) {
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
      showToast(
        err.code === '23503'
          ? 'Este exercício tem treinos registrados. Inative-o para preservar o histórico.'
          : 'Erro ao excluir exercício.',
        'danger'
      )
    }
  }

  const hasAnyExercise = exercises.length > 0
  const hasVisibleExercise = visibleExercises.length > 0
  const distinctGroupCount = new Set(
    exercises.filter((ex) => showInactive || ex.active).map((ex) => ex.muscleGroup)
  ).size

  return (
    <Box className="exercises-page">
      <ToastFlash toasts={toasts} />
      {/* Escondido com o catálogo aberto: ExerciseCatalog já tem seu próprio cabeçalho
          ("Catálogo Evolutus") -- repetir "Exercícios/Sua biblioteca" por cima daria a
          impressão de ainda estar na listagem pessoal (Fase 4, seção 3.1). */}
      {!catalogOpen && (
        <header className="page-title-row exercises-header">
          <div>
            <span className="eyebrow">SUA BIBLIOTECA</span>
            <Heading as="h1">Exercícios</Heading>
            {hasAnyExercise && (
              <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 1, mb: 0 }}>
                {exercises.length} exercício{exercises.length === 1 ? '' : 's'} · {distinctGroupCount}{' '}
                {distinctGroupCount === 1 ? 'grupo' : 'grupos'}
                {inactiveCount > 0 && !showInactive
                  ? ` · ${inactiveCount} inativo${inactiveCount === 1 ? '' : 's'} oculto${inactiveCount === 1 ? '' : 's'}`
                  : ''}
              </Text>
            )}
          </div>

          {!editingExercise && (
            <IconButton
              icon={SyncIcon}
              aria-label="Atualizar"
              size="small"
              variant="invisible"
              onClick={refresh}
              loading={loading}
              disabled={loading}
            />
          )}
        </header>
      )}

      {catalogOpen ? (
        <ExerciseCatalog
          personalExercises={exercises}
          onAdd={handleCatalogAdd}
          onClose={() =>
            location.state?.openCatalog
              ? returnToOrigin(navigate, location, '/novo-treino')
              : setCatalogOpen(false)
          }
        />
      ) : (
        <>
          {editingExercise && (
            <ExercisePreferencesForm
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
              <Blankslate.Heading>Sua biblioteca está vazia</Blankslate.Heading>
              <Blankslate.Description>
                Escolha exercícios no Catálogo Evolutus para começar a registrar treinos.
              </Blankslate.Description>
              <Blankslate.PrimaryAction onClick={() => setCatalogOpen(true)}>
                Adicionar exercício
              </Blankslate.PrimaryAction>
            </Blankslate>
          )}

          {hasAnyExercise && !editingExercise && (
            <Box className="exercises-toolbar">
              <label className="exercise-search">
                <span className="sr-only">Buscar na biblioteca</span>
                <SearchIcon size={16} />
                <input
                  type="search"
                  value={search}
                  placeholder="Buscar na biblioteca..."
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {
                <Button
                  leadingVisual={PlusIcon}
                  variant="primary"
                  onClick={() => setCatalogOpen(true)}
                >
                  Adicionar
                </Button>
              }
            </Box>
          )}

          {hasAnyExercise && availableGroups.length > 1 && (
            <div
              className="exercise-group-chips"
              role="tablist"
              aria-label="Filtrar por grupo muscular"
            >
              <button
                type="button"
                role="tab"
                aria-selected={groupFilter === ''}
                className={`chip ${groupFilter === '' ? 'is-active' : ''}`}
                onClick={() => setGroupFilter('')}
              >
                Todos
              </button>
              {availableGroups.map((group) => (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={groupFilter === group}
                  className={`chip ${groupFilter === group ? 'is-active' : ''}`}
                  onClick={() => setGroupFilter(group)}
                >
                  {group}
                </button>
              ))}
            </div>
          )}

          {hasAnyExercise && inactiveCount > 0 && (
            <Button
              size="small"
              variant="invisible"
              leadingVisual={showInactive ? EyeClosedIcon : EyeIcon}
              onClick={() => setShowInactive((prev) => !prev)}
              sx={{ mb: 2 }}
            >
              {showInactive ? 'Ocultar inativos' : `Mostrar inativos (${inactiveCount})`}
            </Button>
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
              const isCollapsed = collapsedGroups.has(muscleGroup) && !isReordering
              const canReorder =
                !reorderGroup && !editingExercise && groupSizeAll.get(muscleGroup) >= 2
              return (
                <section className="exercise-group" key={muscleGroup}>
                  <button
                    type="button"
                    className="exercise-group-heading"
                    onClick={() => toggleGroupCollapsed(muscleGroup)}
                    aria-expanded={!isCollapsed}
                  >
                    <ChevronDownIcon
                      size={14}
                      className={`exercise-group-chevron ${isCollapsed ? 'is-collapsed' : ''}`}
                    />
                    <MuscleIconBadge icon={GroupIcon} size="sm" />
                    <Heading as="h2">{muscleGroup}</Heading>
                    <span className="exercise-group-count">{list.length}</span>
                  </button>
                  {canReorder && !isCollapsed && (
                    <Button
                      size="small"
                      variant="invisible"
                      leadingVisual={ListOrderedIcon}
                      onClick={() => startReorder(muscleGroup)}
                      sx={{ mb: 2 }}
                    >
                      Reordenar
                    </Button>
                  )}

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

                  {!isReordering && !isCollapsed && (
                    <Stack gap="none" className="exercise-list">
                      {list.map((exercise) => {
                        const lastLogged = lastLoggedMap.get(exercise.id)
                        const subtitle = exerciseSubtitle(exercise)
                        return (
                          <Box key={exercise.id} className="exercise-row">
                            <Box
                              as="button"
                              type="button"
                              onClick={() => navigate(`/exercicios/${exercise.id}`)}
                              className="exercise-row-main"
                            >
                              <Box sx={{ minWidth: 0, display: 'grid', gap: '2px' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <Text className={exercise.active ? '' : 'is-inactive'}>
                                    {exercise.name}
                                  </Text>
                                  {isLegacyExercise(exercise) && <Label>Exercício antigo</Label>}
                                  {!exercise.active && <Label>Inativo</Label>}
                                </Box>
                                {subtitle && (
                                  <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{subtitle}</Text>
                                )}
                                {lastLogged && (
                                  <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                                    Último treino: {formatDate(lastLogged)}
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
                                  label: 'Preferências',
                                  icon: PencilIcon,
                                  onSelect: () => setEditingExercise(exercise),
                                },
                                {
                                  key: 'toggle-active',
                                  label: exercise.active ? 'Inativar' : 'Ativar',
                                  icon: exercise.active ? EyeClosedIcon : EyeIcon,
                                  onSelect: () => handleToggleActive(exercise),
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

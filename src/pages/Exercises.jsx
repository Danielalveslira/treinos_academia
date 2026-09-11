import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Spinner, Stack } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  TasklistIcon,
  PlusIcon,
  ChevronRightIcon,
  SearchIcon,
  SyncIcon,
  EyeIcon,
  EyeClosedIcon,
} from '@primer/octicons-react'
import { useExercises } from '../contexts/ExercisesContext'
import { useDashboard } from '../hooks/useDashboard'
import { useToast } from '../hooks/useToast'
import { ExerciseForm } from '../components/ExerciseForm'
import { ErrorState } from '../components/ErrorState'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { ToastFlash } from '../components/ToastFlash'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { getMuscleGroupIcon } from '../constants/muscleGroupIcons'
import { formatDate } from '../utils/format'

// Busca só aparece a partir daqui — mesmo limiar usado em WorkoutForm.jsx para a busca
// por grupo, por consistência: com poucos exercícios ela é só ruído na tela.
const SEARCH_THRESHOLD = 6

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

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
  const { exercises, loading, error, add, edit, remove, refresh } = useExercises()
  const { allWorkouts } = useDashboard()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingExercise, setEditingExercise] = useState(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

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
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
  }, [visibleExercises])

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
          <p>Organize movimentos e acompanhe a evolução de cada grupo muscular.</p>
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

        {!formOpen && !editingExercise && (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button leadingVisual={SyncIcon} onClick={refresh} loading={loading} disabled={loading}>
              Atualizar
            </Button>
            <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setFormOpen(true)}>
              Novo
            </Button>
          </Box>
        )}
      </header>

      {formOpen && (
        <ExerciseForm exercises={exercises} onSubmit={handleCreate} onCancel={() => setFormOpen(false)} />
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
          <Blankslate.PrimaryAction onClick={() => setFormOpen(true)}>
            Cadastrar exercício
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
          return (
            <section className="exercise-group" key={muscleGroup}>
              <div className="exercise-group-heading">
                <span className="muscle-icon">
                  <GroupIcon size={16} strokeWidth={2} />
                </span>
                <Heading as="h2">{muscleGroup}</Heading>
                <span>{list.length}</span>
              </div>
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
                        onEdit={() => setEditingExercise(exercise)}
                        onDelete={() => handleDeleteRequest(exercise)}
                      />
                    </Box>
                  )
                })}
              </Stack>
            </section>
          )
        })}
      </div>
    </Box>
  )
}

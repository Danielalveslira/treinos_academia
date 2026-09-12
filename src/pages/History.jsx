import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Heading,
  Text,
  Spinner,
  FormControl,
  Select,
  TextInput,
  Stack,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { CalendarIcon, GraphIcon, HistoryIcon, PlayIcon, SyncIcon } from '@primer/octicons-react'
import { useWorkouts } from '../hooks/useWorkouts'
import { useExercises } from '../contexts/ExercisesContext'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { WorkoutForm } from '../components/WorkoutForm'
import { ErrorState } from '../components/ErrorState'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { ToastFlash } from '../components/ToastFlash'
import { calculateVolume } from '../utils/calculations'
import { buildExerciseNameMap } from '../utils/format'

import { getWorkoutSets, formatWorkoutSets } from '../utils/workoutSets'
import { isCardioWorkout, formatCardioSession } from '../utils/cardioSessions'
import { toDate } from '../utils/date.js'

function toEditableWorkout(workout) {
  const date = toDate(workout.date)
  const base = {
    exerciseId: workout.exerciseId,
    date: date.toISOString().slice(0, 10),
    note: workout.note || '',
  }
  if (isCardioWorkout(workout)) {
    return {
      ...base,
      type: 'cardio',
      durationMinutes: workout.durationMinutes,
      distanceKm: workout.distanceKm ?? '',
    }
  }
  return { ...base, setDetails: getWorkoutSets(workout) }
}

const NO_FILTERS = { exerciseFilter: '', startDate: '', endDate: '' }

export default function History() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [exerciseFilter, setExerciseFilter] = useState(
    searchParams.get('exercicio') || NO_FILTERS.exerciseFilter
  )
  const [startDate, setStartDate] = useState(NO_FILTERS.startDate)
  const [endDate, setEndDate] = useState(NO_FILTERS.endDate)
  const [editingWorkout, setEditingWorkout] = useState(null)

  const hasActiveFilters = Boolean(exerciseFilter || startDate || endDate)

  function clearFilters() {
    setExerciseFilter(NO_FILTERS.exerciseFilter)
    setStartDate(NO_FILTERS.startDate)
    setEndDate(NO_FILTERS.endDate)
  }

  const { exercises } = useExercises()
  const { workouts, loading, error, hasMore, loadMore, edit, remove, refresh } = useWorkouts({
    exerciseId: exerciseFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()

  const exerciseNameById = useMemo(() => buildExerciseNameMap(exercises), [exercises])

  async function handleUpdate(values) {
    try {
      await edit(editingWorkout.id, values)
      setEditingWorkout(null)
      showToast('Registro atualizado.')
    } catch (err) {
      console.error('[History] update:', err)
      showToast('Erro ao atualizar registro.', 'danger')
    }
  }

  async function handleDeleteRequest(workout) {
    const confirmed = await confirmDelete({
      title: 'Excluir registro de treino?',
      content: 'Esta ação não pode ser desfeita.',
    })
    if (!confirmed) return

    try {
      await remove(workout.id)
      showToast('Registro excluído.')
    } catch (err) {
      console.error('[History] delete:', err)
      showToast('Erro ao excluir registro.', 'danger')
    }
  }

  return (
    <Box className="history-page">
      <ToastFlash toasts={toasts} />
      <header className="page-title-row">
        <div>
          <span className="eyebrow">SUA EVOLUÇÃO</span>
          <Heading as="h1">Histórico</Heading>
        </div>
        <Button leadingVisual={SyncIcon} onClick={refresh} loading={loading} disabled={loading}>
          Atualizar
        </Button>
      </header>

      <Box className="history-filters">
        <FormControl sx={{ mb: 2 }}>
          <FormControl.Label visuallyHidden>Exercício</FormControl.Label>
          <Select value={exerciseFilter} onChange={(e) => setExerciseFilter(e.target.value)} block>
            <Select.Option value="">Todos os exercícios</Select.Option>
            {exercises.map((ex) => (
              <Select.Option key={ex.id} value={ex.id}>
                {ex.name}
              </Select.Option>
            ))}
          </Select>
        </FormControl>

        <div className="history-date-filters">
          <Box sx={{ minWidth: 0 }}>
            <FormControl>
              <FormControl.Label sx={{ fontSize: 0, color: 'fg.muted' }}>De</FormControl.Label>
              <TextInput
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                block
              />
            </FormControl>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <FormControl>
              <FormControl.Label sx={{ fontSize: 0, color: 'fg.muted' }}>Até</FormControl.Label>
              <TextInput
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                block
              />
            </FormControl>
          </Box>
        </div>

        {hasActiveFilters && (
          <Button size="small" onClick={clearFilters} sx={{ mt: 2 }}>
            Limpar filtros
          </Button>
        )}
      </Box>

      {editingWorkout && (
        <Box
          sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 3 }}
        >
          <WorkoutForm
            key={editingWorkout.id}
            exercises={exercises}
            initialValue={toEditableWorkout(editingWorkout)}
            onSubmit={handleUpdate}
            onCancel={() => setEditingWorkout(null)}
          />
        </Box>
      )}

      {loading && workouts.length === 0 && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && workouts.length === 0 && (
        <div className="history-empty">
          <Blankslate>
            <Blankslate.Visual>
              <HistoryIcon size={24} />
            </Blankslate.Visual>
            <Blankslate.Heading>Nenhum registro encontrado</Blankslate.Heading>
            <Blankslate.Description>
              {hasActiveFilters
                ? 'Ajuste os filtros para encontrar outros treinos.'
                : 'Seu histórico começa depois da primeira série.'}
            </Blankslate.Description>
            {hasActiveFilters ? (
              <Blankslate.PrimaryAction onClick={clearFilters}>
                Limpar filtros
              </Blankslate.PrimaryAction>
            ) : (
              <Blankslate.PrimaryAction
                leadingVisual={PlayIcon}
                onClick={() => navigate('/novo-treino')}
              >
                Iniciar treino
              </Blankslate.PrimaryAction>
            )}
          </Blankslate>
        </div>
      )}

      <Stack gap="none" className={`history-list${workouts.length ? '' : ' is-empty'}`}>
        {workouts.map((workout) => (
          <Box key={workout.id} className="history-row">
            <div
              className="history-date"
              aria-label={toDate(workout.date).toLocaleDateString('pt-BR')}
            >
              <CalendarIcon size={15} />
              <strong>
                {toDate(workout.date).toLocaleDateString('pt-BR', { day: '2-digit' })}
              </strong>
              <span>
                {toDate(workout.date)
                  .toLocaleDateString('pt-BR', { month: 'short' })
                  .replace('.', '')}
              </span>
            </div>
            <Box className="history-row-content">
              <Text className="history-exercise-name">
                {exerciseNameById.get(workout.exerciseId) || 'Exercício removido'}
              </Text>
              <Text className="history-sets">
                {isCardioWorkout(workout)
                  ? formatCardioSession(workout)
                  : formatWorkoutSets(workout)}
              </Text>
              {workout.note && <Text className="history-note">{workout.note}</Text>}
            </Box>
            {!isCardioWorkout(workout) && (
              <div className="history-volume">
                <GraphIcon size={14} />
                <span>VOLUME</span>
                <strong>{calculateVolume(workout).toLocaleString('pt-BR')} kg</strong>
              </div>
            )}
            <RowActionsMenu
              onEdit={() => setEditingWorkout(workout)}
              onDelete={() => handleDeleteRequest(workout)}
            />
          </Box>
        ))}
      </Stack>

      {hasMore && (
        <Button sx={{ mt: 3, width: '100%' }} onClick={loadMore} disabled={loading}>
          Carregar mais
        </Button>
      )}
    </Box>
  )
}

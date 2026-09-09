import { useMemo, useState } from 'react'
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
import { HistoryIcon } from '@primer/octicons-react'
import { useWorkouts } from '../hooks/useWorkouts'
import { useExercises } from '../contexts/ExercisesContext'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { WorkoutForm } from '../components/WorkoutForm'
import { ErrorState } from '../components/ErrorState'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { ToastFlash } from '../components/ToastFlash'
import { calculateVolume } from '../utils/calculations'
import { formatWeight, buildExerciseNameMap } from '../utils/format'

function toEditableWorkout(workout) {
  const date = workout.date?.toDate ? workout.date.toDate() : new Date(workout.date)
  return {
    exerciseId: workout.exerciseId,
    weight: String(workout.weight),
    sets: String(workout.sets),
    reps: String(workout.reps),
    date: date.toISOString().slice(0, 10),
    note: workout.note || '',
  }
}

const NO_FILTERS = { exerciseFilter: '', startDate: '', endDate: '' }

export default function History() {
  const [exerciseFilter, setExerciseFilter] = useState(NO_FILTERS.exerciseFilter)
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
    <Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Histórico
      </Heading>
      <p className="page-description">
        Consulte seus registros e encontre cada etapa da sua evolução.
      </p>

      <Box className="panel filters-panel" sx={{ mb: 3 }}>
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

        <Stack direction="horizontal" gap="condensed">
          <Box sx={{ flex: 1 }}>
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
          <Box sx={{ flex: 1 }}>
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
        </Stack>

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
            exercises={exercises}
            initialValue={toEditableWorkout(editingWorkout)}
            onSubmit={handleUpdate}
            onCancel={() => setEditingWorkout(null)}
          />
        </Box>
      )}

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && workouts.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <HistoryIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum registro encontrado</Blankslate.Heading>
          <Blankslate.Description>
            Ajuste os filtros ou registre um novo treino.
          </Blankslate.Description>
        </Blankslate>
      )}

      <Stack
        gap="none"
        sx={{
          border: workouts.length ? '1px solid' : 'none',
          borderColor: 'border.default',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {workouts.map((workout, index) => (
          <Box
            key={workout.id}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 2,
              px: 3,
              py: 2,
              borderTop: index === 0 ? 'none' : '1px solid',
              borderColor: 'border.default',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Text sx={{ fontWeight: 'bold', display: 'block' }}>
                {exerciseNameById.get(workout.exerciseId) || 'Exercício removido'}
              </Text>
              <Text sx={{ fontSize: 1, color: 'fg.muted', display: 'block' }}>
                {formatWeight(workout.weight)} · {workout.sets}x{workout.reps} · volume{' '}
                {calculateVolume(workout.weight, workout.sets, workout.reps)}
              </Text>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>
                {(workout.date?.toDate
                  ? workout.date.toDate()
                  : new Date(workout.date)
                ).toLocaleDateString('pt-BR')}
              </Text>
              {workout.note && (
                <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mt: 1 }}>
                  {workout.note}
                </Text>
              )}
            </Box>
            <RowActionsMenu
              onEdit={() => setEditingWorkout(workout)}
              onDelete={() => handleDeleteRequest(workout)}
            />
          </Box>
        ))}
      </Stack>

      {hasMore && (
        <Button sx={{ mt: 3, width: '100%' }} onClick={loadMore}>
          Carregar mais
        </Button>
      )}
    </Box>
  )
}

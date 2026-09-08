import { useMemo, useState } from 'react'
import { useWorkouts } from '../hooks/useWorkouts'
import { useExercises } from '../hooks/useExercises'
import { useToast } from '../hooks/useToast'
import { WorkoutForm } from '../components/WorkoutForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { Spinner } from '../components/Spinner'
import { ToastContainer } from '../components/ToastContainer'
import { calculateVolume } from '../utils/calculations'

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

export default function History() {
  const [exerciseFilter, setExerciseFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [editingWorkout, setEditingWorkout] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const { exercises } = useExercises()
  const { workouts, loading, error, hasMore, loadMore, edit, remove } = useWorkouts({
    exerciseId: exerciseFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const { toasts, showToast } = useToast()

  const exerciseNameById = useMemo(() => {
    const map = new Map()
    exercises.forEach((ex) => map.set(ex.id, ex.name))
    return map
  }, [exercises])

  async function handleUpdate(values) {
    try {
      await edit(editingWorkout.id, values)
      setEditingWorkout(null)
      showToast('Registro atualizado.')
    } catch {
      showToast('Erro ao atualizar registro.', 'error')
    }
  }

  async function handleDelete() {
    try {
      await remove(pendingDelete.id)
      setPendingDelete(null)
      showToast('Registro excluído.')
    } catch {
      showToast('Erro ao excluir registro.', 'error')
    }
  }

  return (
    <div className="page">
      <ToastContainer toasts={toasts} />
      <h1>Histórico</h1>

      <div className="filters">
        <select value={exerciseFilter} onChange={(e) => setExerciseFilter(e.target.value)}>
          <option value="">Todos os exercícios</option>
          {exercises.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      {editingWorkout && (
        <WorkoutForm
          exercises={exercises}
          initialValue={toEditableWorkout(editingWorkout)}
          onSubmit={handleUpdate}
          onCancel={() => setEditingWorkout(null)}
        />
      )}

      {loading && <Spinner />}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && workouts.length === 0 && (
        <EmptyState message="Nenhum registro encontrado para os filtros selecionados." />
      )}

      <ul className="workout-list">
        {workouts.map((workout) => (
          <li key={workout.id} className="workout-list__item">
            <div>
              <strong>{exerciseNameById.get(workout.exerciseId) || 'Exercício removido'}</strong>
              <div className="workout-list__meta">
                {workout.weight}kg · {workout.sets}x{workout.reps} · volume{' '}
                {calculateVolume(workout.weight, workout.sets, workout.reps)}
              </div>
              <div className="workout-list__date">
                {(workout.date?.toDate ? workout.date.toDate() : new Date(workout.date)).toLocaleDateString('pt-BR')}
              </div>
              {workout.note && <div className="workout-list__note">{workout.note}</div>}
            </div>
            <div className="workout-list__actions">
              <button className="link-button" onClick={() => setEditingWorkout(workout)}>
                Editar
              </button>
              <button
                className="link-button link-button--danger"
                onClick={() => setPendingDelete(workout)}
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>

      {hasMore && (
        <button className="button" onClick={loadMore}>
          Carregar mais
        </button>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir registro"
        message="Tem certeza que deseja excluir este registro de treino?"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

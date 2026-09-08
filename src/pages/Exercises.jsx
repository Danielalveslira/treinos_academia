import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useExercises } from '../hooks/useExercises'
import { useToast } from '../hooks/useToast'
import { ExerciseForm } from '../components/ExerciseForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { Spinner } from '../components/Spinner'
import { ToastContainer } from '../components/ToastContainer'

export default function Exercises() {
  const { exercises, loading, error, add, edit, remove } = useExercises()
  const { toasts, showToast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [editingExercise, setEditingExercise] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const grouped = useMemo(() => {
    const groups = new Map()
    for (const exercise of exercises) {
      const list = groups.get(exercise.muscleGroup) || []
      list.push(exercise)
      groups.set(exercise.muscleGroup, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [exercises])

  async function handleCreate(values) {
    try {
      await add(values)
      setFormOpen(false)
      showToast('Exercício cadastrado.')
    } catch {
      showToast('Erro ao cadastrar exercício.', 'error')
    }
  }

  async function handleUpdate(values) {
    try {
      await edit(editingExercise.id, values)
      setEditingExercise(null)
      showToast('Exercício atualizado.')
    } catch {
      showToast('Erro ao atualizar exercício.', 'error')
    }
  }

  async function handleDelete() {
    try {
      await remove(pendingDelete.id)
      setPendingDelete(null)
      showToast('Exercício excluído.')
    } catch {
      showToast('Erro ao excluir exercício.', 'error')
    }
  }

  return (
    <div className="page">
      <ToastContainer toasts={toasts} />
      <div className="page__header">
        <h1>Exercícios</h1>
        {!formOpen && !editingExercise && (
          <button className="button button--primary" onClick={() => setFormOpen(true)}>
            Novo exercício
          </button>
        )}
      </div>

      {formOpen && (
        <ExerciseForm onSubmit={handleCreate} onCancel={() => setFormOpen(false)} />
      )}

      {editingExercise && (
        <ExerciseForm
          initialValue={editingExercise}
          onSubmit={handleUpdate}
          onCancel={() => setEditingExercise(null)}
        />
      )}

      {loading && <Spinner />}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && exercises.length === 0 && (
        <EmptyState
          message="Nenhum exercício cadastrado ainda."
          actionLabel="Cadastrar primeiro exercício"
          onAction={() => setFormOpen(true)}
        />
      )}

      {grouped.map(([muscleGroup, list]) => (
        <section key={muscleGroup} className="exercise-group">
          <h2>{muscleGroup}</h2>
          <ul className="exercise-list">
            {list.map((exercise) => (
              <li key={exercise.id} className={exercise.active ? '' : 'exercise-list__inactive'}>
                <Link to={`/exercicios/${exercise.id}`} className="exercise-list__name">
                  {exercise.name}
                </Link>
                {!exercise.active && <span className="badge">Inativo</span>}
                <div className="exercise-list__actions">
                  <button className="link-button" onClick={() => setEditingExercise(exercise)}>
                    Editar
                  </button>
                  <button
                    className="link-button link-button--danger"
                    onClick={() => setPendingDelete(exercise)}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir exercício"
        message={`Tem certeza que deseja excluir "${pendingDelete?.name}"? Os registros de treino associados não serão excluídos.`}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Spinner, Stack } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  TasklistIcon,
  PlusIcon,
  ChevronRightIcon,
  PulseIcon,
  SyncIcon,
} from '@primer/octicons-react'
import { useExercises } from '../contexts/ExercisesContext'
import { useToast } from '../hooks/useToast'
import { ExerciseForm } from '../components/ExerciseForm'
import { ErrorState } from '../components/ErrorState'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { ToastFlash } from '../components/ToastFlash'
import { useConfirmDelete } from '../hooks/useConfirmDelete'

export default function Exercises() {
  const navigate = useNavigate()
  const { exercises, loading, error, add, edit, remove, refresh } = useExercises()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingExercise, setEditingExercise] = useState(null)

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

  return (
    <Box className="exercises-page">
      <ToastFlash toasts={toasts} />
      <header className="page-title-row">
        <div>
          <span className="eyebrow">SUA BIBLIOTECA</span>
          <Heading as="h1">Exercícios</Heading>
          <p>Organize movimentos e acompanhe a evolução de cada grupo muscular.</p>
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

      {formOpen && <ExerciseForm onSubmit={handleCreate} onCancel={() => setFormOpen(false)} />}
      {editingExercise && (
        <ExerciseForm
          initialValue={editingExercise}
          onSubmit={handleUpdate}
          onCancel={() => setEditingExercise(null)}
        />
      )}

      {loading && exercises.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && exercises.length === 0 && (
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

      <div className="exercise-groups">
        {grouped.map(([muscleGroup, list]) => (
          <section className="exercise-group" key={muscleGroup}>
            <div className="exercise-group-heading">
              <span className="muscle-icon">
                <PulseIcon size={16} />
              </span>
              <Heading as="h2">{muscleGroup}</Heading>
              <span>{list.length}</span>
            </div>
            <Stack gap="none" className="exercise-list">
              {list.map((exercise) => (
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
                    <Text className={exercise.active ? '' : 'is-inactive'}>{exercise.name}</Text>
                    {!exercise.active && <Label>Inativo</Label>}
                    <Box sx={{ ml: 'auto', color: 'fg.muted', display: 'flex' }}>
                      <ChevronRightIcon size={16} />
                    </Box>
                  </Box>
                  <RowActionsMenu
                    onEdit={() => setEditingExercise(exercise)}
                    onDelete={() => handleDeleteRequest(exercise)}
                  />
                </Box>
              ))}
            </Stack>
          </section>
        ))}
      </div>
    </Box>
  )
}

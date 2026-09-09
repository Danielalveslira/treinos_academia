import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Spinner, Stack } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { TasklistIcon, PlusIcon, ChevronRightIcon } from '@primer/octicons-react'
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
    <Box>
      <ToastFlash toasts={toasts} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Exercícios
        </Heading>

        {!formOpen && !editingExercise && (
          <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setFormOpen(true)}>
            Novo
          </Button>
        )}
      </Box>

      <p className="page-description">Organize seus exercícios por grupo muscular.</p>

      {formOpen && <ExerciseForm onSubmit={handleCreate} onCancel={() => setFormOpen(false)} />}
      {editingExercise && (
        <ExerciseForm
          initialValue={editingExercise}
          onSubmit={handleUpdate}
          onCancel={() => setEditingExercise(null)}
        />
      )}

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
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

      {grouped.map(([muscleGroup, list]) => (
        <Box key={muscleGroup} sx={{ mb: 3 }}>
          <Text
            sx={{ fontSize: 1, fontWeight: 'bold', color: 'fg.muted', display: 'block', mb: 2 }}
          >
            {muscleGroup}
          </Text>
          <Stack
            gap="none"
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            {list.map((exercise, index) => (
              <Box
                key={exercise.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 3,
                  py: 2,
                  borderTop: index === 0 ? 'none' : '1px solid',
                  borderColor: 'border.default',
                }}
              >
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
                  <Text
                    sx={{
                      opacity: exercise.active ? 1 : 0.6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {exercise.name}
                  </Text>
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
        </Box>
      ))}
    </Box>
  )
}

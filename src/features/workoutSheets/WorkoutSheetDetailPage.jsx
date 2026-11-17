import { useCallback, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Box, Button, Flash, Heading, Spinner } from '@primer/react'
import { ChevronRightIcon } from '@primer/octicons-react'
import { WorkoutExerciseGuide } from '../../components/WorkoutExerciseGuide'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import { deleteWorkoutSheet, sheetError } from './workoutSheetsService.js'
import { prescription, SHEET_GOALS, WEEKDAYS } from './workoutSheetValidation.js'
import { originState } from '../../utils/navigation.js'
import { DeleteSheetDialog } from './DeleteSheetDialog.jsx'
import './workoutSheets.css'
export default function WorkoutSheetDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: sheet, loading, error, refresh, online } = useWorkoutSheets(id)
  const [guide, setGuide] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const triggerRef = useRef(null)
  const close = useCallback(() => setGuide(null), [])
  async function confirmDelete() {
    try {
      await deleteWorkoutSheet(sheet)
    } catch (err) {
      if (!String(err?.message).includes('SHEET_NOT_FOUND')) return sheetError(err)
    }
    navigate('/exercicios', { replace: true })
    return ''
  }
  const ready =
    sheet &&
    !sheet.archived_at &&
    sheet.items.length > 0 &&
    sheet.items.every((i) => i.available && !i.exercise?.typeMismatch)
  const metaLine = sheet
    ? [
        SHEET_GOALS[sheet.goal],
        sheet.goal_description,
        sheet.weekdays?.length > 0 && sheet.weekdays.map((d) => WEEKDAYS[d]).join(', '),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  return (
    <section className="workout-sheets">
      <Link to="/exercicios">Voltar para minhas fichas</Link>
      {loading && <Spinner aria-label="Carregando ficha" />}
      {error && (
        <Flash variant="danger" role="alert">
          {sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {sheet && (
        <>
          <header className="sheet-heading">
            <Heading as="h1">{sheet.name}</Heading>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button as={Link} to={`/fichas/${id}/editar`}>
                Editar ficha
              </Button>
              <Button variant="danger" disabled={!online} onClick={() => setDeleting(true)}>
                Excluir definitivamente
              </Button>
            </Box>
          </header>
          {metaLine && <p className="sheet-meta-line">{metaLine}</p>}
          {sheet.archived_at && (
            <Flash>Ficha arquivada. Restaure em Minhas fichas para iniciar.</Flash>
          )}
          {!sheet.items.length && (
            <Flash>Rascunho: adicione pelo menos um exercício para iniciar.</Flash>
          )}
          <ol className="sheet-list">
            {sheet.items.map((item, index) => (
              <li className="sheet-row-item" key={item.id}>
                <button
                  type="button"
                  className="sheet-row"
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget
                    setGuide(item.exercise)
                  }}
                  aria-label={`Ver instruções e execução de ${item.exercise.name}`}
                >
                  <span className="sheet-row-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="sheet-row-main">
                    <span className="sheet-row-name">{item.exercise.name}</span>
                    {prescription(item) && (
                      <span className="sheet-row-meta">{prescription(item)}</span>
                    )}
                  </span>
                  <ChevronRightIcon size={16} aria-hidden="true" />
                </button>
                {!item.available && (
                  <Flash variant="warning" className="sheet-row-warning">
                    Indisponível para novos treinos. Substitua este exercício por um oficial
                    publicado e ativo.
                  </Flash>
                )}
                {item.exercise?.typeMismatch && (
                  <Flash variant="warning" className="sheet-row-warning">
                    A categoria oficial mudou. Ajuste as metas deste exercício na ficha antes de
                    iniciar um novo treino.
                  </Flash>
                )}
              </li>
            ))}
          </ol>
          <p>
            As metas são referências. A marcação de concluído é por exercício no dia, compartilhada
            entre fichas.
          </p>
          <Button
            variant="primary"
            onClick={() => navigate(`/novo-treino?ficha=${id}`, { state: originState(location) })}
            disabled={!ready || !online}
          >
            Iniciar treino
          </Button>
        </>
      )}
      {guide && sheet && (
        <WorkoutExerciseGuide
          key={guide.id}
          exercise={guide}
          onClose={close}
          triggerRef={triggerRef}
        />
      )}
      {deleting && sheet && (
        <DeleteSheetDialog
          sheet={sheet}
          onClose={() => setDeleting(false)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  )
}

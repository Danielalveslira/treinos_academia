import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Flash, Heading, Spinner } from '@primer/react'
import { WorkoutExerciseGuide } from '../../components/WorkoutExerciseGuide'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import { sheetError } from './workoutSheetsService.js'
import { prescription, SHEET_GOALS, WEEKDAYS } from './workoutSheetValidation.js'
import './workoutSheets.css'
export default function WorkoutSheetDetailPage() {
  const { id } = useParams()
  const { data: sheet, loading, error, refresh, online } = useWorkoutSheets(id)
  const [guide, setGuide] = useState(null)
  const triggerRef = useRef(null)
  const close = useCallback(() => setGuide(null), [])
  const ready =
    sheet && !sheet.archived_at && sheet.items.length > 0 && sheet.items.every((i) => i.available)
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
            <Button as={Link} to={`/fichas/${id}/editar`}>
              Editar ficha
            </Button>
          </header>
          <p>{SHEET_GOALS[sheet.goal]}</p>
          <p>{sheet.goal_description}</p>
          <p>{sheet.weekdays.map((d) => WEEKDAYS[d]).join(' · ')}</p>
          {sheet.archived_at && (
            <Flash>Ficha arquivada. Restaure em Minhas fichas para iniciar.</Flash>
          )}
          {!sheet.items.length && (
            <Flash>Rascunho: adicione pelo menos um exercício para iniciar.</Flash>
          )}
          <ol className="sheet-list">
            {sheet.items.map((item) => (
              <li className="sheet-card" key={item.id}>
                <h2>{item.exercise.name}</h2>
                <p>{prescription(item) || 'Sem metas definidas'}</p>
                {!item.available && (
                  <Flash variant="warning">
                    Indisponível para novos treinos. Substitua este exercício por um oficial
                    publicado e ativo.
                  </Flash>
                )}
                <Button
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget
                    setGuide(item.exercise)
                  }}
                >
                  Ver execução de {item.exercise.name}
                </Button>
              </li>
            ))}
          </ol>
          <p>
            As metas são referências. Séries e resultados reais serão informados durante o treino. A
            marcação de concluído é por exercício no dia, compartilhada entre fichas.
          </p>
          <Button
            variant="primary"
            as={Link}
            to={`/novo-treino?ficha=${id}`}
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
    </section>
  )
}

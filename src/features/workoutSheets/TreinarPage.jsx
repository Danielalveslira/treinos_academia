import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, Flash, Heading, Spinner } from '@primer/react'
import { PlayIcon } from '@primer/octicons-react'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import { sheetError } from './workoutSheetsService.js'
import { SHEET_GOALS } from './workoutSheetValidation.js'
import { originState } from '../../utils/navigation.js'
import './workoutSheets.css'

// Entrada de AÇÃO (não uma aba de planejamento): só um seletor rápido para começar a treinar.
// Gestão completa (criar/editar/arquivar/reordenar) continua em Fichas (/exercicios). Reaproveita
// o mesmo hook/serviço de leitura de WorkoutSheetsPage — sem segunda implementação de fichas.
export default function TreinarPage() {
  const { data, loading, error, refresh, online } = useWorkoutSheets(null, false, false, 0)
  const navigate = useNavigate()
  const location = useLocation()
  const sheets = data || []

  function start(sheetId) {
    navigate(`/novo-treino?ficha=${sheetId}`, { state: originState(location) })
  }
  function startFree() {
    navigate('/novo-treino', { state: originState(location) })
  }

  return (
    <section className="workout-sheets">
      <header className="sheet-heading">
        <div>
          <span className="eyebrow">SESSÃO DE TREINO</span>
          <Heading as="h1">Treinar</Heading>
        </div>
      </header>
      {sheets.length > 0 && <p>Escolha uma ficha para começar. Treino livre fica abaixo.</p>}

      {error && (
        <Flash variant="danger" role="alert">
          {sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando fichas" />}

      {!loading && !error && sheets.length === 0 && (
        <div className="sheet-card">
          <h2>Nenhuma ficha ativa</h2>
          <p>Crie uma ficha para planejar seus treinos, ou comece agora com o treino livre.</p>
          <div className="sheet-actions">
            <Button onClick={() => navigate('/fichas/nova')} disabled={!online}>
              Criar ficha
            </Button>
            <Button as={Link} to="/novo-treino" state={originState(location)}>
              Treino livre
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && sheets.length > 0 && (
        <>
          <div className="sheet-list">
            {sheets.map((sheet) => {
              const ready = Boolean(sheet.exercise_count)
              return (
                <article className="sheet-card" key={sheet.id}>
                  <h2>
                    <Link to={`/fichas/${sheet.id}`}>{sheet.name}</Link>
                  </h2>
                  <p>
                    {[SHEET_GOALS[sheet.goal], `${sheet.exercise_count} exercícios`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {!ready && <p>Rascunho — adicione um exercício para iniciar.</p>}
                  <div className="sheet-actions">
                    <Button
                      variant="primary"
                      leadingVisual={PlayIcon}
                      disabled={!online || !ready}
                      onClick={() => start(sheet.id)}
                    >
                      Iniciar
                    </Button>
                    <Link to={`/fichas/${sheet.id}`}>Detalhes</Link>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="sheet-actions">
            <Button onClick={startFree}>Treino livre</Button>
          </div>
        </>
      )}
    </section>
  )
}

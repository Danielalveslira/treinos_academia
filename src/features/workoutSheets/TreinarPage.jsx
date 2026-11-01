import { useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Flash, Heading, Spinner } from '@primer/react'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import { sheetError } from './workoutSheetsService.js'
import { originState } from '../../utils/navigation.js'
import { validSheetId, validPlannedDate } from '../../utils/workoutEntry.js'
import { plannedWorkoutNotice } from '../../utils/plannedWorkout.js'
import { businessDayKey } from '../../utils/businessDate.js'
import { buildSheetActivityIndex, recommendSheet } from '../home/recommendSheet.js'
import './workoutSheets.css'

// Validate the complete server scope before enabling execution. Summary counts are not authority.
export default function TreinarPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const requested = params.get('exercicio')
  const exercise = validSheetId(requested) ? requested : null
  const planned = params.get('planejado')
  const notice = plannedWorkoutNotice(planned, businessDayKey())
  const [checking, setChecking] = useState(null)
  const starting = useRef(false)
  const { data, loading, error, refresh, online } = useWorkoutSheets(
    null,
    'picker',
    false,
    0,
    exercise
  )
  const sheets = (data || []).filter((sheet) => !sheet.archived_at)

  const recommendation = useMemo(() => {
    if (!online || !data) return null
    const today = businessDayKey()
    const index = buildSheetActivityIndex(
      data.map((sheet) => ({
        sheetId: sheet.id,
        date: sheet.last_date,
        monthDays: sheet.month_days,
        lastRegisteredAt: sheet.last_registered_at,
      })),
      `${today.slice(0, 7)}-01`
    )
    return recommendSheet(data, index, today)
  }, [data, online])

  function start(sheet) {
    if (starting.current) return
    starting.current = true
    setChecking(sheet.id)
    const search = new URLSearchParams({ ficha: sheet.id })
    if (exercise) search.set('exercicio', exercise)
    if (validPlannedDate(planned)) search.set('planejado', planned)
    // Execution validates the complete scope once. The picker uses the same
    // availability aggregate as Home; it never substitutes this for server auth.
    navigate(`/novo-treino?${search}`, { state: originState(location) })
  }

  return (
    <section className="workout-sheets workout-picker">
      <Button as={Link} to="/app" size="small">
        Voltar ao início
      </Button>
      <header className="sheet-heading">
        <div>
          <span className="eyebrow">SESSÃO DE TREINO</span>
          <Heading as="h1">Treinar</Heading>
        </div>
      </header>
      <p>Escolha uma ficha para começar ou continuar.</p>
      {notice && <p>{notice}</p>}
      {!notice && validPlannedDate(planned) && (
        <p>
          Lembrete de {planned.split('-').reverse().join('/')}. Escolha uma ficha para a sessão
          atual.
        </p>
      )}
      {exercise && (
        <Flash>
          Escolha uma ficha que contenha o exercício solicitado. Para adicioná-lo a uma ficha, abra{' '}
          <Link to="/exercicios">Fichas</Link>.
        </Flash>
      )}
      {!online && (
        <Flash variant="warning">
          Dados salvos neste aparelho — validação pendente. Somente fichas abertas e validadas
          online nos últimos sete dias estão disponíveis. A conclusão exige conexão.
        </Flash>
      )}
      {error && (
        <Flash variant="danger" role="alert">
          {sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando fichas" />}
      {!loading && !error && sheets.length === 0 && (
        <div className="sheet-card">
          <h2>
            {exercise
              ? 'Nenhuma ficha compatível'
              : online
                ? 'Nenhuma ficha ativa'
                : 'Nenhuma ficha salva disponível'}
          </h2>
          <p>
            {online
              ? 'Crie uma ficha e adicione exercícios para começar.'
              : 'Conecte-se e abra uma ficha para salvá-la neste aparelho.'}
          </p>
          <Button
            disabled={!online}
            onClick={() => navigate('/fichas/nova', { state: originState(location) })}
          >
            Criar ficha
          </Button>
        </div>
      )}
      {!loading &&
        !error &&
        online &&
        sheets.length > 0 &&
        !sheets.some((sheet) => sheet.exercise_count > 0 && sheet.available) && (
          <Button onClick={() => navigate('/fichas/nova', { state: originState(location) })}>
            Criar ficha
          </Button>
        )}
      {!loading && !error && (
        <div className="sheet-list">
          {sheets.map((sheet) => {
            const ready = Boolean(sheet.exercise_count) && sheet.available === true
            return (
              <article className="sheet-card" key={sheet.id}>
                {recommendation?.sheet?.id === sheet.id &&
                  recommendation.reason !== 'completed' && (
                    <p>
                      {recommendation.reason === 'scheduled'
                        ? `Próxima data sugerida: ${recommendation.nextDate}`
                        : 'Ficha recomendada'}
                    </p>
                  )}
                <h2>
                  {online ? <Link to={`/fichas/${sheet.id}`}>{sheet.name}</Link> : sheet.name}
                </h2>
                <p>{sheet.exercise_count} exercícios</p>
                <p>
                  {!online
                    ? 'Disponível neste aparelho — validação pendente'
                    : sheet.completed_today
                      ? 'Concluída hoje'
                      : sheet.last_date === businessDayKey()
                        ? 'Em andamento'
                        : 'Não iniciada hoje'}
                </p>
                {!ready && <p>Revise os exercícios desta ficha antes de iniciar.</p>}
                <div className="sheet-actions">
                  <Button
                    variant="primary"
                    disabled={!ready || Boolean(checking)}
                    onClick={() =>
                      sheet.completed_today ? navigate(`/fichas/${sheet.id}`) : start(sheet)
                    }
                  >
                    {checking === sheet.id
                      ? 'Validando…'
                      : sheet.completed_today
                        ? 'Consultar ficha'
                        : sheet.last_date === businessDayKey()
                          ? 'Continuar'
                          : 'Iniciar'}
                  </Button>
                  {online && <Link to={`/fichas/${sheet.id}`}>Detalhes</Link>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

import { useEffect, useReducer, useRef } from 'react'
import { track } from '@vercel/analytics'
import { CheckIcon, ChevronDownIcon, PulseIcon } from '@primer/octicons-react'
import { ExerciseComplete, SetCard } from '../components/SetCard'
import {
  DEMO_SHEET_NAME,
  demoReducer,
  demoTotals,
  initialDemoState,
} from '../features/demo/demoSession.js'
import '../styles/workoutExecution.css'
import '../styles/workoutDemo.css'

export default function WorkoutDemo() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState)
  const firstDone = useRef(false)
  const startedTracked = useRef(false)
  const lastConcludeAt = useRef(0)
  const totals = demoTotals(state)
  useEffect(() => {
    if (!startedTracked.current) {
      startedTracked.current = true
      track('demo_started')
    }
  }, [])

  function conclude(id) {
    const now = Date.now()
    if (now - lastConcludeAt.current < 400) return
    lastConcludeAt.current = now
    dispatch({ type: 'conclude', id })
    if (!firstDone.current) {
      firstDone.current = true
      track('demo_first_set_completed')
    }
  }
  function reset() {
    dispatch({ type: 'reset' })
    firstDone.current = false
    lastConcludeAt.current = 0
    track('demo_started')
  }
  function showSummary() {
    if (!totals.done) return
    dispatch({ type: 'summary' })
    track('demo_workout_finished')
  }

  return (
    <div className="demo-page">
      <div className="demo-layout">
        <aside className="demo-aside">
          <span className="demo-eyebrow">EXPERIMENTE NA PRÁTICA</span>
          <h1>Experimente registrar um treino</h1>
          <p>
            Marque uma série, acompanhe suas cargas e veja como fica seu histórico. Sem cadastro.
          </p>
          <ul>
            <li>
              <CheckIcon size={18} /> Uma série por vez, como no aplicativo
            </li>
            <li>
              <CheckIcon size={18} /> Sugestões do último treino ao seu alcance
            </li>
            <li>
              <CheckIcon size={18} /> Progresso calculado conforme você registra
            </li>
          </ul>
        </aside>
        <div className="demo-phone">
          <div className="demo-screen">
            <div className="demo-intro">
              <h1>Experimente registrar um treino</h1>
              <p>
                Marque uma série, acompanhe suas cargas e veja como fica seu histórico. Sem
                cadastro.
              </p>
            </div>
            <p className="demo-badge">Demonstração · dados fictícios · nada é salvo</p>
            <header className="demo-session-header">
              <div className="demo-session-top">
                <span className="demo-session-icon">
                  <PulseIcon size={20} />
                </span>
                <span>FICHA DE EXEMPLO</span>
              </div>
              <h2>{DEMO_SHEET_NAME}</h2>
              <p className="demo-sheet-goal">
                Objetivo: peito e tríceps · 3 séries por exercício (ajustável)
              </p>
              <div className="demo-progress-copy" aria-live="polite">
                <strong>
                  {totals.done} de {totals.planned} séries concluídas
                </strong>
                <span>{Math.round((totals.done / totals.planned) * 100)}%</span>
              </div>
              <progress
                max={totals.planned}
                value={totals.done}
                aria-label="Progresso da ficha de exemplo"
              />
              {totals.done > 0 && (
                <p className="demo-feedback" role="status">
                  Série concluída nesta demonstração. O progresso mostra só o que você marcou.
                </p>
              )}
            </header>
            {state.summary ? (
              <section className="demo-summary" aria-live="polite">
                <span className="demo-summary-icon">
                  <CheckIcon size={28} />
                </span>
                <h2>Resumo da demonstração</h2>
                <p>{DEMO_SHEET_NAME} · somente o que você registrou agora</p>
                <div className="demo-summary-grid">
                  <div>
                    <span>Exercícios concluídos</span>
                    <strong>
                      {totals.completedExercises} de {totals.plannedExercises}
                    </strong>
                  </div>
                  <div>
                    <span>Séries concluídas</span>
                    <strong>
                      {totals.done} de {totals.planned}
                    </strong>
                  </div>
                  <div>
                    <span>Volume registrado</span>
                    <strong>{totals.volume.toLocaleString('pt-BR')} kg</strong>
                  </div>
                  {totals.comparisonPercent !== null && (
                    <div>
                      <span>Mesmas séries na última sessão fictícia</span>
                      <strong>
                        {totals.comparisonPercent > 0 ? '+' : ''}
                        {totals.comparisonPercent}%
                      </strong>
                    </div>
                  )}
                </div>
                <p className="demo-summary-benefit">
                  No Evolutus, seus próximos treinos usam seu histórico para facilitar o registro.
                </p>
                <div className="demo-summary-cta">
                  <a
                    href="/cadastro"
                    onClick={() => track('demo_signup_clicked')}
                    className="demo-primary-link"
                  >
                    Criar conta e registrar meus treinos
                  </a>
                  <button type="button" onClick={reset}>
                    Repetir demonstração
                  </button>
                  <a href="/">Voltar ao início</a>
                </div>
              </section>
            ) : (
              <>
                {totals.done === 0 && (
                  <p className="demo-context-note">
                    Você não precisa lembrar a carga anterior: veja a sugestão e toque em{' '}
                    <strong>Concluir série</strong> para experimentar.
                  </p>
                )}
                <div className="demo-exercise-list">
                  {state.exercises.map((exercise, exerciseIndex) => {
                    const expanded = state.openId === exercise.id
                    const index = Math.min(state.active[exercise.id] || 0, exercise.sets.length - 1)
                    const doneCount = exercise.sets.filter((set) => set.done).length
                    const finished = doneCount === exercise.sets.length
                    const nextExercise = state.exercises[exerciseIndex + 1]
                    return (
                      <section className="demo-exercise" key={exercise.id}>
                        <button
                          type="button"
                          className="demo-exercise-toggle"
                          aria-expanded={expanded}
                          aria-controls={`demo-panel-${exercise.id}`}
                          onClick={() =>
                            dispatch({ type: 'open', id: expanded ? null : exercise.id })
                          }
                        >
                          <span className="demo-exercise-number">{exerciseIndex + 1}</span>
                          <span className="demo-exercise-heading">
                            <strong>{exercise.name}</strong>
                            <small>
                              {exercise.group} · {doneCount}/{exercise.sets.length} séries
                            </small>
                          </span>
                          <ChevronDownIcon size={18} className={expanded ? 'is-open' : ''} />
                        </button>
                        {expanded && (
                          <div id={`demo-panel-${exercise.id}`} className="demo-exercise-panel">
                            {finished && state.reviewingId !== exercise.id ? (
                              <ExerciseComplete
                                summary={`${doneCount} ${doneCount === 1 ? 'série' : 'séries'} nesta demonstração. Assim você acompanha o que fez sem papel ou planilha.`}
                                onNext={() =>
                                  nextExercise
                                    ? dispatch({ type: 'open', id: nextExercise.id })
                                    : showSummary()
                                }
                                onReview={() => dispatch({ type: 'review', id: exercise.id })}
                                nextLabel={nextExercise ? 'Próximo exercício' : 'Ver resumo'}
                              />
                            ) : (
                              <>
                                <SetCard
                                  sets={exercise.sets}
                                  activeIndex={index}
                                  onSelect={(value) =>
                                    dispatch({ type: 'select', id: exercise.id, index: value })
                                  }
                                  onChange={(field, value) =>
                                    dispatch({ type: 'field', id: exercise.id, field, value })
                                  }
                                  onConclude={() => conclude(exercise.id)}
                                  onCommitEdit={() => dispatch({ type: 'commit', id: exercise.id })}
                                  onToggleDone={() => dispatch({ type: 'undo', id: exercise.id })}
                                  onAdd={() => dispatch({ type: 'add', id: exercise.id })}
                                  onRemove={() => dispatch({ type: 'remove', id: exercise.id })}
                                  canRemove={
                                    exercise.sets.length > 1 &&
                                    (!exercise.sets[index].done || doneCount > 1)
                                  }
                                  onFinishNow={() =>
                                    dispatch({ type: 'finishExercise', id: exercise.id })
                                  }
                                  demoMode
                                  previousSets={exercise.previous.map(([weight, reps]) => ({
                                    weight,
                                    reps,
                                  }))}
                                />
                                <p className="demo-rest-note">
                                  Meta da ficha: 8–12 repetições · descanso previsto: 90 s
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
                {totals.done > 0 && (
                  <div className="demo-exit-actions">
                    <button type="button" onClick={showSummary}>
                      Ver resumo da amostra ({totals.done} {totals.done === 1 ? 'série' : 'séries'})
                    </button>
                    <button type="button" onClick={reset}>
                      Recomeçar
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Flash, Heading, Spinner } from '@primer/react'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import {
  archiveWorkoutSheet,
  duplicateWorkoutSheet,
  reorderWorkoutSheets,
  sheetError,
} from './workoutSheetsService.js'
import { SHEET_GOALS, WEEKDAYS } from './workoutSheetValidation.js'
import './workoutSheets.css'
export default function WorkoutSheetsPage() {
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(0)
  const { data, loading, error, refresh, online } = useWorkoutSheets(null, false, archived, page)
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const requests = useRef(new Map())
  async function action(fn) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    try {
      await fn()
      refresh()
    } catch (err) {
      setMessage(sheetError(err))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const visible = (data || []).filter((s) => Boolean(s.archived_at) === archived)
  async function duplicate(sheet) {
    if (!requests.current.has(sheet.id)) requests.current.set(sheet.id, crypto.randomUUID())
    const result = await duplicateWorkoutSheet(sheet.id, requests.current.get(sheet.id))
    requests.current.delete(sheet.id)
    navigate(`/fichas/${result.id}/editar`)
  }
  function move(id, delta) {
    const ids = visible.map((s) => s.id),
      i = ids.indexOf(id)
    ;[ids[i], ids[i + delta]] = [ids[i + delta], ids[i]]
    return reorderWorkoutSheets(ids)
  }
  return (
    <section className="workout-sheets">
      <header className="sheet-heading">
        <div>
          <span className="eyebrow">SEU PLANEJAMENTO</span>
          <Heading as="h1">Minhas fichas</Heading>
        </div>
        <Button onClick={() => navigate('/fichas/nova')} disabled={!online}>
          Criar ficha
        </Button>
      </header>
      <p>Organize exercícios e metas. Os resultados continuam no histórico de treinos.</p>
      <label className="sheet-check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) =>
            (() => {
              setArchived(e.target.checked)
              setPage(0)
            })()
          }
        />{' '}
        Mostrar arquivadas
      </label>
      {(error || message) && (
        <Flash variant="danger" role="alert">
          {message || sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando fichas" />}
      {!loading && !error && !visible.length && (
        <div className="sheet-card">
          <h2>{archived ? 'Nenhuma ficha arquivada' : 'Sua primeira ficha começa aqui'}</h2>
          <p>
            Crie uma ficha A/B/C ou escolha um nome seu. Você pode salvar um rascunho e adicionar
            exercícios depois.
          </p>
          <Button onClick={() => navigate('/fichas/nova')} disabled={!online}>
            Criar ficha
          </Button>
          <p>
            <Link to="/exercicios?aba=biblioteca">Abrir biblioteca</Link> ·{' '}
            <Link to="/exercicios?aba=catalogo">Catálogo Evolutus</Link>
          </p>
        </div>
      )}
      {archived && (
        <div className="sheet-actions">
          <Button disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
            Página anterior
          </Button>
          <span>Página {page + 1}</span>
          <Button disabled={loading || visible.length < 40} onClick={() => setPage((p) => p + 1)}>
            Próxima página
          </Button>
        </div>
      )}
      <div className="sheet-list">
        {visible.map((sheet, index) => (
          <article className="sheet-card" key={sheet.id}>
            <h2>
              <Link to={`/fichas/${sheet.id}`}>{sheet.name}</Link>
            </h2>
            <p>
              {[
                SHEET_GOALS[sheet.goal],
                `${sheet.exercise_count} exercícios`,
                ...(sheet.muscle_groups || []),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {sheet.weekdays?.length > 0 && (
              <p>{sheet.weekdays.map((day) => WEEKDAYS[day]).join(' · ')}</p>
            )}
            {!sheet.exercise_count && <p>Rascunho — adicione um exercício para iniciar.</p>}
            <div className="sheet-actions">
              <Button as={Link} to={`/fichas/${sheet.id}`}>
                Abrir
              </Button>
              <details>
                <summary>Ações de {sheet.name}</summary>
                <div className="sheet-actions">
                  <Link to={`/fichas/${sheet.id}/editar`}>Editar</Link>
                  <Button disabled={busy || !online} onClick={() => action(() => duplicate(sheet))}>
                    Duplicar
                  </Button>
                  <Button
                    disabled={busy || !online}
                    onClick={() => action(() => archiveWorkoutSheet(sheet, !archived))}
                  >
                    {archived ? 'Restaurar' : 'Arquivar'}
                  </Button>
                  {!archived && (
                    <>
                      <Button
                        aria-label={`Subir ${sheet.name}`}
                        disabled={busy || !online || index === 0}
                        onClick={() => action(() => move(sheet.id, -1))}
                      >
                        Subir
                      </Button>
                      <Button
                        aria-label={`Descer ${sheet.name}`}
                        disabled={busy || !online || index === visible.length - 1}
                        onClick={() => action(() => move(sheet.id, 1))}
                      >
                        Descer
                      </Button>
                    </>
                  )}
                </div>
              </details>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

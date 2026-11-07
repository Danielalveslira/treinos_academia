import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, Checkbox, Flash, Heading, Spinner } from '@primer/react'
import { PlayIcon } from '@primer/octicons-react'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import { originState } from '../../utils/navigation.js'
import {
  archiveWorkoutSheet,
  deleteWorkoutSheet,
  duplicateWorkoutSheet,
  listWorkoutSheets,
  reorderWorkoutSheets,
  sheetError,
} from './workoutSheetsService.js'
import { SHEET_GOALS, WEEKDAYS } from './workoutSheetValidation.js'
import { DeleteSheetDialog } from './DeleteSheetDialog.jsx'
import './workoutSheets.css'
export default function WorkoutSheetsPage() {
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const { data, loading, error, refresh, online } = useWorkoutSheets(null, false, archived, page)
  const navigate = useNavigate()
  const location = useLocation()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
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
  useEffect(() => {
    if (!archived || loading || error || visible.length < 40) {
      setHasNext(false)
      return
    }
    let active = true
    listWorkoutSheets(true, page + 1).then(
      (next) => {
        if (active) setHasNext(next.some((sheet) => Boolean(sheet.archived_at)))
      },
      () => {
        if (active) setHasNext(false)
      }
    )
    return () => {
      active = false
    }
  }, [archived, page, loading, error, visible.length])
  useEffect(() => {
    if (archived && !loading && !error && page > 0 && visible.length === 0)
      setPage((current) => Math.max(0, current - 1))
  }, [archived, loading, error, page, visible.length])
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
  async function confirmDelete() {
    try {
      await deleteWorkoutSheet(deleteTarget)
    } catch (err) {
      // Já foi excluída (ex.: segunda confirmação de um duplo clique): trata como sucesso.
      if (!String(err?.message).includes('SHEET_NOT_FOUND')) return sheetError(err)
    }
    setDeleteTarget(null)
    refresh()
    return ''
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
        <Checkbox
          checked={archived}
          onChange={(event) => {
            setArchived(event.target.checked)
            setPage(0)
            setHasNext(false)
          }}
        />
        Mostrar arquivadas
      </label>
      {(error || message) && (
        <Flash variant="danger" role="alert">
          {message || sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando fichas" />}
      {!loading && !error && archived && !visible.length && page === 0 && (
        <p className="sheet-empty" role="status">
          Nenhuma ficha arquivada.
        </p>
      )}
      {!loading && !error && !archived && !visible.length && (
        <div className="sheet-card">
          <h2>Sua primeira ficha começa aqui</h2>
          <p>
            Crie uma ficha A/B/C ou escolha um nome seu. Você pode salvar um rascunho e adicionar
            exercícios depois — use o botão acima.
          </p>
          <p>
            <Link to="/exercicios?aba=biblioteca">Abrir biblioteca</Link> ·{' '}
            <Link to="/exercicios?aba=catalogo">Catálogo Evolutus</Link>
          </p>
        </div>
      )}
      {archived && !loading && !error && visible.length > 0 && (page > 0 || hasNext) && (
        <nav className="sheet-pagination" aria-label="Páginas de fichas arquivadas">
          <Button disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
            Página anterior
          </Button>
          <span aria-current="page">Página {page + 1}</span>
          <Button disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            Próxima página
          </Button>
        </nav>
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
              {!archived && sheet.exercise_count > 0 && (
                <Button
                  variant="primary"
                  leadingVisual={PlayIcon}
                  disabled={!online}
                  onClick={() =>
                    navigate(`/novo-treino?ficha=${sheet.id}`, { state: originState(location) })
                  }
                >
                  Iniciar
                </Button>
              )}
              <Button as={Link} to={`/fichas/${sheet.id}`}>
                {!archived && sheet.exercise_count > 0 ? 'Detalhes' : 'Abrir'}
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
                  <Button
                    variant="danger"
                    disabled={busy || !online}
                    onClick={() => setDeleteTarget(sheet)}
                  >
                    Excluir definitivamente
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
      {deleteTarget && (
        <DeleteSheetDialog
          sheet={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  )
}

import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Flash, Heading, Spinner } from '@primer/react'
import { useOnlineStatus as useOnline } from '../../hooks/useOnlineStatus'
import { useAuth } from '../../hooks/useAuth'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import { getWorkoutSheet, saveWorkoutSheet, sheetError } from './workoutSheetsService.js'
import {
  EMPTY_SHEET,
  prescription,
  SHEET_GOALS,
  WEEKDAYS,
  sheetFingerprint,
  validateSheet,
} from './workoutSheetValidation.js'
import { WorkoutSheetExercisePicker } from './WorkoutSheetExercisePicker'
import { useSheetDiscardGuard } from './useSheetDiscardGuard.js'
import './workoutSheets.css'
const fields = [
  ['target_sets', 'Séries-alvo', 1, 10],
  ['reps_min', 'Repetições mínimas', 1, 1000],
  ['reps_max', 'Repetições máximas', 1, 1000],
  ['rest_seconds', 'Descanso (segundos)', 0, 900],
  ['target_duration_minutes', 'Duração (minutos)', 1, 1440],
  ['target_distance_km', 'Distância (km)', 0.001, 1000],
]
function Editor({ initial, online }) {
  const [sheet, setSheet] = useState(initial)
  const [baseline, setBaseline] = useState(() => sheetFingerprint(initial))
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [server, setServer] = useState(null)
  const requestId = useRef(null),
    lock = useRef(false)
  const navigate = useNavigate()
  const dirty = sheetFingerprint(sheet) !== baseline
  const permitNavigation = useSheetDiscardGuard(dirty)
  const change = (key, value) => setSheet((s) => ({ ...s, [key]: value }))
  function patchItem(index, key, value) {
    setSheet((s) => ({
      ...s,
      items: s.items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }))
  }
  function move(index, delta) {
    setSheet((s) => {
      const items = [...s.items]
      ;[items[index], items[index + delta]] = [items[index + delta], items[index]]
      return { ...s, items }
    })
  }
  async function save(event) {
    event.preventDefault()
    if (lock.current || !dirty || !online || server) return
    const invalid = validateSheet(sheet)
    if (invalid) {
      setMessage(invalid)
      return
    }
    lock.current = true
    setBusy(true)
    setMessage('')
    requestId.current ||= crypto.randomUUID()
    try {
      const result = await saveWorkoutSheet(sheet, requestId.current)
      setBaseline(sheetFingerprint(sheet))
      permitNavigation()
      navigate(`/fichas/${result.id}`, { replace: true })
    } catch (error) {
      setMessage(sheetError(error))
      if (String(error.message).includes('SHEET_VERSION_CONFLICT')) {
        try {
          setServer(await getWorkoutSheet(sheet.id))
        } catch {
          /* Original edits remain visible. */
        }
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function cancel() {
    if (!dirty || window.confirm('Descartar as alterações não salvas desta ficha?')) {
      permitNavigation()
      navigate(initial.id ? `/fichas/${initial.id}` : '/exercicios')
    }
  }
  function acceptServer() {
    setSheet(server)
    setBaseline(sheetFingerprint(server))
    setServer(null)
    setMessage('')
  }
  function keepMine() {
    setSheet((s) => ({ ...s, revision: server.revision }))
    setBaseline(sheetFingerprint(server))
    setServer(null)
    setMessage('Versão atual carregada para comparação. Revise sua edição e salve novamente.')
  }
  return (
    <section className="workout-sheets">
      <Button onClick={cancel}>Voltar</Button>
      <Heading as="h1">{initial.id ? 'Editar ficha' : 'Criar ficha'}</Heading>
      {!online && (
        <Flash variant="warning">
          Fichas exigem conexão. Sua edição permanece nesta tela; reconecte para salvar.
        </Flash>
      )}
      {message && (
        <Flash role="alert" variant="warning">
          {message}
        </Flash>
      )}
      {server && (
        <section className="sheet-card" aria-label="Conflito de versões">
          <h2>Versão atual no servidor</h2>
          <p>
            {server.name} · revisão {server.revision}
          </p>
          <p>{server.goal_description}</p>
          <ol>
            {server.items.map((i) => (
              <li key={i.id}>
                {i.exercise.name}: {prescription(i)}
              </li>
            ))}
          </ol>
          <Button onClick={acceptServer}>Usar versão do servidor</Button>
          <Button onClick={keepMine}>Manter minha edição para revisão</Button>
        </section>
      )}
      <form onSubmit={save}>
        <fieldset disabled={busy || !online}>
          <legend>Identificação</legend>
          <label className="sheet-field">
            Nome obrigatório
            <input
              required
              maxLength={80}
              value={sheet.name}
              onChange={(e) => change('name', e.target.value)}
            />
          </label>
          <label className="sheet-field">
            Objetivo opcional
            <select value={sheet.goal || ''} onChange={(e) => change('goal', e.target.value)}>
              <option value="">Sem objetivo</option>
              {Object.entries(SHEET_GOALS).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="sheet-field">
            {sheet.goal === 'other' ? 'Descreva seu objetivo' : 'Descrição opcional'}
            <textarea
              maxLength={500}
              value={sheet.goal_description}
              onChange={(e) => change('goal_description', e.target.value)}
            />
          </label>
          <fieldset>
            <legend>Dias sugeridos (sem lembretes)</legend>
            <div className="sheet-actions">
              {WEEKDAYS.map((day, i) => (
                <label className="sheet-check" key={day}>
                  <input
                    type="checkbox"
                    checked={sheet.weekdays.includes(i)}
                    onChange={(e) =>
                      change(
                        'weekdays',
                        e.target.checked
                          ? [...sheet.weekdays, i]
                          : sheet.weekdays.filter((d) => d !== i)
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        <WorkoutSheetExercisePicker
          items={sheet.items}
          disabled={busy || !online || sheet.items.length >= 40}
          onAdd={(exercise) =>
            setSheet((s) =>
              s.items.some((i) => i.exercise_id === exercise.id) || s.items.length >= 40
                ? s
                : {
                    ...s,
                    items: [...s.items, { exercise_id: exercise.id, exercise, available: true }],
                  }
            )
          }
        />
        <h2>Metas opcionais</h2>
        <p>Referências para o treino; nenhuma série será registrada ao salvar ou iniciar.</p>
        {!sheet.items.length && (
          <p>Rascunho sem exercícios. Você pode salvar e continuar depois.</p>
        )}
        <ol className="sheet-list">
          {sheet.items.map((item, index) => (
            <li key={item.exercise_id} className="sheet-card">
              <h3>
                {index + 1}. {item.exercise?.name || 'Exercício indisponível'}
              </h3>
              {item.available === false && (
                <Flash variant="warning">
                  Indisponível: substitua antes de iniciar novos treinos.
                </Flash>
              )}
              <div className="sheet-actions">
                <Button
                  disabled={busy || !online || index === 0}
                  aria-label={`Subir ${item.exercise?.name}`}
                  onClick={() => move(index, -1)}
                >
                  Subir
                </Button>
                <Button
                  disabled={busy || !online || index === sheet.items.length - 1}
                  aria-label={`Descer ${item.exercise?.name}`}
                  onClick={() => move(index, 1)}
                >
                  Descer
                </Button>
                <Button
                  disabled={busy || !online}
                  onClick={() =>
                    change(
                      'items',
                      sheet.items.filter((_, i) => i !== index)
                    )
                  }
                >
                  Remover da ficha
                </Button>
              </div>
              <details>
                <summary>Editar metas de {item.exercise?.name}</summary>
                <fieldset disabled={busy || !online}>
                  <legend className="sr-only">Metas de {item.exercise?.name}</legend>
                  {fields
                    .filter(([key]) =>
                      item.exercise?.type === 'cardio'
                        ? !['target_sets', 'reps_min', 'reps_max'].includes(key)
                        : !key.startsWith('target_d')
                    )
                    .map(([key, label, min, max]) => (
                      <label className="sheet-field" key={key}>
                        {label}
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step={key === 'target_distance_km' ? '0.001' : 1}
                          value={item[key] ?? ''}
                          onChange={(e) => patchItem(index, key, e.target.value)}
                        />
                      </label>
                    ))}
                  <label className="sheet-field">
                    Observação pessoal
                    <textarea
                      maxLength={300}
                      value={item.note || ''}
                      onChange={(e) => patchItem(index, 'note', e.target.value)}
                    />
                  </label>
                </fieldset>
              </details>
            </li>
          ))}
        </ol>
        <div className="sheet-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={!dirty || busy || !online || Boolean(server)}
          >
            {busy ? 'Salvando…' : 'Salvar ficha'}
          </Button>
          <Button disabled={busy || !online} onClick={cancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  )
}
export default function WorkoutSheetEditorPage() {
  const { id } = useParams()
  const { user } = useAuth()
  // A new sheet does not need a list round-trip; the hook is mounted only for existing sheets.
  return id ? <ExistingEditor key={`${user.uid}:${id}`} id={id} /> : <NewEditor key={user.uid} />
}
function NewEditor() {
  const { offlineLocal } = useAuth()
  const online = useOnline()
  return <Editor initial={EMPTY_SHEET} online={online && !offlineLocal} />
}
function ExistingEditor({ id }) {
  const { data, loading, error, refresh, online } = useWorkoutSheets(id)
  const initial = useRef(null)
  if (!initial.current && data) initial.current = data
  if (initial.current) return <Editor initial={initial.current} online={online} />
  if (loading) return <Spinner aria-label="Carregando editor" />
  return (
    <section className="workout-sheets">
      <Link to="/exercicios">Voltar</Link>
      <Flash role="alert" variant="danger">
        {sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
      </Flash>
    </section>
  )
}

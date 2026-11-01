import { useEffect, useRef, useState } from 'react'
import { Button } from '@primer/react'
import {
  AlertIcon,
  CheckCircleFillIcon,
  CheckIcon,
  ClockIcon,
  SyncIcon,
  TrashIcon,
} from '@primer/octicons-react'
import { isValidSet, MAX_WORKOUT_SETS } from '../utils/workoutSets'
import { parseSetInput } from '../utils/setSuggestions'
import { aggregateSyncStatus, isSetDirty, setSourceLabel } from '../utils/setSession'

const STATUS_TEXT = {
  saved: 'Salvo',
  saving: 'Salvando…',
  local: 'Salvo no aparelho · sincroniza ao conectar',
  error: 'Não foi possível salvar',
}

const STATUS_ICON = {
  saved: CheckIcon,
  saving: SyncIcon,
  local: ClockIcon,
  error: AlertIcon,
}

// Texto do aviso de falha: sem rede é outra mensagem (a causa não está no registro).
function saveErrorText() {
  return globalThis.navigator?.onLine === false
    ? 'Sem conexão. Série não salva ainda.'
    : 'Não foi possível salvar.'
}

function NumberControl({ field, value, disabled, placeholder, onChange, demoMode = false }) {
  const weight = field === 'weight'
  const step = weight ? 2.5 : 1
  const adjust = (direction) => {
    const current = Number(String(value).replace(',', '.')) || 0
    onChange(String(Math.max(0, current + direction * step)))
  }
  return (
    <div className="set-card-field">
      <label className="set-card-field-label" htmlFor={`set-${field}`}>
        {weight ? 'Peso (kg)' : 'Repetições'}
      </label>
      <div className="set-card-input-wrap">
        {demoMode && (
          <button
            type="button"
            className="set-card-adjust"
            aria-label={`Diminuir ${weight ? 'carga' : 'repetições'}`}
            disabled={disabled}
            onClick={() => adjust(-1)}
          >
            −
          </button>
        )}
        <input
          id={`set-${field}`}
          className="set-card-value"
          type="text"
          inputMode={weight ? 'decimal' : 'numeric'}
          enterKeyHint="done"
          autoComplete="off"
          value={String(value).replace('.', ',')}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => {
            const parsed = parseSetInput(field, event.target.value)
            if (parsed !== null) onChange(parsed)
          }}
        />
        {demoMode && (
          <button
            type="button"
            className="set-card-adjust"
            aria-label={`Aumentar ${weight ? 'carga' : 'repetições'}`}
            disabled={disabled}
            onClick={() => adjust(1)}
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}

export function SaveStatus({ status, onRetry }) {
  if (!status) return null
  const Icon = STATUS_ICON[status]
  return (
    <span className={`save-status is-${status}`} role={status === 'error' ? 'alert' : 'status'}>
      <Icon size={14} />
      {status === 'error' ? saveErrorText() : STATUS_TEXT[status]}
      {status === 'error' && onRetry && (
        <button type="button" className="save-status-retry" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </span>
  )
}

// Um card, uma série por vez. `mode="session"` (registro ao vivo): o botão principal conclui a série e
// o card avança sozinho. `mode="edit"` (corrigir um registro existente): sem botão de concluir — o
// formulário salva tudo de uma vez.
export function SetCard({
  mode = 'session',
  sets,
  activeIndex,
  syncStatuses = [],
  rowStatus = 'idle',
  onSelect,
  onChange,
  onConclude,
  onCommitEdit,
  onAdd,
  onRemove,
  canRemove,
  onFinishNow,
  onRetry,
  disabled,
  demoMode = false,
  previousSets = [],
  onToggleDone,
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const timer = useRef(null)
  const activeSet = sets[activeIndex]
  useEffect(() => {
    setConfirmingRemove(false)
    clearTimeout(timer.current)
  }, [activeSet?.key])
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!activeSet) return null

  const editing = mode === 'edit'
  const doneCount = sets.filter((set) => set.done).length
  const pendingIndex = sets.findIndex((set, index) => !set.done && index !== activeIndex)
  const dirty = isSetDirty(activeSet)
  const valid = isValidSet(activeSet)
  // Um indicador só para o exercício todo: o estado pior entre as séries concluídas.
  const saveStatus = rowStatus === 'error' ? 'error' : aggregateSyncStatus(syncStatuses)
  const sourceLabel = setSourceLabel(activeSet)
  const empty = activeSet.source === 'empty' && !activeSet.done
  const pendingCount = sets.length - doneCount

  let primary = null
  if (!editing) {
    if (!activeSet.done) {
      primary = (
        <button
          type="button"
          className="set-card-complete"
          disabled={disabled || !valid}
          onClick={onConclude}
        >
          <CheckIcon size={22} />
          Concluir série
        </button>
      )
    } else if (dirty) {
      primary = (
        <button
          type="button"
          className="set-card-complete"
          disabled={disabled || !valid}
          onClick={onCommitEdit}
        >
          <CheckIcon size={22} />
          Atualizar série
        </button>
      )
    } else if (pendingIndex !== -1) {
      primary = (
        <button
          type="button"
          className="set-card-complete is-secondary"
          disabled={disabled}
          onClick={() => onSelect(pendingIndex)}
        >
          Ir para a série {pendingIndex + 1}
        </button>
      )
    } else if (demoMode && onToggleDone) {
      primary = (
        <button
          type="button"
          className="set-card-complete is-secondary"
          disabled={disabled}
          onClick={onToggleDone}
        >
          Desmarcar série
        </button>
      )
    }
  }

  return (
    <div className="set-card">
      <div className="set-card-header" aria-live="polite">
        <div className="set-card-title-row">
          <strong>
            Série {activeIndex + 1} de {sets.length}
          </strong>
          {!editing && (
            <SaveStatus
              status={saveStatus}
              onRetry={saveStatus === 'error' ? onRetry : undefined}
            />
          )}
        </div>
        {(sourceLabel || dirty || (activeSet.done && !editing)) && (
          <div className="set-card-tags">
            {sourceLabel && (
              <span className="set-card-source">
                {demoMode && activeSet.source === 'history'
                  ? 'Sugerido do último treino (exemplo)'
                  : sourceLabel}
              </span>
            )}
            {activeSet.done && !dirty && !editing && (
              <span className="set-card-source is-done">
                <CheckCircleFillIcon size={12} />{' '}
                {demoMode ? 'Concluída na demonstração' : 'Registrada'}
              </span>
            )}
            {dirty && <span className="set-card-source is-dirty">Alterada · confirme abaixo</span>}
          </div>
        )}
      </div>

      <ol className="set-card-progress" aria-label="Séries do exercício">
        {sets.map((set, index) => {
          const status = syncStatuses[index]
          const Icon = status && status !== 'saved' ? STATUS_ICON[status] : CheckIcon
          return (
            <li key={set.key}>
              <button
                type="button"
                className={`set-card-segment${set.done ? ' is-complete' : ''}${
                  index === activeIndex ? ' is-active' : ''
                }${status ? ` is-${status}` : ''}`}
                aria-current={index === activeIndex ? 'step' : undefined}
                aria-label={`Série ${index + 1}${set.done ? ', concluída' : ', pendente'}`}
                disabled={disabled}
                onClick={() => onSelect(index)}
              >
                {set.done ? <Icon size={14} /> : index + 1}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="set-card-fields" key={activeSet.key}>
        <NumberControl
          field="weight"
          value={activeSet.weight}
          placeholder="Ex.: 20"
          disabled={disabled}
          onChange={(value) => onChange('weight', value)}
          demoMode={demoMode}
        />
        <NumberControl
          field="reps"
          value={activeSet.reps}
          placeholder="Ex.: 10"
          disabled={disabled}
          onChange={(value) => onChange('reps', value)}
          demoMode={demoMode}
        />
      </div>
      {demoMode && previousSets[activeSet.historyIndex] && (
        <p className="set-card-previous">
          Última vez: {Number(previousSets[activeSet.historyIndex].weight).toLocaleString('pt-BR')}{' '}
          kg × {previousSets[activeSet.historyIndex].reps} · Meta: 8–12 repetições
        </p>
      )}
      {empty && (
        <p className="set-card-hint">Primeira vez? Informe peso e repetições. Sem carga, use 0.</p>
      )}

      {primary}
      {demoMode && activeSet.done && onToggleDone && (dirty || pendingIndex !== -1) && (
        <button type="button" className="set-card-link" disabled={disabled} onClick={onToggleDone}>
          Desmarcar série
        </button>
      )}
      {!editing && doneCount > 0 && pendingCount > 0 && !activeSet.done && (
        <button type="button" className="set-card-link" disabled={disabled} onClick={onFinishNow}>
          Finalizar com {doneCount} {doneCount === 1 ? 'série' : 'séries'}
        </button>
      )}

      <div className="set-card-quick-actions">
        <Button
          type="button"
          size="small"
          disabled={disabled || sets.length >= MAX_WORKOUT_SETS}
          onClick={onAdd}
        >
          + Adicionar série
        </Button>
        <Button
          type="button"
          size="small"
          variant={confirmingRemove ? 'danger' : 'default'}
          leadingVisual={TrashIcon}
          disabled={disabled || !canRemove}
          onClick={() => {
            if (confirmingRemove) {
              onRemove()
              setConfirmingRemove(false)
              return
            }
            setConfirmingRemove(true)
            timer.current = setTimeout(() => setConfirmingRemove(false), 2500)
          }}
        >
          {confirmingRemove ? 'Toque para confirmar' : `Remover série ${activeIndex + 1}`}
        </Button>
      </div>
    </div>
  )
}

// Estado de conclusão discreto: aparece sozinho quando a última série é concluída. Não avança para
// outro exercício — quem decide é o usuário.
export function ExerciseComplete({ summary, syncStatus, onRetry, onNext, onReview, nextLabel }) {
  return (
    <section className="exercise-complete" aria-live="polite">
      <span className="exercise-complete-mark" aria-hidden="true">
        <CheckIcon size={24} />
      </span>
      <div>
        <h3>
          {syncStatus === 'error'
            ? 'Registro não salvo'
            : syncStatus === 'saving'
              ? 'Salvando exercício'
              : syncStatus === 'local'
                ? 'Concluído no aparelho'
                : 'Exercício concluído'}
        </h3>
        <p>{summary}</p>
        <SaveStatus status={syncStatus} onRetry={onRetry} />
      </div>
      <div className="exercise-complete-actions">
        <button type="button" className="set-card-complete" onClick={onNext}>
          {nextLabel}
        </button>
        <button type="button" className="exercise-complete-review" onClick={onReview}>
          Revisar séries
        </button>
      </div>
    </section>
  )
}

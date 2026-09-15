import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon } from '@primer/octicons-react'
import { isValidSet } from '../utils/workoutSets'
import { parseSetInput } from '../utils/setSuggestions'

function NumberControl({ field, value, disabled, onChange }) {
  const weight = field === 'weight'
  const label = weight ? 'Peso (kg)' : 'Repetições'
  return (
    <div className="set-card-field">
      <label className="set-card-field-label" htmlFor={`set-${field}`}>
        {label}
      </label>
      <div className={`set-card-input-wrap${weight ? ' has-unit' : ''}`}>
        <input
          id={`set-${field}`}
          className="set-card-value"
          style={String(value).length > 4 ? { fontSize: 'clamp(20px, 3vw, 32px)' } : undefined}
          type="text"
          inputMode={weight ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={String(value).replace('.', ',')}
          placeholder="0"
          disabled={disabled}
          aria-describedby={`set-${field}-hint`}
          onChange={(event) => {
            const parsed = parseSetInput(field, event.target.value)
            if (parsed !== null) onChange(parsed)
          }}
        />
        {weight && <span className="set-card-unit">kg</span>}
      </div>
      <small id={`set-${field}-hint`}>Toque no valor para digitar</small>
    </div>
  )
}

export function SetCard({
  sets,
  activeIndex,
  onNavigate,
  onUpdate,
  onToggleComplete,
  onAdd,
  onRemove,
  validSetCount,
  volume,
  disabled,
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
  const isLast = activeIndex === sets.length - 1
  return (
    <div className="set-card">
      <div className="set-card-header">
        <div className="set-card-header-text" aria-live="polite">
          <span>
            Série {activeIndex + 1} de {sets.length}
          </span>
          <span>
            {activeSet.completed
              ? 'Série concluída — valores registrados'
              : activeSet.source === 'history'
                ? 'Valores sugeridos com base no último treino'
                : activeSet.source === 'inherited'
                  ? 'Valores herdados da série anterior'
                  : 'Confirme ou ajuste os valores da série'}
          </span>
        </div>
        <div className="set-card-navigation">
          <button
            type="button"
            className="set-card-nav"
            aria-label="Série anterior"
            disabled={disabled || activeIndex === 0}
            onClick={() => onNavigate(activeIndex - 1)}
          >
            <ChevronLeftIcon size={20} />
          </button>
          <button
            type="button"
            className="set-card-nav"
            aria-label={isLast ? 'Adicionar nova série' : 'Próxima série'}
            disabled={disabled || (isLast && !onAdd)}
            onClick={() => (isLast ? onAdd?.() : onNavigate(activeIndex + 1))}
          >
            <ChevronRightIcon size={20} />
          </button>
          <button
            type="button"
            className={`set-card-remove${confirmingRemove ? ' is-confirming' : ''}`}
            aria-label={`${confirmingRemove ? 'Confirmar remoção da' : 'Remover'} série ${activeIndex + 1}`}
            disabled={disabled || sets.length === 1}
            onClick={() => {
              if (confirmingRemove) {
                onRemove(activeSet.key)
                setConfirmingRemove(false)
                return
              }
              setConfirmingRemove(true)
              timer.current = setTimeout(() => setConfirmingRemove(false), 2000)
            }}
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>
      <div className="set-card-progress" aria-label="Navegar entre séries">
        {sets.map((set, index) => (
          <button
            key={set.key}
            type="button"
            className={`set-card-segment${set.completed ? ' is-complete' : ''}${index === activeIndex ? ' is-active' : ''}`}
            aria-current={index === activeIndex ? 'true' : undefined}
            aria-label={`Série ${index + 1}${set.completed ? ', concluída' : ''}`}
            disabled={disabled}
            onClick={() => onNavigate(index)}
          >
            {set.completed ? <CheckIcon size={14} /> : index + 1}
          </button>
        ))}
        <span aria-live="polite">{sets.filter((set) => set.completed).length} concluídas</span>
      </div>
      <div className="set-card-fields">
        {['weight', 'reps'].map((field) => (
          <NumberControl
            key={field}
            field={field}
            value={activeSet[field]}
            disabled={disabled}
            onChange={(value) => onUpdate(activeSet.key, field, value)}
          />
        ))}
      </div>
      <button
        type="button"
        className={`set-card-complete${activeSet.completed ? ' is-complete' : ''}`}
        disabled={disabled || !isValidSet(activeSet)}
        aria-pressed={activeSet.completed}
        onClick={() => onToggleComplete(activeSet.key)}
      >
        <CheckIcon size={24} />
        {activeSet.completed ? 'Série concluída · Reabrir' : 'Concluir série'}
      </button>
      <p className="set-card-inheritance">
        A próxima série usa seu histórico ou herda estes valores. Edições são mantidas.
      </p>
      <div className="session-summary" aria-live="polite">
        <div>
          <span>Séries válidas</span>
          <strong>{validSetCount}</strong>
        </div>
        <div>
          <span>Volume estimado</span>
          <strong>{volume == null ? '—' : `${volume.toLocaleString('pt-BR')} kg`}</strong>
        </div>
      </div>
    </div>
  )
}

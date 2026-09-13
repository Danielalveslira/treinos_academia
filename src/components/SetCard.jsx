import { useEffect, useRef, useState } from 'react'
import {
  PlusIcon,
  DashIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TrashIcon,
} from '@primer/octicons-react'
import { getWorkoutSets, isValidSet } from '../utils/workoutSets'

// Quanto tempo o ícone de "Remover série" fica em estado de confirmação depois do
// primeiro toque, antes de voltar ao normal -- ver handleRemoveClick. Sem dialog (ação
// de baixo risco, só mexe em campos ainda não salvos), mas dois toques evitam remover
// por engano com um único tap acidental.
const REMOVE_CONFIRM_MS = 2000

// Mesmos limites de isValidSet (workoutSets.js) -- não revalida nada aqui, só trava o
// stepper pra nunca produzir um valor que o próprio isValidSet recusaria depois.
const MIN_WEIGHT = 0
const MAX_WEIGHT = 10000
const MIN_REPS = 1
const MAX_REPS = 100000

const WEIGHT_GRANULARITIES = [1.25, 2.5, 5]
const DEFAULT_GRANULARITY = 2.5

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// Duas casas basta pra qualquer granularidade oferecida (1.25/2.5/5) -- evita que somas
// repetidas de incrementos fracionários acumulem ruído de ponto flutuante (ex.: 0.1 + 0.2).
function round2(value) {
  return Math.round(value * 100) / 100
}

function formatKg(value) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// Uma série por vez, navegável por abas/segmentos ou setas laterais -- ver o pedido de
// redesenho da etapa "Séries" do WorkoutForm.jsx. `sets` já vem com `completed` (bool)
// projetado por WorkoutForm a partir do seu próprio estado `completed` (Set de keys);
// este componente não guarda nenhum estado de progresso, só a granularidade do peso
// (preferência de UI, não faz parte do treino em si).
export function SetCard({
  sets,
  activeIndex,
  onNavigate,
  onUpdate,
  onToggleComplete,
  onAdd,
  onRemove,
  lastWorkout,
  bestLoad,
  disabled,
}) {
  const [granularity, setGranularity] = useState(DEFAULT_GRANULARITY)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const removeTimeoutRef = useRef(null)

  // Trocar de série cancela uma confirmação de remoção pendente da série anterior --
  // "toque de novo pra confirmar" só deve valer para a MESMA série que o usuário
  // acabou de tocar, nunca para a que ele navegar em seguida.
  useEffect(() => {
    setConfirmingRemove(false)
  }, [activeIndex])

  useEffect(() => () => clearTimeout(removeTimeoutRef.current), [])

  const activeSet = sets[activeIndex]
  if (!activeSet) return null

  const completedCount = sets.filter((set) => set.completed).length
  const isFirst = activeIndex === 0
  const isLast = activeIndex === sets.length - 1
  const canAdd = Boolean(onAdd)
  const canRemove = sets.length > 1
  const weightValue = Number(activeSet.weight) || 0
  const repsValue = Number(activeSet.reps) || 0
  const validSet = isValidSet(activeSet)

  function handleRemoveClick() {
    if (!confirmingRemove) {
      setConfirmingRemove(true)
      removeTimeoutRef.current = setTimeout(() => setConfirmingRemove(false), REMOVE_CONFIRM_MS)
      return
    }
    clearTimeout(removeTimeoutRef.current)
    setConfirmingRemove(false)
    onRemove(activeSet.key)
  }

  function stepWeight(delta) {
    onUpdate(activeSet.key, 'weight', clamp(round2(weightValue + delta), MIN_WEIGHT, MAX_WEIGHT))
  }

  function stepReps(delta) {
    onUpdate(activeSet.key, 'reps', clamp(repsValue + delta, MIN_REPS, MAX_REPS))
  }

  function goNext() {
    if (isLast) {
      if (canAdd) onAdd()
      return
    }
    onNavigate(activeIndex + 1)
  }

  return (
    <div className="set-card">
      <div className="set-card-header">
        <div className="set-card-header-text">
          <span>
            Série {activeIndex + 1} de {sets.length}
          </span>
          <span>
            {completedCount} concluída{completedCount === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          className={`set-card-remove${confirmingRemove ? ' is-confirming' : ''}`}
          aria-label={
            confirmingRemove
              ? `Confirmar remoção da série ${activeIndex + 1}`
              : `Remover série ${activeIndex + 1}`
          }
          disabled={disabled || !canRemove}
          onClick={handleRemoveClick}
        >
          <TrashIcon size={16} />
        </button>
      </div>

      <div className="set-card-progress">
        {sets.map((set, index) => (
          <button
            key={set.key}
            type="button"
            className={`set-card-segment${set.completed ? ' is-complete' : ''}${
              index === activeIndex ? ' is-active' : ''
            }`}
            aria-current={index === activeIndex ? 'true' : undefined}
            aria-label={`Série ${index + 1}${set.completed ? ', concluída' : ''}`}
            onClick={() => onNavigate(index)}
          />
        ))}
        <button
          type="button"
          className="set-card-segment set-card-segment-add"
          aria-label="Adicionar nova série"
          disabled={!canAdd}
          onClick={() => canAdd && onAdd()}
        >
          <PlusIcon size={12} />
        </button>
      </div>

      <div className="set-card-body">
        <button
          type="button"
          className="set-card-nav"
          aria-label="Série anterior"
          disabled={disabled || isFirst}
          onClick={() => onNavigate(activeIndex - 1)}
        >
          <ChevronLeftIcon size={18} />
        </button>

        <div className="set-card-fields">
          <div className="set-card-field">
            <span className="set-card-field-label">Peso (kg)</span>
            <div className="set-card-stepper">
              <button
                type="button"
                className="set-card-step"
                aria-label={`Diminuir peso em ${formatKg(granularity)} kg`}
                disabled={disabled || weightValue <= MIN_WEIGHT}
                onClick={() => stepWeight(-granularity)}
              >
                <DashIcon size={16} />
              </button>
              <span className="set-card-value">{formatKg(weightValue)}</span>
              <button
                type="button"
                className="set-card-step"
                aria-label={`Aumentar peso em ${formatKg(granularity)} kg`}
                disabled={disabled || weightValue >= MAX_WEIGHT}
                onClick={() => stepWeight(granularity)}
              >
                <PlusIcon size={16} />
              </button>
            </div>
            <div className="set-card-chips">
              {WEIGHT_GRANULARITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`set-card-chip${value === granularity ? ' is-active' : ''}`}
                  aria-pressed={value === granularity}
                  disabled={disabled}
                  onClick={() => setGranularity(value)}
                >
                  ±{formatKg(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="set-card-divider" />

          <div className="set-card-field">
            <span className="set-card-field-label">Repetições</span>
            <div className="set-card-stepper">
              <button
                type="button"
                className="set-card-step"
                aria-label="Diminuir repetições"
                disabled={disabled || repsValue <= MIN_REPS}
                onClick={() => stepReps(-1)}
              >
                <DashIcon size={16} />
              </button>
              <span className="set-card-value">{repsValue.toLocaleString('pt-BR')}</span>
              <button
                type="button"
                className="set-card-step"
                aria-label="Aumentar repetições"
                disabled={disabled || repsValue >= MAX_REPS}
                onClick={() => stepReps(1)}
              >
                <PlusIcon size={16} />
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="set-card-nav"
          aria-label={isLast ? 'Adicionar nova série' : 'Próxima série'}
          disabled={disabled || (isLast && !canAdd)}
          onClick={goNext}
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>

      <button
        type="button"
        className={`set-card-complete${activeSet.completed ? ' is-complete' : ''}`}
        disabled={disabled || !validSet}
        aria-pressed={activeSet.completed}
        onClick={() => onToggleComplete(activeSet.key)}
      >
        <CheckIcon size={18} />
        {activeSet.completed ? 'série concluída' : 'concluir série'}
      </button>

      {(lastWorkout || bestLoad != null) && (
        <p className="set-card-footer">
          {lastWorkout &&
            `última vez: ${getWorkoutSets(lastWorkout)
              .map((set) => `${set.weight}kg × ${set.reps}`)
              .join(' · ')}`}
          {lastWorkout && bestLoad != null && ' · '}
          {bestLoad != null && `melhor: ${formatKg(bestLoad)}kg`}
        </p>
      )}
    </div>
  )
}

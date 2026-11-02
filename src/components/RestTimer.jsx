import { useEffect, useState } from 'react'
import { Button } from '@primer/react'
import { CheckIcon, ClockIcon } from '@primer/octicons-react'
import {
  formatRestClock,
  formatRestDuration,
  remainingSeconds,
  restProgress,
} from '../utils/restTimer.js'
import '../styles/restTimer.css'

// Relógio local do componente: só ele re-renderiza a cada segundo (a ficha não). Para sozinho quando a
// contagem termina e recalcula na hora quando a aba volta a ficar visível.
function useRestClock(endsAt) {
  const [now, setNow] = useState(Date.now)
  const running = now < endsAt
  useEffect(() => {
    if (!running) return undefined
    const tick = () => {
      if (!globalThis.document?.hidden) setNow(Date.now())
    }
    tick()
    const interval = setInterval(tick, 1000)
    globalThis.document?.addEventListener?.('visibilitychange', tick)
    return () => {
      clearInterval(interval)
      globalThis.document?.removeEventListener?.('visibilitychange', tick)
    }
  }, [endsAt, running])
  return now
}

// Indicador de descanso. `compact`: o descanso é de outro exercício — uma linha só, com o nome dele.
export function RestTimer({ rest, exerciseName, compact = false, onExtend, onSkip }) {
  const now = useRestClock(rest.endsAt)
  const remaining = remainingSeconds(rest, now)
  const done = remaining === 0
  const progress = restProgress(rest, now)

  return (
    <section
      className={`rest-timer${compact ? ' is-compact' : ''}${done ? ' is-done' : ''}`}
      aria-label={compact && exerciseName ? `Descanso de ${exerciseName}` : 'Descanso'}
    >
      <div className="rest-timer-row">
        <span className="rest-timer-label">
          {done ? <CheckIcon size={16} /> : <ClockIcon size={16} />}
          <span>
            {done ? 'Descanso concluído' : 'Descansando'}
            {compact && exerciseName && (
              <span className="rest-timer-origin"> · {exerciseName}</span>
            )}
          </span>
        </span>
        {/* role="timer" não é anunciado a cada segundo (aria-live implícito "off"). */}
        <span className="rest-timer-clock" role="timer" aria-label="Tempo restante de descanso">
          {formatRestClock(remaining)}
        </span>
      </div>
      <div className="rest-timer-track" aria-hidden="true">
        <span className="rest-timer-bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
      {!done && (
        <div className="rest-timer-footer">
          {!compact && (
            <span className="rest-timer-duration">
              Descanso: {formatRestDuration(rest.durationSeconds)}
            </span>
          )}
          <div className="rest-timer-actions">
            <Button
              type="button"
              size="small"
              className="rest-timer-action"
              aria-label="Adicionar 15 segundos ao descanso"
              onClick={onExtend}
            >
              +15s
            </Button>
            <Button
              type="button"
              size="small"
              className="rest-timer-action"
              aria-label="Pular descanso"
              onClick={onSkip}
            >
              Pular
            </Button>
          </div>
        </div>
      )}
      {/* Único anúncio para leitor de tela: quando o descanso termina. */}
      <span className="sr-only" role="status">
        {done ? 'Descanso concluído' : ''}
      </span>
    </section>
  )
}

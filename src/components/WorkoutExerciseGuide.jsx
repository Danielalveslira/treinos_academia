import { useCallback, useEffect, useRef, useState } from 'react'
import { getExerciseImageUrl, getExerciseThumbnailUrl } from '../utils/exerciseCatalogImages'
import { ExerciseCatalogImage } from './ExerciseCatalogImage'

function displayValue(value) {
  const text = String(value ?? '').replaceAll('-', ' ')
  return text ? text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1) : ''
}

export function WorkoutExerciseGuide({ exercise, onClose, triggerRef }) {
  const closeButtonRef = useRef(null)
  const dialogRef = useRef(null)

  // Trap real de foco: Tab/Shift+Tab nunca escapa para o conteúdo atrás do backdrop
  // enquanto o modal está aberto. O padrão de isolamento de PwaControls.jsx
  // (content.inert = true no #app-content) não é reaproveitável aqui sem portal, porque
  // este componente é renderizado dentro da própria árvore de #app-content -- inert num
  // ancestral também apagaria o modal. Restauração de foco ao trigger e fechamento por
  // Escape já existiam e continuam aqui, sem mudança de comportamento.
  useEffect(() => {
    const trigger = triggerRef.current
    closeButtonRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = dialog.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      trigger?.focus()
    }
  }, [onClose, triggerRef])

  return (
    <div className="workout-guide-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="workout-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workout-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workout-guide-header">
          <h2 id="workout-guide-title">{exercise.name}</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className="workout-guide-images">
          {exercise.imageRefs.slice(0, 2).map((_, index) => (
            <ExerciseCatalogImage
              key={index}
              src={getExerciseImageUrl(exercise, index)}
              alt={`${exercise.name}, posição ${index + 1}`}
              className="workout-guide-image"
              fallbackLabel={`Imagem ${index + 1} indisponível`}
            />
          ))}
        </div>

        <dl className="workout-guide-meta">
          <div>
            <dt>Músculos</dt>
            <dd>{exercise.primaryMuscles.map(displayValue).join(', ')}</dd>
          </div>
          <div>
            <dt>Equipamento</dt>
            <dd>{displayValue(exercise.equipment)}</dd>
          </div>
          <div>
            <dt>Nível</dt>
            <dd>{displayValue(exercise.level)}</dd>
          </div>
        </dl>

        {exercise.instructions.length > 0 && (
          <section className="workout-guide-instructions" aria-labelledby="workout-guide-steps">
            <h3 id="workout-guide-steps">Instruções</h3>
            <ol>
              {exercise.instructions.map((instruction, index) => (
                <li key={index}>{instruction}</li>
              ))}
            </ol>
          </section>
        )}
      </section>
    </div>
  )
}

export function WorkoutExerciseVisual({ exercise, group, displayName }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const closeGuide = useCallback(() => setOpen(false), [])

  return (
    <>
      <div className="exercise-context-visual">
        <ExerciseCatalogImage
          src={getExerciseThumbnailUrl(exercise)}
          alt=""
          className="workout-exercise-thumbnail"
          hideOnError
        />
        <div className="exercise-context-name">
          <span>{group}</span>
          <strong>{displayName}</strong>
          <button
            ref={triggerRef}
            className="workout-guide-trigger"
            type="button"
            onClick={() => setOpen(true)}
          >
            Ver execução
          </button>
        </div>
      </div>
      {open && (
        <WorkoutExerciseGuide exercise={exercise} onClose={closeGuide} triggerRef={triggerRef} />
      )}
    </>
  )
}

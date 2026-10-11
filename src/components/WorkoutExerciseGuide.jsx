import { useCallback, useEffect, useRef, useState } from 'react'
import { useExerciseCatalogDetail } from '../hooks/useExerciseCatalogDetail.js'
import { formatCatalogLabel as displayValue } from '../utils/exerciseCatalog.js'
import { getMuscleIcon } from '../constants/muscleGroupIcons.js'
import { MuscleIconBadge } from './MuscleIconBadge.jsx'
import { ExerciseCatalogImage } from './ExerciseCatalogImage.jsx'

// exercise é o exercício PESSOAL (snapshot: name/muscleGroup/equipment/providerExerciseId
// já salvos em public.exercises) -- o conteúdo rico (imagens/instruções) vem à parte, via
// useExerciseCatalogDetail, nunca bloqueante: mesmo se o item tiver sumido do catálogo
// (reimportação futura), o treino continua abrindo com o snapshot básico (ver
// `unavailable` abaixo).
export function WorkoutExerciseGuide({ exercise, onClose, triggerRef }) {
  const closeButtonRef = useRef(null)
  const dialogRef = useRef(null)
  const { data: detail, loading, unavailable } = useExerciseCatalogDetail({
    catalogId: exercise.catalogId,
    provider: exercise.provider,
    providerExerciseId: exercise.providerExerciseId,
  })

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

  // start/end (posição inicial/final) são a prioridade; sem elas (ainda não publicadas, ou
  // publicadas mas não baixadas neste aparelho), a miniatura é melhor que nenhuma imagem --
  // mesmo exercício, só um enquadramento menor.
  const images = detail?.images?.length ? detail.images.slice(0, 2) : detail?.thumbnail ? [detail.thumbnail] : []
  const primaryMuscles = detail?.primaryMuscles?.length ? detail.primaryMuscles : [exercise.muscleGroup]
  const equipment = detail?.equipment ?? exercise.equipment
  const instructions = detail?.instructions || []

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

        {images.length > 0 ? (
          <div className="workout-guide-images">
            {images.map((src, index) => (
              <ExerciseCatalogImage
                key={src}
                src={src}
                // start/end publicada mas não baixada neste aparelho (offline, cache vazio): tenta a
                // miniatura antes de desistir -- mesma imagem fica disponível mesmo sem o par completo.
                fallbackSrc={detail?.thumbnail}
                alt={`${exercise.name}, posição ${index + 1}`}
                className="workout-guide-image"
                fallbackLabel={`Imagem ${index + 1} indisponível`}
              />
            ))}
          </div>
        ) : (
          !loading && (
            <p className="workout-guide-unavailable">
              {unavailable
                ? 'Conteúdo detalhado indisponível no momento. Você ainda pode registrar sua série normalmente.'
                : 'Sem imagens para este exercício.'}
            </p>
          )
        )}

        <dl className="workout-guide-meta">
          <div>
            <dt>Músculos</dt>
            <dd className="workout-guide-muscles">
              {primaryMuscles.map((muscle) => (
                <span key={muscle}>
                  <MuscleIconBadge icon={getMuscleIcon(muscle)} size="sm" />
                  {displayValue(muscle)}
                </span>
              ))}
            </dd>
          </div>
          {equipment && (
            <div>
              <dt>Equipamento</dt>
              <dd>{displayValue(equipment)}</dd>
            </div>
          )}
          {detail?.level && (
            <div>
              <dt>Nível</dt>
              <dd>{displayValue(detail.level)}</dd>
            </div>
          )}
        </dl>

        {instructions.length > 0 && (
          <section className="workout-guide-instructions" aria-labelledby="workout-guide-steps">
            <h3 id="workout-guide-steps">Instruções</h3>
            <ol>
              {instructions.map((instruction, index) => (
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
  const { data: detail } = useExerciseCatalogDetail({
    catalogId: exercise.catalogId,
    provider: exercise.provider,
    providerExerciseId: exercise.providerExerciseId,
  })

  return (
    <>
      <div className="exercise-context-visual">
        <ExerciseCatalogImage
          src={detail?.thumbnail || detail?.images?.[0] || null}
          // Miniatura publicada mas não baixada ainda: tenta a posição inicial (se essa, por sua
          // vez, já estiver em cache) antes de ficar em branco.
          fallbackSrc={detail?.thumbnail ? detail?.images?.[0] : null}
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

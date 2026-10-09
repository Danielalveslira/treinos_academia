import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRightIcon, StarIcon } from '@primer/octicons-react'
import { describeActivityPreview } from '../utils/communityActivity'
import { stripMarkdown } from '../utils/markdownHint'
import { toMillis } from '../utils/expiry.js'
import { advance, currentId, reconcile, startCycle } from '../utils/spotlightCycle'

const ROTATE_INTERVAL_MS = 7000
const RESUME_AFTER_MS = 4000

function spotlightExcerpt(status) {
  return stripMarkdown(describeActivityPreview(status)) || 'Publicação em destaque'
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const isEligible = (status, now) => toMillis(status.promotedUntil) > now

// Card "Em destaque" no topo de "Recentes". Mostra UM destaque por vez e, havendo mais de um, gira entre TODOS os
// elegíveis em ordem aleatória (cada um uma vez por ciclo; ver utils/spotlightCycle.js). 100% local: usa a lista
// de destaques que o feed já carregou -- nenhuma consulta a cada troca, sem Realtime nem polling.
// Rotação: UM único setTimeout (reagendado a cada troca), só enquanto há mais de um destaque, o card está visível
// na tela, a aba está em primeiro plano, o usuário não está interagindo e não há prefers-reduced-motion. Com um
// único destaque não há timer, nem observador, nem controles. O card inteiro abre a publicação (onOpen).
export function FeaturedSpotlight({ statuses, onOpen, random = Math.random }) {
  const [now, setNow] = useState(() => Date.now())
  const eligible = useMemo(
    () => statuses.filter((status) => isEligible(status, now)),
    [statuses, now]
  )
  const idsKey = eligible.map((status) => status.id).join('|')
  const [cycle, setCycle] = useState(() =>
    startCycle(
      eligible.map((s) => s.id),
      null,
      random
    )
  )

  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [inView, setInView] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const rootRef = useRef(null)
  // Lista mais recente sem entrar nas dependências do timer: o pai re-renderiza a cada mudança do feed, e isso não
  // pode reiniciar a contagem dos 7 s.
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const resumeRef = useRef(null)
  const multiple = eligible.length > 1

  // O conjunto elegível mudou (promoção venceu, chegou outro, trocou de comunidade): ajusta o ciclo sem pular ninguém.
  useEffect(() => {
    const ids = idsKey ? idsKey.split('|') : []
    setCycle((previous) => reconcile(previous, ids, random))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `random` é estável por contrato
  }, [idsKey])

  // Guardas da rotação: só existem quando há o que girar.
  useEffect(() => {
    if (!multiple) return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = () => setReducedMotion(query.matches)
    const onVisibility = () => setHidden(document.hidden)
    query.addEventListener('change', onMotion)
    document.addEventListener('visibilitychange', onVisibility)
    let observer = null
    if (typeof IntersectionObserver !== 'undefined' && rootRef.current) {
      observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
        threshold: 0.1,
      })
      observer.observe(rootRef.current)
    }
    return () => {
      query.removeEventListener('change', onMotion)
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    }
  }, [multiple])

  const rotating = multiple && !paused && !hidden && inView && !reducedMotion
  const currentKey = currentId(cycle)

  // O timer único: a troca acontece no máximo a cada 7 s e NUNCA depois do vencimento do próximo a expirar.
  useEffect(() => {
    if (!rotating) return undefined
    const current = Date.now()
    const soonest = statusesRef.current
      .filter((status) => isEligible(status, current))
      .reduce((min, s) => Math.min(min, toMillis(s.promotedUntil)), Infinity)
    const delay = Math.max(250, Math.min(ROTATE_INTERVAL_MS, soonest - current + 50))
    const id = setTimeout(() => {
      const at = Date.now()
      const ids = statusesRef.current
        .filter((status) => isEligible(status, at))
        .map((status) => status.id)
      setNow(at)
      setCycle((previous) => advance(previous, ids, random))
    }, delay)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reagenda a cada troca (currentKey) ou mudança de estado
  }, [rotating, currentKey, idsKey])

  useEffect(() => () => clearTimeout(resumeRef.current), [])

  function pause() {
    clearTimeout(resumeRef.current)
    setPaused(true)
  }
  function scheduleResume() {
    clearTimeout(resumeRef.current)
    resumeRef.current = setTimeout(() => setPaused(false), RESUME_AFTER_MS)
  }

  if (eligible.length === 0) return null
  // Entre o vencimento e o ajuste do ciclo nunca aparece um destaque inelegível: cai no primeiro elegível.
  const status = eligible.find((item) => item.id === currentKey) || eligible[0]
  const position = Math.max(0, cycle.order.indexOf(status.id)) + 1
  const author = typeof status.authorUsername === 'string' ? status.authorUsername : null
  const excerpt = spotlightExcerpt(status)

  function showNext() {
    pause()
    const ids = eligible.map((item) => item.id)
    setCycle((previous) => advance(previous, ids, random))
    scheduleResume()
  }

  return (
    <div
      ref={rootRef}
      className={`cd-spotlight-wrap${multiple ? ' is-multiple' : ''}`}
      onMouseEnter={multiple ? pause : undefined}
      onMouseLeave={multiple ? scheduleResume : undefined}
      onTouchStart={multiple ? pause : undefined}
      onTouchEnd={multiple ? scheduleResume : undefined}
      onFocus={multiple ? pause : undefined}
      onBlur={multiple ? scheduleResume : undefined}
    >
      <button
        type="button"
        className="cd-spotlight"
        onClick={() => onOpen(status)}
        aria-label={`Abrir publicação em destaque de ${author ? `@${author}` : 'um membro'}: ${excerpt}`}
      >
        <StarIcon size={16} />
        <span className="cd-spotlight-body">
          <span className="cd-spotlight-label">Em destaque{author ? ` · @${author}` : ''}</span>
          <span className="cd-spotlight-text">{excerpt}</span>
        </span>
        {!multiple && <ChevronRightIcon size={16} />}
      </button>
      {/* Só com mais de um destaque. A posição é a do CICLO (não ranking nem prioridade). Irmão do botão do card
          (botão dentro de botão é inválido) e sem aria-live: a troca automática não é anunciada. */}
      {multiple && (
        <div className="cd-spotlight-nav">
          <span className="cd-spotlight-count" aria-hidden="true">
            {position}/{eligible.length}
          </span>
          <button
            type="button"
            className="cd-spotlight-next"
            onClick={showNext}
            aria-label={`Próximo destaque (${position} de ${eligible.length})`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M6 3l5 5-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

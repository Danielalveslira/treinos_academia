import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'

const ROTATE_INTERVAL_MS = 7000
const RESUME_AFTER_MS = 4000

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Patrocínio da comunidade / banner da Home: um cartão de pouca altura, SEM imagem e sem nenhuma consulta
// própria (recebe `ads` já carregados e filtrados). "Patrocinado" é sempre visível e lido por leitores de
// tela. Com mais de uma campanha continua rotacionando (a exposição contratada de cada uma é preservada),
// com UM único timer, pausado ao tocar/focar/passar o mouse, com a aba oculta e em prefers-reduced-motion.
// A altura mínima é fixa no CSS, então trocar de campanha não desloca o feed.
export function SponsoredAdBanner({ ads }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const resumeTimeoutRef = useRef(null)

  // Mesmo padrão de matchMedia+listener já usado em AccountMenu.jsx/PwaControls.jsx.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Aba em segundo plano não gasta ciclo trocando de campanha que ninguém está vendo.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Evita apontar pra um índice fora do array se a lista encolher num refresh de cache.
  useEffect(() => {
    setIndex((i) => (i >= ads.length ? 0 : i))
  }, [ads.length])

  const canRotate = ads.length > 1 && !reducedMotion && !paused && !hidden

  // Pausar/retomar sempre reinicia a contagem do zero (não guarda tempo restante) --
  // efeito só recria o interval quando canRotate muda, então a retomada sempre começa
  // um ciclo novo de ROTATE_INTERVAL_MS.
  useEffect(() => {
    if (!canRotate) return
    const id = setInterval(() => setIndex((i) => (i + 1) % ads.length), ROTATE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [canRotate, ads.length])

  useEffect(() => () => clearTimeout(resumeTimeoutRef.current), [])

  function pause() {
    clearTimeout(resumeTimeoutRef.current)
    setPaused(true)
  }
  function scheduleResume() {
    clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(() => setPaused(false), RESUME_AFTER_MS)
  }

  if (ads.length === 0) return null
  const current = index < ads.length ? index : 0
  const ad = ads[current]
  const hasCta = Boolean(ad.ctaLabel)
  const multiple = ads.length > 1

  // Avanço manual: pausa o rodízio e só o retoma depois de RESUME_AFTER_MS (o foco no botão também pausa).
  function showNext() {
    pause()
    setIndex((i) => (i + 1) % ads.length)
    scheduleResume()
  }

  return (
    <aside
      className="sponsored-ad-banner"
      onMouseEnter={pause}
      onMouseLeave={scheduleResume}
      onTouchStart={pause}
      onTouchEnd={scheduleResume}
      onFocus={pause}
      onBlur={scheduleResume}
      aria-label={`Patrocinado: ${ad.partnerName}`}
    >
      <div className="sponsored-ad-banner-content">
        <p className="sponsored-ad-banner-meta">
          <span className="sponsored-ad-pill">Patrocinado</span>
          <span className="sponsored-ad-banner-partner">{ad.partnerName}</span>
        </p>
        <p className="sponsored-ad-banner-title">{ad.title}</p>
      </div>
      <div className="sponsored-ad-banner-side">
        {/* Só com mais de uma campanha. O contador é discreto e fica acima do botão do anúncio (mobile) ou
            ao lado dele (desktop); nunca disputa com o CTA. O rodízio automático não é anunciado por leitor de
            tela (sem aria-live); o botão informa a posição atual. */}
        {multiple && (
          <div className="sponsored-ad-banner-nav">
            <span className="sponsored-ad-banner-count" aria-hidden="true">
              {current + 1}/{ads.length}
            </span>
            <button
              type="button"
              className="sponsored-ad-banner-next"
              onClick={showNext}
              aria-label={`Próximo patrocínio (${current + 1} de ${ads.length})`}
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
        {hasCta &&
          (ad.ctaType === 'internal' ? (
            <RouterLink to={ad.ctaTarget} className="sponsored-ad-banner-cta">
              {ad.ctaLabel}
            </RouterLink>
          ) : (
            <a
              href={ad.ctaTarget}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="sponsored-ad-banner-cta"
            >
              {ad.ctaLabel}
            </a>
          ))}
      </div>
    </aside>
  )
}

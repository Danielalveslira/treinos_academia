import { useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useAdClick, useAdImpression } from '../hooks/useAdMetrics'
import {
  marqueeKeyframes,
  marqueeTiming,
  measureOverflow,
  remainingMs,
} from '../utils/bannerMarquee'

const RESUME_AFTER_MS = 4000

// Element.animate (Web Animations) move o texto só com transform, na thread do compositor. Sem ele (navegador muito
// antigo) o texto longo vira uma linha rolável à mão, igual ao prefers-reduced-motion.
function canAnimate() {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Patrocínio da comunidade / banner da Home: um cartão de pouca altura, SEM imagem e sem nenhuma consulta
// própria (recebe `ads` já carregados e filtrados). "Patrocinado" é sempre visível e lido por leitores de
// tela. Marca e mensagem ficam numa linha só: se passam da largura, deslizam sozinhas (pausa, rolagem contínua,
// pausa) e a campanha SEGUINTE só entra depois de a mensagem ter sido exibida inteira; se cabem, não há animação
// e o tempo padrão se mantém. Selo, contador e botões nunca se mexem. Com mais de uma campanha continua
// rotacionando (a exposição contratada de cada uma é preservada), com UM único timer, pausado ao tocar/focar/
// passar o mouse e com a aba oculta (a rolagem pausa junto e continua de onde parou). Em prefers-reduced-motion
// não há animação nem rodízio automático: a linha vira uma região rolável à mão (toque/teclado).
// A altura mínima é fixa no CSS, então nada disso desloca o feed. O React só re-renderiza ao trocar de
// campanha, mudar o excesso medido ou pausar: o movimento em si não passa pelo React.
export function SponsoredAdBanner({ ads, placement = 'community_banner', communityId = null }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [overflow, setOverflow] = useState(0)
  const resumeTimeoutRef = useRef(null)
  const lineRef = useRef(null)
  const textRef = useRef(null)
  const animationRef = useRef(null)
  const rootRef = useRef(null)

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

  const multiple = ads.length > 1
  const current = index < ads.length ? index : 0
  const ad = ads[current]
  const sampleSize = ads.length
  // `eligibleTotal` vem do servidor (select_advertising): quantas campanhas passaram a
  // elegibilidade NAQUELE instante, antes da amostra aleatória de `display_limit` ser
  // recortada. É sempre >= sampleSize; cai para sampleSize só em linhas antigas sem o campo
  // (nunca inventa um número maior que o que foi de fato retornado). O contador numérico
  // (ex. "1/4") é SEMPRE a posição dentro da amostra local, nunca uma posição dentro do
  // total elegível: com 5 elegíveis e amostra de 4 mostrar "1/5"..."4/5" voltaria pro "1/5"
  // sem nunca passar por "5/5", sugerindo uma 5ª posição navegável que não existe nesta
  // amostra. Quando há mais elegíveis do que a amostra trouxe, um selo "+N" avisa isso sem
  // fingir que dá pra avançar até eles (só o próximo refresh pode trazê-los).
  const eligibleTotal = Math.max(ad?.eligibleTotal ?? sampleSize, sampleSize)
  const extraEligible = eligibleTotal - sampleSize
  const autoScroll = !reducedMotion && canAnimate()
  const holding = paused || hidden
  const timing = useMemo(() => marqueeTiming(autoScroll ? overflow : 0), [autoScroll, overflow])

  // Métricas (desligadas por padrão): o <aside> é o elemento observado e a campanha atual é a que está sendo medida.
  useAdImpression(rootRef, ad?.id, placement, communityId)
  const onCtaClick = useAdClick(ad?.id, placement, communityId)

  // Mede o quanto a mensagem passa da largura visível. Só roda ao trocar de campanha e quando a largura da linha
  // ou do texto muda (um observador para o banner todo); o estado só muda se o excesso mudou.
  useEffect(() => {
    const line = lineRef.current
    const text = textRef.current
    if (!line || !text) return
    const measure = () => setOverflow(measureOverflow(text.offsetWidth, line.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(line)
    observer.observe(text)
    return () => observer.disconnect()
  }, [ad])

  // A rolagem é uma animação de transform criada só quando há excesso a mostrar. Com várias campanhas toca uma
  // vez (o avanço vem do timer abaixo, que usa a mesma duração); com uma só repete em laço.
  useEffect(() => {
    const text = textRef.current
    if (!timing.animated || !text) return
    const animation = text.animate(marqueeKeyframes(timing), {
      duration: timing.totalMs,
      easing: 'linear',
      fill: 'forwards',
      iterations: multiple ? 1 : Infinity,
    })
    animationRef.current = animation
    return () => {
      animation.cancel()
      animationRef.current = null
    }
  }, [timing, multiple, current])

  useEffect(() => {
    const animation = animationRef.current
    if (!animation) return
    if (holding && animation.playState === 'running') animation.pause()
    else if (!holding && animation.playState === 'paused') animation.play()
  }, [holding, timing, multiple, current])

  // Um único timeout por campanha: o tempo padrão se a mensagem cabe; senão, pausa + rolagem + pausa. Retomar
  // depois de uma pausa continua a rolagem de onde parou (campanha que cabe recomeça o tempo padrão).
  const canRotate = multiple && autoScroll && !holding
  useEffect(() => {
    if (!canRotate) return
    const wait = remainingMs(timing, Number(animationRef.current?.currentTime))
    const id = setTimeout(() => setIndex((i) => (i + 1) % ads.length), wait)
    return () => clearTimeout(id)
  }, [canRotate, timing, current, ads.length])

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
  const hasCta = Boolean(ad.ctaLabel)
  // sem animação (reduced motion / sem Web Animations) e com excesso: a linha vira região rolável à mão
  const manual = !autoScroll && overflow > 0
  const lineClass = `sponsored-ad-banner-line${timing.animated ? ' is-scrolling' : ''}${manual ? ' is-manual' : ''}`

  // Avanço manual: pausa o rodízio e só o retoma depois de RESUME_AFTER_MS (o foco no botão também pausa).
  function showNext() {
    pause()
    setIndex((i) => (i + 1) % ads.length)
    scheduleResume()
  }

  return (
    <aside
      ref={rootRef}
      className={`sponsored-ad-banner${placement === 'home_banner' ? ' sponsored-ad-banner--home' : ''}`}
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
          <span className="sponsored-ad-banner-partner" title={ad.partnerName}>
            {ad.partnerName}
          </span>
        </p>
        <div
          ref={lineRef}
          className={lineClass}
          tabIndex={manual ? 0 : undefined}
          role={manual ? 'group' : undefined}
          aria-label={manual ? 'Mensagem completa (role para ler)' : undefined}
        >
          <p ref={textRef} className="sponsored-ad-banner-text">
            {ad.title}
          </p>
        </div>
      </div>
      <div className="sponsored-ad-banner-side">
        {/* Dois selos com sentidos DIFERENTES, nunca misturados num só número: o contador
            (1/4) é a posição dentro da amostra local que de fato rotaciona; o selo "+N",
            quando presente, só avisa que o servidor viu mais candidatos elegíveis do que
            esta amostra trouxe -- não é clicável nem navegável (só o próximo refresh pode
            trazer esses outros). O botão de avanço só existe quando a amostra local tem mais
            de um item pra rotacionar. O rodízio automático não é anunciado por leitor de
            tela (sem aria-live); o texto oculto abaixo e o botão informam a posição atual. */}
        {(multiple || extraEligible > 0) && (
          <div className="sponsored-ad-banner-nav">
            {multiple && (
              <span className="sponsored-ad-banner-count" aria-hidden="true">
                {current + 1}/{sampleSize}
              </span>
            )}
            {extraEligible > 0 && (
              <span
                className="sponsored-ad-banner-pool"
                aria-hidden="true"
                title={`${eligibleTotal} campanhas elegíveis no total, ${sampleSize} nesta rotação`}
              >
                +{extraEligible}
              </span>
            )}
            <span className="sr-only">
              {multiple
                ? `Patrocínio ${current + 1} de ${sampleSize} nesta rotação`
                : 'Uma campanha patrocinada em exibição'}
              {extraEligible > 0
                ? `; ${eligibleTotal} campanhas elegíveis no total, só ${sampleSize} nesta rotação`
                : ''}
            </span>
            {multiple && (
              <button
                type="button"
                className="sponsored-ad-banner-next"
                onClick={showNext}
                aria-label={`Próximo patrocínio (${current + 1} de ${sampleSize})`}
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
            )}
          </div>
        )}
        {hasCta &&
          (ad.ctaType === 'internal' ? (
            <RouterLink to={ad.ctaTarget} className="sponsored-ad-banner-cta" onClick={onCtaClick}>
              {ad.ctaLabel}
            </RouterLink>
          ) : (
            <a
              href={ad.ctaTarget}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="sponsored-ad-banner-cta"
              onClick={onCtaClick}
              onAuxClick={onCtaClick}
            >
              {ad.ctaLabel}
            </a>
          ))}
      </div>
    </aside>
  )
}

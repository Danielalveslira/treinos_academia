import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Text } from '@primer/react'
import { MegaphoneIcon } from '@primer/octicons-react'

const ROTATE_INTERVAL_MS = 7000
const RESUME_AFTER_MS = 4000

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function SponsoredAdBanner({ ads }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const resumeTimeoutRef = useRef(null)

  // Mesmo padrão de matchMedia+listener já usado em AccountMenu.jsx/PwaControls.jsx.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Evita apontar pra um índice fora do array se a lista encolher num refresh de cache.
  useEffect(() => {
    setIndex((i) => (i >= ads.length ? 0 : i))
  }, [ads.length])

  const canRotate = ads.length > 1 && !reducedMotion && !paused

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
  const ad = ads[index]
  const hasCta = Boolean(ad.ctaLabel)

  return (
    <Box
      className="sponsored-ad-banner"
      onMouseEnter={pause}
      onMouseLeave={scheduleResume}
      onTouchStart={pause}
      onTouchEnd={scheduleResume}
      aria-label={`Publicidade de ${ad.partnerName}`}
    >
      <MegaphoneIcon size={14} />
      <Box className="sponsored-ad-banner-content">
        <Text className="sponsored-ad-banner-partner">{ad.partnerName}</Text>
        <Text className="sponsored-ad-banner-title">{ad.title}</Text>
      </Box>
      {hasCta &&
        (ad.ctaType === 'internal' ? (
          <RouterLink to={ad.ctaTarget} className="sponsored-ad-banner-cta">
            {ad.ctaLabel}
          </RouterLink>
        ) : (
          <a
            href={ad.ctaTarget}
            target="_blank"
            rel="noopener noreferrer"
            className="sponsored-ad-banner-cta"
          >
            {ad.ctaLabel}
          </a>
        ))}
      {ads.length > 1 && (
        <Box className="sponsored-ad-banner-dots" aria-hidden="true">
          {ads.map((_, i) => (
            <span key={i} className={`sponsored-ad-banner-dot${i === index ? ' is-active' : ''}`} />
          ))}
        </Box>
      )}
    </Box>
  )
}

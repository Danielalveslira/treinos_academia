import { useMemo } from 'react'
import { SHARE_HEIGHT, SHARE_WIDTH, buildShareSvg, svgToDataUrl } from '../utils/shareProgressSvg'

// Card de compartilhamento de progresso. Uma única base para todas as variantes (daily, perfect_week, week,
// month, quarter): a variante vem no `model` (ver utils/shareProgress.js) e a arte é desenhada por
// buildShareSvg. O preview é um <img> do MESMO SVG que depois vira o PNG -- o que o usuário vê é o que sai.
export function ShareProgressCard({ model }) {
  const src = useMemo(() => svgToDataUrl(buildShareSvg(model)), [model])
  return (
    <img
      className={`share-progress-card is-${model.variant}`}
      src={src}
      alt={model.alt || model.title}
      width={SHARE_WIDTH}
      height={SHARE_HEIGHT}
      draggable={false}
    />
  )
}

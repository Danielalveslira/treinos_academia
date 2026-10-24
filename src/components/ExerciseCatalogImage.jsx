import { useState } from 'react'

// Dois motivos bem diferentes de não mostrar a imagem, distinguidos pelo próprio estado do
// componente (não precisa de prop nova): nunca houve `src` -- a role nunca foi publicada --
// ou havia `src` e o <img> falhou (onError) -- publicada, mas indisponível neste aparelho/rede
// agora. `fallbackLabel` explícito (inclusive string vazia, para os cards que preferem ficar em
// branco) sempre tem prioridade sobre os dois textos padrão.
const REASON_LABEL = {
  'none-published': 'Este exercício ainda não tem imagem publicada',
  'offline-unavailable': 'Imagem não disponível neste aparelho offline',
}

// `fallbackSrc` (tipicamente a thumbnail) só entra em jogo se `src` (start/end) existir mas FALHAR
// ao carregar -- publicado, mas não baixado/cacheado neste aparelho agora. Nunca usado por si só
// quando `src` carrega normalmente. Índice avança (nunca volta) por uma lista de candidatos --
// evita qualquer loop de retry entre os dois.
export function ExerciseCatalogImage({
  src,
  fallbackSrc,
  alt = '',
  className = '',
  fallbackLabel,
  // Identidade visual do grupo muscular no placeholder (seção 3.4 da Fase 4) -- um
  // componente de ícone (ex.: getMuscleIcon(...)), nunca obrigatório: quando omitido o
  // placeholder continua exatamente como antes (só o texto, ou nada com fallbackLabel="").
  icon: Icon,
  hideOnError = false,
  loading = 'lazy',
  onLoad,
  onError,
}) {
  const candidates = []
  if (src) candidates.push(src)
  if (fallbackSrc && fallbackSrc !== src) candidates.push(fallbackSrc)

  const [index, setIndex] = useState(0)
  const effectiveSrc = candidates[index]
  const exhausted = index >= candidates.length

  if (exhausted) {
    if (hideOnError) return null
    const reason = candidates.length > 0 ? 'offline-unavailable' : 'none-published'
    return (
      <div
        className={`catalog-image-placeholder ${className}`.trim()}
        aria-hidden="true"
        data-image-fallback
        data-fallback-reason={reason}
      >
        {Icon && <Icon size={22} strokeWidth={1.75} />}
        {fallbackLabel ?? REASON_LABEL[reason]}
      </div>
    )
  }
  return (
    <img
      className={className}
      src={effectiveSrc}
      loading={loading}
      decoding="async"
      alt={alt}
      onLoad={onLoad}
      onError={() => {
        onError?.()
        setIndex((current) => current + 1)
      }}
    />
  )
}

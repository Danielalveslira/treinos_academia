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

export function ExerciseCatalogImage({ src, alt = '', className = '', fallbackLabel, hideOnError = false }) {
  const [failedUrl, setFailedUrl] = useState(null)
  const failed = Boolean(src) && failedUrl === src
  if (!src || failed) {
    if (hideOnError) return null
    const reason = failed ? 'offline-unavailable' : 'none-published'
    return (
      <div
        className={`catalog-image-placeholder ${className}`.trim()}
        aria-hidden="true"
        data-image-fallback
        data-fallback-reason={reason}
      >
        {fallbackLabel ?? REASON_LABEL[reason]}
      </div>
    )
  }
  return (
    <img
      className={className}
      src={src}
      loading="lazy"
      decoding="async"
      alt={alt}
      onError={() => setFailedUrl(src)}
    />
  )
}

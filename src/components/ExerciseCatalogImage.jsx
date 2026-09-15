import { useState } from 'react'

export function ExerciseCatalogImage({
  src,
  alt = '',
  className = '',
  fallbackLabel = 'Sem imagem',
  hideOnError = false,
}) {
  const [failedUrl, setFailedUrl] = useState(null)
  if (!src || failedUrl === src) {
    if (hideOnError) return null
    return (
      <div
        className={`catalog-image-placeholder ${className}`.trim()}
        aria-hidden="true"
        data-image-fallback
      >
        {fallbackLabel}
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

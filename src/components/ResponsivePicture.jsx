// Imagens de capa/herói servidas em AVIF -> WebP com várias larguras (public/img/<nome>-<largura>.*),
// em vez de um PNG de ~1,9 MB para qualquer tela. As originais ficam em imports/images-source/.
// `priority` só para a imagem que realmente é o LCP da tela (eager + fetchpriority alto); o
// resto fica lazy, para não competir com o JS/CSS do boot.
const WIDTHS = [480, 800, 1024]

function srcSet(name, ext) {
  return WIDTHS.map((width) => `/img/${name}-${width}.${ext} ${width}w`).join(', ')
}

export function ResponsivePicture({
  name,
  alt,
  width,
  height,
  sizes = '100vw',
  priority = false,
  className,
}) {
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(name, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(name, 'webp')} sizes={sizes} />
      <img
        className={className}
        src={`/img/${name}-800.webp`}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        // React 18 só repassa o atributo em minúsculas (fetchPriority camelCase gera warning).
        {...(priority ? { fetchpriority: 'high' } : {})}
      />
    </picture>
  )
}

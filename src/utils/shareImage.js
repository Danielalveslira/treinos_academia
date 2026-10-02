import { SHARE_HEIGHT, SHARE_WIDTH, svgToDataUrl } from './shareProgressSvg.js'

// Exportação do card: SVG -> PNG via <canvas> NATIVO (sem html2canvas/libs) e compartilhamento/download.
// Tudo recebe `env` (window/document/navigator reais por padrão) para ser testável sem navegador.
// O PNG só é gerado no clique -- o preview usa o próprio SVG.

function loadImage(url, env) {
  return new Promise((resolve, reject) => {
    const image = new env.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('IMAGE_RENDER_FAILED'))
    image.src = url
  })
}

// 1080x1350. Dispositivos fracos não sofrem: um único drawImage. PNG para compartilhar/baixar; WebP para
// publicar (o bucket de fotos das comunidades só aceita image/webp, até 4MB -- o mesmo pipeline das fotos).
export async function renderSvgToBlob(
  svg,
  { width = SHARE_WIDTH, height = SHARE_HEIGHT, type = 'image/png', quality } = {},
  env = globalThis
) {
  const image = await loadImage(svgToDataUrl(svg), env)
  const canvas = env.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('CANVAS_UNAVAILABLE')
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality))
  if (!blob) throw new Error('PNG_ENCODE_FAILED')
  // Navegadores sem encoder do formato pedido devolvem PNG: falha explícita em vez de enviar o tipo errado.
  if (blob.type && blob.type !== type) throw new Error('IMAGE_TYPE_UNSUPPORTED')
  return blob
}

export function renderSvgToPngBlob(svg, options = {}, env = globalThis) {
  return renderSvgToBlob(svg, { ...options, type: 'image/png' }, env)
}

export const MAX_PUBLISH_BYTES = 4 * 1024 * 1024

// Card como WebP pronto para o Storage das publicações. Tenta qualidade alta e cai para uma menor se passar do teto.
export async function renderSvgToPublishBlob(svg, env = globalThis) {
  let blob = await renderSvgToBlob(svg, { type: 'image/webp', quality: 0.92 }, env)
  if (blob.size > MAX_PUBLISH_BYTES) {
    blob = await renderSvgToBlob(svg, { type: 'image/webp', quality: 0.75 }, env)
  }
  if (blob.size > MAX_PUBLISH_BYTES) throw new Error('IMAGE_TOO_LARGE')
  return blob
}

export function toPngFile(blob, filename, env = globalThis) {
  return new env.File([blob], filename, { type: 'image/png' })
}

// Web Share com ARQUIVO (iOS/Android modernos). Sem suporte -> false e a UI oferece só "Baixar imagem".
export function canShareImageFiles(file, env = globalThis) {
  const nav = env.navigator
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [file] })
  } catch {
    return false
  }
}

// Devolve 'shared' | 'cancelled'. O usuário fechar a folha de compartilhamento NÃO é erro.
export async function shareImageFile(file, { title, text }, env = globalThis) {
  try {
    await env.navigator.share({ files: [file], title, text })
    return 'shared'
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled'
    throw error
  }
}

export function downloadFile(file, env = globalThis) {
  const url = env.URL.createObjectURL(file)
  const link = env.document.createElement('a')
  link.href = url
  link.download = file.name
  link.rel = 'noopener'
  env.document.body.appendChild(link)
  link.click()
  link.remove()
  // Revogar na próxima volta do event loop: alguns navegadores iniciam o download de forma assíncrona.
  env.setTimeout(() => env.URL.revokeObjectURL(url), 1000)
}

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

// scale 1 = 1080x1350. Dispositivos fracos não sofrem: um único drawImage.
export async function renderSvgToPngBlob(
  svg,
  { width = SHARE_WIDTH, height = SHARE_HEIGHT } = {},
  env = globalThis
) {
  const image = await loadImage(svgToDataUrl(svg), env)
  const canvas = env.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('CANVAS_UNAVAILABLE')
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG_ENCODE_FAILED')
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

import { SHARE_HEIGHT, SHARE_WIDTH, svgToDataUrl } from './shareProgressSvg.js'
import { SHARE_TITLE } from './shareText.js'

// Exportação do card: SVG -> PNG via <canvas> NATIVO (sem html2canvas/libs) e compartilhamento/download.
// Tudo recebe `env` (window/document/navigator reais por padrão) para ser testável sem navegador.
// O PNG só é gerado no clique -- o preview usa o próprio SVG.

// Alguns navegadores móveis nunca disparam onload/onerror (SVG que não decodifica) nem chamam o callback do
// toBlob. Sem prazo, quem espera (o botão "Compartilhar") ficaria em loading para sempre: toda etapa assíncrona
// de render tem um teto e vira erro.
export const RENDER_STEP_TIMEOUT_MS = 8000

export function withTimeout(promise, ms, code) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

function loadImage(url, env) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const image = new env.Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('IMAGE_RENDER_FAILED'))
      image.src = url
    }),
    RENDER_STEP_TIMEOUT_MS,
    'IMAGE_RENDER_TIMEOUT'
  )
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
  const blob = await withTimeout(
    new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
    RENDER_STEP_TIMEOUT_MS,
    'PNG_ENCODE_TIMEOUT'
  )
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

// ---------------------------------------------------------------------------------------------------------------
// COMPARTILHAR = folha NATIVA do aparelho com imagem + título + mensagem (o link vai DENTRO do texto, nunca em
// `url` separado: `files + url` reduz a compatibilidade de compartilhamento de arquivos). Alguns apps de destino
// ignoram o texto quando recebem arquivo; isso é do app de destino, não um erro nosso.
// Sem suporte a compartilhar arquivo, o fallback COPIA a mensagem e BAIXA a imagem (shareWithFallback).
// O botão "Baixar imagem" é outra ação (downloadFile): só baixa.
export { SHARE_TITLE }

// URL do app = a origem em que ele está rodando (nunca hardcode: preview, domínio próprio e produção funcionam).
export function appUrl(env = globalThis) {
  return env.location?.origin || null
}

function canShareFiles(nav, data) {
  try {
    return typeof nav.canShare === 'function' ? Boolean(nav.canShare(data)) : false
  } catch {
    return false
  }
}

export function buildSharePayload(file, text) {
  return { files: [file], title: SHARE_TITLE, text }
}

// Devolve 'shared', 'cancelled' (usuário fechou a folha: NÃO é erro) ou 'unsupported' (sem Web Share ou sem
// suporte a arquivo: quem chama usa o fallback). Erros reais propagam.
export async function nativeShare(file, text, env = globalThis) {
  const nav = env.navigator
  if (!file || !nav || typeof nav.share !== 'function') return 'unsupported'
  const payload = buildSharePayload(file, text)
  if (!canShareFiles(nav, payload)) return 'unsupported'
  try {
    await nav.share(payload)
    return 'shared'
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled'
    throw error
  }
}

// Copia a mensagem; falha (sem Clipboard API, permissão negada) devolve false em vez de lançar.
export async function copyText(text, env = globalThis) {
  if (!text || typeof env.navigator?.clipboard?.writeText !== 'function') return false
  try {
    await env.navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Resultado: 'shared' | 'cancelled' | 'fallback_copied' (imagem baixada + mensagem copiada) |
// 'fallback_downloaded' (imagem baixada; a mensagem não pôde ser copiada). A imagem sempre fica disponível.
export async function shareWithFallback(file, text, env = globalThis) {
  const result = await nativeShare(file, text, env)
  if (result !== 'unsupported') return result
  const copied = await copyText(text, env)
  downloadFile(file, env)
  return copied ? 'fallback_copied' : 'fallback_downloaded'
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

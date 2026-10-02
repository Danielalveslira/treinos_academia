// Posts comuns compartilham a rota pública da comunidade. Treinos acrescentam apenas
// um fragmento com o id do card para localizar o evento, sem expor nenhum caminho
// interno de dados nem qualquer dado da conta de quem compartilha.
const APP_NAME = 'Evolutus'

export function buildCommunityLink(communityId, origin = window.location.origin) {
  return `${origin}/comunidades/${communityId}`
}

export function buildWorkoutLink(communityId, statusId, origin = window.location.origin) {
  return `${buildCommunityLink(communityId, origin)}#treino-${encodeURIComponent(statusId)}`
}

// Âncoras de card: #treino-{id} (Treino Marcado) e #publicacao-{id} (demais tipos).
// Ambas carregam o mesmo ID canônico da publicação.
export function publicationIdFromHash(hash) {
  const match = typeof hash === 'string' ? /^#(?:treino|publicacao)-(.+)$/.exec(hash) : null
  if (!match) return null
  try {
    const statusId = decodeURIComponent(match[1])
    return /^[A-Za-z0-9_-]{1,128}$/.test(statusId) ? statusId : null
  } catch {
    return null
  }
}

export function buildShareText(communityId, origin, status) {
  if (status?.type === 'workout' && status.id) {
    const title = status.workout?.title?.trim() || 'Treino marcado'
    return `${title} no ${APP_NAME} 💪\n\n${buildWorkoutLink(communityId, status.id, origin)}`
  }
  return `Olha essa publicação no ${APP_NAME} 💪\n\n${buildCommunityLink(communityId, origin)}`
}

export function canShareNatively() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

// file é opcional: só é anexado quando o navegador aceita compartilhar arquivos
// (navigator.canShare) e a foto já estava carregada em memória para exibição —
// nunca dispara um novo download só para isso.
export async function shareNatively(communityId, file, status) {
  const payload = {
    title: status?.type === 'workout' ? status.workout?.title || APP_NAME : APP_NAME,
    text: buildShareText(communityId, undefined, status),
  }
  if (file && navigator.canShare?.({ files: [file] })) payload.files = [file]
  await navigator.share(payload)
}

export function shareToWhatsApp(communityId, status) {
  const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(communityId, undefined, status))}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// O Instagram não tem uma URL de compartilhamento pública como o wa.me do WhatsApp
// (e criar uma integração privada/não documentada com a API deles está fora de
// cogitação) — o fallback seguro e simples é copiar o texto pronto e abrir o site,
// para a pessoa colar numa Stories, post ou DM.
export async function shareToInstagram(communityId, status) {
  const text = buildShareText(communityId, undefined, status)
  let copied = false
  try {
    await navigator.clipboard.writeText(text)
    copied = true
  } catch {
    copied = false
  }
  window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
  return { copied, text }
}

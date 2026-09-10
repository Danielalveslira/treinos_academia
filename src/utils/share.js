// Sempre compartilha o link da comunidade (uma rota pública já existente), nunca o
// id interno da publicação nem qualquer outro dado da conta de quem compartilha.
const APP_NAME = 'Evolutus'

export function buildCommunityLink(communityId, origin = window.location.origin) {
  return `${origin}/comunidades/${communityId}`
}

export function buildShareText(communityId, origin) {
  return `Olha essa publicação no ${APP_NAME} 💪\n\n${buildCommunityLink(communityId, origin)}`
}

export function canShareNatively() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

// file é opcional: só é anexado quando o navegador aceita compartilhar arquivos
// (navigator.canShare) e a foto já estava carregada em memória para exibição —
// nunca dispara um novo download só para isso.
export async function shareNatively(communityId, file) {
  const payload = { title: APP_NAME, text: buildShareText(communityId) }
  if (file && navigator.canShare?.({ files: [file] })) payload.files = [file]
  await navigator.share(payload)
}

export function shareToWhatsApp(communityId) {
  const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(communityId))}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// O Instagram não tem uma URL de compartilhamento pública como o wa.me do WhatsApp
// (e criar uma integração privada/não documentada com a API deles está fora de
// cogitação) — o fallback seguro e simples é copiar o texto pronto e abrir o site,
// para a pessoa colar numa Stories, post ou DM.
export async function shareToInstagram(communityId) {
  const text = buildShareText(communityId)
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

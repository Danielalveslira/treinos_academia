// Imagem de campanha: só é "confiável" quando é servida pela infraestrutura do próprio projeto (Storage do
// Supabase do projeto ou a mesma origem do app). Qualquer outro host é uma requisição direta a terceiro, que
// pode rastrear quem vê o card (IP, horário, user agent). O card continua exibindo campanhas já cadastradas
// com imagem externa (sem referrer, lazy), mas o painel avisa quem cadastra.
function hostOf(value) {
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

export function isTrustedAdImage(url, trustedUrls = defaultTrustedUrls()) {
  const host = hostOf(url)
  if (!host || !/^https:\/\//i.test(url)) return false
  return trustedUrls.map(hostOf).filter(Boolean).includes(host)
}

function defaultTrustedUrls() {
  const list = [import.meta.env?.VITE_SUPABASE_URL]
  if (typeof location !== 'undefined') list.push(location.origin)
  return list.filter(Boolean)
}

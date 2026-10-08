// Mensagem que acompanha o card de progresso (imagem + texto + link). Fonte ÚNICA do texto: o share nativo e o
// fallback (copiar mensagem) usam exatamente esta string. O link vem de quem chama (appUrl = origem pública do
// app em execução; nada de URL fixa aqui).
export const SHARE_TITLE = 'Meu progresso no Evolutus'

const INTRO_BY_VARIANT = {
  daily: 'Treino concluído no Evolutus 💪',
  perfect_week: 'Minha semana perfeita no Evolutus 💪',
  week: 'Minha semana no Evolutus 💪',
  month: 'Meu progresso do mês no Evolutus 💪',
  quarter: 'Minha evolução no Evolutus 💪',
}
const DEFAULT_INTRO = 'Minha evolução no Evolutus 💪'

export function buildShareText(variant, url) {
  const intro = INTRO_BY_VARIANT[variant] || DEFAULT_INTRO
  const body =
    'Estou acompanhando meus treinos, consistência e progresso de um jeito simples e gratuito.'
  const invite = 'Treine, acompanhe sua evolução e participe da comunidade também:'
  return url
    ? `${intro}\n\n${body}\n\n${invite}\n${url}`
    : `${intro}\n\n${body}\n\n${invite.slice(0, -1)}.`
}

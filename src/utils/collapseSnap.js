// Quanto de uma publicação extensa aparece antes de "Ver mais". Generoso de propósito: leitura de
// rede social, não resumo. Publicações até LIMIT + SLACK aparecem INTEIRAS (um "Ver mais" que revela
// só mais uma linha ou duas seria pior que nada); acima disso o conteúdo recolhe numa altura
// "encaixada" em fronteira de bloco (ver pickCollapseHeight), nunca no meio de uma linha de tabela.
export const COLLAPSE_LIMIT_NARROW_PX = 720
export const COLLAPSE_LIMIT_WIDE_PX = 880
export const COLLAPSE_SLACK_PX = 160
// Se recolher economizar menos que isto, mostra tudo (não vale um botão para esconder quase nada).
export const COLLAPSE_MIN_SAVING_PX = 120
const WIDE_BREAKPOINT_PX = 768

export function collapseLimitFor(viewportWidth) {
  return viewportWidth >= WIDE_BREAKPOINT_PX ? COLLAPSE_LIMIT_WIDE_PX : COLLAPSE_LIMIT_NARROW_PX
}

export function shouldCollapse(naturalHeight, limit) {
  return naturalHeight > limit + COLLAPSE_SLACK_PX
}

// candidates = alturas (px a partir do topo do conteúdo) onde é seguro cortar: o fim de cada bloco, de
// cada linha de tabela e de cada item de lista de primeiro nível. Devolve o MAIOR ponto que cabe no
// limite; se nem o primeiro cabe (ex.: um bloco enorme logo no começo), o MENOR, para nunca mostrar
// menos que o primeiro pedaço inteiro.
export function pickCollapseHeight(candidates, limit) {
  const valid = candidates.filter((value) => Number.isFinite(value) && value > 0)
  if (valid.length === 0) return limit
  const fitting = valid.filter((value) => value <= limit)
  return fitting.length > 0 ? Math.max(...fitting) : Math.min(...valid)
}

// Decide a altura recolhida (px) ou null quando o conteúdo deve aparecer inteiro.
export function planCollapse(naturalHeight, candidates, viewportWidth) {
  const limit = collapseLimitFor(viewportWidth)
  if (!shouldCollapse(naturalHeight, limit)) return null
  const snapped = Math.ceil(pickCollapseHeight(candidates, limit))
  return snapped >= naturalHeight - COLLAPSE_MIN_SAVING_PX ? null : snapped
}

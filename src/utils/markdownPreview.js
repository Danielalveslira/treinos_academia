// Começo de um markdown longo, cortado numa fronteira SEGURA, para renderizar só o que o leitor vê antes do
// "Ver mais" (processar 7000 caracteres de uma vez custa centenas de ms num celular fraco; o texto completo só
// é renderizado se a pessoa expandir). A fronteira é uma linha em branco: uma tabela nunca contém linha em
// branco (então nunca é partida), e um bloco de código cercado (```) é respeitado.
export const PREVIEW_TARGET_CHARS = 2200
const MIN_PREVIEW_CHARS = 600
const MAX_PREVIEW_CHARS = 3600

// Definições de link/nota ([id]: url, [^1]: nota) podem estar no fim e serem usadas no começo: com elas a prévia
// mostraria texto cru, então esses textos não usam prévia.
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s/m

function insideFence(text, position) {
  const fences = text.slice(0, position).match(/^\s{0,3}(```|~~~)/gm)
  return (fences?.length ?? 0) % 2 === 1
}

// Devolve { preview, truncated }. truncated=false => o texto inteiro deve ser renderizado normalmente.
export function previewMarkdown(content, { target = PREVIEW_TARGET_CHARS } = {}) {
  const text = typeof content === 'string' ? content.replace(/\r\n/g, '\n') : ''
  if (text.length <= MAX_PREVIEW_CHARS || REFERENCE_DEFINITION.test(text)) {
    return { preview: text, truncated: false }
  }
  const boundaries = []
  const pattern = /\n[ \t]*\n/g
  for (let match = pattern.exec(text); match; match = pattern.exec(text))
    boundaries.push(match.index)
  const valid = boundaries.filter(
    (index) => index >= MIN_PREVIEW_CHARS && index <= MAX_PREVIEW_CHARS && !insideFence(text, index)
  )
  if (valid.length === 0) return { preview: text, truncated: false }
  // a fronteira mais próxima do alvo, preferindo a que ainda cabe até ele
  const upToTarget = valid.filter((index) => index <= target)
  const chosen = upToTarget.length > 0 ? Math.max(...upToTarget) : Math.min(...valid)
  const preview = text.slice(0, chosen).trimEnd()
  return { preview, truncated: preview.length < text.trimEnd().length }
}

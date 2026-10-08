// "Este texto precisa do renderizador de markdown?" Conservador de propósito: qualquer sinal de
// sintaxe (ênfase, código, listas, links, tabelas, HTML/entidades, quebra de linha, e-mail) manda
// o texto para o markdown de verdade; só uma linha de texto corrido sem nenhum desses sinais vai
// pelo caminho simples, cujo resultado visual é o mesmo (um único parágrafo, `pre-wrap`).
const MARKDOWN_HINT = /[*_`~#>[\]<|\\&@]|https?|www\.|[\r\n]|^\s*(?:[-+]|\d+[.)])\s/
export function needsMarkdown(text) {
  return typeof text === 'string' && MARKDOWN_HINT.test(text)
}

// Trecho em texto puro de uma publicação em markdown (para resumos de uma linha, como o destaque do topo do
// feed): remove a sintaxe, mantém o texto dos links e junta espaços e quebras de linha.
export function stripMarkdown(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~#>|\\]/g, '')
    .replace(/^\s*-{2,}\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

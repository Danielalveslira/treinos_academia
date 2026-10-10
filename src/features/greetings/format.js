export const DEFAULT_NAME = 'atleta'
export const DEFAULT_MAX_NAME_LENGTH = 20

// Caracteres de controle e de formatação invisíveis (inclui quebras de linha, zero-width e overrides de
// direção) nunca chegam ao cabeçalho: o nome vem do perfil e pode ter qualquer coisa.
const CONTROL = /\p{Cc}/gu // quebras de linha, tabs...: viram espaço
// zero-width, overrides de direção: somem. O ZWJ (U+200D) fica: é ele que cola emojis compostos (👨‍👩‍👧).
const INVISIBLE = /(?!\u200D)\p{Cf}/gu

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })
    : null

function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text)
}

// Texto puro e curto para interpolar. Não altera o dado do perfil; só o que é desenhado. Vazio => ''.
export function sanitizeName(raw, maxLength = DEFAULT_MAX_NAME_LENGTH) {
  if (typeof raw !== 'string') return ''
  const clean = raw.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  const parts = graphemes(clean)
  if (parts.length <= maxLength) return clean
  return `${parts
    .slice(0, Math.max(1, maxLength - 1))
    .join('')
    .trimEnd()}…`
}

// `{nome}` é o único marcador aceito. split/join (e não replace) para que `$&` e afins no nome não sejam
// interpretados como padrão de substituição.
export function formatGreetingText(template, name, maxLength = DEFAULT_MAX_NAME_LENGTH) {
  const display = sanitizeName(name, maxLength) || DEFAULT_NAME
  return template.split('{nome}').join(display)
}

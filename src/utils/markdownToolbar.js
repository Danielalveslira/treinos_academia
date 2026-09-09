// Lógica pura de inserção de sintaxe Markdown num textarea controlado (sem DOM aqui,
// só string + índices de seleção) — testável isoladamente e reutilizável pelo
// MarkdownField independente de qualquer biblioteca de editor.

function wrapSelection(value, start, end, marker, placeholder) {
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)
  const text = selected || placeholder
  const nextValue = `${before}${marker}${text}${marker}${after}`
  const selectionStart = before.length + marker.length
  const selectionEnd = selectionStart + text.length
  return { value: nextValue, selectionStart, selectionEnd }
}

function wrapLink(value, start, end) {
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)
  const label = selected || 'texto do link'
  const nextValue = `${before}[${label}](url)${after}`
  const urlStart = before.length + label.length + 3
  return { value: nextValue, selectionStart: urlStart, selectionEnd: urlStart + 3 }
}

// Aplica um prefixo a cada linha tocada pela seleção (citação, listas) — se nada
// estiver selecionado, prefixa só a linha do cursor.
function prefixLines(value, start, end, prefix) {
  let lineStart = value.lastIndexOf('\n', start - 1) + 1
  let lineEnd = value.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = value.length

  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const alreadyPrefixed = lines.every((line) => line.startsWith(prefix) || line.length === 0)
  const nextLines = lines.map((line) => {
    if (!line) return line
    return alreadyPrefixed ? line.slice(prefix.length) : `${prefix}${line}`
  })
  const nextBlock = nextLines.join('\n')
  const nextValue = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  const delta = nextBlock.length - block.length
  return { value: nextValue, selectionStart: lineStart, selectionEnd: lineEnd + delta }
}

export function applyMarkdownAction(action, value, start, end) {
  switch (action) {
    case 'bold':
      return wrapSelection(value, start, end, '**', 'negrito')
    case 'italic':
      return wrapSelection(value, start, end, '_', 'itálico')
    case 'code':
      return wrapSelection(value, start, end, '`', 'código')
    case 'quote':
      return prefixLines(value, start, end, '> ')
    case 'unorderedList':
      return prefixLines(value, start, end, '- ')
    case 'orderedList':
      return prefixLines(value, start, end, '1. ')
    case 'checklist':
      return prefixLines(value, start, end, '- [ ] ')
    case 'link':
      return wrapLink(value, start, end)
    default:
      return { value, selectionStart: start, selectionEnd: end }
  }
}

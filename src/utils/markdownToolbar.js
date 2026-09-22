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

export function normalizeMarkdownLinkUrl(value) {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input || input.startsWith('//')) return null

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function insertMarkdownLink(value, start, end, label, url) {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const safeLabel = (label || 'texto do link').replaceAll('[', '\\[').replaceAll(']', '\\]')
  const markdown = `[${safeLabel}](${url})`
  const cursor = before.length + markdown.length
  return { value: `${before}${markdown}${after}`, selectionStart: cursor, selectionEnd: cursor }
}

// Aplica um prefixo a cada linha tocada pela seleção (citação, listas) — se nada
// estiver selecionado, prefixa só a linha do cursor.
function prefixLines(value, start, end, prefix) {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  // A seleção termina antes do caractere em `end`, inclusive quando é outra linha.
  const lastSelected = end > start && value[end - 1] === '\n' ? end - 1 : end
  let lineEnd = value.indexOf('\n', lastSelected)
  if (lineEnd === -1) lineEnd = value.length

  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const alreadyPrefixed =
    lines.some((line) => line.startsWith(prefix)) &&
    lines.every((line) => line.startsWith(prefix) || line.length === 0)
  const nextLines = lines.map((line) => {
    if (!line) return lines.length === 1 && !alreadyPrefixed ? prefix : line
    return alreadyPrefixed ? line.slice(prefix.length) : `${prefix}${line}`
  })
  const nextBlock = nextLines.join('\n')
  const nextValue = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  const delta = nextBlock.length - block.length
  return { value: nextValue, selectionStart: lineStart, selectionEnd: lineEnd + delta }
}

function insertBlock(value, start, end, block, selectionOffset = block.length) {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const leadingBreak =
    before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''
  const trailingBreak =
    after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : ''
  const insertion = `${leadingBreak}${block}${trailingBreak}`
  const cursor = before.length + leadingBreak.length + selectionOffset
  return {
    value: `${before}${insertion}${after}`,
    selectionStart: cursor,
    selectionEnd: cursor,
  }
}

export function applyMarkdownAction(action, value, start, end) {
  switch (action) {
    case 'bold':
      return wrapSelection(value, start, end, '**', 'negrito')
    case 'italic':
      return wrapSelection(value, start, end, '_', 'itálico')
    case 'code':
      return wrapSelection(value, start, end, '`', 'código')
    case 'heading':
      return prefixLines(value, start, end, '## ')
    case 'quote':
      return prefixLines(value, start, end, '> ')
    case 'unorderedList':
      return prefixLines(value, start, end, '- ')
    case 'orderedList':
      return prefixLines(value, start, end, '1. ')
    case 'checklist':
      return prefixLines(value, start, end, '- [ ] ')
    case 'horizontalRule':
      return insertBlock(value, start, end, '---')
    case 'table': {
      const block = '| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Célula | Célula |'
      return insertBlock(value, start, end, block, 2)
    }
    default:
      return { value, selectionStart: start, selectionEnd: end }
  }
}

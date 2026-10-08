import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PREVIEW_TARGET_CHARS, previewMarkdown } from './markdownPreview.js'

const block = (i) =>
  `## Seção ${i}\n\nTexto da seção ${i} com **formatação** e mais um pouco de conteúdo para ocupar espaço.\n`
const doc = (n) => Array.from({ length: n }, (_, i) => block(i)).join('\n')

test('textos curtos e médios não usam prévia (renderizam inteiros)', () => {
  assert.deepEqual(previewMarkdown('oi'), { preview: 'oi', truncated: false })
  const medium = doc(20).slice(0, 3000)
  assert.equal(previewMarkdown(medium).truncated, false)
})

test('texto longo: prévia termina numa linha em branco, perto do alvo, e é prefixo do original', () => {
  const full = doc(80)
  assert.ok(full.length > 6000)
  const { preview, truncated } = previewMarkdown(full)
  assert.equal(truncated, true)
  assert.ok(full.startsWith(preview))
  assert.ok(
    preview.length <= PREVIEW_TARGET_CHARS,
    'não passa do alvo quando há fronteira antes dele'
  )
  assert.ok(preview.length > PREVIEW_TARGET_CHARS - 400, 'e fica perto dele')
  assert.ok(
    /\n[ \t]*\n/.test(full.slice(preview.length, preview.length + 3)) ||
      full[preview.length] === '\n'
  )
})

test('uma tabela nunca é partida ao meio (não há linha em branco dentro dela)', () => {
  const rows = Array.from({ length: 60 }, (_, i) => `| linha ${i} | valor ${i} |`).join('\n')
  const full = `Intro curta\n\n| A | B |\n| - | - |\n${rows}\n\nFim do documento ${'x'.repeat(2500)}`
  const { preview, truncated } = previewMarkdown(full)
  // só há fronteiras antes e depois da tabela: ou a prévia acaba antes dela, ou depois dela inteira
  if (truncated) {
    const tableStart = full.indexOf('| A | B |')
    const tableEnd = full.indexOf('\n\nFim do documento')
    assert.ok(preview.length <= tableStart || preview.length >= tableEnd, 'corte fora da tabela')
  }
})

test('bloco de código cercado não é partido (linha em branco dentro dele não é fronteira)', () => {
  const code = Array.from(
    { length: 80 },
    (_, i) => `linha de código ${i}\n\nlinha com branco ${i}`
  ).join('\n')
  const full = `Intro\n\n\`\`\`js\n${code}\n\`\`\`\n\nDepois ${'y'.repeat(3000)}`
  const { preview, truncated } = previewMarkdown(full)
  const fences = (preview.match(/^```/gm) || []).length
  assert.equal(fences % 2, 0, 'a prévia nunca termina com um bloco de código aberto')
  if (!truncated) assert.equal(preview.length, full.replace(/\r\n/g, '\n').length)
})

test('texto com definições de link/nota no fim não usa prévia (as referências do começo ficariam cruas)', () => {
  const full = `${doc(80)}\n\n[1]: https://evolutus.app\n`
  assert.equal(previewMarkdown(full).truncated, false)
})

test('sem nenhuma fronteira segura na faixa útil, renderiza inteiro (nunca corta no meio de um parágrafo)', () => {
  const solid = 'palavra '.repeat(1500)
  assert.equal(previewMarkdown(solid).truncated, false)
})

test('quebras CRLF são tratadas como LF', () => {
  const full = doc(80).replace(/\n/g, '\r\n')
  assert.equal(previewMarkdown(full).truncated, true)
})

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { STATUS_TEXT_MAX_LENGTH } from '../utils/statusLimits.js'

let directory
let render
let renderAsync
let MarkdownViewer
let AchievementSummary
let MarkdownField
let StatusText

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markdown-tests-'))
  const outfile = join(directory, 'components.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup, renderToPipeableStream } from 'react-dom/server'
        import { Writable } from 'node:stream'
        export { MarkdownViewer } from './MarkdownViewer.jsx'
        export { AchievementSummary } from './AchievementSummary.jsx'
        export { MarkdownField } from './MarkdownField.jsx'
        export { StatusText } from './StatusText.jsx'
        export const render = (component, props) => renderToStaticMarkup(createElement(component, props))
        // Texto de publicação/conquista carrega o renderizador de markdown sob demanda (lazy): o streaming
        // espera o chunk resolver (onAllReady) e devolve o HTML final, sem depender de ordem entre testes.
        export const renderAsync = (component, props) => new Promise((resolve, reject) => {
          const chunks = []
          const { pipe } = renderToPipeableStream(createElement(component, props), {
            onAllReady() {
              pipe(new Writable({
                write(chunk, _encoding, done) { chunks.push(chunk); done() },
                final(done) { resolve(Buffer.concat(chunks).toString()); done() },
              }))
            },
            onError: reject,
          })
        })
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  ;({ render, renderAsync, MarkdownViewer, AchievementSummary, MarkdownField, StatusText } =
    createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('renders Markdown formatting, tables and checked and unchecked tasks', () => {
  const html = render(MarkdownViewer, {
    value:
      '**Forte** e _leve_\n\n- [x] Feito\n- [ ] Pendente\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```\ncódigo\n```',
  })
  assert.match(html, /<strong>Forte<\/strong>/)
  assert.match(html, /<em>leve<\/em>/)
  assert.match(html, /<table>/)
  assert.match(html, /<pre><code>código\n<\/code><\/pre>/)
  const inputs = html.match(/<input[^>]+>/g)
  assert.equal(inputs.length, 2)
  assert.match(inputs[0], /checked=""/)
  assert.doesNotMatch(inputs[1], /checked=/)
  assert.ok(inputs.every((input) => input.includes('disabled=""')))
  assert.doesNotMatch(html, /node="/)
})

test('blocks raw HTML and unsafe URLs while preserving safe links', () => {
  const html = render(MarkdownViewer, {
    value:
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert) [data](data:text/html,evil) [safe](https://example.com)\n\n![image](javascript:alert)',
  })
  assert.doesNotMatch(html, /<script|onerror|javascript:|data:text\/html/)
  assert.match(html, /href="https:\/\/example.com"/)
  assert.match(html, /rel="noreferrer noopener"/)
})

test('does not render wrappers for empty or missing content', () => {
  for (const value of ['', ' \n ', null, undefined]) {
    assert.equal(render(MarkdownViewer, { value }), '')
  }
  assert.equal(render(AchievementSummary, {}), '')
  assert.equal(render(AchievementSummary, { achievement: { entries: 0, sets: 0, text: ' ' } }), '')
})

test('written achievements retain their trophy, title and Markdown without empty statistics', async () => {
  const html = await renderAsync(AchievementSummary, {
    achievement: { day: '2026-09-09', entries: 0, sets: 0, text: '**Voltei!**' },
  })
  assert.match(html, /<section class="achievement-summary"/)
  assert.match(html, /octicon-trophy/)
  assert.match(html, />Conquista</)
  assert.doesNotMatch(html, /Conquista do dia/)
  assert.match(html, /<strong>Voltei!<\/strong>/)
  assert.doesNotMatch(html, /achievement-stats|<dl|Registros de exercícios|Séries realizadas/)
})

test('saved achievements retain their original date, totals and Markdown', async () => {
  const html = await renderAsync(AchievementSummary, {
    achievement: { day: '2025-01-01', entries: 3, sets: 12, text: '**Treino**\nfinalizado' },
  })
  assert.match(html, /<section class="achievement-summary"/)
  assert.match(html, /dateTime="2025-01-01"/)
  assert.match(html, /<dd>3<\/dd>/)
  assert.match(html, /<dd>12<\/dd>/)
  assert.match(html, /<strong>Treino<\/strong>\nfinalizado/)
})

test('editor associates label, caption, requirement and validation with the textarea', () => {
  const html = render(MarkdownField, {
    label: 'Mensagem',
    value: '',
    onChange: () => {},
    required: true,
    error: 'Preencha a mensagem.',
  })
  const id = html.match(/<textarea[^>]* id="([^"]+)"/)[1]
  assert.ok(html.includes(`for="${id}"`))
  assert.ok(html.includes(`aria-describedby="${id}-caption ${id}-validationMessage"`))
  assert.match(html, /aria-required="true"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /rows="5"/)
  assert.match(html, new RegExp(`>0 / ${STATUS_TEXT_MAX_LENGTH}<`))
  assert.match(
    html,
    new RegExp(`maxLength="${STATUS_TEXT_MAX_LENGTH}"|maxlength="${STATUS_TEXT_MAX_LENGTH}"`)
  )
  assert.match(html, /Mais opções de formatação/)
})

test('StatusText: texto corrido simples usa o mesmo contêiner, sem passar pelo renderizador de markdown', () => {
  const html = render(StatusText, { value: 'Treino finalizado hoje!' })
  assert.match(html, /<p>Treino finalizado hoje!<\/p>/)
  assert.equal(render(StatusText, { value: '   ' }), '')
  assert.equal(render(StatusText, { value: null }), '')
})

test('StatusText: texto com markdown mostra o próprio texto enquanto o chunk carrega e o renderizado depois', async () => {
  const eager = await renderAsync(StatusText, { value: 'Hoje: **sem desculpas**' })
  assert.match(eager, /<strong>sem desculpas<\/strong>/)
  // fallback (síncrono) nunca fica em branco: mostra o texto cru em pre-wrap
  const sync = render(StatusText, { value: 'Hoje: _sem_ desculpas', sx: { mt: 2 } })
  assert.match(sync, /Hoje: /)
})

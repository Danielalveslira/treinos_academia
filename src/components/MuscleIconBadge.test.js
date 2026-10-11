import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'muscle-icon-badge-component-'))
  const outfile = join(directory, 'component.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { Dumbbell } from 'lucide-react'
        import { MuscleIconBadge } from './MuscleIconBadge.jsx'
        export const render = (props) =>
          renderToStaticMarkup(createElement(MuscleIconBadge, { icon: Dumbbell, ...props }))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('badge padrão é tamanho "md" e tom "solid"', () => {
  const html = render()
  assert.match(html, /muscle-icon-badge--md/)
  assert.match(html, /muscle-icon-badge--solid/)
})

test('size "sm" usa um ícone visualmente menor que o padrão', () => {
  const sm = render({ size: 'sm' })
  const md = render({ size: 'md' })
  assert.match(sm, /muscle-icon-badge--sm/)
  assert.match(sm, /width="14"/)
  assert.match(md, /width="20"/)
})

test('tom "muted" (músculo secundário) usa a classe correspondente, nunca a solid', () => {
  const html = render({ tone: 'muted' })
  assert.match(html, /muscle-icon-badge--muted/)
  assert.doesNotMatch(html, /muscle-icon-badge--solid/)
})

test('é só apoio visual -- fica fora da árvore de acessibilidade (o nome textual é renderizado por quem usa o badge)', () => {
  const html = render()
  assert.match(html, /aria-hidden="true"/)
})

test('className extra é preservada junto das classes do badge', () => {
  const html = render({ className: 'catalog-card-muscle-mark' })
  assert.match(html, /catalog-card-muscle-mark/)
  assert.match(html, /muscle-icon-badge/)
})

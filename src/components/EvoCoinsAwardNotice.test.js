import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// View pura (só props): sem hooks, sem Supabase -- mesmo padrão de WalletHeaderBadges.test.js.
let directory
let renderStatic
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evocoin-notice-tests-'))
  const outfile = join(directory, 'evocoin-notice.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { EvoCoinsAwardNoticeView } from './EvoCoinsAwardNotice.jsx'
        export const renderStatic = (props) => renderToStaticMarkup(createElement(EvoCoinsAwardNoticeView, props))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
        DEV: false,
      }),
    },
  })
  ;({ renderStatic } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('sem mensagem não renderiza nada (nenhum espaço reservado na tela)', () => {
  assert.equal(renderStatic({ message: null }), '')
})

test('mostra a mensagem como status discreto e não interativo', () => {
  const html = renderStatic({ message: '+3 EvoCoins' })
  assert.match(html, /\+3 EvoCoins/)
  assert.match(html, /role="status"/)
  assert.match(html, /aria-live="polite"/)
  assert.doesNotMatch(html, /<button|<a |tabindex/i, 'nunca captura foco nem cliques')
})

test('nunca renderiza emoji', () => {
  const html = renderStatic({ message: '+1 EvoCoin' })
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
})

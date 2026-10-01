import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Mesmo padrão de ProtectedRoute.test.js: AuthContext.Provider mockado + MemoryRouter,
// renderToStaticMarkup. /admin/compras-evocash (e todas as outras rotas /admin/*) usam
// este MESMO componente compartilhado -- testar SuperAdminRoute aqui é o que garante,
// de fato, que um usuário comum nunca alcança o conteúdo administrativo pelo
// roteamento/UI, não só pelas RLS do Postgres.
let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'superadmin-route-tests-'))
  const outfile = join(directory, 'route.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { AuthContext } from '../contexts/AuthContext.jsx'
        import { SuperAdminRoute } from './SuperAdminRoute.jsx'
        export const render = (authValue) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null,
            createElement(AuthContext.Provider, { value: authValue },
              createElement(SuperAdminRoute, null, createElement('div', null, 'CONTEUDO_ADMIN')))))))
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
    // SuperAdminRoute -> AuthContext.jsx -> supabase/config.js, que lê
    // import.meta.env.VITE_* (só existe via Vite em dev/build real). Mesmo bloco de
    // ProtectedRoute.test.js -- só createClient() precisa não explodir ao montar.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
        DEV: false,
      }),
    },
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('a regular (non-superadmin) user never sees admin content -- redirected instead', () => {
  const html = render({ isSuperAdmin: false, loading: false })
  assert.doesNotMatch(html, /CONTEUDO_ADMIN/)
})

test('while auth is still loading, a neutral spinner shows -- never the admin content, never a premature redirect', () => {
  const html = render({ isSuperAdmin: false, loading: true })
  assert.doesNotMatch(html, /CONTEUDO_ADMIN/)
})

test('a superadmin sees the admin content', () => {
  const html = render({ isSuperAdmin: true, loading: false })
  assert.match(html, /CONTEUDO_ADMIN/)
})

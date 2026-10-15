import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Mesmo padrão de AccountMenu.test.js/RowActionsMenu.test.js: adminNavItems é pura
// (sem Portal), mas vive num .jsx que também exporta o componente AdminNav (que importa
// ActionMenu/Link) -- Node não faz parse de JSX nativamente, então passa por esbuild
// mesmo só para ler a função pura. ADMIN_ITEMS vem de constants/adminNav.js (módulo puro,
// sem hooks/Supabase), então nenhum stub de useAuth/useColorMode é necessário aqui.
let directory
let mod
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-nav-tests-'))
  const outfile = join(directory, 'adminnav.cjs')
  await build({
    stdin: {
      contents: `
        import { adminNavItems } from './AdminNav.jsx'
        import { ADMIN_ITEMS } from '../constants/adminNav.js'
        export { adminNavItems, ADMIN_ITEMS }
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
  mod = createRequire(import.meta.url)(outfile)
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('adminNavItems remove apenas a página atual, preservando ordem e rótulos', () => {
  const items = mod.adminNavItems('/admin/contas')
  assert.equal(items.length, mod.ADMIN_ITEMS.length - 1)
  assert.equal(
    items.some((item) => item.to === '/admin/contas'),
    false
  )
  assert.deepEqual(
    items.map((item) => item.to),
    mod.ADMIN_ITEMS.map((item) => item.to).filter((to) => to !== '/admin/contas')
  )
})

test('adminNavItems com rota desconhecida devolve as 9 rotas intactas', () => {
  assert.equal(mod.adminNavItems('/admin/rota-inexistente').length, mod.ADMIN_ITEMS.length)
})

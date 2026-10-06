import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let moduleUnderTest

// supabase/config.js instancia um client real (precisa de VITE_SUPABASE_URL/ANON_KEY) e
// o resolvedor ESM puro do node --test não aceita o import sem extensão (`../supabase/
// config`) que o resto do app usa via bundler (Vite) -- mockar aqui é dívida de teste
// pré-existente no projeto, então só stubamos o
// necessário pro módulo carregar; uniqueCommunityAuthorIds (função pura) é a única coisa
// testada sem precisar simular canal/postgres_changes de verdade.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-avatars-'))
  const outfile = join(directory, 'avatars.cjs')
  await build({
    stdin: {
      contents: `export { uniqueCommunityAuthorIds } from './useCommunityAuthorAvatars.js'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'supabase-config-stub',
        setup(context) {
          context.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'config',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^config$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = {}`,
          }))
        },
      },
    ],
  })
  moduleUnderTest = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('uniqueCommunityAuthorIds agrupa e ordena autores sem duplicar', () => {
  const result = moduleUnderTest.uniqueCommunityAuthorIds(
    [{ authorId: 'bia' }, { authorId: 'ana' }, { authorId: 'ana' }],
    [{ authorId: 'caio' }, { authorId: null }]
  )
  assert.deepEqual(result, ['ana', 'bia', 'caio'])
})

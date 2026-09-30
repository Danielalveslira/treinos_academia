import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let service

// exerciseCatalogService.js agora é uma camada fina sobre public.exercise_catalog --
// sem cache local, sem proxy externo. supabase/config.js não existe de verdade em
// node --test (precisa de VITE_SUPABASE_URL do Vite) -- é trocado por um cliente fake
// controlável via globalThis.__supabaseCalls/__rpcResult/__fromResult, mesmo padrão de
// stub via esbuild usado no resto do projeto (ver WorkoutExerciseGuide.test.js).
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'exercise-catalog-service-'))
  const outfile = join(directory, 'service.cjs')
  await build({
    stdin: {
      contents: "export * as service from './exerciseCatalogService.js'",
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    bundle: true,
    write: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'supabase-config-stub',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'stub',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              export const supabase = {
                rpc: (name, params) => {
                  globalThis.__supabaseCalls.push({ kind: 'rpc', name, params })
                  return Promise.resolve(globalThis.__rpcResult)
                },
                from: (table) => {
                  const call = { kind: 'from', table, filters: {} }
                  globalThis.__supabaseCalls.push(call)
                  const builder = {
                    select: () => builder,
                    eq: (column, value) => { call.filters[column] = value; return builder },
                    maybeSingle: () => Promise.resolve(globalThis.__fromResult),
                    then: (resolve) => resolve(globalThis.__fromResult),
                  }
                  return builder
                },
              }
            `,
          }))
        },
      },
    ],
  })
  ;({ service } = require(outfile))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  globalThis.__supabaseCalls = []
  globalThis.__rpcResult = { data: [], error: null }
  globalThis.__fromResult = { data: null, error: null }
})

const rawRow = {
  id: 'catalog-uuid-1',
  provider: 'evolutus_dataset',
  provider_exercise_id: 'Bench_Press',
  name: 'Supino Reto com Barra',
  primary_muscle: 'peito',
  muscles: ['peito', 'triceps'],
  equipment: 'barra',
  category: 'forca',
  difficulty: 'iniciante',
  force: 'push',
  mechanic: 'composto',
  instructions: ['Deite no banco.', 'Empurre a barra.'],
  media_refs: { images: ['Bench_Press/0.jpg'] },
  total_count: 1,
}

test('searchExercises chama a RPC com os parâmetros certos e mapeia as linhas pro shape da UI', async () => {
  globalThis.__rpcResult = { data: [rawRow], error: null }
  const { data, total } = await service.searchExercises({ q: 'supino', category: 'forca', limit: 20, offset: 0 })

  assert.equal(globalThis.__supabaseCalls[0].kind, 'rpc')
  assert.equal(globalThis.__supabaseCalls[0].name, 'search_exercise_catalog')
  assert.deepEqual(globalThis.__supabaseCalls[0].params, {
    p_query: 'supino', p_category: 'forca', p_equipment: null, p_muscle: null,
    p_difficulty: null, p_limit: 20, p_offset: 0,
  })

  assert.equal(total, 1)
  assert.deepEqual(data[0], {
    id: 'catalog-uuid-1',
    providerExerciseId: 'Bench_Press',
    provider: 'evolutus_dataset',
    name: 'Supino Reto com Barra',
    primaryMuscles: ['peito'],
    secondaryMuscles: ['triceps'],
    equipment: 'barra',
    category: 'forca',
    level: 'iniciante',
    force: 'push',
    mechanic: 'composto',
    instructions: ['Deite no banco.', 'Empurre a barra.'],
    images: ['Bench_Press/0.jpg'],
  })
})

test('searchExercises devolve total 0 quando não há resultado (nunca lança em lista vazia)', async () => {
  globalThis.__rpcResult = { data: [], error: null }
  const { data, total } = await service.searchExercises({ limit: 20, offset: 0 })
  assert.deepEqual(data, [])
  assert.equal(total, 0)
})

test('searchExercises propaga erro da RPC (rate limit do Postgres, indisponibilidade, etc.)', async () => {
  globalThis.__rpcResult = { data: null, error: { message: 'boom' } }
  await assert.rejects(() => service.searchExercises({ limit: 20, offset: 0 }))
})

test('getExerciseDetail busca por catalogId (PK direta) quando disponível', async () => {
  globalThis.__fromResult = { data: rawRow, error: null }
  const result = await service.getExerciseDetail({ catalogId: 'catalog-uuid-1' })

  const fromCall = globalThis.__supabaseCalls.find((call) => call.kind === 'from')
  assert.deepEqual(fromCall.filters, { id: 'catalog-uuid-1' })
  assert.equal(result.name, 'Supino Reto com Barra')
  assert.deepEqual(result.images, ['Bench_Press/0.jpg'])
})

test('getExerciseDetail cai pra provider + providerExerciseId sem catalogId', async () => {
  globalThis.__fromResult = { data: rawRow, error: null }
  await service.getExerciseDetail({ provider: 'evolutus_dataset', providerExerciseId: 'Bench_Press' })

  const fromCall = globalThis.__supabaseCalls.find((call) => call.kind === 'from')
  assert.deepEqual(fromCall.filters, { provider: 'evolutus_dataset', provider_exercise_id: 'Bench_Press' })
})

test('getExerciseDetail devolve null quando o item não existe mais no catálogo -- nunca lança', async () => {
  globalThis.__fromResult = { data: null, error: null }
  const result = await service.getExerciseDetail({ catalogId: 'missing' })
  assert.equal(result, null)
})

test('listCatalogTaxonomy agrega músculos/equipamentos distintos e cacheia entre chamadas', async () => {
  globalThis.__fromResult = {
    data: [
      { muscles: ['peito', 'triceps'], equipment: 'barra' },
      { muscles: ['peito'], equipment: null },
      { muscles: ['quadriceps'], equipment: 'barra' },
    ],
    error: null,
  }
  const first = await service.listCatalogTaxonomy()
  assert.deepEqual(first.muscles, ['peito', 'quadriceps', 'triceps'])
  assert.deepEqual(first.equipment, ['barra'])

  const callsBefore = globalThis.__supabaseCalls.length
  const second = await service.listCatalogTaxonomy()
  assert.deepEqual(second, first)
  assert.equal(globalThis.__supabaseCalls.length, callsBefore, 'segunda chamada não deve consultar o banco de novo')
})

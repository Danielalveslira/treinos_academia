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
                storage: {
                  from: (bucket) => ({
                    getPublicUrl: (path) => ({ data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/' + bucket + '/' + path } }),
                  }),
                },
                from: (table) => {
                  const call = { kind: 'from', table, filters: {} }
                  globalThis.__supabaseCalls.push(call)
                  const builder = {
                    select: (columns) => { call.select = columns; return builder },
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

const CATALOG = '11111111-2222-3333-4444-555555555555'
const BASE = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals'
const PUBLISHED = {
  version: 3,
  images: [
    { role: 'end', path: `${CATALOG}/v3/end.webp` },
    { role: 'start', path: `${CATALOG}/v3/start.webp` },
  ],
  thumbnail: { path: `${CATALOG}/v3/thumb.webp` },
}

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
  source_media_refs: { images: ['Bench_Press/0.jpg', 'Bench_Press/1.jpg'] },
  published_media_refs: PUBLISHED,
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
    images: [`${BASE}/${CATALOG}/v3/start.webp`, `${BASE}/${CATALOG}/v3/end.webp`],
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
  assert.deepEqual(result.images, [`${BASE}/${CATALOG}/v3/start.webp`, `${BASE}/${CATALOG}/v3/end.webp`])
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
      { muscles: ['peito', 'triceps'], equipment: 'barra', category: 'forca', difficulty: 'iniciante' },
      { muscles: ['peito'], equipment: null, category: 'forca', difficulty: null },
      { muscles: ['quadriceps'], equipment: 'barra', category: 'cardio', difficulty: 'avancado' },
    ],
    error: null,
  }
  const first = await service.listCatalogTaxonomy()
  assert.deepEqual(first.muscles, ['peito', 'quadriceps', 'triceps'])
  assert.deepEqual(first.equipment, ['barra'])
  assert.deepEqual(first.categories, ['cardio', 'forca'])
  assert.deepEqual(first.levels, ['avancado', 'iniciante'])

  const callsBefore = globalThis.__supabaseCalls.length
  const second = await service.listCatalogTaxonomy()
  assert.deepEqual(second, first)
  assert.equal(globalThis.__supabaseCalls.length, callsBefore, 'segunda chamada não deve consultar o banco de novo')
})

test('nome com acento/cedilha nunca é normalizado na apresentação -- só a query de busca é normalizada', async () => {
  const accentedRow = { ...rawRow, name: 'Abraçar a Bola', provider_exercise_id: 'Hug_A_Ball' }
  globalThis.__rpcResult = { data: [accentedRow], error: null }
  const { data } = await service.searchExercises({ q: 'abracar', limit: 20, offset: 0 })

  // A query enviada à RPC pode/deve ser normalizada lá dentro (pg_trgm + unaccent) --
  // mas o texto que o usuário digitou nunca é alterado no client antes de enviar, e o
  // nome que volta pra UI é exatamente o que a RPC devolveu, sem nenhum unaccent/
  // toLowerCase aplicado no caminho.
  assert.equal(globalThis.__supabaseCalls[0].params.p_query, 'abracar')
  assert.equal(data[0].name, 'Abraçar a Bola')
})


test('resolveExercisePublishedImages devolve start e end (nessa ordem) como URLs públicas do bucket', () => {
  assert.deepEqual(service.resolveExercisePublishedImages(PUBLISHED), [
    `${BASE}/${CATALOG}/v3/start.webp`,
    `${BASE}/${CATALOG}/v3/end.webp`,
  ])
})

test('resolveExercisePublishedImages sem mídia publicada devolve lista vazia (UI cai no placeholder)', () => {
  assert.deepEqual(service.resolveExercisePublishedImages({ images: [] }), [])
  assert.deepEqual(service.resolveExercisePublishedImages(undefined), [])
  assert.deepEqual(service.resolveExercisePublishedImages(null), [])
  assert.deepEqual(service.resolveExercisePublishedImages({ images: 'x' }), [])
})

test('resolveExercisePublishedImages ignora paths fora do formato publicado (nunca vira URL)', () => {
  const refs = {
    images: [
      { role: 'start', path: 'Bench_Press/0.jpg' },
      { role: 'end', path: `${CATALOG}/v3/../../secret.webp` },
      { role: 'start', path: `https://evil.example/${CATALOG}/v1/start.webp` },
      { role: 'end', path: 42 },
    ],
  }
  assert.deepEqual(service.resolveExercisePublishedImages(refs), [])
})

test('exercício sem published_media_refs mapeia images vazio mesmo que o dataset tenha referências', async () => {
  globalThis.__rpcResult = { data: [{ ...rawRow, published_media_refs: { images: [] } }], error: null }
  const { data } = await service.searchExercises({ limit: 20, offset: 0 })
  assert.deepEqual(data[0].images, [])
})

test('getExerciseDetail seleciona published_media_refs e nunca a coluna removida media_refs', async () => {
  globalThis.__fromResult = { data: rawRow, error: null }
  await service.getExerciseDetail({ catalogId: 'catalog-uuid-1' })
  const fromCall = globalThis.__supabaseCalls.find((call) => call.kind === 'from')
  assert.equal(fromCall.table, 'exercise_catalog')
  assert.match(fromCall.select, /\bpublished_media_refs\b/)
  assert.doesNotMatch(fromCall.select, /(^|[ ,])media_refs/)
})

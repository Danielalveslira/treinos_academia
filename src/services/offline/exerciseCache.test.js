import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, withoutIndexedDb } from './testSupport.js'
import { openDatabase } from './database.js'
import {
  cacheCatalogEntries,
  cacheCatalogTaxonomy,
  normalizeSearchValue,
  readCachedCatalogEntry,
  readCachedCatalogTaxonomy,
  searchCachedCatalog,
} from './exerciseCache.js'

beforeEach(freshDatabase)

// Mesmo formato de mapRow() em exerciseCatalogService.
const exercise = (id, name, overrides = {}) => ({
  id,
  providerExerciseId: `ext-${id}`,
  provider: 'evolutus',
  name,
  primaryMuscles: ['peito'],
  secondaryMuscles: ['triceps'],
  equipment: 'barra',
  category: 'forca',
  level: 'iniciante',
  force: 'push',
  mechanic: 'composto',
  instructions: ['Deite.', 'Empurre.'],
  images: ['x/0.jpg'],
  ...overrides,
})

test('normalizeSearchValue segue a normalização do servidor: minúsculas, sem acento, espaços colapsados', () => {
  assert.equal(normalizeSearchValue('  Supíno   INCLINÁDO  Ção '), 'supino inclinado cao')
  assert.equal(normalizeSearchValue(null), '')
})

test('grava e lê o catálogo no formato do app (sem campos internos de cache)', async () => {
  assert.equal(await cacheCatalogEntries([exercise('c1', 'Supino Reto')]), true)
  const detail = await readCachedCatalogEntry({ catalogId: 'c1' })
  assert.deepEqual(detail, exercise('c1', 'Supino Reto'))
  assert.ok(!('nameKey' in detail) && !('cachedAt' in detail))
})

test('upsert não duplica: gravar o mesmo id várias vezes mantém um registro e atualiza o conteúdo', async () => {
  await cacheCatalogEntries([exercise('c1', 'Supino Reto'), exercise('c2', 'Agachamento')])
  await cacheCatalogEntries([exercise('c1', 'Supino Reto Barra', { equipment: 'halter' })])
  await cacheCatalogEntries([exercise('c1', 'Supino Reto Barra', { equipment: 'halter' })])
  const rows = await rawAll('exerciseCatalog')
  assert.equal(rows.length, 2)
  assert.equal((await readCachedCatalogEntry({ catalogId: 'c1' })).equipment, 'halter')
})

test('linha recriada no catálogo (novo id, mesmo provider/id externo) substitui a antiga', async () => {
  await cacheCatalogEntries([exercise('old', 'Remada', { providerExerciseId: 'same' })])
  await cacheCatalogEntries([exercise('new', 'Remada', { providerExerciseId: 'same' })])
  const rows = await rawAll('exerciseCatalog')
  assert.deepEqual(
    rows.map((row) => row.id),
    ['new']
  )
  const byProvider = await readCachedCatalogEntry({
    provider: 'evolutus',
    providerExerciseId: 'same',
  })
  assert.equal(byProvider.id, 'new')
})

test('detalhe: ausente no cache devolve undefined (não significa que não existe no catálogo)', async () => {
  assert.equal(await readCachedCatalogEntry({ catalogId: 'nope' }), undefined)
  assert.equal(await readCachedCatalogEntry({}), undefined)
})

test('entradas inválidas são ignoradas e lote vazio não grava nada', async () => {
  await openDatabase()
  assert.equal(await cacheCatalogEntries([]), false)
  assert.equal(await cacheCatalogEntries([null, { name: 'sem id' }, { id: '', name: 'x' }]), false)
  assert.equal((await rawAll('exerciseCatalog')).length, 0)
})

test('busca local ignora acento e caixa, como a busca do servidor', async () => {
  await cacheCatalogEntries([
    exercise('c1', 'Supino Inclinado'),
    exercise('c2', 'Elevação Lateral', { primaryMuscles: ['ombros'], secondaryMuscles: [] }),
    exercise('c3', 'Agachamento Livre', {
      primaryMuscles: ['quadriceps'],
      secondaryMuscles: ['gluteos'],
      category: 'pernas',
    }),
  ])
  assert.deepEqual(
    (await searchCachedCatalog({ q: 'ELEVACAO' })).data.map((e) => e.id),
    ['c2']
  )
  assert.deepEqual(
    (await searchCachedCatalog({ q: 'elevação lat' })).data.map((e) => e.id),
    ['c2']
  )
  assert.deepEqual(
    (await searchCachedCatalog({ q: 'inclinádo' })).data.map((e) => e.id),
    ['c1']
  )
})

test('busca local aplica os mesmos filtros da RPC (categoria, equipamento, nível, músculo primário ou secundário)', async () => {
  await cacheCatalogEntries([
    exercise('c1', 'Supino Reto'),
    exercise('c2', 'Crucifixo', {
      equipment: 'halter',
      level: 'avancado',
      secondaryMuscles: ['ombros'],
    }),
    exercise('c3', 'Agachamento', {
      primaryMuscles: ['quadriceps'],
      secondaryMuscles: ['gluteos'],
      category: 'pernas',
    }),
  ])
  const ids = async (filters) => (await searchCachedCatalog(filters)).data.map((e) => e.id)
  assert.deepEqual(await ids({ category: 'pernas' }), ['c3'])
  assert.deepEqual(await ids({ equipment: 'halter' }), ['c2'])
  assert.deepEqual(await ids({ level: 'avancado' }), ['c2'])
  assert.deepEqual(await ids({ muscle: 'gluteos' }), ['c3'])
  assert.deepEqual(await ids({ muscle: 'ombros' }), ['c2'])
  assert.deepEqual(await ids({ muscle: 'peito', equipment: 'barra' }), ['c1'])
})

test('busca local pagina, ordena por nome, limita a 50 e informa o total', async () => {
  await cacheCatalogEntries(
    Array.from({ length: 60 }, (_, i) =>
      exercise(`c${i}`, `Exercicio ${String(i).padStart(2, '0')}`)
    )
  )
  const first = await searchCachedCatalog({ limit: 20 })
  assert.equal(first.total, 60)
  assert.equal(first.data.length, 20)
  assert.equal(first.data[0].name, 'Exercicio 00')
  const second = await searchCachedCatalog({ limit: 20, offset: 20 })
  assert.equal(second.data[0].name, 'Exercicio 20')
  assert.equal((await searchCachedCatalog({ limit: 999 })).data.length, 50)
})

test('busca local sem nenhum resultado devolve undefined (nunca um "vazio" enganoso de cache parcial)', async () => {
  await cacheCatalogEntries([exercise('c1', 'Supino Reto')])
  assert.equal(await searchCachedCatalog({ q: 'inexistente' }), undefined)
  await freshDatabase()
  assert.equal(await searchCachedCatalog({}), undefined)
})

test('o catálogo é público: não guarda nenhum campo de usuário', async () => {
  await cacheCatalogEntries([exercise('c1', 'Supino Reto')])
  const [row] = await rawAll('exerciseCatalog')
  assert.ok(!('user_id' in row))
})

test('registros não reconfirmados pelo servidor há mais de 90 dias saem na próxima gravação', async () => {
  const day = 86400000
  const t0 = Date.UTC(2026, 0, 1)
  await cacheCatalogEntries([exercise('velho', 'Antigo')], t0)
  await cacheCatalogEntries([exercise('novo', 'Recente')], t0 + 91 * day)
  assert.deepEqual(
    (await rawAll('exerciseCatalog')).map((row) => row.id),
    ['novo']
  )
})

test('taxonomia: grava e lê; ausente devolve undefined', async () => {
  assert.equal(await readCachedCatalogTaxonomy(), undefined)
  const taxonomy = {
    muscles: ['peito'],
    equipment: ['barra'],
    categories: ['forca'],
    levels: ['iniciante'],
  }
  assert.equal(await cacheCatalogTaxonomy(taxonomy), true)
  assert.deepEqual(await readCachedCatalogTaxonomy(), taxonomy)
  assert.equal(await cacheCatalogTaxonomy(null), false)
})

test('IndexedDB indisponível: nenhuma função lança, todas degradam para "sem cache"', async () => {
  const restore = withoutIndexedDb()
  try {
    assert.equal(await cacheCatalogEntries([exercise('c1', 'Supino')]), false)
    assert.equal(await searchCachedCatalog({ q: 'supino' }), undefined)
    assert.equal(await readCachedCatalogEntry({ catalogId: 'c1' }), undefined)
    assert.equal(await cacheCatalogTaxonomy({ muscles: [] }), false)
    assert.equal(await readCachedCatalogTaxonomy(), undefined)
  } finally {
    restore()
  }
})

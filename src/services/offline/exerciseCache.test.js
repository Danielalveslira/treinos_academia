import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, withoutIndexedDb } from './testSupport.js'
import { openDatabase } from './database.js'
import {
  cacheCatalogEntries,
  cacheCatalogTaxonomy,
  deriveCatalogTaxonomyFromSnapshot,
  isCatalogSnapshotComplete,
  normalizeSearchValue,
  readCachedCatalogEntry,
  readCachedCatalogTaxonomy,
  readCatalogSnapshotMeta,
  readCatalogSnapshotTaxonomy,
  replaceCatalogSnapshot,
  searchCachedCatalog,
  touchCatalogSnapshotCheckedAt,
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
  thumbnail: null,
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

test('replaceCatalogSnapshot: grava tudo, marca complete=true e remove quem não está mais ativo (delete diff)', async () => {
  await cacheCatalogEntries([exercise('old', 'Vai sair')]) // entrada oportunista anterior
  assert.equal(
    await replaceCatalogSnapshot([exercise('c1', 'Supino Reto'), exercise('c2', 'Agachamento')], {
      revision: 'rev-1',
    }),
    true
  )
  assert.deepEqual(
    (await rawAll('exerciseCatalog')).map((row) => row.id).sort(),
    ['c1', 'c2']
  )
  const meta = await readCatalogSnapshotMeta()
  assert.equal(meta.complete, true)
  assert.equal(meta.revision, 'rev-1')
  assert.equal(meta.totalActive, 2)
  assert.equal(await isCatalogSnapshotComplete(), true)
})

test('readCatalogSnapshotMeta: undefined quando nunca houve snapshot completo neste aparelho', async () => {
  assert.equal(await readCatalogSnapshotMeta(), undefined)
  assert.equal(await isCatalogSnapshotComplete(), false)
  await cacheCatalogEntries([exercise('c1', 'Supino Reto')]) // oportunista não conta como snapshot completo
  assert.equal(await readCatalogSnapshotMeta(), undefined)
})

test('touchCatalogSnapshotCheckedAt: só atualiza lastCheckedAt, nunca os outros campos', async () => {
  await replaceCatalogSnapshot([exercise('c1', 'Supino Reto')], { revision: 'rev-1', now: 1000 })
  await touchCatalogSnapshotCheckedAt(2000)
  const meta = await readCatalogSnapshotMeta()
  assert.equal(meta.lastCheckedAt, 2000)
  assert.equal(meta.completedAt, 1000)
  assert.equal(meta.revision, 'rev-1')
  assert.equal(meta.complete, true)
})

test('busca local com snapshot completo: zero resultado é resposta REAL (nunca undefined)', async () => {
  await replaceCatalogSnapshot([exercise('c1', 'Supino Reto')], { revision: 'rev-1' })
  const result = await searchCachedCatalog({ q: 'inexistente' })
  assert.deepEqual(result, { data: [], total: 0, complete: true })
})

test('busca local sem snapshot completo preserva o comportamento antigo: zero resultado é undefined', async () => {
  await cacheCatalogEntries([exercise('c1', 'Supino Reto')]) // só oportunista, sem snapshot completo
  assert.equal(await searchCachedCatalog({ q: 'inexistente' }), undefined)
  const found = await searchCachedCatalog({ q: 'supino' })
  assert.equal(found.complete, false)
})

test('cacheCatalogEntries: pula a poda de 90 dias quando o snapshot está completo (nunca corrompe um snapshot completo)', async () => {
  const day = 86400000
  const t0 = Date.UTC(2026, 0, 1)
  await replaceCatalogSnapshot([exercise('velho', 'Antigo'), exercise('novo', 'Recente')], {
    revision: 'rev-1',
    now: t0,
  })
  // Gravação OPORTUNÍSTICA concorrente (ex.: uma busca online enquanto o snapshot já está completo),
  // bem depois dos 90 dias -- NÃO deve podar nada do snapshot completo.
  await cacheCatalogEntries([exercise('novo', 'Recente Atualizado')], t0 + 91 * day)
  assert.deepEqual(
    (await rawAll('exerciseCatalog')).map((row) => row.id).sort(),
    ['novo', 'velho']
  )
  const meta = await readCatalogSnapshotMeta()
  assert.equal(meta.complete, true, 'gravação oportunística não derruba o marcador de snapshot completo')
})

test('gravação oportunística entre duas sincronizações completas nunca corrompe o snapshot; a PRÓXIMA sincronização converge', async () => {
  await replaceCatalogSnapshot([exercise('c1', 'Supino Reto'), exercise('c2', 'Agachamento')], {
    revision: 'rev-1',
  })
  // Exercício 'c2' foi desativado no servidor nesse intervalo; uma leitura online de 'c3' (novo,
  // ainda ativo) grava oportunisticamente enquanto o snapshot completo antigo ainda vale.
  await cacheCatalogEntries([exercise('c3', 'Elevação Lateral')])
  assert.deepEqual(
    (await rawAll('exerciseCatalog')).map((row) => row.id).sort(),
    ['c1', 'c2', 'c3']
  )
  // Próxima sincronização completa: só c1 e c3 continuam ativos -- c2 (desativado) desaparece,
  // mesmo tendo sido "visto" via cache oportunístico depois do snapshot anterior.
  await replaceCatalogSnapshot([exercise('c1', 'Supino Reto'), exercise('c3', 'Elevação Lateral')], {
    revision: 'rev-2',
  })
  assert.deepEqual(
    (await rawAll('exerciseCatalog')).map((row) => row.id).sort(),
    ['c1', 'c3']
  )
})

test('duas abas sincronizando ao mesmo tempo (lock best-effort, sem travar nenhuma): o resultado final é íntegro e vem de UMA das duas chamadas, nunca uma mistura corrompida', async () => {
  // withSyncLock (syncLock.js) é melhor-esforço entre abas reais (sem Web Locks, cai pra lease em
  // localStorage, que não é atômico) -- a garantia de não corromper dado vem daqui: cada chamada é
  // UMA transação IndexedDB atômica própria; mesmo que as DUAS rodem concorrentes (pior caso do
  // lock), a serialização de transações do IndexedDB garante que o estado final é exatamente o de
  // UMA delas por completo, nunca linhas de ambas misturadas.
  const snapshotA = [exercise('a1', 'Supino'), exercise('a2', 'Agachamento')]
  const snapshotB = [exercise('b1', 'Remada'), exercise('b2', 'Elevação'), exercise('b3', 'Rosca')]
  const [okA, okB] = await Promise.all([
    replaceCatalogSnapshot(snapshotA, { revision: 'rev-a' }),
    replaceCatalogSnapshot(snapshotB, { revision: 'rev-b' }),
  ])
  assert.equal(okA, true)
  assert.equal(okB, true)
  const finalIds = (await rawAll('exerciseCatalog')).map((row) => row.id).sort()
  const meta = await readCatalogSnapshotMeta()
  const isExactlyA = JSON.stringify(finalIds) === JSON.stringify(['a1', 'a2']) && meta.revision === 'rev-a'
  const isExactlyB =
    JSON.stringify(finalIds) === JSON.stringify(['b1', 'b2', 'b3']) && meta.revision === 'rev-b'
  assert.ok(isExactlyA || isExactlyB, `estado final deveria ser A OU B inteiro, veio: ${finalIds}`)
  assert.equal(meta.complete, true)
  assert.equal(meta.totalActive, finalIds.length)
})

test('deriveCatalogTaxonomyFromSnapshot: agrega músculos primários e secundários, equipamento, categoria e nível', () => {
  const taxonomy = deriveCatalogTaxonomyFromSnapshot([
    { primaryMuscles: ['peito'], secondaryMuscles: ['triceps'], equipment: 'barra', category: 'forca', level: 'iniciante' },
    { primaryMuscles: ['quadriceps'], secondaryMuscles: ['gluteos'], equipment: null, category: 'pernas', level: 'avancado' },
  ])
  assert.deepEqual(taxonomy, {
    muscles: ['gluteos', 'peito', 'quadriceps', 'triceps'],
    equipment: ['barra'],
    categories: ['forca', 'pernas'],
    levels: ['avancado', 'iniciante'],
  })
})

test('readCatalogSnapshotTaxonomy: undefined sem snapshot completo; deriva do snapshot quando completo', async () => {
  await cacheCatalogEntries([exercise('c1', 'Supino Reto')])
  assert.equal(await readCatalogSnapshotTaxonomy(), undefined)

  await replaceCatalogSnapshot(
    [exercise('c1', 'Supino Reto'), exercise('c2', 'Agachamento', { primaryMuscles: ['pernas'], equipment: 'nenhum', category: 'pernas', level: 'avancado' })],
    { revision: 'rev-1' }
  )
  assert.deepEqual(await readCatalogSnapshotTaxonomy(), {
    muscles: ['peito', 'pernas', 'triceps'], // 'triceps' vem da secondaryMuscles default dos dois fixtures
    equipment: ['barra', 'nenhum'],
    categories: ['forca', 'pernas'],
    levels: ['avancado', 'iniciante'],
  })
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

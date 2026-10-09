import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isExerciseComplete, missingFields, normalizeExercise, buildImportPlan } from './exercise-catalog-import-core.mjs'

const complete = {
  id: 'Bench_Press',
  name: 'Supino Reto',
  force: 'push',
  level: 'iniciante',
  mechanic: 'composto',
  equipment: 'barra',
  primaryMuscles: ['peito'],
  secondaryMuscles: ['triceps'],
  instructions: ['Deite no banco.', 'Empurre a barra.'],
  category: 'forca',
  images: ['Bench_Press/0.jpg'],
}

test('isExerciseComplete aceita um exercício com todos os campos obrigatórios', () => {
  assert.equal(isExerciseComplete(complete), true)
})

test('isExerciseComplete não exige equipment (nem todo exercício real tem)', () => {
  assert.equal(isExerciseComplete({ ...complete, equipment: undefined }), true)
})

test('isExerciseComplete rejeita instructions vazio -- reproduz os 5 casos reais do dataset', () => {
  assert.equal(isExerciseComplete({ ...complete, instructions: [] }), false)
  assert.deepEqual(missingFields({ ...complete, instructions: [] }), ['instructions'])
})

test('isExerciseComplete rejeita id, name, primaryMuscles ou category ausentes', () => {
  assert.equal(isExerciseComplete({ ...complete, id: '' }), false)
  assert.equal(isExerciseComplete({ ...complete, name: undefined }), false)
  assert.equal(isExerciseComplete({ ...complete, primaryMuscles: [] }), false)
  assert.equal(isExerciseComplete({ ...complete, category: null }), false)
})

test('normalizeExercise nunca inventa dado ausente -- campos opcionais viram null/[]', () => {
  const row = normalizeExercise({ ...complete, equipment: undefined, level: undefined, force: undefined, mechanic: undefined, images: undefined })
  assert.equal(row.equipment, null)
  assert.equal(row.difficulty, null)
  assert.equal(row.force, null)
  assert.equal(row.mechanic, null)
  assert.deepEqual(row.source_media_refs, { images: [] })
})

test('normalizeExercise preserva acentuação/cedilha do nome exatamente como veio -- normalização é só pra busca, nunca pro campo de apresentação', () => {
  const accented = [
    'Abraçar a Bola', 'Extensão de Pé', 'Elevação Pélvica', 'Rosca Direta com Ênfase',
    'Remada Única com Halteres', 'Agachamento com Ênfase nos Glúteos', 'Panturrilha em Pé',
  ]
  for (const name of accented) {
    const row = normalizeExercise({ ...complete, name })
    assert.equal(row.name, name)
  }
})

test('normalizeExercise combina primaryMuscles + secondaryMuscles sem duplicar', () => {
  const row = normalizeExercise({ ...complete, primaryMuscles: ['peito'], secondaryMuscles: ['peito', 'triceps'] })
  assert.deepEqual(row.muscles, ['peito', 'triceps'])
  assert.equal(row.primary_muscle, 'peito')
})

test('buildImportPlan descarta exercícios incompletos e reporta o motivo', () => {
  const { report, toUpsert } = buildImportPlan([complete, { ...complete, id: 'Bad', instructions: [] }])
  assert.equal(report.found, 2)
  assert.equal(report.valid, 1)
  assert.equal(report.discardedCount, 1)
  assert.deepEqual(report.discarded[0], { id: 'Bad', name: 'Supino Reto', reasons: ['instructions'] })
  assert.equal(toUpsert.length, 1)
})

test('buildImportPlan detecta ID duplicado na fonte e mantém só a primeira ocorrência', () => {
  const { report, toUpsert } = buildImportPlan([complete, { ...complete }])
  assert.deepEqual(report.duplicateIds, ['Bench_Press'])
  assert.equal(toUpsert.length, 1)
})

test('buildImportPlan reporta nomes duplicados com IDs diferentes SEM descartar nenhum', () => {
  const a = { ...complete, id: 'Chain_Press', name: 'Supino com Correntes', primaryMuscles: ['peito'] }
  const b = { ...complete, id: 'Bench_Press_with_Chains', name: 'Supino com Correntes', primaryMuscles: ['triceps'] }
  const { report, toUpsert } = buildImportPlan([a, b])
  assert.equal(toUpsert.length, 2)
  assert.deepEqual(report.duplicateNames, [
    { value: 'supino com correntes', ids: ['Chain_Press', 'Bench_Press_with_Chains'] },
  ])
})

test('buildImportPlan classifica insert/update/unchanged contra o estado existente', () => {
  const existingUnchanged = normalizeExercise(complete)
  const existingByProviderExerciseId = new Map([
    ['Bench_Press', existingUnchanged],
    ['Old_Exercise', normalizeExercise({ ...complete, id: 'Old_Exercise', name: 'Nome Antigo' })],
  ])
  const changed = { ...complete, id: 'Old_Exercise', name: 'Nome Antigo', equipment: 'halteres' }
  const brandNew = { ...complete, id: 'New_Exercise' }

  const { report } = buildImportPlan([complete, changed, brandNew], existingByProviderExerciseId)
  assert.equal(report.inserts, 1)
  assert.equal(report.updates, 1)
  assert.equal(report.unchanged, 1)
})

test('buildImportPlan conta com/sem equipamento e com/sem mídia', () => {
  const noEquipment = { ...complete, id: 'Stretch', equipment: undefined, images: [] }
  const { report } = buildImportPlan([complete, noEquipment])
  assert.equal(report.withEquipment, 1)
  assert.equal(report.withoutEquipment, 1)
  assert.equal(report.withMedia, 1)
  assert.equal(report.withoutMedia, 1)
})

test('buildImportPlan rejeita fonte que não é um array', () => {
  assert.throws(() => buildImportPlan({ not: 'an array' }), /INVALID_SOURCE_FORMAT/)
})

// Reimportar o catálogo nunca pode apagar uma imagem aprovada pelo Evolutus: o plano só carrega
// source_media_refs; published_media_refs (mídia oficial, escrita pelo fluxo de publicação) nunca
// aparece no que o importador faz upsert -- e um upsert sem a coluna não a altera.
test('o plano de importação atualiza source_media_refs e NUNCA inclui published_media_refs', () => {
  const published = { version: 3, images: [{ role: 'start', path: 'x/v3/start.webp' }, { role: 'end', path: 'x/v3/end.webp' }] }
  const existing = { ...normalizeExercise(complete), published_media_refs: published }
  const changedImages = { ...complete, images: ['Bench_Press/9.jpg'] }

  const { toUpsert, report } = buildImportPlan([changedImages], new Map([['Bench_Press', existing]]))
  assert.equal(report.updates, 1)
  assert.deepEqual(toUpsert[0].source_media_refs, { images: ['Bench_Press/9.jpg'] })
  assert.equal('published_media_refs' in toUpsert[0], false)
  assert.equal('media_refs' in toUpsert[0], false)
  assert.deepEqual(existing.published_media_refs, published)
})

test('mudança só na mídia publicada não faz o importador reescrever a linha', () => {
  const existing = { ...normalizeExercise(complete), published_media_refs: { version: 3, images: [] } }
  const { report } = buildImportPlan([complete], new Map([['Bench_Press', existing]]))
  assert.equal(report.unchanged, 1)
})

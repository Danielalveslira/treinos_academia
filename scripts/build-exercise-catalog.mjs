import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const inputPath = resolve(ROOT, process.argv[2] || 'imports/exercicios_ptbr.json')
const outputPath = resolve(ROOT, process.argv[3] || 'public/exercise-catalog/v1/catalog.json')
const reportPath = resolve(ROOT, process.argv[4] || 'docs/exercise-catalog-report.json')
const REQUIRED_ARRAY_FIELDS = ['primaryMuscles', 'secondaryMuscles', 'instructions', 'images']
const NULLABLE_STRING_FIELDS = ['force', 'level', 'mechanic', 'equipment', 'category']

function cleanString(value, field, index) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Exercício ${index}: ${field} deve ser uma string não vazia`)
  }
  return value.trim()
}

function cleanNullableString(value, field, index) {
  if (value == null) return null
  return cleanString(value, field, index)
}

function cleanStringArray(value, field, index) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`Exercício ${index}: ${field} deve ser um array de strings`)
  }
  return value.map((item) => item.trim()).filter(Boolean)
}

function normalizeExercise(exercise, index) {
  if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise)) {
    throw new TypeError(`Exercício ${index}: registro inválido`)
  }
  for (const field of REQUIRED_ARRAY_FIELDS) cleanStringArray(exercise[field], field, index)

  return {
    id: cleanString(exercise.id, 'id', index),
    name: cleanString(exercise.name, 'name', index),
    ...Object.fromEntries(
      NULLABLE_STRING_FIELDS.map((field) => [
        field,
        cleanNullableString(exercise[field], field, index),
      ])
    ),
    primaryMuscles: cleanStringArray(exercise.primaryMuscles, 'primaryMuscles', index),
    secondaryMuscles: cleanStringArray(exercise.secondaryMuscles, 'secondaryMuscles', index),
    instructions: cleanStringArray(exercise.instructions, 'instructions', index),
    imageRefs: cleanStringArray(exercise.images, 'images', index),
  }
}

function compareById(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function repeatedValues(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value, 'pt-BR'))
}

const input = await readFile(inputPath, 'utf8')
const parsed = JSON.parse(input)
if (!Array.isArray(parsed)) throw new TypeError('A raiz do catálogo deve ser um array')

const exercises = parsed.map(normalizeExercise).sort(compareById)
const duplicateIds = repeatedValues(exercises.map(({ id }) => id))
if (duplicateIds.length) {
  throw new Error(`IDs duplicados: ${duplicateIds.map(({ value }) => value).join(', ')}`)
}

const catalog = { version: 1, exercises }
const output = `${JSON.stringify(catalog, null, 2)}\n`
const report = {
  version: 1,
  exerciseCount: exercises.length,
  sourceSha256: createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
  duplicateIds,
  duplicateNames: repeatedValues(exercises.map(({ name }) => name)),
  nullCounts: Object.fromEntries(
    NULLABLE_STRING_FIELDS.map((field) => [
      field,
      exercises.filter((item) => item[field] == null).length,
    ])
  ),
  emptyArrayCounts: Object.fromEntries(
    ['primaryMuscles', 'secondaryMuscles', 'instructions', 'imageRefs'].map((field) => [
      field,
      exercises.filter((item) => item[field].length === 0).length,
    ])
  ),
}

await mkdir(dirname(outputPath), { recursive: true })
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(outputPath, output, 'utf8')
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`Catálogo v${catalog.version}: ${exercises.length} exercícios -> ${outputPath}`)
console.log(`Relatório -> ${reportPath}`)

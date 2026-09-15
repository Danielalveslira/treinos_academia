import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXERCISE_CATALOG_ASSET_VERSION,
  getExerciseImageUrl,
  getExerciseThumbnailUrl,
} from './exerciseCatalogImages.js'

const exercise = {
  id: 'Barbell_Deadlift',
  imageRefs: ['Barbell_Deadlift/0.jpg', 'Barbell_Deadlift/1.jpg'],
}

test('resolves thumbnail and normal WebP images against a versioned CDN base', () => {
  const baseUrl = 'https://cdn.example.com/exercise-catalog/v1/'
  assert.equal(
    getExerciseThumbnailUrl(exercise, baseUrl),
    'https://cdn.example.com/exercise-catalog/v1/Barbell_Deadlift/thumb.webp'
  )
  assert.equal(
    getExerciseImageUrl(exercise, 0, baseUrl),
    'https://cdn.example.com/exercise-catalog/v1/Barbell_Deadlift/0.webp'
  )
  assert.equal(
    getExerciseImageUrl(exercise, 1, baseUrl),
    'https://cdn.example.com/exercise-catalog/v1/Barbell_Deadlift/1.webp'
  )
  assert.equal(EXERCISE_CATALOG_ASSET_VERSION, 1)
})

test('resolves a deterministic Firebase Storage REST URL without getDownloadURL', () => {
  const baseUrl = 'https://firebasestorage.googleapis.com/v0/b/evolutus.appspot.com/o'
  assert.equal(
    getExerciseThumbnailUrl(exercise, baseUrl),
    `${baseUrl}/exercise-catalog%2Fv1%2FBarbell_Deadlift%2Fthumb.webp?alt=media`
  )
})

test('returns fallback null for missing or unsafe image references', () => {
  assert.equal(
    getExerciseThumbnailUrl({ id: 'custom', imageRefs: [] }, 'https://cdn.test/v1'),
    null
  )
  assert.equal(getExerciseImageUrl(exercise, 2, 'https://cdn.test/v1'), null)
  assert.equal(
    getExerciseImageUrl({ id: 'unsafe', imageRefs: ['../secret.jpg'] }, 0, 'https://cdn.test/v1'),
    null
  )
})

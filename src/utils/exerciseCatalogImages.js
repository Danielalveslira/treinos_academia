export const EXERCISE_CATALOG_ASSET_VERSION = 1

const configuredBaseUrl =
  import.meta.env?.VITE_EXERCISE_CATALOG_ASSET_BASE_URL?.trim() ||
  (import.meta.env?.DEV ? '/exercise-catalog-assets/v1' : '')

function safeImageRef(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_() .-]+\/[0-9]+\.jpg$/i.test(value) &&
    !value.startsWith('/') &&
    !value.includes('..') &&
    !value.includes('\\')
  )
}

function safeExerciseId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_() .-]+$/.test(value)
}

function buildAssetUrl(exercise, fileName, baseUrl) {
  if (!baseUrl || !safeExerciseId(exercise?.id)) return null
  const cleanBaseUrl = baseUrl.replace(/\/$/, '')
  const assetPath = `exercise-catalog/v${EXERCISE_CATALOG_ASSET_VERSION}/${exercise.id}/${fileName}`
  if (cleanBaseUrl.includes('firebasestorage.googleapis.com')) {
    try {
      if (/\/o$/.test(new URL(cleanBaseUrl).pathname)) {
        return `${cleanBaseUrl}/${encodeURIComponent(assetPath)}?alt=media`
      }
    } catch {
      return null
    }
  }
  return `${cleanBaseUrl}/${encodeURIComponent(exercise.id)}/${fileName}`
}

export function getExerciseThumbnailUrl(exercise, baseUrl = configuredBaseUrl) {
  if (!safeImageRef(exercise?.imageRefs?.[0])) return null
  return buildAssetUrl(exercise, 'thumb.webp', baseUrl)
}

export function getExerciseImageUrl(exercise, index = 0, baseUrl = configuredBaseUrl) {
  const imageRef = exercise?.imageRefs?.[index]
  if (!safeImageRef(imageRef)) return null
  const sourceIndex = imageRef.match(/\/([0-9]+)\.jpg$/i)[1]
  return buildAssetUrl(exercise, `${sourceIndex}.webp`, baseUrl)
}

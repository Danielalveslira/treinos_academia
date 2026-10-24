// Published references are written only after server validation of the image assets.
// Keep this predicate aligned with public.catalog_has_complete_images in the migration.
export function hasCompleteExerciseImages(exercise) {
  const refs = exercise?.published_media_refs
  if (!Number.isInteger(refs?.version) || refs.version <= 0 || !Array.isArray(refs.images))
    return false
  return ['start', 'end'].every((role) =>
    refs.images.some((image) =>
      image?.role === role && image.path === `${exercise.id}/v${refs.version}/${role}.webp`
    )
  )
}

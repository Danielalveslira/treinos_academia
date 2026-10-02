export function finalizedOperationResult(listing, draft, operationId) {
  if (
    listing?.lifecycle_state !== 'published' ||
    !operationId ||
    draft?.publish_operation_id !== operationId
  ) {
    return null
  }

  return {
    listingId: listing.id,
    state: 'published',
    version: listing.published_version,
    repeated: true,
  }
}

export function resolveAuthorizedAvatar(draft, owner) {
  if (
    draft?.kind !== 'professional' ||
    draft?.use_profile_avatar !== true ||
    !owner?.avatar_media_id ||
    !owner?.avatar_path
  ) {
    return { avatarPath: null, avatarSourceMediaId: null }
  }

  return {
    avatarPath: owner.avatar_path,
    avatarSourceMediaId: owner.avatar_media_id,
  }
}

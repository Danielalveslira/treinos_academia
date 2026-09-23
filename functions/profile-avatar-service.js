export function createProfileAvatarService({ db, bucket, FieldValue, HttpsError, inspectImage }) {
  const MAX_BYTES = 1024 * 1024
  const fail = (code, message) => {
    throw new HttpsError(code, message)
  }

  async function getPendingAvatarReference(tx, uid, lock, mediaId) {
    if (!lock.exists) return null
    const draft = await tx.get(db.doc(`professionalListingDrafts/${lock.data().listingId}`))
    if (
      draft.data()?.reviewState === 'pending_review' &&
      draft.data()?.submittedAvatarMediaId === mediaId
    ) {
      return draft
    }
    return null
  }

  async function allocate(uid) {
    const mediaRef = db.collection('profileAvatarMedia').doc()
    const path = `profileAvatars/${uid}/${mediaRef.id}.webp`
    await db.runTransaction(async (tx) => {
      const [user, deletion] = await tx.getAll(
        db.doc(`users/${uid}`),
        db.doc(`deletionJobs/account_${uid}`)
      )
      if (!user.exists || deletion.exists)
        fail('failed-precondition', 'A conta não pode alterar a foto agora.')
      tx.create(mediaRef, {
        ownerId: uid,
        storagePath: path,
        state: 'allocated',
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    return { mediaId: mediaRef.id, path }
  }

  async function confirm(uid, { mediaId }) {
    if (!/^[A-Za-z0-9]{20}$/.test(String(mediaId || '')))
      fail('invalid-argument', 'Mídia inválida.')
    const mediaRef = db.doc(`profileAvatarMedia/${mediaId}`)
    const media = await mediaRef.get()
    if (!media.exists || media.data().ownerId !== uid || media.data().state !== 'allocated')
      fail('permission-denied', 'Upload não autorizado.')
    const file = bucket.file(media.data().storagePath)
    const [metadata] = await file.getMetadata()
    const size = Number(metadata.size || 0)
    if (metadata.contentType !== 'image/webp' || size < 1 || size > MAX_BYTES)
      fail('failed-precondition', 'Arquivo de imagem inválido.')
    const [buffer] = await file.download()
    const dimensions = await inspectImage(buffer)
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width > 1600 ||
      dimensions.height > 1600 ||
      dimensions.width * dimensions.height > 2560000
    ) {
      fail('failed-precondition', 'Dimensões da imagem inválidas.')
    }
    let previousPath = null
    let previousNeededForReview = false
    await db.runTransaction(async (tx) => {
      const [currentMedia, user, profile, lock] = await tx.getAll(
        mediaRef,
        db.doc(`users/${uid}`),
        db.doc(`publicProfiles/${uid}`),
        db.doc(`professionalListingOwnerLocks/${uid}`)
      )
      if (currentMedia.data()?.state !== 'allocated')
        fail('failed-precondition', 'Este upload já foi processado.')
      previousPath = user.data()?.avatarPath || null
      if (user.data()?.avatarMediaId) {
        previousNeededForReview = Boolean(
          await getPendingAvatarReference(tx, uid, lock, user.data().avatarMediaId)
        )
      }
      const patch = {
        avatarMediaId: mediaId,
        avatarPath: media.data().storagePath,
        updatedAt: FieldValue.serverTimestamp(),
      }
      tx.update(db.doc(`users/${uid}`), patch)
      if (profile.exists) tx.update(profile.ref, patch)
      else tx.set(profile.ref, { username: null, bio: null, shareStatistics: false, ...patch })
      tx.update(mediaRef, {
        state: 'active',
        width: dimensions.width,
        height: dimensions.height,
        confirmedAt: FieldValue.serverTimestamp(),
      })
      if (user.data()?.avatarMediaId)
        tx.update(db.doc(`profileAvatarMedia/${user.data().avatarMediaId}`), {
          state: 'superseded',
          updatedAt: FieldValue.serverTimestamp(),
        })
    })
    if (previousPath && previousPath !== media.data().storagePath && !previousNeededForReview) {
      await bucket
        .file(previousPath)
        .delete({ ignoreNotFound: true })
        .catch(() => {})
    }
    return { mediaId, path: media.data().storagePath }
  }

  async function remove(uid) {
    let previousPath = null
    let listingAvatarPath = null
    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`)
      const lockRef = db.doc(`professionalListingOwnerLocks/${uid}`)
      const [user, profile, lock] = await tx.getAll(
        userRef,
        db.doc(`publicProfiles/${uid}`),
        lockRef
      )
      const publicRef = lock.exists
        ? db.doc(`publishedProfessionalListings/${lock.data().listingId}`)
        : null
      const pendingDraft = user.data()?.avatarMediaId
        ? await getPendingAvatarReference(tx, uid, lock, user.data().avatarMediaId)
        : null
      const published = publicRef ? await tx.get(publicRef) : null
      previousPath = user.data()?.avatarPath || null
      if (user.data()?.avatarMediaId)
        tx.update(db.doc(`profileAvatarMedia/${user.data().avatarMediaId}`), {
          state: 'deleted',
          updatedAt: FieldValue.serverTimestamp(),
        })
      tx.update(userRef, {
        avatarMediaId: FieldValue.delete(),
        avatarPath: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (profile.exists)
        tx.update(profile.ref, {
          avatarMediaId: FieldValue.delete(),
          avatarPath: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      if (published?.exists && published.data().avatarPath) {
        listingAvatarPath = published.data().avatarPath
        tx.update(publicRef, {
          avatarPath: FieldValue.delete(),
          avatarSourceMediaId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      if (pendingDraft) {
        tx.update(pendingDraft.ref, {
          useProfileAvatar: false,
          submittedAvatarMediaId: FieldValue.delete(),
          submittedAvatarPath: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    })
    await Promise.allSettled(
      [previousPath, listingAvatarPath]
        .filter(Boolean)
        .map((path) => bucket.file(path).delete({ ignoreNotFound: true }))
    )
    return { removed: true }
  }

  async function purgeExpired(now = Date.now()) {
    const cutoff = new Date(now - 24 * 60 * 60 * 1000)
    const expired = await db
      .collection('profileAvatarMedia')
      .where('state', 'in', ['allocated', 'superseded', 'deleted'])
      .where('createdAt', '<=', cutoff)
      .limit(200)
      .get()
    await Promise.all(
      expired.docs.map(async (item) => {
        const data = item.data()
        const [user, lock] = await Promise.all([
          db.doc(`users/${data.ownerId}`).get(),
          db.doc(`professionalListingOwnerLocks/${data.ownerId}`).get(),
        ])
        if (
          user.data()?.avatarMediaId === item.id ||
          user.data()?.avatarPath === data.storagePath
        ) {
          return
        }
        if (lock.exists) {
          const [draft, published] = await Promise.all([
            db.doc(`professionalListingDrafts/${lock.data().listingId}`).get(),
            db.doc(`publishedProfessionalListings/${lock.data().listingId}`).get(),
          ])
          if (
            (draft.data()?.reviewState === 'pending_review' &&
              (draft.data()?.submittedAvatarMediaId === item.id ||
                draft.data()?.submittedAvatarPath === data.storagePath)) ||
            published.data()?.avatarSourceMediaId === item.id ||
            published.data()?.avatarPath === data.storagePath
          ) {
            return
          }
        }
        if (item.data().storagePath)
          await bucket.file(item.data().storagePath).delete({ ignoreNotFound: true })
        await item.ref.delete()
      })
    )
    return expired.size
  }

  return { allocate, confirm, remove, purgeExpired }
}

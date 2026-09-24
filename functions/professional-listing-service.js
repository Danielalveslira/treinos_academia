import {
  buildPublicProjection,
  validListingId,
  validateListingDraft,
} from './professional-listing-core.js'

const LEGAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
// Trava transitória contra publicação concorrente (duplo clique, retry de rede com
// operationId novo) -- publish() já é auto-suficiente (sem espera por um admin), mas
// as duas fases (copiar o avatar no Storage não pode rodar dentro de uma transação do
// Firestore) ainda deixam uma janela real entre elas. Expira sozinha: uma função que
// trava para sempre por causa de uma instância derrubada no meio da cópia não tem
// nenhum admin para destravar, diferente do antigo review() pendente.
const PUBLISHING_LOCK_TIMEOUT_MS = 2 * 60 * 1000

export function createProfessionalListingService({
  db,
  bucket,
  FieldValue,
  HttpsError,
  showcaseLegal,
}) {
  const fail = (code, message) => {
    throw new HttpsError(code, message)
  }

  async function assertWritableAccount(tx, uid) {
    const [user, deletion] = await tx.getAll(
      db.doc(`users/${uid}`),
      db.doc(`deletionJobs/account_${uid}`)
    )
    if (!user.exists || deletion.exists || user.data().accountStatus === 'disabled') {
      fail('failed-precondition', 'A conta não pode alterar uma vitrine agora.')
    }
    return user
  }

  async function requireSuperAdmin(uid) {
    const user = await db.doc(`users/${uid}`).get()
    if (user.data()?.role !== 'superadmin')
      fail('permission-denied', 'Acesso administrativo necessário.')
  }

  function isPublishingLocked(draftData) {
    if (draftData?.reviewState !== 'publishing') return false
    const startedAt = draftData.publishingStartedAt?.toMillis?.()
    return typeof startedAt === 'number' && startedAt > Date.now() - PUBLISHING_LOCK_TIMEOUT_MS
  }

  async function createDraft(uid, { requestId, kind }) {
    if (!validListingId(requestId) || !['professional', 'space'].includes(kind)) {
      fail('invalid-argument', 'Dados inválidos para criar a vitrine.')
    }
    const lockRef = db.doc(`professionalListingOwnerLocks/${uid}`)
    const proposedId = db.collection('professionalListings').doc().id
    return db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)
      const lock = await tx.get(lockRef)
      if (lock.exists) {
        const listing = await tx.get(db.doc(`professionalListings/${lock.data().listingId}`))
        if (listing.exists && listing.data().kind !== kind) {
          fail('already-exists', 'Sua conta já possui uma vitrine de outro tipo.')
        }
        return { listingId: lock.data().listingId, created: false }
      }
      const now = FieldValue.serverTimestamp()
      tx.create(lockRef, {
        listingId: proposedId,
        ownerId: uid,
        createdRequestId: requestId,
        createdAt: now,
      })
      tx.create(db.doc(`professionalListings/${proposedId}`), {
        ownerId: uid,
        kind,
        lifecycleState: 'draft',
        publishedVersion: 0,
        createdAt: now,
        updatedAt: now,
      })
      tx.create(db.doc(`professionalListingDrafts/${proposedId}`), {
        ownerId: uid,
        kind,
        reviewState: 'draft',
        version: 0,
        createdAt: now,
        updatedAt: now,
      })
      return { listingId: proposedId, created: true }
    })
  }

  async function validateCommunityOwner(uid, communityId) {
    if (!communityId) return null
    const community = await db.doc(`communities/${communityId}`).get()
    if (
      !community.exists ||
      community.data().ownerId !== uid ||
      community.data().isActive !== true
    ) {
      fail('permission-denied', 'Você só pode vincular uma comunidade ativa da qual é titular.')
    }
    return { id: community.id, name: community.data().name }
  }

  async function saveDraft(uid, { listingId, draft }) {
    if (!validListingId(listingId)) fail('invalid-argument', 'Vitrine inválida.')
    const parsed = validateListingDraft(draft)
    if (parsed.error) fail('invalid-argument', parsed.error)
    const linkedCommunity = await validateCommunityOwner(uid, parsed.value.linkedCommunityId)
    const listingRef = db.doc(`professionalListings/${listingId}`)
    const draftRef = db.doc(`professionalListingDrafts/${listingId}`)
    const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
    let revokedAvatarPath = null
    const result = await db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)
      const [listing, currentDraft, published] = await tx.getAll(listingRef, draftRef, publicRef)
      if (!listing.exists || listing.data().ownerId !== uid)
        fail('permission-denied', 'Vitrine não encontrada.')
      if (['suspended', 'deleting'].includes(listing.data().lifecycleState)) {
        fail('failed-precondition', 'A vitrine não pode ser editada neste estado.')
      }
      if (isPublishingLocked(currentDraft.data())) {
        fail('failed-precondition', 'Uma publicação desta vitrine está em andamento.')
      }
      if (listing.data().kind !== parsed.value.kind)
        fail('failed-precondition', 'O tipo da vitrine não pode ser alterado.')
      const version = (currentDraft.data()?.version || 0) + 1
      tx.set(draftRef, {
        ownerId: uid,
        ...parsed.value,
        linkedCommunity,
        reviewState: 'draft',
        version,
        basedOnPublishedVersion: listing.data().publishedVersion || 0,
        rejectionSummary: null,
        createdAt: currentDraft.data()?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      tx.update(listingRef, {
        lifecycleState: published.exists ? 'published' : 'draft',
        linkedCommunityId: parsed.value.linkedCommunityId,
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (published.exists && published.data().avatarPath && !parsed.value.useProfileAvatar) {
        revokedAvatarPath = published.data().avatarPath
        tx.update(publicRef, {
          avatarPath: FieldValue.delete(),
          avatarSourceMediaId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      return { listingId, version }
    })
    if (revokedAvatarPath) await bucket.file(revokedAvatarPath).delete({ ignoreNotFound: true })
    return result
  }

  async function copyAuthorizedAvatar(listingId, ownerId, avatarSource) {
    const { avatarSourceMediaId: sourceMediaId, avatarSourcePath: sourcePath } = avatarSource
    const media = await db.doc(`profileAvatarMedia/${sourceMediaId}`).get()
    if (
      !media.exists ||
      media.data().ownerId !== ownerId ||
      media.data().storagePath !== sourcePath ||
      !['active', 'superseded'].includes(media.data().state)
    ) {
      fail('failed-precondition', 'A foto autorizada não está mais disponível.')
    }
    const approvedPath = `professionalListingMedia/${listingId}/approved/${db.collection('_').doc().id}.webp`
    await bucket.file(sourcePath).copy(bucket.file(approvedPath))
    await bucket
      .file(approvedPath)
      .setMetadata({ cacheControl: 'public,max-age=300', contentType: 'image/webp' })
    return { avatarPath: approvedPath, avatarSourceMediaId: sourceMediaId, avatarSourcePath: sourcePath }
  }

  // Publicação direta pelo titular -- substitui o antigo par submit()/review(): sem
  // fila nem decisão de superadmin, mas ainda em duas fases (a cópia do avatar no
  // Storage não pode rodar dentro de uma transação do Firestore). A fase 1 valida
  // titularidade/estado/termos/rascunho e trava a vitrine ("publishing"); a fase 2
  // copia a foto autorizada (se houver) e revalida tudo de novo antes de publicar,
  // exatamente a mesma proteção contra corrida que o antigo review() já tinha --
  // só que disparada pelo próprio dono, na hora, em vez de um admin dias depois.
  async function publish(
    uid,
    { listingId, termsAccepted = false, termsVersion = '', operationId = '' }
  ) {
    if (!validListingId(listingId) || !validListingId(operationId)) {
      fail('invalid-argument', 'Vitrine ou operação inválida.')
    }
    const legalManifest = showcaseLegal?.manifest
    const legalDigest = showcaseLegal?.digest
    const legalDocumentId = legalManifest?.documentId
    if (
      legalManifest?.published !== true ||
      !validListingId(legalDocumentId) ||
      !LEGAL_VERSION_PATTERN.test(String(legalManifest.version || '')) ||
      typeof legalDigest !== 'string' ||
      !legalDigest
    ) {
      fail('failed-precondition', 'Os Termos de Publicação da Vitrine ainda não estão disponíveis.')
    }
    const listingRef = db.doc(`professionalListings/${listingId}`)
    const draftRef = db.doc(`professionalListingDrafts/${listingId}`)
    const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
    const policyRef = db.doc('showcaseLegalPolicy/current')
    const archiveRef = db.doc(`showcaseLegalVersions/${legalManifest.version}`)
    const acceptanceRef = db.doc(`users/${uid}/showcaseLegalAcceptances/${legalManifest.version}`)

    const prepared = await db.runTransaction(async (tx) => {
      const user = await assertWritableAccount(tx, uid)
      const [listing, draft, policy, archive, previousAcceptance] = await tx.getAll(
        listingRef,
        draftRef,
        policyRef,
        archiveRef,
        acceptanceRef
      )
      if (!listing.exists || listing.data().ownerId !== uid)
        fail('permission-denied', 'Vitrine não encontrada.')
      if (
        listing.data().lifecycleState === 'published' &&
        draft.data()?.publishOperationId === operationId
      ) {
        return { repeated: true, version: listing.data().publishedVersion }
      }
      if (['suspended', 'deleting'].includes(listing.data().lifecycleState)) {
        fail('failed-precondition', 'A vitrine não pode ser publicada neste estado.')
      }
      if (isPublishingLocked(draft.data())) {
        fail('aborted', 'Já existe uma publicação desta vitrine em andamento.')
      }
      if (!draft.exists || !draft.data().version) {
        fail('failed-precondition', 'Salve um rascunho completo antes de publicar.')
      }
      const parsed = validateListingDraft(draft.data())
      if (parsed.error) fail('failed-precondition', parsed.error)
      if (
        policy.data()?.published !== true ||
        policy.data()?.documentId !== legalDocumentId ||
        policy.data()?.version !== legalManifest.version ||
        policy.data()?.digest !== legalDigest ||
        archive.data()?.digest !== legalDigest
      ) {
        fail(
          'failed-precondition',
          'Os Termos de Publicação da Vitrine estão indisponíveis ou foram atualizados.'
        )
      }
      if (previousAcceptance.exists) {
        const previous = previousAcceptance.data()
        if (
          previous.userId !== uid ||
          previous.documentId !== legalDocumentId ||
          previous.version !== legalManifest.version ||
          previous.digest !== legalDigest
        ) {
          fail('failed-precondition', 'O registro anterior de aceite é inconsistente.')
        }
      } else {
        if (termsAccepted !== true || termsVersion !== legalManifest.version) {
          fail(
            'failed-precondition',
            termsVersion && termsVersion !== legalManifest.version
              ? 'A versão dos termos mudou. Releia e confirme o documento vigente.'
              : 'Confirme os Termos de Publicação da Vitrine antes de publicar.'
          )
        }
        tx.create(acceptanceRef, {
          userId: uid,
          listingId,
          operationId,
          documentId: legalDocumentId,
          version: legalManifest.version,
          digest: legalDigest,
          acceptedAt: FieldValue.serverTimestamp(),
        })
      }
      const avatarWanted =
        draft.data().kind === 'professional' &&
        draft.data().useProfileAvatar === true &&
        user.data().avatarMediaId &&
        user.data().avatarPath
      tx.update(draftRef, {
        reviewState: 'publishing',
        publishingOperationId: operationId,
        publishingStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return {
        repeated: false,
        version: draft.data().version,
        ownerId: uid,
        draftData: draft.data(),
        avatarSource: avatarWanted
          ? { avatarSourceMediaId: user.data().avatarMediaId, avatarSourcePath: user.data().avatarPath }
          : null,
      }
    })
    if (prepared.repeated) {
      return { listingId, version: prepared.version, state: 'published', repeated: true }
    }

    let avatar = {}
    try {
      avatar = prepared.avatarSource
        ? await copyAuthorizedAvatar(listingId, uid, prepared.avatarSource)
        : {}
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const draft = await tx.get(draftRef)
        if (draft.data()?.publishingOperationId === operationId) {
          tx.update(draftRef, { reviewState: 'draft', updatedAt: FieldValue.serverTimestamp() })
        }
      })
      throw error
    }
    const publicSnapshotBefore = await publicRef.get()
    let result
    try {
      result = await db.runTransaction(async (tx) => {
        const avatarMediaRef = avatar.avatarSourceMediaId
          ? db.doc(`profileAvatarMedia/${avatar.avatarSourceMediaId}`)
          : null
        const [listing, draft, currentAvatarMedia] = await tx.getAll(
          listingRef,
          draftRef,
          ...(avatarMediaRef ? [avatarMediaRef] : [])
        )
        if (
          !listing.exists ||
          listing.data().ownerId !== uid ||
          ['suspended', 'deleting'].includes(listing.data().lifecycleState) ||
          draft.data()?.reviewState !== 'publishing' ||
          draft.data()?.publishingOperationId !== operationId
        ) {
          fail('aborted', 'A vitrine mudou durante a publicação.')
        }
        if (
          avatarMediaRef &&
          (draft.data().useProfileAvatar !== true ||
            currentAvatarMedia.data()?.ownerId !== uid ||
            currentAvatarMedia.data()?.storagePath !== avatar.avatarSourcePath ||
            !['active', 'superseded'].includes(currentAvatarMedia.data()?.state))
        ) {
          fail('aborted', 'A autorização da foto mudou durante a publicação.')
        }
        if (draft.data().linkedCommunityId) {
          const community = await tx.get(db.doc(`communities/${draft.data().linkedCommunityId}`))
          if (
            !community.exists ||
            community.data().ownerId !== uid ||
            community.data().isActive !== true
          ) {
            fail('failed-precondition', 'A comunidade vinculada não está mais autorizada.')
          }
        }
        const now = FieldValue.serverTimestamp()
        const projection = buildPublicProjection(draft.data(), avatar)
        tx.set(publicRef, {
          ...projection,
          linkedCommunity: draft.data().linkedCommunity || null,
          publishedVersion: prepared.version,
          publishedAt: now,
          updatedAt: now,
        })
        tx.update(listingRef, {
          lifecycleState: 'published',
          publishedVersion: prepared.version,
          pendingVersion: FieldValue.delete(),
          updatedAt: now,
        })
        tx.update(draftRef, {
          reviewState: 'draft',
          basedOnPublishedVersion: prepared.version,
          rejectionSummary: FieldValue.delete(),
          publishOperationId: operationId,
          publishingOperationId: FieldValue.delete(),
          publishingStartedAt: FieldValue.delete(),
          updatedAt: now,
        })
        return { listingId, state: 'published', version: prepared.version }
      })
    } catch (error) {
      if (avatar.avatarPath)
        await bucket
          .file(avatar.avatarPath)
          .delete({ ignoreNotFound: true })
          .catch(() => {})
      await db.runTransaction(async (tx) => {
        const draft = await tx.get(draftRef)
        if (draft.data()?.publishingOperationId === operationId) {
          tx.update(draftRef, {
            reviewState: 'draft',
            publishingOperationId: FieldValue.delete(),
            publishingStartedAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }).catch(() => {})
      throw error
    }
    const previousAvatarPath = publicSnapshotBefore.data()?.avatarPath
    if (previousAvatarPath && previousAvatarPath !== avatar.avatarPath) {
      await bucket
        .file(previousAvatarPath)
        .delete({ ignoreNotFound: true })
        .catch(() => {})
    }
    return result
  }

  async function unpublish(uid, { listingId }) {
    if (!validListingId(listingId)) fail('invalid-argument', 'Vitrine inválida.')
    const listingRef = db.doc(`professionalListings/${listingId}`)
    const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
    let oldAvatarPath = null
    await db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)
      const [listing, published] = await tx.getAll(listingRef, publicRef)
      if (!listing.exists || listing.data().ownerId !== uid)
        fail('permission-denied', 'Vitrine não encontrada.')
      if (['suspended', 'deleting'].includes(listing.data().lifecycleState)) {
        fail('failed-precondition', 'A vitrine não pode ser despublicada neste estado.')
      }
      oldAvatarPath = published.data()?.avatarPath || null
      tx.delete(publicRef)
      tx.update(listingRef, { lifecycleState: 'archived', updatedAt: FieldValue.serverTimestamp() })
    })
    if (oldAvatarPath) await bucket.file(oldAvatarPath).delete({ ignoreNotFound: true })
    return { listingId, state: 'archived' }
  }

  async function suspend(adminId, { listingId, reason }) {
    if (!validListingId(listingId) || String(reason || '').trim().length < 5)
      fail('invalid-argument', 'Informe o motivo da suspensão.')
    await requireSuperAdmin(adminId)
    const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
    let avatarPath = null
    await db.runTransaction(async (tx) => {
      const [listing, published] = await tx.getAll(
        db.doc(`professionalListings/${listingId}`),
        publicRef
      )
      if (!listing.exists) fail('not-found', 'Vitrine não encontrada.')
      if (listing.data().lifecycleState === 'suspended') return
      avatarPath = published.data()?.avatarPath || null
      tx.delete(publicRef)
      tx.update(listing.ref, {
        lifecycleState: 'suspended',
        suspendedReason: String(reason).trim(),
        suspendedBy: adminId,
        updatedAt: FieldValue.serverTimestamp(),
      })
      tx.create(db.collection('showcaseReviewDecisions').doc(), {
        listingId,
        submittedVersion: listing.data().publishedVersion || 0,
        reviewerId: adminId,
        decision: 'suspended',
        reason: String(reason).trim(),
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    if (avatarPath) await bucket.file(avatarPath).delete({ ignoreNotFound: true })
    return { listingId, state: 'suspended' }
  }

  async function deleteListing(uid, { listingId }) {
    if (!validListingId(listingId)) fail('invalid-argument', 'Vitrine inválida.')
    const listingRef = db.doc(`professionalListings/${listingId}`)
    await db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)
      const listing = await tx.get(listingRef)
      if (!listing.exists || listing.data().ownerId !== uid)
        fail('permission-denied', 'Vitrine não encontrada.')
      tx.delete(db.doc(`publishedProfessionalListings/${listingId}`))
      tx.update(listingRef, {
        lifecycleState: 'deleting',
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    const [files] = await bucket.getFiles({ prefix: `professionalListingMedia/${listingId}/` })
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })))
    await db.runTransaction(async (tx) => {
      const listing = await tx.get(listingRef)
      if (!listing.exists) return
      if (listing.data().ownerId !== uid || listing.data().lifecycleState !== 'deleting') {
        fail('aborted', 'O estado da vitrine mudou durante a exclusão.')
      }
      tx.delete(db.doc(`publishedProfessionalListings/${listingId}`))
      tx.delete(db.doc(`professionalListingDrafts/${listingId}`))
      tx.delete(db.doc(`professionalListingOwnerLocks/${uid}`))
      tx.delete(listingRef)
    })
    return { listingId, deleted: true }
  }

  return {
    createDraft,
    saveDraft,
    publish,
    unpublish,
    suspend,
    deleteListing,
  }
}

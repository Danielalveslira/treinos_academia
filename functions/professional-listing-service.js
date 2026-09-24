import {
  buildPublicProjection,
  validListingId,
  validateListingDraft,
} from './professional-listing-core.js'

const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000
const LEGAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

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
      if (currentDraft.data()?.reviewState === 'pending_review') {
        fail('failed-precondition', 'A versão enviada está em análise.')
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

  async function submit(
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
    const policyRef = db.doc('showcaseLegalPolicy/current')
    const archiveRef = db.doc(`showcaseLegalVersions/${legalManifest.version}`)
    const acceptanceRef = db.doc(`users/${uid}/showcaseLegalAcceptances/${legalManifest.version}`)
    return db.runTransaction(async (tx) => {
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
        draft.data()?.reviewState === 'pending_review' &&
        draft.data()?.submissionOperationId === operationId &&
        draft.data()?.submittedLegalVersion === legalManifest.version &&
        draft.data()?.submittedLegalDigest === legalDigest
      ) {
        return {
          listingId,
          version: draft.data().version,
          state: 'pending_review',
          repeated: true,
        }
      }
      if (['suspended', 'deleting'].includes(listing.data().lifecycleState)) {
        fail('failed-precondition', 'A vitrine não pode ser enviada neste estado.')
      }
      if (!draft.exists || draft.data().reviewState !== 'draft' || !draft.data().version) {
        fail('failed-precondition', 'Salve um rascunho completo antes de enviar.')
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
              : 'Confirme os Termos de Publicação da Vitrine antes de enviar.'
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
      const submittedAvatar =
        draft.data().kind === 'professional' &&
        draft.data().useProfileAvatar === true &&
        user.data().avatarMediaId &&
        user.data().avatarPath
          ? {
              submittedAvatarMediaId: user.data().avatarMediaId,
              submittedAvatarPath: user.data().avatarPath,
            }
          : {
              submittedAvatarMediaId: FieldValue.delete(),
              submittedAvatarPath: FieldValue.delete(),
            }
      tx.update(draftRef, {
        reviewState: 'pending_review',
        ...submittedAvatar,
        submissionOperationId: operationId,
        submittedLegalDocumentId: legalDocumentId,
        submittedLegalVersion: legalManifest.version,
        submittedLegalDigest: legalDigest,
        submittedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      tx.update(listingRef, {
        lifecycleState: 'pending_review',
        pendingVersion: draft.data().version,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { listingId, version: draft.data().version, state: 'pending_review' }
    })
  }

  async function approvedAvatar(listingId, draft) {
    if (!draft.useProfileAvatar || draft.kind !== 'professional') return {}
    const sourcePath = draft.submittedAvatarPath
    const sourceMediaId = draft.submittedAvatarMediaId
    if (!sourcePath || !sourceMediaId) return {}
    const media = await db.doc(`profileAvatarMedia/${sourceMediaId}`).get()
    if (
      !media.exists ||
      media.data().ownerId !== draft.ownerId ||
      media.data().storagePath !== sourcePath ||
      !['active', 'superseded'].includes(media.data().state)
    ) {
      fail('failed-precondition', 'A versão de avatar enviada não está mais disponível.')
    }
    const approvedPath = `professionalListingMedia/${listingId}/approved/${db.collection('_').doc().id}.webp`
    await bucket.file(sourcePath).copy(bucket.file(approvedPath))
    await bucket
      .file(approvedPath)
      .setMetadata({ cacheControl: 'public,max-age=300', contentType: 'image/webp' })
    return {
      avatarPath: approvedPath,
      avatarSourceMediaId: sourceMediaId,
      avatarSourcePath: sourcePath,
    }
  }

  async function review(adminId, { listingId, decision, reason = '' }) {
    if (!validListingId(listingId) || !['approved', 'rejected'].includes(decision)) {
      fail('invalid-argument', 'Decisão inválida.')
    }
    if (decision === 'rejected' && String(reason).trim().length < 5) {
      fail('invalid-argument', 'Informe o motivo da rejeição.')
    }
    await requireSuperAdmin(adminId)
    const listingRef = db.doc(`professionalListings/${listingId}`)
    const draftRef = db.doc(`professionalListingDrafts/${listingId}`)
    const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
    const [listing, draft, previousPublic] = await Promise.all([
      listingRef.get(),
      draftRef.get(),
      publicRef.get(),
    ])
    if (!listing.exists || !draft.exists || draft.data().reviewState !== 'pending_review') {
      fail('failed-precondition', 'Esta submissão não está pendente.')
    }
    const expectedVersion = draft.data().version
    const avatar = decision === 'approved' ? await approvedAvatar(listingId, draft.data()) : {}
    const decisionRef = db.collection('showcaseReviewDecisions').doc()
    let result
    try {
      result = await db.runTransaction(async (tx) => {
        const avatarMediaRef = avatar.avatarSourceMediaId
          ? db.doc(`profileAvatarMedia/${avatar.avatarSourceMediaId}`)
          : null
        const [currentListing, currentDraft, currentAvatarMedia] = await tx.getAll(
          listingRef,
          draftRef,
          ...(avatarMediaRef ? [avatarMediaRef] : [])
        )
        if (
          currentListing.data()?.lifecycleState !== 'pending_review' ||
          currentDraft.data()?.reviewState !== 'pending_review' ||
          currentDraft.data()?.version !== expectedVersion
        ) {
          fail('aborted', 'A submissão mudou durante a análise.')
        }
        if (
          avatarMediaRef &&
          (currentDraft.data().useProfileAvatar !== true ||
            currentDraft.data().submittedAvatarMediaId !== avatar.avatarSourceMediaId ||
            currentDraft.data().submittedAvatarPath !== avatar.avatarSourcePath ||
            currentAvatarMedia.data()?.ownerId !== currentDraft.data().ownerId ||
            currentAvatarMedia.data()?.storagePath !== avatar.avatarSourcePath ||
            !['active', 'superseded'].includes(currentAvatarMedia.data()?.state))
        ) {
          fail('aborted', 'A autorização da foto mudou durante a análise.')
        }
        if (currentDraft.data().linkedCommunityId) {
          const community = await tx.get(
            db.doc(`communities/${currentDraft.data().linkedCommunityId}`)
          )
          if (
            !community.exists ||
            community.data().ownerId !== currentDraft.data().ownerId ||
            community.data().isActive !== true
          ) {
            fail('failed-precondition', 'A comunidade vinculada não está mais autorizada.')
          }
        }
        const now = FieldValue.serverTimestamp()
        tx.create(decisionRef, {
          listingId,
          submittedVersion: expectedVersion,
          reviewerId: adminId,
          decision,
          reason: String(reason).trim() || null,
          legalDocumentId: currentDraft.data().submittedLegalDocumentId || null,
          legalVersion: currentDraft.data().submittedLegalVersion || null,
          legalDigest: currentDraft.data().submittedLegalDigest || null,
          createdAt: now,
        })
        if (decision === 'rejected') {
          tx.update(draftRef, {
            reviewState: 'rejected',
            rejectionSummary: String(reason).trim(),
            submittedAvatarMediaId: FieldValue.delete(),
            submittedAvatarPath: FieldValue.delete(),
            updatedAt: now,
          })
          tx.update(listingRef, {
            lifecycleState: currentListing.data().publishedVersion ? 'published' : 'draft',
            pendingVersion: FieldValue.delete(),
            updatedAt: now,
          })
          return { listingId, state: 'rejected' }
        }
        const projection = buildPublicProjection(currentDraft.data(), avatar)
        tx.set(publicRef, {
          ...projection,
          linkedCommunity: currentDraft.data().linkedCommunity || null,
          publishedVersion: expectedVersion,
          publishedAt: now,
          updatedAt: now,
        })
        tx.update(listingRef, {
          lifecycleState: 'published',
          publishedVersion: expectedVersion,
          pendingVersion: FieldValue.delete(),
          updatedAt: now,
        })
        tx.update(draftRef, {
          reviewState: 'draft',
          basedOnPublishedVersion: expectedVersion,
          rejectionSummary: null,
          submittedAvatarMediaId: FieldValue.delete(),
          submittedAvatarPath: FieldValue.delete(),
          updatedAt: now,
        })
        return { listingId, state: 'published', version: expectedVersion }
      })
    } catch (error) {
      if (avatar.avatarPath)
        await bucket
          .file(avatar.avatarPath)
          .delete({ ignoreNotFound: true })
          .catch(() => {})
      throw error
    }
    const previousAvatarPath = previousPublic.data()?.avatarPath
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

  async function report(uid, { listingId, message }) {
    const text = String(message || '').trim()
    if (!validListingId(listingId) || text.length < 5 || text.length > 500)
      fail('invalid-argument', 'Informe uma denúncia entre 5 e 500 caracteres.')
    const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
    const rateRef = db.doc(`showcaseReportRateLimits/${uid}`)
    const reportRef = db.collection('showcaseReports').doc()
    return db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)
      const [published, rate] = await tx.getAll(publicRef, rateRef)
      if (!published.exists) fail('not-found', 'Vitrine indisponível.')
      if (rate.data()?.lastReportAt?.toMillis() > Date.now() - REPORT_WINDOW_MS)
        fail('resource-exhausted', 'Aguarde antes de enviar outra denúncia.')
      tx.create(reportRef, {
        listingId,
        reporterId: uid,
        state: 'open',
        message: text,
        createdAt: FieldValue.serverTimestamp(),
      })
      tx.set(rateRef, { lastReportAt: FieldValue.serverTimestamp() })
      return { reportId: reportRef.id }
    })
  }

  async function resolveReport(adminId, { reportId, action, reason = '' }) {
    if (!validListingId(reportId) || !['no_action', 'suspend'].includes(action))
      fail('invalid-argument', 'Decisão inválida.')
    await requireSuperAdmin(adminId)
    const reportRef = db.doc(`showcaseReports/${reportId}`)
    let avatarPath = null
    let listingId = null
    const result = await db.runTransaction(async (tx) => {
      const reportSnapshot = await tx.get(reportRef)
      if (!reportSnapshot.exists) fail('failed-precondition', 'Denúncia indisponível.')
      if (reportSnapshot.data().state === 'closed') {
        if (reportSnapshot.data().decision === action) {
          return { reportId, state: 'closed', repeated: true }
        }
        fail('aborted', 'A denúncia já recebeu outra decisão.')
      }
      if (reportSnapshot.data().state !== 'open')
        fail('failed-precondition', 'Denúncia indisponível.')

      listingId = reportSnapshot.data().listingId
      const now = FieldValue.serverTimestamp()
      if (action === 'suspend') {
        if (String(reason || '').trim().length < 5)
          fail('invalid-argument', 'Informe o motivo da suspensão.')
        const listingRef = db.doc(`professionalListings/${listingId}`)
        const publicRef = db.doc(`publishedProfessionalListings/${listingId}`)
        const [listing, published] = await tx.getAll(listingRef, publicRef)
        if (!listing.exists) fail('not-found', 'Vitrine não encontrada.')
        avatarPath = published.data()?.avatarPath || null
        tx.delete(publicRef)
        if (listing.data().lifecycleState !== 'suspended') {
          tx.update(listingRef, {
            lifecycleState: 'suspended',
            suspendedReason: String(reason).trim(),
            suspendedBy: adminId,
            updatedAt: now,
          })
          tx.create(db.doc(`showcaseReviewDecisions/report_${reportId}`), {
            listingId,
            submittedVersion: listing.data().publishedVersion || 0,
            reviewerId: adminId,
            decision: 'suspended',
            reason: String(reason).trim(),
            createdAt: now,
          })
        }
      }
      tx.update(reportRef, {
        state: 'closed',
        decision: action,
        decisionReason: String(reason).trim() || null,
        decidedBy: adminId,
        decidedAt: now,
      })
      return { reportId, state: 'closed' }
    })
    if (avatarPath) {
      await bucket
        .file(avatarPath)
        .delete({ ignoreNotFound: true })
        .catch(() => {})
    }
    return result
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
    submit,
    review,
    unpublish,
    suspend,
    report,
    resolveReport,
    deleteListing,
  }
}

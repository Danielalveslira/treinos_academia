import {
  APPROVED_LEGAL_DIGESTS,
  calculateAge,
  validateActiveLegalAcceptance,
} from './legal-core.js'

export function createLegalAcceptanceService({ db, FieldValue, HttpsError, assertWritableAccount }) {
  async function accept(uid, data, ip) {
    const version = data?.version
    if (!Object.hasOwn(APPROVED_LEGAL_DIGESTS, version)) {
      throw new HttpsError('failed-precondition', 'Esta versão dos documentos não é suportada.')
    }
    const acceptanceRef = db.doc(`users/${uid}/legalAcceptances/${version}`)
    const archiveRef = db.doc(`legalVersions/${version}`)
    const profileRef = db.doc(`users/${uid}`)
    const policyRef = db.doc('legalPolicy/current')

    return db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)
      const [previous, archive, profile, policy] = await tx.getAll(
        acceptanceRef,
        archiveRef,
        profileRef,
        policyRef
      )
      const archivedVersion = archive.exists ? archive.data() : null
      const error = validateActiveLegalAcceptance(data, policy.data(), archivedVersion)
      if (error) throw new HttpsError('failed-precondition', error)
      if (!profile.exists) {
        throw new HttpsError('failed-precondition', 'Finalize seu perfil antes do aceite.')
      }

      const minimumAge = archivedVersion.manifest.minimumAge
      const birthDate = profile.data().dataNascimento
      if (!Number.isInteger(minimumAge) || !birthDate || calculateAge(birthDate) < minimumAge) {
        throw new HttpsError(
          'failed-precondition',
          `É necessário ter pelo menos ${minimumAge} anos para aceitar os documentos.`
        )
      }
      if (previous.exists) {
        if (previous.data().digest !== archivedVersion.digest) {
          throw new HttpsError('failed-precondition', 'Versão inconsistente.')
        }
        return { version, digest: archivedVersion.digest, repeated: true }
      }

      tx.create(acceptanceRef, {
        userId: uid,
        version,
        digest: archivedVersion.digest,
        acceptedAt: FieldValue.serverTimestamp(),
        ip,
        accepted: true,
        healthDataConsent: true,
      })
      tx.update(profileRef, {
        legalAcceptance: {
          version,
          digest: archivedVersion.digest,
          acceptedAt: FieldValue.serverTimestamp(),
        },
      })
      return { version, digest: archivedVersion.digest }
    })
  }

  return { accept }
}

import { isValidUsageProfile } from './usage-profile-core.js'

// Vitrine continua "ativa" (exige gerência explícita do titular antes de virar
// usuário comum) nestes estados -- archived/suspended/deleting (ou nenhuma vitrine)
// liberam a troca: archived já foi uma ação deliberada do próprio titular (Despublicar),
// suspended não tem ação de autosserviço disponível (ver unpublish() em
// professional-listing-service.js, que recusa nesse estado) e não expõe nada
// publicamente, e deleting já está a caminho de sumir sozinha.
const LISTING_STATES_BLOCKING_COMMON = ['draft', 'pending_review', 'published']

export function createUsageProfileService({ db, FieldValue, HttpsError }) {
  const fail = (code, message) => {
    throw new HttpsError(code, message)
  }

  // Todas as gravações de usageProfile passam por aqui -- tanto a primeira declaração
  // (cadastro, ou preenchimento contextual de conta legada) quanto uma troca
  // posterior -- para que a checagem de vitrine ativa abaixo nunca seja contornável por
  // uma escrita direta do cliente (usageProfile não está na allowlist de
  // users/{uid} em firestore.rules; só a Admin SDK grava este campo).
  async function setUsageProfile(uid, { usageProfile } = {}) {
    if (!isValidUsageProfile(usageProfile)) {
      fail('invalid-argument', 'Perfil de uso inválido.')
    }
    const userRef = db.doc(`users/${uid}`)
    const lockRef = db.doc(`professionalListingOwnerLocks/${uid}`)
    return db.runTransaction(async (tx) => {
      const [user, deletion] = await tx.getAll(userRef, db.doc(`deletionJobs/account_${uid}`))
      if (!user.exists || deletion.exists || user.data().accountStatus === 'disabled') {
        fail('failed-precondition', 'A conta não pode ser alterada agora.')
      }
      if (usageProfile === 'common') {
        const lock = await tx.get(lockRef)
        if (lock.exists) {
          const listing = await tx.get(db.doc(`professionalListings/${lock.data().listingId}`))
          if (listing.exists && LISTING_STATES_BLOCKING_COMMON.includes(listing.data().lifecycleState)) {
            fail(
              'failed-precondition',
              'Você ainda tem uma vitrine ativa. Despublique-a em "Minha Vitrine" antes de mudar para usuário comum.'
            )
          }
        }
      }
      tx.update(userRef, { usageProfile, updatedAt: FieldValue.serverTimestamp() })
      return { usageProfile }
    })
  }

  return { setUsageProfile }
}

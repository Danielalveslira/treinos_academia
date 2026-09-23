import { httpsCallable } from 'firebase/functions'
import { doc, getDocFromServer } from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { resolveLegalBundle } from '../utils/legal'

async function readLegalBundle(policy) {
  if (!policy?.version) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  const archive = await getDocFromServer(doc(db, 'legalVersions', policy.version))
  if (!archive.exists()) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  return resolveLegalBundle(policy, archive.data())
}

export async function getActiveLegalBundle() {
  const snapshot = await getDocFromServer(doc(db, 'legalPolicy', 'current'))
  if (!snapshot.exists()) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  const policy = snapshot.data()
  return { policy, ...(await readLegalBundle(policy)) }
}

export async function getLegalAccess(userId) {
  const [policy, restriction] = await Promise.all([
    getDocFromServer(doc(db, 'legalPolicy', 'current')),
    getDocFromServer(doc(db, 'accountRestrictions', userId)),
  ])
  const currentPolicy = policy.data()
  let legalBundle = null
  if (currentPolicy?.version) {
    try {
      legalBundle = await readLegalBundle(currentPolicy)
    } catch (error) {
      if (error?.message !== 'LEGAL_POLICY_INCOMPATIBLE') throw error
    }
  }
  return { policy: currentPolicy, restriction: restriction.data(), legalBundle }
}

export async function acceptLegalDocuments(confirmations, legalBundle) {
  if (!legalBundle?.manifest?.version || !legalBundle?.digest) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
  const call = httpsCallable(functions, 'acceptLegalDocuments')
  return (
    await call({
      ...confirmations,
      version: legalBundle.manifest.version,
      digest: legalBundle.digest,
    })
  ).data
}

export function isLegalPolicyChangedError(error) {
  return String(error?.message || '').includes('A política ativa mudou')
}

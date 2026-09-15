import { httpsCallable } from 'firebase/functions'
import { doc, getDocFromServer } from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { LEGAL_MANIFEST } from '../utils/legal'

export async function getLegalAccess(userId) {
  const [policy, restriction] = await Promise.all([
    getDocFromServer(doc(db, 'legalPolicy', 'current')),
    getDocFromServer(doc(db, 'accountRestrictions', userId)),
  ])
  return { policy: policy.data(), restriction: restriction.data() }
}

export async function acceptLegalDocuments(confirmations) {
  const call = httpsCallable(functions, 'acceptLegalDocuments')
  return (await call({ version: LEGAL_MANIFEST.version, ...confirmations })).data
}

import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

export async function getPublicProfile(userId) {
  const snapshot = await getDoc(doc(db, 'publicProfiles', userId))
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
}

export async function getPublicStatistics(userId) {
  const snapshot = await getDoc(doc(db, 'publicProfiles', userId, 'statistics', 'summary'))
  return snapshot.exists() ? snapshot.data() : null
}

// AUD-006: o cálculo (agregação sobre o diário real de treino) e a gravação do
// resumo público agora rodam no servidor, via Cloud Function com Admin SDK — o
// cliente não escreve mais esse documento direto (firestore.rules bloqueia
// create/update ali). Sempre para o próprio usuário autenticado: a function lê
// request.auth.uid, não aceita um userId arbitrário.
export async function refreshPublicStatistics() {
  return (await httpsCallable(functions, 'refreshPublicStatistics')()).data
}

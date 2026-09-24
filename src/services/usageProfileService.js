import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'

// Sempre pela Cloud Function, nunca escrita direta -- tanto a primeira declaração
// (cadastro, ou preenchimento contextual de conta legada) quanto uma troca posterior
// passam pela mesma checagem server-side de vitrine ativa (ver usage-profile-service.js).
export async function setUsageProfile(usageProfile) {
  return (await httpsCallable(functions, 'setUsageProfile')({ usageProfile })).data
}
